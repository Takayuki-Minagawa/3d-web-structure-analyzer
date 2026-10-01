import type {
  IndexedModel,
  IndexedMember,
  MemberLoad,
  PointMemberLoad,
  UniformMemberLoad,
  CMQMemberLoad,
  SelfWeightMemberLoad,
  TemperatureMemberLoad,
  TrapezoidalMemberLoad,
} from '../model/types';
import { transformVectorToGlobal, buildTransformationMatrix } from './transforms';
import { computePhiY, computePhiZ, buildLocalStiffness, applyEndReleasesToForce } from './element3dFrame';
import { timoshenkoShapeFunctions } from './timoshenko';

export interface LocalLoadComponents {
  x: number;
  y: number;
  z: number;
}

/** Distributed load over [a, b] whose local components vary linearly. */
export interface LocalDistributedSegment {
  a: number;
  b: number;
  start: LocalLoadComponents;
  end: LocalLoadComponents;
}

export type DistributedMemberLoad =
  | UniformMemberLoad
  | SelfWeightMemberLoad
  | TrapezoidalMemberLoad;

const ZERO_GRAVITY = { x: 0, y: 0, z: 0 };
/** Relative slack for load positions computed from rounded member lengths. */
const POSITION_TOLERANCE = 1e-9;
/** 3-point Gauss-Legendre rule on [-1, 1]; exact up to degree 5. */
const GAUSS_3: ReadonlyArray<readonly [number, number]> = [
  [-Math.sqrt(0.6), 5 / 9],
  [0, 8 / 9],
  [Math.sqrt(0.6), 5 / 9],
];

/** Integrate f over [a, b] with the 3-point Gauss-Legendre rule. */
export function integrateGauss3(a: number, b: number, f: (x: number) => number): number {
  const half = (b - a) / 2;
  const mid = (a + b) / 2;
  let sum = 0;
  for (const [point, weight] of GAUSS_3) sum += weight * f(mid + half * point);
  return sum * half;
}

export function groupMemberLoadsByMember(
  loads: readonly MemberLoad[]
): Map<string, MemberLoad[]> {
  const grouped = new Map<string, MemberLoad[]>();
  for (const load of loads) {
    const group = grouped.get(load.memberId);
    if (group) group.push(load);
    else grouped.set(load.memberId, [load]);
  }
  return grouped;
}

/** Project a global vector onto the member's local axes. */
export function projectGlobalVectorToLocal(
  member: IndexedMember,
  vector: { x: number; y: number; z: number }
): LocalLoadComponents {
  const { lambda } = member;
  return {
    x: lambda[0]! * vector.x + lambda[1]! * vector.y + lambda[2]! * vector.z,
    y: lambda[3]! * vector.x + lambda[4]! * vector.y + lambda[5]! * vector.z,
    z: lambda[6]! * vector.x + lambda[7]! * vector.y + lambda[8]! * vector.z,
  };
}

function directionalComponents(
  member: IndexedMember,
  direction: PointMemberLoad['direction'] | UniformMemberLoad['direction'],
  value: number
): LocalLoadComponents {
  if (direction === 'localX') return { x: value, y: 0, z: 0 };
  if (direction === 'localY') return { x: 0, y: value, z: 0 };
  if (direction === 'localZ') return { x: 0, y: 0, z: value };
  return projectGlobalVectorToLocal(member, {
    x: direction === 'globalX' ? value : 0,
    y: direction === 'globalY' ? value : 0,
    z: direction === 'globalZ' ? value : 0,
  });
}

export function resolvePointLoadLocalComponents(
  member: IndexedMember,
  load: PointMemberLoad
): LocalLoadComponents {
  return directionalComponents(member, load.direction, load.value);
}

/** Resolve a uniform or self-weight load to local force-per-length components. */
export function resolveDistributedLoadLocalComponents(
  member: IndexedMember,
  load: UniformMemberLoad | SelfWeightMemberLoad,
  gravity: { x: number; y: number; z: number } = ZERO_GRAVITY
): LocalLoadComponents {
  if (load.type === 'udl') {
    return directionalComponents(member, load.direction, load.value);
  }
  const massPerLength = (member.density ?? 0) * member.A * load.value;
  return projectGlobalVectorToLocal(member, {
    x: massPerLength * gravity.x,
    y: massPerLength * gravity.y,
    z: massPerLength * gravity.z,
  });
}

/**
 * Resolve any distributed load to a linearly varying local segment. Uniform
 * and self-weight loads span the whole member with constant intensity.
 */
