import type {
  AnalysisMode,
  Member,
  MemberLoadDirection,
  ProjectModel,
  Restraint,
  StructuralNode,
} from './types';

type CoordinateAxis = 'x' | 'y' | 'z';
type DofKey = keyof Restraint;

export interface TwoDimensionalModeConfig {
  mode: Exclude<AnalysisMode, '3d'>;
  planeLabel: 'X-Z' | 'X-Y' | 'Y-Z';
  lockedCoordinate: CoordinateAxis;
  lockedCoordinateLabel: 'X' | 'Y' | 'Z';
  planeNormal: CoordinateAxis;
  autoFixedDofs: DofKey[];
  invalidNodalLoadComponents: Array<'fx' | 'fy' | 'fz' | 'mx' | 'my' | 'mz'>;
  allowedNodalLoadComponents: Array<'fx' | 'fy' | 'fz' | 'mx' | 'my' | 'mz'>;
}

export const DEFAULT_ANALYSIS_MODE: AnalysisMode = '3d';
export const XZ_2D_MODE: AnalysisMode = 'xz2d';
export const XY_2D_MODE: AnalysisMode = 'xy2d';
export const YZ_2D_MODE: AnalysisMode = 'yz2d';
export const XZ_PLANE_TOLERANCE = 1e-9;
export const TWO_D_PLANE_TOLERANCE = XZ_PLANE_TOLERANCE;
export const XZ_2D_CODE_ANGLE_TOLERANCE = 1e-8;
export const TWO_D_CODE_ANGLE_TOLERANCE = XZ_2D_CODE_ANGLE_TOLERANCE;

export const TWO_DIMENSIONAL_MODES: TwoDimensionalModeConfig[] = [
  {
    mode: XZ_2D_MODE,
    planeLabel: 'X-Z',
    lockedCoordinate: 'y',
    lockedCoordinateLabel: 'Y',
    planeNormal: 'y',
    autoFixedDofs: ['uy', 'rx', 'rz'],
    invalidNodalLoadComponents: ['fy', 'mx', 'mz'],
    allowedNodalLoadComponents: ['fx', 'fz', 'my'],
  },
  {
    mode: XY_2D_MODE,
    planeLabel: 'X-Y',
    lockedCoordinate: 'z',
    lockedCoordinateLabel: 'Z',
    planeNormal: 'z',
    autoFixedDofs: ['uz', 'rx', 'ry'],
    invalidNodalLoadComponents: ['fz', 'mx', 'my'],
    allowedNodalLoadComponents: ['fx', 'fy', 'mz'],
  },
  {
    mode: YZ_2D_MODE,
    planeLabel: 'Y-Z',
    lockedCoordinate: 'x',
    lockedCoordinateLabel: 'X',
    planeNormal: 'x',
    autoFixedDofs: ['ux', 'ry', 'rz'],
    invalidNodalLoadComponents: ['fx', 'my', 'mz'],
    allowedNodalLoadComponents: ['fy', 'fz', 'mx'],
  },
];

const TWO_DIMENSIONAL_MODE_BY_ID = new Map<AnalysisMode, TwoDimensionalModeConfig>(
  TWO_DIMENSIONAL_MODES.map((config) => [config.mode, config])
);

function isKnownAnalysisMode(value: unknown): value is AnalysisMode {
  return value === '3d' || value === XZ_2D_MODE || value === XY_2D_MODE || value === YZ_2D_MODE;
}

export function normalizeAnalysisMode(value: unknown): AnalysisMode {
  return isKnownAnalysisMode(value) ? value : DEFAULT_ANALYSIS_MODE;
}

export function getAnalysisMode(model: ProjectModel): AnalysisMode {
  return normalizeAnalysisMode(model.analysisMode);
}

export function get2dModeConfig(mode: AnalysisMode): TwoDimensionalModeConfig | null {
  return TWO_DIMENSIONAL_MODE_BY_ID.get(mode) ?? null;
}

export function getModel2dModeConfig(model: ProjectModel): TwoDimensionalModeConfig | null {
  return get2dModeConfig(getAnalysisMode(model));
}

export function is2dAnalysisMode(mode: AnalysisMode): boolean {
  return get2dModeConfig(mode) !== null;
}

export function is2dMode(model: ProjectModel): boolean {
  return is2dAnalysisMode(getAnalysisMode(model));
}

export function isXz2dMode(model: ProjectModel): boolean {
  return getAnalysisMode(model) === XZ_2D_MODE;
}

export function findNodesOffAnalysisPlane(
  model: ProjectModel,
  mode = getAnalysisMode(model),
  tolerance = TWO_D_PLANE_TOLERANCE
): StructuralNode[] {
  const config = get2dModeConfig(mode);
  if (!config) return [];
  return model.nodes.filter((node) => Math.abs(node[config.lockedCoordinate]) > tolerance);
}

export function findNodesOffXzPlane(
  model: ProjectModel,
  tolerance = TWO_D_PLANE_TOLERANCE
): StructuralNode[] {
  return findNodesOffAnalysisPlane(model, XZ_2D_MODE, tolerance);
}

