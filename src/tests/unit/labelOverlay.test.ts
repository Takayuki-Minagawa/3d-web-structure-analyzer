import { afterEach, describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera } from 'three';
import { PINNED_RESTRAINT } from '../../core/model/restraints';
import type { ProjectModel } from '../../core/model/types';
import { LabelOverlay } from '../../rendering/labelOverlay';
import { getSupportPresentations } from '../../rendering/supportPresentation';
import type { LabelMode } from '../../state/viewStore';

afterEach(() => vi.unstubAllGlobals());

function drawSupportLabels(positions: Array<[number, number]>, labelMode: LabelMode) {
  const context = {
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    measureText: (text: string) => ({ width: text.length * 7 }),
    fillRect: vi.fn<(x: number, y: number, width: number, height: number) => void>(),
    fillText: vi.fn<(text: string, x: number, y: number) => void>(),
  };
  vi.stubGlobal('document', {
    createElement: () => ({ style: {}, getContext: () => context }),
  });
  const overlay = new LabelOverlay({ appendChild: vi.fn() } as unknown as HTMLElement);
  overlay.resize(600, 400, 1);
  const model: ProjectModel = {
    title: 'Support label clipping',
    nodes: positions.map(([x, y], index) => ({
      id: `node-${index}`, x, y, z: 0, restraint: { ...PINNED_RESTRAINT },
    })),
    members: [], materials: [], sections: [], springs: [], couplings: [],
    nodalLoads: [], memberLoads: [],
    units: { force: 'kN', length: 'm', moment: 'kN·m' },
  };
  const camera = new PerspectiveCamera(90, 1.5, 0.1, 1000);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  overlay.draw({
    model, result: null, camera, displayMode: 'model', diagramScale: 1,
    isDark: true, showNodeLabels: false, showMemberLabels: false,
    showSupports: true, supports: getSupportPresentations(model),
    loadCaption: '', labelMode,
    selectedNodeIds: new Set(labelMode === 'selected' ? model.nodes.map((node) => node.id) : []),
    selectedMemberIds: new Set(),
  });
  return context;
}

describe('support label viewport clipping', () => {
  it.each(['auto', 'all', 'selected'] as const)('omits offscreen supports in %s mode without suppressing visible labels', (mode) => {
    // At this camera position, x=±15 and y=±10 are the viewport edges.
    // Offscreen supports are deliberately before the visible one: previously
    // their clamped labels could occupy the visible support's label position.
    const context = drawSupportLabels([[100, 0], [-100, 0], [0, 10.5], [0, -10.5], [14.9, 0]], mode);
    expect(context.fillText.mock.calls).toHaveLength(1);
    expect(context.fillText.mock.calls[0]![0]).toBe('u:xyz');
  });

  it('keeps labels inside the horizontal edges for supports that are still visible', () => {
    const context = drawSupportLabels([[-14.9, 0], [14.9, 0]], 'auto');
    expect(context.fillText.mock.calls).toHaveLength(2);
    for (const [x, , width] of context.fillRect.mock.calls) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x + width).toBeLessThanOrEqual(600);
    }
  });
});
