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
} from '../core/model/types';
import type { WorkerResponse } from '../worker/protocol';
import type { FrameJsonDocument } from '../io/frameJsonTypes';
import { parseFrameJsonText, isFrameJsonFormat } from '../io/frameJsonParser';
import { convertFrameJson } from '../io/frameJsonConverter';

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

const DEFAULT_RESTRAINT: Restraint = {
  ux: false, uy: false, uz: false,
  rx: false, ry: false, rz: false,
};

function createDefaultModel(): ProjectModel {
  const matId = generateId();
  return {
    title: '',
    nodes: [],
    materials: [
      { id: matId, name: 'Steel', E: 20500, G: 7900, nu: 0.3, expansion: 0.000012 },
    ],
    sections: [
      { id: generateId(), name: 'Default', materialId: matId, A: 100, Ix: 1000, Iy: 500, Iz: 500, ky: 0, kz: 0 },
    ],
    springs: [],
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

  // Node operations
  addNode: (x: number, y: number, z: number) => string;
  updateNode: (id: string, updates: Partial<Pick<StructuralNode, 'x' | 'y' | 'z' | 'restraint'>>) => void;
  removeNode: (id: string) => void;

  // Member operations
  addMember: (ni: string, nj: string) => string;
  updateMember: (id: string, updates: Partial<Pick<Member, 'sectionId' | 'codeAngle'>>) => void;
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
  addMemberLoad: (load: Omit<MemberLoad, 'id'>) => string;
  updateMemberLoad: (id: string, updates: Partial<Omit<MemberLoad, 'id'>>) => void;
  removeMemberLoad: (id: string) => void;

  // Coupling operations
  addCoupling: (c: Omit<CouplingConstraint, 'id'>) => string;
  updateCoupling: (id: string, updates: Partial<Omit<CouplingConstraint, 'id'>>) => void;
  removeCoupling: (id: string) => void;

  // Analysis
  setAnalyzing: (v: boolean) => void;
  setAnalysisResult: (resp: WorkerResponse) => void;
  markResultStale: () => void;

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

  addNode: (x, y, z) => {
    const id = generateId();
    set((s) => ({
      model: {
        ...s.model,
        nodes: [...s.model.nodes, { id, x, y, z, restraint: { ...DEFAULT_RESTRAINT } }],
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
          n.id === id ? { ...n, ...updates } : n
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
          m.id === id ? { ...m, ...updates } : m
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
        nodalLoads: [...s.model.nodalLoads, { ...load, id }],
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
        memberLoads: [...s.model.memberLoads, { ...load, id } as MemberLoad],
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

  loadModel: (model) => set({
    model,
    analysisResult: null,
    analysisError: null,
    isResultStale: false,
  }),

  importFrameJson: (text, loadCaseIndex) => {
    const doc = parseFrameJsonText(text);
    const model = convertFrameJson(doc, loadCaseIndex);
    set({
      model,
      analysisResult: null,
      analysisError: null,
      isResultStale: false,
    });
  },

  importJsonAuto: (text) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Invalid JSON');
    }

    if (isFrameJsonFormat(parsed)) {
      // FrameJsonDocument format
      const doc = parseFrameJsonText(text);
      const model = convertFrameJson(doc);
      set({
        model,
        analysisResult: null,
        analysisError: null,
        isResultStale: false,
      });
    } else {
      // Try legacy ProjectFile format
      const pf = parsed as { model?: ProjectModel };
      if (pf.model) {
        set({
          model: pf.model,
          analysisResult: null,
          analysisError: null,
          isResultStale: false,
        });
      } else {
        throw new Error('Unrecognized JSON format');
      }
    }
  },

  resetModel: () => set({
    model: createDefaultModel(),
    analysisResult: null,
    analysisError: null,
    isResultStale: false,
  }),

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
