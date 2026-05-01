export class SingularMatrixError extends Error {
  readonly pivotIndex: number;
  readonly pivotValue: number;

  constructor(message: string, pivotIndex: number, pivotValue: number) {
    super(message);
    this.name = 'SingularMatrixError';
    this.pivotIndex = pivotIndex;
    this.pivotValue = pivotValue;
  }
}

/**
 * Solve a symmetric positive-definite system Ax = b using LDLᵀ decomposition.
 * A is n×n row-major Float64Array, b is n-element Float64Array.
 * Returns the solution x as a new Float64Array.
 *
 * The matrix A is modified in-place during factorization.
 */
export function solveLDLt(
  A: Float64Array,
  b: Float64Array,
  n: number
): Float64Array {
  // LDLᵀ factorization in-place
  // After factorization:
  //   diagonal of A contains D
  //   lower triangle of A contains L (unit lower triangular)
  const PIVOT_TOL = 1e-12;

  for (let j = 0; j < n; j++) {
    // Compute D[j]
    let dj = A[j * n + j]!;
    for (let k = 0; k < j; k++) {
      const ljk = A[j * n + k]!;
      dj -= ljk * ljk * A[k * n + k]!;
    }

    if (Math.abs(dj) < PIVOT_TOL) {
      throw new SingularMatrixError(
        `剛性マトリクスが特異です（ピボット ${j} が ${dj.toExponential(3)}）。拘束条件を確認してください。`,
        j,
        dj
      );
    }

    A[j * n + j] = dj;

    // Compute L[i][j] for i > j
    for (let i = j + 1; i < n; i++) {
      let lij = A[i * n + j]!;
      for (let k = 0; k < j; k++) {
        lij -= A[i * n + k]! * A[j * n + k]! * A[k * n + k]!;
      }
      A[i * n + j] = lij / dj;
    }
  }

  // Forward substitution: L y = b
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let j = 0; j < i; j++) {
      sum -= A[i * n + j]! * y[j]!;
    }
    y[i] = sum;
  }

  // Diagonal solve: D z = y
  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    z[i] = y[i]! / A[i * n + i]!;
  }

  // Back substitution: Lᵀ x = z
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = z[i]!;
    for (let j = i + 1; j < n; j++) {
      sum -= A[j * n + i]! * x[j]!; // Lᵀ[i][j] = L[j][i]
    }
    x[i] = sum;
  }

  return x;
}
