import { create } from 'zustand';

export type DisplayMode = 'model' | 'deformation' | 'modeShape' | 'N' | 'Vy' | 'Vz' | 'Mx' | 'My' | 'Mz';
export type ForceDiagramMode = Exclude<DisplayMode, 'model' | 'deformation' | 'modeShape'>;
export type ResultsTab = 'displacements' | 'reactions' | 'endForces' | 'modal' | 'buckling';
/** Which eigenmode the viewport shows in `modeShape` display mode. */
export interface ShapeView {
  kind: 'modal' | 'buckling';
  index: number;
}
export type EigenDivisions = 'auto' | 1 | 2 | 4 | 8;

export function isForceDiagramMode(mode: DisplayMode): mode is ForceDiagramMode {
  return mode !== 'model' && mode !== 'deformation' && mode !== 'modeShape';
}
export type EditTool = 'select' | 'addNode' | 'addMember' | 'setSupport' | 'addNodalLoad' | 'addMemberLoad';
export type Theme = 'dark' | 'light';
export type LabelMode = 'all' | 'auto' | 'selected';
export type WorkPlaneAxis = 'xy' | 'xz' | 'yz';

interface ViewState {
  displayMode: DisplayMode;
  editTool: EditTool;
  theme: Theme;
  showNodeLabels: boolean;
  showMemberLabels: boolean;
  showLoads: boolean;
  showSupports: boolean;
  labelMode: LabelMode;
  animateDeformation: boolean;
  gridSnap: boolean;
  gridSize: number;
  deformationScale: number;
  /** Peak mode-shape amplitude as a multiple of 10 % of the model extent. */
  modeShapeScale: number;
  diagramScale: number;
  workPlaneAxis: WorkPlaneAxis;
  workPlaneOffset: number;
  resultsTab: ResultsTab;
  shapeView: ShapeView | null;
  eigenModeCount: number;
  eigenDivisions: EigenDivisions;
  setDisplayMode: (mode: DisplayMode) => void;
  setEditTool: (tool: EditTool) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setShowNodeLabels: (v: boolean) => void;
  setShowMemberLabels: (v: boolean) => void;
  setShowLoads: (v: boolean) => void;
  setShowSupports: (v: boolean) => void;
  setLabelMode: (v: LabelMode) => void;
  setAnimateDeformation: (v: boolean) => void;
  setGridSnap: (v: boolean) => void;
  setGridSize: (v: number) => void;
  setDeformationScale: (v: number) => void;
  setModeShapeScale: (v: number) => void;
  setDiagramScale: (v: number) => void;
  setWorkPlaneAxis: (axis: WorkPlaneAxis) => void;
  setWorkPlaneOffset: (offset: number) => void;
  setResultsTab: (tab: ResultsTab) => void;
  /** Bring the tab that will receive a run's result or error to the front. */
  focusResultsForRun: (kind: 'static' | 'modal' | 'buckling') => void;
  /** Select an eigenmode and switch the viewport to its shape. */
  showModeShape: (view: ShapeView) => void;
  setEigenModeCount: (count: number) => void;
  setEigenDivisions: (divisions: EigenDivisions) => void;
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
  labelMode: 'auto',
  animateDeformation: false,
  gridSnap: true,
  gridSize: 1,
  deformationScale: 50,
  modeShapeScale: 1,
  diagramScale: 1,
  workPlaneAxis: 'xy',
  workPlaneOffset: 0,
  resultsTab: 'displacements',
  shapeView: null,
  eigenModeCount: 6,
  eigenDivisions: 'auto',
  setDisplayMode: (mode) => set({ displayMode: mode }),
  setEditTool: (tool) => set({ editTool: tool }),
  setTheme: (theme) => { saveTheme(theme); set({ theme }); },
  toggleTheme: () => set((s) => { const next = s.theme === 'dark' ? 'light' : 'dark'; saveTheme(next); return { theme: next }; }),
  setShowNodeLabels: (v) => set({ showNodeLabels: v }),
  setShowMemberLabels: (v) => set({ showMemberLabels: v }),
  setShowLoads: (v) => set({ showLoads: v }),
  setShowSupports: (v) => set({ showSupports: v }),
  setLabelMode: (v) => set({ labelMode: v }),
  setAnimateDeformation: (v) => set({ animateDeformation: v }),
  setGridSnap: (v) => set({ gridSnap: v }),
  setGridSize: (v) => set({ gridSize: Math.max(v, 0.001) }),
  setDeformationScale: (v) => set({ deformationScale: v }),
  setModeShapeScale: (v) => set({ modeShapeScale: Math.max(0, Number.isFinite(v) ? v : 1) }),
  setDiagramScale: (v) => set({ diagramScale: v }),
  setWorkPlaneAxis: (axis) => set({ workPlaneAxis: axis }),
  setWorkPlaneOffset: (offset) => set({ workPlaneOffset: Number.isFinite(offset) ? offset : 0 }),
  setResultsTab: (tab) => set({ resultsTab: tab }),
  focusResultsForRun: (kind) => set((s) => {
    if (kind !== 'static') return { resultsTab: kind };
    return s.resultsTab === 'modal' || s.resultsTab === 'buckling'
      ? { resultsTab: 'displacements' }
      : {};
  }),
  showModeShape: (view) => set({ shapeView: view, displayMode: 'modeShape', resultsTab: view.kind }),
  setEigenModeCount: (count) => set({
    eigenModeCount: Math.max(1, Math.min(30, Math.floor(Number.isFinite(count) ? count : 6))),
  }),
  setEigenDivisions: (divisions) => set({ eigenDivisions: divisions }),
}));
