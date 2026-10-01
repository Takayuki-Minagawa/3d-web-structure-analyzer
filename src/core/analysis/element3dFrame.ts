import type { IndexedMember, EndRelease } from '../model/types';

/**
 * Build 12x12 local stiffness matrix for a 3D Timoshenko frame element.
 *
 * DOF order: [uxi, uyi, uzi, rxi, ryi, rzi, uxj, uyj, uzj, rxj, ryj, rzj]
 *
 * Components:
 *   - Axial (DOF 0,6): EA/L
 *   - Torsion (DOF 3,9): GIx/L
 *   - Bending in XY plane (DOF 1,5,7,11): EIz with phi_z = 12EIz/(G*(kz*A)*L^2)
 *   - Bending in XZ plane (DOF 2,4,8,10): EIy with phi_y = 12EIy/(G*(ky*A)*L^2)
 */
export function buildLocalStiffness(member: IndexedMember): Float64Array {
  const { E, G, A, Ix, Iy, Iz, L } = member;
  const k = new Float64Array(144); // 12x12 row-major

  const EA_L = (E * A) / L;
  const GIx_L = (G * Ix) / L;

  // Shear deformation parameters
  const phi_y = computePhiY(member);
  const phi_z = computePhiZ(member);

  // Bending in XY plane (uy, rz) - using EIz
  const dz = 1 + phi_z;
  const EIz_L3 = (E * Iz) / (L * L * L);
  const EIz_L2 = (E * Iz) / (L * L);
  const EIz_L = (E * Iz) / L;

  // Bending in XZ plane (uz, ry) - using EIy
  const dy = 1 + phi_y;
  const EIy_L3 = (E * Iy) / (L * L * L);
  const EIy_L2 = (E * Iy) / (L * L);
  const EIy_L = (E * Iy) / L;

  // Helper: set k[row][col] = val (12x12 row-major)
  const s = (r: number, c: number, v: number) => { k[r * 12 + c] = v; };

  // ── Axial: DOF 0, 6 ──
  s(0, 0,  EA_L);
  s(0, 6, -EA_L);
  s(6, 0, -EA_L);
  s(6, 6,  EA_L);

  // ── Torsion: DOF 3, 9 ──
  s(3, 3,  GIx_L);
  s(3, 9, -GIx_L);
  s(9, 3, -GIx_L);
  s(9, 9,  GIx_L);

  // ── Bending in XY plane: DOF 1(uy_i), 5(rz_i), 7(uy_j), 11(rz_j) ──
  // Same structure as the 2D Timoshenko beam
  const a1z = 12 * EIz_L3 / dz;
  const a2z = 6 * EIz_L2 / dz;
  const a3z = (4 + phi_z) * EIz_L / dz;
  const a4z = (2 - phi_z) * EIz_L / dz;

  // Row 1 (uy_i)
  s(1, 1,   a1z);
  s(1, 5,   a2z);
  s(1, 7,  -a1z);
  s(1, 11,  a2z);

  // Row 5 (rz_i)
  s(5, 1,   a2z);
  s(5, 5,   a3z);
  s(5, 7,  -a2z);
  s(5, 11,  a4z);

  // Row 7 (uy_j)
  s(7, 1,  -a1z);
  s(7, 5,  -a2z);
  s(7, 7,   a1z);
  s(7, 11, -a2z);

  // Row 11 (rz_j)
  s(11, 1,   a2z);
  s(11, 5,   a4z);
  s(11, 7,  -a2z);
  s(11, 11,  a3z);

  // ── Bending in XZ plane: DOF 2(uz_i), 4(ry_i), 8(uz_j), 10(ry_j) ──
  // Note: coupling signs are OPPOSITE to XY plane due to right-hand rule
  // Positive ry causes negative uz, so the coupling terms are negated
  const a1y = 12 * EIy_L3 / dy;
  const a2y = 6 * EIy_L2 / dy;
  const a3y = (4 + phi_y) * EIy_L / dy;
  const a4y = (2 - phi_y) * EIy_L / dy;

  // Row 2 (uz_i)
  s(2, 2,   a1y);
  s(2, 4,  -a2y);  // sign flip
  s(2, 8,  -a1y);
  s(2, 10, -a2y);  // sign flip

  // Row 4 (ry_i)
  s(4, 2,  -a2y);  // sign flip
  s(4, 4,   a3y);
  s(4, 8,   a2y);  // sign flip
  s(4, 10,  a4y);

  // Row 8 (uz_j)
  s(8, 2,  -a1y);
  s(8, 4,   a2y);  // sign flip
  s(8, 8,   a1y);
  s(8, 10,  a2y);  // sign flip

  // Row 10 (ry_j)
  s(10, 2,  -a2y);  // sign flip
  s(10, 4,   a4y);
  s(10, 8,   a2y);  // sign flip
  s(10, 10,  a3y);

  return k;
}

