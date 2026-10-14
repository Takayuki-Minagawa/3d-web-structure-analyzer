import type {
  LoadCase,
  LoadCombination,
  LoadCaseId,
  MemberLoad,
  NodalLoad,
  PrescribedDisplacement,
  ProjectModel,
  AnalysisTarget,
  AnalysisError,
} from './types';
import { DOF_NAMES } from './restraints';

export const DEFAULT_LOAD_CASE_ID = 'lc-default';
export const DEFAULT_LOAD_CASE: LoadCase = {
  id: DEFAULT_LOAD_CASE_ID,
  name: 'Default',
};

export function getLoadCases(model: ProjectModel): LoadCase[] {
  return model.loadCases?.length ? model.loadCases : [DEFAULT_LOAD_CASE];
}

export function getLoadCombinations(model: ProjectModel): LoadCombination[] {
  return model.loadCombinations ?? [];
}

export function getActiveLoadCaseId(model: ProjectModel): LoadCaseId {
  const cases = getLoadCases(model);
  const active = model.activeLoadCaseId;
  if (active !== undefined && !cases.some((loadCase) => loadCase.id === active)) {
    throw new Error(`activeLoadCaseId: 未知の荷重ケース "${active}"。`);
  }
  return active ?? cases[0]!.id;
}

export function getActiveLoadCombination(
  model: ProjectModel
): LoadCombination | null {
  const activeId = model.activeLoadCombinationId;
  if (activeId === undefined || activeId === null) return null;
  const combination = getLoadCombinations(model).find((combo) => combo.id === activeId);
  if (!combination) throw new Error(`activeLoadCombinationId: 未知の荷重組合せ "${activeId}"。`);
  return combination;
}

export function getLoadCaseIdForLoad(
  load: Pick<NodalLoad | MemberLoad | PrescribedDisplacement, 'loadCaseId'>,
  model: ProjectModel
): LoadCaseId {
  const cases = getLoadCases(model);
  const fallback = cases[0]!.id;
  if (load.loadCaseId !== undefined && !cases.some((loadCase) => loadCase.id === load.loadCaseId)) {
    throw new Error(`loadCaseId: 未知の荷重ケース "${load.loadCaseId}"。`);
  }
  return load.loadCaseId ?? fallback;
}

/** Omitted IDs retain the legacy default; explicit unknown IDs never do. */
export function validateLoadReferences(model: ProjectModel): AnalysisError[] {
  const errors: AnalysisError[] = [];
  const fail = (path: string, message: string) => errors.push({ type: 'validation', message: `${path}: ${message}` });
  const cases = getLoadCases(model);
  const combinations = getLoadCombinations(model);
  const caseIds = new Set(cases.map((item) => item.id));
  const targetIds = new Set<string>();
  for (const [group, items] of [['loadCases', cases], ['loadCombinations', combinations]] as const) {
    items.forEach((item, index) => {
      if (!item.id || targetIds.has(item.id)) fail(`${group}[${index}].id`, `空または重複した対象ID "${item.id}"。`);
      targetIds.add(item.id);
    });
  }
  const checkCase = (id: string | undefined, path: string) => {
    if (id !== undefined && !caseIds.has(id)) fail(path, `未知の荷重ケース "${id}"。候補: ${[...caseIds].join(', ')}`);
  };
  checkCase(model.activeLoadCaseId, 'activeLoadCaseId');
  if (model.activeLoadCombinationId != null && !combinations.some((item) => item.id === model.activeLoadCombinationId)) {
    fail('activeLoadCombinationId', `未知の荷重組合せ "${model.activeLoadCombinationId}"。`);
  }
  for (const group of ['nodalLoads', 'memberLoads', 'prescribedDisplacements'] as const) {
    (model[group] ?? []).forEach((load, index) => checkCase(load.loadCaseId, `${group}[${index}].loadCaseId`));
  }
  combinations.forEach((combo, index) => combo.factors.forEach((term, termIndex) => {
    const path = `loadCombinations[${index}].factors[${termIndex}]`;
    if (term.loadCaseId === undefined) fail(`${path}.loadCaseId`, '組合せ項には荷重ケースIDが必要です。');
    else checkCase(term.loadCaseId, `${path}.loadCaseId`);
    if (!Number.isFinite(term.factor)) fail(`${path}.factor`, '係数は有限値である必要があります。');
  }));
  return errors;
}

function assertLoadReferences(model: ProjectModel): void {
  const error = validateLoadReferences(model)[0];
  if (error) throw new Error(error.message);
}

/** Load-carrying part of a model for one analysis target. */
type LoadSet = Pick<ProjectModel, 'nodalLoads' | 'memberLoads' | 'prescribedDisplacements'>;

