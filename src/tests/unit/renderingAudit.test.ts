import { describe, expect, it } from 'vitest';
import { ArrowHelper, Group, MOUSE, Vector3 } from 'three';
import type { MemberLoad, ProjectModel } from '../../core/model/types';
import { FIXED_RESTRAINT, FREE_RESTRAINT, PINNED_RESTRAINT } from '../../core/model/restraints';
import { CAMERA_MOUSE_BUTTONS } from '../../rendering/cameraControls';
import { resolveViewportLoads } from '../../rendering/loadPresentation';
import { LOAD_DISPLAY_TOLERANCE, populateLoads, populateSupports } from '../../rendering/modelGeometry';
import { getSupportPresentations } from '../../rendering/supportPresentation';

function model(): ProjectModel {
  return {
    title: 'Rendering regression',
    nodes: [
      { id: 'i', x: 0, y: 0, z: 0, restraint: { ...FREE_RESTRAINT } },
      { id: 'j', x: 4, y: 0, z: 0, restraint: { ...FREE_RESTRAINT } },
    ],
    materials: [{ id: 'mat', name: 'Steel', E: 200e6, G: 80e6, nu: 0.25, expansion: 1.2e-5, density: 1 }],
    sections: [{ id: 's', name: 'Bar', materialId: 'mat', A: 0.01, Ix: 1e-5, Iy: 1e-5, Iz: 1e-5, ky: 0, kz: 0 }],
    members: [{ id: 'bar', ni: 'i', nj: 'j', sectionId: 's', codeAngle: 0, iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 } }],
    loadCases: [{ id: 'dead', name: 'Dead' }, { id: 'live', name: 'Live' }],
    loadCombinations: [{ id: 'combo', name: 'Design', factors: [{ loadCaseId: 'dead', factor: 1.5 }, { loadCaseId: 'live', factor: -1 }] }],
    activeLoadCaseId: 'dead', activeLoadCombinationId: 'combo',
    springs: [], couplings: [], memberLoads: [],
    nodalLoads: [
      { id: 'd', nodeId: 'j', loadCaseId: 'dead', fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
      { id: 'l', nodeId: 'j', loadCaseId: 'live', fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 },
    ],
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

describe('load-target rendering', () => {
  it('shows only the editing case even when another combination is active', () => {
    const source = model();
    const group = new Group();
    populateLoads(group, source);
    expect(group.children).toHaveLength(1);
    expect(resolveViewportLoads(source, { kind: 'editing' }).caption).toBe('Dead [dead]');
  });

  it('switches to the selected result and applies signed combination factors', () => {
    const source = model();
    const live = resolveViewportLoads(source, { kind: 'target', target: { id: 'live', name: 'Live', type: 'loadCase' } });
    expect(live.model!.nodalLoads.map((load) => load.id)).toEqual(['l']);
    const combination = resolveViewportLoads(source, { kind: 'target', target: { id: 'combo', name: 'Design', type: 'loadCombination' } });
    expect(combination.caption).toBe('Design [combo] = 1.5 × Dead [dead] − 1 × Live [live]');
    expect(combination.model!.nodalLoads.map((load) => [load.fx, load.fz])).toEqual([[15, 0], [-0, 10]]);
    const group = new Group();
    populateLoads(group, combination.model!, { resolved: true });
    expect(group.children).toHaveLength(2);
    const second = group.children[1] as ArrowHelper;
    expect(new Vector3(0, 1, 0).applyQuaternion(second.quaternion).z).toBeCloseTo(1);
    expect(source.nodalLoads[1]!.fz).toBe(-10);
  });

  it('has no single load model for an envelope and requires explicit all-case display', () => {
    const source = model();
    expect(resolveViewportLoads(source, { kind: 'envelope', bound: 'max' }).model).toBeNull();
    const all = resolveViewportLoads(source, { kind: 'all' });
    expect(all.caption).toContain('Dead [dead] / Live [live]');
    const group = new Group();
    populateLoads(group, all.model!, { resolved: true });
    expect(group.children).toHaveLength(2);
  });

  it('excludes zero-factor member and nodal loads while retaining the factor in its caption', () => {
    const source = model();
    source.loadCombinations![0]!.factors = [{ loadCaseId: 'dead', factor: 0 }];
    source.memberLoads = [{ id: 'q', memberId: 'bar', type: 'udl', direction: 'localX', value: 10, loadCaseId: 'dead' }];
    const combo = resolveViewportLoads(source, { kind: 'target', target: { id: 'combo', name: 'Design', type: 'loadCombination' } });
    expect(combo.model!.nodalLoads).toEqual([]);
    expect(combo.model!.memberLoads).toEqual([]);
    expect(combo.caption).toContain('0 × Dead [dead]');
  });

  for (const type of ['udl', 'point', 'temperature'] as const) {
    it.each([0, LOAD_DISPLAY_TOLERANCE, -LOAD_DISPLAY_TOLERANCE])(`omits ${type} at or below the documented threshold (%s)`, (value) => {
      const source = model();
      source.nodalLoads = [];
      source.memberLoads = [{ id: 'q', memberId: 'bar', loadCaseId: 'dead', type, direction: 'localX', value, a: 2 } as MemberLoad];
      const group = new Group();
      populateLoads(group, source);
      expect(group.children).toHaveLength(0);
    });
    it.each([-2, 2])(`retains signed ${type} loads above the threshold (%s)`, (factor) => {
      const source = model();
      source.nodalLoads = [];
      source.memberLoads = [{ id: 'q', memberId: 'bar', loadCaseId: 'dead', type, direction: 'localX', value: factor * LOAD_DISPLAY_TOLERANCE, a: 2 } as MemberLoad];
      const group = new Group();
      populateLoads(group, source);
      expect(group.children.length).toBeGreaterThan(0);
    });
  }

  it('shows self weight only when density, area, gravity and multiplier produce a load', () => {
    const source = model();
    source.nodalLoads = [];
    source.memberLoads = [{ id: 'w', memberId: 'bar', type: 'selfWeight', direction: 'globalZ', value: 1, loadCaseId: 'dead' }];
    const group = new Group();
    populateLoads(group, source);
    expect(group.children).toHaveLength(0);
    source.gravity = { x: 0, y: 0, z: -9.81 };
    source.materials[0]!.density = 0;
    populateLoads(group, source);
    expect(group.children).toHaveLength(0);
    source.materials[0]!.density = 1;
    populateLoads(group, source);
    expect(group.children).toHaveLength(6);
  });
});

describe('six-DOF support rendering', () => {
  it('distinguishes free, fixed, pinned, roller and rotational-only supports', () => {
    const source = model();
    source.nodes = [
      { id: 'free', x: 0, y: 0, z: 0, restraint: { ...FREE_RESTRAINT } },
      { id: 'fixed', x: 1, y: 0, z: 0, restraint: { ...FIXED_RESTRAINT } },
      { id: 'pin', x: 2, y: 0, z: 0, restraint: { ...PINNED_RESTRAINT } },
      { id: 'roller', x: 3, y: 0, z: 0, restraint: { ...FREE_RESTRAINT, uz: true } },
      { id: 'rotation', x: 4, y: 0, z: 0, restraint: { ...FREE_RESTRAINT, rx: true } },
    ];
    const supports = getSupportPresentations(source);
    expect(supports.map((support) => [support.node.id, support.translationCount, support.rotationCount])).toEqual([
      ['fixed', 3, 3], ['pin', 3, 0], ['roller', 1, 0], ['rotation', 0, 1],
    ]);
    expect(supports[3]!.label).toBe('r:x');
    const group = new Group();
    populateSupports(group, source);
    expect(group.children).toHaveLength(4);
    expect(group.children.every((marker) => marker.children.length > 0)).toBe(true);
  });

  it('identifies all six spring DOFs and their stiffness units', () => {
    const source = model();
    source.nodeSprings = [{ id: 's', nodeId: 'i', ux: 10, uy: 20, uz: 30, rx: 40, ry: 50, rz: 60 }];
    const supports = getSupportPresentations(source);
    expect(supports).toHaveLength(1);
    expect(supports[0]!.springs).toHaveLength(6);
    expect(supports[0]!.label).toContain('kux=10 kN/m');
    expect(supports[0]!.label).toContain('krz=60 kN·m/rad');
    const group = new Group();
    populateSupports(group, source);
    expect(group.children[0]!.children.length).toBeGreaterThan(0);
  });

  it('separates automatic planar constraints and member twist restraints', () => {
    const source = model();
    source.analysisMode = 'xz2d';
    source.members[0]!.torsionRestraint = 'j';
    const supports = getSupportPresentations(source);
    expect(supports).toHaveLength(2);
    expect(supports[0]!.explicit).toEqual([]);
    expect(supports[0]!.automatic).toEqual(['uy', 'rx', 'rz']);
    expect(supports[1]!.torsion).toEqual(['rx']);
    expect(supports[1]!.label).toBe('2D:uy,rx,rz · T:rx');
  });
});

it('reserves left drag for editing and explicitly assigns documented camera buttons', () => {
  expect(CAMERA_MOUSE_BUTTONS).toEqual({ LEFT: null, MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE });
});
