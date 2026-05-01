import { create } from 'zustand';
import type {
  ProjectModel,
  StructuralNode,
  Member,
  Material,
  Section,
  NodalLoad,
  MemberLoad,
  CouplingConstraint,
  DiagramPoint,
  AnalysisError,
  Restraint,
  AnalysisMode,
  LoadCase,
  LoadCombination,
} from '../core/model/types';
import type { WorkerResponse } from '../worker/protocol';
import { parseFrameJsonText, isFrameJsonFormat } from '../io/frameJsonParser';
import { convertFrameJson } from '../io/frameJsonConverter';
import {
  DEFAULT_ANALYSIS_MODE,
  XZ_2D_MODE,
  findNodesOffXzPlane,
  getAnalysisMode,
  isXz2dMode,
} from '../core/model/analysisMode';
import {
  DEFAULT_TORSION_RESTRAINT,
  normalizeTorsionRestraint,
} from '../core/model/torsionRestraint';
import {
  DEFAULT_LOAD_CASE,
  getActiveLoadCaseId,
  getLoadCases,
  getLoadCombinations,
} from '../core/model/loadCases';

/** Distributive Omit that works correctly with union types */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

const DEFAULT_RESTRAINT: Restraint = {
  ux: false, uy: false, uz: false,
  rx: false, ry: false, rz: false,
};

export type AnalysisModeUpdateResult =
  | { ok: true }
  | { ok: false; error: string; nodeIds: string[] };

function normalizeProjectModel(model: ProjectModel): ProjectModel {
  const loadCases = getLoadCases(model);
  const loadCaseIds = new Set(loadCases.map((loadCase) => loadCase.id));
  const fallbackLoadCaseId = loadCases[0]!.id;
  const activeLoadCaseId = model.activeLoadCaseId && loadCaseIds.has(model.activeLoadCaseId)
    ? model.activeLoadCaseId
    : fallbackLoadCaseId;
  const loadCombinations = getLoadCombinations(model).map((combo) => ({
    ...combo,
    factors: combo.factors.filter((factor) => loadCaseIds.has(factor.loadCaseId)),
  }));
  const activeLoadCombinationId = model.activeLoadCombinationId &&
    loadCombinations.some((combo) => combo.id === model.activeLoadCombinationId)
    ? model.activeLoadCombinationId
    : null;

  // Idempotently fills defaults for older persisted/imported project files.
  return {
    ...model,
    analysisMode: model.analysisMode ?? DEFAULT_ANALYSIS_MODE,
    springs: model.springs ?? [],
    loadCases,
    loadCombinations,
    activeLoadCaseId,
    activeLoadCombinationId,
    members: (model.members ?? []).map((member) => ({
      ...member,
      iSprings: member.iSprings ?? { x: 0, y: 0, z: 0 },
      jSprings: member.jSprings ?? { x: 0, y: 0, z: 0 },
      torsionRestraint: normalizeTorsionRestraint(member.torsionRestraint),
    })),
    couplings: model.couplings ?? [],
    nodalLoads: (model.nodalLoads ?? []).map((load) => ({
      ...load,
      loadCaseId: load.loadCaseId && loadCaseIds.has(load.loadCaseId)
        ? load.loadCaseId
        : fallbackLoadCaseId,
    })),
    memberLoads: (model.memberLoads ?? []).map((load) => ({
      ...load,
      loadCaseId: load.loadCaseId && loadCaseIds.has(load.loadCaseId)
        ? load.loadCaseId
        : fallbackLoadCaseId,
    })),
  };
}

function formatOffPlaneError(nodeIds: string[]): string {
  return `2D X-Z平面モードに切り替えるには、すべての節点のY座標を0にしてください。対象節点: ${nodeIds.join(', ')}`;
}

function createDefaultModel(): ProjectModel {
  const matId = generateId();
  return {
    title: '',
    analysisMode: DEFAULT_ANALYSIS_MODE,
    nodes: [],
    materials: [
      { id: matId, name: 'Steel', E: 20500, G: 7900, nu: 0.3, expansion: 0.000012 },
    ],
    sections: [
      { id: generateId(), name: 'Default', materialId: matId, A: 100, Ix: 1000, Iy: 500, Iz: 500, ky: 0, kz: 0 },
    ],
    springs: [],
    loadCases: [DEFAULT_LOAD_CASE],
    loadCombinations: [],
    activeLoadCaseId: DEFAULT_LOAD_CASE.id,
    activeLoadCombinationId: null,
    members: [],
    couplings: [],
    nodalLoads: [],
    memberLoads: [],
    units: { force: 'kN', length: 'cm', moment: 'kN·cm' },
  };
}

