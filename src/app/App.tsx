import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Toolbar } from '../ui/toolbar/Toolbar';
import { PropertyPanel } from '../ui/panels/PropertyPanel';
import { CanvasPanel } from '../ui/panels/CanvasPanel';
import { ResultsPanel } from '../ui/tables/ResultsPanel';
import { HelpDialog } from '../ui/HelpDialog';
import { ModelGeneratorDialog } from '../ui/dialogs/ModelGeneratorDialog';
import { ModelTablePanel } from '../ui/tables/ModelTablePanel';
import { ImportSummaryDialog } from '../ui/dialogs/ImportSummaryDialog';
import { ModelDiagnosticsDialog } from '../ui/dialogs/ModelDiagnosticsDialog';
import type { ModelDiagnostic } from '../core/model/modelDiagnostics';
import { useProjectStore } from '../state/projectStore';
import { useViewStore } from '../state/viewStore';
import { useSelectionStore } from '../state/selectionStore';
import { useT, useI18nStore } from '../i18n';
import type { ProjectFile } from '../core/model/types';
import { saveProject, loadProjectWithReport } from '../persistence/indexedDb';
import { createAutosaveController, type AutosaveStatus } from '../persistence/autosaveController';
import { redoProject, undoProject } from '../state/projectStore';
import { generatePortalFrameTemplate } from '../core/model/generators';
import { CURRENT_PROJECT_SCHEMA_VERSION } from '../io/projectFileParser';
import {
  generateCsvReport,
  generateMarkdownReport,
  generatePrintableReportHtml,
} from '../io/reportExporter';
import type { ReportInput, ReportResultView } from '../io/reportExporter';
import { downloadText, pickTextFile, printHtmlInNewWindow } from './browserFiles';
import { useAnalysisWorker } from './useAnalysisWorker';

