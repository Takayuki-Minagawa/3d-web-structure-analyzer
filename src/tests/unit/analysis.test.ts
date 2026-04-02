import { describe, it, expect } from 'vitest';
import { buildIndexedModel } from '../../core/model/indexing';
import { analyzeFrame } from '../../core/analysis/analyzeFrame';
import type { ProjectModel, Restraint } from '../../core/model/types';

const FREE: Restraint = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
const FIXED: Restraint = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

// Helper: simple model with one material and one section
function createBaseModel(): ProjectModel {
  return {
    title: 'Test',
    nodes: [],
    materials: [{ id: 'mat1', name: 'Steel', E: 200e6, G: 200e6 / (2 * 1.3), nu: 0.3, expansion: 0 }],
    sections: [{
      id: 'sec1', name: '10x10', materialId: 'mat1',
      A: 0.01, Ix: 8.333e-6, Iy: 8.333e-6, Iz: 8.333e-6, ky: 0.5, kz: 0.5,
    }],
    springs: [],
    members: [],
    couplings: [],
    nodalLoads: [],
    memberLoads: [],
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

function defaultMember(id: string, ni: string, nj: string) {
  return {
    id, ni, nj, sectionId: 'sec1', codeAngle: 0,
    iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 },
  };
}

describe('3D Cantilever beam with tip load in Y', () => {
  // Member along X-axis, fixed at node 0, load in Y at node 1
  const P = -10;
  const L = 4;
  const E = 200e6;
  const Iz = 8.333e-6;
  const nu = 0.3;
  const G = E / (2 * (1 + nu));
  const A = 0.01;
  // Asz = ky * A (ky=0.5), used for Y-bending (phi_z uses kz)

  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, z: 0, restraint: FIXED },
      { id: 'n1', x: L, y: 0, z: 0, restraint: FREE },
    ];
    model.members = [defaultMember('m1', 'n0', 'n1')];
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'n1', fx: 0, fy: P, fz: 0, mx: 0, my: 0, mz: 0 },
    ];
    return model;
  }

  it('should compute tip displacement uy correctly', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Theoretical (Timoshenko): delta = PL³/(3EIz) + PL/(G·Asz)
    // Asz = kz * A for Z-bending. For Y bending, phi_z uses kz.
    const kz = 0.5;
    const AszVal = kz * A;
    const delta = (P * L * L * L) / (3 * E * Iz) + (P * L) / (G * AszVal);

    // Node 1 uy is at DOF index 6*1 + 1 = 7
    expect(result.displacements[7]).toBeCloseTo(delta, 4);
  });

  it('should compute vertical reaction at fixed end', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Ry at node 0 = -P
    expect(result.reactions[1]).toBeCloseTo(-P, 4);
  });
});

describe('3D Cantilever beam with tip load in Z', () => {
  const P = -10;
  const L = 4;
  const E = 200e6;
  const Iy = 8.333e-6;
  const nu = 0.3;
  const G = E / (2 * (1 + nu));

  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, z: 0, restraint: FIXED },
      { id: 'n1', x: L, y: 0, z: 0, restraint: FREE },
    ];
    model.members = [defaultMember('m1', 'n0', 'n1')];
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'n1', fx: 0, fy: 0, fz: P, mx: 0, my: 0, mz: 0 },
    ];
    return model;
  }

  it('should compute tip displacement uz correctly', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // delta = PL³/(3EIy) + PL/(G·Asy), Asy = ky * A
    const ky = 0.5;
    const A = 0.01;
    const Asy = ky * A;
    const delta = (P * L * L * L) / (3 * E * Iy) + (P * L) / (G * Asy);

    // Node 1 uz is at DOF index 6*1 + 2 = 8
    expect(result.displacements[8]).toBeCloseTo(delta, 4);
  });
});

describe('3D Axial member', () => {
  const F = 100;
  const L = 5;
  const E = 200e6;
  const A = 0.01;

  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, z: 0, restraint: FIXED },
      { id: 'n1', x: L, y: 0, z: 0, restraint: { ...FREE, uy: true, uz: true } },
    ];
    model.members = [defaultMember('m1', 'n0', 'n1')];
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'n1', fx: F, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
    ];
    return model;
  }

  it('should compute axial displacement as FL/EA', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    const delta = (F * L) / (E * A);
    // Node 1 ux at DOF 6*1 + 0 = 6
    expect(result.displacements[6]).toBeCloseTo(delta, 8);
  });
});

