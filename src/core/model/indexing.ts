import type {
  ProjectModel,
  IndexedModel,
  IndexedNode,
  IndexedMember,
  IndexedNodalSpringSupport,
  EndRelease,
  NodeId,
  MemberId,
} from './types';
import { getAnalysisMode, getEffectiveRestraint } from './analysisMode';
import { computeMemberLocalAxes } from './localAxes';
import { resolveDofMap } from './couplings';
import { buildLocalStiffness } from '../analysis/element3dFrame';
import { buildTransformationMatrix } from '../analysis/transforms';
import {
  collectTorsionRestraintSourceDofs,
  formatUnsupportedTorsionRestraintMessage,
} from './torsionRestraint';

const RIGID: EndRelease = { type: 'rigid', kTheta: 0 };
const PIN: EndRelease = { type: 'pin', kTheta: 0 };

/**
 * Resolve a spring number to an EndRelease using the Spring table.
 * Convention (matching FrameModelMaker-Web):
 *   spring number 0 → rigid (no spring defined)
 *   spring number 1 → rigid (default rigid)
 *   spring number 2 → pin   (default pin)
 *   spring number ≥ 3 → finite spring when kTheta > 0, pin when kTheta = 0
 *
 * FrameModelMaker-Web reserves 1/2 for the connection types. A custom
 * spring's `method` is source-format metadata, not a rigid/pin selector.
 */
function resolveSpring(
  springNumber: number,
  springMap: Map<number, { kTheta: number }>
): EndRelease {
  if (!Number.isInteger(springNumber) || springNumber < 0) {
    throw new Error(`回転バネ番号が非負整数ではありません (${springNumber})。`);
  }
  if (springNumber === 0 || springNumber === 1) return RIGID;
  if (springNumber === 2) return PIN;
  const sp = springMap.get(springNumber);
  if (!sp) throw new Error(`回転バネ番号 ${springNumber} が見つかりません。`);
  if (!Number.isFinite(sp.kTheta) || sp.kTheta < 0) {
    throw new Error(`回転バネ番号 ${springNumber} の剛性が不正です (kTheta=${sp.kTheta})。`);
  }
  if (sp.kTheta === 0) return PIN;
  return { type: 'spring', kTheta: sp.kTheta };
}

export function buildIndexedModel(model: ProjectModel): IndexedModel {
  const nodeIdToIndex = new Map<NodeId, number>();
  const memberIdToIndex = new Map<MemberId, number>();
  const analysisMode = getAnalysisMode(model);
  const torsionDofs = collectTorsionRestraintSourceDofs(model);
  if (torsionDofs.unsupportedMembers.length > 0) {
    throw new Error(formatUnsupportedTorsionRestraintMessage(torsionDofs.unsupportedMembers[0]!.id));
  }
  const extraFixedDofs = torsionDofs.entries.map((entry) => entry.sourceDof);
  const sectionById = new Map(model.sections.map((section) => [section.id, section]));
  const materialById = new Map(model.materials.map((material) => [material.id, material]));

  // Build spring lookup
  const springMap = new Map<number, { kTheta: number }>();
  for (const spring of model.springs ?? []) {
    if (springMap.has(spring.number)) {
      throw new Error(`バネ番号 ${spring.number} が重複しています。`);
    }
    springMap.set(spring.number, { kTheta: spring.kTheta });
  }

  const nodes: IndexedNode[] = model.nodes.map((n, i) => {
    if (nodeIdToIndex.has(n.id)) {
      throw new Error(`節点 ID "${n.id}" が重複しています。`);
    }
    nodeIdToIndex.set(n.id, i);
    return {
      index: i,
      id: n.id,
      x: n.x,
      y: n.y,
      z: n.z,
      restraint: getEffectiveRestraint(n.restraint, analysisMode),
    };
  });

  const members: IndexedMember[] = model.members.map((m, i) => {
    if (memberIdToIndex.has(m.id)) {
      throw new Error(`部材 ID "${m.id}" が重複しています。`);
    }
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
    const axes = computeMemberLocalAxes(nodeI, nodeJ, m.codeAngle);
    if (!axes) {
      throw new Error(`部材 ${m.id} の形状またはコード角が不正です。`);
    }
    const { length: L, lambda } = axes;

    const section = sectionById.get(m.sectionId);
    if (!section) {
      throw new Error(`部材 ${m.id} の断面 ${m.sectionId} が見つかりません`);
    }

    const material = materialById.get(section.materialId);
    if (!material) {
      throw new Error(`断面 ${section.id} の材料 ${section.materialId} が見つかりません`);
    }

    // Resolve end releases from spring numbers
    const iSpr = m.iSprings ?? { x: 0, y: 0, z: 0 };
    const jSpr = m.jSprings ?? { x: 0, y: 0, z: 0 };
    const releases: [EndRelease, EndRelease, EndRelease, EndRelease, EndRelease, EndRelease] = [
      resolveSpring(iSpr.x, springMap), // ix → DOF 3
      resolveSpring(iSpr.y, springMap), // iy → DOF 4
      resolveSpring(iSpr.z, springMap), // iz → DOF 5
      resolveSpring(jSpr.x, springMap), // jx → DOF 9
      resolveSpring(jSpr.y, springMap), // jy → DOF 10
      resolveSpring(jSpr.z, springMap), // jz → DOF 11
    ];

    const indexedMember: IndexedMember = {
      index: i,
      id: m.id,
      ni: niIdx,
      nj: njIdx,
      E: material.E,
      G: material.G,
      A: section.A,
      Ix: section.Ix,
      Iy: section.Iy,
      Iz: section.Iz,
      ky: section.ky,
      kz: section.kz,
      expansion: material.expansion,
      density: material.density ?? 0,
      L,
      lambda,
      releases,
    };
    indexedMember.localStiffness = buildLocalStiffness(indexedMember);
    indexedMember.transformation = buildTransformationMatrix(indexedMember);
    return indexedMember;
  });

  const nodeCount = nodes.length;
  const dofCount = nodeCount * 6;

  const dofMap = resolveDofMap(model, nodeIdToIndex);

  const nodeSpringIds = new Set<string>();
  const nodeSprings: IndexedNodalSpringSupport[] = (model.nodeSprings ?? []).map((spring) => {
    if (nodeSpringIds.has(spring.id)) {
      throw new Error(`節点バネ ID "${spring.id}" が重複しています。`);
    }
    nodeSpringIds.add(spring.id);
    const nodeIndex = nodeIdToIndex.get(spring.nodeId);
    if (nodeIndex === undefined) {
      throw new Error(`節点バネ ${spring.id} の節点 ${spring.nodeId} が見つかりません。`);
    }
    return { ...spring, nodeIndex };
  });

  const gravity = model.gravity ?? { x: 0, y: 0, z: 0 };

  return {
    nodes,
    members,
    nodalLoads: model.nodalLoads,
    memberLoads: model.memberLoads,
    prescribedDisplacements: model.prescribedDisplacements ?? [],
    nodeSprings,
    gravity: { ...gravity },
    nodeCount,
    dofCount,
    nodeIdToIndex,
    memberIdToIndex,
    dofMap,
    extraFixedDofs,
  };
}