export interface AnalysisResult {
  displacements: number[];
  reactions: number[];
  elementEndForces: Record<string, number[]>;
  diagrams: Record<string, { memberId: string; points: DiagramPoint[] }>;
  warnings: string[];
}

interface ProjectState {
  model: ProjectModel;
  analysisResult: AnalysisResult | null;
  analysisError: AnalysisError | null;
  isAnalyzing: boolean;
  isResultStale: boolean;
  /** Incremented when a full model load occurs and the view should fit to new content. */
  fitViewVersion: number;

  // Node operations
  addNode: (x: number, y: number, z: number) => string;
  updateNode: (id: string, updates: Partial<Pick<StructuralNode, 'x' | 'y' | 'z' | 'restraint'>>) => void;
  removeNode: (id: string) => void;

  // Member operations
  addMember: (ni: string, nj: string) => string;
  updateMember: (id: string, updates: Partial<Pick<Member, 'sectionId' | 'codeAngle' | 'torsionRestraint'>>) => void;
  removeMember: (id: string) => void;

  // Material operations
  addMaterial: (mat: Omit<Material, 'id'>) => string;
  updateMaterial: (id: string, updates: Partial<Omit<Material, 'id'>>) => void;
  removeMaterial: (id: string) => void;

  // Section operations
  addSection: (sec: Omit<Section, 'id'>) => string;
  updateSection: (id: string, updates: Partial<Omit<Section, 'id'>>) => void;
  removeSection: (id: string) => void;

  // Load operations
  addNodalLoad: (load: Omit<NodalLoad, 'id'>) => string;
  updateNodalLoad: (id: string, updates: Partial<Omit<NodalLoad, 'id'>>) => void;
  removeNodalLoad: (id: string) => void;
  addMemberLoad: (load: DistributiveOmit<MemberLoad, 'id'>) => string;
  updateMemberLoad: (id: string, updates: Partial<DistributiveOmit<MemberLoad, 'id'>>) => void;
  removeMemberLoad: (id: string) => void;

  // Load cases
  addLoadCase: (name?: string) => string;
  updateLoadCase: (id: string, updates: Partial<Omit<LoadCase, 'id'>>) => void;
  removeLoadCase: (id: string) => void;
  setActiveLoadCase: (id: string) => void;
  addLoadCombination: (name?: string) => string;
  updateLoadCombination: (id: string, updates: Partial<Omit<LoadCombination, 'id'>>) => void;
  removeLoadCombination: (id: string) => void;
  setActiveLoadCombination: (id: string | null) => void;

  // Coupling operations
  addCoupling: (c: Omit<CouplingConstraint, 'id'>) => string;
  updateCoupling: (id: string, updates: Partial<Omit<CouplingConstraint, 'id'>>) => void;
  removeCoupling: (id: string) => void;

  // Analysis
  setAnalyzing: (v: boolean) => void;
  setAnalysisResult: (resp: WorkerResponse) => void;
  markResultStale: () => void;
  setAnalysisMode: (mode: AnalysisMode) => AnalysisModeUpdateResult;
  flattenNodesToXzPlane: () => string[];

  // Project
  loadModel: (model: ProjectModel) => void;
  importFrameJson: (text: string, loadCaseIndex?: number) => void;
  importJsonAuto: (text: string) => void;
  resetModel: () => void;

  // Units
  updateUnits: (updates: Partial<ProjectModel['units']>) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  model: createDefaultModel(),
  analysisResult: null,
  analysisError: null,
  isAnalyzing: false,
  isResultStale: false,
  fitViewVersion: 0,

  addNode: (x, y, z) => {
    const id = generateId();
    set((s) => ({
      model: {
        ...s.model,
        nodes: [
          ...s.model.nodes,
          { id, x, y: isXz2dMode(s.model) ? 0 : y, z, restraint: { ...DEFAULT_RESTRAINT } },
        ],
      },
      isResultStale: true,
    }));
    return id;
  },

  updateNode: (id, updates) => {
    set((s) => ({
      model: {
        ...s.model,
        nodes: s.model.nodes.map((n) =>
          n.id === id
            ? { ...n, ...updates, ...(isXz2dMode(s.model) ? { y: 0 } : {}) }
            : n
        ),
      },
      isResultStale: true,
    }));
  },

