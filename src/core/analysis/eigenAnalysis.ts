import type {
  AnalysisTarget,
  BucklingAnalysisOutput,
  BucklingMode,
  DiagramPoint,
  DiagramSeries,
  DirectionTriple,
  EigenAnalysisOptions,
  IndexedMember,
  IndexedModel,
  MemberId,
  ModalAnalysisOutput,
  ModalMode,
  ModeShape,
  ProjectModel,
} from '../model/types';
import { buildIndexedModel } from '../model/indexing';
import { getActiveLoadCaseId, getAnalysisTargets } from '../model/loadCases';
import { subdivideMembers, type SubdividedModel } from '../model/subdivide';
import { validateModel } from '../model/validation';
import { createAnalysisException, toAnalysisException } from './analysisError';
import { indexedModelForTarget } from './analyzeLoadTargets';
import { assembleGlobalStiffness, assembleMemberMatrices, getMemberDofs } from './assembly';
import { partitionDofs } from './constraints';
import { interpolateMemberDisplacement } from './diagrams';
import { buildLocalStiffness, buildReleaseTransformation } from './element3dFrame';
import { buildLocalConsistentMass, buildLocalGeometricStiffness } from './elementMatrices';
import { solveInverseGeneralizedEigen, type InverseEigenResult } from './generalizedEigen';
import { SingularMatrixError } from './solverDense';
import { prepareStaticSystem, solveStaticLoadSet } from './staticSolver';
import { buildTransformationMatrix, transformVectorToLocal } from './transforms';

export const DEFAULT_MODE_COUNT = 6;
export const MAX_MODE_COUNT = 30;
/** Dense eigen solves are O(n³); beyond this the worker would stall. */
export const MAX_EIGEN_FREE_DOFS = 1500;
/** Full matrices (free and restrained DOFs) are dense too; this bounds their memory. */
export const MAX_EIGEN_TOTAL_DOFS = 3600;
/** 'auto' subdivision keeps the solve to a couple of seconds. */
const AUTO_DIVISION_DOF_BUDGET = 1000;
const AUTO_DIVISION_CANDIDATES = [4, 2, 1] as const;
const MAX_DIVISIONS = 16;
/** A translation peak this small relative to the rotations is round-off noise. */
const TRANSLATION_NOISE_RATIO = 1e-8;
/** Eigenvalues below this fraction of the spectral radius are numerical noise. */
const RELATIVE_EIGENVALUE_TOLERANCE = 1e-10;
/** Deflection samples per member in a mode shape. */
const SHAPE_SAMPLES_PER_MEMBER = 12;

interface EigenSystem {
  refined: SubdividedModel;
  indexed: IndexedModel;
  K: Float64Array;
  freeDofs: number[];
  divisions: number;
  warnings: string[];
}

function resolveModeCount(options: EigenAnalysisOptions): number {
  const requested = Math.floor(options.modeCount ?? DEFAULT_MODE_COUNT);
  return Math.max(1, Math.min(MAX_MODE_COUNT, Number.isFinite(requested) ? requested : DEFAULT_MODE_COUNT));
}

function assertValidModel(model: ProjectModel): void {
  const validationError = validateModel(model)[0];
  if (validationError) throw toAnalysisException(validationError);
}

interface SubdividedSystem {
  refined: SubdividedModel;
  indexed: IndexedModel;
  freeDofs: number[];
  divisions: number;
}

function subdivideAndIndex(model: ProjectModel, divisions: number): SubdividedSystem {
  const refined = subdivideMembers(model, divisions);
  const indexed = buildIndexedModel(refined.model);
  return { refined, indexed, freeDofs: partitionDofs(indexed).freeDofs, divisions };
}

/**
 * Subdivide as requested. 'auto' takes the finest candidate whose actual
 * free-DOF count fits the time budget, so restraints and 2D modes count.
 */
