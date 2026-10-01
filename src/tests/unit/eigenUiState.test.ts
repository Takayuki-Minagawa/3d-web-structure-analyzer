import { beforeEach, describe, expect, it } from 'vitest';
import { analyzeBuckling, analyzeModal } from '../../core/analysis/eigenAnalysis';
import { analyzeFrame } from '../../core/analysis/analyzeFrame';
import { buildIndexedModel } from '../../core/model/indexing';
import type { AnalysisResult, ProjectModel, Restraint } from '../../core/model/types';
import {
  generateCsvReport,
  generateMarkdownReport,
  generatePrintableReportHtml,
} from '../../io/reportExporter';
import { createDeformationGeometry, updateDeformationGeometry } from '../../rendering/resultGeometry';
import {
  modeShapeAsResult,
  type StoredBucklingResult,
  type StoredModalResult,
} from '../../state/analysisResults';
import { createDefaultModel, useProjectStore } from '../../state/projectStore';
import { isForceDiagramMode, useViewStore } from '../../state/viewStore';
import { exportModelTable, importModelTable } from '../../ui/tables/modelTableClipboard';
import { createAnalysisResponse } from '../../worker/analysisRequestHandler';
import { toStoredBucklingResult, toStoredModalResult } from '../../state/analysisResults';

const FREE: Restraint = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
const FIXED: Restraint = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };

function column(): ProjectModel {
  return {
    title: 'Column',
    analysisMode: 'xz2d',
    nodes: [
      { id: 'base', number: 1, x: 0, y: 0, z: 0, restraint: FIXED },
      { id: 'top', number: 2, x: 0, y: 0, z: 3, restraint: FREE },
    ],
    materials: [{ id: 'mat', name: 'Steel', E: 2e8, G: 7.7e7, nu: 0.3, expansion: 0, density: 7.85 }],
    sections: [{ id: 'sec', name: 'Box', materialId: 'mat', A: 0.01, Ix: 1e-5, Iy: 8e-6, Iz: 8e-6, ky: 0, kz: 0 }],
    springs: [],
    loadCases: [{ id: 'dead', name: 'Dead' }],
    loadCombinations: [],
    activeLoadCaseId: 'dead',
    activeLoadCombinationId: null,
    members: [{
      id: 'col', number: 1, ni: 'base', nj: 'top', sectionId: 'sec', codeAngle: 0,
      iSprings: { x: 0, y: 0, z: 0 }, jSprings: { x: 0, y: 0, z: 0 },
    }],
    couplings: [],
    nodalLoads: [{ id: 'p', loadCaseId: 'dead', nodeId: 'top', fx: 0, fy: 0, fz: -100, mx: 0, my: 0, mz: 0 }],
    memberLoads: [],
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

function storedResults(model: ProjectModel): { modal: StoredModalResult; buckling: StoredBucklingResult } {
  const modal = createAnalysisResponse({ type: 'analyze-modal', requestId: 'm', model, options: { modeCount: 2 } });
  const buckling = createAnalysisResponse({ type: 'analyze-buckling', requestId: 'b', model, options: { modeCount: 2 } });
  if (modal.response.type !== 'modal-success' || buckling.response.type !== 'buckling-success') {
    throw new Error('expected eigen analyses to succeed');
  }
  return {
    modal: toStoredModalResult(modal.response, model),
    buckling: toStoredBucklingResult(buckling.response, model),
  };
}

describe('eigen results in the project store', () => {
  beforeEach(() => {
    useProjectStore.getState().loadModel(createDefaultModel());
    useViewStore.setState({ displayMode: 'model', shapeView: null, resultsTab: 'displacements' });
  });

  it('keeps eigen results bound to the analyzed model and clears them on replacement', () => {
    useProjectStore.getState().loadModel(column());
    const model = useProjectStore.getState().model;
    const { modal, buckling } = storedResults(model);
    useProjectStore.getState().setAnalyzing(true);
    useProjectStore.getState().setModalResult(modal);
    useProjectStore.getState().setBucklingResult(buckling);

    let state = useProjectStore.getState();
    expect(state.isAnalyzing).toBe(false);
    expect(state.modalResult?.sourceModel).toBe(state.model);
    expect(state.bucklingResult?.target.name).toBe('Dead');

    // An edit creates a new model object, which marks the eigen results stale.
    state.updateNode('top', { z: 3.5 });
    state = useProjectStore.getState();
    expect(state.modalResult?.sourceModel).not.toBe(state.model);

    state.loadModel(column());
    state = useProjectStore.getState();
    expect(state.modalResult).toBeNull();
    expect(state.bucklingResult).toBeNull();
    expect(state.eigenError).toBeNull();
  });

  it('stores eigen errors per analysis kind without touching static results', () => {
    useProjectStore.getState().loadModel(column());
    const model = useProjectStore.getState().model;
    const { modal, buckling } = storedResults(model);
    const store = useProjectStore.getState();
    store.setModalResult(modal);
    store.setBucklingResult(buckling);
    store.setEigenError('buckling', { type: 'validation', message: 'no compression' });

    let state = useProjectStore.getState();
    expect(state.eigenError).toEqual({ kind: 'buckling', error: { type: 'validation', message: 'no compression' } });
    expect(state.bucklingResult).toBeNull();
    expect(state.modalResult).not.toBeNull();
    expect(state.analysisError).toBeNull();

    // A successful rerun of the same kind clears its error; other kinds do not.
    state.setModalResult(modal);
    expect(useProjectStore.getState().eigenError?.kind).toBe('buckling');
    state.setBucklingResult(buckling);
    state = useProjectStore.getState();
    expect(state.eigenError).toBeNull();
  });

  it('switches the viewport and results tab when a mode shape is selected', () => {
    useViewStore.getState().showModeShape({ kind: 'buckling', index: 1 });
    const view = useViewStore.getState();
    expect(view.displayMode).toBe('modeShape');
    expect(view.shapeView).toEqual({ kind: 'buckling', index: 1 });
    expect(view.resultsTab).toBe('buckling');
    expect(isForceDiagramMode('modeShape')).toBe(false);
    expect(isForceDiagramMode('deformation')).toBe(false);
    expect(isForceDiagramMode('My')).toBe(true);

    view.setEigenModeCount(99);
    expect(useViewStore.getState().eigenModeCount).toBe(30);
    view.setEigenModeCount(0);
    expect(useViewStore.getState().eigenModeCount).toBe(1);
  });
});

describe('eigen results in reports', () => {
  it('lists modal and buckling tables in every report format', () => {
    const model = column();
    const { modal, buckling } = storedResults(model);
    const input = {
      model,
      result: null,
      modal,
      buckling,
      error: null,
      generatedAt: new Date('2026-01-01T00:00:00Z'),
    };
    const expectedFrequency = analyzeModal(model, { modeCount: 2 }).modes[0]!.frequency;
    const expectedFactor = analyzeBuckling(model, { modeCount: 2 }).modes[0]!.loadFactor;

    const markdown = generateMarkdownReport(input);
    expect(markdown).toContain('## Modal Analysis (4 element(s) per member)');
    expect(markdown).toContain('| Mode | f [Hz] | T [s] |');
    expect(markdown).toContain('## Buckling Analysis — Dead (4 element(s) per member)');
    expect(markdown).toContain('No analysis result is available.');
    expect(expectedFrequency).toBeGreaterThan(0);
    expect(expectedFactor).toBeGreaterThan(1);

    const csv = generateCsvReport(input);
    expect(csv).toContain('Mode,Load factor');
    expect(csv).toContain('Meff X [%]');

    const html = generatePrintableReportHtml(input);
    expect(html).toContain('Modal Analysis');
    expect(html).toContain('<th>Load factor</th>');
  });

  it('describes trapezoidal loads and prescribed displacements in the input tables', () => {
    const model = column();
    model.memberLoads = [{
      id: 't', loadCaseId: 'dead', memberId: 'col', type: 'trapezoid',
      direction: 'localZ', value: 1, valueEnd: 2, a: 0.5, b: 2.5,
    }];
    model.prescribedDisplacements = [{
      id: 'pd', loadCaseId: 'dead', nodeId: 'base', ux: 0, uy: 0, uz: -0.01, rx: 0, ry: 0, rz: 0,
    }];
    model.nodeMasses = [{ id: 'nm', nodeId: 'top', mass: 3 }];
    const markdown = generateMarkdownReport({
      model, result: null, error: null, generatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    expect(markdown).toContain('Trapezoid localZ w1=1.000000 w2=2.000000 from a=0.500000 to b=2.500000');
    expect(markdown).toContain('## Input — Prescribed Displacements');
    expect(markdown).toContain('| N1 | Dead | 0 | 0 | -0.010000 |');
    expect(markdown).toContain('## Input — Nodal Masses');
  });
});

describe('deformed shape geometry', () => {
  function positions(state: NonNullable<ReturnType<typeof createDeformationGeometry>>): number[] {
    return Array.from(state.lines.geometry.getAttribute('position').array);
  }

  it('follows the member deflection samples of a static result', () => {
    const model = column();
    model.nodalLoads = [{ id: 'h', loadCaseId: 'dead', nodeId: 'top', fx: 10, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }];
    const output = analyzeFrame({ model: buildIndexedModel(model) });
    const result: AnalysisResult = {
      displacements: Array.from(output.displacements),
      reactions: Array.from(output.reactions),
      elementEndForces: {},
      diagrams: { col: output.diagrams.get('col')! },
      warnings: [],
    };
    const state = createDeformationGeometry(model, result)!;
    const points = result.diagrams.col!.points;
    // One line segment per interval between consecutive samples.
    expect(state.basePositions).toHaveLength((points.length - 1) * 6);

    updateDeformationGeometry(state, 100);
    const deformed = positions(state);
    const tipX = deformed[deformed.length - 3]!;
    const tipZ = deformed[deformed.length - 1]!;
    expect(tipX).toBeCloseTo(output.displacements[6]! * 100, 4);
    expect(tipZ).toBeCloseTo(3 + output.displacements[8]! * 100, 4);
    // A cantilever curve lies below the straight chord at mid-height.
    const middle = Math.floor(deformed.length / 6 / 2) * 6;
    const chordAtMiddle = tipX * (deformed[middle + 2]! / tipZ);
    expect(deformed[middle]!).toBeLessThan(chordAtMiddle);
    expect(deformed[middle]!).toBeGreaterThan(0);
  });

  it('falls back to straight lines without samples and renders mode shapes', () => {
    const model = column();
    const straight = createDeformationGeometry(model, {
      displacements: [0, 0, 0, 0, 0, 0, 0.5, 0, 0, 0, 0, 0],
      reactions: [], elementEndForces: {}, diagrams: {}, warnings: [],
    })!;
    expect(straight.basePositions).toHaveLength(6);
    updateDeformationGeometry(straight, 2);
    expect(positions(straight)).toEqual([0, 0, 0, 1, 0, 3]);

    const { buckling } = storedResults(model);
    const shape = createDeformationGeometry(model, modeShapeAsResult(buckling.modes[0]!.shape))!;
    updateDeformationGeometry(shape, 1);
    const deformed = positions(shape);
    expect(Math.abs(deformed[deformed.length - 3]!)).toBeCloseTo(1, 6); // unit peak at the free tip
    expect(createDeformationGeometry({ ...model, members: [] }, modeShapeAsResult(buckling.modes[0]!.shape))).toBeNull();
  });
});

describe('trapezoidal loads in the table clipboard', () => {
  it('round-trips through TSV export and import', () => {
    const model = column();
    model.memberLoads = [{
      id: 't', loadCaseId: 'dead', memberId: 'col', type: 'trapezoid',
      direction: 'globalX', value: -1.5, valueEnd: -4, a: 0.25, b: 2.75,
    }];
    const tsv = exportModelTable(model, 'memberLoads');
    expect(tsv.split('\n')[1]).toBe('1\tDead\ttrapezoid\tglobalX\t-1.5\t0.25\t-4\t2.75');

    const imported = importModelTable({ ...model, memberLoads: [] }, 'memberLoads', tsv);
    expect(imported.imported).toBe(1);
    expect(imported.model.memberLoads[0]).toMatchObject({
      memberId: 'col', loadCaseId: 'dead', type: 'trapezoid',
      direction: 'globalX', value: -1.5, valueEnd: -4, a: 0.25, b: 2.75,
    });
    expect(() => importModelTable(model, 'memberLoads', '1\tDead\ttrapezoid\tglobalX\t-1\t0\t\t'))
      .toThrow(/end b|end value/);
  });
});