/**
 * Compute the shear deformation parameter for bending about local y.
 * In this model `ky*A` is the effective area for the accompanying local-z
 * shear force (the web direction of a conventionally oriented H section).
 */
export function computePhiY(member: IndexedMember): number {
  const { E, Iy, G, ky, A, L } = member;
  const shearAreaForBendingY = ky * A;
  if (G <= 0 || shearAreaForBendingY <= 0) return 0;
  return (12 * E * Iy) / (G * shearAreaForBendingY * L * L);
}

/**
 * Compute the shear deformation parameter for bending about local z.
 * In this model `kz*A` is the effective area for the accompanying local-y
 * shear force (the flange direction of a conventionally oriented H section).
 */
export function computePhiZ(member: IndexedMember): number {
  const { E, Iz, G, kz, A, L } = member;
  const shearAreaForBendingZ = kz * A;
  if (G <= 0 || shearAreaForBendingZ <= 0) return 0;
  return (12 * E * Iz) / (G * shearAreaForBendingZ * L * L);
}

/** Local DOF indices for the 6 end-release slots [ix, iy, iz, jx, jy, jz]. */
const RELEASE_DOFS = [3, 4, 5, 9, 10, 11] as const;

/**
 * Apply static condensation for member-end releases (pin / spring) to
 * a 12x12 local stiffness matrix **in place**.
 *
 * For DOF p with release:
 *   pin  (kθ=0):   K'[i,j] = K[i,j] - K[i,p]*K[p,j]/K[p,p],  row/col p → 0
 *   spring (kθ>0): K'[i,j] = K[i,j] - K[i,p]*K[p,j]/(K[p,p]+kθ)
 *                   K'[p,j] = kθ * K[p,j] / (K[p,p]+kθ)
 *                   K'[p,p] = kθ * K[p,p] / (K[p,p]+kθ)
 *
 * Releases are applied sequentially so that each subsequent condensation
 * operates on the already-modified matrix.
 */
export function applyEndReleases(k: Float64Array, releases: readonly EndRelease[]): void {
  condenseEndReleaseSystem(k, releases);
}

/**
 * Apply the same static condensation to a 12-element local force vector.
 *
 * For DOF p with release:
 *   pin:    f'[i] = f[i] - K[i,p]*f[p]/K[p,p],  f'[p] = 0
 *   spring: f'[i] = f[i] - K[i,p]*f[p]/(K[p,p]+kθ)
 *           f'[p] = kθ * f[p] / (K[p,p]+kθ)
 *
 * IMPORTANT: This must be called with the ORIGINAL (un-condensed) stiffness
 * matrix K_orig, before applyEndReleases modifies it.
 */
export function applyEndReleasesToForce(
  f: Float64Array,
  kOrig: Float64Array,
  releases: readonly EndRelease[]
): void {
  // Work on a copy because callers still need the original stiffness matrix.
  condenseEndReleaseSystem(new Float64Array(kOrig), releases, f);
}

const RIGID_RELEASE: EndRelease = { type: 'rigid', kTheta: 0 };

/**
 * Kinematic transformation behind the end-release condensation.
 *
 * Returns the 12x12 matrix T (row-major) mapping nodal DOFs to the member's
 * own end DOFs, d_member = T d_node, or null when no end is released. A
 * released member-end rotation follows from the remaining DOFs as
 *   θ_member = (kθ θ_node - Σ K[p,r] d_r) / (K[p,p] + kθ)
 * which is the Guyan reduction consistent with `applyEndReleases`: the
 * condensed stiffness equals Tᵀ K T plus the spring energy. The same T
 * reduces mass and geometric stiffness matrices and recovers member-end
 * rotations of load-free members.
 */
