import type {
  IndexedModel,
  IndexedMember,
  MemberLoad,
  DiagramSeries,
  DiagramPoint,
} from '../model/types';
import { buildTransformationMatrix, transformVectorToLocal } from './transforms';
import { getMemberDofs } from './assembly';
import { computePhiY, computePhiZ } from './element3dFrame';

const NUM_SAMPLE_POINTS = 51;

/**
 * Timoshenko shape functions at xi = x/L with shear parameter phi.
 */
function timoshenkoShape(
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
 * Generate section force diagrams for a single 3D member.
 *
 * End forces (local):
 *   [Nxi, Vyi, Vzi, Mxi, Myi, Mzi, Nxj, Vyj, Vzj, Mxj, Myj, Mzj]
 */
export function generateDiagram(
  member: IndexedMember,
  endForces: Float64Array,
  memberLoads: MemberLoad[],
  globalDisplacements: Float64Array
): DiagramSeries {
  const { L, id } = member;
  const phiY = computePhiY(member);
  const phiZ = computePhiZ(member);

  // End forces
  const Nxi = endForces[0]!;
  const Vyi = endForces[1]!;
  const Vzi = endForces[2]!;
  const Mxi = endForces[3]!;
  const Myi = endForces[4]!;
  const Mzi = endForces[5]!;

  // Extract local displacements
  const T = buildTransformationMatrix(member);
  const dofs = getMemberDofs(member.ni, member.nj);
  const dGlobal = new Float64Array(12);
  for (let i = 0; i < 12; i++) {
    dGlobal[i] = globalDisplacements[dofs[i]!]!;
  }
  const dLocal = transformVectorToLocal(dGlobal, T);
  // dLocal = [uxi, uyi, uzi, rxi, ryi, rzi, uxj, uyj, uzj, rxj, ryj, rzj]

  // Collect sample positions
  const sampleSet = new Set<number>();
  for (let i = 0; i <= NUM_SAMPLE_POINTS; i++) {
    sampleSet.add((i / NUM_SAMPLE_POINTS) * L);
  }

  // Add point load positions
  for (const ml of memberLoads) {
    if (ml.type === 'point') {
      sampleSet.add(ml.a);
      sampleSet.add(Math.max(0, ml.a - 1e-8));
      sampleSet.add(Math.min(L, ml.a + 1e-8));
    }
  }

  sampleSet.add(0);
  sampleSet.add(L);

  const positions = Array.from(sampleSet)
    .filter((x) => x >= 0 && x <= L)
    .sort((a, b) => a - b);

  // Classify loads
  const axialUDLs = memberLoads.filter(ml => ml.type === 'udl' && ml.direction === 'localX');
  const yUDLs = memberLoads.filter(ml => ml.type === 'udl' && ml.direction === 'localY');
  const zUDLs = memberLoads.filter(ml => ml.type === 'udl' && ml.direction === 'localZ');
  const axialPoints = memberLoads.filter(ml => ml.type === 'point' && ml.direction === 'localX');
  const yPoints = memberLoads.filter(ml => ml.type === 'point' && ml.direction === 'localY');
  const zPoints = memberLoads.filter(ml => ml.type === 'point' && ml.direction === 'localZ');

  const points: DiagramPoint[] = positions.map((x) => {
    // Axial force
    let N = Nxi;
    for (const udl of axialUDLs) {
      if (udl.type === 'udl') N += udl.value * x;
    }
    for (const pl of axialPoints) {
      if (pl.type === 'point' && x >= pl.a) N += pl.value;
    }

    // Shear Vy
    let Vy = Vyi;
    for (const udl of yUDLs) {
      if (udl.type === 'udl') Vy += udl.value * x;
    }
    for (const pl of yPoints) {
      if (pl.type === 'point' && x >= pl.a) Vy += pl.value;
    }

    // Shear Vz
    let Vz = Vzi;
    for (const udl of zUDLs) {
      if (udl.type === 'udl') Vz += udl.value * x;
    }
    for (const pl of zPoints) {
      if (pl.type === 'point' && x >= pl.a) Vz += pl.value;
    }

    // Torsion Mx (constant if no distributed torque)
    const Mx = Mxi;

    // Bending My (XZ plane): My(x) = Myi + Vzi*x + ...
    let My = Myi + Vzi * x;
    for (const udl of zUDLs) {
      if (udl.type === 'udl') My += (udl.value * x * x) / 2;
    }
    for (const pl of zPoints) {
      if (pl.type === 'point' && x >= pl.a) My += pl.value * (x - pl.a);
    }

    // Bending Mz (XY plane): Mz(x) = Mzi - Vyi*x - ...
    let Mz = Mzi - Vyi * x;
    for (const udl of yUDLs) {
      if (udl.type === 'udl') Mz -= (udl.value * x * x) / 2;
    }
    for (const pl of yPoints) {
      if (pl.type === 'point' && x >= pl.a) Mz -= pl.value * (x - pl.a);
    }

    // Displacement interpolation
    const xi = L > 0 ? x / L : 0;

    // Axial: linear
    const ux = dLocal[0]! * (1 - xi) + dLocal[6]! * xi;

    // Transverse Y: Timoshenko with phi_z, DOFs 1(uyi),5(rzi),7(uyj),11(rzj)
    const [h1z, h2z, h3z, h4z] = timoshenkoShape(xi, L, phiZ);
    const uy = dLocal[1]! * h1z + dLocal[5]! * h2z +
               dLocal[7]! * h3z + dLocal[11]! * h4z;

    // Transverse Z: Timoshenko with phi_y, DOFs 2(uzi),4(ryi),8(uzj),10(ryj)
    // Note: rotation coupling sign is accounted for in the shape function signs
    const [h1y, h2y, h3y, h4y] = timoshenkoShape(xi, L, phiY);
    const uz = dLocal[2]! * h1y + (-dLocal[4]!) * h2y +
               dLocal[8]! * h3y + (-dLocal[10]!) * h4y;

    return { x, N, Vy, Vz, Mx, My, Mz, ux, uy, uz };
  });

  return { memberId: id, points };
}

/**
 * Generate diagrams for all members.
 */
export function generateAllDiagrams(
  model: IndexedModel,
  elementEndForces: Map<string, Float64Array>,
  globalDisplacements: Float64Array
): Map<string, DiagramSeries> {
  const diagrams = new Map<string, DiagramSeries>();

  for (const member of model.members) {
    const endForces = elementEndForces.get(member.id);
    if (!endForces) continue;

    const memberLoads = model.memberLoads.filter(
      (ml) => ml.memberId === member.id
    );
    const diagram = generateDiagram(
      member,
      endForces,
      memberLoads,
      globalDisplacements
    );
    diagrams.set(member.id, diagram);
  }

  return diagrams;
}
