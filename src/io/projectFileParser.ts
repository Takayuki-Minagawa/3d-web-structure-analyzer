import type {
  AnalysisMode,
  CouplingConstraint,
  LoadCase,
  LoadCombination,
  Material,
  Member,
  MemberLoad,
  NodalLoad,
  NodalMass,
  NodalSpringSupport,
  PrescribedDisplacement,
  ProjectFile,
  ProjectModel,
  Restraint,
  Section,
  Spring,
  StructuralNode,
  TorsionRestraintEnd,
} from '../core/model/types';
import type { ImportWarning, ModelImportResult } from './importTypes';
import { parseJsonText } from './frameJsonParser';
import { DEFAULT_LOAD_CASE } from '../core/model/loadCases';

type JsonObject = Record<string, unknown>;

export const CURRENT_PROJECT_SCHEMA_VERSION = 2;

export class ProjectFileValidationError extends Error {
  constructor(message: string) {
    super(`Invalid project file: ${message}`);
    this.name = 'ProjectFileValidationError';
  }
}

export interface ProjectFileImportResult extends ModelImportResult {
  file: ProjectFile;
  migratedFromSchemaVersion?: number;
}

function fail(path: string, expectation: string): never {
  throw new ProjectFileValidationError(`${path} ${expectation}`);
}

function objectAt(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail(path, 'must be an object.');
  }
  return value as JsonObject;
}

function arrayAt(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) return fail(path, 'must be an array.');
  return value;
}

function optionalArrayAt(value: unknown, path: string): unknown[] {
  return value === undefined ? [] : arrayAt(value, path);
}

function stringAt(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    return fail(path, allowEmpty ? 'must be a string.' : 'must be a non-empty string.');
  }
  return value;
}

function optionalStringAt(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : stringAt(value, path);
}

function numberAt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fail(path, 'must be a finite number.');
  }
  return value;
}

function optionalNumberAt(value: unknown, path: string): number | undefined {
  return value === undefined ? undefined : numberAt(value, path);
}

function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') return fail(path, 'must be a boolean.');
  return value;
}

function parseRestraint(value: unknown, path: string): Restraint {
  const restraint = objectAt(value, path);
  return {
    ux: booleanAt(restraint.ux, `${path}.ux`),
    uy: booleanAt(restraint.uy, `${path}.uy`),
    uz: booleanAt(restraint.uz, `${path}.uz`),
    rx: booleanAt(restraint.rx, `${path}.rx`),
    ry: booleanAt(restraint.ry, `${path}.ry`),
    rz: booleanAt(restraint.rz, `${path}.rz`),
  };
}

function parseNode(value: unknown, path: string): StructuralNode {
  const node = objectAt(value, path);
  const number = optionalNumberAt(node.number, `${path}.number`);
  return {
    id: stringAt(node.id, `${path}.id`),
    ...(number === undefined ? {} : { number }),
    x: numberAt(node.x, `${path}.x`),
    y: numberAt(node.y, `${path}.y`),
    z: numberAt(node.z, `${path}.z`),
    restraint: parseRestraint(node.restraint, `${path}.restraint`),
  };
}

function parseMaterial(value: unknown, path: string): Material {
  const material = objectAt(value, path);
  const density = optionalNumberAt(material.density, `${path}.density`);
  return {
    id: stringAt(material.id, `${path}.id`),
    name: stringAt(material.name, `${path}.name`, true),
    E: numberAt(material.E, `${path}.E`),
    G: numberAt(material.G, `${path}.G`),
    nu: numberAt(material.nu, `${path}.nu`),
    expansion: numberAt(material.expansion, `${path}.expansion`),
    ...(density === undefined ? {} : { density }),
  };
}

