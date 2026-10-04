import type { AnalysisOutput, IndexedModel } from '../model/types';
import { dofValues } from '../model/restraints';
import { assembleGlobalStiffness } from './assembly';
import { buildGlobalForceVector, groupMemberLoadsByMember } from './loads';
import { partitionDofs, extractFreeSystem } from './constraints';
import {
  factorLDLt,
  SingularMatrixError,
  solveLDLtWithFactor,
  type LDLtFactorization,
} from './solverDense';
import { computeReactions, computeAllElementEndForces } from './recover';
import { generateAllDiagrams } from './diagrams';
import { createSingularStabilityDiagnostics } from './stabilityDiagnostics';
import { createAnalysisException, type AnalysisErrorDetails } from './analysisError';

/** Two dense 3600 × 3600 matrices use about 198 MiB before result storage. */
export const MAX_STATIC_TOTAL_DOFS = 3600;
const MAX_TRANSLATION_LENGTH_RATIO = 100;
const MAX_ROTATION_RADIANS = 100;

function assertFiniteValues(
  values: Iterable<number>,
  quantity: string,
  details: AnalysisErrorDetails = {}
): void {
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw createAnalysisException(
        'numerical',
        `${quantity}の計算結果が有限値ではありません。荷重・剛性・単位系の値が大きすぎるか小さすぎないか確認してください。`,
        details
      );
    }
  }
}

/**
 * Stiffness-side state shared by every load set of one structural model:
 * the assembled matrix, the DOF partition and the factorized free block.
 */
export interface StaticSystem {
  K: Float64Array;
  freeDofs: number[];
  fixedDofs: number[];
  /** Null when the model has no free DOF. */
  factorization: LDLtFactorization | null;
}

/**
 * Assemble and factor the stiffness matrix once. Throws a `singular`
 * AnalysisException carrying stability diagnostics for unstable models.
 */
export function prepareStaticSystem(model: IndexedModel): StaticSystem {
  if (model.dofCount > MAX_STATIC_TOTAL_DOFS) {
    throw createAnalysisException(
      'validation',
      `静的解析の全体自由度数 ${model.dofCount} が上限 ${MAX_STATIC_TOTAL_DOFS} を超えています。密行列のメモリ使用量を抑えるため、節点数を ${MAX_STATIC_TOTAL_DOFS / 6} 以下に減らしてください。`
    );
  }
  const K = assembleGlobalStiffness(model);
  const { freeDofs, fixedDofs } = partitionDofs(model);
  if (freeDofs.length === 0) return { K, freeDofs, fixedDofs, factorization: null };

  const { Kff } = extractFreeSystem(
    K,
    new Float64Array(model.dofCount),
    freeDofs,
    model.dofCount
  );
  try {
    const factorization = factorLDLt(Kff, freeDofs.length);
    return { K, freeDofs, fixedDofs, factorization };
  } catch (error) {
    const diagnostics = error instanceof SingularMatrixError
      ? createSingularStabilityDiagnostics(model, K, freeDofs, error.pivotIndex)
      : createSingularStabilityDiagnostics(model, K, freeDofs);
    throw createAnalysisException(
      'singular',
      error instanceof Error
        ? error.message
        : '剛性マトリクスが特異です。拘束条件を確認してください。',
      { diagnostics }
    );
  }
}

/** Relative tolerance for two coupled supports prescribing the same movement. */
const PRESCRIBED_AGREEMENT_TOLERANCE = 1e-9;
/** Sums below this fraction of their largest term are cancellation round-off. */
const PRESCRIBED_CANCELLATION_TOLERANCE = 1e-12;

/**
 * Collect prescribed displacements into a full-length vector addressed by
 * effective (coupling-resolved) DOF. Returns null when nothing is prescribed.
 *
 * Each load case is resolved on its own: entries on the same nodal DOF add
 * up, while DOFs of different nodes that are coupled together share one
 * displacement, so their prescriptions must agree rather than add. The
 * per-case values are then superposed, which keeps a load combination equal
 * to the factored sum of its cases (combination entries keep their case id).
 */
export function buildPrescribedDisplacementVector(
  model: IndexedModel,
  fixedDofs: readonly number[]
): Float64Array | null {
  if (model.prescribedDisplacements.length === 0) return null;
  const isFixed = new Uint8Array(model.dofCount);
  for (const dof of fixedDofs) isFixed[dof] = 1;

  interface SourceEntry { value: number; largestTerm: number; nodeId: string; id: string }
  const byCase = new Map<string, Map<number, SourceEntry>>();
  for (const item of model.prescribedDisplacements) {
    const nodeIndex = model.nodeIdToIndex.get(item.nodeId);
    if (nodeIndex === undefined) continue;
    const caseKey = item.loadCaseId ?? '';
    let bySourceDof = byCase.get(caseKey);
    if (!bySourceDof) {
      bySourceDof = new Map();
      byCase.set(caseKey, bySourceDof);
    }
    const values = dofValues(item);
    assertFiniteValues(values, '強制変位', { nodeId: item.nodeId });
    for (let localDof = 0; localDof < 6; localDof++) {
      const value = values[localDof]!;
      if (value === 0) continue;
      const sourceDof = nodeIndex * 6 + localDof;
      if (!isFixed[model.dofMap[sourceDof]!]) {
        throw createAnalysisException(
          'validation',
          `強制変位 ${sourceId(item.id)} は拘束されていない自由度に指定されています。`,
          { nodeId: item.nodeId }
        );
      }
      const entry = bySourceDof.get(sourceDof);
      if (entry) {
        entry.value += value;
        entry.largestTerm = Math.max(entry.largestTerm, Math.abs(value));
      } else {
        bySourceDof.set(sourceDof, {
          value, largestTerm: Math.abs(value), nodeId: item.nodeId, id: item.id,
        });
      }
    }
  }

  const prescribed = new Float64Array(model.dofCount);
  for (const bySourceDof of byCase.values()) {
    const assigned = new Map<number, SourceEntry>();
    for (const [sourceDof, entry] of bySourceDof) {
      assertFiniteValues([entry.value], '強制変位の合計', { nodeId: entry.nodeId });
      if (Math.abs(entry.value) <= entry.largestTerm * PRESCRIBED_CANCELLATION_TOLERANCE) continue;
      const dof = model.dofMap[sourceDof]!;
      const previous = assigned.get(dof);
      if (!previous) {
        assigned.set(dof, entry);
        prescribed[dof] = prescribed[dof]! + entry.value;
        continue;
      }
      const scale = Math.max(Math.abs(previous.value), Math.abs(entry.value));
      if (Math.abs(previous.value - entry.value) > scale * PRESCRIBED_AGREEMENT_TOLERANCE) {
        throw createAnalysisException(
          'validation',
          `強制変位 ${sourceId(previous.id)} と ${sourceId(entry.id)} は同一変位カップリングで連成された自由度に、同じ荷重ケース内で異なる値を指定しています。`,
          { nodeId: entry.nodeId }
        );
      }
    }
  }
  assertFiniteValues(prescribed, '強制変位の合計');
  return prescribed;
}

