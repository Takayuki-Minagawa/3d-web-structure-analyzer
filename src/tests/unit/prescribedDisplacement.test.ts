import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeFrame } from '../../core/analysis/analyzeFrame';
import { analyzeAllLoadTargets } from '../../core/analysis/analyzeLoadTargets';
import { buildIndexedModel } from '../../core/model/indexing';
import { resolveAnalysisLoadModel } from '../../core/model/loadCases';
import { validateModel } from '../../core/model/validation';
import { parseProjectFile } from '../../io/projectFileParser';
import { createDefaultModel, useProjectStore } from '../../state/projectStore';
import type {
  PrescribedDisplacement,
  ProjectModel,
  Restraint,
} from '../../core/model/types';

const FREE: Restraint = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
const FIXED: Restraint = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const L = 5;
const E = 200e6;
const Iz = 4e-6;
const EI = E * Iz;

function settlement(overrides: Partial<PrescribedDisplacement>): PrescribedDisplacement {
  return { id: 'pd', nodeId: 'j', ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0, ...overrides };
}

function beam(jRestraint: Restraint, prescribed: PrescribedDisplacement[]): ProjectModel {
  return {
    title: 'Settlement',
    nodes: [
      { id: 'i', x: 0, y: 0, z: 0, restraint: FIXED },
      { id: 'j', x: L, y: 0, z: 0, restraint: jRestraint },
    ],
    materials: [{ id: 'mat', name: 'Steel', E, G: 80e6, nu: 0.25, expansion: 0 }],
    sections: [{
      id: 'sec', name: 'Section', materialId: 'mat',
      A: 0.01, Ix: 1e-5, Iy: 2e-5, Iz, ky: 0, kz: 0,
    }],
    springs: [],
    members: [{
      id: 'beam', ni: 'i', nj: 'j', sectionId: 'sec', codeAngle: 0,
      iSprings: { x: 0, y: 0, z: 0 },
      jSprings: { x: 0, y: 0, z: 0 },
    }],
    couplings: [],
    nodalLoads: [],
    memberLoads: [],
    prescribedDisplacements: prescribed,
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

function analyze(model: ProjectModel) {
  expect(validateModel(model)).toEqual([]);
  return analyzeFrame({ model: buildIndexedModel(resolveAnalysisLoadModel(model)) });
}

describe('prescribed support displacements', () => {
  it('produces 12EIδ/L³ and 6EIδ/L² for a fixed-fixed beam with end settlement', () => {
    const delta = -0.01;
    const result = analyze(beam(FIXED, [settlement({ uy: delta })]));

    expect(result.displacements[7]).toBe(delta);
    expect(result.reactions[7]).toBeCloseTo(12 * EI * delta / L ** 3, 8);
    expect(result.reactions[1]).toBeCloseTo(-12 * EI * delta / L ** 3, 8);
    expect(Math.abs(result.reactions[5]!)).toBeCloseTo(6 * EI * Math.abs(delta) / L ** 2, 8);
    expect(Math.abs(result.reactions[11]!)).toBeCloseTo(6 * EI * Math.abs(delta) / L ** 2, 8);

    const endForces = result.elementEndForces.get('beam')!;
    expect(Math.abs(endForces[1]!)).toBeCloseTo(12 * EI * Math.abs(delta) / L ** 3, 8);
    const diagram = result.diagrams.get('beam')!;
    expect(diagram.points[diagram.points.length - 1]!.uy).toBeCloseTo(delta, 12);
  });

  it('produces 3EIδ/L³ for a propped cantilever whose roller settles', () => {
    const delta = 0.02;
    const roller: Restraint = { ...FREE, uy: true };
    const result = analyze(beam(roller, [settlement({ uy: delta })]));

    expect(result.reactions[7]).toBeCloseTo(3 * EI * delta / L ** 3, 8);
    expect(Math.abs(result.reactions[5]!)).toBeCloseTo(3 * EI * delta / L ** 2, 8);
    // The free end rotation follows from the solved free DOF: 3δ/(2L).
    expect(result.displacements[11]).toBeCloseTo(3 * delta / (2 * L), 10);
  });

  it('produces 4EIθ/L and 2EIθ/L for a prescribed support rotation', () => {
    const theta = 0.004;
    const result = analyze(beam(FIXED, [settlement({ rz: theta })]));

    expect(result.reactions[11]).toBeCloseTo(4 * EI * theta / L, 8);
    expect(result.reactions[5]).toBeCloseTo(2 * EI * theta / L, 8);
  });

  it('superposes with loads and scales in load combinations', () => {
    const base = beam({ ...FREE, uy: true }, [settlement({ uy: -0.01, loadCaseId: 'settle' })]);
    const model: ProjectModel = {
      ...base,
      loadCases: [{ id: 'dead', name: 'Dead' }, { id: 'settle', name: 'Settlement' }],
      loadCombinations: [{
        id: 'combo', name: 'D + 2S',
        factors: [{ loadCaseId: 'dead', factor: 1 }, { loadCaseId: 'settle', factor: 2 }],
      }],
      memberLoads: [{
        id: 'udl', loadCaseId: 'dead', memberId: 'beam', type: 'udl', direction: 'localY', value: -6,
      }],
    };
    const { results, factorizationCount } = analyzeAllLoadTargets(model);
    const byId = new Map(results.map((result) => [result.target.id, result]));
    const dead = byId.get('dead')!;
    const settle = byId.get('settle')!;
    const combo = byId.get('combo')!;

    expect(factorizationCount).toBe(1);
    expect(dead.displacements[7]).toBe(0);
    expect(settle.displacements[7]).toBe(-0.01);
    expect(combo.displacements[7]).toBeCloseTo(-0.02, 14);
    for (const dof of [1, 5, 7, 11]) {
      expect(combo.reactions[dof]).toBeCloseTo(
        dead.reactions[dof]! + 2 * settle.reactions[dof]!,
        8
      );
    }
  });

  it('moves a coupled slave support together with its master', () => {
    const model = beam(FIXED, [settlement({ uy: -0.01 })]);
    model.nodes.push({ id: 'k', x: 2 * L, y: 0, z: 0, restraint: { ...FIXED, uy: false } });
    model.members.push({
      id: 'beam2', ni: 'j', nj: 'k', sectionId: 'sec', codeAngle: 0,
      iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 },
    });
    model.couplings = [{
      id: 'c', masterNodeId: 'j', slaveNodeId: 'k',
      ux: false, uy: true, uz: false, rx: false, ry: false, rz: false,
    }];
    const result = analyze(model);

    expect(result.displacements[7]).toBe(-0.01);
    expect(result.displacements[13]).toBe(-0.01);
    // The second span translates rigidly, so only the first span is stressed.
    const second = result.elementEndForces.get('beam2')!;
    expect(Math.max(...Array.from(second, Math.abs))).toBeLessThan(1e-9);
  });

  it('does not add the same settlement entered on two coupled supports', () => {
    const coupled = (kValue: number) => {
      const model = beam(FIXED, [
        settlement({ id: 'pd-j', uy: -0.01 }),
        settlement({ id: 'pd-k', nodeId: 'k', uy: kValue }),
      ]);
      model.nodes.push({ id: 'k', x: 2 * L, y: 0, z: 0, restraint: FIXED });
      model.members.push({
        id: 'beam2', ni: 'j', nj: 'k', sectionId: 'sec', codeAngle: 0,
        iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 },
      });
      model.couplings = [{
        id: 'c', masterNodeId: 'j', slaveNodeId: 'k',
        ux: false, uy: true, uz: false, rx: false, ry: false, rz: false,
      }];
      return model;
    };

    const result = analyze(coupled(-0.01));
    expect(result.displacements[7]).toBe(-0.01);
    expect(result.displacements[13]).toBe(-0.01);

    // Coupled supports cannot move by different amounts.
    const conflicting = coupled(-0.03);
    expect(() => analyzeFrame({ model: buildIndexedModel(conflicting) })).toThrow(/異なる値/);
  });

  it('adds entries on the same nodal DOF', () => {
    const result = analyze(beam(FIXED, [
      settlement({ id: 'a', uy: -0.01 }),
      settlement({ id: 'b', uy: -0.005 }),
    ]));
    expect(result.displacements[7]).toBeCloseTo(-0.015, 14);
  });

  it('rejects components on unrestrained DOFs and out-of-plane components in 2D', () => {
    const roller: Restraint = { ...FREE, uy: true };
    const onFreeDof = beam(roller, [settlement({ ux: 0.01 })]);
    expect(validateModel(onFreeDof).some((error) => error.message.includes('拘束されていない自由度'))).toBe(true);
    expect(() => analyzeFrame({ model: buildIndexedModel(onFreeDof) })).toThrow(/拘束されていない自由度/);

    const outOfPlane: ProjectModel = {
      ...beam(FIXED, [settlement({ uz: 0.01 })]),
      analysisMode: 'xy2d',
    };
    expect(validateModel(outOfPlane).some((error) => error.message.includes('面外成分'))).toBe(true);
  });

  it('round-trips through the project file parser and keeps older files loadable', () => {
    const model = beam(FIXED, [settlement({ uy: -0.01, loadCaseId: 'lc-default' })]);
    const parsed = parseProjectFile({
      schemaVersion: 2,
      savedAt: '2026-01-01T00:00:00.000Z',
      model: JSON.parse(JSON.stringify(model)),
    });
    expect(parsed.model.prescribedDisplacements).toEqual(model.prescribedDisplacements);

    const legacy = JSON.parse(JSON.stringify(model));
    delete legacy.prescribedDisplacements;
    const legacyParsed = parseProjectFile({
      schemaVersion: 2,
      savedAt: '2026-01-01T00:00:00.000Z',
      model: legacy,
    });
    expect(legacyParsed.model.prescribedDisplacements).toEqual([]);
    expect(legacyParsed.model.nodeMasses).toEqual([]);
  });
});