function parseSection(value: unknown, path: string): Section {
  const section = objectAt(value, path);
  return {
    id: stringAt(section.id, `${path}.id`),
    name: stringAt(section.name, `${path}.name`, true),
    materialId: stringAt(section.materialId, `${path}.materialId`),
    A: numberAt(section.A, `${path}.A`),
    Ix: numberAt(section.Ix, `${path}.Ix`),
    Iy: numberAt(section.Iy, `${path}.Iy`),
    Iz: numberAt(section.Iz, `${path}.Iz`),
    ky: numberAt(section.ky, `${path}.ky`),
    kz: numberAt(section.kz, `${path}.kz`),
  };
}

function parseSpring(value: unknown, path: string): Spring {
  const spring = objectAt(value, path);
  return {
    id: stringAt(spring.id, `${path}.id`),
    number: numberAt(spring.number, `${path}.number`),
    method: numberAt(spring.method, `${path}.method`),
    kTheta: numberAt(spring.kTheta, `${path}.kTheta`),
  };
}

function parseEndSprings(value: unknown, path: string): { x: number; y: number; z: number } {
  if (value === undefined) return { x: 0, y: 0, z: 0 };
  const springs = objectAt(value, path);
  return {
    x: numberAt(springs.x, `${path}.x`),
    y: numberAt(springs.y, `${path}.y`),
    z: numberAt(springs.z, `${path}.z`),
  };
}

function parseTorsionRestraint(value: unknown, path: string): TorsionRestraintEnd | undefined {
  if (value === undefined) return undefined;
  if (value === 'none' || value === 'i' || value === 'j') return value;
  return fail(path, 'must be "none", "i", or "j".');
}

function parseMember(value: unknown, path: string): Member {
  const member = objectAt(value, path);
  const number = optionalNumberAt(member.number, `${path}.number`);
  const torsionRestraint = parseTorsionRestraint(
    member.torsionRestraint,
    `${path}.torsionRestraint`
  );
  return {
    id: stringAt(member.id, `${path}.id`),
    ...(number === undefined ? {} : { number }),
    ni: stringAt(member.ni, `${path}.ni`),
    nj: stringAt(member.nj, `${path}.nj`),
    sectionId: stringAt(member.sectionId, `${path}.sectionId`),
    codeAngle: numberAt(member.codeAngle, `${path}.codeAngle`),
    iSprings: parseEndSprings(member.iSprings, `${path}.iSprings`),
    jSprings: parseEndSprings(member.jSprings, `${path}.jSprings`),
    ...(torsionRestraint === undefined ? {} : { torsionRestraint }),
  };
}

function parseNodalLoad(value: unknown, path: string): NodalLoad {
  const load = objectAt(value, path);
  const loadCaseId = optionalStringAt(load.loadCaseId, `${path}.loadCaseId`);
  return {
    id: stringAt(load.id, `${path}.id`),
    ...(loadCaseId === undefined ? {} : { loadCaseId }),
    nodeId: stringAt(load.nodeId, `${path}.nodeId`),
    fx: numberAt(load.fx, `${path}.fx`),
    fy: numberAt(load.fy, `${path}.fy`),
    fz: numberAt(load.fz, `${path}.fz`),
    mx: numberAt(load.mx, `${path}.mx`),
    my: numberAt(load.my, `${path}.my`),
    mz: numberAt(load.mz, `${path}.mz`),
  };
}