  removeNode: (id) => {
    set((s) => {
      const removedMemberIds = new Set(
        s.model.members.filter((m) => m.ni === id || m.nj === id).map((m) => m.id)
      );
      return {
        model: {
          ...s.model,
          nodes: s.model.nodes.filter((n) => n.id !== id),
          members: s.model.members.filter((m) => m.ni !== id && m.nj !== id),
          nodalLoads: s.model.nodalLoads.filter((l) => l.nodeId !== id),
          memberLoads: s.model.memberLoads.filter((l) => !removedMemberIds.has(l.memberId)),
          couplings: s.model.couplings.filter((c) => c.masterNodeId !== id && c.slaveNodeId !== id),
        },
        isResultStale: true,
      };
    });
  },

  addMember: (ni, nj) => {
    const id = generateId();
    const { sections } = get().model;
    const sectionId = sections[0]?.id ?? '';
    set((s) => ({
      model: {
        ...s.model,
        members: [...s.model.members, {
          id, ni, nj, sectionId,
          codeAngle: 0,
          iSprings: { x: 0, y: 0, z: 0 },
          jSprings: { x: 0, y: 0, z: 0 },
          torsionRestraint: DEFAULT_TORSION_RESTRAINT,
        }],
      },
      isResultStale: true,
    }));
    return id;
  },

  updateMember: (id, updates) => {
    set((s) => ({
      model: {
        ...s.model,
        members: s.model.members.map((m) =>
          m.id === id
            ? {
                ...m,
                ...updates,
                torsionRestraint: updates.torsionRestraint !== undefined
                  ? normalizeTorsionRestraint(updates.torsionRestraint)
                  : normalizeTorsionRestraint(m.torsionRestraint),
              }
            : m
        ),
      },
      isResultStale: true,
    }));
  },

  removeMember: (id) => {
    set((s) => ({
      model: {
        ...s.model,
        members: s.model.members.filter((m) => m.id !== id),
        memberLoads: s.model.memberLoads.filter((l) => l.memberId !== id),
      },
      isResultStale: true,
    }));
  },

  addMaterial: (mat) => {
    const id = generateId();
    set((s) => ({
      model: {
        ...s.model,
        materials: [...s.model.materials, { ...mat, id }],
      },
    }));
    return id;
  },

  updateMaterial: (id, updates) => {
    set((s) => ({
      model: {
        ...s.model,
        materials: s.model.materials.map((m) =>
          m.id === id ? { ...m, ...updates } : m
        ),
      },
      isResultStale: true,
    }));
  },

  removeMaterial: (id) => {
    set((s) => ({
      model: {
        ...s.model,
        materials: s.model.materials.filter((m) => m.id !== id),
      },
    }));
  },

  addSection: (sec) => {
    const id = generateId();
    set((s) => ({
      model: {
        ...s.model,
        sections: [...s.model.sections, { ...sec, id }],
      },
    }));
    return id;
  },

  updateSection: (id, updates) => {
    set((s) => ({
      model: {
        ...s.model,
        sections: s.model.sections.map((sec) =>
          sec.id === id ? { ...sec, ...updates } : sec
        ),
      },
      isResultStale: true,
    }));
  },

  removeSection: (id) => {
    set((s) => ({
      model: {
        ...s.model,
        sections: s.model.sections.filter((sec) => sec.id !== id),
      },
    }));
  },

  addNodalLoad: (load) => {
    const id = generateId();
    set((s) => ({
      model: {
        ...s.model,
        nodalLoads: [
          ...s.model.nodalLoads,
          { ...load, id, loadCaseId: load.loadCaseId ?? getActiveLoadCaseId(s.model) },
        ],
      },
      isResultStale: true,
    }));
    return id;
  },

  updateNodalLoad: (id, updates) => {
    set((s) => ({
      model: {
        ...s.model,
        nodalLoads: s.model.nodalLoads.map((l) =>
          l.id === id ? { ...l, ...updates } : l
        ),
      },
      isResultStale: true,
    }));
  },

  removeNodalLoad: (id) => {
    set((s) => ({
      model: {
        ...s.model,
        nodalLoads: s.model.nodalLoads.filter((l) => l.id !== id),
      },
      isResultStale: true,
    }));
  },

  addMemberLoad: (load) => {
    const id = generateId();
    set((s) => ({
      model: {
        ...s.model,
        memberLoads: [
          ...s.model.memberLoads,
          { ...load, id, loadCaseId: load.loadCaseId ?? getActiveLoadCaseId(s.model) } as MemberLoad,
        ],
      },
      isResultStale: true,
    }));
    return id;
  },

