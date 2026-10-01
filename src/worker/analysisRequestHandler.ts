import type {
  AnalysisError,
  ComponentEnvelope,
  DiagramSeries,
  ModeShape,
} from '../core/model/types';
import { analyzeAllLoadTargets } from '../core/analysis/analyzeLoadTargets';
import { analyzeBuckling, analyzeModal } from '../core/analysis/eigenAnalysis';
import type {
  AnalysisExecutionRequest,
  AnalyzeAllSuccess,
  BucklingSuccess,
  ModalSuccess,
  SerializedDiagrams,
  SerializedModeShape,
  WorkerResponse,
} from './protocol';

export interface AnalysisResponseEnvelope {
  response: WorkerResponse;
  transferables: Transferable[];
}

function serializeDiagrams(diagrams: Map<string, DiagramSeries>): SerializedDiagrams {
  const serialized: SerializedDiagrams = {};
  diagrams.forEach((value, key) => {
    serialized[key] = { memberId: value.memberId, points: value.points };
  });
  return serialized;
}

function mapAnalysisError(errorValue: unknown): AnalysisError {
  if (!errorValue || typeof errorValue !== 'object') {
    return { type: 'numerical', message: String(errorValue || 'An unknown error occurred during analysis.') };
  }
  const source = errorValue as Partial<AnalysisError> & { message?: unknown };
  const error: AnalysisError = {
    type: source.type ?? 'numerical',
    message: typeof source.message === 'string'
      ? source.message
      : 'An unknown error occurred during analysis.',
  };
  if (source.elementId !== undefined) error.elementId = source.elementId;
  if (source.nodeId !== undefined) error.nodeId = source.nodeId;
  if (source.diagnostics !== undefined) error.diagnostics = source.diagnostics;
  return error;
}

/** Collects the buffers of every typed array placed into a response. */
class TransferList {
  readonly buffers: Transferable[] = [];

  add(array: Float64Array): Float64Array {
    this.buffers.push(array.buffer as ArrayBuffer);
    return array;
  }

  envelope(component: ComponentEnvelope): ComponentEnvelope {
    this.add(component.min);
    this.add(component.max);
    return component;
  }

  modeShape(shape: ModeShape): SerializedModeShape<Float64Array> {
    return {
      displacements: this.add(shape.displacements),
      diagrams: serializeDiagrams(shape.diagrams),
    };
  }
}

function analyzeStatic(request: AnalysisExecutionRequest, transfer: TransferList): AnalyzeAllSuccess {
  const result = analyzeAllLoadTargets(request.model);
  const elementEnvelope: AnalyzeAllSuccess['envelope']['elementEndForces'] = {};
  result.envelope.elementEndForces.forEach((component, memberId) => {
    elementEnvelope[memberId] = transfer.envelope(component);
  });
  return {
    type: 'analyze-all-success',
    requestId: request.requestId,
    results: result.results.map((targetResult) => {
      const elementEndForces: Record<string, Float64Array> = {};
      targetResult.elementEndForces.forEach((value, memberId) => {
        elementEndForces[memberId] = transfer.add(value);
      });
      return {
        target: targetResult.target,
        displacements: transfer.add(targetResult.displacements),
        reactions: transfer.add(targetResult.reactions),
        elementEndForces,
        diagrams: serializeDiagrams(targetResult.diagrams),
        warnings: targetResult.warnings,
      };
    }),
    envelope: {
      displacements: transfer.envelope(result.envelope.displacements),
      reactions: transfer.envelope(result.envelope.reactions),
      elementEndForces: elementEnvelope,
    },
    factorizationCount: result.factorizationCount,
  };
}

/** Execute and serialize one analysis request without depending on worker globals. */
export function createAnalysisResponse(
  request: AnalysisExecutionRequest
): AnalysisResponseEnvelope {
  const transfer = new TransferList();
  try {
    let response: WorkerResponse;
    if (request.type === 'analyze-modal') {
      const { modes, ...summary } = analyzeModal(request.model, request.options);
      response = {
        type: 'modal-success',
        requestId: request.requestId,
        ...summary,
        modes: modes.map((mode) => ({ ...mode, shape: transfer.modeShape(mode.shape) })),
      } satisfies ModalSuccess;
    } else if (request.type === 'analyze-buckling') {
      const { modes, ...summary } = analyzeBuckling(request.model, request.options);
      response = {
        type: 'buckling-success',
        requestId: request.requestId,
        ...summary,
        modes: modes.map((mode) => ({ ...mode, shape: transfer.modeShape(mode.shape) })),
      } satisfies BucklingSuccess;
    } else {
      response = analyzeStatic(request, transfer);
    }
    return { response, transferables: transfer.buffers };
  } catch (error) {
    return {
      response: { type: 'analyze-error', requestId: request.requestId, error: mapAnalysisError(error) },
      transferables: [],
    };
  }
}
