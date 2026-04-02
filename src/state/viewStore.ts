import { create } from 'zustand';

export type DisplayMode = 'model' | 'deformation' | 'N' | 'Vy' | 'Vz' | 'Mx' | 'My' | 'Mz';
export type EditTool = 'select' | 'addNode' | 'addMember' | 'setSupport' | 'addNodalLoad' | 'addMemberLoad';
export type Theme = 'dark' | 'light';

interface ViewState {
  displayMode: DisplayMode;
  editTool: EditTool;
  theme: Theme;
  showNodeLabels: boolean;
  showMemberLabels: boolean;
  showLoads: boolean;
  showSupports: boolean;
  deformationScale: number;
  diagramScale: number;
  setDisplayMode: (mode: DisplayMode) => void;
  setEditTool: (tool: EditTool) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setShowNodeLabels: (v: boolean) => void;
  setShowMemberLabels: (v: boolean) => void;
  setShowLoads: (v: boolean) => void;
  setShowSupports: (v: boolean) => void;
  setDeformationScale: (v: number) => void;
  setDiagramScale: (v: number) => void;
}

function loadTheme(): Theme {
  try {
    const v = localStorage.getItem('theme');
    if (v === 'light' || v === 'dark') return v;
  } catch { /* ignore */ }
  return 'dark';
}

function saveTheme(theme: Theme) {
  try { localStorage.setItem('theme', theme); } catch { /* ignore */ }
}

export const useViewStore = create<ViewState>((set) => ({
  displayMode: 'model',
  editTool: 'select',
  theme: loadTheme(),
  showNodeLabels: true,
  showMemberLabels: true,
  showLoads: true,
  showSupports: true,
  deformationScale: 50,
  diagramScale: 1,
  setDisplayMode: (mode) => set({ displayMode: mode }),
  setEditTool: (tool) => set({ editTool: tool }),
  setTheme: (theme) => { saveTheme(theme); set({ theme }); },
  toggleTheme: () => set((s) => { const next = s.theme === 'dark' ? 'light' : 'dark'; saveTheme(next); return { theme: next }; }),
  setShowNodeLabels: (v) => set({ showNodeLabels: v }),
  setShowMemberLabels: (v) => set({ showMemberLabels: v }),
  setShowLoads: (v) => set({ showLoads: v }),
  setShowSupports: (v) => set({ showSupports: v }),
  setDeformationScale: (v) => set({ deformationScale: v }),
  setDiagramScale: (v) => set({ diagramScale: v }),
}));