function subdivideForEigen(model: ProjectModel, options: EigenAnalysisOptions): SubdividedSystem {
  const requested = options.divisions ?? 'auto';
  if (requested !== 'auto') {
    const divisions = Number.isFinite(requested)
      ? Math.max(1, Math.min(MAX_DIVISIONS, Math.floor(requested)))
      : 1;
    return subdivideAndIndex(model, divisions);
  }
  let system: SubdividedSystem | null = null;
  for (const divisions of AUTO_DIVISION_CANDIDATES) {
    system = subdivideAndIndex(model, divisions);
    if (system.freeDofs.length <= AUTO_DIVISION_DOF_BUDGET) break;
  }
  return system!;
}

/** Validate sizes and assemble the stiffness side of an eigenproblem. */
function prepareEigenSystem(model: ProjectModel, options: EigenAnalysisOptions): EigenSystem {
  const { refined, indexed, freeDofs, divisions } = subdivideForEigen(model, options);
  if (freeDofs.length === 0) {
    throw createAnalysisException('validation', '自由な自由度がないため固有値解析を実行できません。');
  }
  // Checked before any dense matrix is allocated.
  if (freeDofs.length > MAX_EIGEN_FREE_DOFS || indexed.dofCount > MAX_EIGEN_TOTAL_DOFS) {
    const advice = divisions > 1
      ? '部材分割数を減らしてください。'
      : 'この規模のモデルの固有値・座屈解析には対応していません。';
    throw createAnalysisException(
      'validation',
      `固有値解析の自由度数（自由 ${freeDofs.length} / 全体 ${indexed.dofCount}）が上限（自由 ${MAX_EIGEN_FREE_DOFS} / 全体 ${MAX_EIGEN_TOTAL_DOFS}）を超えています。${advice}`
    );
  }
  const warnings: string[] = [];
  const undivided = [...refined.divisionsByMember.values()].filter((count) => count < divisions).length;
  if (undivided > 0) {
    warnings.push(
      `ねじり定数 Ix が 0 の部材 ${undivided} 本は分割せずに解析しました（部材内の局所モードは表現されません）。`
    );
  }
  if (divisions === 1 && (options.divisions ?? 'auto') === 'auto') {
    warnings.push(
      'モデル規模が大きいため部材を分割せずに解析しました。部材内の局所的な振動・座屈モードは表現されず、座屈荷重係数を過大評価することがあります。'
    );
  }
  const K = assembleGlobalStiffness(indexed);
  return { refined, indexed, K, freeDofs, divisions, warnings };
}

function extractFreeBlock(matrix: Float64Array, freeDofs: readonly number[], n: number): Float64Array {
  const size = freeDofs.length;
  const block = new Float64Array(size * size);
  for (let i = 0; i < size; i++) {
    const row = freeDofs[i]! * n;
    for (let j = 0; j < size; j++) block[i * size + j] = matrix[row + freeDofs[j]!]!;
  }
  return block;
}

function solveEigenSystem(system: EigenSystem, B: Float64Array, count: number): InverseEigenResult {
  const size = system.freeDofs.length;
  const Kff = extractFreeBlock(system.K, system.freeDofs, system.indexed.dofCount);
  try {
    return solveInverseGeneralizedEigen(Kff, B, size, Math.min(count, size));
  } catch (error) {
    if (error instanceof SingularMatrixError) {
      // The undivided model was already checked with full diagnostics, so
      // reaching this means the subdivision itself exposed a mechanism.
      throw createAnalysisException(
        'singular',
        '部材分割後の剛性マトリクスが特異です。部材分割数を 1 にして再実行してください。'
      );
    }
    throw error;
  }
}

/**
 * Expand a free-DOF eigenvector into a normalized mode shape on the original
 * model: nodal displacements plus deflection samples along every member.
 */