export function buildReleaseTransformation(
  kOrig: Float64Array,
  releases: readonly EndRelease[]
): Float64Array | null {
  if (releases.every((release) => release.type === 'rigid')) return null;
  const size = 12;
  const stiffness = new Float64Array(kOrig);
  const T = new Float64Array(size * size);
  for (let i = 0; i < size; i++) T[i * size + i] = 1;

  for (let releaseIndex = 0; releaseIndex < releases.length; releaseIndex++) {
    const release = releases[releaseIndex]!;
    if (release.type === 'rigid') continue;

    const releasedDof = RELEASE_DOFS[releaseIndex]!;
    const pivot = stiffness[releasedDof * size + releasedDof]!;
    if (Math.abs(pivot) < 1e-30) continue;
    const springStiffness = release.type === 'spring' ? release.kTheta : 0;
    const denominator = pivot + springStiffness;
    if (Math.abs(denominator) < 1e-30) continue;

    // Row p of this step's transformation; all other rows are identity.
    const stepRow = new Float64Array(size);
    for (let column = 0; column < size; column++) {
      stepRow[column] = column === releasedDof
        ? springStiffness / denominator
        : -stiffness[releasedDof * size + column]! / denominator;
    }
    // T <- T * T_step
    for (let row = 0; row < size; row++) {
      const factor = T[row * size + releasedDof]!;
      if (factor === 0) continue;
      T[row * size + releasedDof] = 0;
      for (let column = 0; column < size; column++) {
        T[row * size + column] = T[row * size + column]! + factor * stepRow[column]!;
      }
    }

    // Advance the working stiffness by exactly this one release.
    const single = releases.map((item, index) => (index === releaseIndex ? item : RIGID_RELEASE));
    condenseEndReleaseSystem(stiffness, single);
  }
  return T;
}

/**
 * Condense an augmented local system [K | f] in one sequential pass.
 * Passing no force vector condenses K only.
 */
function condenseEndReleaseSystem(
  stiffness: Float64Array,
  releases: readonly EndRelease[],
  force?: Float64Array
): void {
  const size = 12;

  for (let releaseIndex = 0; releaseIndex < releases.length; releaseIndex++) {
    const release = releases[releaseIndex]!;
    if (release.type === 'rigid') continue;

    const releasedDof = RELEASE_DOFS[releaseIndex]!;
    const pivot = stiffness[releasedDof * size + releasedDof]!;
    if (Math.abs(pivot) < 1e-30) continue;

    const springStiffness = release.type === 'spring' ? release.kTheta : 0;
    const denominator = pivot + springStiffness;
    if (Math.abs(denominator) < 1e-30) continue;

    if (force) {
      const releasedForce = force[releasedDof]!;
      for (let row = 0; row < size; row++) {
        if (row === releasedDof) continue;
        force[row] = force[row]!
          - stiffness[row * size + releasedDof]! * releasedForce / denominator;
      }
      force[releasedDof] = springStiffness * releasedForce / denominator;
    }

    for (let row = 0; row < size; row++) {
      if (row === releasedDof) continue;
      const coupling = stiffness[row * size + releasedDof]!;
      if (coupling === 0) continue;
      for (let column = 0; column < size; column++) {
        if (column === releasedDof) continue;
        stiffness[row * size + column] = stiffness[row * size + column]!
          - coupling * stiffness[releasedDof * size + column]! / denominator;
      }
    }

    for (let index = 0; index < size; index++) {
      if (index === releasedDof) continue;
      stiffness[releasedDof * size + index] = springStiffness
        * stiffness[releasedDof * size + index]! / denominator;
      stiffness[index * size + releasedDof] = springStiffness
        * stiffness[index * size + releasedDof]! / denominator;
    }
    stiffness[releasedDof * size + releasedDof] = springStiffness * pivot / denominator;
  }
}