export function is2dCodeAngleSupported(
  codeAngle: number,
  tolerance = TWO_D_CODE_ANGLE_TOLERANCE
): boolean {
  const normalized = ((codeAngle % 180) + 180) % 180;
  return normalized <= tolerance || Math.abs(normalized - 180) <= tolerance;
}

export function isXz2dCodeAngleSupported(
  codeAngle: number,
  tolerance = TWO_D_CODE_ANGLE_TOLERANCE
): boolean {
  return is2dCodeAngleSupported(codeAngle, tolerance);
}

export function findMembersWithUnsupported2dOrientation(
  model: ProjectModel,
  mode = getAnalysisMode(model)
): Member[] {
  if (!get2dModeConfig(mode)) return [];
  return model.members.filter((member) =>
    !is2dCodeAngleSupported(member.codeAngle)
  );
}

export function findMembersWithUnsupportedXz2dOrientation(
  model: ProjectModel
): Member[] {
  return findMembersWithUnsupported2dOrientation(model, XZ_2D_MODE);
}

export function getEffectiveRestraint(
  restraint: Restraint,
  mode: AnalysisMode
): Restraint {
  const config = get2dModeConfig(mode);
  const effective = { ...restraint };
  if (!config) return effective;
  for (const key of config.autoFixedDofs) {
    effective[key] = true;
  }
  return effective;
}

export function lockNodeToAnalysisPlane<T extends Pick<StructuralNode, 'x' | 'y' | 'z'>>(
  node: T,
  mode: AnalysisMode
): T {
  const config = get2dModeConfig(mode);
  if (!config) return node;
  return { ...node, [config.lockedCoordinate]: 0 };
}

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

function normalizeVector(vector: Vector3): Vector3 | null {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
  if (length <= TWO_D_PLANE_TOLERANCE) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}

function cross(a: Vector3, b: Vector3): Vector3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function rotateLocalTransverseAxes(
  localY: Vector3,
  localZ: Vector3,
  codeAngle: number
): { localY: Vector3; localZ: Vector3 } {
  if (codeAngle === 0) return { localY, localZ };
  const theta = codeAngle * Math.PI / 180;
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  return {
    localY: {
      x: localY.x * cosT + localZ.x * sinT,
      y: localY.y * cosT + localZ.y * sinT,
      z: localY.z * cosT + localZ.z * sinT,
    },
    localZ: {
      x: -localY.x * sinT + localZ.x * cosT,
      y: -localY.y * sinT + localZ.y * cosT,
      z: -localY.z * sinT + localZ.z * cosT,
    },
  };
}

function computeMemberLocalAxes(ni: StructuralNode, nj: StructuralNode, codeAngle: number): {
  localY: Vector3;
  localZ: Vector3;
} | null {
  const localX = normalizeVector({ x: nj.x - ni.x, y: nj.y - ni.y, z: nj.z - ni.z });
  if (!localX) return null;

  const reference = Math.abs(localX.z) > 0.95
    ? { x: 1, y: 0, z: 0 }
    : { x: 0, y: 0, z: 1 };
  const localYBase = normalizeVector(cross(reference, localX));
  if (!localYBase) return null;
  const localZBase = cross(localX, localYBase);
  return rotateLocalTransverseAxes(localYBase, localZBase, codeAngle);
}

function normalVector(axis: CoordinateAxis): Vector3 {
  return {
    x: axis === 'x' ? 1 : 0,
    y: axis === 'y' ? 1 : 0,
    z: axis === 'z' ? 1 : 0,
  };
}

function isParallel(a: Vector3, b: Vector3): boolean {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z);
  return Math.abs(dot - 1) <= 1e-6;
}

export function getMemberOutOfPlaneLocalAxes(
  model: ProjectModel,
  member: Member,
  mode = getAnalysisMode(model)
): { localY: boolean; localZ: boolean } {
  const config = get2dModeConfig(mode);
  if (!config) return { localY: false, localZ: false };

  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const ni = nodeById.get(member.ni);
  const nj = nodeById.get(member.nj);
  if (!ni || !nj) return { localY: false, localZ: false };

  const axes = computeMemberLocalAxes(ni, nj, member.codeAngle);
  if (!axes) return { localY: false, localZ: false };

  const normal = normalVector(config.planeNormal);
  return {
    localY: isParallel(axes.localY, normal),
    localZ: isParallel(axes.localZ, normal),
  };
}

export function getDefaultMemberLoadDirectionForMode(
  model: ProjectModel,
  memberId: string,
  mode = getAnalysisMode(model)
): MemberLoadDirection {
  const member = model.members.find((item) => item.id === memberId);
  if (!member) return 'localY';
  const outOfPlane = getMemberOutOfPlaneLocalAxes(model, member, mode);
  if (outOfPlane.localY && !outOfPlane.localZ) return 'localZ';
  return 'localY';
}
