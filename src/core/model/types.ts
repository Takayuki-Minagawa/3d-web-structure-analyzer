// ── ID types ──
export type NodeId = string;
export type MemberId = string;
export type MaterialId = string;
export type SectionId = string;
export type SpringId = string;
export type LoadCaseId = string;
export type LoadCombinationId = string;
export type AnalysisMode = '3d' | 'xz2d' | 'xy2d' | 'yz2d';
export type TorsionRestraintEnd = 'none' | 'i' | 'j';

// ── Model entities ──
export interface Restraint {
  ux: boolean;
  uy: boolean;
  uz: boolean;
  rx: boolean;
  ry: boolean;
  rz: boolean;
}

export interface StructuralNode {
  id: NodeId;
  x: number;
  y: number;
  z: number;
  restraint: Restraint;
}

export interface Material {
  id: MaterialId;
  name: string;
  E: number;   // Young's modulus
  G: number;   // Shear modulus
  nu: number;  // Poisson's ratio
  expansion: number; // Thermal expansion coefficient
}

export interface Section {
  id: SectionId;
  name: string;
  materialId: MaterialId;
  A: number;   // Cross-sectional area
  Ix: number;  // Torsional moment of inertia
  Iy: number;  // Second moment of area about local Y
  Iz: number;  // Second moment of area about local Z
  ky: number;  // Shear area ratio (Asy = ky * A)
  kz: number;  // Shear area ratio (Asz = kz * A)
}

export interface Spring {
  id: SpringId;
  number: number;
  method: number; // 0: rigid, 1: pin, etc.
  kTheta: number; // Rotational spring stiffness
}

export interface Member {
  id: MemberId;
  ni: NodeId;  // i-end node
  nj: NodeId;  // j-end node
  sectionId: SectionId;
  codeAngle: number; // Rotation about member axis (degrees)
  iSprings: { x: number; y: number; z: number }; // Spring numbers at i-end
  jSprings: { x: number; y: number; z: number }; // Spring numbers at j-end
  /**
   * Fixes one global rotational DOF at the selected member end that corresponds
   * to the member axis (rx/ry/rz for global X/Y/Z-aligned members).
   * Because this is a node DOF restraint, it also affects other members sharing
   * that node and rotation direction.
   */
  torsionRestraint?: TorsionRestraintEnd;
}

// ── Loads ──
export interface NodalLoad {
  id: string;
  loadCaseId?: LoadCaseId;
  nodeId: NodeId;
  fx: number;
  fy: number;
  fz: number;
  mx: number;
  my: number;
  mz: number;
}

export type MemberLoadDirection = 'localX' | 'localY' | 'localZ';

export interface PointMemberLoad {
  id: string;
  loadCaseId?: LoadCaseId;
  memberId: MemberId;
  type: 'point';
  direction: MemberLoadDirection;
  value: number;
  a: number; // distance from i-end
}

export interface UniformMemberLoad {
  id: string;
  loadCaseId?: LoadCaseId;
  memberId: MemberId;
  type: 'udl';
  direction: MemberLoadDirection;
  value: number; // per unit length
}

export interface CMQMemberLoad {
  id: string;
  loadCaseId?: LoadCaseId;
  memberId: MemberId;
  type: 'cmq';
  // i-end forces/moments (local)
  iQx: number;
  iQy: number;
  iQz: number;
  iMy: number;
  iMz: number;
  // j-end forces/moments (local)
  jQx: number;
  jQy: number;
  jQz: number;
  jMy: number;
  jMz: number;
  // Mid-span moments
  moy: number;
  moz: number;
}

export type MemberLoad = PointMemberLoad | UniformMemberLoad | CMQMemberLoad;

export interface LoadCase {
  id: LoadCaseId;
  name: string;
}

export interface LoadCombinationTerm {
  loadCaseId: LoadCaseId;
  factor: number;
}

export interface LoadCombination {
  id: LoadCombinationId;
  name: string;
  factors: LoadCombinationTerm[];
}

// ── Coupling constraints ──
export interface CouplingConstraint {
  id: string;
  masterNodeId: NodeId;
  slaveNodeId: NodeId;
  ux: boolean;
  uy: boolean;
  uz: boolean;
  rx: boolean;
  ry: boolean;
  rz: boolean;
}

