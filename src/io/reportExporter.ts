import type { AnalysisError, AnalysisResult, ProjectModel } from '../core/model/types';
import { getActiveLoadTargetName } from '../core/model/loadCases';

export interface ReportInput {
  model: ProjectModel;
  result: AnalysisResult | null;
  error: AnalysisError | null;
  generatedAt: Date;
}

const DOF_LABELS = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];
const REACTION_LABELS = ['Rx', 'Ry', 'Rz', 'Mx', 'My', 'Mz'];
const END_FORCE_LABELS = ['Ni', 'Vyi', 'Vzi', 'Mxi', 'Myi', 'Mzi', 'Nj', 'Vyj', 'Vzj', 'Mxj', 'Myj', 'Mzj'];

export function generateMarkdownReport(input: ReportInput): string {
  const { model, result, error, generatedAt } = input;
  const lines: string[] = [
    `# ${model.title || 'Frame Analysis Report'}`,
    '',
    `Generated: ${generatedAt.toISOString()}`,
    `Analysis target: ${getActiveLoadTargetName(model)}`,
    '',
    '## Model',
    '',
    `- Nodes: ${model.nodes.length}`,
    `- Members: ${model.members.length}`,
    `- Materials: ${model.materials.length}`,
    `- Sections: ${model.sections.length}`,
    `- Nodal loads: ${model.nodalLoads.length}`,
    `- Member loads: ${model.memberLoads.length}`,
    '',
  ];

  if (error) {
    lines.push('## Analysis Error', '', error.message, '');
    return lines.join('\n');
  }

  if (!result) {
    lines.push('## Results', '', 'No analysis result is available.', '');
    return lines.join('\n');
  }

  lines.push('## Displacements', '', markdownTable(
    ['Node', ...DOF_LABELS],
    model.nodes.map((node, index) => [
      node.id,
      ...DOF_LABELS.map((_, dof) => fmt(result.displacements[index * 6 + dof])),
    ])
  ));

  lines.push('', '## Reactions', '', markdownTable(
    ['Node', ...REACTION_LABELS],
    model.nodes.map((node, index) => [
      node.id,
      ...REACTION_LABELS.map((_, dof) => fmt(result.reactions[index * 6 + dof])),
    ])
  ));

  lines.push('', '## Member End Forces', '', markdownTable(
    ['Member', ...END_FORCE_LABELS],
    model.members.map((member) => [
      member.id,
      ...END_FORCE_LABELS.map((_, index) => fmt(result.elementEndForces[member.id]?.[index])),
    ])
  ));

  if (result.warnings.length > 0) {
    lines.push('', '## Warnings', '', ...result.warnings.map((warning) => `- ${warning}`));
  }

  return `${lines.join('\n')}\n`;
}

export function generateCsvReport(input: ReportInput): string {
  const { model, result, error, generatedAt } = input;
  const rows: string[][] = [
    ['Frame Analysis Report'],
    ['Generated', generatedAt.toISOString()],
    ['Analysis target', getActiveLoadTargetName(model)],
    [],
    ['Model'],
    ['Nodes', String(model.nodes.length)],
    ['Members', String(model.members.length)],
    ['Materials', String(model.materials.length)],
    ['Sections', String(model.sections.length)],
    ['Nodal loads', String(model.nodalLoads.length)],
    ['Member loads', String(model.memberLoads.length)],
    [],
  ];

  if (error) {
    rows.push(['Analysis Error'], [error.message]);
    return rows.map(csvRow).join('\n');
  }

  if (!result) {
    rows.push(['Results'], ['No analysis result is available.']);
    return rows.map(csvRow).join('\n');
  }

  rows.push(['Displacements'], ['Node', ...DOF_LABELS]);
  for (const [index, node] of model.nodes.entries()) {
    rows.push([
      node.id,
      ...DOF_LABELS.map((_, dof) => fmt(result.displacements[index * 6 + dof])),
    ]);
  }

  rows.push([], ['Reactions'], ['Node', ...REACTION_LABELS]);
  for (const [index, node] of model.nodes.entries()) {
    rows.push([
      node.id,
      ...REACTION_LABELS.map((_, dof) => fmt(result.reactions[index * 6 + dof])),
    ]);
  }

  rows.push([], ['Member End Forces'], ['Member', ...END_FORCE_LABELS]);
  for (const member of model.members) {
    rows.push([
      member.id,
      ...END_FORCE_LABELS.map((_, index) => fmt(result.elementEndForces[member.id]?.[index])),
    ]);
  }

  if (result.warnings.length > 0) {
    rows.push([], ['Warnings'], ...result.warnings.map((warning) => [warning]));
  }

  return rows.map(csvRow).join('\n');
}

export function generatePrintableReportHtml(input: ReportInput): string {
  const markdown = generateMarkdownReport(input);
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Frame Analysis Report</title>',
    '<style>',
    'body{font-family:Arial,sans-serif;margin:32px;color:#222;}',
    'pre{white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;}',
    '@media print{body{margin:16mm;}}',
    '</style>',
    '</head>',
    '<body>',
    '<pre>',
    escapeHtml(markdown),
    '</pre>',
    '</body>',
    '</html>',
  ].join('');
}

function markdownTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map(markdownCell).join(' | ')} |`),
  ].join('\n');
}

function markdownCell(value: string): string {
  return value.split('\\').join('\\\\').split('|').join('\\|');
}

function csvRow(row: string[]): string {
  return row.map(csvCell).join(',');
}

function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.split('"').join('""')}"`;
}

function escapeHtml(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;');
}

function fmt(value: number | undefined): string {
  if (value === undefined) return '';
  if (Math.abs(value) < 1e-10) return '0';
  if (Math.abs(value) >= 1e4 || Math.abs(value) < 1e-3) return value.toExponential(6);
  return value.toFixed(6);
}
