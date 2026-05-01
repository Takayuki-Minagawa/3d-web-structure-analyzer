import React, { useRef, useCallback, useEffect, useState } from 'react';
import { Toolbar } from '../ui/toolbar/Toolbar';
import { PropertyPanel } from '../ui/panels/PropertyPanel';
import { CanvasPanel } from '../ui/panels/CanvasPanel';
import { ResultsPanel } from '../ui/tables/ResultsPanel';
import { HelpDialog } from '../ui/HelpDialog';
import { useProjectStore } from '../state/projectStore';
import { useViewStore } from '../state/viewStore';
import { useSelectionStore } from '../state/selectionStore';
import { useT, useI18nStore } from '../i18n';
import type { WorkerResponse } from '../worker/protocol';
import type { ProjectFile } from '../core/model/types';
import { saveProject, loadProject } from '../persistence/indexedDb';

export const App: React.FC = () => {
  const workerRef = useRef<Worker | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const t = useT();
  const lang = useI18nStore((s) => s.lang);
  const setLang = useI18nStore((s) => s.setLang);
  const theme = useViewStore((s) => s.theme);
  const toggleTheme = useViewStore((s) => s.toggleTheme);

  const model = useProjectStore((s) => s.model);
  const setAnalyzing = useProjectStore((s) => s.setAnalyzing);
  const setAnalysisResult = useProjectStore((s) => s.setAnalysisResult);
  const isAnalyzing = useProjectStore((s) => s.isAnalyzing);
  const loadModel = useProjectStore((s) => s.loadModel);
  const importJsonAuto = useProjectStore((s) => s.importJsonAuto);
  const resetModel = useProjectStore((s) => s.resetModel);
  const clearSelection = useSelectionStore((s) => s.clearSelection);

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Auto-save with debounce
  useEffect(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveProject(model).catch(() => {/* ignore save errors */});
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [model]);

  // Load saved project on startup
  useEffect(() => {
    loadProject().then((saved) => {
      if (saved) loadModel(saved);
    }).catch(() => {/* ignore load errors */});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAnalysis = useCallback(() => {
    if (isAnalyzing) return;

    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../worker/analysis.worker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current.onmessage = (e: MessageEvent<WorkerResponse>) => {
        setAnalysisResult(e.data);
      };
      workerRef.current.onerror = () => {
        setAnalysisResult({
          type: 'analyze-error',
          error: { type: 'numerical', message: 'Worker crashed unexpectedly.' },
        });
      };
    }

    setAnalyzing(true);
    workerRef.current.postMessage({ type: 'analyze', model });
  }, [model, isAnalyzing, setAnalyzing, setAnalysisResult]);

  const handleExport = useCallback(() => {
    const file: ProjectFile = {
      schemaVersion: 2,
      savedAt: new Date().toISOString(),
      model,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'frame-model-3d.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [model]);

  const handleImport = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          clearSelection();
          importJsonAuto(reader.result as string);
        } catch {
          alert(t('app.importError'));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [importJsonAuto, t, clearSelection]);

  const handleLoadSample = useCallback(async () => {
    try {
      // Try to load the FrameJson sample
      const resp = await fetch('./samples/FrameModel_Sample.json');
      if (resp.ok) {
        const text = await resp.text();
        clearSelection();
        importJsonAuto(text);
        return;
      }
    } catch {
      // fallback
    }
    // Fallback: simple 3D portal frame
    const sampleModel = {
      title: 'Simple 3D Portal Frame',
      analysisMode: '3d' as const,
      nodes: [
        { id: 'n1', x: 0, y: 0, z: 0, restraint: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true } },
        { id: 'n2', x: 0, y: 0, z: 400, restraint: { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false } },
        { id: 'n3', x: 600, y: 0, z: 400, restraint: { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false } },
        { id: 'n4', x: 600, y: 0, z: 0, restraint: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true } },
      ],
      materials: [{ id: 'mat1', name: 'Steel', E: 20500, G: 7900, nu: 0.3, expansion: 0.000012 }],
      sections: [{ id: 'sec1', name: 'H-200x100', materialId: 'mat1', A: 27.16, Ix: 134, Iy: 1840, Iz: 134, ky: 0, kz: 0 }],
      springs: [],
      couplings: [],
      members: [
        { id: 'm1', ni: 'n1', nj: 'n2', sectionId: 'sec1', codeAngle: 0, iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 } },
        { id: 'm2', ni: 'n2', nj: 'n3', sectionId: 'sec1', codeAngle: 0, iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 } },
        { id: 'm3', ni: 'n4', nj: 'n3', sectionId: 'sec1', codeAngle: 0, iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 } },
      ],
      nodalLoads: [
        { id: 'nl1', nodeId: 'n2', fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
      ],
      memberLoads: [],
      units: { force: 'kN', length: 'cm', moment: 'kN·cm' },
    };
    clearSelection();
    loadModel(sampleModel);
  }, [loadModel, importJsonAuto, clearSelection]);

  return (
    <div className="app-layout">
      <div className="top-bar">
        <span className="app-title">{t('app.title')}</span>
        <div className="top-actions">
          <button onClick={handleLoadSample}>{t('app.loadSample')}</button>
          <button onClick={handleImport}>{t('app.import')}</button>
          <button onClick={handleExport}>{t('app.export')}</button>
          <button onClick={() => { clearSelection(); resetModel(); }}>{t('app.new')}</button>
          <button className="top-icon-btn" onClick={toggleTheme} title={theme === 'dark' ? t('theme.light') : t('theme.dark')}>
            {theme === 'dark' ? '\u2600' : '\u263E'}
          </button>
          <button className="top-icon-btn" onClick={() => setLang(lang === 'ja' ? 'en' : 'ja')} title="Language">
            {lang === 'ja' ? 'EN' : 'JA'}
          </button>
          <button className="top-icon-btn" onClick={() => setHelpOpen(true)} title={t('app.help')}>
            ?
          </button>
        </div>
      </div>
      <div className="main-area">
        <Toolbar onRunAnalysis={runAnalysis} />
        <div className="center-area">
          <CanvasPanel />
          <ResultsPanel />
        </div>
        <PropertyPanel />
      </div>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
};
