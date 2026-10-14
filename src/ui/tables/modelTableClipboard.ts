import type {
  Member,
  MemberLoad,
  MemberLoadDirection,
  NodalLoad,
  ProjectModel,
  Restraint,
  StructuralNode,
} from '../../core/model/types';
import { ensureDisplayNumbers, nextDisplayNumber } from '../../core/model/displayNumbers';
import { getActiveLoadCaseId, getLoadCaseIdForLoad, getLoadCases } from '../../core/model/loadCases';
import {
  FIXED_RESTRAINT,
  FREE_RESTRAINT,
  PINNED_RESTRAINT,
  ROLLER_Z_RESTRAINT,
  dofValues,
  restraintPresetName,
} from '../../core/model/restraints';

export type ModelTableKind = 'nodes' | 'members' | 'nodalLoads' | 'memberLoads';

export interface TableImportResult {
  model: ProjectModel;
  imported: number;
  warnings: string[];
}

export class TableImportValidationError extends Error {
  constructor(
    public readonly row: number,
    public readonly field: string,
    public readonly value: string | undefined,
    expectation: string,
    public readonly candidates: string[] = [],
  ) {
    super(`Row ${row}: ${field} ${expectation}; received ${JSON.stringify(value) ?? 'missing'}.${
      candidates.length ? ` Available: ${candidates.join(', ')}.` : ''}`);
    this.name = 'TableImportValidationError';
  }
}

function id(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

function number(value: string | undefined, label: string, row: number): number {
  const parsed = value !== undefined && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
    ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) throw new TableImportValidationError(row, label, value, 'must be a finite decimal number');
  return parsed;
}

/** Distinguish missing cells from malformed numeric values in diagnostics. */
function requiredNumber(value: string | undefined, label: string, row: number): number {
  if (value === undefined || value.trim() === '') throw new TableImportValidationError(row, label, value, 'is required');
  return number(value, label, row);
}

function positiveInteger(value: string, label: string, row: number): number {
  const parsed = number(value.replace(/^[NM]/i, ''), label, row);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TableImportValidationError(row, label, value, 'must be a positive safe integer');
  }
  return parsed;
}

function parseRestraint(value: string): Restraint {
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized === 'free' || normalized === '自由') return { ...FREE_RESTRAINT };
  if (normalized === 'fixed' || normalized === '固定') return { ...FIXED_RESTRAINT };
  if (normalized === 'pin' || normalized === 'pinned' || normalized === 'ピン') return { ...PINNED_RESTRAINT };
  if (normalized === 'roller' || normalized === 'roller-z' || normalized === 'ローラー') return { ...ROLLER_Z_RESTRAINT };
  const bits = normalized.split(/[ ,/]+/).filter(Boolean);
  if (bits.length === 6 && bits.every((bit) => bit === '0' || bit === '1')) {
    return {
      ux: bits[0] === '1', uy: bits[1] === '1', uz: bits[2] === '1',
      rx: bits[3] === '1', ry: bits[4] === '1', rz: bits[5] === '1',
    };
  }
  throw new Error(`Unknown support preset: ${value}`);
}

export function restraintPreset(restraint: Restraint): string {
  return restraintPresetName(restraint)
    ?? dofValues(restraint).map((value) => value ? '1' : '0').join(' ');
}

interface InputRow { cells: string[]; row: number; referenceId?: string }