// ── Project model ──
export interface ProjectModel {
  title: string;
  analysisMode?: AnalysisMode;
  nodes: StructuralNode[];
  materials: Material[];
  sections: Section[];
  springs: Spring[];
  loadCases?: LoadCase[];
  loadCombinations?: LoadCombination[];
  activeLoadCaseId?: LoadCaseId;
  activeLoadCombinationId?: LoadCombinationId | null;
  members: Member[];
  couplings: CouplingConstraint[];
  nodalLoads: NodalLoad[];
  memberLoads: MemberLoad[];
  units: {
    force: string;
    length: string;
    moment: string;
  };
}

// ── Project file ──
export interface ProjectFile {
  schemaVersion: number;
  savedAt: string;
  model: ProjectModel;
}

// ── Indexed model (analysis-ready) ──
export interface IndexedNode {
  index: number;
  id: NodeId;
  x: number;
  y: number;
  z: number;
  restraint: Restraint;
}

/**
 * End-release info for a single rotational DOF.
 * type: 'rigid' = no release, 'pin' = free rotation, 'spring' = finite stiffness
 */
export interface EndRelease {
  type: 'rigid' | 'pin' | 'spring';
  kTheta: number; // only used when type === 'spring'
}

export interface IndexedMember {
  index: number;
  id: MemberId;
  ni: number; // node index
  nj: number; // node index
  E: number;
  G: number;
  A: number;
  Ix: number; // Torsional moment of inertia
  Iy: number; // Second moment about local Y
  Iz: number; // Second moment about local Z
  ky: number; // Shear area ratio Y
  kz: number; // Shear area ratio Z
  L: number;  // length
  lambda: Float64Array; // 3x3 rotation matrix (9 elements, row-major)
  /** End releases: [ix, iy, iz, jx, jy, jz] mapped to local DOF [3,4,5,9,10,11] */
  releases: [EndRelease, EndRelease, EndRelease, EndRelease, EndRelease, EndRelease];
}

export interface IndexedModel {
  nodes: IndexedNode[];
  members: IndexedMember[];
  nodalLoads: NodalLoad[];
  memberLoads: MemberLoad[];
  nodeCount: number;
  dofCount: number; // nodeCount * 6
  nodeIdToIndex: Map<NodeId, number>;
  memberIdToIndex: Map<MemberId, number>;
  /** DOF mapping for coupling: dofMap[i] = effective DOF index (master).
   *  If dofMap[i] === i, the DOF is independent (or is the master). */
  dofMap: Int32Array;
  /** Additional constrained source DOFs generated from member-level support features. */
  extraFixedDofs: number[];
}

// ── Analysis output ──
export interface DiagramPoint {
  x: number;  // local x position along member
  N: number;  // axial force
  Vy: number; // shear force Y
  Vz: number; // shear force Z
  Mx: number; // torsion
  My: number; // bending moment about Y
  Mz: number; // bending moment about Z
  ux: number; // displacement in local x
  uy: number; // displacement in local y
  uz: number; // displacement in local z
}

export interface DiagramSeries {
  memberId: MemberId;
  points: DiagramPoint[];
}

export interface AnalysisInput {
  model: IndexedModel;
}

export interface AnalysisOutput {
  displacements: Float64Array;
  reactions: Float64Array;
  elementEndForces: Map<MemberId, Float64Array>;
  diagrams: Map<MemberId, DiagramSeries>;
  warnings: string[];
}

export interface AnalysisResult {
  displacements: number[];
  reactions: number[];
  elementEndForces: Record<string, number[]>;
  diagrams: Record<string, { memberId: string; points: DiagramPoint[] }>;
  warnings: string[];
}

export type DofName = 'ux' | 'uy' | 'uz' | 'rx' | 'ry' | 'rz';
export type ReleasedMemberMode = 'localXTwist' | 'localYBending' | 'localZBending';

export interface StabilityDiagnostic {
  kind: 'singular-pivot' | 'zero-stiffness-dof' | 'released-member';
  nodeId?: NodeId;
  elementId?: MemberId;
  dof?: DofName;
  dofIndex?: number;
  released?: ReleasedMemberMode[];
}

export interface AnalysisError {
  type: 'validation' | 'singular' | 'numerical';
  message: string;
  elementId?: string;
  nodeId?: string;
  diagnostics?: StabilityDiagnostic[];
}
