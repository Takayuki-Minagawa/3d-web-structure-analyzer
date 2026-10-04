import { afterEach, describe, expect, it, vi } from 'vitest';
import * as assembly from '../../core/analysis/assembly';
import { MAX_STATIC_TOTAL_DOFS, prepareStaticSystem } from '../../core/analysis/staticSolver';
import { buildIndexedModel } from '../../core/model/indexing';
import type { ProjectModel } from '../../core/model/types';
import { createAnalysisResponse } from '../../worker/analysisRequestHandler';

const FIXED = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

/** Axial bar with unit stiffness, so its end displacement equals its load. */
function axialBar(): ProjectModel {
  return {
    title: 'Static numerical safety',
    nodes: [
      { id: 'n1', x: 0, y: 0, z: 0, restraint: { ...FIXED } },
      { id: 'n2', x: 1, y: 0, z: 0, restraint: { ...FIXED, ux: false } },
    ],
    materials: [{ id: 'mat', name: 'Test', E: 1, G: 1, nu: 0.25, expansion: 0 }],
    sections: [{
      id: 'sec', name: 'Test', materialId: 'mat',
      A: 1, Ix: 1, Iy: 1, Iz: 1, ky: 0, kz: 0,
    }],
    springs: [],
    members: [{
      id: 'm1', ni: 'n1', nj: 'n2', sectionId: 'sec', codeAngle: 0,
      iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 },
    }],
    couplings: [],
    nodalLoads: [{
      id: 'f1', loadCaseId: 'case', nodeId: 'n2',
      fx: 1e308, fy: 0, fz: 0, mx: 0, my: 0, mz: 0,
    }],
    memberLoads: [],
    loadCases: [{ id: 'case', name: 'Case' }],
    units: { force: 'N', length: 'm', moment: 'N m' },
  };
}

function doubleCombination(model: ProjectModel): void {
  model.loadCombinations = [{
    id: 'double', name: 'Double', factors: [{ loadCaseId: 'case', factor: 2 }],
  }];
}

function supportMovement(model: ProjectModel): void {
  model.nodes[1]!.restraint = { ...FIXED };
  model.nodalLoads = [];
  model.prescribedDisplacements = [{
    id: 'movement', loadCaseId: 'case', nodeId: 'n2',
    ux: 1e308, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0,
  }];
}

function expectNumericalFailure(model: ProjectModel, quantity: string): void {
  const { response, transferables } = createAnalysisResponse({
    type: 'analyze-all', requestId: 'overflow', model,
  });
  expect(response).toMatchObject({
    type: 'analyze-error', requestId: 'overflow',
    error: { type: 'numerical', message: expect.stringContaining(quantity) },
  });
  expect(transferables).toEqual([]);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('static analysis resource limits', () => {
  it('rejects an oversized restrained model before allocating a dense matrix', () => {
    const model = axialBar();
    const count = MAX_STATIC_TOTAL_DOFS / 6 + 1;
    model.nodes = Array.from({ length: count }, (_, index) => ({
      id: `n${index}`, x: index, y: 0, z: 0, restraint: { ...FIXED },
    }));
    const member = model.members[0]!;
    model.members = Array.from({ length: count - 1 }, (_, index) => ({
      ...member, id: `m${index}`, ni: `n${index}`, nj: `n${index + 1}`,
    }));
    model.nodalLoads = [];
    const indexed = buildIndexedModel(model);
    const assemble = vi.spyOn(assembly, 'assembleGlobalStiffness');

    expect(() => prepareStaticSystem(indexed)).toThrow('全体自由度数');
    expect(assemble).not.toHaveBeenCalled();
  });
});

describe('static analysis finite results', () => {
  it('still solves very large loads when all results remain finite', () => {
    const { response } = createAnalysisResponse({
      type: 'analyze-all', requestId: 'finite', model: axialBar(),
    });
    expect(response.type).toBe('analyze-all-success');
    if (response.type !== 'analyze-all-success') return;
    expect(response.results[0]!.displacements[6]).toBe(1e308);
    expect(response.results[0]!.reactions[0]).toBe(-1e308);
  });

  it('rejects overflow when a finite load is multiplied by a finite combination factor', () => {
    const model = axialBar();
    doubleCombination(model);
    expectNumericalFailure(model, '荷重ベクトル');
  });

  it('rejects overflow when individually finite loads are summed', () => {
    const model = axialBar();
    model.nodalLoads.push({ ...model.nodalLoads[0]!, id: 'f2' });
    expectNumericalFailure(model, '荷重ベクトル');
  });

  it('rejects a non-finite solution even when the input force vector is finite', () => {
    const model = axialBar();
    model.materials[0]!.E = 0.1;
    expectNumericalFailure(model, '節点変位');
  });

  it('rejects combination overflow in prescribed movement instead of discarding it as cancellation', () => {
    const model = axialBar();
    supportMovement(model);
    doubleCombination(model);
    expectNumericalFailure(model, '強制変位');
  });

  it('rejects overflow while summing prescribed movements on the same support', () => {
    const model = axialBar();
    supportMovement(model);
    model.prescribedDisplacements!.push({ ...model.prescribedDisplacements![0]!, id: 'movement2' });
    expectNumericalFailure(model, '強制変位の合計');
  });

  it('rejects overflow in reactions for finite imposed support movements', () => {
    const model = axialBar();
    supportMovement(model);
    model.materials[0]!.E = 10;
    expectNumericalFailure(model, '反力');
  });
});
