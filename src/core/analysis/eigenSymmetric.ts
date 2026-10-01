/**
 * Dense symmetric eigenvalue solver: Householder tridiagonalization followed
 * by the implicit QL algorithm (the EISPACK tred2 / tql2 pair).
 *
 * Eigenvectors are stored one per row: `vectors[k * n + i]` is component i of
 * eigenvector k. Keeping each vector contiguous also makes the QL rotation
 * sweeps cache-friendly.
 */
export interface SymmetricEigenResult {
  /** Eigenvalues in ascending order. */
  values: Float64Array;
  /** Orthonormal eigenvectors, row k pairs with `values[k]`. */
  vectors: Float64Array;
  n: number;
}

const EPSILON = 2 ** -52;
const MAX_QL_ITERATIONS = 60;

export class EigenConvergenceError extends Error {
  constructor(index: number) {
    super(`固有値計算が収束しませんでした (index=${index})。`);
    this.name = 'EigenConvergenceError';
  }
}

/**
 * Compute all eigenpairs of the symmetric n×n matrix `matrix` (row-major).
 * Only symmetry is assumed; the input is not modified.
 */
export function symmetricEigen(matrix: Float64Array, n: number): SymmetricEigenResult {
  if (!Number.isInteger(n) || n < 0 || matrix.length < n * n) {
    throw new RangeError('Symmetric eigen solver dimensions are inconsistent.');
  }
  // z[i * n + k] holds V[k][i] of the classic row/column formulation, so a
  // column of V (one eigenvector) is a contiguous row of z. The input is
  // symmetric, which makes the initial copy identical either way.
  const z = new Float64Array(matrix.subarray(0, n * n));
  const d = new Float64Array(n);
  const e = new Float64Array(n);
  if (n === 0) return { values: d, vectors: z, n };

  tridiagonalize(z, d, e, n);
  diagonalize(z, d, e, n);
  return { values: d, vectors: z, n };
}

/** Householder reduction to tridiagonal form, accumulating the transform in z. */
function tridiagonalize(z: Float64Array, d: Float64Array, e: Float64Array, n: number): void {
  for (let j = 0; j < n; j++) d[j] = z[j * n + (n - 1)]!;

  for (let i = n - 1; i > 0; i--) {
    let scale = 0;
    let h = 0;
    for (let k = 0; k < i; k++) scale += Math.abs(d[k]!);

    if (scale === 0) {
      e[i] = d[i - 1]!;
      for (let j = 0; j < i; j++) {
        d[j] = z[j * n + (i - 1)]!;
        z[j * n + i] = 0;
        z[i * n + j] = 0;
      }
    } else {
      for (let k = 0; k < i; k++) {
        d[k] = d[k]! / scale;
        h += d[k]! * d[k]!;
      }
      let f = d[i - 1]!;
      let g = Math.sqrt(h);
      if (f > 0) g = -g;
      e[i] = scale * g;
      h -= f * g;
      d[i - 1] = f - g;
      for (let j = 0; j < i; j++) e[j] = 0;

      // Apply the similarity transformation to the remaining columns.
      for (let j = 0; j < i; j++) {
        f = d[j]!;
        z[i * n + j] = f;
        const column = j * n;
        g = e[j]! + z[column + j]! * f;
        for (let k = j + 1; k <= i - 1; k++) {
          g += z[column + k]! * d[k]!;
          e[k] = e[k]! + z[column + k]! * f;
        }
        e[j] = g;
      }
      f = 0;
      for (let j = 0; j < i; j++) {
        e[j] = e[j]! / h;
        f += e[j]! * d[j]!;
      }
      const hh = f / (h + h);
      for (let j = 0; j < i; j++) e[j] = e[j]! - hh * d[j]!;
      for (let j = 0; j < i; j++) {
        f = d[j]!;
        g = e[j]!;
        const column = j * n;
        for (let k = j; k <= i - 1; k++) {
          z[column + k] = z[column + k]! - (f * e[k]! + g * d[k]!);
        }
        d[j] = z[column + (i - 1)]!;
        z[column + i] = 0;
      }
    }
    d[i] = h;
  }

  // Accumulate the Householder transformations.
  for (let i = 0; i < n - 1; i++) {
    z[i * n + (n - 1)] = z[i * n + i]!;
    z[i * n + i] = 1;
    const h = d[i + 1]!;
    if (h !== 0) {
      const next = (i + 1) * n;
      for (let k = 0; k <= i; k++) d[k] = z[next + k]! / h;
      for (let j = 0; j <= i; j++) {
        const column = j * n;
        let g = 0;
        for (let k = 0; k <= i; k++) g += z[next + k]! * z[column + k]!;
        for (let k = 0; k <= i; k++) z[column + k] = z[column + k]! - g * d[k]!;
      }
    }
    for (let k = 0; k <= i; k++) z[(i + 1) * n + k] = 0;
  }
  for (let j = 0; j < n; j++) {
    d[j] = z[j * n + (n - 1)]!;
    z[j * n + (n - 1)] = 0;
  }
  z[(n - 1) * n + (n - 1)] = 1;
  e[0] = 0;
}

