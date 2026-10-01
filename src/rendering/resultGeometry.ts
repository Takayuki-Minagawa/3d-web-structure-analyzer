import * as THREE from 'three';
import type { AnalysisResult, DiagramPoint, ProjectModel } from '../core/model/types';
import type { DisplayMode } from '../state/viewStore';
import { DEFORM_COLOR, DIAGRAM_COLOR_NEG, DIAGRAM_COLOR_POS } from './constants';
import { getDiagramOffsetDirection, getThreeLocalAxes } from './localGeometry';

export interface DeformationGeometryState {
  lines: THREE.LineSegments;
  basePositions: Float32Array;
  displacementVectors: Float32Array;
}

/**
 * Build the deformed-shape line set. Members follow the deflection samples
 * of their result diagram (local ux/uy/uz along the member), so span loads
 * and released ends show as curves; members without samples fall back to a
 * straight line between the displaced nodes.
 */
export function createDeformationGeometry(
  model: ProjectModel,
  result: AnalysisResult,
): DeformationGeometryState | null {
  const nodeMap = new Map(model.nodes.map((node) => [node.id, node]));
  const nodeIndices = new Map(model.nodes.map((node, index) => [node.id, index]));
  const base: number[] = [];
  const displacement: number[] = [];
  const nodalDisplacement = (index: number): [number, number, number] => [
    result.displacements[index * 6] ?? 0,
    result.displacements[index * 6 + 1] ?? 0,
    result.displacements[index * 6 + 2] ?? 0,
  ];

  for (const member of model.members) {
    const nodeI = nodeMap.get(member.ni);
    const nodeJ = nodeMap.get(member.nj);
    const indexI = nodeIndices.get(member.ni);
    const indexJ = nodeIndices.get(member.nj);
    if (!nodeI || !nodeJ || indexI === undefined || indexJ === undefined) continue;

    const points = result.diagrams[member.id]?.points;
    const axes = points && points.length >= 2
      ? getThreeLocalAxes(nodeI, nodeJ, member.codeAngle)
      : null;
    if (!points || !axes) {
      base.push(nodeI.x, nodeI.y, nodeI.z, nodeJ.x, nodeJ.y, nodeJ.z);
      displacement.push(...nodalDisplacement(indexI), ...nodalDisplacement(indexJ));
      continue;
    }

    const samples = points.map((point) => ({
      base: [
        nodeI.x + axes.x.x * point.x,
        nodeI.y + axes.x.y * point.x,
        nodeI.z + axes.x.z * point.x,
      ],
      displacement: [
        axes.x.x * point.ux + axes.y.x * point.uy + axes.z.x * point.uz,
        axes.x.y * point.ux + axes.y.y * point.uy + axes.z.y * point.uz,
        axes.x.z * point.ux + axes.y.z * point.uy + axes.z.z * point.uz,
      ],
    }));
    for (let index = 1; index < samples.length; index += 1) {
      const previous = samples[index - 1]!;
      const current = samples[index]!;
      base.push(...previous.base, ...current.base);
      displacement.push(...previous.displacement, ...current.displacement);
    }
  }
  if (base.length === 0) return null;

  const basePositions = new Float32Array(base);
  const displacementVectors = new Float32Array(displacement);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(basePositions.slice(), 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: DEFORM_COLOR }));
  // The animation mutates positions in-place; avoid recomputing a bounding
  // sphere every frame solely for frustum culling.
  lines.frustumCulled = false;
  return { lines, basePositions, displacementVectors };
}

export function updateDeformationGeometry(
  state: DeformationGeometryState,
  scale: number,
): void {
  const attribute = state.lines.geometry.getAttribute('position');
  if (!(attribute instanceof THREE.BufferAttribute)) return;
  const positions = attribute.array;
  for (let index = 0; index < state.basePositions.length; index += 1) {
    positions[index] = (state.basePositions[index] ?? 0)
      + (state.displacementVectors[index] ?? 0) * scale;
  }
  attribute.needsUpdate = true;
}

export function getDiagramValue(point: DiagramPoint, mode: DisplayMode): number {
  switch (mode) {
    case 'N': return point.N;
    case 'Vy': return point.Vy;
    case 'Vz': return point.Vz;
    case 'Mx': return point.Mx;
    case 'My': return point.My;
    case 'Mz': return point.Mz;
    case 'model':
    case 'deformation':
    case 'modeShape':
      return 0;
  }
}

export function populateDiagrams(
  group: THREE.Group,
  model: ProjectModel,
  result: AnalysisResult,
  mode: DisplayMode,
  scale: number,
): void {
  const nodeMap = new Map(model.nodes.map((node) => [node.id, node]));
  const ribbonPositions: number[] = [];
  const ribbonColors: number[] = [];
  const basePositions: number[] = [];

  for (const member of model.members) {
    const nodeI = nodeMap.get(member.ni);
    const nodeJ = nodeMap.get(member.nj);
    const points = result.diagrams[member.id]?.points;
    if (!nodeI || !nodeJ || !points || points.length < 2) continue;
    const axes = getThreeLocalAxes(nodeI, nodeJ, member.codeAngle);
    if (!axes) continue;
    const offsetDirection = getDiagramOffsetDirection(mode, axes);
    const start = new THREE.Vector3(nodeI.x, nodeI.y, nodeI.z);
    const memberDirection = axes.x;

    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      if (!previous || !current) continue;
      const previousValue = getDiagramValue(previous, mode);
      const currentValue = getDiagramValue(current, mode);
      const previousPosition = start.clone()
        .addScaledVector(memberDirection, previous.x)
        .addScaledVector(offsetDirection, previousValue * scale);
      const currentPosition = start.clone()
        .addScaledVector(memberDirection, current.x)
        .addScaledVector(offsetDirection, currentValue * scale);
      ribbonPositions.push(...previousPosition.toArray(), ...currentPosition.toArray());
      const previousColor = previousValue >= 0 ? DIAGRAM_COLOR_POS : DIAGRAM_COLOR_NEG;
      const currentColor = currentValue >= 0 ? DIAGRAM_COLOR_POS : DIAGRAM_COLOR_NEG;
      ribbonColors.push(
        previousColor.r, previousColor.g, previousColor.b,
        currentColor.r, currentColor.g, currentColor.b,
      );
    }
    basePositions.push(nodeI.x, nodeI.y, nodeI.z, nodeJ.x, nodeJ.y, nodeJ.z);
  }

  if (ribbonPositions.length > 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(ribbonPositions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(ribbonColors, 3));
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true })));
  }
  if (basePositions.length > 0) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(basePositions, 3));
    group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x666666 })));
  }
}

export function getDiagramLabelPosition(
  model: ProjectModel,
  memberId: string,
  point: DiagramPoint,
  mode: DisplayMode,
  scale: number,
): THREE.Vector3 | null {
  const member = model.members.find((item) => item.id === memberId);
  if (!member) return null;
  const nodeI = model.nodes.find((item) => item.id === member.ni);
  const nodeJ = model.nodes.find((item) => item.id === member.nj);
  if (!nodeI || !nodeJ) return null;
  const axes = getThreeLocalAxes(nodeI, nodeJ, member.codeAngle);
  if (!axes) return null;
  const value = getDiagramValue(point, mode);
  return new THREE.Vector3(nodeI.x, nodeI.y, nodeI.z)
    .addScaledVector(axes.x, point.x)
    .addScaledVector(getDiagramOffsetDirection(mode, axes), value * scale);
}