function parseMemberLoad(value: unknown, path: string): MemberLoad {
  const load = objectAt(value, path);
  const type = stringAt(load.type, `${path}.type`);
  const loadCaseId = optionalStringAt(load.loadCaseId, `${path}.loadCaseId`);
  const common = {
    id: stringAt(load.id, `${path}.id`),
    ...(loadCaseId === undefined ? {} : { loadCaseId }),
    memberId: stringAt(load.memberId, `${path}.memberId`),
  };
  if (type === 'cmq') {
    return {
      ...common,
      type,
      iQx: numberAt(load.iQx, `${path}.iQx`),
      iQy: numberAt(load.iQy, `${path}.iQy`),
      iQz: numberAt(load.iQz, `${path}.iQz`),
      iMy: numberAt(load.iMy, `${path}.iMy`),
      iMz: numberAt(load.iMz, `${path}.iMz`),
      jQx: numberAt(load.jQx, `${path}.jQx`),
      jQy: numberAt(load.jQy, `${path}.jQy`),
      jQz: numberAt(load.jQz, `${path}.jQz`),
      jMy: numberAt(load.jMy, `${path}.jMy`),
      jMz: numberAt(load.jMz, `${path}.jMz`),
      moy: numberAt(load.moy, `${path}.moy`),
      moz: numberAt(load.moz, `${path}.moz`),
    };
  }

  if (type === 'temperature') {
    if (load.direction !== undefined && load.direction !== 'localX') {
      return fail(`${path}.direction`, 'must be "localX" for a temperature load.');
    }
    return {
      ...common,
      type,
      direction: 'localX',
      value: numberAt(load.value, `${path}.value`),
    };
  }
  if (type === 'selfWeight') {
    const direction = load.direction;
    if (direction !== 'globalX' && direction !== 'globalY' && direction !== 'globalZ') {
      return fail(`${path}.direction`, 'must be "globalX", "globalY", or "globalZ" for self-weight.');
    }
    return {
      ...common,
      type,
      direction,
      value: numberAt(load.value, `${path}.value`),
    };
  }

  const direction = load.direction;
  if (
    direction !== 'localX' && direction !== 'localY' && direction !== 'localZ' &&
    direction !== 'globalX' && direction !== 'globalY' && direction !== 'globalZ'
  ) {
    return fail(
      `${path}.direction`,
      'must be a supported local or global member-load direction.'
    );
  }
  if (type === 'udl') {
    return {
      ...common,
      type,
      direction,
      value: numberAt(load.value, `${path}.value`),
    };
  }
  if (type === 'trapezoid') {
    return {
      ...common,
      type,
      direction,
      value: numberAt(load.value, `${path}.value`),
      valueEnd: numberAt(load.valueEnd, `${path}.valueEnd`),
      a: numberAt(load.a, `${path}.a`),
      b: numberAt(load.b, `${path}.b`),
    };
  }
  if (type === 'point') {
    return {
      ...common,
      type,
      direction,
      value: numberAt(load.value, `${path}.value`),
      a: numberAt(load.a, `${path}.a`),
    };
  }
  return fail(
    `${path}.type`,
    'must be "point", "udl", "trapezoid", "cmq", "temperature", or "selfWeight".'
  );
}

function parseNodalSpring(value: unknown, path: string): NodalSpringSupport {
  const spring = objectAt(value, path);
  return {
    id: stringAt(spring.id, `${path}.id`),
    nodeId: stringAt(spring.nodeId, `${path}.nodeId`),
    ux: numberAt(spring.ux, `${path}.ux`),
    uy: numberAt(spring.uy, `${path}.uy`),
    uz: numberAt(spring.uz, `${path}.uz`),
    rx: numberAt(spring.rx, `${path}.rx`),
    ry: numberAt(spring.ry, `${path}.ry`),
    rz: numberAt(spring.rz, `${path}.rz`),
  };
}

function parsePrescribedDisplacement(value: unknown, path: string): PrescribedDisplacement {
  const item = objectAt(value, path);
  const loadCaseId = optionalStringAt(item.loadCaseId, `${path}.loadCaseId`);
  return {
    id: stringAt(item.id, `${path}.id`),
    ...(loadCaseId === undefined ? {} : { loadCaseId }),
    nodeId: stringAt(item.nodeId, `${path}.nodeId`),
    ux: numberAt(item.ux, `${path}.ux`),
    uy: numberAt(item.uy, `${path}.uy`),
    uz: numberAt(item.uz, `${path}.uz`),
    rx: numberAt(item.rx, `${path}.rx`),
    ry: numberAt(item.ry, `${path}.ry`),
    rz: numberAt(item.rz, `${path}.rz`),
  };
}

function parseNodalMass(value: unknown, path: string): NodalMass {
  const item = objectAt(value, path);
  return {
    id: stringAt(item.id, `${path}.id`),
    nodeId: stringAt(item.nodeId, `${path}.nodeId`),
    mass: numberAt(item.mass, `${path}.mass`),
  };
}

