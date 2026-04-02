// ── ID types ──
export type NodeId = string;
export type MemberId = string;
export type MaterialId = string;
export type SectionId = string;

// ── Model entities ──
export interface StructuralNode {
  id: NodeId;
  x: number;
  y: number;
  restraint: {
    ux: boolean;
    uy: boolean;
    rz: boolean;
  };
}

export interface Material {
  id: MaterialId;
  name: string;
  E: number; // Young's modulus
  nu: number; // Poisson's ratio
}

export interface Section {
  id: SectionId;
  name: string;
  A: number; // Cross-sectional area
  I: number; // Second moment of area
  As: number; // Shear area
}

export interface Member {
  id: MemberId;
  ni: NodeId; // i-end node
  nj: NodeId; // j-end node
  materialId: MaterialId;
  sectionId: SectionId;
}

// ── Loads ──
export interface NodalLoad {
  id: string;
  nodeId: NodeId;
  fx: number;
  fy: number;
  mz: number;
}

export type MemberLoadDirection = 'localX' | 'localY';

export interface PointMemberLoad {
  id: string;
  memberId: MemberId;
  type: 'point';
  direction: MemberLoadDirection;
  value: number;
  a: number; // distance from i-end
}

export interface UniformMemberLoad {
  id: string;
  memberId: MemberId;
  type: 'udl';
  direction: MemberLoadDirection;
  value: number; // per unit length
}

export type MemberLoad = PointMemberLoad | UniformMemberLoad;

// ── Project model ──
export interface ProjectModel {
  nodes: StructuralNode[];
  materials: Material[];
  sections: Section[];
  members: Member[];
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
  restraint: { ux: boolean; uy: boolean; rz: boolean };
}

export interface IndexedMember {
  index: number;
  id: MemberId;
  ni: number; // node index
  nj: number; // node index
  E: number;
  A: number;
  I: number;
  L: number; // length
  cos: number; // direction cosine
  sin: number; // direction sine
  G: number; // shear modulus
  As: number; // shear area
}

export interface IndexedModel {
  nodes: IndexedNode[];
  members: IndexedMember[];
  nodalLoads: NodalLoad[];
  memberLoads: MemberLoad[];
  nodeCount: number;
  dofCount: number; // nodeCount * 3
  nodeIdToIndex: Map<NodeId, number>;
  memberIdToIndex: Map<MemberId, number>;
}

// ── Analysis output ──
export interface DiagramPoint {
  x: number; // local x position along member
  N: number; // axial force
  V: number; // shear force
  M: number; // bending moment
  ux: number; // displacement in local x
  uy: number; // displacement in local y
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

export interface AnalysisError {
  type: 'validation' | 'singular' | 'numerical';
  message: string;
  elementId?: string;
  nodeId?: string;
}
