import type { WorkerRequest, WorkerResponse } from './protocol';
import type { AnalysisError } from '../core/model/types';
import { buildIndexedModel } from '../core/model/indexing';
import { validateModel } from '../core/model/validation';
import { analyzeFrame } from '../core/analysis/analyzeFrame';

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  if (req.type === 'analyze') {
    try {
      // Validate
      const errors = validateModel(req.model);
      if (errors.length > 0) {
        const firstError = errors[0]!;
        const resp: WorkerResponse = {
          type: 'analyze-error',
          error: firstError,
        };
        self.postMessage(resp);
        return;
      }

      // Index
      const indexed = buildIndexedModel(req.model);

      // Analyze
      const result = analyzeFrame({ model: indexed });

      // Serialize Maps to plain objects for postMessage
      const elementEndForces: Record<string, number[]> = {};
      result.elementEndForces.forEach((v, k) => {
        elementEndForces[k] = Array.from(v);
      });

      const diagrams: Record<string, { memberId: string; points: import('../core/model/types').DiagramPoint[] }> = {};
      result.diagrams.forEach((v, k) => {
        diagrams[k] = { memberId: v.memberId, points: v.points };
      });

      const resp: WorkerResponse = {
        type: 'analyze-success',
        displacements: Array.from(result.displacements),
        reactions: Array.from(result.reactions),
        elementEndForces,
        diagrams,
        warnings: result.warnings,
      };
      self.postMessage(resp);
    } catch (err) {
      const analysisErr = err as AnalysisError & Error;
      const error: AnalysisError = {
        type: analysisErr.type ?? 'numerical',
        message: analysisErr.message ?? 'An unknown error occurred during analysis.',
      };
      if (analysisErr.elementId !== undefined) error.elementId = analysisErr.elementId;
      if (analysisErr.nodeId !== undefined) error.nodeId = analysisErr.nodeId;
      if (analysisErr.diagnostics !== undefined) error.diagnostics = analysisErr.diagnostics;
      const resp: WorkerResponse = {
        type: 'analyze-error',
        error,
      };
      self.postMessage(resp);
    }
  }
};
