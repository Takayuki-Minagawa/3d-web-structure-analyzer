import { beforeEach, describe, expect, it } from 'vitest';
import { ensureDisplayNumbers, memberLabel, nodeLabel } from '../../core/model/displayNumbers';
import type { ProjectModel } from '../../core/model/types';
import { validateModel } from '../../core/model/validation';
import { redoProject, undoProject, useProjectStore } from '../../state/projectStore';
import { exportModelTable, importModelTable } from '../../ui/tables/modelTableClipboard';

function baseModel(): ProjectModel {
  return {
    title: 'table',
    nodes: [],
    materials: [{ id: 'mat', name: 'Steel', E: 20500, G: 7900, nu: 0.3, expansion: 0 }],
    sections: [{ id: 'sec', name: 'H', materialId: 'mat', A: 10, Ix: 10, Iy: 10, Iz: 10, ky: 0, kz: 0 }],
    springs: [], members: [], couplings: [], nodalLoads: [], memberLoads: [],
    loadCases: [{ id: 'lc', name: 'Dead' }], activeLoadCaseId: 'lc', loadCombinations: [],
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

describe('improved model editing', () => {
  beforeEach(() => {
    useProjectStore.temporal.getState().clear();
    useProjectStore.getState().resetModel();
    useProjectStore.temporal.getState().clear();
  });

  it('tracks only model edits and supports undo/redo', () => {
    const id = useProjectStore.getState().addNode(1, 2, 3);
    expect(useProjectStore.getState().model.nodes).toHaveLength(1);
    expect(useProjectStore.getState().model.nodes[0]!.number).toBe(1);

    undoProject();
    expect(useProjectStore.getState().model.nodes).toHaveLength(0);
    expect(useProjectStore.getState().isResultStale).toBe(true);

    redoProject();
    expect(useProjectStore.getState().model.nodes[0]!.id).toBe(id);
  });

  it('assigns unique display numbers while preserving valid imported numbers', () => {
    const model = baseModel();
    model.nodes = [
      { id: 'a', number: 7, x: 0, y: 0, z: 0, restraint: { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false } },
      { id: 'b', number: 7, x: 1, y: 0, z: 0, restraint: { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false } },
    ];
    const normalized = ensureDisplayNumbers(model);
    expect(normalized.nodes.map((node) => node.number)).toEqual([7, 8]);
    expect(nodeLabel(normalized.nodes[0])).toBe('N7');
    expect(memberLabel(undefined)).toBe('?');
  });

  it('uses display numbers in node and member validation messages', () => {
    const model = baseModel();
    model.nodes = [
      { id: 'internal-a', number: 7, x: Number.NaN, y: 0, z: 0, restraint: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true } },
      { id: 'internal-b', number: 8, x: 1, y: 0, z: 0, restraint: { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false } },
    ];
    model.members = [{
      id: 'internal-member', number: 9, ni: 'internal-a', nj: 'internal-b',
      sectionId: 'sec', codeAngle: Number.NaN,
      iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 },
    }];

    const messages = validateModel(model).map((error) => error.message);
    expect(messages.some((message) => message.includes('節点 N7'))).toBe(true);
    expect(messages.some((message) => message.includes('部材 M9'))).toBe(true);
    expect(messages.some((message) => message.includes('internal-member'))).toBe(false);
  });

  it('imports spreadsheet TSV for nodes and members and exports it again', () => {
    let result = importModelTable(baseModel(), 'nodes', [
      'No\tX\tY\tZ\tSupport',
      '1\t0\t0\t0\tfixed',
      '2\t5\t0\t3\tfree',
    ].join('\n'));
    expect(result.model.nodes).toHaveLength(2);
    expect(result.model.nodes[0]!.restraint.rz).toBe(true);

    result = importModelTable(result.model, 'members', 'No\tiNode\tjNode\tSection\tCodeAngle\n1\t1\t2\tH\t90');
    expect(result.model.members).toHaveLength(1);
    expect(result.model.members[0]!.codeAngle).toBe(90);
    expect(exportModelTable(result.model, 'members')).toContain('1\t1\t2\tsec\tH\t90');
  });

  it('reports invalid spreadsheet references without mutating the source model', () => {
    const model = importModelTable(baseModel(), 'nodes', '1\t0\t0\t0\tfree').model;
    expect(() => importModelTable(model, 'members', '1\t1\t99\tH\t0')).toThrow(/referenced node/);
    expect(model.members).toHaveLength(0);
  });

  it('round-trips global, temperature and self-weight member loads through TSV', () => {
    let model = importModelTable(baseModel(), 'nodes', '1\t0\t0\t0\tfixed\n2\t5\t0\t0\tfree').model;
    model = importModelTable(model, 'members', '1\t1\t2\tH\t0').model;
    const result = importModelTable(model, 'memberLoads', [
      'Target\tCase\tType\tDirection\tValue\ta',
      '1\tDead\tudl\tglobalZ\t-3\t',
      '1\tDead\ttemperature\tlocalX\t25\t',
      '1\tDead\tselfWeight\tglobalZ\t1\t',
    ].join('\n'));

    expect(result.model.memberLoads.map((load) => load.type)).toEqual([
      'udl', 'temperature', 'selfWeight',
    ]);
    const exported = exportModelTable(result.model, 'memberLoads');
    expect(exported).toContain('temperature\tlocalX\t25');
    expect(exported).toContain('selfWeight\tglobalZ\t1');
  });
});
