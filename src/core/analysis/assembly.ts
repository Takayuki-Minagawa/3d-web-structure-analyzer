import type { IndexedModel } from '../model/types';
import { buildLocalStiffness, applyEndReleases } from './element3dFrame';
import { buildTransformationMatrix, transformToGlobal } from './transforms';
import { dofValues } from '../model/restraints';

const MEMBER_DOF = 12;

/**
 * Assemble global stiffness matrix from all element contributions.
 * Applies member-end releases (static condensation) and DOF coupling (master-slave).
 */
export function assembleGlobalStiffness(model: IndexedModel): Float64Array {
  const n = model.dofCount;
  const K = new Float64Array(n * n);
  const { dofMap } = model;

  for (const member of model.members) {
    const kLocal = member.localStiffness
      ? new Float64Array(member.localStiffness)
      : buildLocalStiffness(member);

    // Apply end releases via static condensation (modifies kLocal in place)
    applyEndReleases(kLocal, member.releases);

    const T = member.transformation ?? buildTransformationMatrix(member);
    const kGlobal = transformToGlobal(kLocal, T);

    // DOF mapping: member's 12 DOFs -> global DOF indices (with coupling)
    const dofs = getMemberDofs(member.ni, member.nj);

    // Scatter into global matrix, redirecting slave DOFs to master DOFs
    for (let i = 0; i < MEMBER_DOF; i++) {
      const gi = dofMap[dofs[i]!]!;
      for (let j = 0; j < MEMBER_DOF; j++) {
        const gj = dofMap[dofs[j]!]!;
        K[gi * n + gj] = K[gi * n + gj]! + kGlobal[i * MEMBER_DOF + j]!;
      }
    }
  }

  // Diagonal support springs are expressed in global nodal DOF order. A
  // spring attached to a coupled slave contributes to the effective master.
  for (const spring of model.nodeSprings) {
    const stiffnesses = dofValues(spring);
    const base = spring.nodeIndex * 6;
    for (let localDof = 0; localDof < 6; localDof++) {
      const stiffness = stiffnesses[localDof]!;
      if (stiffness === 0) continue;
      const effectiveDof = dofMap[base + localDof]!;
      K[effectiveDof * n + effectiveDof] =
        K[effectiveDof * n + effectiveDof]! + stiffness;
    }
  }

  return K;
}

/**
 * Get global DOF indices for a member given its node indices.
 * DOF order per node: [ux, uy, uz, rx, ry, rz]
 */
export function getMemberDofs(ni: number, nj: number): number[] {
  return [
    ni * 6,     ni * 6 + 1, ni * 6 + 2,
    ni * 6 + 3, ni * 6 + 4, ni * 6 + 5,
    nj * 6,     nj * 6 + 1, nj * 6 + 2,
    nj * 6 + 3, nj * 6 + 4, nj * 6 + 5,
  ];
}
