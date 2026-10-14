import type { FrameJsonBoundary, FrameJsonDocument, FrameJsonMemberLoad } from './frameJsonTypes';
import type { ImportLoadCaseInfo, ImportWarning, ModelImportResult } from './importTypes';
import type {
  ProjectModel,
  StructuralNode,
  Material,
  Section,
  Spring,
  Member,
  NodalLoad,
  MemberLoad,
  CMQMemberLoad,
} from '../core/model/types';

type BoundaryDof = 'deltaX' | 'deltaY' | 'deltaZ' | 'thetaX' | 'thetaY' | 'thetaZ';

const BOUNDARY_DOF_LABELS: Record<BoundaryDof, string> = {
  deltaX: 'ux',
  deltaY: 'uy',
  deltaZ: 'uz',
  thetaX: 'rx',
  thetaY: 'ry',
  thetaZ: 'rz',
};

export interface FrameJsonImportResult extends ModelImportResult {
  selectedLoadCaseIndex: number;
}

function normalizeName(
  raw: string,
  fallback: string,
  itemId: string,
  normalizedNameIds: string[]
): string {
  let value = raw.trim();
  while (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if (!((first === '"' && last === '"') || (first === "'" && last === "'"))) break;
    value = value.slice(1, -1).trim();
  }
  if (value !== raw) normalizedNameIds.push(itemId);
  return value || fallback;
}

