import type {
  AnalysisError,
  AnalysisResult,
  AnalysisTarget,
  ProjectModel,
} from '../core/model/types';
import { getActiveLoadTargetName, getLoadCases } from '../core/model/loadCases';
import { memberLabel, nodeLabel } from '../core/model/displayNumbers';
import { formatEngineering } from '../core/formatEngineering';
import { DOF_NAMES } from '../core/model/restraints';
import { getAnalysisMode } from '../core/model/analysisMode';
import { buildPhysicalSupportReactionRows, buildSupportReactionLayout, buildSupportReactionVector, recoverLegacySupportReactionEnvelope } from '../core/supportReactions';
import { CURRENT_PROJECT_SCHEMA_VERSION } from './projectFileParser';
import { SOLVER_VERSION } from '../core/analysis/version';
import { modelFingerprint } from './reportMetadata';
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

const NO_RESULT_MESSAGE = 'No analysis result is available.';
const STALE_RESULT_MESSAGE =
  'Static analysis results are out of date for this model and were omitted. Run the analysis again.';

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
  /** Shown in place of the static result tables when there are none. */
  noResultMessage: string;
  errorMessage: string | null;
  sourceModelJson: string;
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
  const { length, force, moment } = model.units;
  const mode = getAnalysisMode(model);
  const supportLayout = buildSupportReactionLayout(model);
  const loadCaseId = (item: { loadCaseId?: string }) => item.loadCaseId ?? getLoadCases(model)[0]!.id;
  const nodeName = (nodeId: string) => nodeLabel(model.nodes.find((node) => node.id === nodeId));
  const tables: ReportTable[] = [
    inputTable('Analysis Settings', ['Setting', 'Value'], [
      ['Analysis mode', mode],
      ['Active load case ID', model.activeLoadCaseId ?? ''],
      ['Active combination ID', model.activeLoadCombinationId ?? ''],
      ['Coordinates / nodal quantities', 'Global XYZ; rotations in radians'],
      ['Member quantities', 'Local xyz; i to j; code angle in degrees'],
      ['Support reaction convention', 'Physical support nodes; shared rigid reactions occur once at a representative; springs remain at their source nodes'],
      ['Envelope convention', 'Independent component extrema; not a simultaneous equilibrium load state'],
      ['Solver version', SOLVER_VERSION],
      ['Project schema version', String(CURRENT_PROJECT_SCHEMA_VERSION)],
      ['Model hash (non-cryptographic)', modelFingerprint(model)],
    ]),
    inputTable('Units', ['Quantity', 'Unit'], [
      ['Force', force], ['Length / displacement', length], ['Moment', moment],
      ['Rotation', 'rad'], ['Time', 's'], ['Temperature change', 'ΔT (model temperature scale)'],
      ['Stress / E / G', `${force}/${length}²`], ['Area', `${length}²`],
      ['Section inertia', `${length}⁴`], ['Distributed load', `${force}/${length}`],
      ['Translational spring', `${force}/${length}`], ['Rotational spring', `${moment}/rad`],
      ['Mass', `${force}·s²/${length}`], ['Mass density', `${force}·s²/${length}⁴`],
      ['Gravity / acceleration', `${length}/s²`], ['Thermal expansion coefficient', '1/ΔT'],
      ['Dimensionless', 'nu, ky, kz, combination factors, self-weight factors, buckling factors'],
      ['Consistency', 'All inputs use a consistent force-length-second system; unit labels do not convert values'],
    ]),
    inputTable(
      'Nodes',
      ['Node', `X [${length}]`, `Y [${length}]`, `Z [${length}]`, ...DOF_NAMES, 'ID'],
      model.nodes.map((node) => [
        nodeLabel(node), fmt(node.x), fmt(node.y), fmt(node.z),
        ...DOF_NAMES.map((dof) => node.restraint[dof] ? 'fixed' : 'free'),
        node.id,
      ]),
    ),
    inputTable('Effective Nodal Restraints', ['Node', ...DOF_NAMES], model.nodes.map((node, index) => [
      nodeLabel(node), ...DOF_NAMES.map((_, component) => supportLayout.rigidOwners.has(supportLayout.dofMap[index * 6 + component]!) ? 'fixed' : 'free'),
    ])),
    inputTable(
      'Members',
      ['Member', 'i', 'j', 'Section', 'Code angle [deg]', 'i spring x/y/z', 'j spring x/y/z', 'Torsion restraint', 'ID', 'Section ID'],
      model.members.map((member) => [
        memberLabel(member),
        nodeName(member.ni),
        nodeName(member.nj),
        model.sections.find((section) => section.id === member.sectionId)?.name ?? member.sectionId,
        fmt(member.codeAngle),
        [member.iSprings.x, member.iSprings.y, member.iSprings.z].join('/'),
        [member.jSprings.x, member.jSprings.y, member.jSprings.z].join('/'),
        member.torsionRestraint ?? 'none', member.id, member.sectionId,
      ]),
    ),
    inputTable(
      'Materials',
      ['Name', `E [${force}/${length}²]`, `G [${force}/${length}²]`, 'nu [-]', 'alpha [1/ΔT]', `density [${force}·s²/${length}⁴]`, 'ID'],
      model.materials.map((material) => [
        material.name, fmt(material.E), fmt(material.G), fmt(material.nu),
        fmt(material.expansion), fmt(material.density ?? 0), material.id,
      ]),
    ),
    inputTable(
      'Sections',
      ['Name', 'Material', `A [${length}²]`, `Ix [${length}⁴]`, `Iy [${length}⁴]`, `Iz [${length}⁴]`, 'ky [-]', 'kz [-]', 'ID', 'Material ID'],
      model.sections.map((section) => [
        section.name,
        model.materials.find((material) => material.id === section.materialId)?.name ?? section.materialId,
        fmt(section.A), fmt(section.Ix), fmt(section.Iy), fmt(section.Iz), fmt(section.ky), fmt(section.kz),
        section.id, section.materialId,
      ]),
    ),
    inputTable(
      'Loads',
      ['Kind', 'Target', 'Case', 'Components', 'ID', 'Case ID'],
      [
        ...model.nodalLoads.map((load) => [
          'Nodal', nodeName(load.nodeId), loadCaseName(model, load.loadCaseId),
          `Fx=${fmt(load.fx)}, Fy=${fmt(load.fy)}, Fz=${fmt(load.fz)} [${force}], Mx=${fmt(load.mx)}, My=${fmt(load.my)}, Mz=${fmt(load.mz)} [${moment}] (global)`,
          load.id, loadCaseId(load),
        ]),
        ...model.memberLoads.map((load) => [
          'Member', memberLabel(model.members.find((member) => member.id === load.memberId)),
          loadCaseName(model, load.loadCaseId), memberLoadSummary(load, model.units), load.id, loadCaseId(load),
        ]),
      ],
    ),
    inputTable(
      'Nodal Springs',
      ['Node', ...DOF_NAMES.map((dof, index) => `K${dof} [${index < 3 ? `${force}/${length}` : `${moment}/rad`}]`), 'ID'],
      (model.nodeSprings ?? []).map((spring) => [
        nodeName(spring.nodeId), ...DOF_NAMES.map((dof) => fmt(spring[dof])), spring.id,
      ]),
    ),
  ];
  tables.push(
    inputTable('Spring Library', ['ID', 'Number', 'Method (source code)', `Ktheta [${moment}/rad]`, 'Behavior'], model.springs.map((spring) => [
      spring.id, String(spring.number), String(spring.method), fmt(spring.kTheta),
      spring.number <= 1 ? 'rigid' : spring.number === 2 || spring.kTheta === 0 ? 'pin' : 'rotational spring',
    ])),
    inputTable('End Spring Convention', ['Number', 'Behavior'], [['0 / 1', 'rigid'], ['2', 'pin'], ['3 or greater', 'Ktheta from Spring Library; zero means pin']]),
    inputTable('Couplings', ['ID', 'Master', 'Slave', ...DOF_NAMES], model.couplings.map((coupling) => [
      coupling.id, nodeName(coupling.masterNodeId), nodeName(coupling.slaveNodeId),
      ...DOF_NAMES.map((dof) => coupling[dof] ? 'equal' : 'independent'),
    ])),
    inputTable('Load Cases', ['ID', 'Name'], getLoadCases(model).map((loadCase) => [loadCase.id, loadCase.name])),
    inputTable('Load Combinations', ['ID', 'Name', 'Case ID', 'Case name', 'Factor [-]'], (model.loadCombinations ?? []).flatMap((combination) =>
      combination.factors.length ? combination.factors.map((term) => [
        combination.id, combination.name, term.loadCaseId, loadCaseName(model, term.loadCaseId), fmt(term.factor),
      ]) : [[combination.id, combination.name, '', '', '']]
    )),
  );
  if (model.prescribedDisplacements?.length) {
    tables.push(inputTable(
      'Prescribed Displacements',
      ['Node', 'Case', ...DOF_NAMES.map((dof, index) => `${dof} [${index < 3 ? length : 'rad'}]`), 'ID', 'Case ID'],
      model.prescribedDisplacements.map((item) => [
        nodeName(item.nodeId), loadCaseName(model, item.loadCaseId),
        ...DOF_NAMES.map((dof) => fmt(item[dof])),
        item.id, loadCaseId(item),
      ]),
    ));
  }
  if (model.nodeMasses?.length) {
    tables.push(inputTable(
      'Nodal Masses',
      ['Node', `Mass [${force}·s²/${length}]`, 'ID'],
      model.nodeMasses.map((item) => [nodeName(item.nodeId), fmt(item.mass), item.id]),
    ));
  }
  tables.push(inputTable(
    'Gravity',
    ['X', 'Y', 'Z'].map((axis) => `${axis} [${length}/s²]`),
    [[fmt(model.gravity?.x ?? 0), fmt(model.gravity?.y ?? 0), fmt(model.gravity?.z ?? 0)]],
  ));
  return tables;
}

