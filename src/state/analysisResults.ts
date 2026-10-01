import type { AnalysisError, AnalysisResult, ProjectModel } from '../core/model/types';
import type {
  AnalyzeAllSuccess,
  BucklingSuccess,
  ModalSuccess,
  SerializedBucklingResults,
  SerializedComponentEnvelope,
  SerializedModeShape,
  SerializedModalResults,
  SerializedStaticResults,
  SerializedTargetResult,
} from '../worker/protocol';

// The store keeps plain number arrays so results stay trivially comparable
// and serializable; the worker hands over transferable typed arrays.
export type StoredTargetResult = SerializedTargetResult<number[]>;
export type StoredEnvelope = SerializedStaticResults<number[]>['envelope'];
export type StoredModeShape = SerializedModeShape<number[]>;

/** Outcome of a static analysis as consumed by `setAnalysisResult`. */
export type StaticAnalysisOutcome =
  | ({ type: 'analyze-all-success' } & SerializedStaticResults<number[]>)
  | { type: 'analyze-error'; error: AnalysisError };

/** Results tied to the exact model object they were computed from. */
interface ModelBound {
  sourceModel: ProjectModel;
}

export type StoredModalResult = SerializedModalResults<number[]> & ModelBound;
export type StoredBucklingResult = SerializedBucklingResults<number[]> & ModelBound;

export type EigenAnalysisKind = 'modal' | 'buckling';

/** Failure of an eigen analysis, bound to the model it was attempted on. */
export interface StoredEigenError extends ModelBound {
  error: AnalysisError;
}
export type StoredEigenErrors = Record<EigenAnalysisKind, StoredEigenError | null>;
export const NO_EIGEN_ERRORS: StoredEigenErrors = { modal: null, buckling: null };

function plainRecord(values: Record<string, Float64Array>): Record<string, number[]> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, Array.from(value)]),
  );
}

function plainEnvelope(
  component: SerializedComponentEnvelope<Float64Array>,
): SerializedComponentEnvelope<number[]> {
  return {
    min: Array.from(component.min),
    max: Array.from(component.max),
    minTargetIds: component.minTargetIds,
    maxTargetIds: component.maxTargetIds,
  };
}

function plainShape(shape: SerializedModeShape<Float64Array>): StoredModeShape {
  return { displacements: Array.from(shape.displacements), diagrams: shape.diagrams };
}

export function toStaticOutcome(response: AnalyzeAllSuccess): StaticAnalysisOutcome {
  return {
    type: 'analyze-all-success',
    results: response.results.map((result) => ({
      target: result.target,
      displacements: Array.from(result.displacements),
      reactions: Array.from(result.reactions),
      elementEndForces: plainRecord(result.elementEndForces),
      diagrams: result.diagrams,
      warnings: result.warnings,
    })),
    envelope: {
      displacements: plainEnvelope(response.envelope.displacements),
      reactions: plainEnvelope(response.envelope.reactions),
      elementEndForces: Object.fromEntries(
        Object.entries(response.envelope.elementEndForces)
          .map(([memberId, component]) => [memberId, plainEnvelope(component)]),
      ),
    },
    factorizationCount: response.factorizationCount,
  };
}

export function toStoredModalResult(
  response: ModalSuccess,
  sourceModel: ProjectModel,
): StoredModalResult {
  return {
    modes: response.modes.map((mode) => ({ ...mode, shape: plainShape(mode.shape) })),
    totalMass: response.totalMass,
    divisions: response.divisions,
    freeDofCount: response.freeDofCount,
    warnings: response.warnings,
    sourceModel,
  };
}

export function toStoredBucklingResult(
  response: BucklingSuccess,
  sourceModel: ProjectModel,
): StoredBucklingResult {
  return {
    modes: response.modes.map((mode) => ({ ...mode, shape: plainShape(mode.shape) })),
    target: response.target,
    divisions: response.divisions,
    freeDofCount: response.freeDofCount,
    warnings: response.warnings,
    sourceModel,
  };
}

/** Present a mode shape through the renderer's static-result interface. */
export function modeShapeAsResult(shape: StoredModeShape): AnalysisResult {
  return {
    displacements: shape.displacements,
    reactions: [],
    elementEndForces: {},
    diagrams: shape.diagrams,
    warnings: [],
  };
}

export function targetResultToAnalysisResult(result: StoredTargetResult): AnalysisResult {
  return {
    displacements: result.displacements,
    reactions: result.reactions,
    elementEndForces: result.elementEndForces,
    diagrams: result.diagrams,
    warnings: result.warnings,
  };
}
