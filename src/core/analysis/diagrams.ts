import type {
  IndexedModel,
  IndexedMember,
  MemberLoad,
  CMQMemberLoad,
  DiagramSeries,
  DiagramPoint,
} from '../model/types';
import { buildTransformationMatrix, transformVectorToLocal } from './transforms';
import { getMemberDofs } from './assembly';
import { computePhiY, computePhiZ } from './element3dFrame';
import {
  computeCMQMomentDiagramCorrection,
  groupMemberLoadsByMember,
  integrateGauss3,
  resolveDistributedSegment,
  resolvePointLoadLocalComponents,
} from './loads';
import { timoshenkoShapeFunctions } from './timoshenko';

const NUM_SAMPLE_POINTS = 51;

type SectionForces = Pick<DiagramPoint, 'N' | 'Vy' | 'Vz' | 'Mx' | 'My' | 'Mz'>;

/** One local-axis component of a linearly varying distributed load. */
interface AxisSegment {
  a: number;
  b: number;
  start: number;
  end: number;
}

interface AxisPoint {
  a: number;
  value: number;
}

interface AxisLoads {
  segments: AxisSegment[];
  points: AxisPoint[];
}

/**
 * Resultant of the loads applied on [0, x]: the total force and its first
 * moment about the section at x, i.e. ∫ w(s) ds and ∫ w(s) (x - s) ds.
 */
function accumulatedLoad(loads: AxisLoads, x: number): { force: number; moment: number } {
  let force = 0;
  let moment = 0;
  for (const segment of loads.segments) {
    if (x <= segment.a) continue;
    const loaded = Math.min(x, segment.b) - segment.a;
    const arm = x - segment.a;
    const slope = (segment.end - segment.start) / (segment.b - segment.a);
    force += segment.start * loaded + slope * loaded * loaded / 2;
    moment += segment.start * (arm * loaded - loaded * loaded / 2)
      + slope * (arm * loaded * loaded / 2 - loaded * loaded * loaded / 3);
  }
  for (const point of loads.points) {
    if (x < point.a) continue;
    force += point.value;
    moment += point.value * (x - point.a);
  }
  return { force, moment };
}

function collectAxisLoads(
  member: IndexedMember,
  memberLoads: readonly MemberLoad[],
  gravity: { x: number; y: number; z: number }
): Record<'x' | 'y' | 'z', AxisLoads> {
  const loads: Record<'x' | 'y' | 'z', AxisLoads> = {
    x: { segments: [], points: [] },
    y: { segments: [], points: [] },
    z: { segments: [], points: [] },
  };
  for (const load of memberLoads) {
    if (load.type === 'udl' || load.type === 'selfWeight' || load.type === 'trapezoid') {
      const segment = resolveDistributedSegment(member, load, gravity);
      for (const axis of ['x', 'y', 'z'] as const) {
        const start = segment.start[axis];
        const end = segment.end[axis];
        if (start !== 0 || end !== 0) {
          loads[axis].segments.push({ a: segment.a, b: segment.b, start, end });
        }
      }
    } else if (load.type === 'point') {
      const component = resolvePointLoadLocalComponents(member, load);
      for (const axis of ['x', 'y', 'z'] as const) {
        if (component[axis] !== 0) loads[axis].points.push({ a: load.a, value: component[axis] });
      }
    }
  }
  return loads;
}

/** Sample positions: a regular grid plus every load discontinuity. */
function collectSamplePositions(L: number, memberLoads: readonly MemberLoad[]): number[] {
  const sampleSet = new Set<number>();
  for (let i = 0; i <= NUM_SAMPLE_POINTS; i++) {
    sampleSet.add((i / NUM_SAMPLE_POINTS) * L);
  }
  sampleSet.add(L / 2);

  for (const ml of memberLoads) {
    if (ml.type === 'point') {
      sampleSet.add(ml.a);
      sampleSet.add(Math.max(0, ml.a - 1e-8));
      sampleSet.add(Math.min(L, ml.a + 1e-8));
    } else if (ml.type === 'trapezoid') {
      sampleSet.add(ml.a);
      sampleSet.add(ml.b);
    }
  }

  sampleSet.add(0);
  sampleSet.add(L);

  return Array.from(sampleSet)
    .filter((x) => x >= 0 && x <= L)
    .sort((a, b) => a - b);
}