export function resolveDistributedSegment(
  member: IndexedMember,
  load: DistributedMemberLoad,
  gravity: { x: number; y: number; z: number } = ZERO_GRAVITY
): LocalDistributedSegment {
  if (load.type !== 'trapezoid') {
    const components = resolveDistributedLoadLocalComponents(member, load, gravity);
    return { a: 0, b: member.L, start: components, end: components };
  }
  const { L } = member;
  const tolerance = POSITION_TOLERANCE * Math.max(L, 1);
  const { a, b } = load;
  if (
    !Number.isFinite(a) || !Number.isFinite(b) ||
    a < -tolerance || b > L + tolerance || !(b > a)
  ) {
    throw new RangeError(
      `分布荷重 ${load.id} の範囲 a=${a}, b=${b} は部材 ${member.id} の範囲 0〜${L} 内で a < b である必要があります。`
    );
  }
  return {
    a: Math.max(0, a),
    b: Math.min(L, b),
    start: directionalComponents(member, load.direction, load.value),
    end: directionalComponents(member, load.direction, load.valueEnd),
  };
}

/** Local load intensity of a segment at position x (zero outside [a, b]). */
function segmentIntensity(segment: LocalDistributedSegment, x: number): LocalLoadComponents {
  const ratio = (x - segment.a) / (segment.b - segment.a);
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
    z: segment.start.z + (segment.end.z - segment.start.z) * ratio,
  };
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
  const { a } = load;
  if (!Number.isFinite(L) || L <= 0) {
    throw new RangeError(`部材 ${member.id} の長さが正の有限値ではありません (L=${L})。`);
  }
  if (!Number.isFinite(a) || a < 0 || a > L) {
    throw new RangeError(
      `集中荷重 ${load.id} の位置 a=${a} は部材 ${member.id} の範囲 0〜${L} 外です。`
    );
  }
  const xi = a / L;

  const components = resolvePointLoadLocalComponents(member, load);
  if (components.x !== 0) {
    // Axial point load
    f[0] = f[0]! + components.x * (1 - xi);
    f[6] = f[6]! + components.x * xi;
  }
  if (components.y !== 0) {
    // Transverse Y: uses EIz, DOFs 1,5,7,11
    const phi = computePhiZ(member);
    const [N1, N2, N3, N4] = timoshenkoShapeFunctions(xi, L, phi);
    f[1] = f[1]! + components.y * N1;
    f[5] = f[5]! + components.y * N2;
    f[7] = f[7]! + components.y * N3;
    f[11] = f[11]! + components.y * N4;
  }
  if (components.z !== 0) {
    // Transverse Z: uses EIy, DOFs 2,4,8,10
    // Sign convention: positive load in local Z uses shape functions with flipped rotation signs
    const phi = computePhiY(member);
    const [N1, N2, N3, N4] = timoshenkoShapeFunctions(xi, L, phi);
    f[2] = f[2]! + components.z * N1;
    f[4] = f[4]! - components.z * N2;  // ry coupling sign flip
    f[8] = f[8]! + components.z * N3;
    f[10] = f[10]! - components.z * N4;  // ry coupling sign flip
  }

  return f;
}

/**
 * Compute 12-element fixed-end force vector (local) for a UDL.
 */
export function computeUDLFixedEndForces(
  member: IndexedMember,
  load: UniformMemberLoad | SelfWeightMemberLoad,
  gravity: { x: number; y: number; z: number } = ZERO_GRAVITY
): Float64Array {
  const f = new Float64Array(12);
  const { L } = member;
  const { x, y, z } = resolveDistributedLoadLocalComponents(member, load, gravity);

  f[0] = (x * L) / 2;
  f[6] = (x * L) / 2;
  f[1] = (y * L) / 2;
  f[5] = (y * L * L) / 12;
  f[7] = (y * L) / 2;
  f[11] = -(y * L * L) / 12;
  f[2] = (z * L) / 2;
  f[4] = -(z * L * L) / 12;  // ry coupling sign flip
  f[8] = (z * L) / 2;
  f[10] = (z * L * L) / 12;  // ry coupling sign flip

  return f;
}

/**
 * Compute 12-element fixed-end force vector (local) for a linearly varying
 * load over a partial span, integrating the load against the Timoshenko
 * shape functions (a quartic integrand, so the 3-point rule is exact).
 */
