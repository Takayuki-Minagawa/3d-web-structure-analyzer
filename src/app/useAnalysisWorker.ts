import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import type { AnalysisError, ProjectModel } from '../core/model/types';
import { useI18nStore } from '../i18n';
import { translations } from '../i18n/translations';
import {
  toStaticOutcome,
  toStoredBucklingResult,
  toStoredModalResult,
} from '../state/analysisResults';
import { useProjectStore } from '../state/projectStore';
import { useViewStore } from '../state/viewStore';
import type {
  AnalysisExecutionRequest,
  AnalysisKind,
  WorkerResponse,
} from '../worker/protocol';
import {
  beginAnalysisRequest,
  clearActiveAnalysisRequest,
  completeAnalysisRequest,
  createAnalysisRequestGuard,
  getActiveAnalysisRequestId,
  invalidateAnalysisForModelChange,
} from './analysisRequestGuard';

interface ActiveRun {
  kind: AnalysisKind;
  /** The exact model object sent to the worker. */
  model: ProjectModel;
}

export interface AnalysisWorkerControls {
  run: (kind: AnalysisKind) => void;
  cancel: () => void;
}

/**
 * Owns the analysis Web Worker: starts static / modal / buckling runs,
 * discards responses that no longer match the current model, and routes
 * results and errors into the project store.
 */
export function useAnalysisWorker(): AnalysisWorkerControls {
  const workerRef = useRef<Worker | null>(null);
  const requestSequenceRef = useRef(0);
  const guardRef = useRef(createAnalysisRequestGuard());
  const activeRunRef = useRef<ActiveRun | null>(null);

  const stopWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    activeRunRef.current = null;
  }, []);

  // Invalidate synchronously with every model replacement/edit. This prevents
  // a late worker response from being attached to a newer model, including
  // reset/import and edit-then-undo sequences.
  useLayoutEffect(() => useProjectStore.subscribe((state, previousState) => {
    if (state.model === previousState.model) return;
    const requestId = invalidateAnalysisForModelChange(guardRef.current);
    if (!requestId) return;
    stopWorker();
    useProjectStore.getState().setAnalyzing(false);
  }), [stopWorker]);

  useEffect(() => () => {
    stopWorker();
    clearActiveAnalysisRequest(guardRef.current);
  }, [stopWorker]);

  const run = useCallback((kind: AnalysisKind) => {
    const store = useProjectStore.getState();
    if (store.isAnalyzing) return;

    const reportError = (run: ActiveRun, error: AnalysisError) => {
      const { setAnalysisResult, setEigenError } = useProjectStore.getState();
      if (run.kind === 'static') setAnalysisResult({ type: 'analyze-error', error });
      else setEigenError(run.kind, error);
    };

    if (!workerRef.current) {
      const worker = new Worker(
        new URL('../worker/analysis.worker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        // Never accept a response from a replaced worker or a stale request.
        if (workerRef.current !== worker) return;
        if (!completeAnalysisRequest(guardRef.current, response.requestId)) return;
        const activeRun = activeRunRef.current;
        activeRunRef.current = null;
        const projectStore = useProjectStore.getState();
        if (response.type === 'analyze-canceled' || !activeRun) {
          projectStore.setAnalyzing(false);
        } else if (response.type === 'analyze-all-success') {
          projectStore.setAnalysisResult(toStaticOutcome(response));
        } else if (response.type === 'modal-success') {
          projectStore.setModalResult(toStoredModalResult(response, activeRun.model));
          if (response.modes.length > 0) useViewStore.getState().showModeShape({ kind: 'modal', index: 0 });
        } else if (response.type === 'buckling-success') {
          projectStore.setBucklingResult(toStoredBucklingResult(response, activeRun.model));
          if (response.modes.length > 0) useViewStore.getState().showModeShape({ kind: 'buckling', index: 0 });
        } else {
          reportError(activeRun, response.error);
        }
      };
      worker.onerror = () => {
        if (workerRef.current !== worker) return;
        const requestId = getActiveAnalysisRequestId(guardRef.current);
        if (!requestId || !completeAnalysisRequest(guardRef.current, requestId)) return;
        const activeRun = activeRunRef.current;
        stopWorker();
        if (!activeRun) {
          useProjectStore.getState().setAnalyzing(false);
          return;
        }
        const message = translations[useI18nStore.getState().lang]['app.workerCrash'];
        reportError(activeRun, { type: 'numerical', message });
      };
    }

    store.setAnalyzing(true);
    const requestId = `analysis-${Date.now()}-${++requestSequenceRef.current}`;
    const model = store.model;
    const { eigenModeCount, eigenDivisions } = useViewStore.getState();
    const options = { modeCount: eigenModeCount, divisions: eigenDivisions };
    const request: AnalysisExecutionRequest = kind === 'modal'
      ? { type: 'analyze-modal', requestId, model, options }
      : kind === 'buckling'
        ? { type: 'analyze-buckling', requestId, model, options }
        : { type: 'analyze-all', requestId, model };
    if (kind !== 'static') useViewStore.getState().setResultsTab(kind);
    beginAnalysisRequest(guardRef.current, requestId);
    activeRunRef.current = { kind, model };
    workerRef.current.postMessage(request);
  }, [stopWorker]);

  const cancel = useCallback(() => {
    const requestId = clearActiveAnalysisRequest(guardRef.current);
    if (requestId) workerRef.current?.postMessage({ type: 'cancel', requestId });
    stopWorker();
    useProjectStore.getState().setAnalyzing(false);
  }, [stopWorker]);

  return { run, cancel };
}
