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
import { getActiveLoadCaseId, getLoadCases } from '../../core/model/loadCases';
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


function id(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Math.random().toString(36).slice(2, 11)}`;
}

function number(value: string, label: string, row: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Row ${row}: ${label} must be a finite number.`);
  return parsed;
}

function positiveInteger(value: string, label: string, row: number): number {
  const parsed = Number(value.replace(/^[NM]/i, ''));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Row ${row}: ${label} must be a positive integer.`);
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

function rows(text: string): string[][] {
  const parsed = text.replace(/\r/g, '').split('\n')
    .map((line) => line.split('\t').map((cell) => cell.trim()))
    .filter((cells) => cells.some(Boolean));
  if (parsed.length > 0 && /^(no|number|節点|部材|target)/i.test(parsed[0]?.[0] ?? '')) parsed.shift();
  return parsed;
}

function resolveLoadCase(model: ProjectModel, value: string): string {
  const cases = getLoadCases(model);
  return cases.find((loadCase) => loadCase.id === value || loadCase.name === value)?.id
    ?? getActiveLoadCaseId(model);
}

export function importModelTable(
  rawModel: ProjectModel,
  kind: ModelTableKind,
  text: string,
): TableImportResult {
  const model = ensureDisplayNumbers(rawModel);
  const inputRows = rows(text);
  const warnings: string[] = [];

  if (kind === 'nodes') {
    const byNumber = new Map(model.nodes.map((node) => [node.number!, node]));
    for (const [index, cells] of inputRows.entries()) {
      const row = index + 1;
      const no = cells[0] ? positiveInteger(cells[0], 'No', row) : nextDisplayNumber([...byNumber.values()]);
      const existing = byNumber.get(no);
      const node: StructuralNode = {
        id: existing?.id ?? id('node'),
        number: no,
        x: number(cells[1] ?? '', 'X', row),
        y: number(cells[2] ?? '', 'Y', row),
        z: number(cells[3] ?? '', 'Z', row),
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
    for (const [index, cells] of inputRows.entries()) {
      const row = index + 1;
      const no = cells[0] ? positiveInteger(cells[0], 'No', row) : nextDisplayNumber([...byNumber.values()]);
      const ni = nodeByNumber.get(positiveInteger(cells[1] ?? '', 'i-node', row));
      const nj = nodeByNumber.get(positiveInteger(cells[2] ?? '', 'j-node', row));
      if (!ni || !nj) throw new Error(`Row ${row}: referenced node number does not exist.`);
      if (ni.id === nj.id) throw new Error(`Row ${row}: i-node and j-node must differ.`);
      const existing = byNumber.get(no);
      const sectionToken = cells[3] ?? '';
      const section = model.sections.find((candidate) =>
        candidate.id === sectionToken || candidate.name === sectionToken
      ) ?? model.sections[0];
      if (!section) throw new Error(`Row ${row}: no section is available.`);
      if (sectionToken && section.id !== sectionToken && section.name !== sectionToken) {
        warnings.push(`Row ${row}: section "${sectionToken}" was not found; used ${section.name}.`);
      }
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
    const additions: NodalLoad[] = inputRows.map((cells, index) => {
      const row = index + 1;
      const node = nodeByNumber.get(positiveInteger(cells[0] ?? '', 'target node', row));
      if (!node) throw new Error(`Row ${row}: target node does not exist.`);
      return {
        id: id('nodal-load'),
        nodeId: node.id,
        loadCaseId: resolveLoadCase(model, cells[1] ?? ''),
        fx: number(cells[2] ?? '0', 'Fx', row),
        fy: number(cells[3] ?? '0', 'Fy', row),
        fz: number(cells[4] ?? '0', 'Fz', row),
        mx: number(cells[5] ?? '0', 'Mx', row),
        my: number(cells[6] ?? '0', 'My', row),
        mz: number(cells[7] ?? '0', 'Mz', row),
      };
    });
    return { model: { ...model, nodalLoads: [...model.nodalLoads, ...additions] }, imported: additions.length, warnings };
  }

  const memberByNumber = new Map(model.members.map((member) => [member.number!, member]));
  const additions: MemberLoad[] = inputRows.map((cells, index) => {
    const row = index + 1;
    const member = memberByNumber.get(positiveInteger(cells[0] ?? '', 'target member', row));
    if (!member) throw new Error(`Row ${row}: target member does not exist.`);
    const loadCaseId = resolveLoadCase(model, cells[1] ?? '');
    const type = (cells[2] ?? 'udl').toLowerCase();
    if (type === 'cmq') {
      const values = cells.slice(3, 15).map((cell, i) => number(cell ?? '0', `CMQ ${i + 1}`, row));
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
        type: 'temperature', direction: 'localX', value: number(cells[4] ?? '', 'delta T', row),
      };
    }
    const direction = cells[3] as MemberLoadDirection;
    if (!['localX', 'localY', 'localZ', 'globalX', 'globalY', 'globalZ'].includes(direction)) {
      throw new Error(`Row ${row}: direction must be localX/Y/Z or globalX/Y/Z.`);
    }
    const value = number(cells[4] ?? '', 'value', row);
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
        type: 'point', direction, value, a: number(cells[5] ?? '', 'position a', row),
      };
    }
    if (type === 'trapezoid') {
      return {
        id: id('member-load'), memberId: member.id, loadCaseId,
        type: 'trapezoid', direction, value,
        a: number(cells[5] ?? '', 'start a', row),
        valueEnd: number(cells[6] ?? '', 'end value w2', row),
        b: number(cells[7] ?? '', 'end b', row),
      };
    }
    if (type !== 'udl') throw new Error(`Row ${row}: unsupported member-load type "${type}".`);
    return { id: id('member-load'), memberId: member.id, loadCaseId, type: 'udl', direction, value };
  });
  return { model: { ...model, memberLoads: [...model.memberLoads, ...additions] }, imported: additions.length, warnings };
}

export function exportModelTable(model: ProjectModel, kind: ModelTableKind): string {
  const numbered = ensureDisplayNumbers(model);
  const nodeById = new Map(numbered.nodes.map((node) => [node.id, node]));
  const memberById = new Map(numbered.members.map((member) => [member.id, member]));
  const caseById = new Map(getLoadCases(numbered).map((loadCase) => [loadCase.id, loadCase.name]));
  if (kind === 'nodes') {
    return [
      ['No', 'X', 'Y', 'Z', 'Support'],
      ...numbered.nodes.map((node) => [node.number, node.x, node.y, node.z, restraintPreset(node.restraint)]),
    ].map((row) => row.join('\t')).join('\n');
  }
  if (kind === 'members') {
    return [
      ['No', 'iNode', 'jNode', 'Section', 'CodeAngle'],
      ...numbered.members.map((member) => [
        member.number,
        nodeById.get(member.ni)?.number ?? '',
        nodeById.get(member.nj)?.number ?? '',
        numbered.sections.find((section) => section.id === member.sectionId)?.name ?? member.sectionId,
        member.codeAngle,
      ]),
    ].map((row) => row.join('\t')).join('\n');
  }
  if (kind === 'nodalLoads') {
    return [
      ['Target', 'Case', 'Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'],
      ...numbered.nodalLoads.map((load) => [
        nodeById.get(load.nodeId)?.number ?? '', caseById.get(load.loadCaseId ?? '') ?? '',
        load.fx, load.fy, load.fz, load.mx, load.my, load.mz,
      ]),
    ].map((row) => row.join('\t')).join('\n');
  }
  return [
    ['Target', 'Case', 'Type', 'Direction/iQx', 'Value/iQy', 'a/iQz', 'w2/iMy', 'b/iMz', 'jQx', 'jQy', 'jQz', 'jMy', 'jMz', 'moy', 'moz'],
    ...numbered.memberLoads.map((load) => {
      const prefix = [memberById.get(load.memberId)?.number ?? '', caseById.get(load.loadCaseId ?? '') ?? '', load.type];
      if (load.type === 'cmq') {
        return [...prefix, load.iQx, load.iQy, load.iQz, load.iMy, load.iMz, load.jQx, load.jQy, load.jQz, load.jMy, load.jMz, load.moy, load.moz];
      }
      if (load.type === 'trapezoid') {
        return [...prefix, load.direction, load.value, load.a, load.valueEnd, load.b];
      }
      return [...prefix, load.direction, load.value, load.type === 'point' ? load.a : ''];
    }),
  ].map((row) => row.join('\t')).join('\n');
}
