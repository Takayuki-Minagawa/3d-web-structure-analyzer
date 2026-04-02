import type {
  IndexedModel,
  IndexedMember,
  MemberLoad,
  PointMemberLoad,
  UniformMemberLoad,
  CMQMemberLoad,
} from '../model/types';
import { transformVectorToGlobal, buildTransformationMatrix } from './transforms';
import { computePhiY, computePhiZ, buildLocalStiffness, applyEndReleasesToForce } from './element3dFrame';

/**
 * Timoshenko shape functions for bending at xi = x/L with shear parameter phi.
 * Returns [N1, N2, N3, N4] where:
 *   v(xi) = N1*vi + N2*theta_i + N3*vj + N4*theta_j
 */
function timoshenkoShapeFunctions(
  xi: number, L: number, phi: number
): [number, number, number, number] {
  const xi2 = xi * xi;
  const xi3 = xi2 * xi;
  const d = 1 + phi;
  return [
    (1 - 3 * xi2 + 2 * xi3 + phi * (1 - xi)) / d,
    L * (xi - 2 * xi2 + xi3 + (phi / 2) * (xi - xi2)) / d,
    (3 * xi2 - 2 * xi3 + phi * xi) / d,
    L * (-xi2 + xi3 + (phi / 2) * (xi2 - xi)) / d,
  ];
}

/**
 * Compute 12-element fixed-end force vector (local) for a point load.
 * DOF: [uxi, uyi, uzi, rxi, ryi, rzi, uxj, uyj, uzj, rxj, ryj, rzj]
 */
export function computePointLoadFixedEndForces(
  member: IndexedMember,
  load: PointMemberLoad
): Float64Array {
  const f = new Float64Array(12);
  const { L } = member;
  const { a, value, direction } = load;
  const xi = a / L;

  if (direction === 'localX') {
    // Axial point load
    f[0] = value * (1 - xi);
    f[6] = value * xi;
  } else if (direction === 'localY') {
    // Transverse Y: uses EIz, DOFs 1,5,7,11
    const phi = computePhiZ(member);
    const [N1, N2, N3, N4] = timoshenkoShapeFunctions(xi, L, phi);
    f[1] = value * N1;
    f[5] = value * N2;
    f[7] = value * N3;
    f[11] = value * N4;
  } else {
    // Transverse Z: uses EIy, DOFs 2,4,8,10
    // Sign convention: positive load in local Z uses shape functions with flipped rotation signs
    const phi = computePhiY(member);
    const [N1, N2, N3, N4] = timoshenkoShapeFunctions(xi, L, phi);
    f[2] = value * N1;
    f[4] = -value * N2;  // ry coupling sign flip
    f[8] = value * N3;
    f[10] = -value * N4;  // ry coupling sign flip
  }

  return f;
}

/**
 * Compute 12-element fixed-end force vector (local) for a UDL.
 */
export function computeUDLFixedEndForces(
  member: IndexedMember,
  load: UniformMemberLoad
): Float64Array {
  const f = new Float64Array(12);
  const { L } = member;
  const { value, direction } = load;

  if (direction === 'localX') {
    f[0] = (value * L) / 2;
    f[6] = (value * L) / 2;
  } else if (direction === 'localY') {
    f[1] = (value * L) / 2;
    f[5] = (value * L * L) / 12;
    f[7] = (value * L) / 2;
    f[11] = -(value * L * L) / 12;
  } else {
    // localZ
    f[2] = (value * L) / 2;
    f[4] = -(value * L * L) / 12;  // ry coupling sign flip
    f[8] = (value * L) / 2;
    f[10] = (value * L * L) / 12;  // ry coupling sign flip
  }

  return f;
}

/**
 * Compute 12-element fixed-end force vector (local) for CMQ loads.
 * CMQ loads specify concentrated forces/moments directly at member ends.
 */
export function computeCMQFixedEndForces(
  _member: IndexedMember,
  load: CMQMemberLoad
): Float64Array {
  const f = new Float64Array(12);

  // i-end
  f[0] = load.iQx;
  f[1] = load.iQy;
  f[2] = load.iQz;
  // f[3] = 0;  // no torsion from CMQ
  f[4] = load.iMy;
  f[5] = load.iMz;

  // j-end
  f[6] = load.jQx;
  f[7] = load.jQy;
  f[8] = load.jQz;
  // f[9] = 0;  // no torsion from CMQ
  f[10] = load.jMy;
  f[11] = load.jMz;

  return f;
}

/**
 * Compute fixed-end force vector (local) for any member load.
 */
export function computeMemberLoadFixedEndForces(
  member: IndexedMember,
  load: MemberLoad
): Float64Array {
  if (load.type === 'point') {
    return computePointLoadFixedEndForces(member, load);
  } else if (load.type === 'udl') {
    return computeUDLFixedEndForces(member, load);
  } else {
    return computeCMQFixedEndForces(member, load);
  }
}

/**
 * Build the global force vector by assembling nodal loads and
 * equivalent nodal loads from member loads.
 * Applies end-release condensation to member loads and DOF coupling.
 */
export function buildGlobalForceVector(model: IndexedModel): Float64Array {
  const F = new Float64Array(model.dofCount);
  const { dofMap } = model;

  // Nodal loads -> add to global force vector (with coupling redirect)
  for (const nl of model.nodalLoads) {
    const idx = model.nodeIdToIndex.get(nl.nodeId);
    if (idx === undefined) continue;
    const base = idx * 6;
    const vals = [nl.fx, nl.fy, nl.fz, nl.mx, nl.my, nl.mz];
    for (let d = 0; d < 6; d++) {
      F[dofMap[base + d]!] = F[dofMap[base + d]!]! + vals[d]!;
    }
  }

  // Member loads -> equivalent nodal loads (with end-release condensation)
  for (const ml of model.memberLoads) {
    const mIdx = model.memberIdToIndex.get(ml.memberId);
    if (mIdx === undefined) continue;
    const member = model.members[mIdx]!;

    const fLocal = computeMemberLoadFixedEndForces(member, ml);

    // Apply end-release condensation to the local force vector
    const hasRelease = member.releases.some(r => r.type !== 'rigid');
    if (hasRelease) {
      const kOrig = buildLocalStiffness(member);
      applyEndReleasesToForce(fLocal, kOrig, member.releases);
    }

    const T = buildTransformationMatrix(member);
    const fGlobal = transformVectorToGlobal(fLocal, T);

    // Scatter with coupling redirect
    const iBase = member.ni * 6;
    const jBase = member.nj * 6;
    for (let d = 0; d < 6; d++) {
      F[dofMap[iBase + d]!] = F[dofMap[iBase + d]!]! + fGlobal[d]!;
      F[dofMap[jBase + d]!] = F[dofMap[jBase + d]!]! + fGlobal[6 + d]!;
    }
  }

  return F;
}