function buildResultTables(model: ProjectModel, resolved: ResolvedReportResult): ReportTable[] {
  const { result, governingTargets } = resolved;
  const { length, force, moment } = model.units;
  const supportRows = buildPhysicalSupportReactionRows(model, result.reactions).rows;
  const nodeIndices = new Map(model.nodes.map((node, index) => [node.id, index]));
  const reactionRows = (governing = false): string[][] => supportRows.map((row) => [
    nodeLabel(model.nodes[nodeIndices.get(row.nodeId)!]),
    ...row.cells.map((cell, component) => cell.value === null
      ? cell.isShared ? 'shared' : ''
      : governing
        ? governingTargets?.reactions[nodeIndices.get(row.nodeId)! * 6 + component] ?? ''
        : `${fmt(cell.value)}${cell.isShared ? '*' : ''}`),
  ]);
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
    resultTable('Displacements', ['Node', ...DOF_NAMES.map((name, index) => `${name} [${index < 3 ? length : 'rad'}]`)], nodeRows((index) => fmt(result.displacements[index]))),
    resultTable('Reactions', ['Node', ...REACTION_LABELS.map((name, index) => `${name} [${index < 3 ? force : moment}]`)], reactionRows()),
    resultTable(
      'Member End Forces',
      ['Member', ...END_FORCE_LABELS.map((name, index) => `${name} [${index % 6 < 3 ? force : moment}]`)],
      memberRows((memberId, index) => fmt(result.elementEndForces[memberId]?.[index])),
    ),
  ];
  if (governingTargets) {
    tables.push(
      governingTable('Displacements', ['Node', ...DOF_NAMES], nodeRows((index) => governingTargets.displacements[index] ?? '')),
      governingTable('Reactions', ['Node', ...REACTION_LABELS], reactionRows(true)),
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
    tables.push(resultTable('Modal Analysis Settings', ['Setting', 'Value'], [
      ['Divisions per member', String(input.modal.divisions)],
      ['Free DOF count', String(input.modal.freeDofCount)],
      ['Returned mode count', String(input.modal.modes.length)],
      [`Total mass XYZ [${input.model.units.force}·s²/${input.model.units.length}]`, input.modal.totalMass.map(fmt).join(', ')],
    ]));
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
    tables.push(resultTable('Buckling Analysis Settings', ['Setting', 'Value'], [
      ['Divisions per member', String(input.buckling.divisions)],
      ['Free DOF count', String(input.buckling.freeDofCount)],
      ['Returned mode count', String(input.buckling.modes.length)],
      ['Reference target ID', input.buckling.target.id],
      ['Reference target type', input.buckling.target.type],
    ]));
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
    warnings: [...new Set([
      ...(resolved?.result.warnings ?? []),
      ...(input.modal?.warnings ?? []),
      ...(input.buckling?.warnings ?? []),
    ])],
    noResultMessage: input.isResultStale ? STALE_RESULT_MESSAGE : NO_RESULT_MESSAGE,
    errorMessage: error?.message ?? null,
    sourceModelJson: JSON.stringify({
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      savedAt: generatedAt.toISOString(),
      model,
    }, null, 2),
  };
}