function parseGravity(value: unknown, path: string): NonNullable<ProjectModel['gravity']> {
  const gravity = objectAt(value, path);
  return {
    x: numberAt(gravity.x, `${path}.x`),
    y: numberAt(gravity.y, `${path}.y`),
    z: numberAt(gravity.z, `${path}.z`),
  };
}

function parseCoupling(value: unknown, path: string): CouplingConstraint {
  const coupling = objectAt(value, path);
  return {
    id: stringAt(coupling.id, `${path}.id`),
    masterNodeId: stringAt(coupling.masterNodeId, `${path}.masterNodeId`),
    slaveNodeId: stringAt(coupling.slaveNodeId, `${path}.slaveNodeId`),
    ux: booleanAt(coupling.ux, `${path}.ux`),
    uy: booleanAt(coupling.uy, `${path}.uy`),
    uz: booleanAt(coupling.uz, `${path}.uz`),
    rx: booleanAt(coupling.rx, `${path}.rx`),
    ry: booleanAt(coupling.ry, `${path}.ry`),
    rz: booleanAt(coupling.rz, `${path}.rz`),
  };
}

function parseLoadCase(value: unknown, path: string): LoadCase {
  const loadCase = objectAt(value, path);
  return {
    id: stringAt(loadCase.id, `${path}.id`),
    name: stringAt(loadCase.name, `${path}.name`, true),
  };
}

function parseLoadCombination(value: unknown, path: string): LoadCombination {
  const combination = objectAt(value, path);
  return {
    id: stringAt(combination.id, `${path}.id`),
    name: stringAt(combination.name, `${path}.name`, true),
    factors: arrayAt(combination.factors, `${path}.factors`).map((factorValue, index) => {
      const factor = objectAt(factorValue, `${path}.factors[${index}]`);
      return {
        loadCaseId: stringAt(factor.loadCaseId, `${path}.factors[${index}].loadCaseId`),
        factor: numberAt(factor.factor, `${path}.factors[${index}].factor`),
      };
    }),
  };
}

function parseAnalysisMode(value: unknown, path: string): AnalysisMode | undefined {
  if (value === undefined) return undefined;
  if (value === '3d' || value === 'xz2d' || value === 'xy2d' || value === 'yz2d') {
    return value;
  }
  return fail(path, 'must be a supported analysis mode.');
}

function parseUnits(value: unknown, path: string): ProjectModel['units'] {
  const units = objectAt(value, path);
  return {
    force: stringAt(units.force, `${path}.force`),
    length: stringAt(units.length, `${path}.length`),
    moment: stringAt(units.moment, `${path}.moment`),
  };
}

type UnknownLoadCaseReference = {
  context: string;
  itemId: string;
};

function rejectDuplicateLoadTargetIds(model: ProjectModel): void {
  const loadCaseIds = new Map<string, number>();
  (model.loadCases ?? []).forEach((loadCase, index) => {
    const firstIndex = loadCaseIds.get(loadCase.id);
    if (firstIndex !== undefined) {
      fail(
        `model.loadCases[${index}].id`,
        `must be unique; "${loadCase.id}" is already used by model.loadCases[${firstIndex}].id.`
      );
    }
    loadCaseIds.set(loadCase.id, index);
  });

  const combinationIds = new Map<string, number>();
  (model.loadCombinations ?? []).forEach((combination, index) => {
    const firstIndex = combinationIds.get(combination.id);
    if (firstIndex !== undefined) {
      fail(
        `model.loadCombinations[${index}].id`,
        `must be unique; "${combination.id}" is already used by ` +
        `model.loadCombinations[${firstIndex}].id.`
      );
    }
    const loadCaseIndex = loadCaseIds.get(combination.id);
    if (loadCaseIndex !== undefined) {
      fail(
        `model.loadCombinations[${index}].id`,
        `must not reuse load-case ID "${combination.id}" from ` +
        `model.loadCases[${loadCaseIndex}].id.`
      );
    }
    combinationIds.set(combination.id, index);
  });
}