function getLoadCaseName(doc: FrameJsonDocument, index: number, count: number): string {
  const hasHeader = doc.calcCaseMemo.length > count;
  const memo = doc.calcCaseMemo[index + (hasHeader ? 1 : 0)]?.trim() ?? '';
  if (!memo) return `Load Case ${index + 1}`;

  const fields = memo.split(',');
  const candidate = (fields[1] ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
  return candidate || `Load Case ${index + 1}`;
}

function getLoadCaseInfo(
  doc: FrameJsonDocument,
  selectedIndex: number
): ImportLoadCaseInfo[] {
  const observedCount = Math.max(
    0,
    ...doc.nodes.map((node) => node.loads.length),
    ...doc.members.map((member) => Math.max(member.memberLoads.length, member.cmqLoads.length))
  );
  const count = Math.max(1, doc.loadCaseCount, observedCount);
  return Array.from({ length: count }, (_, index) => ({
    index,
    name: getLoadCaseName(doc, index, count),
    selected: index === selectedIndex,
  }));
}

function hasMemberLoadData(load: FrameJsonMemberLoad): boolean {
  return load.p1 !== 0 || load.p2 !== 0 || load.p3 !== 0 ||
    load.scale !== 0 || load.unitLoad !== 0;
}

type MemberLoadValueResolution =
  | { kind: 'value'; value: number; conflictsWithP1: boolean }
  | { kind: 'zero' }
  | { kind: 'ambiguous' };

/**
 * FrameModelMaker stores `scale`, `unitLoad`, `loadCode`, and `p1`
 * independently and does not define a general precedence rule for external
 * consumers. Keep the two encodings distinct instead of using a truthiness
 * fallback that could revive a stale p1 value:
 *
 * - no parameterized fields: p1 is the direct value;
 * - parameterized fields present: unitLoad * scale is the value;
 * - an incomplete/zero parameterized value is ambiguous and is not imported.
 */
function resolveMemberLoadValue(load: FrameJsonMemberLoad): MemberLoadValueResolution {
  const hasParameterizedFields = load.scale !== 0 ||
    load.unitLoad !== 0 ||
    load.loadCode.trim() !== '';

  if (!hasParameterizedFields) {
    return load.p1 === 0
      ? { kind: 'zero' }
      : { kind: 'value', value: load.p1, conflictsWithP1: false };
  }

  const parameterizedValue = load.unitLoad * load.scale;
  if (parameterizedValue === 0) {
    const hasUnresolvedMagnitude = load.p1 !== 0 || load.unitLoad !== 0 || load.scale !== 0;
    return hasUnresolvedMagnitude ? { kind: 'ambiguous' } : { kind: 'zero' };
  }

  return {
    kind: 'value',
    value: parameterizedValue,
    conflictsWithP1: load.p1 !== 0 && load.p1 !== parameterizedValue,
  };
}

function pushAggregateWarning(
  warnings: ImportWarning[],
  code: string,
  message: string,
  itemIds: Array<string | number>
): void {
  if (itemIds.length === 0) return;
  warnings.push({ code, message, count: itemIds.length, itemIds });
}

/**
 * Convert FrameJson while retaining warnings, a result summary, and available
 * load-case information. Unsupported data is never silently reinterpreted.
 */
export function convertFrameJsonWithReport(
  doc: FrameJsonDocument,
  loadCaseIndex?: number
): FrameJsonImportResult {
  let sequence = 0;
  const nextSeq = (): string => String(++sequence);
  const warnings: ImportWarning[] = [];
  const normalizedNameIds: string[] = [];
  const unsupportedBoundaryIds: string[] = [];
  const missingBoundaryNodeIds: number[] = [];
  const missingMemberNodeIds: number[] = [];
  const missingSectionIds: number[] = [];
  const missingMaterialIds: number[] = [];
  const unsupportedLoadTypeIds: string[] = [];
  const unsupportedLoadDirectionIds: string[] = [];
  const ambiguousMemberLoadValueIds: string[] = [];
  const conflictingMemberLoadValueIds: string[] = [];

  const rawCaseIndex = loadCaseIndex ?? doc.loadCaseIndex;
  const provisionalCases = getLoadCaseInfo(doc, -1);
  const caseIdx = Math.min(Math.max(0, rawCaseIndex), provisionalCases.length - 1);
  if (caseIdx !== rawCaseIndex) {
    warnings.push({
      code: 'load-case-index-out-of-range',
      message: `Load case index ${rawCaseIndex} is outside the available range; case ${caseIdx + 1} was selected.`,
      itemIds: [rawCaseIndex],
      count: 1,
    });
  }
  const loadCases = getLoadCaseInfo(doc, caseIdx);
  const selectedLoadCase = loadCases[caseIdx]!;
  const importedLoadCaseId = `lc-frame-${caseIdx + 1}`;

  const boundaryMap = new Map(doc.boundaries.map((boundary) => [boundary.nodeNumber, boundary]));

  const matNumberToId = new Map<number, string>();
  const materials: Material[] = doc.materials.map((material) => {
    const id = String(material.number);
    matNumberToId.set(material.number, id);
    const nu = material.poisson ?? 0.3;
    if (material.poisson === undefined) {
      warnings.push({
        code: 'defaulted-poisson-ratio',
        message: `Material ${material.number}: omitted Poisson ratio was set to 0.3.`,
        itemIds: [material.number], count: 1,
      });
    }
    const G = material.shear > 0 ? material.shear : material.young / (2 * (1 + nu));
    if (!Number.isFinite(G)) {
      throw new Error(`Material ${material.number}: shear modulus calculated from E and Poisson ratio must be finite.`);
    }
    if (material.shear <= 0) {
      warnings.push({
        code: 'calculated-shear-modulus',
        message: `Material ${material.number}: shear modulus ${material.shear} was replaced by E / (2 * (1 + nu)) = ${G} using nu=${nu}.`,
        itemIds: [material.number], count: 1,
      });
    }
    return {
      id,
      name: normalizeName(
        material.name,
        `Material ${material.number}`,
        `material:${material.number}`,
        normalizedNameIds
      ),
      E: material.young,
      G,
      nu,
      expansion: material.expansion,
    };
  });

  const secNumberToId = new Map<number, string>();
  const sections: Section[] = doc.sections.map((section) => {
    const id = String(section.number);
    secNumberToId.set(section.number, id);
    const mappedMaterialId = matNumberToId.get(section.materialNumber);
    if (!mappedMaterialId) missingMaterialIds.push(section.number);
    return {
      id,
      name: normalizeName(
        section.comment,
        `Section ${section.number}`,
        `section:${section.number}`,
        normalizedNameIds
      ),
      materialId: mappedMaterialId ?? materials[0]?.id ?? '',
      A: section.p1_A,
      Ix: section.p2_Ix,
      Iy: section.p3_Iy,
      Iz: section.p4_Iz,
      ky: section.ky,
      kz: section.kz,
    };
  });

  const springs: Spring[] = doc.springs.map((spring) => ({
    id: String(spring.number),
    number: spring.number,
    method: spring.method,
    kTheta: spring.kTheta,
  }));

  const readBoundary = (
    boundary: FrameJsonBoundary | undefined,
    dof: BoundaryDof
  ): boolean => {
    if (!boundary) return false;
    const code = boundary[dof];
    if (code === 0) return false;
    if (code === 1) return true;
    unsupportedBoundaryIds.push(
      `${boundary.nodeNumber}.${BOUNDARY_DOF_LABELS[dof]}=${code}`
    );
    return false;
  };

  const nodeNumberToId = new Map<number, string>();
  const nodes: StructuralNode[] = doc.nodes.map((node) => {
    const id = String(node.number);
    nodeNumberToId.set(node.number, id);
    const boundary = boundaryMap.get(node.number);
    return {
      id,
      number: node.number,
      x: node.x,
      y: node.y,
      z: node.z,
      restraint: {
        ux: readBoundary(boundary, 'deltaX'),
        uy: readBoundary(boundary, 'deltaY'),
        uz: readBoundary(boundary, 'deltaZ'),
        rx: readBoundary(boundary, 'thetaX'),
        ry: readBoundary(boundary, 'thetaY'),
        rz: readBoundary(boundary, 'thetaZ'),
      },
    };
  });

  for (const boundary of doc.boundaries) {
    if (!nodeNumberToId.has(boundary.nodeNumber)) missingBoundaryNodeIds.push(boundary.nodeNumber);
  }

  const nodalLoads: NodalLoad[] = [];
  for (const node of doc.nodes) {
    const load = node.loads[caseIdx];
    if (!load) continue;
    if (load.p1 === 0 && load.p2 === 0 && load.p3 === 0 &&
        load.m1 === 0 && load.m2 === 0 && load.m3 === 0) continue;
    const nodeId = nodeNumberToId.get(node.number);
    if (!nodeId) continue;
    nodalLoads.push({
      id: `nl${nextSeq()}`,
      nodeId,
      fx: load.p1,
      fy: load.p2,
      fz: load.p3,
      mx: load.m1,
      my: load.m2,
      mz: load.m3,
    });
  }

  const members: Member[] = [];
  const memberLoads: MemberLoad[] = [];

  for (const sourceMember of doc.members) {
    const id = String(sourceMember.number);
    const ni = nodeNumberToId.get(sourceMember.iNodeNumber);
    const nj = nodeNumberToId.get(sourceMember.jNodeNumber);
    if (!ni || !nj) {
      missingMemberNodeIds.push(sourceMember.number);
      continue;
    }

    const mappedSectionId = secNumberToId.get(sourceMember.sectionNumber);
    if (!mappedSectionId) missingSectionIds.push(sourceMember.number);

    members.push({
      id,
      number: sourceMember.number,
      ni,
      nj,
      sectionId: mappedSectionId ?? sections[0]?.id ?? '',
      codeAngle: sourceMember.p3,
      iSprings: {
        x: sourceMember.ixSpring,
        y: sourceMember.iySpring,
        z: sourceMember.izSpring,
      },
      jSprings: {
        x: sourceMember.jxSpring,
        y: sourceMember.jySpring,
        z: sourceMember.jzSpring,
      },
      torsionRestraint: 'none',
    });

    const cmq = sourceMember.cmqLoads[caseIdx];
    if (cmq && !(
      cmq.iQx === 0 && cmq.iQy === 0 && cmq.iQz === 0 &&
      cmq.iMy === 0 && cmq.iMz === 0 &&
      cmq.jQx === 0 && cmq.jQy === 0 && cmq.jQz === 0 &&
      cmq.jMy === 0 && cmq.jMz === 0 &&
      cmq.moy === 0 && cmq.moz === 0
    )) {
      const cmqLoad: CMQMemberLoad = {
        id: `cmq${nextSeq()}`,
        memberId: id,
        type: 'cmq',
        iQx: cmq.iQx,
        iQy: cmq.iQy,
        iQz: cmq.iQz,
        iMy: cmq.iMy,
        iMz: cmq.iMz,
        jQx: cmq.jQx,
        jQy: cmq.jQy,
        jQz: cmq.jQz,
        jMy: cmq.jMy,
        jMz: cmq.jMz,
        moy: cmq.moy,
        moz: cmq.moz,
      };
      memberLoads.push(cmqLoad);
    }

    const sourceLoad = sourceMember.memberLoads[caseIdx];
    if (!sourceLoad || !hasMemberLoadData(sourceLoad)) continue;

    if (sourceLoad.type !== 0 && sourceLoad.type !== 1) {
      unsupportedLoadTypeIds.push(`${sourceMember.number}@${caseIdx + 1}:${sourceLoad.type}`);
      continue;
    }

    const direction = sourceLoad.direction === 0
      ? 'localX'
      : sourceLoad.direction === 1
        ? 'localY'
        : sourceLoad.direction === 2
          ? 'localZ'
          : null;
    if (!direction) {
      unsupportedLoadDirectionIds.push(
        `${sourceMember.number}@${caseIdx + 1}:${sourceLoad.direction}`
      );
      continue;
    }

    const loadReference = `${sourceMember.number}@${caseIdx + 1}`;
    const valueResolution = resolveMemberLoadValue(sourceLoad);
    if (valueResolution.kind === 'ambiguous') {
      ambiguousMemberLoadValueIds.push(loadReference);
      continue;
    }
    if (valueResolution.kind === 'zero') continue;
    if (valueResolution.conflictsWithP1) {
      conflictingMemberLoadValueIds.push(loadReference);
    }
    const loadValue = valueResolution.value;
    if (sourceLoad.type === 0) {
      memberLoads.push({
        id: `ml${nextSeq()}`,
        memberId: id,
        type: 'udl',
        direction,
        value: loadValue,
      });
    } else {
      memberLoads.push({
        id: `ml${nextSeq()}`,
        memberId: id,
        type: 'point',
        direction,
        value: loadValue,
        a: sourceLoad.p2,
      });
    }
  }

  const title = normalizeName(doc.title, 'Imported Model', 'project-title', normalizedNameIds);

  pushAggregateWarning(
    warnings,
    'normalized-name',
    `${normalizedNameIds.length} imported name(s) were trimmed or had surrounding quotes removed.`,
    normalizedNameIds
  );
  pushAggregateWarning(
    warnings,
    'unsupported-boundary-code',
    `${unsupportedBoundaryIds.length} unsupported boundary code(s) were left free instead of being treated as fixed.`,
    unsupportedBoundaryIds
  );
  pushAggregateWarning(
    warnings,
    'missing-boundary-node',
    `${missingBoundaryNodeIds.length} boundary record(s) reference missing nodes and were ignored.`,
    missingBoundaryNodeIds
  );
  pushAggregateWarning(
    warnings,
    'missing-member-node',
    `${missingMemberNodeIds.length} member(s) reference missing nodes and were skipped.`,
    missingMemberNodeIds
  );
  pushAggregateWarning(
    warnings,
    'missing-section',
    `${missingSectionIds.length} member(s) reference missing sections and use the first imported section.`,
    missingSectionIds
  );
  pushAggregateWarning(
    warnings,
    'missing-material',
    `${missingMaterialIds.length} section(s) reference missing materials and use the first imported material.`,
    missingMaterialIds
  );
  pushAggregateWarning(
    warnings,
    'unsupported-member-load-type',
    `${unsupportedLoadTypeIds.length} unsupported member load(s) were skipped.`,
    unsupportedLoadTypeIds
  );
  pushAggregateWarning(
    warnings,
    'unsupported-member-load-direction',
    `${unsupportedLoadDirectionIds.length} member load(s) with unsupported directions were skipped.`,
    unsupportedLoadDirectionIds
  );
  pushAggregateWarning(
    warnings,
    'ambiguous-member-load-value',
    `${ambiguousMemberLoadValueIds.length} member load(s) had parameterized fields but a zero unitLoad × scale; they were skipped instead of falling back to p1.`,
    ambiguousMemberLoadValueIds
  );
  pushAggregateWarning(
    warnings,
    'conflicting-member-load-value',
    `${conflictingMemberLoadValueIds.length} member load(s) specified both unitLoad × scale and a different p1; the parameterized value was imported and p1 was ignored.`,
    conflictingMemberLoadValueIds
  );

  if (doc.walls.length > 0) {
    warnings.push({
      code: 'walls-ignored',
      message: `${doc.walls.length} wall(s) are not supported and were not imported.`,
      count: doc.walls.length,
      itemIds: doc.walls.map((wall) => wall.number),
    });
  }

  const model: ProjectModel = {
    title,
    analysisMode: '3d',
    nodes,
    materials,
    sections,
    springs,
    loadCases: [{ id: importedLoadCaseId, name: selectedLoadCase.name }],
    loadCombinations: [],
    activeLoadCaseId: importedLoadCaseId,
    activeLoadCombinationId: null,
    members,
    couplings: [],
    nodalLoads,
    memberLoads,
    units: { force: 'kN', length: 'cm', moment: 'kN·cm' },
  };

  return {
    model,
    warnings,
    summary: {
      format: 'frame-json',
      nodes: nodes.length,
      members: members.length,
      materials: materials.length,
      sections: sections.length,
      nodalLoads: nodalLoads.length,
      memberLoads: memberLoads.length,
      skippedMembers: missingMemberNodeIds.length,
      ignoredWalls: doc.walls.length,
    },
    loadCases,
    selectedLoadCaseIndex: caseIdx,
  };
}

/**
 * Compatibility wrapper for callers that only need the imported model.
 */
export function convertFrameJson(
  doc: FrameJsonDocument,
  loadCaseIndex?: number
): ProjectModel {
  return convertFrameJsonWithReport(doc, loadCaseIndex).model;
}