/**
 * Transverse deflection at every sample position from the bending and shear
 * strains of the actual section forces:
 *   v(x) = v_i + θ0 x + ∫₀ˣ (x - s) κ(s) ds + ∫₀ˣ γ(s) ds
 * with θ0 fixed by v(L) = v_j. Only end translations enter, so the curve is
 * exact for member loads and for released (pinned / spring) ends, where the
 * member-end rotation differs from the nodal rotation.
 */
function integrateDeflection(
  positions: readonly number[],
  L: number,
  startValue: number,
  endValue: number,
  curvature: (x: number) => number,
  shearStrain: (x: number) => number
): number[] {
  const bending: number[] = [0];
  const shear: number[] = [0];
  let curvatureIntegral = 0; // ∫ κ ds
  let curvatureMoment = 0;   // ∫ s κ ds
  let shearIntegral = 0;     // ∫ γ ds
  for (let i = 1; i < positions.length; i++) {
    const from = positions[i - 1]!;
    const to = positions[i]!;
    curvatureIntegral += integrateGauss3(from, to, curvature);
    curvatureMoment += integrateGauss3(from, to, (s) => s * curvature(s));
    shearIntegral += integrateGauss3(from, to, shearStrain);
    bending.push(to * curvatureIntegral - curvatureMoment);
    shear.push(shearIntegral);
  }
  const last = positions.length - 1;
  const startSlope = L > 0
    ? (endValue - startValue - bending[last]! - shear[last]!) / L
    : 0;
  return positions.map((x, i) => startValue + startSlope * x + bending[i]! + shear[i]!);
}

/**
 * Generate section force diagrams for a single 3D member.
 *
 * End forces (local):
 *   [Nxi, Vyi, Vzi, Mxi, Myi, Mzi, Nxj, Vyj, Vzj, Mxj, Myj, Mzj]
 */
export function generateDiagram(
  member: IndexedMember,
  endForces: Float64Array,
  memberLoads: MemberLoad[],
  globalDisplacements: Float64Array,
  gravity: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
): DiagramSeries {
  const { L, id } = member;

  // End forces
  const Nxi = endForces[0]!;
  const Vyi = endForces[1]!;
  const Vzi = endForces[2]!;
  const Mxi = endForces[3]!;
  const Myi = endForces[4]!;
  const Mzi = endForces[5]!;

  // Extract local displacements
  const T = member.transformation ?? buildTransformationMatrix(member);
  const dofs = getMemberDofs(member.ni, member.nj);
  const dGlobal = new Float64Array(12);
  for (let i = 0; i < 12; i++) {
    dGlobal[i] = globalDisplacements[dofs[i]!]!;
  }
  const dLocal = transformVectorToLocal(dGlobal, T);
  // dLocal = [uxi, uyi, uzi, rxi, ryi, rzi, uxj, uyj, uzj, rxj, ryj, rzj]

  const positions = collectSamplePositions(L, memberLoads);
  const loads = collectAxisLoads(member, memberLoads, gravity);
  const cmqLoads = memberLoads.filter((ml): ml is CMQMemberLoad => ml.type === 'cmq');

  const sectionForcesAt = (x: number): SectionForces => {
    const axial = accumulatedLoad(loads.x, x);
    const shearY = accumulatedLoad(loads.y, x);
    const shearZ = accumulatedLoad(loads.z, x);

    // Bending My (XZ plane): My(x) = Myi + Vzi*x + ...
    let My = Myi + Vzi * x + shearZ.moment;
    // Bending Mz (XY plane): Mz(x) = Mzi - Vyi*x - ...
    let Mz = Mzi - Vyi * x - shearY.moment;
    for (const cmq of cmqLoads) {
      const correction = computeCMQMomentDiagramCorrection(cmq, x, L);
      My += correction.My;
      Mz += correction.Mz;
    }

    return {
      // Internal axial force, tension positive: the i-end force Nxi acts on
      // the member in +x when it compresses the section.
      N: -(Nxi + axial.force),
      Vy: Vyi + shearY.force,
      Vz: Vzi + shearZ.force,
      Mx: Mxi, // constant: no distributed torque
      My,
      Mz,
    };
  };

  const deflection = cmqLoads.length > 0
    // CMQ specifies end actions only; the load shape inside the member is
    // unknown, so fall back to interpolating the nodal displacements.
    ? interpolateNodalDeflection(member, positions, dLocal)
    : integrateSectionDeflection(member, positions, dLocal, sectionForcesAt);

  const points: DiagramPoint[] = positions.map((x, index) => {
    const xi = L > 0 ? x / L : 0;
    return {
      x,
      ...sectionForcesAt(x),
      // Axial: linear
      ux: dLocal[0]! * (1 - xi) + dLocal[6]! * xi,
      uy: deflection.uy[index]!,
      uz: deflection.uz[index]!,
    };
  });

  return { memberId: id, points };
}

