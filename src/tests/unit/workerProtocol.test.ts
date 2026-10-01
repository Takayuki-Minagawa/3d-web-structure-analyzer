import { describe, expect, it } from 'vitest';
import sampleText from '../../../public/samples/FrameModel_Sample.json?raw';
import { importJsonTextAuto } from '../../io/jsonImporter';
import { createAnalysisResponse } from '../../worker/analysisRequestHandler';
import type { ProjectModel } from '../../core/model/types';
import {
  modeShapeAsResult,
  toStaticOutcome,
  toStoredBucklingResult,
  toStoredModalResult,
} from '../../state/analysisResults';

function cantilever(): ProjectModel {
  const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
  const free = { ux: false, uy: false, uz: false, rx: false, ry: false, rz: false };
  return {
    title: 'Cantilever',
    analysisMode: 'xz2d',
    nodes: [
      { id: 'n1', x: 0, y: 0, z: 0, restraint: fixed },
      { id: 'n2', x: 3, y: 0, z: 0, restraint: free },
    ],
    materials: [{ id: 'mat', name: 'Steel', E: 2e8, G: 7.7e7, nu: 0.3, expansion: 0, density: 7.85 }],
    sections: [{
      id: 'sec', name: 'Test', materialId: 'mat',
      A: 0.01, Ix: 1e-5, Iy: 8e-6, Iz: 2e-6, ky: 0, kz: 0,
    }],
    springs: [],
    members: [{
      id: 'm1', ni: 'n1', nj: 'n2', sectionId: 'sec', codeAngle: 0,
      iSprings: { x: 0, y: 0, z: 0 },
      jSprings: { x: 0, y: 0, z: 0 },
    }],
    couplings: [],
    nodalLoads: [],
    memberLoads: [],
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
}

describe('analysis worker protocol', () => {
  it('correlates responses and transfers typed-array buffers', () => {
    const model = importJsonTextAuto(sampleText).model;
    const envelope = createAnalysisResponse({
      type: 'analyze-all',
      requestId: 'request-42',
      model,
    });

    expect(envelope.response.type).toBe('analyze-all-success');
    expect(envelope.response.requestId).toBe('request-42');
    if (envelope.response.type !== 'analyze-all-success') return;
    const first = envelope.response.results[0]!;
    expect(first.displacements).toBeInstanceOf(Float64Array);
    expect(first.reactions).toBeInstanceOf(Float64Array);
    expect(envelope.transferables.length).toBeGreaterThanOrEqual(2);
    // A buffer listed twice would make postMessage throw a DataCloneError.
    expect(new Set(envelope.transferables).size).toBe(envelope.transferables.length);
  });

  it('includes the request id in mapped validation errors', () => {
    const model = importJsonTextAuto(sampleText).model;
    model.sections[0] = { ...model.sections[0]!, Iy: 0 };
    const envelope = createAnalysisResponse({
      type: 'analyze-all',
      requestId: 'invalid-request',
      model,
    });

    expect(envelope.response.type).toBe('analyze-error');
    expect(envelope.response.requestId).toBe('invalid-request');
    expect(envelope.transferables).toEqual([]);
  });

  it('preserves AnalysisException singular diagnostics in worker error mapping', () => {
    const fixed = { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true };
    const model: ProjectModel = {
      title: 'Singular released member',
      nodes: [
        { id: 'n1', x: 0, y: 0, z: 0, restraint: fixed },
        {
          id: 'n2', x: 1, y: 0, z: 0,
          restraint: { ...fixed, rx: false, ry: false, rz: false },
        },
      ],
      materials: [{ id: 'mat', name: 'Test', E: 1_000, G: 400, nu: 0.25, expansion: 0 }],
      sections: [{
        id: 'sec', name: 'Test', materialId: 'mat',
        A: 1, Ix: 1, Iy: 1, Iz: 1, ky: 1, kz: 1,
      }],
      springs: [],
      members: [{
        id: 'm1', ni: 'n1', nj: 'n2', sectionId: 'sec', codeAngle: 0,
        iSprings: { x: 2, y: 2, z: 2 },
        jSprings: { x: 2, y: 2, z: 2 },
      }],
      couplings: [],
      nodalLoads: [],
      memberLoads: [],
      units: { force: 'N', length: 'm', moment: 'N m' },
    };

    const envelope = createAnalysisResponse({
      type: 'analyze-all', requestId: 'singular-request', model,
    });
    expect(envelope.response.type).toBe('analyze-error');
    if (envelope.response.type !== 'analyze-error') return;
    expect(envelope.response.error.type).toBe('singular');
    expect(envelope.response.error.diagnostics?.length).toBeGreaterThan(0);
  });

  it('returns all target results and envelopes', () => {
    const model = importJsonTextAuto(sampleText).model;
    const envelope = createAnalysisResponse({
      type: 'analyze-all',
      requestId: 'all-targets',
      model,
    });

    expect(envelope.response.type).toBe('analyze-all-success');
    if (envelope.response.type !== 'analyze-all-success') return;
    expect(envelope.response.requestId).toBe('all-targets');
    expect(envelope.response.results.length).toBeGreaterThan(0);
    expect(envelope.response.results[0]!.displacements).toBeInstanceOf(Float64Array);
    expect(envelope.response.envelope.displacements.min).toBeInstanceOf(Float64Array);
    expect(envelope.response.factorizationCount).toBe(1);
    expect(envelope.transferables.length).toBeGreaterThan(2);
  });

  it('serializes modal results with transferable mode shapes', () => {
    const envelope = createAnalysisResponse({
      type: 'analyze-modal',
      requestId: 'modal-1',
      model: cantilever(),
      options: { modeCount: 3, divisions: 2 },
    });

    expect(envelope.response.type).toBe('modal-success');
    if (envelope.response.type !== 'modal-success') return;
    expect(envelope.response.requestId).toBe('modal-1');
    expect(envelope.response.modes).toHaveLength(3);
    expect(envelope.response.divisions).toBe(2);
    const shape = envelope.response.modes[0]!.shape;
    expect(shape.displacements).toBeInstanceOf(Float64Array);
    expect(shape.displacements).toHaveLength(12);
    expect(shape.diagrams.m1!.points.length).toBeGreaterThan(2);
    expect(envelope.transferables).toHaveLength(3);

    const stored = toStoredModalResult(envelope.response, cantilever());
    expect(Array.isArray(stored.modes[0]!.shape.displacements)).toBe(true);
    const rendered = modeShapeAsResult(stored.modes[0]!.shape);
    expect(rendered.diagrams.m1!.points[0]!.N).toBe(0);
  });

  it('serializes buckling results and routes eigen errors through analyze-error', () => {
    const model = cantilever();
    model.nodalLoads = [{ id: 'p', nodeId: 'n2', fx: -1, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 }];
    const envelope = createAnalysisResponse({
      type: 'analyze-buckling',
      requestId: 'buckling-1',
      model,
      options: { modeCount: 1, divisions: 4 },
    });
    expect(envelope.response.type).toBe('buckling-success');
    if (envelope.response.type !== 'buckling-success') return;
    expect(envelope.response.modes[0]!.loadFactor).toBeGreaterThan(0);
    expect(envelope.response.target.type).toBe('loadCase');
    expect(toStoredBucklingResult(envelope.response, model).sourceModel).toBe(model);

    const unloaded = createAnalysisResponse({
      type: 'analyze-buckling', requestId: 'buckling-2', model: cantilever(),
    });
    expect(unloaded.response.type).toBe('analyze-error');
    if (unloaded.response.type !== 'analyze-error') return;
    expect(unloaded.response.requestId).toBe('buckling-2');
    expect(unloaded.response.error.type).toBe('validation');
  });

  it('converts static worker results to plain arrays for the store', () => {
    const model = importJsonTextAuto(sampleText).model;
    const envelope = createAnalysisResponse({ type: 'analyze-all', requestId: 'plain', model });
    if (envelope.response.type !== 'analyze-all-success') throw new Error('expected success');
    const outcome = toStaticOutcome(envelope.response);
    if (outcome.type !== 'analyze-all-success') throw new Error('expected success');
    const first = outcome.results[0]!;
    expect(Array.isArray(first.displacements)).toBe(true);
    expect(Array.isArray(outcome.envelope.reactions.max)).toBe(true);
    expect(first.displacements).toEqual(Array.from(envelope.response.results[0]!.displacements));
    const memberId = Object.keys(first.elementEndForces)[0]!;
    expect(first.elementEndForces[memberId]).toHaveLength(12);
    expect(outcome.envelope.elementEndForces[memberId]!.min).toHaveLength(12);
  });
});
