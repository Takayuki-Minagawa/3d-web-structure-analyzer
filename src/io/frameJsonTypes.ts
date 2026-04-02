/**
 * FrameJsonDocument — 3D frame model JSON format.
 * Compatible with FrameModelMaker-Web output.
 */

export interface FrameJsonNodeLoad {
  p1: number; // Fx
  p2: number; // Fy
  p3: number; // Fz
  m1: number; // Mx
  m2: number; // My
  m3: number; // Mz
}

export interface FrameJsonMemberLoad {
  lengthMethod: number;
  type: number;
  direction: number;
  scale: number;
  loadCode: string;
  unitLoad: number;
  p1: number;
  p2: number;
  p3: number;
}

export interface FrameJsonCMQLoad {
  moy: number;
  moz: number;
  iMy: number;
  iMz: number;
  iQx: number;
  iQy: number;
  iQz: number;
  jMy: number;
  jMz: number;
  jQx: number;
  jQy: number;
  jQz: number;
}

export interface FrameJsonNode {
  number: number;
  x: number;
  y: number;
  z: number;
  temperature: number;
  intensityGroup: number;
  longWeight: number;
  forceWeight: number;
  addForceWeight: number;
  area: number;
  loads: FrameJsonNodeLoad[];
}

export interface FrameJsonMember {
  number: number;
  iNodeNumber: number;
  jNodeNumber: number;
  ixSpring: number;
  iySpring: number;
  izSpring: number;
  jxSpring: number;
  jySpring: number;
  jzSpring: number;
  sectionNumber: number;
  p1: number;
  p2: number;
  p3: number; // code angle
  memberLoads: FrameJsonMemberLoad[];
  cmqLoads: FrameJsonCMQLoad[];
}

export interface FrameJsonSection {
  number: number;
  materialNumber: number;
  type: number;
  shape: number;
  p1_A: number;
  p2_Ix: number;
  p3_Iy: number;
  p4_Iz: number;
  ky: number;
  kz: number;
  comment: string;
}

export interface FrameJsonMaterial {
  number: number;
  young: number;  // kN/cm^2
  shear: number;  // kN/cm^2
  expansion: number;
  poisson: number;
  unitLoad: number;
  name: string;
}

export interface FrameJsonBoundary {
  nodeNumber: number;
  deltaX: number; // 0=free, 1=fixed
  deltaY: number;
  deltaZ: number;
  thetaX: number;
  thetaY: number;
  thetaZ: number;
}

export interface FrameJsonSpring {
  number: number;
  method: number;
  kTheta: number;
}

export interface FrameJsonWall {
  number: number;
  leftBottomNode: number;
  rightBottomNode: number;
  leftTopNode: number;
  rightTopNode: number;
  materialNumber: number;
  method: number;
  p1: number;
  p2: number;
  p3: number;
  p4: number;
}

export interface FrameJsonDocument {
  title: string;
  loadCaseCount: number;
  loadCaseIndex: number;
  calcCaseMemo: string[];
  nodes: FrameJsonNode[];
  members: FrameJsonMember[];
  sections: FrameJsonSection[];
  materials: FrameJsonMaterial[];
  boundaries: FrameJsonBoundary[];
  springs: FrameJsonSpring[];
  walls: FrameJsonWall[];
}
