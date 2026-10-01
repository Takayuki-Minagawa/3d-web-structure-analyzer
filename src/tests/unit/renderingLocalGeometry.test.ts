import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { getDiagramOffsetDirection, getThreeLocalAxes, snapPosition } from '../../rendering/localGeometry';

describe('rendering local geometry', () => {
  it('uses the shared code-angle-aware axes for force diagram directions', () => {
    const axes = getThreeLocalAxes(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      90,
    );
    expect(axes).not.toBeNull();
    if (!axes) return;

    const vy = getDiagramOffsetDirection('Vy', axes);
    const vz = getDiagramOffsetDirection('Vz', axes);
    const my = getDiagramOffsetDirection('My', axes);
    const mz = getDiagramOffsetDirection('Mz', axes);

    expect(vy.x).toBeCloseTo(0);
    expect(vy.y).toBeCloseTo(0);
    expect(vy.z).toBeCloseTo(1);
    expect(vz.x).toBeCloseTo(0);
    expect(vz.y).toBeCloseTo(-1);
    expect(vz.z).toBeCloseTo(0);
    // Moment diagrams are drawn on the tension side: +Mz stretches the +y
    // fibre, +My stretches the -z fibre.
    expect(my.equals(vz.clone().negate())).toBe(true);
    expect(mz.equals(vy)).toBe(true);
  });

  it('snaps only in-plane coordinates and preserves each work-plane offset', () => {
    const point = new Vector3(1.2, 2.6, 3.4);
    const snap = (value: number) => Math.round(value);
    expect(snapPosition(point, 'xy', 9, snap)).toEqual({ x: 1, y: 3, z: 9 });
    expect(snapPosition(point, 'xz', 8, snap)).toEqual({ x: 1, y: 8, z: 3 });
    expect(snapPosition(point, 'yz', 7, snap)).toEqual({ x: 7, y: 3, z: 3 });
  });
});
