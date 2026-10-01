import { describe, expect, it } from 'vitest';
import { analyzeFrame } from '../../core/analysis/analyzeFrame';
import { buildIndexedModel } from '../../core/model/indexing';
import type { MemberLoad, ProjectModel, Restraint } from '../../core/model/types';

const FREE: Restraint = {
  ux: false, uy: false, uz: false, rx: false, ry: false, rz: false,
};

function simplySupportedBeam(loads: MemberLoad[]): ProjectModel {
  return {
    title: 'Simply supported beam',
    analysisMode: 'xy2d',
    nodes: [
      { id: 'i', x: 0, y: 0, z: 0, restraint: { ...FREE, ux: true, uy: true } },
      { id: 'j', x: 6, y: 0, z: 0, restraint: { ...FREE, uy: true } },
    ],
    materials: [
      { id: 'mat', name: 'Steel', E: 200e6, G: 80e6, nu: 0.25, expansion: 0 },
    ],
    sections: [{
      id: 'sec', name: 'Section', materialId: 'mat',
      A: 0.01, Ix: 1e-5, Iy: 2e-5, Iz: 4e-6, ky: 0, kz: 0,
    }],
    springs: [],
    members: [{
      id: 'beam', ni: 'i', nj: 'j', sectionId: 'sec', codeAngle: 0,
      iSprings: { x: 0, y: 0, z: 0 },
      jSprings: { x: 0, y: 0, z: 0 },
    }],
    couplings: [],
    nodalLoads: [],
    memberLoads: loads,
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

describe('member-load diagrams', () => {
  it('recovers wL²/8 and the exact 5wL⁴/384EI deflection for a simple beam UDL', () => {
    const w = -10;
    const model = simplySupportedBeam([
      { id: 'udl', memberId: 'beam', type: 'udl', direction: 'localY', value: w },
    ]);
    const result = analyzeFrame({ model: buildIndexedModel(model) });
    const diagram = result.diagrams.get('beam')!;
    const length = 6;
    const midpoint = diagram.points.find((point) => point.x === length / 2)!;
    const { E } = model.materials[0]!;
    const { Iz } = model.sections[0]!;

    expect(Math.abs(midpoint.Mz)).toBeCloseTo(Math.abs(w) * length ** 2 / 8, 10);
    // The member deflection integrates the actual curvature, so a single
    // element reproduces the closed-form mid-span deflection.
    expect(midpoint.uy).toBeCloseTo(5 * w * length ** 4 / (384 * E * Iz), 10);
    expect(Math.abs(midpoint.uy)).toBeCloseTo(
      Math.max(...diagram.points.map((point) => Math.abs(point.uy))),
      12
    );
  });

  it('shows the point-load shear jump and the continuous moment at the load position', () => {
    const pointLoad = {
      id: 'point', memberId: 'beam', type: 'point' as const,
      direction: 'localY' as const, value: -12, a: 2,
    };
    const model = simplySupportedBeam([pointLoad]);
    const diagram = analyzeFrame({ model: buildIndexedModel(model) }).diagrams.get('beam')!;
    const immediatelyBefore = diagram.points.find(
      (point) => Math.abs(point.x - (pointLoad.a - 1e-8)) < 1e-12
    )!;
    const atLoad = diagram.points.find((point) => point.x === pointLoad.a)!;
    const immediatelyAfter = diagram.points.find(
      (point) => Math.abs(point.x - (pointLoad.a + 1e-8)) < 1e-12
    )!;

    expect(atLoad.Vy - immediatelyBefore.Vy).toBeCloseTo(pointLoad.value, 10);
    expect(immediatelyAfter.Vy).toBeCloseTo(atLoad.Vy, 10);
    expect(immediatelyBefore.Mz).toBeCloseTo(atLoad.Mz, 6);
    expect(immediatelyAfter.Mz).toBeCloseTo(atLoad.Mz, 6);
    expect(Math.abs(atLoad.Mz)).toBeCloseTo(
      Math.abs(pointLoad.value) * pointLoad.a * (6 - pointLoad.a) / 6,
      8
    );
  });
});