function buildModeShape(
  system: EigenSystem,
  source: ProjectModel,
  eigen: InverseEigenResult,
  modeIndex: number
): { shape: ModeShape; scale: number } {
  const { indexed, freeDofs, refined } = system;
  const full = new Float64Array(indexed.dofCount);
  const offset = modeIndex * eigen.n;
  for (let i = 0; i < freeDofs.length; i++) full[freeDofs[i]!] = eigen.vectors[offset + i]!;
  for (let dof = 0; dof < indexed.dofCount; dof++) {
    if (indexed.dofMap[dof] !== dof) full[dof] = full[indexed.dofMap[dof]!]!;
  }

  // Normalize so the largest translation is +1 (rotations follow the same
  // scale). A mode without real translation, such as pure torsion, only has
  // round-off noise there and is normalized to a unit peak rotation instead.
  let translationPeak = 0;
  let rotationPeak = 0;
  for (let dof = 0; dof < indexed.dofCount; dof++) {
    const value = full[dof]!;
    if (dof % 6 < 3) {
      if (Math.abs(value) > Math.abs(translationPeak)) translationPeak = value;
    } else if (Math.abs(value) > Math.abs(rotationPeak)) rotationPeak = value;
  }
  let longestMember = 0;
  for (const member of indexed.members) longestMember = Math.max(longestMember, member.L);
  const translationIsNoise =
    Math.abs(translationPeak) <= TRANSLATION_NOISE_RATIO * Math.abs(rotationPeak) * longestMember;
  const peak = translationIsNoise ? rotationPeak : translationPeak;
  const scale = peak === 0 ? 1 : peak;
  for (let dof = 0; dof < indexed.dofCount; dof++) full[dof] = full[dof]! / scale;

  const diagrams = new Map<MemberId, DiagramSeries>();
  for (const member of source.members) {
    const elementIds = refined.segments.get(member.id) ?? [];
    const samples = Math.max(2, Math.ceil(SHAPE_SAMPLES_PER_MEMBER / Math.max(1, elementIds.length)));
    const points: DiagramPoint[] = [];
    let start = 0;
    for (const elementId of elementIds) {
      const elementIndex = indexed.memberIdToIndex.get(elementId);
      if (elementIndex === undefined) continue;
      const element = indexed.members[elementIndex]!;
      const dLocal = memberEndDisplacements(element, full);
      for (let sample = points.length === 0 ? 0 : 1; sample <= samples; sample++) {
        const xi = sample / samples;
        points.push({
          x: start + xi * element.L,
          N: 0, Vy: 0, Vz: 0, Mx: 0, My: 0, Mz: 0,
          ...interpolateMemberDisplacement(element, dLocal, xi),
        });
      }
      start += element.L;
    }
    diagrams.set(member.id, { memberId: member.id, points });
  }

  return {
    shape: { displacements: full.slice(0, source.nodes.length * 6), diagrams },
    scale,
  };
}

/** Local displacements of the member's own ends, honoring end releases. */
function memberEndDisplacements(member: IndexedMember, globalDisplacements: Float64Array): Float64Array {
  const dofs = getMemberDofs(member.ni, member.nj);
  const dGlobal = new Float64Array(12);
  for (let i = 0; i < 12; i++) dGlobal[i] = globalDisplacements[dofs[i]!]!;
  const dLocal = transformVectorToLocal(
    dGlobal,
    member.transformation ?? buildTransformationMatrix(member)
  );
  const release = buildReleaseTransformation(
    member.localStiffness ?? buildLocalStiffness(member),
    member.releases
  );
  return release ? transformVectorToLocal(dLocal, release) : dLocal;
}

function assembleGlobalMass(indexed: IndexedModel, model: ProjectModel): Float64Array {
  const n = indexed.dofCount;
  const M = assembleMemberMatrices(indexed, (member) =>
    (member.density ?? 0) > 0 ? buildLocalConsistentMass(member) : null
  );
  for (const item of model.nodeMasses ?? []) {
    const nodeIndex = indexed.nodeIdToIndex.get(item.nodeId);
    if (nodeIndex === undefined || !(item.mass > 0)) continue;
    for (let direction = 0; direction < 3; direction++) {
      const dof = indexed.dofMap[nodeIndex * 6 + direction]!;
      M[dof * n + dof] = M[dof * n + dof]! + item.mass;
    }
  }
  return M;
}