describe('3D Torsion member', () => {
  const T = 50; // Torque about X
  const L = 5;
  const E = 200e6;
  const nu = 0.3;
  const G = E / (2 * (1 + nu));
  const Ix = 8.333e-6;

  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, z: 0, restraint: FIXED },
      { id: 'n1', x: L, y: 0, z: 0, restraint: { ...FREE, uy: true, uz: true } },
    ];
    model.members = [defaultMember('m1', 'n0', 'n1')];
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'n1', fx: 0, fy: 0, fz: 0, mx: T, my: 0, mz: 0 },
    ];
    return model;
  }

  it('should compute torsional rotation as TL/(GIx)', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    const theta = (T * L) / (G * Ix);
    // Node 1 rx at DOF 6*1 + 3 = 9
    expect(result.displacements[9]).toBeCloseTo(theta, 4);
  });
});

describe('3D Portal frame: equilibrium check', () => {
  const Fx = 10;

  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, z: 0, restraint: FIXED },
      { id: 'n1', x: 0, y: 0, z: 4, restraint: FREE },
      { id: 'n2', x: 6, y: 0, z: 4, restraint: FREE },
      { id: 'n3', x: 6, y: 0, z: 0, restraint: FIXED },
    ];
    model.members = [
      defaultMember('col1', 'n0', 'n1'),
      defaultMember('beam', 'n1', 'n2'),
      defaultMember('col2', 'n3', 'n2'),
    ];
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'n1', fx: Fx, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
    ];
    return model;
  }

  it('should satisfy global force equilibrium (sum Rx = -Fx)', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Sum of X reactions at nodes 0 and 3
    const Rx0 = result.reactions[0]!; // node 0 ux
    const Rx3 = result.reactions[18]!; // node 3 ux (6*3 + 0)
    expect(Rx0 + Rx3).toBeCloseTo(-Fx, 4);
  });

  it('should satisfy global force equilibrium in Z', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // Sum of Z reactions should be zero (no applied Z loads)
    const Rz0 = result.reactions[2]!;  // node 0 uz
    const Rz3 = result.reactions[20]!; // node 3 uz (6*3+2)
    expect(Rz0 + Rz3).toBeCloseTo(0, 4);
  });
});

describe('Pin release at member end', () => {
  // Portal frame: col1(n0-n1), beam(n1-n2) with pin at i-end rz, col2(n3-n2)
  // The beam should have zero Mz at its pinned i-end.
  const P = -20;

  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.springs = [
      { id: 'spr1', number: 1, method: 0, kTheta: 0 },
      { id: 'spr2', number: 2, method: 0, kTheta: 0 },
    ];
    model.nodes = [
      { id: 'n0', x: 0, y: 0, z: 0, restraint: FIXED },
      { id: 'n1', x: 0, y: 0, z: 3, restraint: FREE },
      { id: 'n2', x: 4, y: 0, z: 3, restraint: FREE },
      { id: 'n3', x: 4, y: 0, z: 0, restraint: FIXED },
    ];
    model.members = [
      defaultMember('col1', 'n0', 'n1'),
      {
        ...defaultMember('beam', 'n1', 'n2'),
        iSprings: { x: 0, y: 0, z: 2 }, // pin about Z at beam i-end
      },
      defaultMember('col2', 'n3', 'n2'),
    ];
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'n1', fx: 0, fy: 0, fz: P / 2, mx: 0, my: 0, mz: 0 },
      { id: 'nl2', nodeId: 'n2', fx: 0, fy: 0, fz: P / 2, mx: 0, my: 0, mz: 0 },
    ];
    return model;
  }

  it('should have zero Mz at the pinned beam i-end', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    const ef = result.elementEndForces.get('beam')!;
    // End forces: [Ni,Vyi,Vzi,Mxi,Myi,Mzi, Nj,Vyj,Vzj,Mxj,Myj,Mzj]
    // Mzi (index 5) should be ~0 due to pin release at beam i-end
    expect(Math.abs(ef[5]!)).toBeLessThan(1e-6);
  });

  it('should satisfy global equilibrium (sum Rz = -P)', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    const Rz0 = result.reactions[2]!;
    const Rz3 = result.reactions[20]!;
    expect(Rz0 + Rz3).toBeCloseTo(-P, 4);
  });

  it('should have zero Mz at pinned end with UDL member load', () => {
    // Reproducer for issue #14: pin release + UDL
    const model = createBaseModel();
    model.springs = [
      { id: 'spr2', number: 2, method: 0, kTheta: 0 },
    ];
    model.nodes = [
      { id: 'n0', x: 0, y: 0, z: 0, restraint: FIXED },
      { id: 'n1', x: 5, y: 0, z: 0, restraint: FIXED },
    ];
    model.members = [
      {
        ...defaultMember('m1', 'n0', 'n1'),
        jSprings: { x: 0, y: 0, z: 2 }, // pin about Z at j-end
      },
    ];
    model.memberLoads = [
      { id: 'ml1', memberId: 'm1', type: 'udl', direction: 'localY', value: -10 },
    ];
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    const ef = result.elementEndForces.get('m1')!;
    // Mzj (index 11) should be ~0 due to pin release at j-end
    expect(Math.abs(ef[11]!)).toBeLessThan(1e-6);
  });
});

