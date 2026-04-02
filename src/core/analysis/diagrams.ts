import type {
  IndexedModel,
  IndexedMember,
  MemberLoad,
  DiagramSeries,
  DiagramPoint,
} from '../model/types';
import { buildTransformationMatrix, transformVectorToLocal } from './transforms';
import { getMemberDofs } from './assembly';
import { computePhi } from './element2dFrame';

const NUM_SAMPLE_POINTS = 51;

/**
 * Timoshenko shape functions at xi = x/L with shear parameter Φ.
 * When Φ = 0, reduces to Hermite shape functions.
 */
function timoshenkoShape(xi: number, L: number, phi: number): [number, number, number, number] {
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
 * Generate section force diagrams for a single member.
 *
 * End forces convention (local):
 *   endForces = [Nxi, Vyi, Mzi, Nxj, Vyj, Mzj]
 *   where Nxi = axial force at i-end (positive = tension)
 *   Vyi = shear at i-end
 *   Mzi = moment at i-end
 *
 * Internal force sign convention (cutting plane from i-end):
 *   N(x) = axial force (positive = tension)
 *   V(x) = shear force
 *   M(x) = bending moment
 *
 * Equilibrium from i-end:
 *   N(x) = -Nxi + sum of applied axial loads from 0 to x
 *   Actually: we use the element end forces which already include load effects
 *   at the boundaries. So we build from the i-end reaction.
 *
 * Convention used here:
 *   N(x) positive = tension (member being pulled)
 *   V(x) = transverse shear
 *   M(x) = bending moment (positive causes bottom fiber tension for horizontal beam)
 */
export function generateDiagram(
  member: IndexedMember,
  endForces: Float64Array,
  memberLoads: MemberLoad[],
  globalDisplacements: Float64Array
): DiagramSeries {
  const { L, id } = member;
  const phi = computePhi(member);

  // End forces in local coordinates: [Nxi, Vyi, Mzi, Nxj, Vyj, Mzj]
  const Nxi = endForces[0]!;
  const Vyi = endForces[1]!;
  const Mzi = endForces[2]!;

  // Extract local displacements for displacement interpolation
  const T = buildTransformationMatrix(member);
  const dofs = getMemberDofs(member.ni, member.nj);
  const dGlobal = new Float64Array(6);
  for (let i = 0; i < 6; i++) {
    dGlobal[i] = globalDisplacements[dofs[i]!]!;
  }
  const dLocal = transformVectorToLocal(dGlobal, T);
  // dLocal = [uxi, uyi, rzi, uxj, uyj, rzj]

  // Collect sample positions
  const sampleSet = new Set<number>();

  // Regular sampling
  for (let i = 0; i <= NUM_SAMPLE_POINTS; i++) {
    sampleSet.add((i / NUM_SAMPLE_POINTS) * L);
  }

  // Add point load positions
  for (const ml of memberLoads) {
    if (ml.type === 'point') {
      sampleSet.add(ml.a);
      // Add points just before and after for discontinuity
      sampleSet.add(Math.max(0, ml.a - 1e-8));
      sampleSet.add(Math.min(L, ml.a + 1e-8));
    }
  }

  // Add endpoints
  sampleSet.add(0);
  sampleSet.add(L);

  const positions = Array.from(sampleSet)
    .filter((x) => x >= 0 && x <= L)
    .sort((a, b) => a - b);

  // Separate loads by type
  const axialUDLs = memberLoads.filter(
    (ml) => ml.type === 'udl' && ml.direction === 'localX'
  );
  const transverseUDLs = memberLoads.filter(
    (ml) => ml.type === 'udl' && ml.direction === 'localY'
  );
  const axialPoints = memberLoads.filter(
    (ml) => ml.type === 'point' && ml.direction === 'localX'
  );
  const transversePoints = memberLoads.filter(
    (ml) => ml.type === 'point' && ml.direction === 'localY'
  );

  const points: DiagramPoint[] = positions.map((x) => {
    // Internal forces from equilibrium at section x (measured from i-end)
    // Using i-end reactions and applied loads

    // Axial force: N(x) = Nxi + integral of qx dx + sum of Px applied before x
    let N = Nxi;
    for (const udl of axialUDLs) {
      if (udl.type === 'udl') {
        N += udl.value * x;
      }
    }
    for (const pl of axialPoints) {
      if (pl.type === 'point' && x >= pl.a) {
        N += pl.value;
      }
    }

    // Shear force: V(x) = Vyi + integral of qy dx + sum of Py applied before x
    let V = Vyi;
    for (const udl of transverseUDLs) {
      if (udl.type === 'udl') {
        V += udl.value * x;
      }
    }
    for (const pl of transversePoints) {
      if (pl.type === 'point' && x >= pl.a) {
        V += pl.value;
      }
    }

    // Bending moment: M(x) = Mzi - Vyi*x - integral of qy*x dx - sum of Py*(x-a)
    let M = Mzi - Vyi * x;
    for (const udl of transverseUDLs) {
      if (udl.type === 'udl') {
        M -= (udl.value * x * x) / 2;
      }
    }
    for (const pl of transversePoints) {
      if (pl.type === 'point' && x >= pl.a) {
        M -= pl.value * (x - pl.a);
      }
    }

    // Displacements: interpolate using Timoshenko shape functions
    const xi = L > 0 ? x / L : 0;

    // Axial displacement: linear interpolation
    const ux = dLocal[0]! * (1 - xi) + dLocal[3]! * xi;

    // Transverse displacement: Timoshenko interpolation (includes shear effect)
    const [h1, h2, h3, h4] = timoshenkoShape(xi, L, phi);
    const uy =
      dLocal[1]! * h1 +
      dLocal[2]! * h2 +
      dLocal[4]! * h3 +
      dLocal[5]! * h4;

    return { x, N, V, M, ux, uy };
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
