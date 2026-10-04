import { describe, expect, it } from 'vitest';
import { analyzeFrame } from '../../core/analysis/analyzeFrame';
import { buildIndexedModel } from '../../core/model/indexing';
import { diagnoseModel } from '../../core/model/modelDiagnostics';
import { FIXED_RESTRAINT, FREE_RESTRAINT } from '../../core/model/restraints';
import type { CouplingConstraint, Member, ProjectModel, StructuralNode } from '../../core/model/types';
import { validateModel } from '../../core/model/validation';

function node(id: string, x: number, y = 0, z = 0): StructuralNode {
  return { id, x, y, z, restraint: { ...FREE_RESTRAINT } };
}

function member(id: string, ni: string, nj: string): Member {
  return {
    id, ni, nj, sectionId: 'sec', codeAngle: 0,
    iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 },
  };
}

function coupling(masterNodeId: string, slaveNodeId: string): CouplingConstraint {
  return { id: `${masterNodeId}-${slaveNodeId}`, masterNodeId, slaveNodeId, ...FIXED_RESTRAINT };
}

function cantilever(): ProjectModel {
  return {
    title: 'Model diagnostics',
    nodes: [{ ...node('base', 0), restraint: { ...FIXED_RESTRAINT } }, node('tip', 4)],
    materials: [{ id: 'mat', name: 'Steel', E: 200e6, G: 80e6, nu: 0.25, expansion: 0 }],
    sections: [{
      id: 'sec', name: 'Section', materialId: 'mat', A: 0.01,
      Ix: 1e-5, Iy: 1e-6, Iz: 4e-6, ky: 0, kz: 0,
    }],
    members: [member('beam', 'base', 'tip')],
    springs: [], couplings: [], nodalLoads: [], memberLoads: [],
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

function warnings(model: ProjectModel) {
  return diagnoseModel(model).filter((diagnostic) => diagnostic.severity === 'warning');
}

describe('model diagnostics', () => {
  it('accepts a connected, valid cantilever without findings', () => {
    expect(diagnoseModel(cantilever())).toEqual([]);
  });

  it('groups exactly coincident distinct node IDs, including signed zero', () => {
    const model = cantilever();
    model.nodes.push(node('duplicate', -0), node('near', 1e-12), node('nan', NaN), node('infinite', Infinity));
    const coincident = diagnoseModel(model).filter((diagnostic) => diagnostic.code === 'coincident-nodes');

    expect(coincident).toEqual([{
      code: 'coincident-nodes', severity: 'warning', nodeIds: ['base', 'duplicate'], memberIds: [],
    }]);
  });

  it('leaves repeated node IDs to validation instead of reporting coincident nodes', () => {
    const model = cantilever();
    model.nodes.push({ ...model.nodes[0]! });

    expect(diagnoseModel(model).some((diagnostic) => diagnostic.code === 'coincident-nodes')).toBe(false);
    expect(diagnoseModel(model).some((diagnostic) => diagnostic.code === 'validation')).toBe(true);
  });

  it('groups duplicate members including reversed endpoints', () => {
    const model = cantilever();
    model.members.push(member('reversed', 'tip', 'base'), member('parallel', 'base', 'tip'));

    expect(warnings(model)).toEqual([{
      code: 'duplicate-members', severity: 'warning',
      nodeIds: ['base', 'tip'], memberIds: ['beam', 'reversed', 'parallel'],
    }]);
  });

  it('keeps imported endpoint IDs containing separators distinct', () => {
    const model = cantilever();
    model.nodes = [node('a|b', 0), node('c', 1), node('a', 2), node('b|c', 3)];
    model.members = [member('one', 'a|b', 'c'), member('two', 'a', 'b|c')];

    expect(warnings(model).some((diagnostic) => diagnostic.code === 'duplicate-members')).toBe(false);
  });

  it('warns about supported and spring-supported isolated nodes without rejecting them', () => {
    const model = cantilever();
    model.nodes.push({ ...node('fixed', 8), restraint: { ...FIXED_RESTRAINT } }, node('spring', 12));
    model.nodeSprings = [{ id: 'support', nodeId: 'spring', ux: 10, uy: 10, uz: 10, rx: 10, ry: 10, rz: 10 }];

    expect(diagnoseModel(model)).toEqual([{
      code: 'isolated-nodes', severity: 'warning', nodeIds: ['fixed', 'spring'], memberIds: [],
    }]);
    expect(() => analyzeFrame({ model: buildIndexedModel(model) })).not.toThrow();
  });

  it('reports disconnected member components in model order, separately from isolated nodes', () => {
    const model = cantilever();
    model.nodes.push(node('second-tip', 14), node('second-base', 10), node('alone', 20));
    model.members.push(member('second-beam', 'second-base', 'second-tip'));

    expect(warnings(model)).toEqual([
      { code: 'isolated-nodes', severity: 'warning', nodeIds: ['alone'], memberIds: [] },
      { code: 'disconnected-components', severity: 'warning', nodeIds: ['base', 'tip'], memberIds: ['beam'] },
      { code: 'disconnected-components', severity: 'warning', nodeIds: ['second-tip', 'second-base'], memberIds: ['second-beam'] },
    ]);
  });

  it('uses active couplings to connect member components and additional nodes', () => {
    const model = cantilever();
    model.nodes.push(node('second-base', 10), node('second-tip', 14), node('coupled', 20));
    model.members.push(member('second-beam', 'second-base', 'second-tip'));
    model.couplings = [coupling('tip', 'second-base'), coupling('second-tip', 'coupled')];

    expect(diagnoseModel(model)).toEqual([]);
  });

  it('does not count inactive, self, or missing-endpoint couplings as connections', () => {
    const model = cantilever();
    model.nodes.push(node('inactive', 10), node('self', 14), node('orphan', 20));
    model.couplings = [
      { ...coupling('tip', 'inactive'), ...FREE_RESTRAINT },
      coupling('self', 'self'),
      coupling('missing', 'orphan'),
    ];

    expect(warnings(model)).toEqual([{
      code: 'isolated-nodes', severity: 'warning', nodeIds: ['inactive', 'self', 'orphan'], memberIds: [],
    }]);
    const isolatedErrors = validateModel(model).filter((error) => error.message.includes('孤立節点'));
    expect(isolatedErrors.map((error) => error.nodeId)).toEqual(['inactive', 'self', 'orphan']);
  });

  it('keeps coupling-only components out of disconnected-member warnings', () => {
    const model = cantilever();
    model.nodes.push(node('master', 10), node('slave', 14));
    model.couplings = [coupling('master', 'slave')];

    expect(warnings(model)).toEqual([]);
  });

  it('preserves all validation errors and locations when coordinates and references are invalid', () => {
    const model = cantilever();
    model.nodes[1]!.x = NaN;
    model.members[0]!.nj = 'missing';
    const errors = validateModel(model);
    const diagnostics = diagnoseModel(model);

    expect(diagnostics.filter((diagnostic) => diagnostic.code === 'validation')).toEqual(
      errors.map((error) => ({
        code: 'validation', severity: 'error',
        nodeIds: error.nodeId === undefined ? [] : [error.nodeId],
        memberIds: error.elementId === undefined ? [] : [error.elementId],
        message: error.message,
      }))
    );
    expect(warnings(model)).toEqual([{
      code: 'isolated-nodes', severity: 'warning', nodeIds: ['base', 'tip'], memberIds: [],
    }]);
  });

  it('handles an empty model and does not mutate input when repeatedly diagnosing', () => {
    const model = cantilever();
    model.nodes = [];
    model.members = [];
    const before = structuredClone(model);

    const first = diagnoseModel(model);
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((diagnostic) => diagnostic.severity === 'error')).toBe(true);
    expect(diagnoseModel(model)).toEqual(first);
    expect(model).toEqual(before);
  });

  it('does not sort, merge, or otherwise edit nodes, members, or couplings', () => {
    const model = cantilever();
    model.nodes.push(node('coincident', 4));
    model.members.push(member('duplicate', 'tip', 'base'));
    model.couplings = [coupling('tip', 'coincident')];
    const before = structuredClone(model);

    const first = diagnoseModel(model);
    expect(diagnoseModel(model)).toEqual(first);
    expect(model).toEqual(before);
  });
});

describe('isolated-node validation and analysis', () => {
  it('transfers load from a coupling-only node and recovers cantilever displacement and reaction', () => {
    const model = cantilever();
    model.nodes.push(node('coupled-load', 5));
    model.couplings = [coupling('tip', 'coupled-load')];
    const force = -10;
    model.nodalLoads = [{ id: 'load', nodeId: 'coupled-load', fx: 0, fy: force, fz: 0, mx: 0, my: 0, mz: 0 }];

    expect(validateModel(model)).toEqual([]);
    const result = analyzeFrame({ model: buildIndexedModel(model) });
    // kN, m: Euler-Bernoulli cantilever with a transverse end force (ky = kz = 0).
    const expected = force * 4 ** 3 / (3 * model.materials[0]!.E * model.sections[0]!.Iz);
    expect(result.displacements[7]).toBeCloseTo(expected, 10);
    expect(result.displacements[13]).toBeCloseTo(expected, 10);
    expect(result.reactions[1]).toBeCloseTo(-force, 10);
    expect(result.reactions[5]).toBeCloseTo(-force * 4, 10);
  });

  it('allows an otherwise isolated node fully restrained in its active 2D DOFs', () => {
    const model = cantilever();
    model.analysisMode = 'xz2d';
    model.nodes.push({
      ...node('supported', 10),
      restraint: { ...FREE_RESTRAINT, ux: true, uz: true, ry: true },
    });

    expect(validateModel(model)).toEqual([]);
    expect(warnings(model).map((diagnostic) => diagnostic.code)).toEqual(['isolated-nodes']);
    expect(() => analyzeFrame({ model: buildIndexedModel(model) })).not.toThrow();
  });

  it('continues rejecting an unconnected node with free active DOFs', () => {
    const model = cantilever();
    model.nodes.push(node('unsupported', 8));

    expect(validateModel(model).some((error) => error.nodeId === 'unsupported' && error.message.includes('孤立節点')))
      .toBe(true);
  });
});

describe('diagnostic selection locations', () => {
  const invalidNonMemberEntities: Array<[string, (model: ProjectModel) => void]> = [
    ['material', (model) => {
      model.materials.push({
        ...model.materials[0]!, id: 'beam', name: 'Unused invalid material',
        E: 0, G: 0, expansion: NaN, density: -1,
      });
    }],
    ['section', (model) => {
      model.sections.push({
        ...model.sections[0]!, id: 'beam', name: 'Unused invalid section',
        A: 0, Ix: -1, Iy: 0, Iz: 0, ky: -1, kz: -1,
      });
    }],
    ['spring', (model) => {
      model.springs = [
        { id: 'beam', number: -1, method: 0, kTheta: -1 },
        { id: 'other', number: -1, method: 0, kTheta: 1 },
      ];
    }],
    ['coupling', (model) => {
      model.couplings = [{ ...coupling('base', 'base'), id: 'beam' }];
    }],
  ];

  it.each(invalidNonMemberEntities)(
    'does not select an unrelated member with the same ID as an invalid %s',
    (_, configure) => {
      const model = cantilever();
      configure(model);
      const errors = diagnoseModel(model).filter((diagnostic) => diagnostic.code === 'validation');

      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every((error) => error.memberIds.length === 0 && error.nodeIds.length === 0)).toBe(true);
      expect(errors.every((error) => Boolean(error.message))).toBe(true);
    }
  );

  const duplicateEntityGroups: Array<[string, (model: ProjectModel) => void]> = [
    ['material', (model) => {
      model.materials.push(...Array.from({ length: 2 }, () => ({ ...model.materials[0]!, id: 'beam' })));
    }],
    ['section', (model) => {
      model.sections.push(...Array.from({ length: 2 }, () => ({ ...model.sections[0]!, id: 'beam' })));
    }],
    ['spring', (model) => {
      model.springs = [3, 4].map((number) => ({ id: 'beam', number, method: 0, kTheta: 1 }));
    }],
    ['nodal spring', (model) => {
      model.nodeSprings = Array.from({ length: 2 }, () => ({
        id: 'beam', nodeId: 'base', ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0,
      }));
    }],
    ['nodal load', (model) => {
      model.nodalLoads = Array.from({ length: 2 }, () => ({
        id: 'beam', nodeId: 'tip', fx: 0, fy: 1, fz: 0, mx: 0, my: 0, mz: 0,
      }));
    }],
    ['member load', (model) => {
      model.memberLoads = Array.from({ length: 2 }, () => ({
        id: 'beam', memberId: 'beam', type: 'udl', direction: 'localY', value: 1,
      }));
    }],
    ['coupling', (model) => {
      model.couplings = Array.from({ length: 2 }, () => ({
        ...coupling('base', 'tip'), ...FREE_RESTRAINT, id: 'beam',
      }));
    }],
    ['prescribed displacement', (model) => {
      model.prescribedDisplacements = Array.from({ length: 2 }, () => ({
        id: 'beam', nodeId: 'base', ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0,
      }));
    }],
    ['nodal mass', (model) => {
      model.nodeMasses = Array.from({ length: 2 }, () => ({ id: 'beam', nodeId: 'tip', mass: 1 }));
    }],
  ];

  it.each(duplicateEntityGroups)(
    'does not treat a duplicate %s ID as a member ID',
    (_, configure) => {
      const model = cantilever();
      configure(model);
      const errors = diagnoseModel(model).filter((diagnostic) => diagnostic.code === 'validation');

      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ nodeIds: [], memberIds: [] });
      expect(errors[0]!.message).toContain('ID "beam" が重複');
    }
  );

  it('selects the node targeted by an invalid nodal spring, never its matching member ID', () => {
    const model = cantilever();
    model.nodeSprings = [{ id: 'beam', nodeId: 'tip', ux: -1, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 }];

    expect(diagnoseModel(model)).toEqual([expect.objectContaining({
      code: 'validation', nodeIds: ['tip'], memberIds: [],
    })]);
  });

  it('continues locating errors and duplicate IDs belonging to actual members and nodes', () => {
    const model = cantilever();
    model.members[0]!.codeAngle = NaN;
    model.members.push({ ...model.members[0]! });
    model.nodes.push({ ...model.nodes[0]! });
    const errors = diagnoseModel(model).filter((diagnostic) => diagnostic.code === 'validation');

    expect(errors.find((error) => error.message?.includes('コード角'))?.memberIds).toEqual(['beam']);
    expect(errors.find((error) => error.message?.includes('部材 ID'))?.memberIds).toEqual(['beam']);
    expect(errors.find((error) => error.message?.includes('節点 ID'))?.nodeIds).toEqual(['base']);
  });
});
