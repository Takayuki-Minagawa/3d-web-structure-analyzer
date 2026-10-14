import {
  getActiveLoadCaseId,
  getAnalysisTargets,
  getLoadCases,
  getLoadCombinations,
  resolveLoadTargetModel,
} from '../core/model/loadCases';
import type { AnalysisTarget, ProjectModel } from '../core/model/types';

export type ViewportLoadSelection =
  | { kind: 'editing' }
  | { kind: 'target'; target: AnalysisTarget }
  | { kind: 'envelope'; bound: 'min' | 'max' }
  | { kind: 'all' };

export interface LoadPresentation {
  model: ProjectModel | null;
  /** Case names, stable IDs and all signed combination factors, without a translated prefix. */
  caption: string;
}

function caseCaption(model: ProjectModel, caseId: string): string {
  const name = getLoadCases(model).find((item) => item.id === caseId)?.name ?? caseId;
  return `${name} [${caseId}]`;
}

export function loadTargetCaption(model: ProjectModel, target: AnalysisTarget): string {
  if (target.type === 'loadCase') return caseCaption(model, target.id);
  const combination = getLoadCombinations(model).find((item) => item.id === target.id);
  if (!combination) return `${target.name} [${target.id}]`;
  const terms = combination.factors.map((term, index) => {
    const sign = term.factor < 0 ? '−' : index > 0 ? '+' : '';
    return `${sign}${index > 0 ? ' ' : ''}${Math.abs(term.factor)} × ${caseCaption(model, term.loadCaseId)}`;
  }).join(' ');
  return `${combination.name} [${combination.id}] = ${terms || '0'}`;
}

/** A viewport always represents one explicit load state, except the opt-in all-case overlay. */
export function resolveViewportLoads(model: ProjectModel, selection: ViewportLoadSelection): LoadPresentation {
  if (selection.kind === 'envelope') return { model: null, caption: selection.bound };
  if (selection.kind === 'all') {
    return { model, caption: getLoadCases(model).map((item) => caseCaption(model, item.id)).join(' / ') };
  }
  const target = selection.kind === 'target' ? selection.target
    : getAnalysisTargets(model).find((item) => item.type === 'loadCase' && item.id === getActiveLoadCaseId(model))!;
  return { model: resolveLoadTargetModel(model, target), caption: loadTargetCaption(model, target) };
}
