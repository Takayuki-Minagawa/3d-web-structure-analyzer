import type { IndexedMember } from '../model/types';

const DOF = 12;

/**
 * Build 12x12 coordinate transformation matrix T from the member's 3x3 lambda.
 * T is block-diagonal: T = diag(lambda, lambda, lambda, lambda)
 *
 * Transforms from global to local: d_local = T * d_global
 */
export function buildTransformationMatrix(
  member: IndexedMember
): Float64Array {
  const lam = member.lambda; // 3x3 row-major
  const T = new Float64Array(DOF * DOF);

  // Fill 4 diagonal blocks of 3x3
  for (let block = 0; block < 4; block++) {
    const offset = block * 3;
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        T[(offset + i) * DOF + (offset + j)] = lam[i * 3 + j]!;
      }
    }
  }

  return T;
}

/**
 * Compute k_global = T^T * k_local * T
 * All matrices are 12x12 row-major Float64Array.
 */
export function transformToGlobal(
  kLocal: Float64Array,
  T: Float64Array
): Float64Array {
  const temp = new Float64Array(DOF * DOF);
  const kGlobal = new Float64Array(DOF * DOF);

  // temp = T^T * k_local
  for (let i = 0; i < DOF; i++) {
    for (let j = 0; j < DOF; j++) {
      let sum = 0;
      for (let p = 0; p < DOF; p++) {
        sum += T[p * DOF + i]! * kLocal[p * DOF + j]!;
      }
      temp[i * DOF + j] = sum;
    }
  }

  // kGlobal = temp * T
  for (let i = 0; i < DOF; i++) {
    for (let j = 0; j < DOF; j++) {
      let sum = 0;
      for (let p = 0; p < DOF; p++) {
        sum += temp[i * DOF + p]! * T[p * DOF + j]!;
      }
      kGlobal[i * DOF + j] = sum;
    }
  }

  return kGlobal;
}

/**
 * Transform a 12-element vector from local to global: f_global = T^T * f_local
 */
export function transformVectorToGlobal(
  fLocal: Float64Array,
  T: Float64Array
): Float64Array {
  const fGlobal = new Float64Array(DOF);
  for (let i = 0; i < DOF; i++) {
    let sum = 0;
    for (let p = 0; p < DOF; p++) {
      sum += T[p * DOF + i]! * fLocal[p]!;
    }
    fGlobal[i] = sum;
  }
  return fGlobal;
}

/**
 * Transform a 12-element vector from global to local: d_local = T * d_global
 */
export function transformVectorToLocal(
  dGlobal: Float64Array,
  T: Float64Array
): Float64Array {
  const dLocal = new Float64Array(DOF);
  for (let i = 0; i < DOF; i++) {
    let sum = 0;
    for (let p = 0; p < DOF; p++) {
      sum += T[i * DOF + p]! * dGlobal[p]!;
    }
    dLocal[i] = sum;
  }
  return dLocal;
}
