import { describe, expect, it } from 'vitest';
import { analyzeFrame } from '../../core/analysis/analyzeFrame';
import { buildIndexedModel } from '../../core/model/indexing';
import { FIXED_RESTRAINT } from '../../core/model/restraints';
import type { MemberLoad, ProjectModel } from '../../core/model/types';

const L = 4;
const EA = 2e6;
function bar(loads: MemberLoad[], fixedJ: boolean): ProjectModel {
  return {
    title: 'Axial closed-form benchmark',
    nodes: [
      { id: 'i', x: 0, y: 0, z: 0, restraint: { ...FIXED_RESTRAINT } },
      { id: 'j', x: L, y: 0, z: 0, restraint: { ...FIXED_RESTRAINT, ux: fixedJ } },
    ],
    materials: [{ id: 'steel', name: 'Steel', E: 200e6, G: 80e6, nu: 0.25, expansion: 1.2e-5 }],
    sections: [{ id: 's', name: 'Bar', materialId: 'steel', A: 0.01, Ix: 1e-5, Iy: 1e-5, Iz: 1e-5, ky: 0, kz: 0 }],
    members: [{ id: 'bar', ni: 'i', nj: 'j', sectionId: 's', codeAngle: 0, iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 } }],
    springs: [], couplings: [], nodalLoads: [], memberLoads: loads,
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

function checkCurve(model: ProjectModel, expected: (x: number) => number): void {
  const result = analyzeFrame({ model: buildIndexedModel(model) });
  const points = result.diagrams.get('bar')!.points;
  for (const point of points) expect(point.ux).toBeCloseTo(expected(point.x), 13);
  expect(points[0]!.ux).toBeCloseTo(result.displacements[0]!, 13);
  expect(points[points.length - 1]!.ux).toBeCloseTo(result.displacements[6]!, 13);
}

describe('axial displacement recovered from section strains', () => {
  for (const fixedJ of [true, false]) {
    const support = fixedJ ? 'fixed at both ends' : 'cantilever';
    it.each([-10, 10])(`matches the uniform-load curve, ${support}, q=%s`, (q) => {
      checkCurve(bar([{ id: 'q', memberId: 'bar', type: 'udl', direction: 'localX', value: q }], fixedJ),
        (x) => q * x * ((fixedJ ? L : 2 * L) - x) / (2 * EA));
    });
    it(`matches an off-center point-load curve and remains continuous, ${support}`, () => {
      const P = 10;
      const a = 1.3;
      checkCurve(bar([{ id: 'p', memberId: 'bar', type: 'point', direction: 'localX', value: P, a }], fixedJ),
        (x) => P * ((fixedJ ? (L - a) / L : 1) * x - Math.max(0, x - a)) / EA);
    });
    it(`matches a triangular-load cubic curve, ${support}`, () => {
      const q = 12;
      checkCurve(bar([{ id: 'q', memberId: 'bar', type: 'trapezoid', direction: 'localX', value: 0, valueEnd: q, a: 0, b: L }], fixedJ),
        (x) => q * ((fixedJ ? L * x / 6 : L * x / 2) - x ** 3 / (6 * L)) / EA);
    });
    it(`matches a partial uniform load at its boundaries, ${support}`, () => {
      const q = 8;
      const a = 0.7;
      const b = 2.9;
      const reaction = q * (b - a) * (fixedJ ? (L - (a + b) / 2) / L : 1);
      checkCurve(bar([{ id: 'q', memberId: 'bar', type: 'trapezoid', direction: 'localX', value: q, valueEnd: q, a, b }], fixedJ),
        (x) => (reaction * x - q / 2 * (Math.max(0, x - a) ** 2 - Math.max(0, x - b) ** 2)) / EA);
    });
    it(`retains the thermal strain solution, ${support}`, () => {
      checkCurve(bar([{ id: 't', memberId: 'bar', type: 'temperature', direction: 'localX', value: 30 }], fixedJ),
        (x) => fixedJ ? 0 : 1.2e-5 * 30 * x);
    });
  }

  it('matches both audited fixed-fixed midspan values', () => {
    for (const load of [
      { id: 'q', memberId: 'bar', type: 'udl' as const, direction: 'localX' as const, value: 10 },
      { id: 'p', memberId: 'bar', type: 'point' as const, direction: 'localX' as const, value: 10, a: L / 2 },
    ]) {
      const result = analyzeFrame({ model: buildIndexedModel(bar([load], true)) });
      const mid = result.diagrams.get('bar')!.points.find((point) => point.x === L / 2)!;
      expect(mid.ux).toBeCloseTo(load.type === 'udl' ? 0.00001 : 0.000005, 14);
    }
  });
});