export function generateMarkdownReport(input: ReportInput): string {
  const doc = buildReportDocument(input);
  const lines: string[] = [
    `# ${markdownCell(doc.title)}`,
    '',
    `Generated: ${doc.generatedAt}`,
    `Analysis target: ${markdownCell(doc.targetLabel)}`,
    `Units: ${markdownCell(doc.unitsLabel)}`,
    '',
    '## Model',
    '',
    ...doc.summary.map(([label, value]) => `- ${label}: ${value}`),
    '',
  ];

  const warningLines = doc.warnings.length > 0
    ? ['## Warnings', '', ...doc.warnings.map((warning) => `- ${markdownCell(warning)}`), '']
    : [];
  for (const table of doc.inputTables) {
    lines.push(`## ${markdownCell(table.title)}`, '', markdownTable(table.headers, table.rows), '');
  }
  if (doc.errorMessage !== null) lines.push('## Analysis Error', '', markdownCell(doc.errorMessage), '');
  else if (!doc.resultTables) lines.push('## Results', '', doc.noResultMessage, '');
  for (const table of [...(doc.resultTables ?? []), ...doc.eigenTables]) {
    lines.push(`## ${markdownCell(table.title)}`, '', markdownTable(table.headers, table.rows), '');
  }
  return [...lines, ...warningLines, '## Original Model JSON (full precision)', '', '```json', doc.sourceModelJson, '```', ''].join('\n');
}

