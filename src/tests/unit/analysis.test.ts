import { describe, it, expect } from 'vitest';
import { buildIndexedModel } from '../../core/model/indexing';
import { analyzeFrame } from '../../core/analysis/analyzeFrame';
import type { ProjectModel } from '../../core/model/types';

// Helper to create a simple model
function createBaseModel(): ProjectModel {
  return {
    nodes: [],
    materials: [{ id: 'mat1', name: 'Steel', E: 200e6, nu: 0.3 }],
    sections: [{ id: 'sec1', name: '10x10', A: 0.01, I: 8.333e-6, As: 0.005 }],
    members: [],
    nodalLoads: [],
    memberLoads: [],
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

describe('Case 1: Cantilever beam with tip point load', () => {
  // Fixed at left (node 0), free at right (node 1)
  // Tip load P = -10 kN (downward) at node 1
  // L = 4 m, E = 200e6 kN/m², I = 8.333e-6 m⁴
  const P = -10;
  const L = 4;
  const E = 200e6;
  const I = 8.333e-6;
  const nu = 0.3;
  const G = E / (2 * (1 + nu));
  const As = 0.005;

  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, restraint: { ux: true, uy: true, rz: true } },
      { id: 'n1', x: L, y: 0, restraint: { ux: false, uy: false, rz: false } },
    ];
    model.members = [
      { id: 'm1', ni: 'n0', nj: 'n1', materialId: 'mat1', sectionId: 'sec1' },
    ];
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'n1', fx: 0, fy: P, mz: 0 },
    ];
    return model;
  }

  it('should compute tip displacement correctly', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Theoretical (Timoshenko): delta = PL³/(3EI) + PL/(G·As)
    const delta = (P * L * L * L) / (3 * E * I) + (P * L) / (G * As);

    // Node 1 uy is at DOF index 4 (node1 * 3 + 1)
    expect(result.displacements[4]).toBeCloseTo(delta, 4);
  });

  it('should compute tip rotation correctly', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Theoretical: theta = PL² / 2EI
    const theta = (P * L * L) / (2 * E * I);

    // Node 1 rz is at DOF index 5
    expect(result.displacements[5]).toBeCloseTo(theta, 4);
  });

  it('should compute fixed-end reactions correctly', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Reaction Fy at node 0 = -P = 10 kN (upward)
    expect(result.reactions[1]).toBeCloseTo(-P, 4);

    // Reaction Mz at node 0 = -P*L = 40 kN·m
    expect(result.reactions[2]).toBeCloseTo(-P * L, 4);
  });

  it('should compute element end forces correctly', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    const endForces = result.elementEndForces.get('m1');
    expect(endForces).toBeDefined();

    // Local end forces: [Nxi, Vyi, Mzi, Nxj, Vyj, Mzj]
    // Axial: should be 0
    expect(endForces![0]).toBeCloseTo(0, 4);
    expect(endForces![3]).toBeCloseTo(0, 4);

    // Shear at i-end = -P (reaction)
    expect(endForces![1]).toBeCloseTo(-P, 4);
    // Shear at j-end = P
    expect(endForces![4]).toBeCloseTo(P, 4);

    // Moment at i-end = P*L (fixed-end moment)
    expect(endForces![2]).toBeCloseTo(-P * L, 4);
    // Moment at j-end = 0
    expect(endForces![5]).toBeCloseTo(0, 4);
  });
});

describe('Case 2: Cantilever beam with uniform distributed load', () => {
  // Fixed at left (node 0), free at right (node 1)
  // UDL w = -5 kN/m (downward in local Y)
  // L = 4 m
  const w = -5;
  const L = 4;
  const E = 200e6;
  const I = 8.333e-6;
  const nu = 0.3;
  const G = E / (2 * (1 + nu));
  const As = 0.005;

  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, restraint: { ux: true, uy: true, rz: true } },
      { id: 'n1', x: L, y: 0, restraint: { ux: false, uy: false, rz: false } },
    ];
    model.members = [
      { id: 'm1', ni: 'n0', nj: 'n1', materialId: 'mat1', sectionId: 'sec1' },
    ];
    model.memberLoads = [
      { id: 'ml1', memberId: 'm1', type: 'udl', direction: 'localY', value: w },
    ];
    return model;
  }

  it('should compute tip displacement correctly', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Theoretical (Timoshenko): delta = wL⁴/(8EI) + wL²/(2G·As)
    const delta = (w * L * L * L * L) / (8 * E * I) + (w * L * L) / (2 * G * As);

    expect(result.displacements[4]).toBeCloseTo(delta, 4);
  });

  it('should compute fixed-end moment correctly', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Reaction Mz at node 0 = -wL²/2
    const Mfixed = -(w * L * L) / 2;
    expect(result.reactions[2]).toBeCloseTo(Mfixed, 4);
  });

  it('should compute fixed-end shear correctly', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Reaction Fy at node 0 = -wL
    const Vfixed = -(w * L);
    expect(result.reactions[1]).toBeCloseTo(Vfixed, 4);
  });
});

