import { create } from 'zustand';
import type {
  ProjectModel,
  StructuralNode,
  Member,
  Material,
  Section,
  NodalLoad,
  MemberLoad,
  DiagramPoint,
  AnalysisError,
} from '../core/model/types';
import type { WorkerResponse } from '../worker/protocol';

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

const forceBase: Record<string, number> = { N: 1, kN: 1000 };
const lengthBase: Record<string, number> = { mm: 0.001, cm: 0.01, m: 1 };

function createDefaultModel(): ProjectModel {
  return {
    nodes: [],
    materials: [
      { id: generateId(), name: 'Steel', E: 205000, nu: 0.3 },
    ],
    sections: [
      { id: generateId(), name: 'Default', A: 0.01, I: 1e-4, As: 0.005 },
    ],
    members: [],
    nodalLoads: [],
    memberLoads: [],
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
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
  addNode: (x: number, y: number) => string;
  updateNode: (id: string, updates: Partial<Pick<StructuralNode, 'x' | 'y' | 'restraint'>>) => void;
  removeNode: (id: string) => void;

  // Member operations
  addMember: (ni: string, nj: string) => string;
  updateMember: (id: string, updates: Partial<Pick<Member, 'materialId' | 'sectionId'>>) => void;
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

  // Analysis
  setAnalyzing: (v: boolean) => void;
  setAnalysisResult: (resp: WorkerResponse) => void;
  markResultStale: () => void;

  // Project
  loadModel: (model: ProjectModel) => void;
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

  addNode: (x, y) => {
    const id = generateId();
    set((s) => ({
      model: {
        ...s.model,
        nodes: [...s.model.nodes, { id, x, y, restraint: { ux: false, uy: false, rz: false } }],
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
    const { materials, sections } = get().model;
    const materialId = materials[0]?.id ?? '';
    const sectionId = sections[0]?.id ?? '';
    set((s) => ({
      model: {
        ...s.model,
        members: [...s.model.members, { id, ni, nj, materialId, sectionId }],
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
    model: {
      ...model,
      units: model.units ?? { force: 'kN', length: 'm', moment: 'kN·m' },
    },
    analysisResult: null,
    analysisError: null,
    isResultStale: false,
  }),

  resetModel: () => set({
    model: createDefaultModel(),
    analysisResult: null,
    analysisError: null,
    isResultStale: false,
  }),

  updateUnits: (updates) => {
    set((s) => {
      const oldForce = s.model.units.force;
      const oldLength = s.model.units.length;
      const newForce = updates.force ?? oldForce;
      const newLength = updates.length ?? oldLength;

      // Conversion factors: old → new
      const fF = (forceBase[oldForce] ?? 1) / (forceBase[newForce] ?? 1);
      const fL = (lengthBase[oldLength] ?? 1) / (lengthBase[newLength] ?? 1);
      const fL2 = fL * fL;
      const fL4 = fL2 * fL2;

      const newUnits = {
        force: newForce,
        length: newLength,
        moment: `${newForce}·${newLength}`,
      };

      // Skip conversion if no actual change
      if (fF === 1 && fL === 1) {
        return { model: { ...s.model, units: newUnits }, isResultStale: true };
      }

      const nodes = s.model.nodes.map((n) => ({
        ...n,
        x: n.x * fL,
        y: n.y * fL,
      }));

      const materials = s.model.materials.map((m) => ({
        ...m,
        E: m.E * fF / fL2,
      }));

      const sections = s.model.sections.map((sec) => ({
        ...sec,
        A: sec.A * fL2,
        I: sec.I * fL4,
      }));

      const nodalLoads = s.model.nodalLoads.map((l) => ({
        ...l,
        fx: l.fx * fF,
        fy: l.fy * fF,
        mz: l.mz * fF * fL,
      }));

      const memberLoads = s.model.memberLoads.map((l) => {
        if (l.type === 'point') {
          return { ...l, value: l.value * fF, a: l.a * fL };
        }
        // UDL: force per unit length
        return { ...l, value: l.value * fF / fL };
      }) as MemberLoad[];

      return {
        model: {
          ...s.model,
          nodes,
          materials,
          sections,
          nodalLoads,
          memberLoads,
          units: newUnits,
        },
        isResultStale: true,
      };
    });
  },
}));