/** Quoted TSV cells preserve tabs/newlines in display names. */
function rows(text: string, kind: ModelTableKind): InputRow[] {
  const parsed: InputRow[] = [];
  let cells: string[] = [];
  let cell = '';
  let quoted = false;
  let wasQuoted = false;
  let closedQuote = false;
  let line = 1;
  let startLine = 1;
  const finishCell = () => {
    cells.push(wasQuoted ? cell : cell.trim());
    cell = '';
    wasQuoted = false;
    closedQuote = false;
  };
  const finishRow = () => {
    finishCell();
    if (cells.some(Boolean)) parsed.push({ cells, row: startLine });
    cells = [];
    startLine = line + 1;
  };
  const source = text.replace(/\r\n?/g, '\n');
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (closedQuote && char !== '\t' && char !== '\n') {
      if (char === ' ') continue;
      throw new TableImportValidationError(startLine, 'TSV', cell + char, 'has characters after a closing quote');
    }
    if (char === '"') {
      if (quoted && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (quoted) { quoted = false; closedQuote = true; }
      else if (cell === '') { quoted = true; wasQuoted = true; }
      else cell += char;
    } else if (char === '\t' && !quoted) finishCell();
    else if (char === '\n') {
      if (quoted) cell += char;
      else finishRow();
      line += 1;
    } else cell += char;
  }
  if (quoted) throw new TableImportValidationError(startLine, 'TSV', cell, 'contains an unclosed quoted cell');
  finishRow();
  if (parsed.length > 0 && /^(no|number|節点|部材|target)$/i.test(parsed[0]!.cells[0] ?? '')) {
    const header = parsed.shift()!.cells;
    const idColumn = header.findIndex((name) => name.toLowerCase() === (kind === 'members' ? 'sectionid' : 'caseid'));
    if (idColumn >= 0 && kind !== 'nodes') {
      return parsed.map((entry) => ({
        ...entry,
        referenceId: entry.cells[idColumn] ?? '',
        cells: entry.cells.filter((_, index) => index !== idColumn),
      }));
    }
  }
  return parsed;
}

function resolveReference<T extends { id: string; name: string }>(
  items: T[], value: string, referenceId: string | undefined, fallbackId: string | undefined,
  label: string, row: number,
): T {
  const candidates = items.map((item) => `${item.id} (${item.name})`);
  const token = referenceId || value;
  if (!token) {
    const fallback = items.find((item) => item.id === fallbackId);
    if (fallback) return fallback;
  }
  if (referenceId !== undefined && referenceId !== '') {
    const exact = items.filter((item) => item.id === referenceId);
    if (exact.length === 1) return exact[0]!;
  } else {
    // Legacy single-column inputs may use either an ID or an unambiguous name.
    const exact = referenceId === undefined ? items.filter((item) => item.id === token) : [];
    if (exact.length === 1) return exact[0]!;
    const named = items.filter((item) => item.name === token);
    if (named.length === 1) return named[0]!;
    if (named.length > 1) {
      throw new TableImportValidationError(row, label, token, 'is ambiguous; supply its ID', candidates);
    }
  }
  throw new TableImportValidationError(row, label, token, 'was not found; supply an existing ID or unique name', candidates);
}

function resolveLoadCase(model: ProjectModel, value: string, referenceId: string | undefined, row: number): string {
  return resolveReference(getLoadCases(model), value, referenceId, getActiveLoadCaseId(model), 'load case', row).id;
}