describe('Case 3: Fixed-fixed beam with uniform distributed load', () => {
  const w = -10;
  const L = 6;

  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, restraint: { ux: true, uy: true, rz: true } },
      { id: 'n1', x: L, y: 0, restraint: { ux: true, uy: true, rz: true } },
    ];
    model.members = [
      { id: 'm1', ni: 'n0', nj: 'n1', materialId: 'mat1', sectionId: 'sec1' },
    ];
    model.memberLoads = [
      { id: 'ml1', memberId: 'm1', type: 'udl', direction: 'localY', value: w },
    ];
    return model;
  }

  it('should have zero displacements at both ends', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    for (let i = 0; i < 6; i++) {
      expect(result.displacements[i]).toBeCloseTo(0, 10);
    }
  });

  it('should compute fixed-end moments correctly', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // For fixed-fixed beam with UDL:
    // M at each end = wL²/12
    const Mend = (w * L * L) / 12;

    // Reaction moments (opposite sign to fixed-end forces applied)
    expect(result.reactions[2]).toBeCloseTo(-Mend, 3);
    expect(result.reactions[5]).toBeCloseTo(Mend, 3);
  });

  it('should compute symmetric reactions', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Each support takes half the load
    const Vy = -(w * L) / 2;
    expect(result.reactions[1]).toBeCloseTo(Vy, 4);
    expect(result.reactions[4]).toBeCloseTo(Vy, 4);
  });
});

describe('Case 4: Simple portal frame (symmetric)', () => {
  // Two columns + one beam
  // Symmetric vertical load on beam
  const P = -20; // downward at midspan
  const H = 3; // column height
  const B = 4; // beam span

  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, restraint: { ux: true, uy: true, rz: true } },
      { id: 'n1', x: 0, y: H, restraint: { ux: false, uy: false, rz: false } },
      { id: 'n2', x: B, y: H, restraint: { ux: false, uy: false, rz: false } },
      { id: 'n3', x: B, y: 0, restraint: { ux: true, uy: true, rz: true } },
    ];
    model.members = [
      { id: 'col1', ni: 'n0', nj: 'n1', materialId: 'mat1', sectionId: 'sec1' },
      { id: 'beam', ni: 'n1', nj: 'n2', materialId: 'mat1', sectionId: 'sec1' },
      { id: 'col2', ni: 'n3', nj: 'n2', materialId: 'mat1', sectionId: 'sec1' },
    ];
    // Apply symmetric load: P/2 at each beam node
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'n1', fx: 0, fy: P / 2, mz: 0 },
      { id: 'nl2', nodeId: 'n2', fx: 0, fy: P / 2, mz: 0 },
    ];
    return model;
  }

  it('should produce symmetric vertical displacements', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Node 1 uy = Node 2 uy (symmetric)
    const uy1 = result.displacements[4]!; // node1 uy
    const uy2 = result.displacements[7]!; // node2 uy
    expect(uy1).toBeCloseTo(uy2, 6);
  });

  it('should produce antisymmetric horizontal displacements', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Node 1 ux = -Node 2 ux (antisymmetric for symmetric vertical load)
    const ux1 = result.displacements[3]!; // node1 ux
    const ux2 = result.displacements[6]!; // node2 ux
    expect(ux1).toBeCloseTo(-ux2, 6);
  });

  it('should have symmetric vertical reactions', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Ry at node 0 = Ry at node 3
    const Ry0 = result.reactions[1]!;
    const Ry3 = result.reactions[10]!;
    expect(Ry0).toBeCloseTo(Ry3, 6);

    // Total vertical reaction = -P
    expect(Ry0 + Ry3).toBeCloseTo(-P, 4);
  });
});

describe('Case 5: Axial-force-dominated member', () => {
  // Single member with axial load only
  const F_axial = 100; // kN tension
  const L = 5;
  const E = 200e6;
  const A = 0.01;

  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, restraint: { ux: true, uy: true, rz: true } },
      { id: 'n1', x: L, y: 0, restraint: { ux: false, uy: true, rz: false } },
    ];
    model.members = [
      { id: 'm1', ni: 'n0', nj: 'n1', materialId: 'mat1', sectionId: 'sec1' },
    ];
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'n1', fx: F_axial, fy: 0, mz: 0 },
    ];
    return model;
  }

  it('should compute axial displacement as FL/EA', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // delta = FL / EA
    const delta = (F_axial * L) / (E * A);

    // Node 1 ux is at DOF index 3
    expect(result.displacements[3]).toBeCloseTo(delta, 8);
  });

  it('should have zero transverse displacement', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Node 1 uy should be 0 (restrained)
    expect(result.displacements[4]).toBeCloseTo(0, 10);
  });
});