export function computeTrapezoidFixedEndForces(
  member: IndexedMember,
  load: TrapezoidalMemberLoad
): Float64Array {
  const f = new Float64Array(12);
  const { L } = member;
  if (!Number.isFinite(L) || L <= 0) {
    throw new RangeError(`部材 ${member.id} の長さが正の有限値ではありません (L=${L})。`);
  }
  const segment = resolveDistributedSegment(member, load);
  const phiY = computePhiY(member);
  const phiZ = computePhiZ(member);
  const integrate = (integrand: (x: number, w: LocalLoadComponents) => number): number =>
    integrateGauss3(segment.a, segment.b, (x) => integrand(x, segmentIntensity(segment, x)));
  const shapeY = (x: number) => timoshenkoShapeFunctions(x / L, L, phiZ);
  const shapeZ = (x: number) => timoshenkoShapeFunctions(x / L, L, phiY);

  f[0] = integrate((x, w) => w.x * (1 - x / L));
  f[6] = integrate((x, w) => w.x * (x / L));
  f[1] = integrate((x, w) => w.y * shapeY(x)[0]);
  f[5] = integrate((x, w) => w.y * shapeY(x)[1]);
  f[7] = integrate((x, w) => w.y * shapeY(x)[2]);
  f[11] = integrate((x, w) => w.y * shapeY(x)[3]);
  f[2] = integrate((x, w) => w.z * shapeZ(x)[0]);
  f[4] = -integrate((x, w) => w.z * shapeZ(x)[1]);  // ry coupling sign flip
  f[8] = integrate((x, w) => w.z * shapeZ(x)[2]);
  f[10] = -integrate((x, w) => w.z * shapeZ(x)[3]);  // ry coupling sign flip

  return f;
}

/** Equivalent nodal forces for a uniform axial thermal strain. */
export function computeTemperatureFixedEndForces(
  member: IndexedMember,
  load: TemperatureMemberLoad
): Float64Array {
  const f = new Float64Array(12);
  const thermalForce = member.E * member.A * (member.expansion ?? 0) * load.value;
  // These are equivalent external nodal forces. With one free end they produce
  // +alpha*deltaT*L elongation; with both ends fixed, recovery yields the
  // equal-and-opposite compressive end-force pair.
  f[0] = -thermalForce;
  f[6] = thermalForce;
  return f;
}

/**
 * Compute 12-element fixed-end force vector (local) for CMQ loads.
 * CMQ loads specify equivalent end forces/moments directly at member ends.
 * Mid-span moments (`moy`/`moz`) do not create additional nodal equivalents;
 * they are applied later as diagram-shape corrections for display.
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
 * CMQ can also carry mid-span bending moments that shape the displayed
 * section-force diagram without adding extra nodal equivalents.
 *
 * We model that with a parabolic "bubble" correction that is zero at both ends
 * and reaches the requested `moy` / `moz` at mid-span.
 */
export function computeCMQMomentDiagramCorrection(
  load: CMQMemberLoad,
  x: number,
  L: number
): { My: number; Mz: number } {
  if (L <= 0) return { My: 0, Mz: 0 };

  const xi = Math.max(0, Math.min(1, x / L));
  const bubble = 4 * xi * (1 - xi);

  // generateDiagram integrates from the i-end using its recovered shear.
  // For a fixed member the CMQ contribution is q_end = -f_cmq, hence:
  //   My(x) = -iMy - iQz*x
  //   Mz(x) = -iMz + iQy*x
  // Using the end-moment chord here only works when the CMQ end actions are
  // perfectly equilibrated; the shear-based baseline also handles asymmetric
  // imported CMQ values and makes the requested midpoint exact.
  const myBaselineMid = -load.iMy - load.iQz * L / 2;
  const mzBaselineMid = -load.iMz + load.iQy * L / 2;

  return {
    My: (load.moy - myBaselineMid) * bubble,
    Mz: (load.moz - mzBaselineMid) * bubble,
  };
}

/**
 * Compute fixed-end force vector (local) for any member load.
 */
export function computeMemberLoadFixedEndForces(
  member: IndexedMember,
  load: MemberLoad,
  gravity: { x: number; y: number; z: number } = ZERO_GRAVITY
): Float64Array {
  if (load.type === 'point') {
    return computePointLoadFixedEndForces(member, load);
  } else if (load.type === 'udl') {
    return computeUDLFixedEndForces(member, load, gravity);
  } else if (load.type === 'trapezoid') {
    return computeTrapezoidFixedEndForces(member, load);
  } else if (load.type === 'cmq') {
    return computeCMQFixedEndForces(member, load);
  } else if (load.type === 'temperature') {
    return computeTemperatureFixedEndForces(member, load);
  }
  return computeUDLFixedEndForces(member, load, gravity);
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

    const fLocal = computeMemberLoadFixedEndForces(member, ml, model.gravity);

    // Apply end-release condensation to the local force vector
    const hasRelease = member.releases.some(r => r.type !== 'rigid');
    if (hasRelease) {
      const kOrig = member.localStiffness ?? buildLocalStiffness(member);
      applyEndReleasesToForce(fLocal, kOrig, member.releases);
    }

    const T = member.transformation ?? buildTransformationMatrix(member);
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