/**
 * Preserve explicitly referenced, but undeclared, load cases at the native import boundary.
 *
 * The store normalizer historically reassigned such loads to the first case and removed
 * unknown combination factors. Materializing a recovered case here keeps the imported
 * load partition and factors intact while leaving an actionable warning in the import report.
 */
function recoverUnknownLoadCaseReferences(
  model: ProjectModel,
  warnings: ImportWarning[]
): ProjectModel {
  const effectiveLoadCases = model.loadCases?.length
    ? [...model.loadCases]
    : [{ ...DEFAULT_LOAD_CASE }];
  const declaredIds = new Set(effectiveLoadCases.map((loadCase) => loadCase.id));
  const unknownReferences = new Map<string, UnknownLoadCaseReference[]>();

  const recordReference = (
    loadCaseId: string | undefined,
    context: string,
    itemId: string
  ) => {
    if (!loadCaseId || declaredIds.has(loadCaseId)) return;
    const references = unknownReferences.get(loadCaseId) ?? [];
    references.push({ context, itemId });
    unknownReferences.set(loadCaseId, references);
  };

  model.nodalLoads.forEach((load, index) => {
    recordReference(
      load.loadCaseId,
      `nodal load "${load.id}"`,
      `model.nodalLoads[${index}]`
    );
  });
  model.memberLoads.forEach((load, index) => {
    recordReference(
      load.loadCaseId,
      `member load "${load.id}"`,
      `model.memberLoads[${index}]`
    );
  });
  (model.prescribedDisplacements ?? []).forEach((item, index) => {
    recordReference(
      item.loadCaseId,
      `prescribed displacement "${item.id}"`,
      `model.prescribedDisplacements[${index}]`
    );
  });
  (model.loadCombinations ?? []).forEach((combination, combinationIndex) => {
    combination.factors.forEach((factor, factorIndex) => {
      recordReference(
        factor.loadCaseId,
        `factor ${factorIndex + 1} of load combination "${combination.id}"`,
        `model.loadCombinations[${combinationIndex}].factors[${factorIndex}]`
      );
    });
  });
  recordReference(
    model.activeLoadCaseId,
    'active load-case selection',
    'model.activeLoadCaseId'
  );

  if (unknownReferences.size === 0) return model;

  const combinationIndexById = new Map(
    (model.loadCombinations ?? []).map((combination, index) => [combination.id, index])
  );
  for (const [loadCaseId, references] of unknownReferences) {
    const combinationIndex = combinationIndexById.get(loadCaseId);
    if (combinationIndex !== undefined) {
      fail(
        references[0]!.itemId,
        `references undeclared load-case ID "${loadCaseId}", but that ID is already used by ` +
        `model.loadCombinations[${combinationIndex}].id and cannot be recovered unambiguously.`
      );
    }
    effectiveLoadCases.push({ id: loadCaseId, name: `Recovered (${loadCaseId})` });
    warnings.push({
      code: 'unknown-load-case-recovered',
      message:
        `Undeclared load case "${loadCaseId}" was referenced by ` +
        `${references.map((reference) => reference.context).join(', ')}. ` +
        'A recovered load case with the same ID was added; loads were not reassigned ' +
        'and combination factors were not removed.',
      count: references.length,
      itemIds: references.map((reference) => reference.itemId),
    });
  }

  return { ...model, loadCases: effectiveLoadCases };
}

function resetUnknownActiveLoadCombination(
  model: ProjectModel,
  warnings: ImportWarning[]
): ProjectModel {
  const activeId = model.activeLoadCombinationId;
  if (
    !activeId ||
    (model.loadCombinations ?? []).some((combination) => combination.id === activeId)
  ) {
    return model;
  }

  warnings.push({
    code: 'unknown-active-load-combination-reset',
    message:
      `Active load combination "${activeId}" is not declared in model.loadCombinations. ` +
      'The active combination was reset to none; load combinations and their factors were preserved.',
    count: 1,
    itemIds: ['model.activeLoadCombinationId'],
  });
  return { ...model, activeLoadCombinationId: null };
}