export function generateCsvReport(input: ReportInput): string {
  const doc = buildReportDocument(input);
  const rows: string[][] = [
    ['Frame Analysis Report'],
    ['Generated', doc.generatedAt],
    ['Analysis target', doc.targetLabel],
    ['Units', doc.unitsLabel],
    ['Title', doc.title],
    [],
    ['Model'],
    ...doc.summary,
    [],
  ];
  const pushTable = (table: ReportTable) => {
    rows.push([table.csvTitle], table.headers, ...table.rows, []);
  };

  doc.inputTables.forEach(pushTable);
  if (doc.errorMessage !== null) {
    rows.push(['Analysis Error'], [doc.errorMessage], []);
    doc.eigenTables.forEach(pushTable);
  } else {
    if (!doc.resultTables) rows.push(['Results'], [doc.noResultMessage], []);
    [...(doc.resultTables ?? []), ...doc.eigenTables].forEach(pushTable);
  }
  if (doc.warnings.length > 0) {
    rows.push(['Warnings'], ...doc.warnings.map((warning) => [warning]));
  }
  rows.push([], ['Original Model JSON (full precision)'], [doc.sourceModelJson]);
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
          `<p class="${doc.errorMessage !== null ? 'error' : ''}">${escapeHtml(doc.errorMessage ?? doc.noResultMessage)}</p>`,
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
    `<details><summary>Original Model JSON (full precision)</summary><code style="white-space:pre-wrap;overflow-wrap:anywhere">${escapeHtml(doc.sourceModelJson)}</code></details>`,
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
  const cases = getLoadCases(model);
  return cases.find((loadCase) => loadCase.id === (loadCaseId ?? cases[0]?.id))?.name ?? loadCaseId ?? '';
}

