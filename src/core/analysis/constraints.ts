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
  const { dofMap } = model;

  // Collect fixity for each DOF from node restraints
  const isFixed = new Uint8Array(model.dofCount);

  for (const node of model.nodes) {
    const base = node.index * 6;
    const r = node.restraint;
    const flags = [r.ux, r.uy, r.uz, r.rx, r.ry, r.rz];
    for (let i = 0; i < 6; i++) {
      if (flags[i]) isFixed[base + i] = 1;
    }
  }

  // Propagate slave fixity to master DOFs:
  // if a slave DOF is fixed, the master DOF must also be fixed.
  for (let dof = 0; dof < model.dofCount; dof++) {
    if (dofMap[dof] !== dof && isFixed[dof]) {
      isFixed[dofMap[dof]!] = 1;
    }
  }

  // Partition master DOFs into free/fixed (skip slaves)
  const freeDofs: number[] = [];
  const fixedDofs: number[] = [];
  for (let dof = 0; dof < model.dofCount; dof++) {
    if (dofMap[dof] !== dof) continue; // slave
    if (isFixed[dof]) {
      fixedDofs.push(dof);
    } else {
      freeDofs.push(dof);
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
