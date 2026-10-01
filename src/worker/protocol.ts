import type {
  ProjectModel,
  AnalysisError,
  DiagramPoint,
  AnalysisTarget,
  BucklingMode,
  DirectionTriple,
  EigenAnalysisOptions,
  ModalMode,
} from '../core/model/types';

export type WorkerRequestId = string;

interface AnalysisRequestBase {
  /** Correlates the response; responses without a matching id are ignored. */
  requestId: WorkerRequestId;
  model: ProjectModel;
}

/** Static analysis of every load case and combination. */
export interface AnalyzeAllRequest extends AnalysisRequestBase {
  type: 'analyze-all';
}

export interface AnalyzeModalRequest extends AnalysisRequestBase {
  type: 'analyze-modal';
  options?: EigenAnalysisOptions;
}

export interface AnalyzeBucklingRequest extends AnalysisRequestBase {
  type: 'analyze-buckling';
  options?: EigenAnalysisOptions & { targetId?: string };
}

export interface CancelRequest {
  type: 'cancel';
  requestId: WorkerRequestId;
}

export type AnalysisExecutionRequest =
  | AnalyzeAllRequest
  | AnalyzeModalRequest
  | AnalyzeBucklingRequest;
export type AnalysisKind = 'static' | 'modal' | 'buckling';
export type WorkerRequest = AnalysisExecutionRequest | CancelRequest;

/** Numeric payloads cross the worker boundary as transferable typed arrays. */
type NumericArray = number[] | Float64Array;

export type SerializedDiagrams = Record<string, { memberId: string; points: DiagramPoint[] }>;

export interface SerializedTargetResult<TArray extends NumericArray> {
  target: AnalysisTarget;
  displacements: TArray;
  reactions: TArray;
  elementEndForces: Record<string, TArray>;
  diagrams: SerializedDiagrams;
  warnings: string[];
}

export interface SerializedComponentEnvelope<TArray extends NumericArray> {
  min: TArray;
  max: TArray;
  minTargetIds: string[];
  maxTargetIds: string[];
}

export interface SerializedAnalysisEnvelope<TArray extends NumericArray> {
  displacements: SerializedComponentEnvelope<TArray>;
  reactions: SerializedComponentEnvelope<TArray>;
  elementEndForces: Record<string, SerializedComponentEnvelope<TArray>>;
}

export interface SerializedStaticResults<TArray extends NumericArray> {
  results: Array<SerializedTargetResult<TArray>>;
  envelope: SerializedAnalysisEnvelope<TArray>;
  factorizationCount: number;
}

export interface SerializedModeShape<TArray extends NumericArray> {
  displacements: TArray;
  diagrams: SerializedDiagrams;
}

export type SerializedModalMode<TArray extends NumericArray> =
  Omit<ModalMode, 'shape'> & { shape: SerializedModeShape<TArray> };
export type SerializedBucklingMode<TArray extends NumericArray> =
  Omit<BucklingMode, 'shape'> & { shape: SerializedModeShape<TArray> };

export interface SerializedModalResults<TArray extends NumericArray> {
  modes: Array<SerializedModalMode<TArray>>;
  totalMass: DirectionTriple;
  divisions: number;
  freeDofCount: number;
  warnings: string[];
}

export interface SerializedBucklingResults<TArray extends NumericArray> {
  modes: Array<SerializedBucklingMode<TArray>>;
  target: AnalysisTarget;
  divisions: number;
  freeDofCount: number;
  warnings: string[];
}

export interface AnalyzeAllSuccess extends SerializedStaticResults<Float64Array> {
  type: 'analyze-all-success';
  requestId: WorkerRequestId;
}

export interface ModalSuccess extends SerializedModalResults<Float64Array> {
  type: 'modal-success';
  requestId: WorkerRequestId;
}

export interface BucklingSuccess extends SerializedBucklingResults<Float64Array> {
  type: 'buckling-success';
  requestId: WorkerRequestId;
}

export interface AnalyzeError {
  type: 'analyze-error';
  requestId: WorkerRequestId;
  error: AnalysisError;
}

export interface AnalyzeCanceled {
  type: 'analyze-canceled';
  requestId: WorkerRequestId;
}

export type WorkerResponse =
  | AnalyzeAllSuccess
  | ModalSuccess
  | BucklingSuccess
  | AnalyzeError
  | AnalyzeCanceled;
