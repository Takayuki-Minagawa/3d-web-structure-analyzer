import type {
  AnalysisError,
  AnalysisResult,
  AnalysisTarget,
  ProjectModel,
} from '../core/model/types';
import { getActiveLoadTargetName } from '../core/model/loadCases';
import { memberLabel, nodeLabel } from '../core/model/displayNumbers';
import { formatEngineering } from '../core/formatEngineering';
import { DOF_NAMES } from '../core/model/restraints';
import type {
  SerializedAnalysisEnvelope,
  SerializedBucklingResults,
  SerializedModalResults,
} from '../worker/protocol';

export type ReportResultView =
  | {
      kind: 'target';
      target: AnalysisTarget;
    }
  | {
      kind: 'envelope';
      bound: 'min' | 'max';
      envelope: SerializedAnalysisEnvelope<number[]>;
      /** Maps governing target IDs in the component envelope to display names. */
      targetNames: Record<string, string>;
    };

export interface ReportInput {
  model: ProjectModel;
  result: AnalysisResult | null;
  /** The result view selected in the Results panel. */
  resultView?: ReportResultView;
  error: AnalysisError | null;
  generatedAt: Date;
  /** Eigenvalue results that are current for `model`; omitted when absent or stale. */
  modal?: SerializedModalResults<number[]>;
  buckling?: SerializedBucklingResults<number[]>;
  /** Must be supplied by state-aware callers to prevent exporting stale results. */
  isResultStale?: boolean;
  /** Optional composited 3D viewport screenshot for printable reports. */
  viewportImageDataUrl?: string;
}

export class StaleAnalysisResultError extends Error {
  constructor() {
    super('The analysis result is stale. Run the analysis again before exporting a report.');
    this.name = 'StaleAnalysisResultError';
  }
}

const REACTION_LABELS = ['Rx', 'Ry', 'Rz', 'Mx', 'My', 'Mz'];
const END_FORCE_LABELS = ['Ni', 'Vyi', 'Vzi', 'Mxi', 'Myi', 'Mzi', 'Nj', 'Vyj', 'Vzj', 'Mxj', 'Myj', 'Mzj'];

type EnvelopeGoverningTargets = {
  displacements: string[];
  reactions: string[];
  elementEndForces: Record<string, string[]>;
};

type ResolvedReportResult = {
  result: AnalysisResult;
  governingTargets: EnvelopeGoverningTargets | null;
};

interface ReportTable {
  /** Heading used by the Markdown and HTML renderers. */
  title: string;
  /** ASCII-only heading used by the CSV renderer. */
  csvTitle: string;
  headers: string[];
  rows: string[][];
}

/** Format-independent report content shared by every renderer. */
interface ReportDocument {
  title: string;
  generatedAt: string;
  targetLabel: string;
  unitsLabel: string;
  summary: Array<[label: string, value: string]>;
  inputTables: ReportTable[];
  /** Null when no analysis result is available. */
  resultTables: ReportTable[] | null;
  /** Modal / buckling summaries; independent of the static result. */
  eigenTables: ReportTable[];
  warnings: string[];
  errorMessage: string | null;
}

function inputTable(name: string, headers: string[], rows: string[][]): ReportTable {
  return { title: `Input — ${name}`, csvTitle: `Input ${name}`, headers, rows };
}

function resultTable(title: string, headers: string[], rows: string[][]): ReportTable {
  return { title, csvTitle: title, headers, rows };
}

function governingTable(name: string, headers: string[], rows: string[][]): ReportTable {
  return {
    title: `Envelope Governing Targets — ${name}`,
    csvTitle: `Envelope Governing Targets - ${name}`,
    headers,
    rows,
  };
}