export function importModelTable(
  rawModel: ProjectModel,
  kind: ModelTableKind,
  text: string,
): TableImportResult {
  const model = ensureDisplayNumbers(rawModel);
  const inputRows = rows(text, kind);
  const warnings: string[] = [];

  if (kind === 'nodes') {
    const byNumber = new Map(model.nodes.map((node) => [node.number!, node]));
    for (const { cells, row } of inputRows) {
      const no = cells[0] ? positiveInteger(cells[0], 'No', row) : nextDisplayNumber([...byNumber.values()]);
      const existing = byNumber.get(no);
      const node: StructuralNode = {
        id: existing?.id ?? id('node'),
        number: no,
        x: requiredNumber(cells[1], 'X', row),
        y: requiredNumber(cells[2], 'Y', row),
        z: requiredNumber(cells[3], 'Z', row),
        restraint: cells[4] ? parseRestraint(cells[4]) : existing?.restraint ?? { ...FREE_RESTRAINT },
      };
      byNumber.set(no, node);
    }
    return {
      model: { ...model, nodes: [...byNumber.values()].sort((a, b) => a.number! - b.number!) },
      imported: inputRows.length,
      warnings,
    };
  }

  const nodeByNumber = new Map(model.nodes.map((node) => [node.number!, node]));

  if (kind === 'members') {
    const byNumber = new Map(model.members.map((member) => [member.number!, member]));
    for (const { cells, row, referenceId } of inputRows) {
      const no = cells[0] ? positiveInteger(cells[0], 'No', row) : nextDisplayNumber([...byNumber.values()]);
      const ni = nodeByNumber.get(positiveInteger(cells[1] ?? '', 'i-node', row));
      const nj = nodeByNumber.get(positiveInteger(cells[2] ?? '', 'j-node', row));
      if (!ni || !nj) throw new Error(`Row ${row}: referenced node number does not exist.`);
      if (ni.id === nj.id) throw new Error(`Row ${row}: i-node and j-node must differ.`);
      const existing = byNumber.get(no);
      const sectionToken = cells[3] ?? '';
      const section = resolveReference(model.sections, sectionToken, referenceId,
        existing?.sectionId ?? model.sections[0]?.id, 'section', row);
      const member: Member = {
        id: existing?.id ?? id('member'),
        number: no,
        ni: ni.id,
        nj: nj.id,
        sectionId: section.id,
        codeAngle: cells[4] ? number(cells[4], 'code angle', row) : existing?.codeAngle ?? 0,
        iSprings: existing?.iSprings ?? { x: 0, y: 0, z: 0 },
        jSprings: existing?.jSprings ?? { x: 0, y: 0, z: 0 },
        torsionRestraint: existing?.torsionRestraint ?? 'none',
      };
      byNumber.set(no, member);
    }
    return {
      model: { ...model, members: [...byNumber.values()].sort((a, b) => a.number! - b.number!) },
      imported: inputRows.length,
      warnings,
    };
  }

  if (kind === 'nodalLoads') {
    const additions: NodalLoad[] = inputRows.map(({ cells, row, referenceId }) => {
      const node = nodeByNumber.get(positiveInteger(cells[0] ?? '', 'target node', row));
      if (!node) throw new Error(`Row ${row}: target node does not exist.`);
      return {
        id: id('nodal-load'),
        nodeId: node.id,
        loadCaseId: resolveLoadCase(model, cells[1] ?? '', referenceId, row),
        fx: requiredNumber(cells[2], 'Fx', row),
        fy: requiredNumber(cells[3], 'Fy', row),
        fz: requiredNumber(cells[4], 'Fz', row),
        mx: requiredNumber(cells[5], 'Mx', row),
        my: requiredNumber(cells[6], 'My', row),
        mz: requiredNumber(cells[7], 'Mz', row),
      };
    });
    return { model: { ...model, nodalLoads: [...model.nodalLoads, ...additions] }, imported: additions.length, warnings };
  }

  const memberByNumber = new Map(model.members.map((member) => [member.number!, member]));
  const additions: MemberLoad[] = inputRows.map(({ cells, row, referenceId }) => {
    const member = memberByNumber.get(positiveInteger(cells[0] ?? '', 'target member', row));
    if (!member) throw new Error(`Row ${row}: target member does not exist.`);
    const loadCaseId = resolveLoadCase(model, cells[1] ?? '', referenceId, row);
    const type = (cells[2] ?? 'udl').toLowerCase();
    if (type === 'cmq') {
      const fields = ['iQx', 'iQy', 'iQz', 'iMy', 'iMz', 'jQx', 'jQy', 'jQz', 'jMy', 'jMz', 'moy', 'moz'];
      const values = fields.map((field, index) => requiredNumber(cells[index + 3], `CMQ ${field}`, row));
      return {
        id: id('member-load'), memberId: member.id, loadCaseId, type: 'cmq',
        iQx: values[0]!, iQy: values[1]!, iQz: values[2]!, iMy: values[3]!, iMz: values[4]!,
        jQx: values[5]!, jQy: values[6]!, jQz: values[7]!, jMy: values[8]!, jMz: values[9]!,
        moy: values[10]!, moz: values[11]!,
      };
    }
    if (type === 'temperature') {
      return {
        id: id('member-load'), memberId: member.id, loadCaseId,
        type: 'temperature', direction: 'localX', value: requiredNumber(cells[4], 'delta T', row),
      };
    }
    const direction = cells[3] as MemberLoadDirection;
    if (!['localX', 'localY', 'localZ', 'globalX', 'globalY', 'globalZ'].includes(direction)) {
      throw new Error(`Row ${row}: direction must be localX/Y/Z or globalX/Y/Z.`);
    }
    const value = requiredNumber(cells[4], 'value', row);
    if (type === 'selfweight' || type === 'self-weight') {
      if (!['globalX', 'globalY', 'globalZ'].includes(direction)) {
        throw new Error(`Row ${row}: self-weight direction must be globalX, globalY or globalZ.`);
      }
      return {
        id: id('member-load'), memberId: member.id, loadCaseId,
        type: 'selfWeight',
        direction: direction as 'globalX' | 'globalY' | 'globalZ',
        value,
      };
    }
    if (type === 'point') {
      return {
        id: id('member-load'), memberId: member.id, loadCaseId,
        type: 'point', direction, value, a: requiredNumber(cells[5], 'position a', row),
      };
    }
    if (type === 'trapezoid') {
      return {
        id: id('member-load'), memberId: member.id, loadCaseId,
        type: 'trapezoid', direction, value,
        a: requiredNumber(cells[5], 'start a', row),
        valueEnd: requiredNumber(cells[6], 'end value w2', row),
        b: requiredNumber(cells[7], 'end b', row),
      };
    }
    if (type !== 'udl') throw new Error(`Row ${row}: unsupported member-load type "${type}".`);
    return { id: id('member-load'), memberId: member.id, loadCaseId, type: 'udl', direction, value };
  });
  return { model: { ...model, memberLoads: [...model.memberLoads, ...additions] }, imported: additions.length, warnings };
}

