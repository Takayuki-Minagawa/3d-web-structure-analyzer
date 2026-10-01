import * as THREE from 'three';
import type { ProjectModel } from '../core/model/types';
import {
  MEMBER_COLOR,
  MEMBER_COLOR_HOVER,
  MEMBER_COLOR_SELECTED,
  NODE_COLOR,
  NODE_COLOR_HOVER,
  NODE_COLOR_PENDING,
  NODE_COLOR_SELECTED,
  NODE_POINT_SIZE,
  SUPPORT_COLOR,
  SUPPORT_OPACITY,
  SUPPORT_SIZE,
} from './constants';
import { getThreeLocalAxes } from './localGeometry';

export interface GeometryHighlightState {
  selectedNodeIds: ReadonlySet<string>;
  selectedMemberIds: ReadonlySet<string>;
  hoveredNodeId: string | null;
  hoveredMemberId: string | null;
  pendingMemberStart: string | null;
}

export function populateNodes(
  group: THREE.Group,
  model: ProjectModel,
  highlights: GeometryHighlightState,
): void {
  const positions: number[] = [];
  const colors: number[] = [];

  for (const node of model.nodes) {
    positions.push(node.x, node.y, node.z);
    let color = NODE_COLOR;
    if (node.id === highlights.pendingMemberStart) color = NODE_COLOR_PENDING;
    else if (highlights.selectedNodeIds.has(node.id)) color = NODE_COLOR_SELECTED;
    else if (node.id === highlights.hoveredNodeId) color = NODE_COLOR_HOVER;
    colors.push(color.r, color.g, color.b);
  }
  if (positions.length === 0) return;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: NODE_POINT_SIZE,
    sizeAttenuation: false,
    vertexColors: true,
  });
  group.add(new THREE.Points(geometry, material));
}

export function populateMembers(
  group: THREE.Group,
  model: ProjectModel,
  highlights: GeometryHighlightState,
): void {
  const nodeMap = new Map(model.nodes.map((node) => [node.id, node]));
  const positions: number[] = [];
  const colors: number[] = [];

  for (const member of model.members) {
    const nodeI = nodeMap.get(member.ni);
    const nodeJ = nodeMap.get(member.nj);
    if (!nodeI || !nodeJ) continue;
    positions.push(nodeI.x, nodeI.y, nodeI.z, nodeJ.x, nodeJ.y, nodeJ.z);
    let color = MEMBER_COLOR;
    if (highlights.selectedMemberIds.has(member.id)) color = MEMBER_COLOR_SELECTED;
    else if (member.id === highlights.hoveredMemberId) color = MEMBER_COLOR_HOVER;
    colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
  if (positions.length === 0) return;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true })));
}

export function populateSupports(group: THREE.Group, model: ProjectModel): void {
  for (const node of model.nodes) {
    const restraint = node.restraint;
    if (!restraint.ux && !restraint.uy && !restraint.uz) continue;

    const size = SUPPORT_SIZE;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([
      node.x, node.y, node.z - size,
      node.x - size * 0.7, node.y, node.z - size * 2,
      node.x + size * 0.7, node.y, node.z - size * 2,
    ], 3));
    geometry.setIndex([0, 1, 2]);
    const material = new THREE.MeshBasicMaterial({
      color: SUPPORT_COLOR,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: SUPPORT_OPACITY,
    });
    group.add(new THREE.Mesh(geometry, material));
  }
}

function addArrow(
  group: THREE.Group,
  origin: THREE.Vector3,
  direction: THREE.Vector3,
  length: number,
  color: number,
  headLength: number,
  headWidth: number,
): void {
  const start = origin.clone().add(direction.clone().multiplyScalar(-length));
  group.add(new THREE.ArrowHelper(direction, start, length, color, headLength, headWidth));
}