function buildInputTables(model: ProjectModel): ReportTable[] {
  const { length } = model.units;
  const nodeName = (nodeId: string) => nodeLabel(model.nodes.find((node) => node.id === nodeId));
  const tables: ReportTable[] = [
    inputTable(
      'Nodes',
      ['Node', `X [${length}]`, `Y [${length}]`, `Z [${length}]`, ...DOF_NAMES],
      model.nodes.map((node) => [
        nodeLabel(node), fmt(node.x), fmt(node.y), fmt(node.z),
        ...DOF_NAMES.map((dof) => node.restraint[dof] ? 'fixed' : 'free'),
      ]),
    ),
    inputTable(
      'Members',
      ['Member', 'i', 'j', 'Section', 'Code angle [deg]'],
      model.members.map((member) => [
        memberLabel(member),
        nodeName(member.ni),
        nodeName(member.nj),
        model.sections.find((section) => section.id === member.sectionId)?.name ?? member.sectionId,
        fmt(member.codeAngle),
      ]),
    ),
    inputTable(
      'Materials',
      ['Name', 'E', 'G', 'nu', 'alpha', 'density'],
      model.materials.map((material) => [
        material.name, fmt(material.E), fmt(material.G), fmt(material.nu),
        fmt(material.expansion), fmt(material.density),
      ]),
    ),
    inputTable(
      'Sections',
      ['Name', 'Material', 'A', 'Ix', 'Iy', 'Iz', 'ky', 'kz'],
      model.sections.map((section) => [
        section.name,
        model.materials.find((material) => material.id === section.materialId)?.name ?? section.materialId,
        fmt(section.A), fmt(section.Ix), fmt(section.Iy), fmt(section.Iz), fmt(section.ky), fmt(section.kz),
      ]),
    ),
    inputTable(
      'Loads',
      ['Kind', 'Target', 'Case', 'Components'],
      [
        ...model.nodalLoads.map((load) => [
          'Nodal', nodeName(load.nodeId), loadCaseName(model, load.loadCaseId),
          `Fx=${fmt(load.fx)}, Fy=${fmt(load.fy)}, Fz=${fmt(load.fz)}, Mx=${fmt(load.mx)}, My=${fmt(load.my)}, Mz=${fmt(load.mz)}`,
        ]),
        ...model.memberLoads.map((load) => [
          'Member', memberLabel(model.members.find((member) => member.id === load.memberId)),
          loadCaseName(model, load.loadCaseId), memberLoadSummary(load),
        ]),
      ],
    ),
    inputTable(
      'Nodal Springs',
      ['Node', 'Kux', 'Kuy', 'Kuz', 'Krx', 'Kry', 'Krz'],
      (model.nodeSprings ?? []).map((spring) => [
        nodeName(spring.nodeId), ...DOF_NAMES.map((dof) => fmt(spring[dof])),
      ]),
    ),
  ];
  if (model.prescribedDisplacements?.length) {
    tables.push(inputTable(
      'Prescribed Displacements',
      ['Node', 'Case', ...DOF_NAMES],
      model.prescribedDisplacements.map((item) => [
        nodeName(item.nodeId), loadCaseName(model, item.loadCaseId),
        ...DOF_NAMES.map((dof) => fmt(item[dof])),
      ]),
    ));
  }
  if (model.nodeMasses?.length) {
    tables.push(inputTable(
      'Nodal Masses',
      ['Node', 'Mass'],
      model.nodeMasses.map((item) => [nodeName(item.nodeId), fmt(item.mass)]),
    ));
  }
  tables.push(inputTable(
    'Gravity',
    ['X', 'Y', 'Z'],
    [[fmt(model.gravity?.x ?? 0), fmt(model.gravity?.y ?? 0), fmt(model.gravity?.z ?? 0)]],
  ));
  return tables;
}

