import type {
  AnalysisTarget,
  AnalysisTargetResult,
  ComponentEnvelope,
  IndexedModel,
  MemberId,
  MultiTargetAnalysisOutput,
  ProjectModel,
} from '../model/types';
import { buildIndexedModel } from '../model/indexing';
import { validateModel } from '../model/validation';
import { getAnalysisTargets, resolveLoadTargetModel } from '../model/loadCases';
import { toAnalysisException } from './analysisError';
import { prepareStaticSystem, solveStaticLoadSet } from './staticSolver';

/** Swap the load-carrying fields of an indexed model for one analysis target. */
export function indexedModelForTarget(
  base: IndexedModel,
  source: ProjectModel,
  target: AnalysisTarget
): IndexedModel {
  const targetModel = resolveLoadTargetModel(source, target);
  return {
    ...base,
    nodalLoads: targetModel.nodalLoads,
    memberLoads: targetModel.memberLoads,
    prescribedDisplacements: targetModel.prescribedDisplacements ?? [],
  };
}

function createEnvelope(
  arrays: readonly Float64Array[],
  targetIds: readonly string[],
  length: number
): ComponentEnvelope {
  const min = new Float64Array(length);
  const max = new Float64Array(length);
  const minTargetIds = new Array<string>(length).fill('');
  const maxTargetIds = new Array<string>(length).fill('');
  if (arrays.length === 0) return { min, max, minTargetIds, maxTargetIds };

  for (let component = 0; component < length; component++) {
    let minimum = arrays[0]![component]!;
    let maximum = minimum;
    let minimumTarget = targetIds[0]!;
    let maximumTarget = minimumTarget;
    for (let targetIndex = 1; targetIndex < arrays.length; targetIndex++) {
      const value = arrays[targetIndex]![component]!;
      if (value < minimum) {
        minimum = value;
        minimumTarget = targetIds[targetIndex]!;
      }
      if (value > maximum) {
        maximum = value;
        maximumTarget = targetIds[targetIndex]!;
      }
    }
    min[component] = minimum;
    max[component] = maximum;
    minTargetIds[component] = minimumTarget;
    maxTargetIds[component] = maximumTarget;
  }
  return { min, max, minTargetIds, maxTargetIds };
}

/**
 * Analyze all load cases and combinations while assembling and factoring the
 * stiffness matrix once. Results remain available per target and as a
 * component-wise minimum/maximum envelope.
 */
export function analyzeAllLoadTargets(model: ProjectModel): MultiTargetAnalysisOutput {
  const validationError = validateModel(model)[0];
  if (validationError) throw toAnalysisException(validationError);

  const indexed = buildIndexedModel(model);
  const system = prepareStaticSystem(indexed);
  const results: AnalysisTargetResult[] = getAnalysisTargets(model).map((target) => ({
    ...solveStaticLoadSet(system, indexedModelForTarget(indexed, model, target)),
    target,
  }));

  const targetIds = results.map((result) => result.target.id);
  const elementEndForces = new Map<MemberId, ComponentEnvelope>();
  for (const member of indexed.members) {
    const arrays = results.map((result) => result.elementEndForces.get(member.id) ?? new Float64Array(12));
    elementEndForces.set(member.id, createEnvelope(arrays, targetIds, 12));
  }

  return {
    results,
    envelope: {
      displacements: createEnvelope(
        results.map((result) => result.displacements),
        targetIds,
        indexed.dofCount
      ),
      reactions: createEnvelope(
        results.map((result) => result.reactions),
        targetIds,
        indexed.dofCount
      ),
      elementEndForces,
    },
    factorizationCount: system.factorization ? 1 : 0,
  };
}
