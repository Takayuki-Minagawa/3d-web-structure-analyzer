import type { IndexedMember, EndRelease } from '../model/types';

/**
 * Build 12x12 local stiffness matrix for a 3D Timoshenko frame element.
 *
 * DOF order: [uxi, uyi, uzi, rxi, ryi, rzi, uxj, uyj, uzj, rxj, ryj, rzj]
 *
 * Components:
 *   - Axial (DOF 0,6): EA/L
 *   - Torsion (DOF 3,9): GIx/L
 *   - Bending in XY plane (DOF 1,5,7,11): EIz with phi_z = 12EIz/(G*Asz*L^2)
 *   - Bending in XZ plane (DOF 2,4,8,10): EIy with phi_y = 12EIy/(G*Asy*L^2)
 */
export function buildLocalStiffness(member: IndexedMember): Float64Array {
  const { E, G, A, Ix, Iy, Iz, ky, kz, L } = member;
  const k = new Float64Array(144); // 12x12 row-major

  const EA_L = (E * A) / L;
  const GIx_L = (G * Ix) / L;

  // Shear deformation parameters
  const Asy = ky > 0 ? ky * A : 0;
  const Asz = kz > 0 ? kz * A : 0;
  const phi_y = (G > 0 && Asy > 0) ? (12 * E * Iy) / (G * Asy * L * L) : 0;
  const phi_z = (G > 0 && Asz > 0) ? (12 * E * Iz) / (G * Asz * L * L) : 0;

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
 * Compute shear deformation parameter for Y-bending: phi_y = 12EIy/(G*Asy*L^2)
 */
export function computePhiY(member: IndexedMember): number {
  const { E, Iy, G, ky, A, L } = member;
  const Asy = ky * A;
  if (G <= 0 || Asy <= 0) return 0;
  return (12 * E * Iy) / (G * Asy * L * L);
}

/**
 * Compute shear deformation parameter for Z-bending: phi_z = 12EIz/(G*Asz*L^2)
 */
export function computePhiZ(member: IndexedMember): number {
  const { E, Iz, G, kz, A, L } = member;
  const Asz = kz * A;
  if (G <= 0 || Asz <= 0) return 0;
  return (12 * E * Iz) / (G * Asz * L * L);
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
  const N = 12;
  for (let r = 0; r < releases.length; r++) {
    const rel = releases[r]!;
    if (rel.type === 'rigid') continue;

    const p = RELEASE_DOFS[r]!;
    const Kpp = k[p * N + p]!;
    if (Math.abs(Kpp) < 1e-30) continue; // already zero – nothing to condense

    if (rel.type === 'pin') {
      // Condense out DOF p (kθ = 0)
      for (let i = 0; i < N; i++) {
        if (i === p) continue;
        const Kip = k[i * N + p]!;
        if (Kip === 0) continue;
        for (let j = 0; j < N; j++) {
          if (j === p) continue;
          k[i * N + j] -= Kip * k[p * N + j]! / Kpp;
        }
      }
      // Zero out row and column p
      for (let i = 0; i < N; i++) {
        k[p * N + i] = 0;
        k[i * N + p] = 0;
      }
    } else {
      // Spring with finite stiffness kθ
      const kTh = rel.kTheta;
      const denom = Kpp + kTh;
      if (Math.abs(denom) < 1e-30) continue;

      // Off-diagonal condensation
      for (let i = 0; i < N; i++) {
        if (i === p) continue;
        const Kip = k[i * N + p]!;
        if (Kip === 0) continue;
        for (let j = 0; j < N; j++) {
          if (j === p) continue;
          k[i * N + j] -= Kip * k[p * N + j]! / denom;
        }
      }
      // Row p and column p
      for (let j = 0; j < N; j++) {
        if (j === p) continue;
        k[p * N + j] = kTh * k[p * N + j]! / denom;
        k[j * N + p] = kTh * k[j * N + p]! / denom;
      }
      // Diagonal
      k[p * N + p] = kTh * Kpp / denom;
    }
  }
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
  const N = 12;
  // Work on a copy of K since we condense sequentially
  const K = new Float64Array(kOrig);

  for (let r = 0; r < releases.length; r++) {
    const rel = releases[r]!;
    if (rel.type === 'rigid') continue;

    const p = RELEASE_DOFS[r]!;
    const Kpp = K[p * N + p]!;
    if (Math.abs(Kpp) < 1e-30) continue;

    if (rel.type === 'pin') {
      const fp = f[p]!;
      for (let i = 0; i < N; i++) {
        if (i === p) continue;
        f[i] -= K[i * N + p]! * fp / Kpp;
      }
      f[p] = 0;
      // Also condense K for subsequent releases
      for (let i = 0; i < N; i++) {
        if (i === p) continue;
        for (let j = 0; j < N; j++) {
          if (j === p) continue;
          K[i * N + j] -= K[i * N + p]! * K[p * N + j]! / Kpp;
        }
      }
      for (let i = 0; i < N; i++) { K[p * N + i] = 0; K[i * N + p] = 0; }
    } else {
      const kTh = rel.kTheta;
      const denom = Kpp + kTh;
      if (Math.abs(denom) < 1e-30) continue;

      const fp = f[p]!;
      for (let i = 0; i < N; i++) {
        if (i === p) continue;
        f[i] -= K[i * N + p]! * fp / denom;
      }
      f[p] = kTh * fp / denom;
      // Condense K for subsequent releases
      for (let i = 0; i < N; i++) {
        if (i === p) continue;
        for (let j = 0; j < N; j++) {
          if (j === p) continue;
          K[i * N + j] -= K[i * N + p]! * K[p * N + j]! / denom;
        }
      }
      for (let j = 0; j < N; j++) {
        if (j === p) continue;
        K[p * N + j] = kTh * K[p * N + j]! / denom;
        K[j * N + p] = kTh * K[j * N + p]! / denom;
      }
      K[p * N + p] = kTh * Kpp / denom;
    }
  }
}