describe('prescribed displacement store operations', () => {
  beforeEach(() => {
    useProjectStore.getState().loadModel(createDefaultModel());
  });

  it('adds to the active load case and is removed with its node', () => {
    const store = useProjectStore.getState();
    const nodeId = store.addNode(0, 0, 0);
    store.updateNode(nodeId, { restraint: { ...FIXED } });
    const id = store.addPrescribedDisplacement({ nodeId, ux: 0, uy: 0, uz: -0.5, rx: 0, ry: 0, rz: 0 });
    store.addNodeMass({ nodeId, mass: 2 });

    let model = useProjectStore.getState().model;
    expect(model.prescribedDisplacements).toEqual([
      { id, nodeId, loadCaseId: model.activeLoadCaseId, ux: 0, uy: 0, uz: -0.5, rx: 0, ry: 0, rz: 0 },
    ]);
    expect(useProjectStore.getState().isResultStale).toBe(true);

    useProjectStore.getState().updatePrescribedDisplacement(id, { uz: -1 });
    expect(useProjectStore.getState().model.prescribedDisplacements?.[0]?.uz).toBe(-1);

    useProjectStore.getState().removeNode(nodeId);
    model = useProjectStore.getState().model;
    expect(model.prescribedDisplacements).toEqual([]);
    expect(model.nodeMasses).toEqual([]);
  });

  it('reassigns prescribed displacements when their load case is removed', () => {
    const store = useProjectStore.getState();
    const nodeId = store.addNode(0, 0, 0);
    const firstCase = useProjectStore.getState().model.activeLoadCaseId!;
    const secondCase = store.addLoadCase('Settlement');
    store.addPrescribedDisplacement({ nodeId, loadCaseId: secondCase, ux: 0, uy: 0, uz: 1, rx: 0, ry: 0, rz: 0 });
    useProjectStore.getState().removeLoadCase(secondCase);
    expect(useProjectStore.getState().model.prescribedDisplacements?.[0]?.loadCaseId).toBe(firstCase);
  });
});
