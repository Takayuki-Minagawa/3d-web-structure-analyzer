import { describe, expect, it, vi } from 'vitest';
import sampleText from '../../../public/samples/FrameModel_Sample.json?raw';
import { buildIndexedModel } from '../../core/model/indexing';
import { validateModel } from '../../core/model/validation';
import { analyzeFrame } from '../../core/analysis/analyzeFrame';
import { resolveAnalysisLoadModel } from '../../core/model/loadCases';
import { convertFrameJsonWithReport } from '../../io/frameJsonConverter';
import { FrameJsonValidationError, isFrameJsonFormat, parseFrameJson } from '../../io/frameJsonParser';
import { importJsonTextAuto } from '../../io/jsonImporter';
import { createDefaultModel, useProjectStore } from '../../state/projectStore';

function createFrameJson(): Record<string, unknown> {
  const zeroNodeLoad = { p1: 0, p2: 0, p3: 0, m1: 0, m2: 0, m3: 0 };
  return {
    title: 'Test',
    loadCaseCount: 2,
    loadCaseIndex: 0,
    calcCaseMemo: ['CALCULATION-CASE', '1,Dead', '2,Live'],
    nodes: [
      {
        number: 1, x: 0, y: 0, z: 0, temperature: 0, intensityGroup: 0,
        longWeight: 0, forceWeight: 0, addForceWeight: 0, area: 0,
        loads: [zeroNodeLoad, zeroNodeLoad],
      },
      {
        number: 2, x: 100, y: 0, z: 0, temperature: 0, intensityGroup: 0,
        longWeight: 0, forceWeight: 0, addForceWeight: 0, area: 0,
        loads: [zeroNodeLoad, zeroNodeLoad],
      },
    ],
    members: [
      {
        number: 1, iNodeNumber: 1, jNodeNumber: 2,
        ixSpring: 0, iySpring: 0, izSpring: 0,
        jxSpring: 0, jySpring: 0, jzSpring: 0,
        sectionNumber: 1, p1: 0, p2: 0, p3: 0,
        memberLoads: [{
          lengthMethod: 0, type: 9, direction: 1, scale: 1,
          loadCode: 'unsupported', unitLoad: -1, p1: 0, p2: 0, p3: 0,
        }],
        cmqLoads: [],
      },
      {
        number: 2, iNodeNumber: 1, jNodeNumber: 99,
        ixSpring: 0, iySpring: 0, izSpring: 0,
        jxSpring: 0, jySpring: 0, jzSpring: 0,
        sectionNumber: 1, p1: 0, p2: 0, p3: 0,
        memberLoads: [], cmqLoads: [],
      },
    ],
    sections: [{
      number: 1, materialNumber: 1, type: 0, shape: 0,
      p1_A: 10, p2_Ix: 10, p3_Iy: 10, p4_Iz: 10,
      ky: 0, kz: 0, comment: '  ""  ',
    }],
    materials: [{
      number: 1, young: 20500, shear: 7900, expansion: 0,
      poisson: 0.3, unitLoad: 0, name: '  "Steel"  ',
    }],
    boundaries: [{
      nodeNumber: 1, deltaX: 2, deltaY: 1, deltaZ: 0,
      thetaX: 0, thetaY: 0, thetaZ: 0,
    }],
    springs: [],
    walls: [{
      number: 1, leftBottomNode: 1, rightBottomNode: 2,
      leftTopNode: 1, rightTopNode: 2, materialNumber: 1,
      method: 0, p1: 0, p2: 0, p3: 0, p4: 0,
    }],
  };
}

