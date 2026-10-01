import { describe, expect, it } from 'vitest';
import { AnalysisException, analyzeFrame } from '../../core/analysis/analyzeFrame';
import { analyzeBuckling, analyzeModal } from '../../core/analysis/eigenAnalysis';
import { buildIndexedModel } from '../../core/model/indexing';
import { subdivideMembers } from '../../core/model/subdivide';
import type { AnalysisMode, ProjectModel, Restraint } from '../../core/model/types';

const FREE: Restraint = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
const FIXED: Restraint = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const L = 4;
const E = 2.0e8;
const A = 0.01;
const Iy = 8.0e-6; // bending in the X-Z plane for a member along X
const Iz = 2.0e-6;
const DENSITY = 7.85;

interface BarOptions {
  iRestraint: Restraint;
  jRestraint: Restraint;
  analysisMode?: AnalysisMode;
  density?: number;
}

/** Single member along global X. In `xz2d` only ux, uz and ry are active. */
function bar(options: BarOptions): ProjectModel {
  return {
    title: 'Bar',
    analysisMode: options.analysisMode ?? 'xz2d',
    nodes: [
      { id: 'i', x: 0, y: 0, z: 0, restraint: options.iRestraint },
      { id: 'j', x: L, y: 0, z: 0, restraint: options.jRestraint },
    ],
    materials: [{
      id: 'mat', name: 'Steel', E, G: 7.7e7, nu: 0.3, expansion: 0,
      density: options.density ?? DENSITY,
    }],
    sections: [{ id: 'sec', name: 'Section', materialId: 'mat', A, Ix: 1e-5, Iy, Iz, ky: 0, kz: 0 }],
    springs: [],
    members: [{
      id: 'bar', ni: 'i', nj: 'j', sectionId: 'sec', codeAngle: 0,
      iSprings: { x: 0, y: 0, z: 0 },
      jSprings: { x: 0, y: 0, z: 0 },
    }],
    couplings: [],
    nodalLoads: [],
    memberLoads: [],
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

const PIN_2D: Restraint = { ...FREE, ux: true, uz: true };
const ROLLER_2D: Restraint = { ...FREE, uz: true };
const bendingScale = Math.sqrt(E * Iy / (DENSITY * A * L ** 4));

function expectRelative(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(tolerance);
}

function captureError(run: () => unknown): AnalysisException {
  try {
    run();
  } catch (error) {
    if (error instanceof AnalysisException) return error;
    throw error;
  }
  throw new Error('Expected an AnalysisException.');
}

describe('modal analysis', () => {
  it('matches the cantilever bending frequencies 3.516 and 22.03 √(EI/ρAL⁴)', () => {
    const result = analyzeModal(bar({ iRestraint: FIXED, jRestraint: FREE }), {
      modeCount: 3, divisions: 8,
    });
    expect(result.divisions).toBe(8);
    expectRelative(result.modes[0]!.omega, 3.5160 * bendingScale, 1e-3);
    expectRelative(result.modes[1]!.omega, 22.0345 * bendingScale, 1e-3);
    expect(result.modes[0]!.frequency).toBeCloseTo(result.modes[0]!.omega / (2 * Math.PI), 12);
    expect(result.modes[0]!.period).toBeCloseTo(1 / result.modes[0]!.frequency, 12);
    expect(result.modes.map((mode) => mode.index)).toEqual([1, 2, 3]);
  });

  it('matches the simply supported beam frequencies (nπ)² √(EI/ρAL⁴)', () => {
    const result = analyzeModal(bar({ iRestraint: PIN_2D, jRestraint: ROLLER_2D }), {
      modeCount: 2, divisions: 8,
    });
    expectRelative(result.modes[0]!.omega, Math.PI ** 2 * bendingScale, 1e-3);
    expectRelative(result.modes[1]!.omega, 4 * Math.PI ** 2 * bendingScale, 2e-3);

    // First mode is a half sine normalized to a unit peak at mid-span.
    const points = result.modes[0]!.shape.diagrams.get('bar')!.points;
    for (const point of points) {
      expect(Math.abs(point.uz)).toBeCloseTo(Math.sin(Math.PI * point.x / L), 2);
    }
    expect(points[0]!.x).toBe(0);
    expect(points[points.length - 1]!.x).toBeCloseTo(L, 12);
  });

  it('reproduces the single-element consistent-mass result without subdivision', () => {
    const result = analyzeModal(bar({ iRestraint: FIXED, jRestraint: FREE }), {
      modeCount: 1, divisions: 1,
    });
    // One cubic element overestimates the cantilever frequency by about 0.5 %.
    expectRelative(result.modes[0]!.omega, 3.5327 * bendingScale, 1e-3);
  });

  it('separates the two bending planes of a 3D cantilever', () => {
    const result = analyzeModal(
      bar({ iRestraint: FIXED, jRestraint: FREE, analysisMode: '3d' }),
      { modeCount: 2, divisions: 8 }
    );
    const weakScale = Math.sqrt(E * Iz / (DENSITY * A * L ** 4));
    expectRelative(result.modes[0]!.omega, 3.5160 * weakScale, 1e-3); // about z: moves in y
    expectRelative(result.modes[1]!.omega, 3.5160 * bendingScale, 1e-3); // about y: moves in z
    const tip = result.modes[0]!.shape.displacements;
    expect(Math.abs(tip[6 + 1]!)).toBeCloseTo(1, 10);
    expect(Math.abs(tip[6 + 2]!)).toBeLessThan(1e-9);
  });

  it('handles a massless member with a lumped tip mass (singular mass matrix)', () => {
    const tipMass = 2.5;
    const model = bar({ iRestraint: FIXED, jRestraint: FREE, density: 0 });
    model.nodeMasses = [{ id: 'm', nodeId: 'j', mass: tipMass }];
    const result = analyzeModal(model, { modeCount: 6, divisions: 1 });

    // Only the two translational DOFs carry mass, so exactly two modes exist.
    expect(result.modes).toHaveLength(2);
    expect(result.modes[0]!.omega).toBeCloseTo(Math.sqrt(3 * E * Iy / (tipMass * L ** 3)), 8);
    expect(result.modes[1]!.omega).toBeCloseTo(Math.sqrt(E * A / (tipMass * L)), 6);
    expect(result.totalMass[0]).toBeCloseTo(tipMass, 12);
    expect(result.totalMass[2]).toBeCloseTo(tipMass, 12);
    // Each mode mobilizes the full mass in its own direction.
    expect(result.modes[0]!.effectiveMassRatio[2]).toBeCloseTo(1, 10);
    expect(result.modes[0]!.effectiveMassRatio[0]).toBeCloseTo(0, 10);
    expect(result.modes[1]!.effectiveMassRatio[0]).toBeCloseTo(1, 10);
    expect(Math.abs(result.modes[0]!.participation[2])).toBeCloseTo(1, 10);
  });

  it('keeps the summed effective mass ratio at or below one', () => {
    const result = analyzeModal(bar({ iRestraint: FIXED, jRestraint: FREE }), {
      modeCount: 30, divisions: 4,
    });
    const sumZ = result.modes.reduce((sum, mode) => sum + mode.effectiveMassRatio[2], 0);
    // All free-DOF modes together mobilize everything except the mass
    // tributary to the fixed support.
    expect(sumZ).toBeGreaterThan(0.8);
    expect(sumZ).toBeLessThanOrEqual(1 + 1e-9);
    // The fundamental cantilever mode carries about 61 % of the mass.
    expectRelative(result.modes[0]!.effectiveMassRatio[2], 0.613, 2e-2);
    for (let k = 1; k < result.modes.length; k++) {
      expect(result.modes[k]!.omega).toBeGreaterThanOrEqual(result.modes[k - 1]!.omega);
    }
  });

  it('reports missing mass and unstable models as analysis errors', () => {
    const massless = bar({ iRestraint: FIXED, jRestraint: FREE, density: 0 });
    expect(captureError(() => analyzeModal(massless)).message).toContain('質量が定義されていません');

    const unstable = bar({ iRestraint: PIN_2D, jRestraint: FREE });
    const error = captureError(() => analyzeModal(unstable));
    expect(error.type).toBe('singular');
    expect(error.diagnostics?.length).toBeGreaterThan(0);
  });

  it('selects a subdivision automatically and reports the solved size', () => {
    const result = analyzeModal(bar({ iRestraint: FIXED, jRestraint: FREE }));
    expect(result.divisions).toBe(4);
    expect(result.freeDofCount).toBe(12); // 4 moving nodes x (ux, uz, ry)
    expect(result.modes).toHaveLength(6);
  });
});

function column(iRestraint: Restraint, jRestraint: Restraint, load: number, mode: AnalysisMode = 'xz2d'): ProjectModel {
  const model = bar({ iRestraint, jRestraint, analysisMode: mode });
  model.nodalLoads = [{ id: 'p', nodeId: 'j', fx: load, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }];
  return model;
}

const euler = Math.PI ** 2 * E * Iy / L ** 2;

describe('linear buckling analysis', () => {
  it('reports tension as a positive axial force in the member diagram', () => {
    const tension = analyzeFrame({ model: buildIndexedModel(column(FIXED, FREE, 10)) });
    const compression = analyzeFrame({ model: buildIndexedModel(column(FIXED, FREE, -10)) });
    expect(tension.diagrams.get('bar')!.points[5]!.N).toBeCloseTo(10, 10);
    expect(compression.diagrams.get('bar')!.points[5]!.N).toBeCloseTo(-10, 10);
  });

  it('matches the Euler load π²EI/L² of a pinned-pinned column', () => {
    const result = analyzeBuckling(column(PIN_2D, ROLLER_2D, -1), { modeCount: 2, divisions: 8 });
    expectRelative(result.modes[0]!.loadFactor, euler, 1e-3);
    expectRelative(result.modes[1]!.loadFactor, 4 * euler, 2e-3);
    expect(result.target.type).toBe('loadCase');

    const points = result.modes[0]!.shape.diagrams.get('bar')!.points;
    for (const point of points) {
      expect(Math.abs(point.uz)).toBeCloseTo(Math.sin(Math.PI * point.x / L), 2);
    }
  });

  it('scales the load factor inversely with the reference load', () => {
    const result = analyzeBuckling(column(PIN_2D, ROLLER_2D, -250), { modeCount: 1, divisions: 8 });
    expectRelative(result.modes[0]!.loadFactor, euler / 250, 1e-3);
  });

  it('matches the cantilever (π²EI/4L²) and fixed-fixed (4π²EI/L²) columns', () => {
    const cantilever = analyzeBuckling(column(FIXED, FREE, -1), { modeCount: 1, divisions: 8 });
    expectRelative(cantilever.modes[0]!.loadFactor, euler / 4, 1e-3);

    const guided: Restraint = { ...FIXED, ux: false };
    const fixedFixed = analyzeBuckling(column(FIXED, guided, -1), { modeCount: 1, divisions: 8 });
    expectRelative(fixedFixed.modes[0]!.loadFactor, 4 * euler, 1e-3);
  });

  it('shows the known +21.6 % error of one element per pinned column', () => {
    const result = analyzeBuckling(column(PIN_2D, ROLLER_2D, -1), { modeCount: 1, divisions: 1 });
    expectRelative(result.modes[0]!.loadFactor, 12 * E * Iy / L ** 2, 1e-9);
  });

  it('buckles about the weak axis in 3D', () => {
    const pin3d: Restraint = { ...FREE, ux: true, uy: true, uz: true, rx: true };
    const roller3d: Restraint = { ...FREE, uy: true, uz: true };
    const result = analyzeBuckling(column(pin3d, roller3d, -1, '3d'), { modeCount: 2, divisions: 8 });
    expectRelative(result.modes[0]!.loadFactor, Math.PI ** 2 * E * Iz / L ** 2, 1e-3);
    expectRelative(result.modes[1]!.loadFactor, euler, 1e-3);
  });

  it('treats pinned member ends between rotation-fixed nodes as a pinned column', () => {
    const guided: Restraint = { ...FIXED, ux: false };
    const model = column(FIXED, guided, -1, '3d');
    model.members[0] = {
      ...model.members[0]!,
      iSprings: { x: 0, y: 2, z: 2 },
      jSprings: { x: 0, y: 2, z: 2 },
    };
    const result = analyzeBuckling(model, { modeCount: 1, divisions: 8 });
    expectRelative(result.modes[0]!.loadFactor, Math.PI ** 2 * E * Iz / L ** 2, 1e-3);
  });

  it('uses the axial force distribution of the selected load target', () => {
    const base = column(PIN_2D, ROLLER_2D, -1);
    const model: ProjectModel = {
      ...base,
      loadCases: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      activeLoadCaseId: 'a',
      nodalLoads: [
        { ...base.nodalLoads[0]!, loadCaseId: 'a' },
        { id: 'q', loadCaseId: 'b', nodeId: 'j', fx: -4, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
      ],
      loadCombinations: [{
        id: 'combo', name: 'A + B',
        factors: [{ loadCaseId: 'a', factor: 1 }, { loadCaseId: 'b', factor: 1 }],
      }],
    };
    const active = analyzeBuckling(model, { modeCount: 1, divisions: 8 });
    const combo = analyzeBuckling(model, { modeCount: 1, divisions: 8, targetId: 'combo' });
    expect(active.target.id).toBe('a');
    expect(combo.target.type).toBe('loadCombination');
    expectRelative(combo.modes[0]!.loadFactor, active.modes[0]!.loadFactor / 5, 1e-9);
  });

  it('rejects load sets without compression', () => {
    expect(captureError(() => analyzeBuckling(column(PIN_2D, ROLLER_2D, 5))).message)
      .toContain('座屈モードが見つかりません');
    expect(captureError(() => analyzeBuckling(column(PIN_2D, ROLLER_2D, 0))).message)
      .toContain('軸力が発生していない');
  });
});

describe('member subdivision for eigen analyses', () => {
  it('keeps original nodes first and puts releases on the outermost elements', () => {
    const model = bar({ iRestraint: FIXED, jRestraint: FREE, analysisMode: '3d' });
    model.members[0] = {
      ...model.members[0]!,
      iSprings: { x: 0, y: 2, z: 0 },
      jSprings: { x: 0, y: 0, z: 2 },
      torsionRestraint: 'j',
    };
    model.memberLoads = [{ id: 'udl', memberId: 'bar', type: 'udl', direction: 'localZ', value: -1 }];
    const refined = subdivideMembers(model, 3);

    expect(refined.model.nodes.slice(0, 2).map((node) => node.id)).toEqual(['i', 'j']);
    expect(refined.model.nodes).toHaveLength(4);
    expect(refined.model.nodes[2]!.x).toBeCloseTo(L / 3, 12);
    expect(refined.model.memberLoads).toEqual([]);
    const elements = refined.segments.get('bar')!.map((id) =>
      refined.model.members.find((member) => member.id === id)!
    );
    expect(elements).toHaveLength(3);
    expect(elements.map((element) => element.iSprings.y)).toEqual([2, 0, 0]);
    expect(elements.map((element) => element.jSprings.z)).toEqual([0, 0, 2]);
    expect(elements.map((element) => element.torsionRestraint)).toEqual(['none', 'none', 'j']);
    expect(elements[0]!.ni).toBe('i');
    expect(elements[2]!.nj).toBe('j');
    expect(elements[0]!.nj).toBe(elements[1]!.ni);
  });

  it('returns the model unchanged for a single division', () => {
    const model = bar({ iRestraint: FIXED, jRestraint: FREE });
    const refined = subdivideMembers(model, 1);
    expect(refined.model.nodes).toBe(model.nodes);
    expect(refined.segments.get('bar')).toEqual(['bar']);
  });

  it('keeps a twist-pinned truss member stable and skips members without torsional stiffness', () => {
    const guided: Restraint = { ...FIXED, ux: false };
    const truss = column(FIXED, guided, -1, '3d');
    truss.members[0] = {
      ...truss.members[0]!,
      iSprings: { x: 2, y: 2, z: 2 },
      jSprings: { x: 2, y: 2, z: 2 },
    };
    const refined = subdivideMembers(truss, 4);
    const elements = refined.segments.get('bar')!.map((id) =>
      refined.model.members.find((member) => member.id === id)!
    );
    expect(elements[0]!.iSprings.x).toBe(1); // anchored at the i-end
    expect(elements[3]!.jSprings.x).toBe(2);
    const result = analyzeBuckling(truss, { modeCount: 1, divisions: 4 });
    expectRelative(result.modes[0]!.loadFactor, Math.PI ** 2 * E * Iz / L ** 2, 1e-2);

    const noTorsion = column(FIXED, FREE, -1, '3d');
    noTorsion.sections[0] = { ...noTorsion.sections[0]!, Ix: 0 };
    noTorsion.nodes[1] = { ...noTorsion.nodes[1]!, restraint: { ...FREE, rx: true } };
    const skipped = analyzeBuckling(noTorsion, { modeCount: 1, divisions: 4 });
    expect(skipped.warnings.some((warning) => warning.includes('Ix'))).toBe(true);
    expect(skipped.freeDofCount).toBe(5);
  });
});