function tsvCell(value: unknown): string {
  const text = String(value ?? '');
  return /[\t\r\n"]/.test(text) || text.trim() !== text
    ? `"${text.replace(/"/g, '""')}"` : text;
}

export function exportModelTable(model: ProjectModel, kind: ModelTableKind): string {
  const numbered = ensureDisplayNumbers(model);
  const nodeById = new Map(numbered.nodes.map((node) => [node.id, node]));
  const memberById = new Map(numbered.members.map((member) => [member.id, member]));
  const caseById = new Map(getLoadCases(numbered).map((loadCase) => [loadCase.id, loadCase.name]));
  const caseFields = (load: NodalLoad | MemberLoad): [string, string] => {
    const caseId = load.loadCaseId ?? getLoadCaseIdForLoad(load, numbered);
    return [caseId, caseById.get(caseId) ?? ''];
  };
  if (kind === 'nodes') {
    return [
      ['No', 'X', 'Y', 'Z', 'Support'],
      ...numbered.nodes.map((node) => [node.number, node.x, node.y, node.z, restraintPreset(node.restraint)]),
    ].map((row) => row.map(tsvCell).join('\t')).join('\n');
  }
  if (kind === 'members') {
    return [
      ['No', 'iNode', 'jNode', 'SectionId', 'SectionName', 'CodeAngle'],
      ...numbered.members.map((member) => [
        member.number,
        nodeById.get(member.ni)?.number ?? '',
        nodeById.get(member.nj)?.number ?? '',
        member.sectionId,
        numbered.sections.find((section) => section.id === member.sectionId)?.name ?? member.sectionId,
        member.codeAngle,
      ]),
    ].map((row) => row.map(tsvCell).join('\t')).join('\n');
  }
  if (kind === 'nodalLoads') {
    return [
      ['Target', 'CaseId', 'CaseName', 'Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'],
      ...numbered.nodalLoads.map((load) => [
        nodeById.get(load.nodeId)?.number ?? '', ...caseFields(load),
        load.fx, load.fy, load.fz, load.mx, load.my, load.mz,
      ]),
    ].map((row) => row.map(tsvCell).join('\t')).join('\n');
  }
  return [
    ['Target', 'CaseId', 'CaseName', 'Type', 'Direction/iQx', 'Value/iQy', 'a/iQz', 'w2/iMy', 'b/iMz', 'jQx', 'jQy', 'jQz', 'jMy', 'jMz', 'moy', 'moz'],
    ...numbered.memberLoads.map((load) => {
      const prefix = [memberById.get(load.memberId)?.number ?? '', ...caseFields(load), load.type];
      if (load.type === 'cmq') {
        return [...prefix, load.iQx, load.iQy, load.iQz, load.iMy, load.iMz, load.jQx, load.jQy, load.jQz, load.jMy, load.jMz, load.moy, load.moz];
      }
      if (load.type === 'trapezoid') {
        return [...prefix, load.direction, load.value, load.a, load.valueEnd, load.b];
      }
      return [...prefix, load.direction, load.value, load.type === 'point' ? load.a : ''];
    }),
  ].map((row) => row.map(tsvCell).join('\t')).join('\n');
}