function memberLoadSummary(load: ProjectModel['memberLoads'][number], units: ProjectModel['units']): string {
  const { force, length, moment } = units;
  if (load.type === 'cmq') {
    return `CMQ (local) iQ=(${fmt(load.iQx)},${fmt(load.iQy)},${fmt(load.iQz)}) [${force}] iM=(${fmt(load.iMy)},${fmt(load.iMz)}) [${moment}] jQ=(${fmt(load.jQx)},${fmt(load.jQy)},${fmt(load.jQz)}) [${force}] jM=(${fmt(load.jMy)},${fmt(load.jMz)}) mid=(${fmt(load.moy)},${fmt(load.moz)}) [${moment}]`;
  }
  if (load.type === 'point') {
    return `Point ${load.direction}=${fmt(load.value)} [${force}] at a=${fmt(load.a)} [${length}]`;
  }
  if (load.type === 'trapezoid') {
    return `Trapezoid ${load.direction} w1=${fmt(load.value)} w2=${fmt(load.valueEnd)} [${force}/${length}] from a=${fmt(load.a)} to b=${fmt(load.b)} [${length}]`;
  }
  if (load.type === 'temperature') {
    return `Temperature deltaT=${fmt(load.value)} [ΔT] (localX)`;
  }
  if (load.type === 'selfWeight') {
    return `Self-weight factor=${fmt(load.value)} [-] (global gravity vector; hint ${load.direction})`;
  }
  return `UDL ${load.direction}=${fmt(load.value)} [${force}/${length}]`;
}

function reportTargetLabel(input: ReportInput): string {
  const view = input.resultView;
  if (!view) {
    try {
      return getActiveLoadTargetName(input.model);
    } catch {
      // Invalid target references must still be inspectable in an error report.
      return `Unresolved target: ${input.model.activeLoadCombinationId ?? input.model.activeLoadCaseId ?? ''}`;
    }
  }
  if (view.kind === 'envelope') {
    return view.bound === 'min'
      ? 'Minimum component-wise envelope'
      : 'Maximum component-wise envelope';
  }
  const targetType = view.target.type === 'loadCase' ? 'Load case' : 'Load combination';
  return `${targetType}: ${view.target.name} [${view.target.id}]`;
}

function resolveReportResult(input: ReportInput): ResolvedReportResult | null {
  const view = input.resultView;
  if (view?.kind === 'envelope') {
    const supportEnvelope = view.envelope.supportReactions ?? recoverLegacySupportReactionEnvelope(input.model, view.envelope.reactions);
    const values = view.bound === 'min' ? 'min' : 'max';
    const targetIds = view.bound === 'min' ? 'minTargetIds' : 'maxTargetIds';
    const targetName = (targetId: string | undefined): string => {
      if (!targetId) return '';
      const name = view.targetNames[targetId];
      return name ? `${name} [${targetId}]` : targetId;
    };
    return {
      result: {
        displacements: view.envelope.displacements[values],
        reactions: supportEnvelope[values],
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
        reactions: supportEnvelope[targetIds].map(targetName),
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
  return {
    result: {
      ...input.result,
      reactions: Array.from(buildSupportReactionVector(input.model, input.result.reactions, input.result.displacements)),
    },
    governingTargets: null,
  };
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
  return value.split('\\').join('\\\\').split('|').join('\\|')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\r\n|\r|\n/g, '<br>');
}

function csvRow(row: string[]): string {
  return row.map(csvCell).join(',');
}

function csvCell(value: string): string {
  // Keep genuine numerical output numeric, but prevent spreadsheet formulas in
  // names/IDs/text (including whitespace-prefixed expressions) from executing.
  const numeric = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value);
  const safe = !numeric && (/^\s*[=+@-]/.test(value) || /^[\t\r\n]/.test(value)) ? `'${value}` : value;
  if (!/[",\r\n]/.test(safe)) return safe;
  return `"${safe.split('"').join('""')}"`;
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
