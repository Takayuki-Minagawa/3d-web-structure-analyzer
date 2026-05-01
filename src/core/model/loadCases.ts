import type {
  LoadCase,
  LoadCombination,
  LoadCaseId,
  MemberLoad,
  NodalLoad,
  ProjectModel,
} from './types';

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
  load: Pick<NodalLoad | MemberLoad, 'loadCaseId'>,
  model: ProjectModel
): LoadCaseId {
  const cases = getLoadCases(model);
  const fallback = cases[0]!.id;
  return load.loadCaseId && cases.some((loadCase) => loadCase.id === load.loadCaseId)
    ? load.loadCaseId
    : fallback;
}

export function resolveAnalysisLoadModel(model: ProjectModel): ProjectModel {
  const activeCombination = getActiveLoadCombination(model);
  if (!activeCombination) {
    const activeLoadCaseId = getActiveLoadCaseId(model);
    return {
      ...model,
      nodalLoads: model.nodalLoads.filter(
        (load) => getLoadCaseIdForLoad(load, model) === activeLoadCaseId
      ),
      memberLoads: model.memberLoads.filter(
        (load) => getLoadCaseIdForLoad(load, model) === activeLoadCaseId
      ),
    };
  }

  return {
    ...model,
    nodalLoads: expandNodalLoadsForCombination(model, activeCombination),
    memberLoads: expandMemberLoadsForCombination(model, activeCombination),
  };
}

export function getActiveLoadTargetName(model: ProjectModel): string {
  const activeCombination = getActiveLoadCombination(model);
  if (activeCombination) return activeCombination.name;
  const activeLoadCaseId = getActiveLoadCaseId(model);
  return getLoadCases(model).find((loadCase) => loadCase.id === activeLoadCaseId)?.name
    ?? DEFAULT_LOAD_CASE.name;
}

function expandNodalLoadsForCombination(
  model: ProjectModel,
  combination: LoadCombination
): NodalLoad[] {
  const loads: NodalLoad[] = [];
  for (const term of combination.factors) {
    if (term.factor === 0) continue;
    for (const load of model.nodalLoads) {
      if (getLoadCaseIdForLoad(load, model) !== term.loadCaseId) continue;
      loads.push(scaleNodalLoad(load, term.loadCaseId, term.factor));
    }
  }
  return loads;
}

function expandMemberLoadsForCombination(
  model: ProjectModel,
  combination: LoadCombination
): MemberLoad[] {
  const loads: MemberLoad[] = [];
  for (const term of combination.factors) {
    if (term.factor === 0) continue;
    for (const load of model.memberLoads) {
      if (getLoadCaseIdForLoad(load, model) !== term.loadCaseId) continue;
      loads.push(scaleMemberLoad(load, term.loadCaseId, term.factor));
    }
  }
  return loads;
}

function scaleNodalLoad(
  load: NodalLoad,
  loadCaseId: LoadCaseId,
  factor: number
): NodalLoad {
  return {
    ...load,
    id: `${load.id}@${loadCaseId}*${factor}`,
    fx: load.fx * factor,
    fy: load.fy * factor,
    fz: load.fz * factor,
    mx: load.mx * factor,
    my: load.my * factor,
    mz: load.mz * factor,
  };
}

function scaleMemberLoad(
  load: MemberLoad,
  loadCaseId: LoadCaseId,
  factor: number
): MemberLoad {
  const id = `${load.id}@${loadCaseId}*${factor}`;
  if (load.type === 'point' || load.type === 'udl') {
    return {
      ...load,
      id,
      value: load.value * factor,
    };
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