function parseV2Model(value: unknown, warnings: ImportWarning[]): ProjectModel {
  const model = objectAt(value, 'model');
  const defaultedCollections: string[] = [];
  if (model.springs === undefined) defaultedCollections.push('springs');
  if (model.couplings === undefined) defaultedCollections.push('couplings');
  if (model.nodeSprings === undefined) defaultedCollections.push('nodeSprings');

  const analysisMode = parseAnalysisMode(model.analysisMode, 'model.analysisMode');
  const loadCases = model.loadCases === undefined
    ? undefined
    : arrayAt(model.loadCases, 'model.loadCases').map((value, index) =>
      parseLoadCase(value, `model.loadCases[${index}]`)
    );
  const loadCombinations = model.loadCombinations === undefined
    ? undefined
    : arrayAt(model.loadCombinations, 'model.loadCombinations').map((value, index) =>
      parseLoadCombination(value, `model.loadCombinations[${index}]`)
    );
  const activeLoadCaseId = optionalStringAt(model.activeLoadCaseId, 'model.activeLoadCaseId');
  const activeLoadCombinationId = model.activeLoadCombinationId === null
    ? null
    : optionalStringAt(model.activeLoadCombinationId, 'model.activeLoadCombinationId');

  if (defaultedCollections.length > 0) {
    warnings.push({
      code: 'native-defaults-applied',
      message: `Missing optional collection(s) were initialized: ${defaultedCollections.join(', ')}.`,
      count: defaultedCollections.length,
      itemIds: defaultedCollections,
    });
  }

  const parsedModel: ProjectModel = {
    title: stringAt(model.title, 'model.title', true),
    ...(analysisMode === undefined ? {} : { analysisMode }),
    nodes: arrayAt(model.nodes, 'model.nodes').map((value, index) =>
      parseNode(value, `model.nodes[${index}]`)
    ),
    materials: arrayAt(model.materials, 'model.materials').map((value, index) =>
      parseMaterial(value, `model.materials[${index}]`)
    ),
    sections: arrayAt(model.sections, 'model.sections').map((value, index) =>
      parseSection(value, `model.sections[${index}]`)
    ),
    springs: optionalArrayAt(model.springs, 'model.springs').map((value, index) =>
      parseSpring(value, `model.springs[${index}]`)
    ),
    ...(loadCases === undefined ? {} : { loadCases }),
    ...(loadCombinations === undefined ? {} : { loadCombinations }),
    ...(activeLoadCaseId === undefined ? {} : { activeLoadCaseId }),
    ...(activeLoadCombinationId === undefined ? {} : { activeLoadCombinationId }),
    members: arrayAt(model.members, 'model.members').map((value, index) =>
      parseMember(value, `model.members[${index}]`)
    ),
    couplings: optionalArrayAt(model.couplings, 'model.couplings').map((value, index) =>
      parseCoupling(value, `model.couplings[${index}]`)
    ),
    nodeSprings: optionalArrayAt(model.nodeSprings, 'model.nodeSprings').map((value, index) =>
      parseNodalSpring(value, `model.nodeSprings[${index}]`)
    ),
    ...(model.gravity === undefined ? {} : { gravity: parseGravity(model.gravity, 'model.gravity') }),
    nodalLoads: arrayAt(model.nodalLoads, 'model.nodalLoads').map((value, index) =>
      parseNodalLoad(value, `model.nodalLoads[${index}]`)
    ),
    memberLoads: arrayAt(model.memberLoads, 'model.memberLoads').map((value, index) =>
      parseMemberLoad(value, `model.memberLoads[${index}]`)
    ),
    // Added after schema version 2 shipped; absent in older files.
    prescribedDisplacements: optionalArrayAt(
      model.prescribedDisplacements,
      'model.prescribedDisplacements'
    ).map((value, index) =>
      parsePrescribedDisplacement(value, `model.prescribedDisplacements[${index}]`)
    ),
    nodeMasses: optionalArrayAt(model.nodeMasses, 'model.nodeMasses').map((value, index) =>
      parseNodalMass(value, `model.nodeMasses[${index}]`)
    ),
    units: parseUnits(model.units, 'model.units'),
  };
  rejectDuplicateLoadTargetIds(parsedModel);
  return resetUnknownActiveLoadCombination(
    recoverUnknownLoadCaseReferences(parsedModel, warnings),
    warnings
  );
}

