import type { ProjectModel } from './model/types';
import { getAnalysisMode, getEffectiveRestraint } from './model/analysisMode';
import { getTorsionRestraintSourceDofs } from './model/torsionRestraint';
import { findCouplingIssues, resolveDofMap } from './model/couplings';
import { dofValues } from './model/restraints';

export interface SupportReactionLayout {
  dofMap: Int32Array;
  springStiffnesses: Float64Array;
  rigidOwners: Map<number, number[]>;
  representatives: Map<number, number>;
  hasInvalidCouplings: boolean;
}

/** Physical support owners. A shared rigid reaction cannot be split uniquely. */
export function buildSupportReactionLayout(model: ProjectModel): SupportReactionLayout {
  const nodeIdToIndex = new Map(model.nodes.map((node, index) => [node.id, index]));
  const count = model.nodes.length * 6;
  const hasInvalidCouplings = findCouplingIssues(model).length > 0;
  const dofMap = hasInvalidCouplings
    ? Int32Array.from({ length: count }, (_, index) => index)
    : resolveDofMap(model, nodeIdToIndex);
  const constrained = new Uint8Array(count);
  const mode = getAnalysisMode(model);
  model.nodes.forEach((node, index) => {
    dofValues(getEffectiveRestraint(node.restraint, mode)).forEach((fixed, component) => {
      if (fixed) constrained[index * 6 + component] = 1;
    });
  });
  for (const dof of getTorsionRestraintSourceDofs(model)) {
    if (dof >= 0 && dof < count) constrained[dof] = 1;
  }
  const rigidOwners = new Map<number, number[]>();
  for (let source = 0; source < count; source++) {
    if (!constrained[source]) continue;
    const mapped = dofMap[source]!;
    const owners = rigidOwners.get(mapped) ?? [];
    owners.push(source);
    rigidOwners.set(mapped, owners);
  }
  const representatives = new Map<number, number>();
  for (const [mapped, owners] of rigidOwners) {
    representatives.set(mapped, owners.find((source) => source === mapped) ?? owners[0]!);
  }
  const springStiffnesses = new Float64Array(count);
  for (const spring of model.nodeSprings ?? []) {
    const nodeIndex = nodeIdToIndex.get(spring.nodeId);
    if (nodeIndex === undefined) continue;
    dofValues(spring).forEach((stiffness, component) => {
      const source = nodeIndex * 6 + component;
      springStiffnesses[source] = springStiffnesses[source]! + stiffness;
    });
  }
  return { dofMap, springStiffnesses, rigidOwners, representatives, hasInvalidCouplings };
}

/**
 * Convert solver reactions into a node/DOF-addressed physical support vector.
 * Solver reactions contain both effective-DOF rigid reactions and source-node
 * spring forces. Separate those contributions before relocating rigid forces.
 * Shared rigid reactions are retained once, at a documented representative;
 * every spring contribution stays at its own physical node.
 */
export function buildSupportReactionVector(
  model: ProjectModel,
  reactions: ArrayLike<number>,
  displacements: ArrayLike<number>,
  layout = buildSupportReactionLayout(model),
): Float64Array {
  const values = new Float64Array(model.nodes.length * 6);
  for (let source = 0; source < values.length; source++) {
    values[source] = -layout.springStiffnesses[source]! * (displacements[layout.dofMap[source]!] ?? 0);
  }
  for (const [mapped, representative] of layout.representatives) {
    const rigidReaction = (reactions[mapped] ?? 0) - values[mapped]!;
    values[representative] = values[representative]! + rigidReaction;
  }
  return values;
}

export type ReactionCell = {
  value: number | null;
  isShared: boolean;
  isRepresentative: boolean;
};
export type ReactionRow = { nodeId: string; cells: ReactionCell[] };

/** Use the same support mask and sharing convention for results and envelopes. */
export function buildPhysicalSupportReactionRows(
  model: ProjectModel,
  supportReactions: ArrayLike<number>,
  layout = buildSupportReactionLayout(model),
): { rows: ReactionRow[]; hasSharedReactions: boolean; hasInvalidCouplings: boolean } {
  const rows: ReactionRow[] = [];
  model.nodes.forEach((node, index) => {
    let hasAny = false;
    const cells = Array.from({ length: 6 }, (_, component): ReactionCell => {
      const source = index * 6 + component;
      const mapped = layout.dofMap[source]!;
      const owners = layout.rigidOwners.get(mapped) ?? [];
      const isRigid = owners.includes(source);
      const isSpring = layout.springStiffnesses[source]! > 0;
      const isShared = isRigid && owners.length > 1;
      const isRepresentative = isRigid ? layout.representatives.get(mapped) === source : isSpring;
      hasAny ||= isRigid || isSpring;
      return {
        value: isRepresentative || isSpring ? (supportReactions[source] ?? 0) : null,
        isShared,
        isRepresentative,
      };
    });
    if (hasAny) rows.push({ nodeId: node.id, cells });
  });
  return {
    rows,
    hasSharedReactions: [...layout.rigidOwners.values()].some((owners) => owners.length > 1),
    hasInvalidCouplings: layout.hasInvalidCouplings,
  };
}

/**
 * Compatibility with envelopes produced before physical support arrays existed.
 * A mixed spring/master reaction cannot be separated from extrema alone; fail
 * explicitly so clients request a fresh analysis instead of moving spring loads.
 */
export function recoverLegacySupportReactionEnvelope(
  model: ProjectModel,
  envelope: {
    min: ArrayLike<number>; max: ArrayLike<number>;
    minTargetIds: string[]; maxTargetIds: string[];
  },
) {
  const layout = buildSupportReactionLayout(model);
  const sourceIndices = new Int32Array(model.nodes.length * 6).fill(-1);
  for (let source = 0; source < sourceIndices.length; source++) {
    if (layout.springStiffnesses[source]! > 0) sourceIndices[source] = source;
  }
  for (const [mapped, representative] of layout.representatives) {
    if (mapped !== representative && (layout.springStiffnesses[mapped]! > 0 || layout.springStiffnesses[representative]! > 0)) {
      throw new Error('This legacy envelope cannot separate coupled rigid and spring reactions. Run the analysis again.');
    }
    sourceIndices[representative] = mapped;
  }
  return {
    min: Array.from(sourceIndices, (source) => source < 0 ? 0 : envelope.min[source] ?? 0),
    max: Array.from(sourceIndices, (source) => source < 0 ? 0 : envelope.max[source] ?? 0),
    minTargetIds: Array.from(sourceIndices, (source) => source < 0 ? '' : envelope.minTargetIds[source] ?? ''),
    maxTargetIds: Array.from(sourceIndices, (source) => source < 0 ? '' : envelope.maxTargetIds[source] ?? ''),
  };
}
