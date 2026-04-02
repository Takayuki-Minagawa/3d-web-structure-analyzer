import type {
  IndexedModel,
  IndexedMember,
  MemberLoad,
  PointMemberLoad,
  UniformMemberLoad,
} from '../model/types';
import { transformVectorToGlobal, buildTransformationMatrix } from './transforms';
import { computePhi } from './element2dFrame';

/**
 * Timoshenko shape functions for bending at xi = x/L
 * Includes shear deformation parameter Φ.
 * When Φ = 0, reduces to standard Hermite shape functions.
 */
function timoshenkoShapeFunctions(xi: number, L: number, phi: number): [number, number, number, number] {
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
 * Compute fixed-end force vector (local) for a point load on a member.
 * Returns 6-element array: [Fxi, Fyi, Mzi, Fxj, Fyj, Mzj]
 * Sign convention: returned forces are the fixed-end reactions (opposite of applied load direction)
 */
export function computePointLoadFixedEndForces(
  member: IndexedMember,
  load: PointMemberLoad
): Float64Array {
  const f = new Float64Array(6);
  const { L } = member;
  const { a, value, direction } = load;
  const xi = a / L;
  const phi = computePhi(member);

  if (direction === 'localX') {
    // Axial point load: use linear shape functions
    f[0] = value * (1 - xi); // i-end axial
    f[3] = value * xi;       // j-end axial
  } else {
    // Transverse point load: use Timoshenko shape functions
    const [N1, N2, N3, N4] = timoshenkoShapeFunctions(xi, L, phi);
    f[1] = value * N1;  // Fyi
    f[2] = value * N2;  // Mzi
    f[4] = value * N3;  // Fyj
    f[5] = value * N4;  // Mzj
  }

  return f;
}

/**
 * Compute fixed-end force vector (local) for a uniform distributed load.
 * Returns 6-element array: [Fxi, Fyi, Mzi, Fxj, Fyj, Mzj]
 */
export function computeUDLFixedEndForces(
  member: IndexedMember,
  load: UniformMemberLoad
): Float64Array {
  const f = new Float64Array(6);
  const { L } = member;
  const { value, direction } = load;

  if (direction === 'localX') {
    // Axial UDL: integral of N_axial * q dx
    f[0] = (value * L) / 2;
    f[3] = (value * L) / 2;
  } else {
    // Transverse UDL: integral of N_bend * q dx
    f[1] = (value * L) / 2;
    f[2] = (value * L * L) / 12;
    f[4] = (value * L) / 2;
    f[5] = -(value * L * L) / 12;
  }

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
  } else {
    return computeUDLFixedEndForces(member, load);
  }
}

/**
 * Build the global force vector by assembling nodal loads and
 * equivalent nodal loads from member loads.
 */
export function buildGlobalForceVector(model: IndexedModel): Float64Array {
  const F = new Float64Array(model.dofCount);

  // Nodal loads -> directly add to global force vector
  for (const nl of model.nodalLoads) {
    const idx = model.nodeIdToIndex.get(nl.nodeId);
    if (idx === undefined) continue;
    const base = idx * 3;
    F[base]! += nl.fx;
    F[base + 1]! += nl.fy;
    F[base + 2]! += nl.mz;
  }

  // Member loads -> equivalent nodal loads
  for (const ml of model.memberLoads) {
    const mIdx = model.memberIdToIndex.get(ml.memberId);
    if (mIdx === undefined) continue;
    const member = model.members[mIdx]!;

    const fLocal = computeMemberLoadFixedEndForces(member, ml);
    const T = buildTransformationMatrix(member);
    const fGlobal = transformVectorToGlobal(fLocal, T);

    // Add to global force vector
    const iBase = member.ni * 3;
    const jBase = member.nj * 3;
    F[iBase]! += fGlobal[0]!;
    F[iBase + 1]! += fGlobal[1]!;
    F[iBase + 2]! += fGlobal[2]!;
    F[jBase]! += fGlobal[3]!;
    F[jBase + 1]! += fGlobal[4]!;
    F[jBase + 2]! += fGlobal[5]!;
  }

  return F;
}
