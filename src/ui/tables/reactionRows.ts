import type { ProjectModel } from '../../core/model/types';
import { getAnalysisMode, getEffectiveRestraint } from '../../core/model/analysisMode';
import { getTorsionRestraintSourceDofs } from '../../core/model/torsionRestraint';
import { findCouplingIssues, resolveDofMap } from '../../core/model/couplings';
import { dofValues } from '../../core/model/restraints';

export type ReactionCell = {
  value: number | null;
  isShared: boolean;
  isRepresentative: boolean;
};

export type ReactionRow = {
  nodeId: string;
  cells: ReactionCell[];
};

export function buildEffectiveReactionRows(
  model: ProjectModel,
  reactions: number[]
): { rows: ReactionRow[]; hasSharedReactions: boolean; hasInvalidCouplings: boolean } {
  const nodeIdToIndex = new Map(model.nodes.map((n, i) => [n.id, i]));
  const nodeCount = model.nodes.length;
  const dofCount = nodeCount * 6;
  const analysisMode = getAnalysisMode(model);

  // A stale result can briefly coexist with a model that is still being edited.
  // Invalid coupling declarations must not make the results panel throw while
  // rendering that state. Falling back to the identity map is conservative:
  // reactions remain attached to their source nodes, but no invalid coupling is
  // used to combine or reassign them.
  const hasInvalidCouplings = findCouplingIssues(model).length > 0;
  const dofMap = hasInvalidCouplings
    ? Int32Array.from({ length: dofCount }, (_, dof) => dof)
    : resolveDofMap(model, nodeIdToIndex);

  const constrainedSourceDofs = new Uint8Array(dofCount);
  for (let i = 0; i < model.nodes.length; i++) {
    const flags = dofValues(getEffectiveRestraint(model.nodes[i]!.restraint, analysisMode));
    for (let d = 0; d < 6; d++) {
      if (flags[d]) constrainedSourceDofs[i * 6 + d] = 1;
    }
  }
  for (const dof of getTorsionRestraintSourceDofs(model)) {
    if (dof >= 0 && dof < dofCount) constrainedSourceDofs[dof] = 1;
  }

  const ownersByMappedDof = new Map<number, number[]>();
  for (let dof = 0; dof < dofCount; dof++) {
    if (!constrainedSourceDofs[dof]) continue;
    const mappedDof = dofMap[dof]!;
    const owners = ownersByMappedDof.get(mappedDof);
    if (owners) owners.push(dof);
    else ownersByMappedDof.set(mappedDof, [dof]);
  }

  const representativeByMappedDof = new Map<number, number>();
  let hasSharedReactions = false;
  for (const [mappedDof, owners] of ownersByMappedDof) {
    if (owners.length > 1) hasSharedReactions = true;
    const representative = owners.find((dof) => dof === mappedDof) ?? owners[0]!;
    representativeByMappedDof.set(mappedDof, representative);
  }

  const rows: ReactionRow[] = [];
  for (let i = 0; i < model.nodes.length; i++) {
    let hasAny = false;
    const cells: ReactionCell[] = [];
    for (let d = 0; d < 6; d++) {
      const sourceDof = i * 6 + d;
      if (!constrainedSourceDofs[sourceDof]) {
        cells.push({ value: null, isShared: false, isRepresentative: false });
        continue;
      }

      const mappedDof = dofMap[sourceDof]!;
      const owners = ownersByMappedDof.get(mappedDof) ?? [];
      const isShared = owners.length > 1;
      const isRepresentative = representativeByMappedDof.get(mappedDof) === sourceDof;
      cells.push({
        value: !isShared || isRepresentative ? (reactions[mappedDof] ?? 0) : null,
        isShared,
        isRepresentative,
      });
      hasAny = true;
    }
    if (hasAny) rows.push({ nodeId: model.nodes[i]!.id, cells });
  }

  return { rows, hasSharedReactions, hasInvalidCouplings };
}