describe('FrameJson import reliability', () => {
  it.each([
    'not-a-number', '', '  ', 'Infinity', 'NaN', '0x10', true, false, null, [], {}, Infinity, NaN,
  ])('rejects an explicit invalid numeric load without changing the source: %j', (invalid) => {
    const raw = createFrameJson();
    const nodes = raw.nodes as Array<Record<string, unknown>>;
    const loads = nodes[0]!.loads as Array<Record<string, unknown>>;
    loads[0]!.p1 = invalid;
    try {
      parseFrameJson(raw);
      throw new Error('expected import rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(FrameJsonValidationError);
      expect(error).toMatchObject({ path: 'nodes[0].loads[0].p1', value: invalid });
    }
    expect(loads[0]!.p1).toBe(invalid);
  });

  it.each([
    ['nodes', 'x', 'nodes[0].x'],
    ['sections', 'p1_A', 'sections[0].p1_A'],
    ['materials', 'young', 'materials[0].young'],
  ])('rejects invalid or missing %s.%s with its source path', (collection, field, path) => {
    const raw = createFrameJson();
    const item = (raw[collection] as Array<Record<string, unknown>>)[0]!;
    item[field] = 'not-a-number';
    expect(() => parseFrameJson(raw)).toThrow(path);
    delete item[field];
    expect(() => parseFrameJson(raw)).toThrow(path);
  });

  it('leaves the current project unchanged when FrameJson import fails', () => {
    useProjectStore.getState().loadModel(createDefaultModel());
    const before = useProjectStore.getState().model;
    const raw = createFrameJson();
    (raw.nodes as Array<Record<string, unknown>>)[0]!.x = 'bad-coordinate';
    expect(() => useProjectStore.getState().importFrameJson(JSON.stringify(raw))).toThrow('nodes[0].x');
    expect(useProjectStore.getState().model).toBe(before);
  });

  it('accepts finite decimal/exponent strings and defaults only omitted optional numeric fields', () => {
    const raw = createFrameJson();
    const node = (raw.nodes as Array<Record<string, unknown>>)[0]!;
    node.number = '1';
    node.x = ' -1.25e2 ';
    delete node.temperature;
    const loads = node.loads as Array<Record<string, unknown>>;
    delete loads[0]!.p2;
    const parsed = parseFrameJson(raw);
    expect(parsed.nodes[0]).toMatchObject({ number: 1, x: -125, temperature: 0 });
    expect(parsed.nodes[0]!.loads[0]!.p2).toBe(0);
    node.number = '1.5';
    expect(() => parseFrameJson(raw)).toThrow('nodes[0].number must be a safe integer');
  });

  it.each([
    { poisson: 0, expectedG: 100 },
    { poisson: -0.2, expectedG: 125 },
    { poisson: undefined, expectedG: 200 / 2.6 },
  ])('preserves Poisson ratio $poisson and records material completion', ({ poisson, expectedG }) => {
    const raw = createFrameJson();
    const material = (raw.materials as Array<Record<string, unknown>>)[0]!;
    Object.assign(material, { young: 200, shear: 0, poisson });
    const result = convertFrameJsonWithReport(parseFrameJson(raw));
    expect(result.model.materials[0]!.nu).toBe(poisson ?? 0.3);
    expect(result.model.materials[0]!.G).toBeCloseTo(expectedG, 12);
    expect(result.warnings.some((warning) => warning.code === 'defaulted-poisson-ratio')).toBe(poisson === undefined);
    expect(result.warnings.some((warning) => warning.code === 'calculated-shear-modulus')).toBe(true);
  });

  it('keeps an explicit shear modulus even when the Poisson ratio is zero', () => {
    const raw = createFrameJson();
    Object.assign((raw.materials as Array<Record<string, unknown>>)[0]!, { young: 200, shear: 80, poisson: 0 });
    const result = convertFrameJsonWithReport(parseFrameJson(raw));
    expect(result.model.materials[0]).toMatchObject({ E: 200, G: 80, nu: 0 });
    expect(result.warnings.some((warning) => warning.code === 'calculated-shear-modulus')).toBe(false);
  });

  it.each(['nodes', 'members', 'materials', 'sections'])('rejects malformed and missing required %s arrays', (field) => {
    const raw = createFrameJson();
    for (const invalid of [null, {}, true, '[]']) {
      raw[field] = invalid;
      expect(() => parseFrameJson(raw)).toThrow(`${field} must be an array`);
    }
    delete raw[field];
    expect(() => parseFrameJson(raw)).toThrow(`${field} must be an array`);
  });

  it('rejects malformed optional arrays and malformed nested load records', () => {
    const raw = createFrameJson();
    raw.boundaries = {};
    expect(() => parseFrameJson(raw)).toThrow('boundaries must be an array');
    delete raw.boundaries;
    const node = (raw.nodes as Array<Record<string, unknown>>)[0]!;
    node.loads = {};
    expect(() => parseFrameJson(raw)).toThrow('nodes[0].loads must be an array');
    node.loads = [null];
    expect(() => parseFrameJson(raw)).toThrow('nodes[0].loads[0] must be an object');
  });

  it('recognizes FrameJson when boundaries are omitted and parses auto-import JSON once', () => {
    const raw = createFrameJson();
    delete raw.boundaries;
    expect(isFrameJsonFormat(raw)).toBe(true);

    const parseSpy = vi.spyOn(JSON, 'parse');
    try {
      const result = importJsonTextAuto(JSON.stringify(raw));
      expect(result.summary.format).toBe('frame-json');
      expect(parseSpy).toHaveBeenCalledTimes(1);
    } finally {
      parseSpy.mockRestore();
    }
  });

  it('returns structured warnings without treating unsupported boundary codes as fixed', () => {
    const result = convertFrameJsonWithReport(parseFrameJson(createFrameJson()));
    const warningCodes = result.warnings.map((warning) => warning.code);

    expect(warningCodes).toEqual(expect.arrayContaining([
      'normalized-name',
      'unsupported-boundary-code',
      'missing-member-node',
      'unsupported-member-load-type',
      'walls-ignored',
    ]));
    expect(result.model.nodes[0]!.restraint.ux).toBe(false);
    expect(result.model.nodes[0]!.restraint.uy).toBe(true);
    expect(result.model.nodes[0]!.number).toBe(1);
    expect(result.model.members[0]!.number).toBe(1);
    expect(result.model.materials[0]!.name).toBe('Steel');
    expect(result.model.sections[0]!.name).toBe('Section 1');
    expect(result.summary.skippedMembers).toBe(1);
    expect(result.summary.ignoredWalls).toBe(1);
    expect(result.loadCases).toEqual([
      { index: 0, name: 'Dead', selected: true },
      { index: 1, name: 'Live', selected: false },
    ]);
    expect(result.model.loadCases).toEqual([{ id: 'lc-frame-1', name: 'Dead' }]);
    expect(result.model.activeLoadCaseId).toBe('lc-frame-1');
  });

  it('keeps direct and parameterized member-load values distinct', () => {
    const raw = createFrameJson();
    const members = raw.members as Array<Record<string, unknown>>;
    const sourceMember = members[0]!;
    sourceMember.memberLoads = [
      {
        lengthMethod: 0, type: 0, direction: 2, scale: 0,
        loadCode: '', unitLoad: 0, p1: -4, p2: 0, p3: 0,
      },
      {
        lengthMethod: 0, type: 0, direction: 2, scale: 3,
        loadCode: 'W', unitLoad: -2, p1: -99, p2: 0, p3: 0,
      },
    ];
    raw.loadCaseCount = 2;

    const direct = convertFrameJsonWithReport(parseFrameJson(raw), 0);
    const parameterized = convertFrameJsonWithReport(parseFrameJson(raw), 1);

    expect(direct.model.memberLoads).toEqual([
      expect.objectContaining({ type: 'udl', direction: 'localZ', value: -4 }),
    ]);
    expect(parameterized.model.memberLoads).toEqual([
      expect.objectContaining({ type: 'udl', direction: 'localZ', value: -6 }),
    ]);
    expect(parameterized.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'conflicting-member-load-value', itemIds: ['1@2'] }),
    ]));
  });

  it.each([
    { name: 'unit load with a zero scale', loadCode: 'W', unitLoad: -2, scale: 0 },
    { name: 'load code without numeric factors', loadCode: 'W', unitLoad: 0, scale: 0 },
  ])('does not revive stale p1 for $name', ({ loadCode, unitLoad, scale }) => {
    const raw = createFrameJson();
    const members = raw.members as Array<Record<string, unknown>>;
    members[0]!.memberLoads = [{
      lengthMethod: 0, type: 0, direction: 2, scale,
      loadCode, unitLoad, p1: -99, p2: 0, p3: 0,
    }];

    const result = convertFrameJsonWithReport(parseFrameJson(raw));

    expect(result.model.memberLoads).toEqual([]);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: 'ambiguous-member-load-value',
        count: 1,
        itemIds: ['1@1'],
      }),
    ]));
  });

  it('ships a sample that validates and completes an analysis', () => {
    const imported = importJsonTextAuto(sampleText);
    const analysisModel = resolveAnalysisLoadModel(imported.model);
    expect(validateModel(analysisModel)).toEqual([]);

    const result = analyzeFrame({ model: buildIndexedModel(analysisModel) });
    expect(result.displacements.length).toBe(imported.model.nodes.length * 6);
    expect(Array.from(result.displacements).every(Number.isFinite)).toBe(true);
  });
});
