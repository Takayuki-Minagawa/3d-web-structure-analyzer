import { describe, expect, it } from 'vitest';
import type { ProjectModel } from '../../core/model/types';
import {
  generateCsvReport,
  generateMarkdownReport,
  generatePrintableReportHtml,
} from '../../io/reportExporter';

function createModel(): ProjectModel {
  return {
    title: 'Report Test',
    loadCases: [{ id: 'dead', name: 'Dead' }],
    activeLoadCaseId: 'dead',
    activeLoadCombinationId: null,
    nodes: [
      { id: 'n0', x: 0, y: 0, z: 0, restraint: { ux: true, uy: true, uz: true, rx: true, ry: true, rz: true } },
    ],
    materials: [{ id: 'mat1', name: 'Steel', E: 20500, G: 7900, nu: 0.3, expansion: 0 }],
    sections: [{ id: 'sec1', name: 'Default', materialId: 'mat1', A: 1, Ix: 1, Iy: 1, Iz: 1, ky: 0, kz: 0 }],
    springs: [],
    members: [],
    couplings: [],
    nodalLoads: [],
    memberLoads: [],
    units: { force: 'kN', length: 'cm', moment: 'kN·cm' },
  };
}

describe('reportExporter', () => {
  it('generates markdown and csv reports with result tables', () => {
    const input = {
      model: createModel(),
      result: {
        displacements: [0, 1, 2, 3, 4, 5],
        reactions: [6, 7, 8, 9, 10, 11],
        elementEndForces: {},
        diagrams: {},
        warnings: ['Check model'],
      },
      error: null,
      generatedAt: new Date('2026-05-01T00:00:00.000Z'),
    };

    const markdown = generateMarkdownReport(input);
    expect(markdown).toContain('# Report Test');
    expect(markdown).toContain('Analysis target: Dead');
    expect(markdown).toContain('| n0 | 0 | 1.000000 | 2.000000');

    const csv = generateCsvReport(input);
    expect(csv).toContain('Analysis target,Dead');
    expect(csv).toContain('n0,0,1.000000,2.000000');
  });

  it('escapes markdown table delimiters inside cell values', () => {
    const input = {
      model: {
        ...createModel(),
        nodes: [
          { ...createModel().nodes[0]!, id: 'n|0' },
        ],
      },
      result: {
        displacements: [0, 0, 0, 0, 0, 0],
        reactions: [0, 0, 0, 0, 0, 0],
        elementEndForces: {},
        diagrams: {},
        warnings: [],
      },
      error: null,
      generatedAt: new Date('2026-05-01T00:00:00.000Z'),
    };

    expect(generateMarkdownReport(input)).toContain('n\\|0');
  });

  it('generates printable html that escapes report content', () => {
    const html = generatePrintableReportHtml({
      model: { ...createModel(), title: '<unsafe>' },
      result: null,
      error: null,
      generatedAt: new Date('2026-05-01T00:00:00.000Z'),
    });

    expect(html).toContain('&lt;unsafe&gt;');
    expect(html).toContain('<!doctype html>');
  });
});
