import { describe, expect, it } from 'vitest';
import type { ProjectModel } from '../../core/model/types';
import { analyzeAllLoadTargets } from '../../core/analysis/analyzeLoadTargets';
import { buildPhysicalSupportReactionRows, buildSupportReactionVector } from '../../core/supportReactions';
import { buildEffectiveReactionRows } from '../../ui/tables/reactionRows';
import { generateCsvReport, generateMarkdownReport, generatePrintableReportHtml, type ReportInput } from '../../io/reportExporter';
import { modelFingerprint } from '../../io/reportMetadata';
import { createAnalysisResponse } from '../../worker/analysisRequestHandler';
import { toStaticOutcome, targetResultToAnalysisResult } from '../../state/analysisResults';

const FIXED = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
const ZERO = { ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 };
const WHEN = new Date('2026-10-14T00:00:00.000Z');
function axialModel(): ProjectModel {
  return {
    title: 'Support audit', analysisMode: '3d',
    nodes: [
      { id: 'fixed', x: 0, y: 0, z: 0, restraint: { ...FIXED } },
      { id: 'master', x: 4, y: 0, z: 0, restraint: { ...FIXED, ux: false } },
    ],
    materials: [{ id: 'mat', name: 'Steel', E: 2e8, G: 8e7, nu: 0.25, expansion: 1e-5, density: 7.85 }],
    sections: [{ id: 'sec', name: 'Section', materialId: 'mat', A: 0.01, Ix: 1e-5, Iy: 1e-5, Iz: 1e-5, ky: 0, kz: 0 }],
    springs: [],
    members: [{ id: 'bar', ni: 'fixed', nj: 'master', sectionId: 'sec', codeAngle: 0, iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 } }],
    couplings: [], nodeSprings: [],
    loadCases: [{ id: 'positive', name: 'Same name' }, { id: 'negative', name: 'Same name' }],
    loadCombinations: [], activeLoadCaseId: 'positive', activeLoadCombinationId: null,
    nodalLoads: [
      { id: 'plus', nodeId: 'master', loadCaseId: 'positive', fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
      { id: 'minus', nodeId: 'master', loadCaseId: 'negative', fx: -4, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 },
    ],
    memberLoads: [], units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}
function coupledModel(): ProjectModel {
  const model = axialModel();
  model.nodes.push({ id: 'support', x: 5, y: 0, z: 0, restraint: { ...FIXED } });
  model.couplings.push({ id: 'tie', masterNodeId: 'master', slaveNodeId: 'support', ux: true, uy: false, uz: false, rx: false, ry: false, rz: false });
  return model;
}
function solvedReport(model: ProjectModel): ReportInput {
  const response = createAnalysisResponse({ type: 'analyze-all', requestId: 'test', model }).response;
  if (response.type !== 'analyze-all-success') throw new Error(JSON.stringify(response));
  const outcome = toStaticOutcome(response);
  if (outcome.type !== 'analyze-all-success') throw new Error('Unexpected outcome');
  return { model, result: targetResultToAnalysisResult(outcome.results[0]!), error: null, generatedAt: WHEN };
}
const renderers = [generateMarkdownReport, generateCsvReport, generatePrintableReportHtml];

describe('physical support reaction regressions', () => {
  it('displays both equal spring/bar reactions and satisfies global force equilibrium', () => {
    const model = axialModel();
    model.nodeSprings = [{ id: 'spring', nodeId: 'master', ...ZERO, ux: 500000 }];
    const output = analyzeAllLoadTargets(model);
    const first = output.results[0]!;
    const { rows } = buildEffectiveReactionRows(model, first.reactions, first.displacements);
    expect(rows[0]!.cells[0]!.value).toBeCloseTo(-5, 10);
    expect(rows[1]!.cells[0]!.value).toBeCloseTo(-5, 10);
    expect(rows.reduce((sum, row) => sum + (row.cells[0]!.value ?? 0), 0)).toBeCloseTo(-10, 10);
    const report = solvedReport(model);
    expect(generateMarkdownReport(report)).toContain('| master | -5.000000');
    expect(generateCsvReport(report)).toContain('master,-5.000000');
    expect(generatePrintableReportHtml(report)).toContain('<td>master</td><td>-5.000000</td>');
  });

  it('relocates rigid reactions to the support in regular results and envelopes, preserving target IDs through the worker', () => {
    const model = coupledModel();
    const { response, transferables } = createAnalysisResponse({ type: 'analyze-all', requestId: 'coupled', model });
    expect(response.type).toBe('analyze-all-success');
    if (response.type !== 'analyze-all-success') return;
    expect(response.results[0]!.reactions[6]).toBeCloseTo(-10);
    expect(response.results[0]!.supportReactions?.[6]).toBeCloseTo(0);
    expect(response.results[0]!.supportReactions?.[12]).toBeCloseTo(-10);
    expect(transferables).toContain(response.results[0]!.supportReactions!.buffer);
    expect(new Set(transferables).size).toBe(transferables.length);
    const outcome = toStaticOutcome(response);
    if (outcome.type !== 'analyze-all-success') return;
    expect(outcome.envelope.supportReactions?.min[12]).toBeCloseTo(-10);
    expect(outcome.envelope.supportReactions?.max[12]).toBeCloseTo(4);
    expect(outcome.envelope.supportReactions?.minTargetIds[12]).toBe('positive');
    expect(outcome.envelope.supportReactions?.maxTargetIds[12]).toBe('negative');
    expect(outcome.envelope.supportReactions?.max[6]).toBeCloseTo(0);
    const input = solvedReport(model);
    const markdown = generateMarkdownReport(input).split('## Reactions\n')[1]!.split('\n## ')[0]!;
    expect(markdown).toContain('| support | -10.000000');
    expect(markdown).not.toContain('| master | -10.000000');
    for (const bound of ['min', 'max'] as const) {
      input.resultView = { kind: 'envelope', bound, envelope: outcome.envelope, targetNames: { positive: 'Same name', negative: 'Same name' } };
      const expected = bound === 'min' ? '-10.000000' : '4.000000';
      const id = bound === 'min' ? 'positive' : 'negative';
      expect(generateMarkdownReport(input)).toContain(`| support | ${expected}`);
      expect(generateCsvReport(input)).toContain(`support,${expected}`);
      expect(generatePrintableReportHtml(input)).toContain(`<td>support</td><td>${expected}</td>`);
      for (const render of renderers) expect(render(input)).toContain(`Same name [${id}]`);
    }
  });

  it('separates master and slave springs from the rigid reaction under enforced motion before enveloping', () => {
    const model = coupledModel();
    model.nodeSprings = [
      { id: 'master-spring', nodeId: 'master', ...ZERO, ux: 100 },
      { id: 'support-spring', nodeId: 'support', ...ZERO, ux: 50 },
    ];
    model.prescribedDisplacements = [{ id: 'move', nodeId: 'support', loadCaseId: 'positive', ...ZERO, ux: 0.001 }];
    const output = analyzeAllLoadTargets(model);
    const first = output.results[0]!;
    const values = buildSupportReactionVector(model, first.reactions, first.displacements);
    expect(values[0]).toBeCloseTo(-500, 9);
    expect(values[6]).toBeCloseTo(-0.1, 9);
    expect(values[12]).toBeCloseTo(490.1, 9);
    expect(values[0]! + values[6]! + values[12]!).toBeCloseTo(-10, 9);
    expect(output.envelope.supportReactions?.max[12]).toBeCloseTo(490.1, 9);
    expect(output.envelope.supportReactions?.maxTargetIds[12]).toBe('positive');
    const report = solvedReport(model);
    expect(generateMarkdownReport(report)).toContain('| master | -0.100000');
    expect(generateMarkdownReport(report)).toContain('| support | 490.100000');
  });

  it('keeps shared rigid reactions once while retaining springs at each physical support', () => {
    const model = coupledModel();
    model.nodes.push({ id: 'support-2', x: 6, y: 0, z: 0, restraint: { ...FIXED } });
    model.couplings.push({ ...model.couplings[0]!, id: 'tie-2', slaveNodeId: 'support-2' });
    model.nodeSprings = [{ id: 'spring-2', nodeId: 'support-2', ...ZERO, ux: 30 }];
    model.prescribedDisplacements = [{ id: 'move', nodeId: 'support', loadCaseId: 'positive', ...ZERO, ux: 0.001 }];
    const first = analyzeAllLoadTargets(model).results[0]!;
    const { rows, hasSharedReactions } = buildPhysicalSupportReactionRows(model, first.supportReactions!);
    expect(hasSharedReactions).toBe(true);
    expect(rows.find((row) => row.nodeId === 'support')!.cells[0]).toMatchObject({ value: expect.closeTo(490.03, 8), isRepresentative: true, isShared: true });
    expect(rows.find((row) => row.nodeId === 'support-2')!.cells[0]).toMatchObject({ value: expect.closeTo(-0.03, 8), isRepresentative: false, isShared: true });
    expect(rows.reduce((sum, row) => sum + (row.cells[0]!.value ?? 0), 0)).toBeCloseTo(-10, 9);
  });
});

describe('reproducible and safe reports', () => {
  it.each([
    ['mode', (model: ProjectModel) => { model.analysisMode = 'xz2d'; }],
    ['end spring', (model: ProjectModel) => { model.members[0]!.iSprings.y = 2; }],
    ['torsion', (model: ProjectModel) => { model.members[0]!.torsionRestraint = 'i'; }],
    ['spring library', (model: ProjectModel) => { model.springs.push({ id: 'custom', number: 3, method: 9, kTheta: 123 }); }],
    ['coupling DOF', (model: ProjectModel) => { model.couplings[0]!.uy = true; }],
    ['inactive combination', (model: ProjectModel) => { model.loadCombinations = [{ id: 'combo', name: 'Combination', factors: [{ loadCaseId: 'positive', factor: -1.5 }] }]; }],
  ])('makes the %s condition independently visible in every format', (_, mutate) => {
    const model = coupledModel();
    const changed = structuredClone(model);
    (mutate as (model: ProjectModel) => void)(changed);
    const input: ReportInput = { model, result: null, error: null, generatedAt: WHEN };
    for (const render of renderers) {
      // Exclude fingerprint and full JSON: human-readable condition tables must
      // themselves differ, rather than relying on a changed opaque identifier.
      const plain = (text: string) => text.split('Original Model JSON')[0]!.replace(/fnv1a64:[a-f0-9]+/g, 'HASH');
      expect(plain(render({ ...input, model: changed }))).not.toBe(plain(render(input)));
    }
  });

  it('includes all dimensions, solver/schema metadata, and full-precision original model JSON', () => {
    const model = coupledModel();
    model.nodes[1]!.x = 4.123456789012345;
    const input: ReportInput = { model, result: null, error: null, generatedAt: WHEN };
    for (const render of renderers) {
      const text = render(input);
      for (const unit of ['kN/m²', 'm⁴', 'kN/m', 'kN·m/rad', 'kN·s²/m⁴', 'm/s²', 'rad', '1/ΔT']) expect(text).toContain(unit);
      expect(text).toContain('linear-frame-2026.10.14');
      expect(text).toContain('Project schema version');
      expect(text).toContain(modelFingerprint(model));
      expect(text).toContain('4.123456789012345');
    }
    const json = generateMarkdownReport(input).split('```json\n')[1]!.split('\n```')[0]!;
    expect(JSON.parse(json).model).toEqual(model);
    const reversed = Object.fromEntries(Object.entries(model).reverse()) as unknown as ProjectModel;
    expect(modelFingerprint(reversed)).toBe(modelFingerprint(model));
    reversed.nodes = structuredClone(model.nodes);
    reversed.nodes[0]!.x = 1e-12;
    expect(modelFingerprint(reversed)).not.toBe(modelFingerprint(model));
  });

  it('keeps input metadata and the source model when analysis fails', () => {
    const input: ReportInput = { model: axialModel(), result: null, error: { type: 'validation', message: 'Invalid model' }, generatedAt: WHEN };
    for (const render of renderers) {
      expect(render(input)).toContain('Analysis Settings');
      expect(render(input)).toContain('Original Model JSON');
      expect(render(input)).toContain('Invalid model');
    }
  });

  it('escapes CRLF names in Markdown, HTML content, and spreadsheet formulas in CSV while keeping numerical negatives', () => {
    const model = axialModel();
    model.materials[0]!.name = 'first\r\nsecond\rthird\nfourth|<b>';
    model.sections[0]!.name = '=1+1';
    model.loadCases![0]!.name = '  +SUM(1,2)';
    const report = solvedReport(model);
    const markdown = generateMarkdownReport(report);
    expect(markdown).toContain('first<br>second<br>third<br>fourth\\|&lt;b&gt;');
    expect(markdown.split('## Original Model JSON')[0]).not.toContain('first\r');
    const csv = generateCsvReport(report);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'  +SUM(1,2)");
    expect(csv).toContain('fixed,-10.000000');
    expect(csv).not.toContain("fixed,'-10.000000");
    const html = generatePrintableReportHtml(report);
    expect(html).toContain('fourth|&lt;b&gt;');
    expect(html).not.toContain('fourth|<b>');
  });
});