  updateMemberLoad: (id, updates) => {
    set((s) => ({
      model: {
        ...s.model,
        memberLoads: s.model.memberLoads.map((l) =>
          l.id === id ? { ...l, ...updates } as MemberLoad : l
        ),
      },
      isResultStale: true,
    }));
  },

  removeMemberLoad: (id) => {
    set((s) => ({
      model: {
        ...s.model,
        memberLoads: s.model.memberLoads.filter((l) => l.id !== id),
      },
      isResultStale: true,
    }));
  },

  addLoadCase: (name) => {
    const id = generateId();
    set((s) => ({
      model: {
        ...s.model,
        loadCases: [...getLoadCases(s.model), { id, name: name ?? 'New Case' }],
        loadCombinations: getLoadCombinations(s.model).map((combo) => ({
          ...combo,
          factors: [...combo.factors, { loadCaseId: id, factor: 0 }],
        })),
        activeLoadCaseId: id,
        activeLoadCombinationId: null,
      },
      isResultStale: true,
    }));
    return id;
  },

  updateLoadCase: (id, updates) => {
    set((s) => ({
      model: {
        ...s.model,
        loadCases: getLoadCases(s.model).map((loadCase) =>
          loadCase.id === id ? { ...loadCase, ...updates } : loadCase
        ),
      },
      isResultStale: true,
    }));
  },

  removeLoadCase: (id) => {
    set((s) => {
      const cases = getLoadCases(s.model);
      if (cases.length <= 1) return {};
      const remainingCases = cases.filter((loadCase) => loadCase.id !== id);
      const fallbackId = remainingCases[0]!.id;
      const combinations = getLoadCombinations(s.model).map((combo) => ({
        ...combo,
        factors: combo.factors.filter((factor) => factor.loadCaseId !== id),
      }));
      const nextActiveCombinationId = s.model.activeLoadCombinationId &&
        combinations.some((combo) => combo.id === s.model.activeLoadCombinationId)
        ? s.model.activeLoadCombinationId
        : null;
      const nextActiveLoadCaseId = s.model.activeLoadCaseId &&
        s.model.activeLoadCaseId !== id
        ? s.model.activeLoadCaseId
        : fallbackId;

      return {
        model: {
          ...s.model,
          loadCases: remainingCases,
          activeLoadCaseId: nextActiveLoadCaseId,
          activeLoadCombinationId: nextActiveCombinationId,
          loadCombinations: combinations,
          nodalLoads: s.model.nodalLoads.map((load) =>
            load.loadCaseId === id ? { ...load, loadCaseId: fallbackId } : load
          ),
          memberLoads: s.model.memberLoads.map((load) =>
            load.loadCaseId === id ? { ...load, loadCaseId: fallbackId } as MemberLoad : load
          ),
        },
        isResultStale: true,
      };
    });
  },

  setActiveLoadCase: (id) => {
    set((s) => ({
      model: {
        ...s.model,
        activeLoadCaseId: id,
        activeLoadCombinationId: null,
      },
      isResultStale: true,
    }));
  },

  addLoadCombination: (name) => {
    const id = generateId();
    set((s) => ({
      model: {
        ...s.model,
        loadCombinations: [
          ...getLoadCombinations(s.model),
          {
            id,
            name: name ?? 'New Combination',
            factors: getLoadCases(s.model).map((loadCase) => ({
              loadCaseId: loadCase.id,
              factor: loadCase.id === getActiveLoadCaseId(s.model) ? 1 : 0,
            })),
          },
        ],
        activeLoadCombinationId: id,
      },
      isResultStale: true,
    }));
    return id;
  },

  updateLoadCombination: (id, updates) => {
    set((s) => ({
      model: {
        ...s.model,
        loadCombinations: getLoadCombinations(s.model).map((combo) =>
          combo.id === id ? { ...combo, ...updates } : combo
        ),
      },
      isResultStale: true,
    }));
  },

  removeLoadCombination: (id) => {
    set((s) => ({
      model: {
        ...s.model,
        loadCombinations: getLoadCombinations(s.model).filter((combo) => combo.id !== id),
        activeLoadCombinationId: s.model.activeLoadCombinationId === id
          ? null
          : s.model.activeLoadCombinationId ?? null,
      },
      isResultStale: true,
    }));
  },