function buildResultTables(model: ProjectModel, resolved: ResolvedReportResult): ReportTable[] {
  const { result, governingTargets } = resolved;
  const nodeRows = (cell: (index: number) => string): string[][] =>
    model.nodes.map((node, nodeIndex) => [
      nodeLabel(node),
      ...DOF_NAMES.map((_, dof) => cell(nodeIndex * 6 + dof)),
    ]);
  const memberRows = (cell: (memberId: string, index: number) => string): string[][] =>
    model.members.map((member) => [
      memberLabel(member),
      ...END_FORCE_LABELS.map((_, index) => cell(member.id, index)),
    ]);

  const tables = [
    resultTable('Displacements', ['Node', ...DOF_NAMES], nodeRows((index) => fmt(result.displacements[index]))),
    resultTable('Reactions', ['Node', ...REACTION_LABELS], nodeRows((index) => fmt(result.reactions[index]))),
    resultTable(
      'Member End Forces',
      ['Member', ...END_FORCE_LABELS],
      memberRows((memberId, index) => fmt(result.elementEndForces[memberId]?.[index])),
    ),
  ];
  if (governingTargets) {
    tables.push(
      governingTable('Displacements', ['Node', ...DOF_NAMES], nodeRows((index) => governingTargets.displacements[index] ?? '')),
      governingTable('Reactions', ['Node', ...REACTION_LABELS], nodeRows((index) => governingTargets.reactions[index] ?? '')),
      governingTable(
        'Member End Forces',
        ['Member', ...END_FORCE_LABELS],
        memberRows((memberId, index) => governingTargets.elementEndForces[memberId]?.[index] ?? ''),
      ),
    );
  }
  return tables;
}

function buildEigenTables(input: ReportInput): ReportTable[] {
  const tables: ReportTable[] = [];
  const percent = (ratio: number) => (ratio * 100).toFixed(2);
  if (input.modal) {
    tables.push(resultTable(
      `Modal Analysis (${input.modal.divisions} element(s) per member)`,
      [
        'Mode', 'f [Hz]', 'T [s]', 'omega [rad/s]',
        'beta X', 'beta Y', 'beta Z', 'Meff X [%]', 'Meff Y [%]', 'Meff Z [%]',
      ],
      input.modal.modes.map((mode) => [
        String(mode.index), fmt(mode.frequency), fmt(mode.period), fmt(mode.omega),
        ...mode.participation.map(fmt),
        ...mode.effectiveMassRatio.map(percent),
      ]),
    ));
  }
  if (input.buckling) {
    tables.push(resultTable(
      `Buckling Analysis — ${input.buckling.target.name} (${input.buckling.divisions} element(s) per member)`,
      ['Mode', 'Load factor'],
      input.buckling.modes.map((mode) => [String(mode.index), fmt(mode.loadFactor)]),
    ));
  }
  return tables;
}

function buildReportDocument(input: ReportInput): ReportDocument {
  assertReportExportable(input);
  const { model, error, generatedAt } = input;
  const resolved = error ? null : resolveReportResult(input);
  return {
    title: model.title || 'Frame Analysis Report',
    generatedAt: generatedAt.toISOString(),
    targetLabel: reportTargetLabel(input),
    unitsLabel: `${model.units.force}, ${model.units.length}, ${model.units.moment}`,
    summary: [
      ['Nodes', String(model.nodes.length)],
      ['Members', String(model.members.length)],
      ['Materials', String(model.materials.length)],
      ['Sections', String(model.sections.length)],
      ['Nodal loads', String(model.nodalLoads.length)],
      ['Member loads', String(model.memberLoads.length)],
      ['Nodal springs', String(model.nodeSprings?.length ?? 0)],
    ],
    inputTables: buildInputTables(model),
    resultTables: resolved ? buildResultTables(model, resolved) : null,
    eigenTables: buildEigenTables(input),
    warnings: resolved?.result.warnings ?? [],
    errorMessage: error?.message ?? null,
  };
}

const NO_RESULT_MESSAGE = 'No analysis result is available.';

export function generateMarkdownReport(input: ReportInput): string {
  const doc = buildReportDocument(input);
  const lines: string[] = [
    `# ${doc.title}`,
    '',
    `Generated: ${doc.generatedAt}`,
    `Analysis target: ${doc.targetLabel}`,
    '',
    '## Model',
    '',
    ...doc.summary.map(([label, value]) => `- ${label}: ${value}`),
    '',
  ];

  if (doc.errorMessage !== null) {
    lines.push('## Analysis Error', '', doc.errorMessage, '');
    for (const table of doc.eigenTables) {
      lines.push(`## ${table.title}`, '', markdownTable(table.headers, table.rows), '');
    }
    return lines.join('\n');
  }

  for (const table of doc.inputTables) {
    lines.push(`## ${table.title}`, '', markdownTable(table.headers, table.rows), '');
  }
  if (!doc.resultTables) lines.push('## Results', '', NO_RESULT_MESSAGE, '');
  for (const table of [...(doc.resultTables ?? []), ...doc.eigenTables]) {
    lines.push(`## ${table.title}`, '', markdownTable(table.headers, table.rows), '');
  }
  if (doc.warnings.length > 0) {
    lines.push('## Warnings', '', ...doc.warnings.map((warning) => `- ${warning}`), '');
  }
  return lines.join('\n');
}