describe('DOF coupling (same displacement)', () => {
  // Two separate cantilevers side by side, coupled at their tips
  function buildModel(): ProjectModel {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, z: 0, restraint: FIXED },
      { id: 'n1', x: 4, y: 0, z: 0, restraint: FREE },
      { id: 'n2', x: 0, y: 2, z: 0, restraint: FIXED },
      { id: 'n3', x: 4, y: 2, z: 0, restraint: FREE },
    ];
    model.members = [
      defaultMember('m1', 'n0', 'n1'),
      defaultMember('m2', 'n2', 'n3'),
    ];
    // Load only on n1
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'n1', fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 },
    ];
    // Couple n1 and n3 in uz (so both tips displace together in Z)
    model.couplings = [
      { id: 'c1', masterNodeId: 'n1', slaveNodeId: 'n3', ux: false, uy: false, uz: true, rx: false, ry: false, rz: false },
    ];
    return model;
  }

  it('should give equal uz at coupled nodes', () => {
    const model = buildModel();
    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // n1 uz at DOF 6*1+2=8, n3 uz at DOF 6*3+2=20
    expect(result.displacements[8]).toBeCloseTo(result.displacements[20]!, 8);
  });

  it('coupled displacement should be smaller than uncoupled', () => {
    // The second beam shares the load, so the coupled displacement is smaller
    const coupledModel = buildModel();
    const uncoupledModel = buildModel();
    uncoupledModel.couplings = [];

    const cIdx = buildIndexedModel(coupledModel);
    const uIdx = buildIndexedModel(uncoupledModel);
    const cRes = analyzeFrame({ model: cIdx });
    const uRes = analyzeFrame({ model: uIdx });

    // Coupled uz should be roughly half of uncoupled (both beams share the load)
    const cUz = Math.abs(cRes.displacements[8]!);
    const uUz = Math.abs(uRes.displacements[8]!);
    expect(cUz).toBeLessThan(uUz);
    expect(cUz).toBeCloseTo(uUz / 2, 2);
  });
});

describe('Coupling: slave-side constraint propagates to master', () => {
  // Issue #16: if slave DOF is fixed, master DOF should also be fixed
  it('should treat master DOF as fixed when slave is restrained', () => {
    const model = createBaseModel();
    model.nodes = [
      { id: 'nm', x: 0, y: 0, z: 0, restraint: FREE },  // master: free
      { id: 'ns', x: 0, y: 2, z: 0, restraint: { ux: true, uy: false, uz: false, rx: false, ry: false, rz: false } }, // slave: ux fixed
      { id: 'n2', x: 4, y: 0, z: 0, restraint: FIXED },
      { id: 'n3', x: 4, y: 2, z: 0, restraint: FIXED },
    ];
    model.members = [
      defaultMember('m1', 'nm', 'n2'),
      defaultMember('m2', 'ns', 'n3'),
    ];
    // Couple nm and ns in ux (master=nm, slave=ns)
    model.couplings = [
      { id: 'c1', masterNodeId: 'nm', slaveNodeId: 'ns', ux: true, uy: false, uz: false, rx: false, ry: false, rz: false },
    ];
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'nm', fx: 0, fy: 0, fz: -10, mx: 0, my: 0, mz: 0 },
    ];

    const indexed = buildIndexedModel(model);
    const result = analyzeFrame({ model: indexed });

    // nm ux (DOF 0) should be 0 because slave ns has ux fixed → propagated to master
    expect(result.displacements[0]).toBeCloseTo(0, 8);
  });
});

describe('Vertical member orientation', () => {
  // A member pointing straight up (along Z) should use reference vector [1,0,0]
  // instead of [0,0,1]
  it('should handle vertical members without NaN', () => {
    const model = createBaseModel();
    model.nodes = [
      { id: 'n0', x: 0, y: 0, z: 0, restraint: FIXED },
      { id: 'n1', x: 0, y: 0, z: 5, restraint: FREE },
    ];
    model.members = [defaultMember('m1', 'n0', 'n1')];
    model.nodalLoads = [
      { id: 'nl1', nodeId: 'n1', fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
    ];

    const indexed = buildIndexedModel(model);
    // Lambda should not contain NaN
    for (let i = 0; i < 9; i++) {
      expect(Number.isFinite(indexed.members[0]!.lambda[i])).toBe(true);
    }

    const result = analyzeFrame({ model: indexed });
    // Should not crash and displacements should be finite
    for (let i = 0; i < result.displacements.length; i++) {
      expect(Number.isFinite(result.displacements[i])).toBe(true);
    }
  });
});
