import type { IndexedModel } from '../model/types';

/**
 * Identify free (unconstrained) and fixed (constrained) DOF indices.
 * DOF order per node: [ux, uy, uz, rx, ry, rz]
 *
 * Slave DOFs (coupled to a master) are excluded from both lists since
 * their contributions are already redirected to the master DOF during assembly.
 */
export function partitionDofs(model: IndexedModel): {
  freeDofs: number[];
  fixedDofs: number[];
} {
  const freeDofs: number[] = [];
  const fixedDofs: number[] = [];
  const { dofMap } = model;

  for (const node of model.nodes) {
    const base = node.index * 6;
    const r = node.restraint;
    const flags = [r.ux, r.uy, r.uz, r.rx, r.ry, r.rz];

    for (let i = 0; i < 6; i++) {
      const dof = base + i;
      // Skip slave DOFs (they are mapped to a different master DOF)
      if (dofMap[dof] !== dof) continue;

      if (flags[i]) {
        fixedDofs.push(dof);
      } else {
        freeDofs.push(dof);
      }
    }
  }

  return { freeDofs, fixedDofs };
}

/**
 * Extract the free-DOF submatrix from the full global stiffness matrix.
 */
export function extractFreeSystem(
  K: Float64Array,
  F: Float64Array,
  freeDofs: number[],
  n: number
): { Kff: Float64Array; Ff: Float64Array } {
  const nf = freeDofs.length;
  const Kff = new Float64Array(nf * nf);
  const Ff = new Float64Array(nf);

  for (let i = 0; i < nf; i++) {
    const gi = freeDofs[i]!;
    Ff[i] = F[gi]!;
    for (let j = 0; j < nf; j++) {
      const gj = freeDofs[j]!;
      Kff[i * nf + j] = K[gi * n + gj]!;
    }
  }

  return { Kff, Ff };
}
