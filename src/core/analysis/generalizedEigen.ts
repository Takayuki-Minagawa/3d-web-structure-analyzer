import { factorLDLt } from './solverDense';
import { symmetricEigen } from './eigenSymmetric';

export interface InverseEigenResult {
  /** Eigenvalues μ of B φ = μ K φ in descending order. */
  values: Float64Array;
  /**
   * K-orthonormal eigenvectors (φᵀ K φ = 1, hence φᵀ B φ = μ), one per row:
   * `vectors[k * n + i]` is component i of the vector paired with `values[k]`.
   */
  vectors: Float64Array;
  /** Largest |μ| of the full spectrum; the scale for judging numerical zeros. */
  spectralRadius: number;
  n: number;
}

/**
 * Solve the symmetric generalized eigenproblem B φ = μ K φ for a positive
 * definite K and an arbitrary symmetric B.
 *
 * With K = L D Lᵀ and S = L D^½ the problem reduces to the standard symmetric
 * problem (S⁻¹ B S⁻ᵀ) y = μ y with φ = S⁻ᵀ y. Posing vibration (B = M,
 * μ = 1/ω²) and buckling (B = -Kg, μ = 1/λ) in this inverse form tolerates a
 * singular mass matrix and an indefinite geometric stiffness matrix.
 *
 * `count` limits how many of the largest eigenpairs get their vectors
 * back-transformed. Throws SingularMatrixError when K is not positive definite.
 */
export function solveInverseGeneralizedEigen(
  K: Float64Array,
  B: Float64Array,
  n: number,
  count = n
): InverseEigenResult {
  if (n === 0) {
    return { values: new Float64Array(0), vectors: new Float64Array(0), spectralRadius: 0, n };
  }

  const { factors } = factorLDLt(new Float64Array(K.subarray(0, n * n)), n);
  const scale = new Float64Array(n);
  for (let i = 0; i < n; i++) scale[i] = 1 / Math.sqrt(factors[i * n + i]!);

  // C = D^-½ L⁻¹ B L⁻ᵀ D^-½, built as two forward solves around a transpose.
  const C = new Float64Array(B.subarray(0, n * n));
  forwardSolveRows(factors, C, n);
  transposeInPlace(C, n);
  forwardSolveRows(factors, C, n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      // Symmetrize explicitly to remove round-off asymmetry.
      const value = 0.5 * (C[i * n + j]! + C[j * n + i]!) * scale[i]! * scale[j]!;
      C[i * n + j] = value;
      C[j * n + i] = value;
    }
  }

  const eigen = symmetricEigen(C, n);
  const kept = Math.max(0, Math.min(count, n));
  const values = new Float64Array(kept);
  const vectors = new Float64Array(kept * n);
  for (let k = 0; k < kept; k++) {
    const source = (n - 1 - k) * n; // ascending -> descending
    values[k] = eigen.values[n - 1 - k]!;
    const target = k * n;
    // φ = L⁻ᵀ D^-½ y
    for (let i = n - 1; i >= 0; i--) {
      let sum = eigen.vectors[source + i]! * scale[i]!;
      for (let j = i + 1; j < n; j++) sum -= factors[j * n + i]! * vectors[target + j]!;
      vectors[target + i] = sum;
    }
  }
  const spectralRadius = Math.max(Math.abs(eigen.values[0]!), Math.abs(eigen.values[n - 1]!));
  return { values, vectors, spectralRadius, n };
}

/** Overwrite X with L⁻¹ X for the unit lower triangle stored in `factors`. */
function forwardSolveRows(factors: Float64Array, X: Float64Array, n: number): void {
  for (let i = 1; i < n; i++) {
    const row = i * n;
    for (let j = 0; j < i; j++) {
      const lij = factors[row + j]!;
      if (lij === 0) continue;
      const source = j * n;
      for (let k = 0; k < n; k++) X[row + k] = X[row + k]! - lij * X[source + k]!;
    }
  }
}

function transposeInPlace(matrix: Float64Array, n: number): void {
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const swap = matrix[i * n + j]!;
      matrix[i * n + j] = matrix[j * n + i]!;
      matrix[j * n + i] = swap;
    }
  }
}