/** Id of the user's entry behind a combination-scaled copy (`id@case*factor`). */
function sourceId(id: string): string {
  const separator = id.indexOf('@');
  return separator > 0 ? id.slice(0, separator) : id;
}

/**
 * Solve one load set against a prepared system. `loadModel` must share the
 * structure of the model the system was prepared from; only its loads and
 * prescribed displacements may differ.
 */
export function solveStaticLoadSet(
  system: StaticSystem,
  loadModel: IndexedModel
): AnalysisOutput {
  const { K, freeDofs, fixedDofs, factorization } = system;
  const n = loadModel.dofCount;
  const F = buildGlobalForceVector(loadModel);
  assertFiniteValues(F, '荷重ベクトル');
  const d = new Float64Array(n);

  const prescribed = buildPrescribedDisplacementVector(loadModel, fixedDofs);
  const movedDofs: number[] = [];
  if (prescribed) {
    for (const dof of fixedDofs) {
      if (prescribed[dof] === 0) continue;
      d[dof] = prescribed[dof]!;
      movedDofs.push(dof);
    }
  }

  if (factorization) {
    // K_ff d_f = F_f - K_fc d_c
    const rhs = new Float64Array(freeDofs.length);
    for (let i = 0; i < freeDofs.length; i++) {
      const row = freeDofs[i]! * n;
      let value = F[freeDofs[i]!]!;
      for (const dof of movedDofs) value -= K[row + dof]! * d[dof]!;
      rhs[i] = value;
    }
    const df = solveLDLtWithFactor(factorization, rhs);
    for (let i = 0; i < freeDofs.length; i++) d[freeDofs[i]!] = df[i]!;
  }

  return completeAnalysisOutput(loadModel, K, F, d, fixedDofs);
}

/** Complete recovery for a solved displacement vector and prepared K/F pair. */
export function completeAnalysisOutput(
  model: IndexedModel,
  K: Float64Array,
  F: Float64Array,
  d: Float64Array,
  fixedDofs: number[],
  warnings: string[] = []
): AnalysisOutput {
  assertFiniteValues(d, '節点変位');
  const { dofMap } = model;
  for (let i = 0; i < model.dofCount; i++) {
    if (dofMap[i] !== i) d[i] = d[dofMap[i]!]!;
  }

  const reactions = computeReactions(
    K,
    d,
    F,
    model.dofCount,
    fixedDofs,
    model.nodeSprings,
    model.dofMap
  );
  assertFiniteValues(reactions, '反力');
  const memberLoadsByMember = groupMemberLoadsByMember(model.memberLoads);
  const elementEndForces = computeAllElementEndForces(model, d, memberLoadsByMember);
  for (const [elementId, forces] of elementEndForces) {
    assertFiniteValues(forces, '部材端力', { elementId });
  }
  const diagrams = generateAllDiagrams(model, elementEndForces, d, memberLoadsByMember);
  for (const [elementId, diagram] of diagrams) {
    for (const point of diagram.points) {
      assertFiniteValues(Object.values(point), '断面力・変位図', { elementId });
    }
  }
  appendDisplacementWarnings(model, d, warnings);

  return { displacements: d, reactions, elementEndForces, diagrams, warnings };
}

function appendDisplacementWarnings(
  model: IndexedModel,
  displacements: Float64Array,
  warnings: string[]
): void {
  let representativeLength = 0;
  for (const member of model.members) {
    representativeLength = Math.max(representativeLength, member.L);
  }
  for (let dof = 0; dof < displacements.length; dof++) {
    const value = Math.abs(displacements[dof]!);
    const localDof = dof % 6;
    const excessive = localDof < 3
      ? representativeLength > 0 && value / representativeLength > MAX_TRANSLATION_LENGTH_RATIO
      : value > MAX_ROTATION_RADIANS;
    if (!excessive) continue;
    const relative = localDof < 3
      ? `、代表長さ比 ${(value / representativeLength).toExponential(3)}`
      : '';
    warnings.push(
      `自由度 ${dof} の変位がモデル寸法に対して非常に大きくなっています (${displacements[dof]!.toExponential(3)}${relative})。モデルを確認してください。`
    );
    break;
  }
}