/**
 * Natural frequencies and mode shapes: K φ = ω² M φ with a consistent mass
 * matrix from the material densities plus lumped nodal masses.
 */
export function analyzeModal(
  model: ProjectModel,
  options: EigenAnalysisOptions = {}
): ModalAnalysisOutput {
  assertValidModel(model);
  const densityById = new Map(model.materials.map((material) => [material.id, material.density ?? 0]));
  const sectionById = new Map(model.sections.map((section) => [section.id, section]));
  const hasMemberMass = model.members.some((member) =>
    (densityById.get(sectionById.get(member.sectionId)?.materialId ?? '') ?? 0) > 0
  );
  const hasNodalMass = (model.nodeMasses ?? []).some((item) => item.mass > 0);
  if (!hasMemberMass && !hasNodalMass) {
    throw createAnalysisException(
      'validation',
      '質量が定義されていません。材料密度または節点質量を設定してください。'
    );
  }
  // Surfaces instability of the model itself with full diagnostics.
  prepareStaticSystem(buildIndexedModel(model));

  const system = prepareEigenSystem(model, options);
  const { indexed, freeDofs } = system;
  const n = indexed.dofCount;
  const size = freeDofs.length;
  const M = assembleGlobalMass(indexed, model);
  const Mff = extractFreeBlock(M, freeDofs, n);
  const eigen = solveEigenSystem(system, Mff, resolveModeCount(options));

  // Total mass and the M r_j products for the three rigid-translation vectors.
  const totalMass: DirectionTriple = [0, 0, 0];
  for (let a = 0; a < n; a++) {
    const direction = a % 6;
    if (direction >= 3) continue;
    for (let b = direction; b < n; b += 6) {
      totalMass[direction] = totalMass[direction]! + M[a * n + b]!;
    }
  }
  const massTimesInfluence = [0, 1, 2].map((direction) => {
    const product = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      let sum = 0;
      for (let j = 0; j < size; j++) {
        if (freeDofs[j]! % 6 === direction) sum += Mff[i * size + j]!;
      }
      product[i] = sum;
    }
    return product;
  });

  const modes: ModalMode[] = [];
  for (let k = 0; k < eigen.values.length; k++) {
    const mu = eigen.values[k]!; // 1 / ω², with φᵀ M φ = μ for K-normalized φ
    if (!(mu > eigen.spectralRadius * RELATIVE_EIGENVALUE_TOLERANCE)) break;
    const omega = 1 / Math.sqrt(mu);
    const { shape, scale } = buildModeShape(system, model, eigen, k);
    const participation: DirectionTriple = [0, 0, 0];
    const effectiveMassRatio: DirectionTriple = [0, 0, 0];
    for (let direction = 0; direction < 3; direction++) {
      let excitation = 0; // φᵀ M r
      const product = massTimesInfluence[direction]!;
      for (let i = 0; i < size; i++) excitation += eigen.vectors[k * size + i]! * product[i]!;
      // Report the factor for the displayed (unit-peak) shape φ / scale.
      participation[direction] = (excitation / mu) * scale;
      effectiveMassRatio[direction] = totalMass[direction]! > 0
        ? (excitation * excitation / mu) / totalMass[direction]!
        : 0;
    }
    modes.push({
      index: modes.length + 1,
      omega,
      frequency: omega / (2 * Math.PI),
      period: (2 * Math.PI) / omega,
      participation,
      effectiveMassRatio,
      shape,
    });
  }

  if (modes.length === 0) {
    throw createAnalysisException(
      'validation',
      '固有モードが見つかりません。質量が拘束されていない自由度に作用しているか確認してください。'
    );
  }

  return {
    modes,
    totalMass,
    divisions: system.divisions,
    freeDofCount: size,
    warnings: system.warnings,
  };
}

