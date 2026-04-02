import type {
  AnalysisInput,
  AnalysisOutput,
  AnalysisError,
} from '../model/types';
import { assembleGlobalStiffness } from './assembly';
import { buildGlobalForceVector } from './loads';
import { partitionDofs, extractFreeSystem } from './constraints';
import { solveLDLt } from './solverDense';
import { computeReactions, computeAllElementEndForces } from './recover';
import { generateAllDiagrams } from './diagrams';

/**
 * Main analysis entry point.
 * Performs linear elastic 3D frame analysis.
 */
export function analyzeFrame(input: AnalysisInput): AnalysisOutput {
  const { model } = input;
  const warnings: string[] = [];
  const n = model.dofCount;

  // 1. Assemble global stiffness matrix
  const K = assembleGlobalStiffness(model);

  // 2. Build global force vector (nodal loads + equivalent nodal loads)
  const F = buildGlobalForceVector(model);

  // 3. Partition DOFs into free and fixed
  const { freeDofs, fixedDofs } = partitionDofs(model);

  // 4. Solve for free DOF displacements
  const d = new Float64Array(n);

  if (freeDofs.length > 0) {
    const { Kff, Ff } = extractFreeSystem(K, F, freeDofs, n);

    let df: Float64Array;
    try {
      df = solveLDLt(Kff, Ff, freeDofs.length);
    } catch (e) {
      throw createAnalysisError(
        'singular',
        e instanceof Error
          ? e.message
          : '剛性マトリクスが特異です。拘束条件を確認してください。'
      );
    }

    for (let i = 0; i < freeDofs.length; i++) {
      d[freeDofs[i]!] = df[i]!;
    }
  }

  // 5. Copy master displacements to slave DOFs (coupling)
  const { dofMap } = model;
  for (let i = 0; i < n; i++) {
    if (dofMap[i] !== i) {
      d[i] = d[dofMap[i]!]!;
    }
  }

  // 6. Compute reactions
  const reactions = computeReactions(K, d, F, n, fixedDofs);

  // 6. Compute element end forces
  const elementEndForces = computeAllElementEndForces(model, d);

  // 7. Generate diagrams
  const diagrams = generateAllDiagrams(model, elementEndForces, d);

  // 8. Check for warnings
  for (let i = 0; i < n; i++) {
    if (Math.abs(d[i]!) > 1e6) {
      warnings.push(
        `自由度 ${i} の変位が非常に大きくなっています (${d[i]!.toExponential(3)})。モデルを確認してください。`
      );
      break;
    }
  }

  return {
    displacements: d,
    reactions,
    elementEndForces,
    diagrams,
    warnings,
  };
}

function createAnalysisError(
  type: AnalysisError['type'],
  message: string
): AnalysisError & Error {
  const err = new Error(message) as AnalysisError & Error;
  err.type = type;
  return err;
}