export const App: React.FC = () => {
  const autosaveRef = useRef<ReturnType<typeof createAutosaveController> | null>(null);
  const retryAutosaveRef = useRef<() => void>(() => undefined);
  const saveCurrentRef = useRef<() => void>(() => undefined);
  const [autosave, setAutosave] = useState<AutosaveStatus>({ phase: 'restoring' });
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [initialGenerator, setInitialGenerator] = useState(false);
  const [tablesOpen, setTablesOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [pendingImportText, setPendingImportText] = useState<string | null>(null);

  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  const theme = useViewStore((s) => s.theme);
  const toggleTheme = useViewStore((s) => s.toggleTheme);

  const model = useProjectStore((s) => s.model);
  const isAnalyzing = useProjectStore((s) => s.isAnalyzing);
  const loadModel = useProjectStore((s) => s.loadModel);
  const importJsonAuto = useProjectStore((s) => s.importJsonAuto);
  const importFrameJson = useProjectStore((s) => s.importFrameJson);
  const lastImportReport = useProjectStore((s) => s.lastImportReport);
  const clearImportReport = useProjectStore((s) => s.clearImportReport);
  const setImportReport = useProjectStore((s) => s.setImportReport);
  const resetModel = useProjectStore((s) => s.resetModel);
  const clearSelection = useSelectionStore((s) => s.clearSelection);
  const analysis = useAnalysisWorker();
  const closeDiagnostics = useCallback(() => setDiagnosticsOpen(false), []);
  const locateDiagnostic = useCallback((diagnostic: ModelDiagnostic) => {
    useSelectionStore.setState({
      selectedNodeIds: new Set(diagnostic.nodeIds),
      selectedMemberIds: new Set(diagnostic.memberIds),
    });
    useViewStore.getState().setEditTool('select');
    useViewStore.getState().setDisplayMode('model');
    useSelectionStore.getState().focusSelection();
    setDiagnosticsOpen(false);
  }, []);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  // Subscribe immediately, but never save until restoration has completed.
  useEffect(() => {
    let cancelled = false;
    let restored = false;
    let restoreGeneration = 0;
    const initialModel = useProjectStore.getState().model;
    const controller = createAutosaveController(saveProject, setAutosave);
    autosaveRef.current = controller;
    const unsubscribe = useProjectStore.subscribe((state, previous) => {
      if (state.model !== previous.model) controller.update(state.model);
    });
    const restore = async () => {
      const generation = ++restoreGeneration;
      setAutosave({ phase: 'restoring' });
      try {
        const saved = await loadProjectWithReport();
        if (cancelled || generation !== restoreGeneration) return;
        // An import or edit during a slow read takes precedence over autosave.
        if (useProjectStore.getState().model === initialModel) {
          if (saved) {
            loadModel(saved.model);
            if (saved.warnings.length > 0) setImportReport(saved);
          } else {
            setInitialGenerator(true);
            setGeneratorOpen(true);
          }
        }
        restored = true;
        controller.restored();
        controller.update(useProjectStore.getState().model);
      } catch (error) {
        if (!cancelled && generation === restoreGeneration) controller.restoreFailed(error);
      }
    };
    retryAutosaveRef.current = () => { void (restored ? controller.retry() : restore()); };
    saveCurrentRef.current = () => {
      restoreGeneration++;
      restored = true;
      controller.update(useProjectStore.getState().model);
      void controller.retry();
    };
    void restore();
    const flushWhenHidden = () => {
      if (document.visibilityState === 'hidden') void controller.flush();
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (controller.hasPending()) {
        void controller.flush();
        event.preventDefault();
        event.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', flushWhenHidden);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      cancelled = true;
      unsubscribe();
      controller.dispose();
      document.removeEventListener('visibilitychange', flushWhenHidden);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [loadModel, setImportReport]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redoProject();
      else undoProject();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleExport = useCallback(() => {
    const file: ProjectFile = {
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      model,
    };
    downloadText('frame-model-3d.json', JSON.stringify(file, null, 2), 'application/json');
  }, [model]);

  /**
   * Snapshot of the model and the results that are current for it. Stale
   * static results are left out; when nothing current remains to report
   * alongside them, the user is told to re-run instead.
   */
  const createReportInput = useCallback((): ReportInput | null => {
    const state = useProjectStore.getState();
    const modal = state.modalResult?.sourceModel === state.model ? state.modalResult : null;
    const buckling = state.bucklingResult?.sourceModel === state.model ? state.bucklingResult : null;
    const staticIsStale = state.isResultStale;
    if (staticIsStale && !modal && !buckling) {
      alert(t('prop.staleWarning'));
      return null;
    }
    let resultView: ReportResultView | undefined;
    const view = staticIsStale ? null : state.analysisResultView;
    if (view?.kind === 'target') {
      const selected = state.analysisResults.find((item) => item.target.id === view.targetId);
      if (selected) resultView = { kind: 'target', target: selected.target };
    } else if (view?.kind === 'envelope' && state.analysisEnvelope) {
      resultView = {
        kind: 'envelope',
        bound: view.bound,
        envelope: state.analysisEnvelope,
        targetNames: Object.fromEntries(
          state.analysisResults.map((item) => [item.target.id, item.target.name]),
        ),
      };
    }
    return {
      model: state.model,
      result: staticIsStale ? null : state.analysisResult,
      ...(resultView ? { resultView } : {}),
      ...(modal ? { modal } : {}),
      ...(buckling ? { buckling } : {}),
      error: staticIsStale ? null : state.analysisError,
      generatedAt: new Date(),
      // A stale static result is omitted above; the report says so.
      isResultStale: staticIsStale && (state.analysisResult !== null || state.analysisError !== null),
    };
  }, [t]);

  const handleExportMarkdownReport = useCallback(() => {
    const input = createReportInput();
    if (input) downloadText('frame-analysis-report.md', generateMarkdownReport(input), 'text/markdown');
  }, [createReportInput]);

  const handleExportCsvReport = useCallback(() => {
    const input = createReportInput();
    if (input) downloadText('frame-analysis-report.csv', generateCsvReport(input), 'text/csv');
  }, [createReportInput]);

  const handlePrintReport = useCallback(async () => {
    const input = createReportInput();
    if (!input) return;
    const viewportImageDataUrl = await captureViewerImage();
    const html = generatePrintableReportHtml({
      ...input,
      ...(viewportImageDataUrl ? { viewportImageDataUrl } : {}),
    });
    if (!printHtmlInNewWindow(html)) alert(t('app.popupBlocked'));
  }, [createReportInput, t]);

  const importText = useCallback((text: string) => {
    clearSelection();
    setPendingImportText(text);
    importJsonAuto(text);
  }, [clearSelection, importJsonAuto]);

  const handleImport = useCallback(() => {
    pickTextFile('.json', (text) => {
      try {
        importText(text);
      } catch (error) {
        alert(`${t('app.importError')}\n${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }, [importText, t]);

  const handleLoadSample = useCallback(async () => {
    try {
      // Try to load the FrameJson sample
      const resp = await fetch('./samples/FrameModel_Sample.json');
      if (resp.ok) {
        importText(await resp.text());
        return;
      }
    } catch {
      // fallback
    }
    clearSelection();
    loadModel(generatePortalFrameTemplate());
  }, [loadModel, importText, clearSelection]);

  return (
    <div className={`app-layout${propertiesOpen ? ' properties-open' : ''}`}>
      <div className="top-bar">
        <span className="app-title">{t('app.title')}</span>
        <div className="top-actions">
          <button onClick={handleLoadSample}>{t('app.loadSample')}</button>
          <button onClick={handleImport}>{t('app.import')}</button>
          <button onClick={handleExport}>{t('app.export')}</button>
          <button onClick={handleExportMarkdownReport}>{t('app.reportMd')}</button>
          <button onClick={handleExportCsvReport}>{t('app.reportCsv')}</button>
          <button onClick={() => void handlePrintReport()}>{t('app.reportPdf')}</button>
          <button onClick={() => window.dispatchEvent(new Event('frame-viewer:screenshot'))}>{t('app.reportPng')}</button>
          <button onClick={() => { clearSelection(); resetModel(); setInitialGenerator(true); setGeneratorOpen(true); }}>{t('app.new')}</button>
          <button className="properties-toggle" aria-expanded={propertiesOpen} onClick={() => setPropertiesOpen(!propertiesOpen)}>{t('app.properties')}</button>
          <button className="top-icon-btn" onClick={toggleTheme} title={theme === 'dark' ? t('theme.light') : t('theme.dark')}>
            {theme === 'dark' ? '☀' : '☾'}
          </button>
          <button className="top-icon-btn" onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')} title={t('app.language')}>
            {lang === 'ja' ? 'EN' : 'JA'}
          </button>
          <button className="top-icon-btn" onClick={() => setHelpOpen(true)} title={t('app.help')}>
            ?
          </button>
        </div>
      </div>
      <div className={`autosave-status ${autosave.phase}`} role="status" aria-live="polite">
        <span>{t(`save.${autosave.phase}`)}{autosave.lastSavedAt ? ` · ${new Date(autosave.lastSavedAt).toLocaleTimeString(lang)}` : ''}</span>
        {autosave.phase === 'error' && <>
          <span>{autosave.error}</span>
          <button onClick={() => retryAutosaveRef.current()}>{t('save.retry')}</button>
          <button onClick={() => saveCurrentRef.current()}>{t('save.current')}</button>
          <button onClick={handleExport}>{t('app.export')}</button>
        </>}
      </div>
      <div className="main-area">
        <Toolbar onRunAnalysis={analysis.run} onCancelAnalysis={analysis.cancel} isAnalyzing={isAnalyzing} onOpenGenerator={() => { setInitialGenerator(false); setGeneratorOpen(true); }} onOpenTables={() => setTablesOpen(true)} onOpenDiagnostics={() => setDiagnosticsOpen(true)} />
        <div className="center-area">
          <CanvasPanel />
          <ResultsPanel />
        </div>
        <PropertyPanel />
      </div>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ModelGeneratorDialog open={generatorOpen} initial={initialGenerator} onClose={() => { setGeneratorOpen(false); setInitialGenerator(false); }} />
      <ModelTablePanel open={tablesOpen} onClose={() => setTablesOpen(false)} />
      {diagnosticsOpen && <ModelDiagnosticsDialog model={model} onClose={closeDiagnostics} onSelect={locateDiagnostic} />}
      <ImportSummaryDialog
        report={lastImportReport}
        {...(pendingImportText ? { onSelectLoadCase: (index: number) => { importFrameJson(pendingImportText, index); } } : {})}
        onClose={() => { clearImportReport(); setPendingImportText(null); }}
      />
    </div>
  );
};

function captureViewerImage(): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    window.dispatchEvent(new CustomEvent('frame-viewer:capture-request', {
      detail: { resolve: finish },
    }));
    window.setTimeout(() => finish(''), 150);
  });
}