/** Axial force (tension positive) at position x of a static member diagram. */
function axialForceAt(points: readonly DiagramPoint[], x: number): number {
  if (points.length === 0) return 0;
  for (let i = 1; i < points.length; i++) {
    const previous = points[i - 1]!;
    const current = points[i]!;
    if (x > current.x) continue;
    const span = current.x - previous.x;
    if (span <= 0) return current.N;
    const ratio = (x - previous.x) / span;
    return previous.N + (current.N - previous.N) * ratio;
  }
  return points[points.length - 1]!.N;
}

function resolveBucklingTarget(model: ProjectModel, targetId: string | undefined): AnalysisTarget {
  const targets = getAnalysisTargets(model);
  // Same precedence as the static path: an explicit target, then the active
  // combination, then the active load case.
  const target = [targetId, model.activeLoadCombinationId, getActiveLoadCaseId(model)]
    .map((id) => targets.find((item) => item.id === id))
    .find((item) => item !== undefined);
  if (!target) throw createAnalysisException('validation', '座屈解析の対象となる荷重ケースがありません。');
  return target;
}

/**
 * Linear (eigenvalue) buckling: (K + λ Kg) φ = 0, where Kg is the geometric
 * stiffness for the axial forces of a linear static analysis of `targetId`
 * (default: the active load case or combination).
 */
export function analyzeBuckling(
  model: ProjectModel,
  options: EigenAnalysisOptions & { targetId?: string } = {}
): BucklingAnalysisOutput {
  assertValidModel(model);
  const target = resolveBucklingTarget(model, options.targetId);
  const baseIndexed = buildIndexedModel(model);
  const reference = solveStaticLoadSet(
    prepareStaticSystem(baseIndexed),
    indexedModelForTarget(baseIndexed, model, target)
  );

  const system = prepareEigenSystem(model, options);
  const { indexed, freeDofs, refined } = system;

  // Each element takes the reference axial force at its own midpoint.
  const axialForces = new Map<MemberId, number>();
  let largestAxialForce = 0;
  for (const member of model.members) {
    const points = reference.diagrams.get(member.id)?.points ?? [];
    let start = 0;
    for (const elementId of refined.segments.get(member.id) ?? []) {
      const elementIndex = indexed.memberIdToIndex.get(elementId);
      if (elementIndex === undefined) continue;
      const element = indexed.members[elementIndex]!;
      const force = axialForceAt(points, start + element.L / 2);
      axialForces.set(elementId, force);
      largestAxialForce = Math.max(largestAxialForce, Math.abs(force));
      start += element.L;
    }
  }
  if (!(largestAxialForce > 0)) {
    throw createAnalysisException(
      'validation',
      `荷重「${target.name}」では部材に軸力が発生していないため、座屈解析を実行できません。`
    );
  }

  const Kg = assembleMemberMatrices(indexed, (member) => {
    const force = axialForces.get(member.id) ?? 0;
    return Math.abs(force) > largestAxialForce * 1e-12
      ? buildLocalGeometricStiffness(member, force)
      : null;
  });
  const B = extractFreeBlock(Kg, freeDofs, indexed.dofCount);
  for (let i = 0; i < B.length; i++) B[i] = -B[i]!;
  const eigen = solveEigenSystem(system, B, resolveModeCount(options));

  // μ = 1/λ: the largest positive μ are the lowest positive load factors.
  // Negative μ belong to buckling under the reversed load and are skipped.
  const modes: BucklingMode[] = [];
  for (let k = 0; k < eigen.values.length; k++) {
    const mu = eigen.values[k]!;
    if (!(mu > eigen.spectralRadius * RELATIVE_EIGENVALUE_TOLERANCE)) break;
    modes.push({
      index: modes.length + 1,
      loadFactor: 1 / mu,
      shape: buildModeShape(system, model, eigen, k).shape,
    });
  }
  if (modes.length === 0) {
    throw createAnalysisException(
      'validation',
      `荷重「${target.name}」では圧縮による座屈モードが見つかりません（部材が引張または無応力です）。`
    );
  }

  return {
    modes,
    target,
    divisions: system.divisions,
    freeDofCount: freeDofs.length,
    warnings: system.warnings,
  };
}