  setActiveLoadCombination: (id) => {
    set((s) => ({
      model: {
        ...s.model,
        activeLoadCombinationId: id,
      },
      isResultStale: true,
    }));
  },

  addCoupling: (c) => {
    const id = generateId();
    set((s) => ({
      model: {
        ...s.model,
        couplings: [...(s.model.couplings ?? []), { ...c, id }],
      },
      isResultStale: true,
    }));
    return id;
  },

  updateCoupling: (id, updates) => {
    set((s) => ({
      model: {
        ...s.model,
        couplings: (s.model.couplings ?? []).map((c) =>
          c.id === id ? { ...c, ...updates } : c
        ),
      },
      isResultStale: true,
    }));
  },

  removeCoupling: (id) => {
    set((s) => ({
      model: {
        ...s.model,
        couplings: (s.model.couplings ?? []).filter((c) => c.id !== id),
      },
      isResultStale: true,
    }));
  },

  setAnalyzing: (v) => set({ isAnalyzing: v }),

  setAnalysisResult: (resp) => {
    if (resp.type === 'analyze-success') {
      set({
        analysisResult: {
          displacements: resp.displacements,
          reactions: resp.reactions,
          elementEndForces: resp.elementEndForces,
          diagrams: resp.diagrams,
          warnings: resp.warnings,
        },
        analysisError: null,
        isAnalyzing: false,
        isResultStale: false,
      });
    } else {
      set({
        analysisResult: null,
        analysisError: resp.error,
        isAnalyzing: false,
        isResultStale: false,
      });
    }
  },

  markResultStale: () => set({ isResultStale: true }),

  setAnalysisMode: (mode) => {
    if (mode === XZ_2D_MODE) {
      const offPlaneNodes = findNodesOffXzPlane(get().model);
      if (offPlaneNodes.length > 0) {
        const nodeIds = offPlaneNodes.map((node) => node.id);
        return { ok: false, error: formatOffPlaneError(nodeIds), nodeIds };
      }
    }

    if (getAnalysisMode(get().model) === mode) return { ok: true };

    set((s) => ({
      model: { ...s.model, analysisMode: mode },
      isResultStale: true,
    }));
    return { ok: true };
  },

  flattenNodesToXzPlane: () => {
    const offPlaneNodeIds = findNodesOffXzPlane(get().model).map((node) => node.id);
    if (offPlaneNodeIds.length === 0) return [];

    set((s) => ({
      model: {
        ...s.model,
        nodes: s.model.nodes.map((node) =>
          offPlaneNodeIds.includes(node.id) ? { ...node, y: 0 } : node
        ),
      },
      isResultStale: true,
    }));

    return offPlaneNodeIds;
  },

  loadModel: (model) => set((s) => ({
    model: normalizeProjectModel(model),
    analysisResult: null,
    analysisError: null,
    isResultStale: false,
    fitViewVersion: s.fitViewVersion + 1,
  })),

  importFrameJson: (text, loadCaseIndex) => {
    const doc = parseFrameJsonText(text);
    const model = convertFrameJson(doc, loadCaseIndex);
    set((s) => ({
      model: normalizeProjectModel(model),
      analysisResult: null,
      analysisError: null,
      isResultStale: false,
      fitViewVersion: s.fitViewVersion + 1,
    }));
  },

  importJsonAuto: (text) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON');
    }

    if (isFrameJsonFormat(parsed)) {
      const doc = parseFrameJsonText(text);
      const model = convertFrameJson(doc);
      set((s) => ({
        model: normalizeProjectModel(model),
        analysisResult: null,
        analysisError: null,
        isResultStale: false,
        fitViewVersion: s.fitViewVersion + 1,
      }));
    } else {
      const pf = parsed as { model?: ProjectModel };
      if (pf.model) {
        set((s) => ({
          model: normalizeProjectModel(pf.model!),
          analysisResult: null,
          analysisError: null,
          isResultStale: false,
          fitViewVersion: s.fitViewVersion + 1,
        }));
      } else {
        throw new Error('Unrecognized JSON format');
      }
    }
  },

  resetModel: () => set((s) => ({
    model: createDefaultModel(),
    analysisResult: null,
    analysisError: null,
    isResultStale: false,
    fitViewVersion: s.fitViewVersion + 1,
  })),

  updateUnits: (updates) => {
    set((s) => ({
      model: {
        ...s.model,
        units: { ...s.model.units, ...updates },
      },
      isResultStale: true,
    }));
  },
}));