function loadSetForCase(model: ProjectModel, loadCaseId: LoadCaseId): LoadSet {
  const inCase = (load: Pick<NodalLoad, 'loadCaseId'>) =>
    getLoadCaseIdForLoad(load, model) === loadCaseId;
  return {
    nodalLoads: model.nodalLoads.filter(inCase),
    memberLoads: model.memberLoads.filter(inCase),
    // The solver resolves coupled supports per load case, so entries whose
    // stored case id is missing or unknown carry the case they resolve to.
    prescribedDisplacements: (model.prescribedDisplacements ?? [])
      .filter(inCase)
      .map((item) => (item.loadCaseId === loadCaseId ? item : { ...item, loadCaseId })),
  };
}

function loadSetForCombination(model: ProjectModel, combination: LoadCombination): LoadSet {
  const loadSet: Required<LoadSet> = { nodalLoads: [], memberLoads: [], prescribedDisplacements: [] };
  for (const term of combination.factors) {
    if (term.factor === 0) continue;
    const caseLoads = loadSetForCase(model, term.loadCaseId);
    const scaledId = (id: string) => `${id}@${term.loadCaseId}*${term.factor}`;
    for (const load of caseLoads.nodalLoads) {
      loadSet.nodalLoads.push(scaleNodalLoad(load, scaledId(load.id), term.factor));
    }
    for (const load of caseLoads.memberLoads) {
      loadSet.memberLoads.push(scaleMemberLoad(load, scaledId(load.id), term.factor));
    }
    for (const item of caseLoads.prescribedDisplacements ?? []) {
      loadSet.prescribedDisplacements.push(
        scalePrescribedDisplacement(item, scaledId(item.id), term.factor)
      );
    }
  }
  return loadSet;
}

/** Build a load-only view for the active case or combination selected in the UI. */
export function resolveAnalysisLoadModel(model: ProjectModel): ProjectModel {
  assertLoadReferences(model);
  const activeCombination = getActiveLoadCombination(model);
  const loadSet = activeCombination
    ? loadSetForCombination(model, activeCombination)
    : loadSetForCase(model, getActiveLoadCaseId(model));
  return { ...model, ...loadSet };
}

/** Return every independently reportable load case followed by combinations. */
export function getAnalysisTargets(model: ProjectModel): AnalysisTarget[] {
  return [
    ...getLoadCases(model).map((loadCase) => ({
      id: loadCase.id,
      name: loadCase.name,
      type: 'loadCase' as const,
    })),
    ...getLoadCombinations(model).map((combination) => ({
      id: combination.id,
      name: combination.name,
      type: 'loadCombination' as const,
    })),
  ];
}

/** Build a load-only view for an explicit target without changing active UI state. */
export function resolveLoadTargetModel(
  model: ProjectModel,
  target: AnalysisTarget
): ProjectModel {
  assertLoadReferences(model);
  if (target.type === 'loadCase') {
    if (!getLoadCases(model).some((item) => item.id === target.id)) {
      throw new Error(`targetId: 未知の荷重ケース "${target.id}"。`);
    }
    return { ...model, ...loadSetForCase(model, target.id) };
  }
  const combination = getLoadCombinations(model).find((item) => item.id === target.id);
  if (!combination) {
    throw new Error(`荷重組合せ ${target.id} が見つかりません。`);
  }
  return { ...model, ...loadSetForCombination(model, combination) };
}

export function getActiveLoadTargetName(model: ProjectModel): string {
  const activeCombination = getActiveLoadCombination(model);
  if (activeCombination) return activeCombination.name;
  const activeLoadCaseId = getActiveLoadCaseId(model);
  return getLoadCases(model).find((loadCase) => loadCase.id === activeLoadCaseId)?.name
    ?? DEFAULT_LOAD_CASE.name;
}

function scaleNodalLoad(load: NodalLoad, id: string, factor: number): NodalLoad {
  return {
    ...load,
    id,
    fx: load.fx * factor,
    fy: load.fy * factor,
    fz: load.fz * factor,
    mx: load.mx * factor,
    my: load.my * factor,
    mz: load.mz * factor,
  };
}

function scalePrescribedDisplacement(
  item: PrescribedDisplacement,
  id: string,
  factor: number
): PrescribedDisplacement {
  const scaled = { ...item, id };
  for (const dof of DOF_NAMES) scaled[dof] = item[dof] * factor;
  return scaled;
}

function scaleMemberLoad(load: MemberLoad, id: string, factor: number): MemberLoad {
  if (load.type === 'trapezoid') {
    return { ...load, id, value: load.value * factor, valueEnd: load.valueEnd * factor };
  }
  if (load.type !== 'cmq') {
    return { ...load, id, value: load.value * factor };
  }

  return {
    ...load,
    id,
    iQx: load.iQx * factor,
    iQy: load.iQy * factor,
    iQz: load.iQz * factor,
    iMy: load.iMy * factor,
    iMz: load.iMz * factor,
    jQx: load.jQx * factor,
    jQy: load.jQy * factor,
    jQz: load.jQz * factor,
    jMy: load.jMy * factor,
    jMz: load.jMz * factor,
    moy: load.moy * factor,
    moz: load.moz * factor,
  };
}
