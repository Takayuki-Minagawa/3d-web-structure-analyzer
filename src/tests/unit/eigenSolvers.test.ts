import { describe, expect, it } from 'vitest';
import { symmetricEigen } from '../../core/analysis/eigenSymmetric';
import { solveInverseGeneralizedEigen } from '../../core/analysis/generalizedEigen';
import {
  applyEndReleases,
  buildLocalStiffness,
  buildReleaseTransformation,
} from '../../core/analysis/element3dFrame';
import {
  buildLocalConsistentMass,
  buildLocalGeometricStiffness,
} from '../../core/analysis/elementMatrices';
import { transformToGlobal } from '../../core/analysis/transforms';
import { SingularMatrixError } from '../../core/analysis/solverDense';
import type { EndRelease, IndexedMember } from '../../core/model/types';

/** Deterministic pseudo-random numbers in [-1, 1). */
function createRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 2147483648 - 1;
  };
}

function randomSymmetric(n: number, seed: number): Float64Array {
  const random = createRandom(seed);
  const matrix = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const value = random();
      matrix[i * n + j] = value;
      matrix[j * n + i] = value;
    }
  }
  return matrix;
}

function multiply(matrix: Float64Array, vector: ArrayLike<number>, n: number): number[] {
  const result = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) result[i]! += matrix[i * n + j]! * vector[j]!;
  }
  return result;
}

function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

describe('symmetric eigen solver', () => {
  it('solves a 2x2 matrix exactly', () => {
    const { values, vectors } = symmetricEigen(new Float64Array([2, 1, 1, 2]), 2);
    expect(values[0]).toBeCloseTo(1, 14);
    expect(values[1]).toBeCloseTo(3, 14);
    expect(Math.abs(vectors[0]!)).toBeCloseTo(Math.SQRT1_2, 14);
    expect(vectors[0]! * vectors[1]!).toBeLessThan(0); // (1, -1) / √2
    expect(vectors[2]! * vectors[3]!).toBeGreaterThan(0); // (1, 1) / √2
  });

  it('returns ascending eigenvalues with orthonormal eigenvectors for a dense matrix', () => {
    const n = 40;
    const matrix = randomSymmetric(n, 12345);
    const original = new Float64Array(matrix);
    const { values, vectors } = symmetricEigen(matrix, n);

    expect(Array.from(matrix)).toEqual(Array.from(original)); // input untouched
    for (let k = 0; k < n; k++) {
      const vector = vectors.subarray(k * n, (k + 1) * n);
      const product = multiply(matrix, vector, n);
      for (let i = 0; i < n; i++) {
        expect(product[i]).toBeCloseTo(values[k]! * vector[i]!, 10);
      }
      if (k > 0) expect(values[k]!).toBeGreaterThanOrEqual(values[k - 1]!);
      for (let other = 0; other <= k; other++) {
        const otherVector = vectors.subarray(other * n, (other + 1) * n);
        expect(dot(vector, otherVector)).toBeCloseTo(other === k ? 1 : 0, 10);
      }
    }
    let trace = 0;
    for (let i = 0; i < n; i++) trace += matrix[i * n + i]!;
    expect(values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(trace, 10);
  });

  it('handles diagonal, repeated and trivial cases', () => {
    const diagonal = symmetricEigen(new Float64Array([5, 0, 0, 0, -2, 0, 0, 0, 3]), 3);
    expect(Array.from(diagonal.values)).toEqual([-2, 3, 5]);

    const identity = symmetricEigen(new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3);
    expect(Array.from(identity.values)).toEqual([1, 1, 1]);

    expect(Array.from(symmetricEigen(new Float64Array([7]), 1).values)).toEqual([7]);
    expect(symmetricEigen(new Float64Array(0), 0).values).toHaveLength(0);
  });
});

describe('inverse generalized eigen solver', () => {
  it('returns K-orthonormal eigenpairs of B φ = μ K φ in descending order', () => {
    const n = 12;
    // K = AᵀA + n·I is positive definite; B is an arbitrary symmetric (indefinite) matrix.
    const A = randomSymmetric(n, 777);
    const K = new Float64Array(n * n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let sum = i === j ? n : 0;
        for (let p = 0; p < n; p++) sum += A[p * n + i]! * A[p * n + j]!;
        K[i * n + j] = sum;
      }
    }
    const B = randomSymmetric(n, 4242);
    const { values, vectors } = solveInverseGeneralizedEigen(K, B, n);

    expect(values).toHaveLength(n);
    expect(values[0]!).toBeGreaterThan(0);
    expect(values[n - 1]!).toBeLessThan(0);
    for (let k = 0; k < n; k++) {
      const vector = vectors.subarray(k * n, (k + 1) * n);
      const Bv = multiply(B, vector, n);
      const Kv = multiply(K, vector, n);
      for (let i = 0; i < n; i++) expect(Bv[i]).toBeCloseTo(values[k]! * Kv[i]!, 10);
      expect(dot(vector, Kv)).toBeCloseTo(1, 10);
      if (k > 0) expect(values[k]!).toBeLessThanOrEqual(values[k - 1]!);
    }
  });

  it('tolerates a singular B and limits the number of returned vectors', () => {
    const K = new Float64Array([4, -1, 0, -1, 4, -1, 0, -1, 4]);
    const B = new Float64Array([0, 0, 0, 0, 2, 0, 0, 0, 0]); // only one DOF carries mass
    const { values, vectors } = solveInverseGeneralizedEigen(K, B, 3, 2);
    expect(values).toHaveLength(2);
    expect(vectors).toHaveLength(6);
    expect(values[0]!).toBeGreaterThan(0);
    expect(values[1]).toBeCloseTo(0, 14);
  });

  it('rejects a stiffness matrix that is not positive definite', () => {
    const K = new Float64Array([1, 2, 2, 1]);
    const B = new Float64Array([1, 0, 0, 1]);
    expect(() => solveInverseGeneralizedEigen(K, B, 2)).toThrow(SingularMatrixError);
  });
});

