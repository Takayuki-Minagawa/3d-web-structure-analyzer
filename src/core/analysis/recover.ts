import type {
  IndexedModel,
  IndexedMember,
  IndexedNodalSpringSupport,
  MemberLoad,
} from '../model/types';
import { buildLocalStiffness, applyEndReleases, applyEndReleasesToForce } from './element3dFrame';
import { buildTransformationMatrix, transformVectorToLocal } from './transforms';
import { computeMemberLoadFixedEndForces, groupMemberLoadsByMember } from './loads';
import { getMemberDofs } from './assembly';
import { dofValues } from '../model/restraints';

const MEMBER_DOF = 12;

/**
 * Compute reactions: R = K_full * d - F_full
 */
export function computeReactions(
  K: Float64Array,
  d: Float64Array,
  F: Float64Array,
  n: number,
  fixedDofs: number[],
  nodeSprings: readonly IndexedNodalSpringSupport[] = [],
  dofMap?: Int32Array
): Float64Array {
  const R = new Float64Array(n);

  for (const fi of fixedDofs) {
    let kd = 0;
    for (let j = 0; j < n; j++) {
      kd += K[fi * n + j]! * d[j]!;
    }
    R[fi] = kd - F[fi]!;
  }

  // A spring-supported DOF is free in the algebraic partition, so Kd-F is
  // (correctly) zero there. Report the physical support action separately as
  // -k*u at the spring's source node for equilibrium and result display.
  for (const spring of nodeSprings) {
    const stiffnesses = dofValues(spring);
    const base = spring.nodeIndex * 6;
    for (let localDof = 0; localDof < 6; localDof++) {
      const sourceDof = base + localDof;
      const effectiveDof = dofMap?.[sourceDof] ?? sourceDof;
      R[sourceDof] = R[sourceDof]! - stiffnesses[localDof]! * d[effectiveDof]!;
    }
  }

  return R;
}

/**
 * Compute element end forces in local coordinates for a single member.
 * q_end_local = k_local * d_local - f_member_load_local
 *
 * Returns 12-element Float64Array:
 * [Nxi, Vyi, Vzi, Mxi, Myi, Mzi, Nxj, Vyj, Vzj, Mxj, Myj, Mzj]
 */
export function computeElementEndForces(
  member: IndexedMember,
  globalDisplacements: Float64Array,
  memberLoads: MemberLoad[],
  gravity: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
): Float64Array {
  const kLocal = member.localStiffness
    ? new Float64Array(member.localStiffness)
    : buildLocalStiffness(member);
  const T = member.transformation ?? buildTransformationMatrix(member);

  // Apply end-release condensation (same as assembly phase)
  const hasRelease = member.releases.some(r => r.type !== 'rigid');
  if (hasRelease) {
    applyEndReleases(kLocal, member.releases);
  }

  // Extract element global displacements
  const dofs = getMemberDofs(member.ni, member.nj);
  const dGlobal = new Float64Array(MEMBER_DOF);
  for (let i = 0; i < MEMBER_DOF; i++) {
    dGlobal[i] = globalDisplacements[dofs[i]!]!;
  }

  // Transform to local
  const dLocal = transformVectorToLocal(dGlobal, T);

  // k_condensed * d_local
  const kd = new Float64Array(MEMBER_DOF);
  for (let i = 0; i < MEMBER_DOF; i++) {
    let sum = 0;
    for (let j = 0; j < MEMBER_DOF; j++) {
      sum += kLocal[i * MEMBER_DOF + j]! * dLocal[j]!;
    }
    kd[i] = sum;
  }

  // Subtract fixed-end forces from member loads (with end-release condensation)
  const fMemberLocal = new Float64Array(MEMBER_DOF);
  for (const ml of memberLoads) {
    const fLocal = computeMemberLoadFixedEndForces(member, ml, gravity);
    if (hasRelease) {
      const kOrig = member.localStiffness ?? buildLocalStiffness(member);
      applyEndReleasesToForce(fLocal, kOrig, member.releases);
    }
    for (let i = 0; i < MEMBER_DOF; i++) {
      fMemberLocal[i] = fMemberLocal[i]! + fLocal[i]!;
    }
  }

  const endForces = new Float64Array(MEMBER_DOF);
  for (let i = 0; i < MEMBER_DOF; i++) {
    endForces[i] = kd[i]! - fMemberLocal[i]!;
  }

  return endForces;
}

/**
 * Compute all element end forces for the model.
 */
export function computeAllElementEndForces(
  model: IndexedModel,
  globalDisplacements: Float64Array,
  memberLoadsByMember = groupMemberLoadsByMember(model.memberLoads)
): Map<string, Float64Array> {
  const result = new Map<string, Float64Array>();

  for (const member of model.members) {
    const memberLoads = memberLoadsByMember.get(member.id) ?? [];
    const endForces = computeElementEndForces(
      member,
      globalDisplacements,
      memberLoads,
      model.gravity
    );
    result.set(member.id, endForces);
  }

  return result;
}