/** Implicit QL iteration on the tridiagonal form; sorts results ascending. */
function diagonalize(z: Float64Array, d: Float64Array, e: Float64Array, n: number): void {
  for (let i = 1; i < n; i++) e[i - 1] = e[i]!;
  e[n - 1] = 0;

  let f = 0;
  let tst1 = 0;
  for (let l = 0; l < n; l++) {
    // Find a negligible subdiagonal element.
    tst1 = Math.max(tst1, Math.abs(d[l]!) + Math.abs(e[l]!));
    let m = l;
    while (m < n - 1 && Math.abs(e[m]!) > EPSILON * tst1) m++;

    if (m > l) {
      let iteration = 0;
      do {
        if (++iteration > MAX_QL_ITERATIONS) throw new EigenConvergenceError(l);

        // Compute the implicit shift.
        let g = d[l]!;
        let p = (d[l + 1]! - g) / (2 * e[l]!);
        let r = Math.hypot(p, 1);
        if (p < 0) r = -r;
        d[l] = e[l]! / (p + r);
        d[l + 1] = e[l]! * (p + r);
        const dl1 = d[l + 1]!;
        let h = g - d[l]!;
        for (let i = l + 2; i < n; i++) d[i] = d[i]! - h;
        f += h;

        // Implicit QL transformation.
        p = d[m]!;
        let c = 1;
        let c2 = c;
        let c3 = c;
        const el1 = e[l + 1]!;
        let s = 0;
        let s2 = 0;
        for (let i = m - 1; i >= l; i--) {
          c3 = c2;
          c2 = c;
          s2 = s;
          g = c * e[i]!;
          h = c * p;
          r = Math.hypot(p, e[i]!);
          e[i + 1] = s * r;
          s = e[i]! / r;
          c = p / r;
          p = c * d[i]! - s * g;
          d[i + 1] = h + s * (c * g + s * d[i]!);

          // Accumulate the rotation into eigenvectors i and i + 1.
          const row = i * n;
          const nextRow = row + n;
          for (let k = 0; k < n; k++) {
            h = z[nextRow + k]!;
            z[nextRow + k] = s * z[row + k]! + c * h;
            z[row + k] = c * z[row + k]! - s * h;
          }
        }
        p = -s * s2 * c3 * el1 * e[l]! / dl1;
        e[l] = s * p;
        d[l] = c * p;
      } while (Math.abs(e[l]!) > EPSILON * tst1);
    }
    d[l] = d[l]! + f;
    e[l] = 0;
  }

  // Selection sort by eigenvalue, swapping whole eigenvector rows.
  for (let i = 0; i < n - 1; i++) {
    let k = i;
    let p = d[i]!;
    for (let j = i + 1; j < n; j++) {
      if (d[j]! < p) {
        k = j;
        p = d[j]!;
      }
    }
    if (k === i) continue;
    d[k] = d[i]!;
    d[i] = p;
    const rowI = i * n;
    const rowK = k * n;
    for (let j = 0; j < n; j++) {
      const swap = z[rowI + j]!;
      z[rowI + j] = z[rowK + j]!;
      z[rowK + j] = swap;
    }
  }
}