function integrateSectionDeflection(
  member: IndexedMember,
  positions: readonly number[],
  dLocal: Float64Array,
  sectionForcesAt: (x: number) => SectionForces
): { uy: number[]; uz: number[] } {
  const { E, G, A, Iy, Iz, ky, kz, L } = member;
  const shearRigidityY = G > 0 && kz * A > 0 ? G * kz * A : 0; // local-y shear
  const shearRigidityZ = G > 0 && ky * A > 0 ? G * ky * A : 0; // local-z shear
  return {
    // XY plane: EIz v'' = -Mz, shear slope = -Vy / (G kz A)
    uy: integrateDeflection(
      positions, L, dLocal[1]!, dLocal[7]!,
      (x) => -sectionForcesAt(x).Mz / (E * Iz),
      (x) => (shearRigidityY > 0 ? -sectionForcesAt(x).Vy / shearRigidityY : 0)
    ),
    // XZ plane: EIy w'' = +My, shear slope = -Vz / (G ky A)
    uz: integrateDeflection(
      positions, L, dLocal[2]!, dLocal[8]!,
      (x) => sectionForcesAt(x).My / (E * Iy),
      (x) => (shearRigidityZ > 0 ? -sectionForcesAt(x).Vz / shearRigidityZ : 0)
    ),
  };
}

/**
 * Local displacement at xi = x / L interpolated from the member-end DOFs
 * [uxi, uyi, uzi, rxi, ryi, rzi, uxj, uyj, uzj, rxj, ryj, rzj] with the
 * Timoshenko shape functions. Exact for a member without span loads.
 */
export function interpolateMemberDisplacement(
  member: IndexedMember,
  dLocal: Float64Array,
  xi: number
): { ux: number; uy: number; uz: number } {
  const { L } = member;
  // Transverse Y: Timoshenko with phi_z, DOFs 1(uyi),5(rzi),7(uyj),11(rzj)
  const [h1z, h2z, h3z, h4z] = timoshenkoShapeFunctions(xi, L, computePhiZ(member));
  // Transverse Z: Timoshenko with phi_y, DOFs 2(uzi),4(ryi),8(uzj),10(ryj)
  // Note: rotation coupling sign is accounted for in the shape function signs
  const [h1y, h2y, h3y, h4y] = timoshenkoShapeFunctions(xi, L, computePhiY(member));
  return {
    ux: dLocal[0]! * (1 - xi) + dLocal[6]! * xi,
    uy: dLocal[1]! * h1z + dLocal[5]! * h2z + dLocal[7]! * h3z + dLocal[11]! * h4z,
    uz: dLocal[2]! * h1y + (-dLocal[4]!) * h2y + dLocal[8]! * h3y + (-dLocal[10]!) * h4y,
  };
}

function interpolateNodalDeflection(
  member: IndexedMember,
  positions: readonly number[],
  dLocal: Float64Array
): { uy: number[]; uz: number[] } {
  const { L } = member;
  const uy: number[] = [];
  const uz: number[] = [];
  for (const x of positions) {
    const displacement = interpolateMemberDisplacement(member, dLocal, L > 0 ? x / L : 0);
    uy.push(displacement.uy);
    uz.push(displacement.uz);
  }
  return { uy, uz };
}

/**
 * Generate diagrams for all members.
 */
export function generateAllDiagrams(
  model: IndexedModel,
  elementEndForces: Map<string, Float64Array>,
  globalDisplacements: Float64Array,
  memberLoadsByMember = groupMemberLoadsByMember(model.memberLoads)
): Map<string, DiagramSeries> {
  const diagrams = new Map<string, DiagramSeries>();

  for (const member of model.members) {
    const endForces = elementEndForces.get(member.id);
    if (!endForces) continue;

    const memberLoads = memberLoadsByMember.get(member.id) ?? [];
    const diagram = generateDiagram(
      member,
      endForces,
      memberLoads,
      globalDisplacements,
      model.gravity
    );
    diagrams.set(member.id, diagram);
  }

  return diagrams;
}
