import type { IndexedMember } from '../model/types';

const SIZE = 12;

/** Local DOFs of the two bending planes: [v_i, θ_i, v_j, θ_j]. */
const BENDING_XY = [1, 5, 7, 11] as const; // uy, rz
const BENDING_XZ = [2, 4, 8, 10] as const; // uz, ry
/**
 * In the x-z plane the rotation DOF is ry = -dw/dx (right-hand rule), so
 * every translation/rotation coupling term changes sign relative to x-y.
 */
const SIGN_XY = [1, 1, 1, 1] as const;
const SIGN_XZ = [1, -1, 1, -1] as const;

function addBendingBlock(
  matrix: Float64Array,
  dofs: readonly number[],
  signs: readonly number[],
  factor: number,
  block: readonly (readonly number[])[]
): void {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      const index = dofs[i]! * SIZE + dofs[j]!;
      matrix[index] = matrix[index]! + factor * signs[i]! * signs[j]! * block[i]![j]!;
    }
  }
}

function addBarBlock(matrix: Float64Array, a: number, b: number, diagonal: number, offDiagonal: number): void {
  matrix[a * SIZE + a] = matrix[a * SIZE + a]! + diagonal;
  matrix[b * SIZE + b] = matrix[b * SIZE + b]! + diagonal;
  matrix[a * SIZE + b] = matrix[a * SIZE + b]! + offDiagonal;
  matrix[b * SIZE + a] = matrix[b * SIZE + a]! + offDiagonal;
}

/**
 * 12x12 consistent mass matrix of a prismatic 3D beam (local axes).
 *
 * Translational inertia uses the cubic Euler-Bernoulli shape functions
 * (ρAL/420 · [156, 22L, 54, -13L; ...]); axial and torsional inertia use
 * linear shapes, with the polar mass moment ρ(Iy + Iz) per unit length.
 * Rotatory inertia of the cross-section in bending is neglected.
 */
export function buildLocalConsistentMass(member: IndexedMember): Float64Array {
  const m = new Float64Array(SIZE * SIZE);
  const density = member.density ?? 0;
  if (!(density > 0)) return m;
  const { A, Iy, Iz, L } = member;
  const massPerLength = density * A;

  const axial = massPerLength * L / 6;
  addBarBlock(m, 0, 6, 2 * axial, axial);
  const torsional = density * (Iy + Iz) * L / 6;
  addBarBlock(m, 3, 9, 2 * torsional, torsional);

  const bending = [
    [156, 22 * L, 54, -13 * L],
    [22 * L, 4 * L * L, 13 * L, -3 * L * L],
    [54, 13 * L, 156, -22 * L],
    [-13 * L, -3 * L * L, -22 * L, 4 * L * L],
  ];
  const factor = massPerLength * L / 420;
  addBendingBlock(m, BENDING_XY, SIGN_XY, factor, bending);
  addBendingBlock(m, BENDING_XZ, SIGN_XZ, factor, bending);
  return m;
}

/**
 * 12x12 geometric (initial-stress) stiffness matrix of a 3D beam for the
 * axial force `axialForce` (tension positive), local axes.
 *
 * Only the flexural terms N/(30L) · [36, 3L, -36, 3L; ...] are included, so
 * the matrix captures flexural (Euler) buckling in both bending planes.
 * The torsional (Wagner) term is omitted on purpose: without warping
 * stiffness it would predict unrealistically low torsional buckling loads
 * for open sections.
 */
export function buildLocalGeometricStiffness(member: IndexedMember, axialForce: number): Float64Array {
  const kg = new Float64Array(SIZE * SIZE);
  if (axialForce === 0) return kg;
  const { L } = member;
  const bending = [
    [36, 3 * L, -36, 3 * L],
    [3 * L, 4 * L * L, -3 * L, -L * L],
    [-36, -3 * L, 36, -3 * L],
    [3 * L, -L * L, -3 * L, 4 * L * L],
  ];
  const factor = axialForce / (30 * L);
  addBendingBlock(kg, BENDING_XY, SIGN_XY, factor, bending);
  addBendingBlock(kg, BENDING_XZ, SIGN_XZ, factor, bending);
  return kg;
}
