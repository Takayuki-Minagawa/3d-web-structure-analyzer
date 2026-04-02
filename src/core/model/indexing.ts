import type {
  ProjectModel,
  IndexedModel,
  IndexedNode,
  IndexedMember,
  NodeId,
  MemberId,
} from './types';

export function buildIndexedModel(model: ProjectModel): IndexedModel {
  const nodeIdToIndex = new Map<NodeId, number>();
  const memberIdToIndex = new Map<MemberId, number>();

  const nodes: IndexedNode[] = model.nodes.map((n, i) => {
    nodeIdToIndex.set(n.id, i);
    return {
      index: i,
      id: n.id,
      x: n.x,
      y: n.y,
      restraint: { ...n.restraint },
    };
  });

  const members: IndexedMember[] = model.members.map((m, i) => {
    memberIdToIndex.set(m.id, i);

    const niIdx = nodeIdToIndex.get(m.ni);
    const njIdx = nodeIdToIndex.get(m.nj);
    if (niIdx === undefined || njIdx === undefined) {
      throw new Error(
        `部材 ${m.id} の節点参照が見つかりません: ni=${m.ni}, nj=${m.nj}`
      );
    }

    const nodeI = nodes[niIdx]!;
    const nodeJ = nodes[njIdx]!;
    const dx = nodeJ.x - nodeI.x;
    const dy = nodeJ.y - nodeI.y;
    const L = Math.sqrt(dx * dx + dy * dy);

    const material = model.materials.find((mat) => mat.id === m.materialId);
    const section = model.sections.find((sec) => sec.id === m.sectionId);
    if (!material) {
      throw new Error(
        `部材 ${m.id} の材料 ${m.materialId} が見つかりません`
      );
    }
    if (!section) {
      throw new Error(
        `部材 ${m.id} の断面 ${m.sectionId} が見つかりません`
      );
    }

    const nu = material.nu ?? 0.3;
    const G = material.E / (2 * (1 + nu));
    const As = section.As ?? section.A;

    return {
      index: i,
      id: m.id,
      ni: niIdx,
      nj: njIdx,
      E: material.E,
      A: section.A,
      I: section.I,
      L,
      cos: L > 0 ? dx / L : 1,
      sin: L > 0 ? dy / L : 0,
      G,
      As,
    };
  });

  const nodeCount = nodes.length;
  const dofCount = nodeCount * 3;

  return {
    nodes,
    members,
    nodalLoads: model.nodalLoads,
    memberLoads: model.memberLoads,
    nodeCount,
    dofCount,
    nodeIdToIndex,
    memberIdToIndex,
  };
}
