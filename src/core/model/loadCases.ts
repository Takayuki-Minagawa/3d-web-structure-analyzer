import type {
  LoadCase,
  LoadCombination,
  LoadCaseId,
  MemberLoad,
  NodalLoad,
  PrescribedDisplacement,
  ProjectModel,
  AnalysisTarget,
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
  return active && cases.some((loadCase) => loadCase.id === active)
    ? active
    : cases[0]!.id;
}

export function getActiveLoadCombination(
  model: ProjectModel
): LoadCombination | null {
  const activeId = model.activeLoadCombinationId;
  if (!activeId) return null;
  return getLoadCombinations(model).find((combo) => combo.id === activeId) ?? null;
}

export function getLoadCaseIdForLoad(
  load: Pick<NodalLoad | MemberLoad | PrescribedDisplacement, 'loadCaseId'>,
  model: ProjectModel
): LoadCaseId {
  const cases = getLoadCases(model);
  const fallback = cases[0]!.id;
  return load.loadCaseId && cases.some((loadCase) => loadCase.id === load.loadCaseId)
    ? load.loadCaseId
    : fallback;
}

/** Load-carrying part of a model for one analysis target. */
type LoadSet = Pick<ProjectModel, 'nodalLoads' | 'memberLoads' | 'prescribedDisplacements'>;

function loadSetForCase(model: ProjectModel, loadCaseId: LoadCaseId): LoadSet {
  const inCase = (load: Pick<NodalLoad, 'loadCaseId'>) =>
    getLoadCaseIdForLoad(load, model) === loadCaseId;
  return {
    nodalLoads: model.nodalLoads.filter(inCase),
    memberLoads: model.memberLoads.filter(inCase),
    prescribedDisplacements: (model.prescribedDisplacements ?? []).filter(inCase),
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
  if (target.type === 'loadCase') {
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
