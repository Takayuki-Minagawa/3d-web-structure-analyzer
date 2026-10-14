import { describe, expect, it } from 'vitest';
import type { MemberLoad, ProjectModel } from '../../core/model/types';
import { FREE_RESTRAINT, FIXED_RESTRAINT } from '../../core/model/restraints';
import { importJsonTextAuto } from '../../io/jsonImporter';
import {
  exportModelTable,
  importModelTable,
  TableImportValidationError,
} from '../../ui/tables/modelTableClipboard';

function modelForTables(): ProjectModel {
  return {
    title: 'Clipboard input integrity',
    nodes: [
      { id: 'i', number: 1, x: 0, y: 0, z: 0, restraint: { ...FIXED_RESTRAINT } },
      { id: 'j', number: 2, x: 5, y: 0, z: 0, restraint: { ...FREE_RESTRAINT } },
    ],
    members: [{
      id: 'm', number: 1, ni: 'i', nj: 'j', sectionId: 'sec-b', codeAngle: 17.25,
      iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 },
    }],
    materials: [{ id: 'mat', name: 'Steel', E: 200, G: 80, nu: 0.25, expansion: 1e-5 }],
    sections: ['sec-a', 'sec-b'].map((id) => ({
      id, name: 'Same section', materialId: 'mat', A: 10, Ix: 10, Iy: 10, Iz: 10, ky: 0, kz: 0,
    })),
    springs: [], couplings: [], nodeSprings: [], nodalLoads: [], memberLoads: [],
    loadCases: [{ id: 'a', name: 'Same' }, { id: 'b', name: 'Same' }],
    activeLoadCaseId: 'a', loadCombinations: [],
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

describe('strict table clipboard inputs', () => {
  it.each(['nodalLoads', 'memberLoads'] as const)('rejects unknown and ambiguous %s case names before applying any rows', (kind) => {
    const model = modelForTables();
    const original = JSON.stringify(model);
    const valid = kind === 'nodalLoads' ? '2\ta\t1\t0\t0\t0\t0\t0' : '1\ta\tudl\tglobalZ\t-1';
    for (const token of ['Earthquake-X-misspelled', 'Same']) {
      const invalid = kind === 'nodalLoads' ? `2\t${token}\t0\t0\t-50\t0\t0\t0` : `1\t${token}\tudl\tglobalZ\t-50`;
      try {
        importModelTable(model, kind, `${valid}\n${invalid}`);
        throw new Error('expected invalid case rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(TableImportValidationError);
        expect(error).toMatchObject({ row: 2, field: 'load case', value: token, candidates: ['a (Same)', 'b (Same)'] });
      }
      expect(JSON.stringify(model)).toBe(original);
    }
  });

  it('uses the active case only when the legacy case cell is blank', () => {
    const model = modelForTables();
    model.activeLoadCaseId = 'b';
    const result = importModelTable(model, 'nodalLoads', '2\t\t1\t2\t3\t4\t5\t6');
    expect(result.model.nodalLoads[0]!.loadCaseId).toBe('b');
  });

  it('uses explicit IDs over display names and rejects an unknown ID even with a matching name', () => {
    const model = modelForTables();
    const header = 'Target\tCaseId\tCaseName\tFx\tFy\tFz\tMx\tMy\tMz';
    const imported = importModelTable(model, 'nodalLoads', `${header}\n2\tb\tOld display name\t1\t0\t0\t0\t0\t0`);
    expect(imported.model.nodalLoads[0]!.loadCaseId).toBe('b');
    expect(() => importModelTable(model, 'nodalLoads', `${header}\n2\tmissing-id\tSame\t1\t0\t0\t0\t0\t0`))
      .toThrow(/Row 2: load case.*missing-id/);
    model.loadCases = [{ id: 'a', name: 'b' }, { id: 'b', name: 'Another' }];
    const nameOnly = importModelTable(model, 'nodalLoads', `${header}\n2\t\tb\t1\t0\t0\t0\t0\t0`);
    expect(nameOnly.model.nodalLoads[0]!.loadCaseId).toBe('a');
  });

  it('preserves duplicate section IDs and refuses unknown or ambiguous legacy section names', () => {
    const model = modelForTables();
    const tsv = exportModelTable(model, 'members');
    expect(tsv).toContain('SectionId\tSectionName');
    const restored = importModelTable({ ...model, members: [] }, 'members', tsv);
    expect(restored.model.members[0]).toMatchObject({ sectionId: 'sec-b', codeAngle: 17.25 });
    expect(() => importModelTable(model, 'members', '1\t1\t2\tSame section\t0')).toThrow(/section is ambiguous/);
    expect(() => importModelTable(model, 'members', '1\t1\t2\tTypo section\t0')).toThrow(/section was not found/);
    expect(model.members[0]!.sectionId).toBe('sec-b');
  });

  it('rejects incomplete CMQ rows, including each missing component', () => {
    const model = modelForTables();
    expect(() => importModelTable(model, 'memberLoads', '1\ta\tcmq\t1')).toThrow(/CMQ iQy is required/);
    for (let component = 0; component < 12; component += 1) {
      const values = Array.from({ length: 12 }, (_, index) => String(index + 1));
      values[component] = '';
      expect(() => importModelTable(model, 'memberLoads', `1\ta\tcmq\t${values.join('\t')}`)).toThrow(/CMQ .* is required/);
    }
    expect(model.memberLoads).toEqual([]);
  });

  it.each([
    '1\ta\tpoint\tlocalX\t10',
    '1\ta\tudl\tlocalZ',
    '1\ta\ttemperature\tlocalX',
    '1\ta\tselfWeight\tglobalZ',
    '1\ta\ttrapezoid\tlocalZ\t10\t0\t20',
  ])('rejects incomplete scalar member-load inputs: %s', (text) => {
    expect(() => importModelTable(modelForTables(), 'memberLoads', text)).toThrow(/required/);
  });

  it.each(['NaN', 'Infinity', '1e999', '0x10', '1abc', ''])('rejects a non-decimal or empty coordinate: %s', (value) => {
    const model = modelForTables();
    expect(() => importModelTable(model, 'nodes', `1\t${value}\t0\t0`)).toThrow(/X/);
    expect(model.nodes[0]!.x).toBe(0);
  });

  it('preserves source line numbers including headers and blank rows', () => {
    expect(() => importModelTable(modelForTables(), 'nodalLoads', '\nTarget\tCase\tFx\tFy\tFz\tMx\tMy\tMz\n\n2\tUnknown\t1\t0\t0\t0\t0\t0'))
      .toThrow(/Row 4: load case/);
  });

  it('rejects malformed quoted numeric cells instead of joining their values', () => {
    expect(() => importModelTable(modelForTables(), 'nodes', '1\t"1"0\t0\t0')).toThrow(/closing quote/);
    expect(() => importModelTable(modelForTables(), 'nodes', '1\t"10\t0\t0')).toThrow(/unclosed quoted cell/);
  });
});

describe('TSV and native JSON round trips', () => {
  it('preserves all load types, full numeric precision and duplicate case identities', () => {
    const model = modelForTables();
    model.nodalLoads = [{
      id: 'nl', nodeId: 'j', loadCaseId: 'b', fx: 1.2345678901234567,
      fy: -2e-15, fz: 3, mx: 4, my: -5, mz: 6,
    }];
    const base = { memberId: 'm', loadCaseId: 'b' };
    model.memberLoads = [
      { ...base, id: 'udl', type: 'udl', direction: 'globalZ', value: 1.2345678901234567 },
      { ...base, id: 'point', type: 'point', direction: 'localX', value: -5, a: 0.1234567890123456 },
      { ...base, id: 'trap', type: 'trapezoid', direction: 'localY', value: 0, valueEnd: -7, a: 0.25, b: 4.75 },
      { ...base, id: 'cmq', type: 'cmq', iQx: 1, iQy: 2, iQz: 3, iMy: 4, iMz: 5, jQx: 6, jQy: 7, jQz: 8, jMy: 9, jMz: 10, moy: 11, moz: 12 },
      { ...base, id: 'temperature', type: 'temperature', direction: 'localX', value: -20.5 },
      { ...base, id: 'weight', type: 'selfWeight', direction: 'globalZ', value: -1.1 },
    ];
    let restored = { ...model, nodalLoads: [], memberLoads: [] } as ProjectModel;
    for (const kind of ['nodalLoads', 'memberLoads'] as const) {
      const tsv = exportModelTable(model, kind);
      expect(tsv).toContain('CaseId\tCaseName');
      restored = importModelTable(restored, kind, tsv).model;
    }
    expect(restored.nodalLoads).toEqual(model.nodalLoads.map((load) => ({ ...load, id: expect.any(String) })));
    expect(restored.memberLoads).toEqual(model.memberLoads.map((load) => ({ ...load, id: expect.any(String) })));
    const native = JSON.stringify({ schemaVersion: 2, savedAt: '2026-10-14T00:00:00.000Z', model: restored });
    const imported = importJsonTextAuto(native);
    expect(imported.model.nodalLoads).toEqual(restored.nodalLoads);
    expect(imported.model.memberLoads).toEqual(restored.memberLoads);
    expect(imported.warnings).toEqual([]);
  });

  it('preserves case ownership through quoted names with tabs, quotes and newlines', () => {
    const model = modelForTables();
    model.loadCases![1]!.name = 'Wind\t"east"\nline 2';
    model.memberLoads = [{ id: 'udl', memberId: 'm', loadCaseId: 'b', type: 'udl', direction: 'localZ', value: -1 }];
    const restored = importModelTable({ ...model, memberLoads: [] }, 'memberLoads', exportModelTable(model, 'memberLoads'));
    expect(restored.imported).toBe(1);
    expect(restored.model.memberLoads[0]!.loadCaseId).toBe('b');
  });

  it('preserves explicitly quoted ID and name whitespace', () => {
    const model = modelForTables();
    model.loadCases![1] = { id: ' b ', name: ' Wind ' };
    model.nodalLoads = [{ id: 'load', loadCaseId: ' b ', nodeId: 'j', fx: 1, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }];
    const tsv = exportModelTable(model, 'nodalLoads');
    expect(tsv).toContain('" b "\t" Wind "');
    const restored = importModelTable({ ...model, nodalLoads: [] }, 'nodalLoads', tsv);
    expect(restored.model.nodalLoads[0]!.loadCaseId).toBe(' b ');
  });

  it('exports implicit legacy loads with their effective first-case ID even when another case is active', () => {
    const model = modelForTables();
    model.activeLoadCaseId = 'b';
    const load: MemberLoad = { id: 'old', memberId: 'm', type: 'udl', direction: 'localZ', value: -1 };
    model.memberLoads = [load];
    const restored = importModelTable({ ...model, memberLoads: [] }, 'memberLoads', exportModelTable(model, 'memberLoads'));
    expect(restored.model.memberLoads[0]!.loadCaseId).toBe('a');
  });
});
