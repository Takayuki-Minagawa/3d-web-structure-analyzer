import * as THREE from 'three';
import { computeMemberLocalAxes } from '../core/model/localAxes';
import type { DisplayMode, WorkPlaneAxis } from '../state/viewStore';

export interface ThreeLocalAxes {
  x: THREE.Vector3;
  y: THREE.Vector3;
  z: THREE.Vector3;
  length: number;
}

export interface Position3 {
  x: number;
  y: number;
  z: number;
}

export function getThreeLocalAxes(
  nodeI: Position3,
  nodeJ: Position3,
  codeAngle: number,
): ThreeLocalAxes | null {
  const axes = computeMemberLocalAxes(nodeI, nodeJ, codeAngle);
  if (!axes) return null;
  return {
    x: new THREE.Vector3(axes.localX.x, axes.localX.y, axes.localX.z),
    y: new THREE.Vector3(axes.localY.x, axes.localY.y, axes.localY.z),
    z: new THREE.Vector3(axes.localZ.x, axes.localZ.y, axes.localZ.z),
    length: axes.length,
  };
}

/**
 * Direction in which a force diagram is offset from the member axis.
 * Shear diagrams follow their force component. Bending diagrams lie in the
 * corresponding bending plane (My in local X-Z, Mz in local X-Y) and are
 * drawn on the tension side: positive Mz stretches the +y fibre, while
 * positive My (right-hand rule about y) stretches the -z fibre.
 */
export function getDiagramOffsetDirection(
  mode: DisplayMode,
  axes: ThreeLocalAxes,
): THREE.Vector3 {
  switch (mode) {
    case 'Vy':
    case 'Mz':
      return axes.y.clone();
    case 'My':
      return axes.z.clone().negate();
    case 'Vz':
      return axes.z.clone();
    case 'N':
    case 'Mx':
    case 'model':
    case 'deformation':
      return axes.z.clone();
  }
}

export function workPlaneNormal(axis: WorkPlaneAxis): THREE.Vector3 {
  switch (axis) {
    case 'xy': return new THREE.Vector3(0, 0, 1);
    case 'xz': return new THREE.Vector3(0, 1, 0);
    case 'yz': return new THREE.Vector3(1, 0, 0);
  }
}

export function createWorkPlane(axis: WorkPlaneAxis, offset: number): THREE.Plane {
  return new THREE.Plane(workPlaneNormal(axis), -offset);
}

export function normalCoordinate(position: Position3, axis: WorkPlaneAxis): number {
  switch (axis) {
    case 'xy': return position.z;
    case 'xz': return position.y;
    case 'yz': return position.x;
  }
}

export function snapPosition(
  position: THREE.Vector3,
  axis: WorkPlaneAxis,
  offset: number,
  snap: (value: number) => number,
): Position3 {
  switch (axis) {
    case 'xy': return { x: snap(position.x), y: snap(position.y), z: offset };
    case 'xz': return { x: snap(position.x), y: offset, z: snap(position.z) };
    case 'yz': return { x: offset, y: snap(position.y), z: snap(position.z) };
  }
}

export function orientGrid(grid: THREE.GridHelper, axis: WorkPlaneAxis, offset: number): void {
  grid.rotation.set(0, 0, 0);
  grid.position.set(0, 0, 0);
  if (axis === 'xy') {
    grid.rotation.x = Math.PI / 2;
    grid.position.z = offset;
  } else if (axis === 'xz') {
    grid.position.y = offset;
  } else {
    grid.rotation.z = Math.PI / 2;
    grid.position.x = offset;
  }
}
