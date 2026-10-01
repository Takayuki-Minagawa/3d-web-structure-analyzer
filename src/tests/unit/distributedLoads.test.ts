import { describe, expect, it } from 'vitest';
import { analyzeFrame } from '../../core/analysis/analyzeFrame';
import { analyzeAllLoadTargets } from '../../core/analysis/analyzeLoadTargets';
import {
  computeTrapezoidFixedEndForces,
  computeUDLFixedEndForces,
} from '../../core/analysis/loads';
import { timoshenkoShapeFunctions } from '../../core/analysis/timoshenko';
import { computePhiY, computePhiZ } from '../../core/analysis/element3dFrame';
import { buildIndexedModel } from '../../core/model/indexing';
import { validateModel } from '../../core/model/validation';
import type {
  Member,
  MemberLoad,
  ProjectModel,
  Restraint,
  TrapezoidalMemberLoad,
} from '../../core/model/types';

const FREE: Restraint = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
const FIXED: Restraint = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const L = 6;
const E = 200e6;
const Iy = 2e-5;
const Iz = 4e-6;

interface BeamOptions {
  iRestraint: Restraint;
  jRestraint: Restraint;
  loads: MemberLoad[];
  shearRatio?: number;
  member?: Partial<Member>;
}

/** Single member along global X; local y = global Y, local z = global Z. */
function beam(options: BeamOptions): ProjectModel {
  const shearRatio = options.shearRatio ?? 0;
  return {
    title: 'Beam',
    nodes: [
      { id: 'i', x: 0, y: 0, z: 0, restraint: options.iRestraint },
      { id: 'j', x: L, y: 0, z: 0, restraint: options.jRestraint },
    ],
    materials: [{ id: 'mat', name: 'Steel', E, G: 80e6, nu: 0.25, expansion: 0 }],
    sections: [{
      id: 'sec', name: 'Section', materialId: 'mat',
      A: 0.01, Ix: 1e-5, Iy, Iz, ky: shearRatio, kz: shearRatio,
    }],
    springs: [],
    members: [{
      id: 'beam', ni: 'i', nj: 'j', sectionId: 'sec', codeAngle: 0,
      iSprings: { x: 0, y: 0, z: 0 },
      jSprings: { x: 0, y: 0, z: 0 },
      ...options.member,
    }],
    couplings: [],
    nodalLoads: [],
    memberLoads: options.loads,
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

function trapezoid(overrides: Partial<TrapezoidalMemberLoad>): TrapezoidalMemberLoad {
  return {
    id: 'trap', memberId: 'beam', type: 'trapezoid', direction: 'localY',
    value: 0, valueEnd: 0, a: 0, b: L,
    ...overrides,
  };
}

/** Simple supports in the local x-y plane with every other rigid-body motion removed. */
const SIMPLE_I: Restraint = { ...FREE, ux: true, uy: true, uz: true, rx: true };
const SIMPLE_J: Restraint = { ...FREE, uy: true, uz: true };

describe('trapezoidal and partial distributed member loads', () => {
  it('matches the closed-form fixed-end forces of a full-span triangular load', () => {
    const w = 12;
    const model = buildIndexedModel(beam({ iRestraint: FIXED, jRestraint: FIXED, loads: [] }));
    const f = computeTrapezoidFixedEndForces(
      model.members[0]!,
      trapezoid({ value: 0, valueEnd: w })
    );

    expect(f[1]).toBeCloseTo(3 * w * L / 20, 10);
    expect(f[5]).toBeCloseTo(w * L * L / 30, 10);
    expect(f[7]).toBeCloseTo(7 * w * L / 20, 10);
    expect(f[11]).toBeCloseTo(-w * L * L / 20, 10);
  });

  it('matches the closed-form fixed-end moments of a uniform load on half the span', () => {
    const w = 8;
    const model = buildIndexedModel(beam({ iRestraint: FIXED, jRestraint: FIXED, loads: [] }));
    const f = computeTrapezoidFixedEndForces(
      model.members[0]!,
      trapezoid({ direction: 'localZ', value: w, valueEnd: w, a: 0, b: L / 2 })
    );

    // Local-z bending carries the opposite rotation sign (ry coupling).
    expect(f[4]).toBeCloseTo(-11 * w * L * L / 192, 10);
    expect(f[10]).toBeCloseTo(5 * w * L * L / 192, 10);
    expect(f[2]! + f[8]!).toBeCloseTo(w * L / 2, 10);
  });

  it('reduces to the uniform-load fixed-end forces, including shear deformation', () => {
    const model = buildIndexedModel(beam({
      iRestraint: FIXED, jRestraint: FIXED, loads: [], shearRatio: 0.6,
    }));
    const member = model.members[0]!;
    expect(computePhiY(member)).toBeGreaterThan(0);
    for (const direction of ['localX', 'localY', 'localZ', 'globalZ'] as const) {
      const partial = computeTrapezoidFixedEndForces(
        member,
        trapezoid({ direction, value: -5, valueEnd: -5 })
      );
      const uniform = computeUDLFixedEndForces(
        member,
        { id: 'udl', memberId: 'beam', type: 'udl', direction, value: -5 }
      );
      for (let index = 0; index < 12; index++) {
        expect(partial[index]).toBeCloseTo(uniform[index]!, 10);
      }
    }
  });

  it('recovers reactions, the moment curve and deflection of a simply supported triangular load', () => {
    const w = -9;
    const model = beam({
      iRestraint: SIMPLE_I, jRestraint: SIMPLE_J,
      loads: [trapezoid({ value: 0, valueEnd: w })],
    });
    const result = analyzeFrame({ model: buildIndexedModel(model) });

    // Reactions oppose the downward load: wL/6 at the light end, wL/3 at the heavy end.
    expect(result.reactions[1]).toBeCloseTo(-w * L / 6, 9);
    expect(result.reactions[7]).toBeCloseTo(-w * L / 3, 9);

    const diagram = result.diagrams.get('beam')!;
    for (const point of diagram.points) {
      const expected = Math.abs(w) * point.x * (L * L - point.x * point.x) / (6 * L);
      expect(Math.abs(point.Mz)).toBeCloseTo(expected, 8);
    }
    const midpoint = diagram.points.find((point) => point.x === L / 2)!;
    expect(midpoint.uy).toBeCloseTo(5 * w * L ** 4 / (768 * E * Iz), 10);
  });

  it('matches the cantilever tip deflection for a partial uniform load', () => {
    const w = -4;
    const a = 1.5;
    const b = 4;
    const model = beam({
      iRestraint: FIXED, jRestraint: FREE,
      loads: [trapezoid({ direction: 'localZ', value: w, valueEnd: w, a, b })],
    });
    const result = analyzeFrame({ model: buildIndexedModel(model) });
    const antiderivative = (s: number) => L * s ** 3 - s ** 4 / 4;
    const expectedTip = w * (antiderivative(b) - antiderivative(a)) / (6 * E * Iy);

    expect(result.displacements[6 + 2]).toBeCloseTo(expectedTip, 10);
    const diagram = result.diagrams.get('beam')!;
    expect(diagram.points.at(-1)!.uz).toBeCloseTo(expectedTip, 10);
    // The diagram samples both ends of the loaded range.
    expect(diagram.points.some((point) => point.x === a)).toBe(true);
    expect(diagram.points.some((point) => point.x === b)).toBe(true);
    // Shear is constant outside the loaded range and linear inside it.
    const shearAt = (x: number) => diagram.points.find((point) => point.x === x)!.Vz;
    expect(shearAt(b) - shearAt(a)).toBeCloseTo(w * (b - a), 9);
  });

  it('scales both intensities in load combinations', () => {
    const base = beam({
      iRestraint: SIMPLE_I, jRestraint: SIMPLE_J,
      loads: [trapezoid({ value: -2, valueEnd: -6, a: 1, b: 5, loadCaseId: 'dead' })],
    });
    const model: ProjectModel = {
      ...base,
      loadCases: [{ id: 'dead', name: 'Dead' }],
      loadCombinations: [{ id: 'combo', name: '1.5D', factors: [{ loadCaseId: 'dead', factor: 1.5 }] }],
    };
    const { results } = analyzeAllLoadTargets(model);
    const dead = results.find((result) => result.target.id === 'dead')!;
    const combo = results.find((result) => result.target.id === 'combo')!;
    expect(combo.reactions[1]).toBeCloseTo(1.5 * dead.reactions[1]!, 10);
    expect(combo.reactions[7]).toBeCloseTo(1.5 * dead.reactions[7]!, 10);
    expect(dead.reactions[1]! + dead.reactions[7]!).toBeCloseTo(16, 10);
  });

  it('rejects ranges outside the member or with a >= b', () => {
    const invalidRanges: Array<[number, number]> = [[3, 3], [4, 2], [-0.5, 2], [1, L + 0.1]];
    for (const [a, b] of invalidRanges) {
      const model = beam({
        iRestraint: FIXED, jRestraint: FIXED,
        loads: [trapezoid({ value: 1, valueEnd: 1, a, b })],
      });
      const errors = validateModel(model);
      expect(errors.some((error) => error.message.includes('分布荷重 trap'))).toBe(true);
    }
    const valid = beam({
      iRestraint: FIXED, jRestraint: FIXED,
      loads: [trapezoid({ value: 1, valueEnd: 2, a: 0, b: L })],
    });
    expect(validateModel(valid)).toEqual([]);
  });

  it('rejects out-of-plane trapezoidal loads in 2D mode', () => {
    const model: ProjectModel = {
      ...beam({
        iRestraint: FIXED, jRestraint: FIXED,
        loads: [trapezoid({ direction: 'globalZ', value: 1, valueEnd: 2 })],
      }),
      analysisMode: 'xy2d',
    };
    expect(validateModel(model).some((error) => error.message.includes('面外方向荷重'))).toBe(true);
  });
});

describe('member deflection curves', () => {
  it('equals the Timoshenko interpolation for an unloaded member in both bending planes', () => {
    const model = beam({ iRestraint: FIXED, jRestraint: FREE, loads: [], shearRatio: 0.01 });
    model.nodalLoads = [{ id: 'tip', nodeId: 'j', fx: 3, fy: 7, fz: -11, mx: 0, my: 2, mz: -1.5 }];
    const indexed = buildIndexedModel(model);
    const member = indexed.members[0]!;
    const result = analyzeFrame({ model: indexed });
    const d = result.displacements;
    const phiY = computePhiY(member);
    const phiZ = computePhiZ(member);
    expect(phiY).toBeGreaterThan(0.1);
    expect(phiZ).toBeGreaterThan(0.01);

    for (const point of result.diagrams.get('beam')!.points) {
      const xi = point.x / L;
      const [y1, y2, y3, y4] = timoshenkoShapeFunctions(xi, L, phiZ);
      const [z1, z2, z3, z4] = timoshenkoShapeFunctions(xi, L, phiY);
      // Member is aligned with the global axes, so local DOFs equal global DOFs.
      const expectedUy = d[1]! * y1 + d[5]! * y2 + d[7]! * y3 + d[11]! * y4;
      const expectedUz = d[2]! * z1 - d[4]! * z2 + d[8]! * z3 - d[10]! * z4;
      expect(point.uy).toBeCloseTo(expectedUy, 12);
      expect(point.uz).toBeCloseTo(expectedUz, 12);
    }
  });

  it('uses the member-end rotation, not the nodal rotation, at released ends', () => {
    const w = -10;
    const model = beam({
      iRestraint: FIXED, jRestraint: FIXED,
      loads: [{ id: 'udl', memberId: 'beam', type: 'udl', direction: 'localZ', value: w }],
      member: { iSprings: { x: 0, y: 2, z: 0 }, jSprings: { x: 0, y: 2, z: 0 } },
    });
    const result = analyzeFrame({ model: buildIndexedModel(model) });
    const diagram = result.diagrams.get('beam')!;
    const midpoint = diagram.points.find((point) => point.x === L / 2)!;

    // Both nodes are fully fixed, yet the pinned member sags like a simple beam.
    expect(Array.from(result.displacements).every((value) => value === 0)).toBe(true);
    expect(midpoint.uz).toBeCloseTo(5 * w * L ** 4 / (384 * E * Iy), 10);
    expect(Math.abs(midpoint.My)).toBeCloseTo(Math.abs(w) * L * L / 8, 9);
    expect(diagram.points[0]!.uz).toBe(0);
    expect(diagram.points.at(-1)!.uz).toBeCloseTo(0, 12);
  });

  it('adds the shear deflection of a simply supported beam under a point load', () => {
    const P = -20;
    const shearRatio = 0.4;
    const model = beam({
      iRestraint: SIMPLE_I, jRestraint: SIMPLE_J,
      loads: [{ id: 'p', memberId: 'beam', type: 'point', direction: 'localY', value: P, a: L / 2 }],
      shearRatio,
    });
    const result = analyzeFrame({ model: buildIndexedModel(model) });
    const midpoint = result.diagrams.get('beam')!.points.find((point) => point.x === L / 2)!;
    const bending = P * L ** 3 / (48 * E * Iz);
    const shear = P * L / (4 * 80e6 * shearRatio * 0.01);
    expect(midpoint.uy).toBeCloseTo(bending + shear, 10);
  });
});
