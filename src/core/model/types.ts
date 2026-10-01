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
  /** Stable, human-readable sequence number used by UI, reports and imports. */
  number?: number;
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
  /** Mass density used by explicit self-weight member loads (mass / volume). */
  density?: number;
}

export interface Section {
  id: SectionId;
  name: string;
  materialId: MaterialId;
  A: number;   // Cross-sectional area
  Ix: number;  // Torsional moment of inertia
  Iy: number;  // Second moment of area about local Y
  Iz: number;  // Second moment of area about local Z
  ky: number;  // Effective shear-area ratio paired with Iy (local-z shear)
  kz: number;  // Effective shear-area ratio paired with Iz (local-y shear)
}

export interface Spring {
  id: SpringId;
  number: number;
  /** Opaque FrameModelMaker method code; connection behavior is defined by number/kTheta. */
  method: number;
  kTheta: number; // Rotational spring stiffness
}

export interface Member {
  id: MemberId;
  /** Stable, human-readable sequence number used by UI, reports and imports. */
  number?: number;
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

export type LocalMemberLoadDirection = 'localX' | 'localY' | 'localZ';
export type GlobalMemberLoadDirection = 'globalX' | 'globalY' | 'globalZ';
export type MemberLoadDirection = LocalMemberLoadDirection | GlobalMemberLoadDirection;

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

/**
 * Linearly varying distributed load over the partial span [a, b].
 * A uniform partial load uses equal intensities; a triangular load uses zero
 * at one end.
 */
export interface TrapezoidalMemberLoad {
  id: string;
  loadCaseId?: LoadCaseId;
  memberId: MemberId;
  type: 'trapezoid';
  direction: MemberLoadDirection;
  /** Intensity per unit length at the start position `a`. */
  value: number;
  /** Intensity per unit length at the end position `b`. */
  valueEnd: number;
  a: number; // start distance from i-end
  b: number; // end distance from i-end
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

/** Uniform temperature change. `value` is delta-T in the model's temperature scale. */
export interface TemperatureMemberLoad {
  id: string;
  loadCaseId?: LoadCaseId;
  memberId: MemberId;
  type: 'temperature';
  /** Kept explicit so generic load editors can display this as an axial effect. */
  direction: 'localX';
  value: number;
}

/** Self-weight generated from material density, section area and project gravity. */
export interface SelfWeightMemberLoad {
  id: string;
  loadCaseId?: LoadCaseId;
  memberId: MemberId;
  type: 'selfWeight';
  /** Display hint; the actual direction is the project gravity vector. */
  direction: GlobalMemberLoadDirection;
  /** Dimensionless multiplier, normally 1. */
  value: number;
}

export type MemberLoad =
  | PointMemberLoad
  | UniformMemberLoad
  | TrapezoidalMemberLoad
  | CMQMemberLoad
  | TemperatureMemberLoad
  | SelfWeightMemberLoad;

/**
 * Prescribed (enforced) displacement of restrained nodal DOFs, e.g. a support
 * settlement. Components on unrestrained DOFs are rejected by validation.
 */
export interface PrescribedDisplacement {
  id: string;
  loadCaseId?: LoadCaseId;
  nodeId: NodeId;
  ux: number;
  uy: number;
  uz: number;
  rx: number;
  ry: number;
  rz: number;
}

/** Additional lumped translational mass used by eigenvalue (modal) analysis. */
export interface NodalMass {
  id: string;
  nodeId: NodeId;
  mass: number;
}

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

/** Six diagonal support-spring stiffnesses in global nodal DOF order. */
export interface NodalSpringSupport {
  id: string;
  nodeId: NodeId;
  ux: number;
  uy: number;
  uz: number;
  rx: number;
  ry: number;
  rz: number;
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
  /** Optional for backward compatibility with existing project files. */
  nodeSprings?: NodalSpringSupport[];
  /** Global acceleration vector used by explicit self-weight loads. */
  gravity?: { x: number; y: number; z: number };
  nodalLoads: NodalLoad[];
  memberLoads: MemberLoad[];
  /** Optional for backward compatibility with existing project files. */
  prescribedDisplacements?: PrescribedDisplacement[];
  /** Optional for backward compatibility with existing project files. */
  nodeMasses?: NodalMass[];
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
  ky: number; // Effective shear-area ratio paired with Iy (local-z shear)
  kz: number; // Effective shear-area ratio paired with Iz (local-y shear)
  expansion?: number; // Thermal expansion coefficient; zero for legacy/manual indexed members
  density?: number; // Mass density; zero when omitted from the source material
  L: number;  // length
  lambda: Float64Array; // 3x3 rotation matrix (9 elements, row-major)
  /** Optional immutable base matrices cached by indexing for repeated cases. */
  localStiffness?: Float64Array;
  transformation?: Float64Array;
  /** End releases: [ix, iy, iz, jx, jy, jz] mapped to local DOF [3,4,5,9,10,11] */
  releases: [EndRelease, EndRelease, EndRelease, EndRelease, EndRelease, EndRelease];
}

export interface IndexedNodalSpringSupport extends NodalSpringSupport {
  nodeIndex: number;
}

export interface IndexedModel {
  nodes: IndexedNode[];
  members: IndexedMember[];
  nodalLoads: NodalLoad[];
  memberLoads: MemberLoad[];
  prescribedDisplacements: PrescribedDisplacement[];
  nodeSprings: IndexedNodalSpringSupport[];
  gravity: { x: number; y: number; z: number };
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

export interface AnalysisTarget {
  id: string;
  name: string;
  type: 'loadCase' | 'loadCombination';
}

export interface AnalysisTargetResult extends AnalysisOutput {
  target: AnalysisTarget;
}

export interface ComponentEnvelope {
  min: Float64Array;
  max: Float64Array;
  minTargetIds: string[];
  maxTargetIds: string[];
}

export interface AnalysisEnvelope {
  displacements: ComponentEnvelope;
  reactions: ComponentEnvelope;
  elementEndForces: Map<MemberId, ComponentEnvelope>;
}

export interface MultiTargetAnalysisOutput {
  results: AnalysisTargetResult[];
  envelope: AnalysisEnvelope;
  /** Exposed to make the one-factorization contract observable in tests/clients. */
  factorizationCount: number;
}

export interface AnalysisResult {
  displacements: number[];
  reactions: number[];
  elementEndForces: Record<string, number[]>;
  diagrams: Record<string, { memberId: string; points: DiagramPoint[] }>;
  warnings: string[];
}

/** Normalized deformed shape of one eigenmode (largest translation = 1). */
export interface ModeShape {
  /** Displacements of the model's own nodes, 6 per node. */
  displacements: Float64Array;
  /** Local deflection samples along each member; section forces are zero. */
  diagrams: Map<MemberId, DiagramSeries>;
}

export type DirectionTriple = [x: number, y: number, z: number];

export interface ModalMode {
  /** 1-based mode number in ascending frequency order. */
  index: number;
  /** Circular frequency ω [rad/s]. */
  omega: number;
  /** Natural frequency f = ω / 2π [Hz]. */
  frequency: number;
  /** Natural period T = 1 / f [s]. */
  period: number;
  /** Participation factors for unit-normalized mode shapes, per global direction. */
  participation: DirectionTriple;
  /** Effective modal mass divided by the total mass, per global direction. */
  effectiveMassRatio: DirectionTriple;
  shape: ModeShape;
}

export interface ModalAnalysisOutput {
  modes: ModalMode[];
  /** Total translational mass per global direction, including supported nodes. */
  totalMass: DirectionTriple;
  /** Number of elements each member was subdivided into. */
  divisions: number;
  freeDofCount: number;
  warnings: string[];
}

export interface BucklingMode {
  /** 1-based mode number in ascending load-factor order. */
  index: number;
  /** Critical multiplier λ of the reference load set. */
  loadFactor: number;
  shape: ModeShape;
}

export interface BucklingAnalysisOutput {
  modes: BucklingMode[];
  /** Load case or combination whose axial forces define the reference state. */
  target: AnalysisTarget;
  divisions: number;
  freeDofCount: number;
  warnings: string[];
}

export interface EigenAnalysisOptions {
  /** Number of modes to report. */
  modeCount?: number;
  /** Elements per member; 'auto' picks the finest affordable subdivision. */
  divisions?: number | 'auto';
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