function legacyNumber(value: unknown, path: string, fallback = 0): number {
  return value === undefined ? fallback : numberAt(value, path);
}

function migrateV1Model(value: unknown): ProjectModel {
  const model = objectAt(value, 'model');
  const sourceMaterials = arrayAt(model.materials, 'model.materials');
  const materials: Material[] = sourceMaterials.map((value, index) => {
    const material = objectAt(value, `model.materials[${index}]`);
    const nu = legacyNumber(material.nu, `model.materials[${index}].nu`, 0.3);
    const E = numberAt(material.E, `model.materials[${index}].E`);
    return {
      id: stringAt(material.id, `model.materials[${index}].id`),
      name: stringAt(material.name, `model.materials[${index}].name`, true),
      E,
      G: E / (2 * (1 + nu)),
      nu,
      expansion: legacyNumber(material.expansion, `model.materials[${index}].expansion`),
    };
  });

  const sourceMembers = arrayAt(model.members, 'model.members').map((value, index) =>
    objectAt(value, `model.members[${index}]`)
  );
  const sections: Section[] = arrayAt(model.sections, 'model.sections').map((value, index) => {
    const path = `model.sections[${index}]`;
    const section = objectAt(value, path);
    const id = stringAt(section.id, `${path}.id`);
    const A = numberAt(section.A, `${path}.A`);
    const I = numberAt(section.I, `${path}.I`);
    const As = legacyNumber(section.As, `${path}.As`);
    const referencingMember = sourceMembers.find((member) => member.sectionId === id);
    const materialId = optionalStringAt(section.materialId, `${path}.materialId`) ??
      (referencingMember
        ? optionalStringAt(referencingMember.materialId, `${path}.referencingMember.materialId`)
        : undefined) ?? materials[0]?.id ?? fail(path, 'cannot resolve a material.');
    const shearRatio = A === 0 ? 0 : As / A;
    return {
      id,
      name: stringAt(section.name, `${path}.name`, true),
      materialId,
      A,
      Ix: I,
      Iy: I,
      Iz: I,
      ky: shearRatio,
      kz: shearRatio,
    };
  });

  const nodes: StructuralNode[] = arrayAt(model.nodes, 'model.nodes').map((value, index) => {
    const path = `model.nodes[${index}]`;
    const node = objectAt(value, path);
    const restraint = objectAt(node.restraint, `${path}.restraint`);
    const number = optionalNumberAt(node.number, `${path}.number`);
    return {
      id: stringAt(node.id, `${path}.id`),
      ...(number === undefined ? {} : { number }),
      x: numberAt(node.x, `${path}.x`),
      y: numberAt(node.y, `${path}.y`),
      z: 0,
      restraint: {
        ux: booleanAt(restraint.ux, `${path}.restraint.ux`),
        uy: booleanAt(restraint.uy, `${path}.restraint.uy`),
        uz: false,
        rx: false,
        ry: false,
        rz: booleanAt(restraint.rz, `${path}.restraint.rz`),
      },
    };
  });

  const members: Member[] = sourceMembers.map((member, index) => {
    const path = `model.members[${index}]`;
    const number = optionalNumberAt(member.number, `${path}.number`);
    return {
      id: stringAt(member.id, `${path}.id`),
      ...(number === undefined ? {} : { number }),
      ni: stringAt(member.ni, `${path}.ni`),
      nj: stringAt(member.nj, `${path}.nj`),
      sectionId: stringAt(member.sectionId, `${path}.sectionId`),
      codeAngle: 0,
      iSprings: { x: 0, y: 0, z: 0 },
      jSprings: { x: 0, y: 0, z: 0 },
      torsionRestraint: 'none',
    };
  });

  const nodalLoads: NodalLoad[] = arrayAt(model.nodalLoads, 'model.nodalLoads').map((value, index) => {
    const path = `model.nodalLoads[${index}]`;
    const load = objectAt(value, path);
    return {
      id: stringAt(load.id, `${path}.id`),
      nodeId: stringAt(load.nodeId, `${path}.nodeId`),
      fx: legacyNumber(load.fx, `${path}.fx`),
      fy: legacyNumber(load.fy, `${path}.fy`),
      fz: 0,
      mx: 0,
      my: 0,
      mz: legacyNumber(load.mz, `${path}.mz`),
    };
  });

  const memberLoads = arrayAt(model.memberLoads, 'model.memberLoads').map((value, index) =>
    parseMemberLoad(value, `model.memberLoads[${index}]`)
  );
  const defaultLoadCase: LoadCase = { id: 'default', name: 'Default' };

  return {
    title: model.title === undefined ? 'Migrated Project' : stringAt(model.title, 'model.title', true),
    analysisMode: 'xy2d',
    nodes,
    materials,
    sections,
    springs: [],
    loadCases: [defaultLoadCase],
    loadCombinations: [],
    activeLoadCaseId: defaultLoadCase.id,
    activeLoadCombinationId: null,
    members,
    couplings: [],
    nodalLoads: nodalLoads.map((load) => ({ ...load, loadCaseId: defaultLoadCase.id })),
    memberLoads: memberLoads.map((load) => ({ ...load, loadCaseId: defaultLoadCase.id })),
    units: parseUnits(model.units, 'model.units'),
  };
}

