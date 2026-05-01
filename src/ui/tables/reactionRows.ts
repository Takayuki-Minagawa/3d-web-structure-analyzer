import type { ProjectModel } from '../../core/model/types';
import { getAnalysisMode, getEffectiveRestraint } from '../../core/model/analysisMode';

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
): { rows: ReactionRow[]; hasSharedReactions: boolean } {
  const nodeIdToIndex = new Map(model.nodes.map((n, i) => [n.id, i]));
  const nodeCount = model.nodes.length;
  const dofCount = nodeCount * 6;
  const analysisMode = getAnalysisMode(model);

  // Build DOF map (same logic as indexing.ts)
  const dofMap = new Int32Array(dofCount);
  for (let i = 0; i < dofMap.length; i++) dofMap[i] = i;
  for (const c of model.couplings ?? []) {
    const mi = nodeIdToIndex.get(c.masterNodeId);
    const si = nodeIdToIndex.get(c.slaveNodeId);
    if (mi === undefined || si === undefined) continue;
    const flags = [c.ux, c.uy, c.uz, c.rx, c.ry, c.rz];
    for (let d = 0; d < 6; d++) {
      if (!flags[d]) continue;
      const slaveDof = si * 6 + d;
      let resolved = mi * 6 + d;
      while (dofMap[resolved] !== resolved) resolved = dofMap[resolved]!;
      dofMap[slaveDof] = resolved;
    }
  }

  const constrainedSourceDofs = new Uint8Array(dofCount);
  for (let i = 0; i < model.nodes.length; i++) {
    const r = getEffectiveRestraint(model.nodes[i]!.restraint, analysisMode);
    const flags = [r.ux, r.uy, r.uz, r.rx, r.ry, r.rz];
    for (let d = 0; d < 6; d++) {
      if (flags[d]) constrainedSourceDofs[i * 6 + d] = 1;
    }
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

  return { rows, hasSharedReactions };
}