export function generateCsvReport(input: ReportInput): string {
  const doc = buildReportDocument(input);
  const rows: string[][] = [
    ['Frame Analysis Report'],
    ['Generated', doc.generatedAt],
    ['Analysis target', doc.targetLabel],
    [],
    ['Model'],
    ...doc.summary,
    [],
  ];
  const pushTable = (table: ReportTable) => {
    rows.push([table.csvTitle], table.headers, ...table.rows, []);
  };

  if (doc.errorMessage !== null) {
    rows.push(['Analysis Error'], [doc.errorMessage], []);
    doc.eigenTables.forEach(pushTable);
    return rows.map(csvRow).join('\n');
  }

  doc.inputTables.forEach(pushTable);
  if (!doc.resultTables) rows.push(['Results'], [NO_RESULT_MESSAGE], []);
  [...(doc.resultTables ?? []), ...doc.eigenTables].forEach(pushTable);
  if (doc.warnings.length > 0) {
    rows.push(['Warnings'], ...doc.warnings.map((warning) => [warning]));
  }
  return rows.map(csvRow).join('\n');
}

export function generatePrintableReportHtml(input: ReportInput): string {
  const doc = buildReportDocument(input);
  const { model, viewportImageDataUrl } = input;
  const tableSection = (table: ReportTable) =>
    sectionHtml(table.title, htmlTable(table.headers, table.rows));
  const resultSections = [
    doc.resultTables
      ? doc.resultTables.map(tableSection).join('')
      : sectionHtml(
          doc.errorMessage !== null ? 'Analysis Error' : 'Results',
          `<p class="${doc.errorMessage !== null ? 'error' : ''}">${escapeHtml(doc.errorMessage ?? NO_RESULT_MESSAGE)}</p>`,
        ),
    ...doc.eigenTables.map(tableSection),
    doc.warnings.length
      ? sectionHtml('Warnings', `<ul>${doc.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`)
      : '',
  ].join('');
  return [
    '<!doctype html>',
    '<html>',
    '<head>',
    '<meta charset="utf-8">',
    '<title>Frame Analysis Report</title>',
    '<style>',
    'body{font-family:Arial,sans-serif;margin:28px;color:#222;font-size:12px;line-height:1.45;}',
    'h1{font-size:23px;margin:0 0 4px;}h2{font-size:16px;border-bottom:2px solid #333;padding-bottom:3px;margin-top:22px;}h3{font-size:13px;}',
    '.meta{color:#666;margin-bottom:16px}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:12px 0}.summary div{padding:7px;background:#f3f4f6;border-radius:4px}.viewport{display:block;max-width:100%;max-height:340px;margin:12px auto;border:1px solid #ddd}',
    'table{width:100%;border-collapse:collapse;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10px;margin:7px 0 14px;}th,td{border:1px solid #bbb;padding:3px 5px;text-align:right;}th{background:#eef0f3;}th:first-child,td:first-child{text-align:left}.error{color:#b00020}.report-section{break-inside:avoid-page;}',
    '@page{size:A4 landscape;margin:12mm}@media print{body{margin:0}.report-section{page-break-inside:avoid;}h2{break-after:avoid;}}',
    '</style>',
    '</head>',
    '<body>',
    `<h1>${escapeHtml(doc.title)}</h1>`,
    `<div class="meta">Generated: ${escapeHtml(doc.generatedAt)} · Analysis target: ${escapeHtml(doc.targetLabel)} · Units: ${escapeHtml(doc.unitsLabel)}</div>`,
    `<div class="summary"><div><strong>${model.nodes.length}</strong><br>Nodes</div><div><strong>${model.members.length}</strong><br>Members</div><div><strong>${model.nodalLoads.length + model.memberLoads.length}</strong><br>Loads</div></div>`,
    viewportImageDataUrl ? `<img class="viewport" alt="3D model viewport" src="${escapeHtml(viewportImageDataUrl)}">` : '',
    ...doc.inputTables.map(tableSection),
    resultSections,
    '</body>',
    '</html>',
  ].join('');
}