function buildResult(
  model: ProjectModel,
  savedAt: string,
  warnings: ImportWarning[],
  migratedFromSchemaVersion?: number
): ProjectFileImportResult {
  const activeLoadCaseId = model.activeLoadCaseId;
  const loadCases = (model.loadCases ?? []).map((loadCase, index) => ({
    index,
    name: loadCase.name || `Load Case ${index + 1}`,
    selected: loadCase.id === activeLoadCaseId,
  }));
  return {
    model,
    file: {
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      savedAt,
      model,
    },
    warnings,
    summary: {
      format: 'project-file',
      nodes: model.nodes.length,
      members: model.members.length,
      materials: model.materials.length,
      sections: model.sections.length,
      nodalLoads: model.nodalLoads.length,
      memberLoads: model.memberLoads.length,
      skippedMembers: 0,
      ignoredWalls: 0,
    },
    loadCases,
    ...(migratedFromSchemaVersion === undefined ? {} : { migratedFromSchemaVersion }),
  };
}

/** Validate and, when necessary, migrate an already-parsed native project file. */
export function parseProjectFile(value: unknown): ProjectFileImportResult {
  const root = objectAt(value, 'root');
  const schemaVersion = numberAt(root.schemaVersion, 'schemaVersion');
  if (!Number.isInteger(schemaVersion)) fail('schemaVersion', 'must be an integer.');
  const savedAt = stringAt(root.savedAt, 'savedAt');

  if (schemaVersion === 1) {
    const warnings: ImportWarning[] = [{
      code: 'schema-v1-migrated',
      message: 'Legacy schema version 1 was migrated to the current 3D project shape in XY 2D mode.',
      count: 1,
      itemIds: [1],
    }];
    return buildResult(migrateV1Model(root.model), savedAt, warnings, 1);
  }
  if (schemaVersion !== CURRENT_PROJECT_SCHEMA_VERSION) {
    fail(
      'schemaVersion',
      `must be 1 or ${CURRENT_PROJECT_SCHEMA_VERSION}; received ${schemaVersion}.`
    );
  }

  const warnings: ImportWarning[] = [];
  return buildResult(parseV2Model(root.model, warnings), savedAt, warnings);
}

/** Parse native project JSON text exactly once, then validate its shape. */
export function parseProjectFileText(text: string): ProjectFileImportResult {
  return parseProjectFile(parseJsonText(text));
}