function createMember(releases: IndexedMember['releases'], density = 7.85): IndexedMember {
  return {
    index: 0, id: 'm', ni: 0, nj: 1,
    E: 205000, G: 79000, A: 30, Ix: 12, Iy: 900, Iz: 300, ky: 0.4, kz: 0.6,
    density, L: 250,
    lambda: new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
    releases,
  };
}

const RIGID: EndRelease = { type: 'rigid', kTheta: 0 };
const PIN: EndRelease = { type: 'pin', kTheta: 0 };

describe('release transformation and element matrices', () => {
  it('returns null without releases', () => {
    const member = createMember([RIGID, RIGID, RIGID, RIGID, RIGID, RIGID]);
    expect(buildReleaseTransformation(buildLocalStiffness(member), member.releases)).toBeNull();
  });

  it('reproduces the statically condensed stiffness for pinned ends', () => {
    const member = createMember([RIGID, PIN, PIN, PIN, PIN, RIGID]);
    const stiffness = buildLocalStiffness(member);
    const T = buildReleaseTransformation(stiffness, member.releases)!;
    const condensed = new Float64Array(stiffness);
    applyEndReleases(condensed, member.releases);
    const reduced = transformToGlobal(stiffness, T);
    const scale = Math.max(...Array.from(stiffness, Math.abs));
    for (let i = 0; i < 144; i++) {
      expect(reduced[i]! / scale).toBeCloseTo(condensed[i]! / scale, 11);
    }
  });

  it('adds the spring energy for a rotational spring release', () => {
    const kTheta = 4.0e5;
    const member = createMember([RIGID, RIGID, { type: 'spring', kTheta }, RIGID, RIGID, RIGID]);
    const stiffness = buildLocalStiffness(member);
    const T = buildReleaseTransformation(stiffness, member.releases)!;
    const condensed = new Float64Array(stiffness);
    applyEndReleases(condensed, member.releases);
    const reduced = transformToGlobal(stiffness, T);
    // Relative rotation across the spring: θ_member - θ_node = (T[p,:] - e_p) d.
    const p = 5;
    const relative = Array.from({ length: 12 }, (_, j) => T[p * 12 + j]! - (j === p ? 1 : 0));
    const scale = Math.max(...Array.from(stiffness, Math.abs));
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) {
        const expected = reduced[i * 12 + j]! + kTheta * relative[i]! * relative[j]!;
        expect(expected / scale).toBeCloseTo(condensed[i * 12 + j]! / scale, 11);
      }
    }
  });

  it('builds a symmetric consistent mass matrix that conserves the member mass', () => {
    const member = createMember([RIGID, RIGID, RIGID, RIGID, RIGID, RIGID]);
    const mass = buildLocalConsistentMass(member);
    const total = member.density! * member.A * member.L;
    for (let i = 0; i < 12; i++) {
      for (let j = 0; j < 12; j++) expect(mass[i * 12 + j]).toBe(mass[j * 12 + i]);
    }
    // Rigid translation in each local direction carries the full mass.
    for (const [a, b] of [[0, 6], [1, 7], [2, 8]] as const) {
      const sum = mass[a * 12 + a]! + mass[a * 12 + b]! + mass[b * 12 + a]! + mass[b * 12 + b]!;
      expect(sum).toBeCloseTo(total, 8);
    }
    expect(Array.from(buildLocalConsistentMass(createMember(member.releases, 0))).every((v) => v === 0)).toBe(true);
  });

  it('builds a geometric stiffness matrix with no rigid-translation or rigid-rotation energy', () => {
    const member = createMember([RIGID, RIGID, RIGID, RIGID, RIGID, RIGID]);
    const kg = buildLocalGeometricStiffness(member, -120);
    const L = member.L;
    const rigidModes = [
      [0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0], // translation in y
      [0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0], // translation in z
    ];
    for (const mode of rigidModes) {
      expect(Math.max(...multiply(kg, mode, 12).map(Math.abs))).toBeLessThan(1e-12);
    }
    // A rigid rotation about z tilts the axial force: transverse force N·θ at each end.
    const rotationZ = [0, 0, 0, 0, 0, 1, 0, L, 0, 0, 0, 1];
    const force = multiply(kg, rotationZ, 12);
    expect(force[1]).toBeCloseTo(120, 9);
    expect(force[7]).toBeCloseTo(-120, 9);
    expect(force[5]).toBeCloseTo(0, 9);
    // The same rotation about y moves the j-end by -L in z.
    const rotationY = [0, 0, 0, 0, 1, 0, 0, 0, -L, 0, 1, 0];
    const forceY = multiply(kg, rotationY, 12);
    expect(forceY[2]).toBeCloseTo(-120, 9);
    expect(forceY[8]).toBeCloseTo(120, 9);
    expect(forceY[4]).toBeCloseTo(0, 9);
  });
});