function sectionHtml(title: string, body: string): string {
  return `<section class="report-section"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function htmlTable(headers: string[], rows: string[][]): string {
  return `<table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

function loadCaseName(model: ProjectModel, loadCaseId: string | undefined): string {
  return model.loadCases?.find((loadCase) => loadCase.id === loadCaseId)?.name ?? loadCaseId ?? '';
}

function memberLoadSummary(load: ProjectModel['memberLoads'][number]): string {
  if (load.type === 'cmq') {
    return `CMQ iQ=(${fmt(load.iQx)},${fmt(load.iQy)},${fmt(load.iQz)}) iM=(${fmt(load.iMy)},${fmt(load.iMz)}) jQ=(${fmt(load.jQx)},${fmt(load.jQy)},${fmt(load.jQz)}) jM=(${fmt(load.jMy)},${fmt(load.jMz)}) mid=(${fmt(load.moy)},${fmt(load.moz)})`;
  }
  if (load.type === 'point') {
    return `Point ${load.direction}=${fmt(load.value)} at a=${fmt(load.a)}`;
  }
  if (load.type === 'trapezoid') {
    return `Trapezoid ${load.direction} w1=${fmt(load.value)} w2=${fmt(load.valueEnd)} from a=${fmt(load.a)} to b=${fmt(load.b)}`;
  }
  if (load.type === 'temperature') {
    return `Temperature deltaT=${fmt(load.value)}`;
  }
  if (load.type === 'selfWeight') {
    return `Self-weight factor=${fmt(load.value)} (${load.direction})`;
  }
  return `UDL ${load.direction}=${fmt(load.value)}`;
}

function reportTargetLabel(input: ReportInput): string {
  const view = input.resultView;
  if (!view) return getActiveLoadTargetName(input.model);
  if (view.kind === 'envelope') {
    return view.bound === 'min'
      ? 'Minimum component-wise envelope'
      : 'Maximum component-wise envelope';
  }
  const targetType = view.target.type === 'loadCase' ? 'Load case' : 'Load combination';
  return `${targetType}: ${view.target.name}`;
}

function resolveReportResult(input: ReportInput): ResolvedReportResult | null {
  const view = input.resultView;
  if (view?.kind === 'envelope') {
    const values = view.bound === 'min' ? 'min' : 'max';
    const targetIds = view.bound === 'min' ? 'minTargetIds' : 'maxTargetIds';
    const targetName = (targetId: string | undefined): string => {
      if (!targetId) return '';
      return view.targetNames[targetId] ?? targetId;
    };
    return {
      result: {
        displacements: view.envelope.displacements[values],
        reactions: view.envelope.reactions[values],
        elementEndForces: Object.fromEntries(
          Object.entries(view.envelope.elementEndForces).map(([memberId, component]) => [
            memberId,
            component[values],
          ]),
        ),
        diagrams: {},
        warnings: [],
      },
      governingTargets: {
        displacements: view.envelope.displacements[targetIds].map(targetName),
        reactions: view.envelope.reactions[targetIds].map(targetName),
        elementEndForces: Object.fromEntries(
          Object.entries(view.envelope.elementEndForces).map(([memberId, component]) => [
            memberId,
            component[targetIds].map(targetName),
          ]),
        ),
      },
    };
  }
  if (!input.result) return null;
  return { result: input.result, governingTargets: null };
}

export function assertReportExportable(input: ReportInput): void {
  if (input.isResultStale && resolveReportResult(input)) throw new StaleAnalysisResultError();
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
  return formatEngineering(value, { significantDigits: 7, fixedDecimals: 6, zeroTolerance: 1e-10 });
}
