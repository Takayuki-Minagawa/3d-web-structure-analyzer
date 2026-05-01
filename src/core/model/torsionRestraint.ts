import type { Member, ProjectModel, StructuralNode, TorsionRestraintEnd } from './types';

export const DEFAULT_TORSION_RESTRAINT: TorsionRestraintEnd = 'none';
export const AXIS_ALIGNED_TOLERANCE = 1e-9;

export interface TorsionRestraintSourceDof {
  memberId: string;
  nodeId: string;
  nodeIndex: number;
  dofOffset: number;
  sourceDof: number;
}

export function normalizeTorsionRestraint(value: unknown): TorsionRestraintEnd {
  return value === 'i' || value === 'j' ? value : DEFAULT_TORSION_RESTRAINT;
}

export function getMemberTorsionRestraint(member: Member): TorsionRestraintEnd {
  return normalizeTorsionRestraint(member.torsionRestraint);
}

export function getAxisAlignedRotationDofOffset(
  dx: number,
  dy: number,
  dz: number,
  length: number,
  tolerance = AXIS_ALIGNED_TOLERANCE
): number | null {
  if (length <= tolerance) return null;

  const lx = dx / length;
  const ly = dy / length;
  const lz = dz / length;

  if (Math.abs(Math.abs(lx) - 1) <= tolerance &&
      Math.abs(ly) <= tolerance &&
      Math.abs(lz) <= tolerance) return 3; // global rx
  if (Math.abs(lx) <= tolerance &&
      Math.abs(Math.abs(ly) - 1) <= tolerance &&
      Math.abs(lz) <= tolerance) return 4; // global ry
  if (Math.abs(lx) <= tolerance &&
      Math.abs(ly) <= tolerance &&
      Math.abs(Math.abs(lz) - 1) <= tolerance) return 5; // global rz

  return null;
}

export function formatUnsupportedTorsionRestraintMessage(memberId: string): string {
  return `部材 ${memberId} の捻り拘束はグローバルX/Y/Z軸に平行な部材のみ対応しています。`;
}

export function getMemberAxisRotationDofOffsetFromNodes(
  ni: StructuralNode,
  nj: StructuralNode
): number | null {
  const dx = nj.x - ni.x;
  const dy = nj.y - ni.y;
  const dz = nj.z - ni.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return getAxisAlignedRotationDofOffset(dx, dy, dz, length);
}

export function getMemberAxisRotationDofOffset(
  model: ProjectModel,
  member: Member
): number | null {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const ni = nodeById.get(member.ni);
  const nj = nodeById.get(member.nj);
  if (!ni || !nj) return null;
  return getMemberAxisRotationDofOffsetFromNodes(ni, nj);
}

export function collectTorsionRestraintSourceDofs(model: ProjectModel): {
  entries: TorsionRestraintSourceDof[];
  unsupportedMembers: Member[];
} {
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const nodeIdToIndex = new Map(model.nodes.map((node, index) => [node.id, index]));
  const entries: TorsionRestraintSourceDof[] = [];
  const unsupportedMembers: Member[] = [];

  for (const member of model.members) {
    const restraint = getMemberTorsionRestraint(member);
    if (restraint === DEFAULT_TORSION_RESTRAINT) continue;

    const ni = nodeById.get(member.ni);
    const nj = nodeById.get(member.nj);
    if (!ni || !nj) continue;

    const dofOffset = getMemberAxisRotationDofOffsetFromNodes(ni, nj);
    if (dofOffset === null) {
      unsupportedMembers.push(member);
      continue;
    }

    const nodeId = restraint === 'i' ? member.ni : member.nj;
    const nodeIndex = nodeIdToIndex.get(nodeId);
    if (nodeIndex === undefined) continue;
    entries.push({
      memberId: member.id,
      nodeId,
      nodeIndex,
      dofOffset,
      sourceDof: nodeIndex * 6 + dofOffset,
    });
  }

  return { entries, unsupportedMembers };
}

export function findMembersWithUnsupportedTorsionRestraint(
  model: ProjectModel
): Member[] {
  return collectTorsionRestraintSourceDofs(model).unsupportedMembers;
}

export function getTorsionRestraintSourceDofEntries(model: ProjectModel): TorsionRestraintSourceDof[] {
  return collectTorsionRestraintSourceDofs(model).entries;
}

export function getTorsionRestraintSourceDofs(model: ProjectModel): number[] {
  return getTorsionRestraintSourceDofEntries(model).map((entry) => entry.sourceDof);
}
