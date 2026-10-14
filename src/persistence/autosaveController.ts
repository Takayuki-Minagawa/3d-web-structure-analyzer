import type { ProjectModel } from '../core/model/types';

export type AutosavePhase = 'restoring' | 'pending' | 'saving' | 'saved' | 'error';
export interface AutosaveStatus {
  phase: AutosavePhase;
  lastSavedAt?: string;
  error?: string;
}

/** Debounced, serialized writer. Nothing is written until restoration finishes. */
export function createAutosaveController(
  save: (model: ProjectModel) => Promise<void>,
  notify: (status: AutosaveStatus) => void,
  delay = 800,
) {
  let ready = false;
  let disposed = false;
  let pending: ProjectModel | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let lastSavedAt: string | undefined;
  const report = (phase: AutosavePhase, error?: unknown) => {
    if (!disposed) notify({ phase, ...(lastSavedAt ? { lastSavedAt } : {}),
      ...(error !== undefined ? { error: error instanceof Error ? error.message : String(error) } : {}) });
  };
  const flush = (): Promise<void> => {
    clearTimeout(timer);
    if (!ready || disposed) return Promise.resolve();
    if (inFlight) return inFlight.then(() => pending ? flush() : undefined);
    if (!pending) return Promise.resolve();
    const snapshot = pending;
    pending = null;
    report('saving');
    inFlight = save(snapshot).then(() => {
      lastSavedAt = new Date().toISOString();
      report(pending ? 'pending' : 'saved');
    }).catch((error: unknown) => {
      pending ??= snapshot;
      ready = false; // Keep the failed snapshot; retry must be explicit.
      report('error', error);
    }).finally(() => { inFlight = null; });
    return inFlight.then(() => pending && ready ? flush() : undefined);
  };
  return {
    update(model: ProjectModel) {
      pending = model;
      if (!ready || disposed) return;
      clearTimeout(timer);
      report('pending');
      timer = setTimeout(() => void flush(), delay);
    },
    restored() { ready = true; },
    restoreFailed(error: unknown) { ready = false; report('error', error); },
    retry() { ready = true; return flush(); },
    flush,
    hasPending() { return pending !== null || inFlight !== null; },
    dispose() { disposed = true; clearTimeout(timer); },
  };
}
