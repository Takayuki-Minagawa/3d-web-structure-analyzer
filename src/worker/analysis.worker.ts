import type {
  AnalysisExecutionRequest,
  AnalyzeCanceled,
  WorkerRequest,
  WorkerResponse,
} from './protocol';
import { createAnalysisResponse } from './analysisRequestHandler';

type WorkerPostTarget = {
  postMessage(message: WorkerResponse, transferables?: Transferable[]): void;
};

const workerTarget = self as unknown as WorkerPostTarget;
const pendingRequests = new Map<string, ReturnType<typeof setTimeout>>();

function runRequest(request: AnalysisExecutionRequest): void {
  pendingRequests.delete(request.requestId);
  const envelope = createAnalysisResponse(request);
  workerTarget.postMessage(envelope.response, envelope.transferables);
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.type === 'cancel') {
    const pending = pendingRequests.get(request.requestId);
    if (!pending) return;
    clearTimeout(pending);
    pendingRequests.delete(request.requestId);
    const response: AnalyzeCanceled = {
      type: 'analyze-canceled',
      requestId: request.requestId,
    };
    workerTarget.postMessage(response);
    return;
  }

  // Deferring the work creates a cancellable queued state. Once the
  // synchronous numerical solve starts, clients that require hard
  // cancellation should terminate and recreate the worker.
  const existing = pendingRequests.get(request.requestId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => runRequest(request), 0);
  pendingRequests.set(request.requestId, timer);
};
