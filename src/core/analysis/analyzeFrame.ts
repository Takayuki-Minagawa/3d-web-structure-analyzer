import type { AnalysisInput, AnalysisOutput } from '../model/types';
import { prepareStaticSystem, solveStaticLoadSet } from './staticSolver';

export { AnalysisException, createAnalysisException } from './analysisError';

/**
 * Main analysis entry point.
 * Performs linear elastic 3D frame analysis for the loads carried by `input.model`.
 */
export function analyzeFrame(input: AnalysisInput): AnalysisOutput {
  const { model } = input;
  return solveStaticLoadSet(prepareStaticSystem(model), model);
}
