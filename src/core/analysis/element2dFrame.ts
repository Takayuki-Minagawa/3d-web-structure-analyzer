import type { IndexedMember } from '../model/types';

/**
 * Build 6x6 local stiffness matrix for a 2D Timoshenko frame element.
 * Includes axial deformation (EA/L) and shear deformation (via Φ parameter).
 * DOF order: [uix, uiy, rzi, ujx, ujy, rzj]
 *
 * Φ = 12EI / (G·As·L²)  — shear deformation parameter
 * When Φ = 0, reduces to Euler-Bernoulli beam.
 */
export function buildLocalStiffness(
  member: IndexedMember
): Float64Array {
  const { E, A, I, L, G, As } = member;
  const k = new Float64Array(36); // 6x6 row-major

  const EA_L = (E * A) / L;

  // Shear deformation parameter
  const phi = (G > 0 && As > 0) ? (12 * E * I) / (G * As * L * L) : 0;
  const denom = 1 + phi;

  const EI_L3 = (E * I) / (L * L * L);
  const EI_L2 = (E * I) / (L * L);
  const EI_L = (E * I) / L;

  // Row 0: axial
  k[0] = EA_L;
  k[3] = -EA_L;

  // Row 1: [0, 12EI/L³/(1+Φ), 6EI/L²/(1+Φ), 0, -12EI/L³/(1+Φ), 6EI/L²/(1+Φ)]
  k[7] = 12 * EI_L3 / denom;
  k[8] = 6 * EI_L2 / denom;
  k[10] = -12 * EI_L3 / denom;
  k[11] = 6 * EI_L2 / denom;

  // Row 2: [0, 6EI/L²/(1+Φ), (4+Φ)EI/L/(1+Φ), 0, -6EI/L²/(1+Φ), (2-Φ)EI/L/(1+Φ)]
  k[13] = 6 * EI_L2 / denom;
  k[14] = (4 + phi) * EI_L / denom;
  k[16] = -6 * EI_L2 / denom;
  k[17] = (2 - phi) * EI_L / denom;

  // Row 3: axial
  k[18] = -EA_L;
  k[21] = EA_L;

  // Row 4: [0, -12EI/L³/(1+Φ), -6EI/L²/(1+Φ), 0, 12EI/L³/(1+Φ), -6EI/L²/(1+Φ)]
  k[25] = -12 * EI_L3 / denom;
  k[26] = -6 * EI_L2 / denom;
  k[28] = 12 * EI_L3 / denom;
  k[29] = -6 * EI_L2 / denom;

  // Row 5: [0, 6EI/L²/(1+Φ), (2-Φ)EI/L/(1+Φ), 0, -6EI/L²/(1+Φ), (4+Φ)EI/L/(1+Φ)]
  k[31] = 6 * EI_L2 / denom;
  k[32] = (2 - phi) * EI_L / denom;
  k[34] = -6 * EI_L2 / denom;
  k[35] = (4 + phi) * EI_L / denom;

  return k;
}

/**
 * Compute shear deformation parameter Φ = 12EI/(G·As·L²).
 */
export function computePhi(member: IndexedMember): number {
  const { E, I, G, As, L } = member;
  if (G <= 0 || As <= 0) return 0;
  return (12 * E * I) / (G * As * L * L);
}