function addMomentSymbol(
  group: THREE.Group,
  origin: THREE.Vector3,
  axis: THREE.Vector3,
  value: number,
  color: number,
  arrowLength: number,
  headLength: number,
  headWidth: number,
  armLength = arrowLength * 0.5,
): void {
  if (Math.abs(value) < 1e-10) return;
  const axisDirection = axis.clone().normalize();
  const reference = Math.abs(axisDirection.z) > 0.9
    ? new THREE.Vector3(1, 0, 0)
    : new THREE.Vector3(0, 0, 1);
  const arm = new THREE.Vector3().crossVectors(axisDirection, reference).normalize();
  const sign = value > 0 ? 1 : -1;
  const tipDirection = new THREE.Vector3()
    .crossVectors(arm, axisDirection)
    .normalize()
    .multiplyScalar(sign);
  addArrow(
    group,
    origin.clone().add(arm.clone().multiplyScalar(armLength)),
    tipDirection,
    armLength,
    color,
    headLength,
    headWidth,
  );
  addArrow(
    group,
    origin.clone().add(arm.clone().multiplyScalar(-armLength)),
    tipDirection.clone().negate(),
    armLength,
    color,
    headLength,
    headWidth,
  );
}

export function populateLoads(group: THREE.Group, model: ProjectModel): void {
  const forceColor = 0xff4444;
  const momentColor = 0xee8800;
  const arrowLength = 15;
  const headLength = 4;
  const headWidth = 2;
  const nodeMap = new Map(model.nodes.map((node) => [node.id, node]));

  for (const load of model.nodalLoads) {
    const node = nodeMap.get(load.nodeId);
    if (!node) continue;
    const origin = new THREE.Vector3(node.x, node.y, node.z);
    const forces: Array<[number, THREE.Vector3]> = [
      [load.fx, new THREE.Vector3(1, 0, 0)],
      [load.fy, new THREE.Vector3(0, 1, 0)],
      [load.fz, new THREE.Vector3(0, 0, 1)],
    ];
    for (const [value, direction] of forces) {
      if (Math.abs(value) < 1e-10) continue;
      addArrow(
        group,
        origin,
        direction.multiplyScalar(value > 0 ? 1 : -1),
        arrowLength,
        forceColor,
        headLength,
        headWidth,
      );
    }

    const moments: Array<[number, THREE.Vector3]> = [
      [load.mx, new THREE.Vector3(1, 0, 0)],
      [load.my, new THREE.Vector3(0, 1, 0)],
      [load.mz, new THREE.Vector3(0, 0, 1)],
    ];
    for (const [value, axis] of moments) {
      addMomentSymbol(
        group,
        origin,
        axis,
        value,
        momentColor,
        arrowLength,
        headLength,
        headWidth,
      );
    }
  }

  const memberMap = new Map(model.members.map((member) => [member.id, member]));
  for (const load of model.memberLoads) {
    const member = memberMap.get(load.memberId);
    if (!member) continue;
    const nodeI = nodeMap.get(member.ni);
    const nodeJ = nodeMap.get(member.nj);
    if (!nodeI || !nodeJ) continue;
    const axes = getThreeLocalAxes(nodeI, nodeJ, member.codeAngle);
    if (!axes) continue;
    const pointI = new THREE.Vector3(nodeI.x, nodeI.y, nodeI.z);
    const pointJ = new THREE.Vector3(nodeJ.x, nodeJ.y, nodeJ.z);
    const localDirection = (direction: string): THREE.Vector3 => {
      if (direction === 'localX') return axes.x.clone();
      if (direction === 'localZ') return axes.z.clone();
      if (direction === 'globalX') return new THREE.Vector3(1, 0, 0);
      if (direction === 'globalY') return new THREE.Vector3(0, 1, 0);
      if (direction === 'globalZ') return new THREE.Vector3(0, 0, 1);
      return axes.y.clone();
    };

    if (load.type === 'udl') {
      const direction = localDirection(load.direction).multiplyScalar(load.value > 0 ? 1 : -1);
      const segmentCount = 5;
      for (let index = 0; index <= segmentCount; index += 1) {
        const position = pointI.clone().lerp(pointJ, index / segmentCount);
        addArrow(group, position, direction, arrowLength * 0.6, forceColor, headLength, headWidth);
      }
    } else if (load.type === 'trapezoid') {
      // Arrow length follows the local intensity so the load shape is visible.
      const peak = Math.max(Math.abs(load.value), Math.abs(load.valueEnd));
      if (peak < 1e-12 || axes.length <= 0) continue;
      const segmentCount = 5;
      for (let index = 0; index <= segmentCount; index += 1) {
        const ratio = index / segmentCount;
        const intensity = load.value + (load.valueEnd - load.value) * ratio;
        if (Math.abs(intensity) < peak * 1e-6) continue;
        const position = pointI.clone().lerp(pointJ, (load.a + (load.b - load.a) * ratio) / axes.length);
        const direction = localDirection(load.direction).multiplyScalar(intensity > 0 ? 1 : -1);
        const scaledLength = arrowLength * 0.6 * Math.abs(intensity) / peak;
        addArrow(
          group, position, direction, scaledLength, forceColor,
          Math.min(headLength, scaledLength * 0.5), headWidth,
        );
      }
    } else if (load.type === 'point') {
      const t = axes.length > 0 ? load.a / axes.length : 0;
      const position = pointI.clone().lerp(pointJ, t);
      const direction = localDirection(load.direction).multiplyScalar(load.value > 0 ? 1 : -1);
      addArrow(group, position, direction, arrowLength, forceColor, headLength, headWidth);
    } else if (load.type === 'cmq') {
      const endForces: Array<[THREE.Vector3, [number, number, number]]> = [
        [pointI, [load.iQx, load.iQy, load.iQz]],
        [pointJ, [load.jQx, load.jQy, load.jQz]],
      ];
      for (const [position, [qx, qy, qz]] of endForces) {
        if (Math.abs(qx) > 1e-10) addArrow(group, position, axes.x.clone().multiplyScalar(qx > 0 ? 1 : -1), arrowLength * 0.5, forceColor, headLength, headWidth);
        if (Math.abs(qy) > 1e-10) addArrow(group, position, axes.y.clone().multiplyScalar(qy > 0 ? 1 : -1), arrowLength * 0.5, forceColor, headLength, headWidth);
        if (Math.abs(qz) > 1e-10) addArrow(group, position, axes.z.clone().multiplyScalar(qz > 0 ? 1 : -1), arrowLength * 0.5, forceColor, headLength, headWidth);
      }

      const midpoint = pointI.clone().lerp(pointJ, 0.5);
      const moments: Array<[THREE.Vector3, THREE.Vector3, number]> = [
        [pointI, axes.y, load.iMy],
        [pointI, axes.z, load.iMz],
        [pointJ, axes.y, load.jMy],
        [pointJ, axes.z, load.jMz],
        [midpoint, axes.y, load.moy],
        [midpoint, axes.z, load.moz],
      ];
      for (const [position, axis, value] of moments) {
        addMomentSymbol(
          group,
          position,
          axis,
          value,
          momentColor,
          arrowLength,
          headLength,
          headWidth,
          arrowLength * 0.35,
        );
      }
    } else if (load.type === 'temperature') {
      const sign = load.value >= 0 ? 1 : -1;
      addArrow(group, pointI, axes.x.clone().multiplyScalar(-sign), arrowLength * 0.7, momentColor, headLength, headWidth);
      addArrow(group, pointJ, axes.x.clone().multiplyScalar(sign), arrowLength * 0.7, momentColor, headLength, headWidth);
    } else {
      const gravity = model.gravity ?? { x: 0, y: 0, z: -1 };
      const gravityDirection = new THREE.Vector3(gravity.x, gravity.y, gravity.z);
      if (gravityDirection.lengthSq() <= 1e-12 || Math.abs(load.value) < 1e-12) continue;
      gravityDirection.normalize().multiplyScalar(load.value >= 0 ? 1 : -1);
      const segmentCount = 5;
      for (let index = 0; index <= segmentCount; index += 1) {
        const position = pointI.clone().lerp(pointJ, index / segmentCount);
        addArrow(group, position, gravityDirection, arrowLength * 0.6, forceColor, headLength, headWidth);
      }
    }
  }
}
