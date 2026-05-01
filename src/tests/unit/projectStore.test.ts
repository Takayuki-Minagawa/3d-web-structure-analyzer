import { beforeEach, describe, expect, it } from 'vitest';
import { useProjectStore } from '../../state/projectStore';

describe('projectStore basic operations', () => {
  beforeEach(() => {
    useProjectStore.getState().resetModel();
  });

  it('creates default model with 3D properties', () => {
    const model = useProjectStore.getState().model;
    expect(model.analysisMode).toBe('3d');
    expect(model.materials.length).toBeGreaterThan(0);
    expect(model.sections.length).toBeGreaterThan(0);
    expect(model.materials[0]!.G).toBeGreaterThan(0);
    expect(model.sections[0]!.Ix).toBeGreaterThan(0);
    expect(model.sections[0]!.Iy).toBeGreaterThan(0);
    expect(model.sections[0]!.Iz).toBeGreaterThan(0);
  });

  it('adds a 3D node with z coordinate', () => {
    const state = useProjectStore.getState();
    const id = state.addNode(1, 2, 3);
    const model = useProjectStore.getState().model;
    const node = model.nodes.find(n => n.id === id);
    expect(node).toBeDefined();
    expect(node!.z).toBe(3);
    expect(node!.restraint.uz).toBe(false);
    expect(node!.restraint.rx).toBe(false);
  });

  it('adds a member with codeAngle and springs', () => {
    const state = useProjectStore.getState();
    const n1 = state.addNode(0, 0, 0);
    const n2 = state.addNode(10, 0, 0);
    const mid = useProjectStore.getState().addMember(n1, n2);
    const model = useProjectStore.getState().model;
    const member = model.members.find(m => m.id === mid);
    expect(member).toBeDefined();
    expect(member!.codeAngle).toBe(0);
    expect(member!.iSprings).toEqual({ x: 0, y: 0, z: 0 });
    expect(member!.torsionRestraint).toBe('none');
  });

  it('updates member torsion restraint', () => {
    const state = useProjectStore.getState();
    const n1 = state.addNode(0, 0, 0);
    const n2 = state.addNode(10, 0, 0);
    const mid = useProjectStore.getState().addMember(n1, n2);

    useProjectStore.getState().updateMember(mid, { torsionRestraint: 'i' });
    const member = useProjectStore.getState().model.members.find(m => m.id === mid);
    expect(member!.torsionRestraint).toBe('i');
  });

  it('rejects 2D X-Z mode when nodes are off the X-Z plane', () => {
    const state = useProjectStore.getState();
    state.addNode(0, 1, 0);

    const result = useProjectStore.getState().setAnalysisMode('xz2d');
    expect(result.ok).toBe(false);
    expect(useProjectStore.getState().model.analysisMode).toBe('3d');
  });

  it('can flatten off-plane nodes before switching to 2D X-Z mode', () => {
    const state = useProjectStore.getState();
    state.addNode(0, 1.25, 0);
    state.addNode(4, 0, 0);

    const convertedIds = useProjectStore.getState().flattenNodesToXzPlane();
    expect(convertedIds).toHaveLength(1);
    expect(useProjectStore.getState().model.nodes.map((n) => n.y)).toEqual([0, 0]);

    const result = useProjectStore.getState().setAnalysisMode('xz2d');
    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().model.analysisMode).toBe('xz2d');
  });

  it('keeps node Y at zero while 2D X-Z mode is active', () => {
    const state = useProjectStore.getState();
    const id = state.addNode(0, 0, 0);

    const result = useProjectStore.getState().setAnalysisMode('xz2d');
    expect(result.ok).toBe(true);

    useProjectStore.getState().updateNode(id, { y: 3 });
    expect(useProjectStore.getState().model.nodes[0]!.y).toBe(0);

    const id2 = useProjectStore.getState().addNode(1, 5, 2);
    const added = useProjectStore.getState().model.nodes.find(n => n.id === id2);
    expect(added!.y).toBe(0);
  });

  it('preserves user restraint values when toggling back from 2D X-Z to 3D', () => {
    const state = useProjectStore.getState();
    const id = state.addNode(0, 0, 0);

    let result = useProjectStore.getState().setAnalysisMode('xz2d');
    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().model.nodes.find(n => n.id === id)!.restraint.uy).toBe(false);
    expect(useProjectStore.getState().model.nodes.find(n => n.id === id)!.restraint.rx).toBe(false);
    expect(useProjectStore.getState().model.nodes.find(n => n.id === id)!.restraint.rz).toBe(false);

    result = useProjectStore.getState().setAnalysisMode('3d');
    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().model.nodes.find(n => n.id === id)!.restraint.uy).toBe(false);
    expect(useProjectStore.getState().model.nodes.find(n => n.id === id)!.restraint.rx).toBe(false);
    expect(useProjectStore.getState().model.nodes.find(n => n.id === id)!.restraint.rz).toBe(false);
  });

  it('imports FrameJson format', () => {
    const frameJson = JSON.stringify({
      title: "Test",
      loadCaseCount: 1,
      loadCaseIndex: 0,
      calcCaseMemo: ["case1"],
      nodes: [
        { number: 1, x: 0, y: 0, z: 0, temperature: 0, intensityGroup: 0, longWeight: 0, forceWeight: 0, addForceWeight: 0, area: 0, loads: [{ p1: 10, p2: 0, p3: 0, m1: 0, m2: 0, m3: 0 }] },
        { number: 2, x: 100, y: 0, z: 0, temperature: 0, intensityGroup: 0, longWeight: 0, forceWeight: 0, addForceWeight: 0, area: 0, loads: [{ p1: 0, p2: 0, p3: 0, m1: 0, m2: 0, m3: 0 }] },
      ],
      members: [
        { number: 1, iNodeNumber: 1, jNodeNumber: 2, ixSpring: 0, iySpring: 0, izSpring: 0, jxSpring: 0, jySpring: 0, jzSpring: 0, sectionNumber: 1, p1: 0, p2: 0, p3: 0, memberLoads: [], cmqLoads: [] },
      ],
      sections: [
        { number: 1, materialNumber: 1, type: 0, shape: 0, p1_A: 10, p2_Ix: 100, p3_Iy: 50, p4_Iz: 50, ky: 0, kz: 0, comment: "sec1" },
      ],
      materials: [
        { number: 1, young: 20500, shear: 7900, expansion: 0, poisson: 0.3, unitLoad: 0, name: "Steel" },
      ],
      boundaries: [
        { nodeNumber: 2, deltaX: 1, deltaY: 1, deltaZ: 1, thetaX: 1, thetaY: 1, thetaZ: 1 },
      ],
      springs: [],
      walls: [],
    });

    useProjectStore.getState().importFrameJson(frameJson);
    const model = useProjectStore.getState().model;

    expect(model.nodes.length).toBe(2);
    expect(model.members.length).toBe(1);
    expect(model.nodalLoads.length).toBe(1);
    expect(model.nodalLoads[0]!.fx).toBe(10);

    // Node IDs should be the original numbers as strings
    expect(model.nodes[0]!.id).toBe('1');
    expect(model.nodes[1]!.id).toBe('2');
    expect(model.members[0]!.id).toBe('1');

    // Node 2 should be fixed
    const fixedNode = model.nodes.find(n => n.id === '2');
    expect(fixedNode).toBeDefined();
    expect(fixedNode!.restraint.ux).toBe(true);
    expect(fixedNode!.restraint.uz).toBe(true);
    expect(fixedNode!.restraint.rz).toBe(true);
  });
});
