import type {
  ProjectModel,
  IndexedModel,
  IndexedNode,
  IndexedMember,
  EndRelease,
  NodeId,
  MemberId,
} from './types';
import { getAnalysisMode, getEffectiveRestraint } from './analysisMode';
import {
  collectTorsionRestraintSourceDofs,
  formatUnsupportedTorsionRestraintMessage,
} from './torsionRestraint';

const RIGID: EndRelease = { type: 'rigid', kTheta: 0 };
const PIN: EndRelease = { type: 'pin', kTheta: 0 };

/**
 * Compute the 3x3 direction cosine matrix (lambda) for a 3D member.
 */
function computeLambda(
  dx: number, dy: number, dz: number, L: number, codeAngle: number
): Float64Array {
  const lambda = new Float64Array(9);

  const lx_x = dx / L;
  const lx_y = dy / L;
  const lx_z = dz / L;

  const isVertical = Math.abs(lx_z) > 0.95;
  const vx = isVertical ? 1 : 0;
  const vy = 0;
  const vz = isVertical ? 0 : 1;

  let cy_x = vy * lx_z - vz * lx_y;
  let cy_y = vz * lx_x - vx * lx_z;
  let cy_z = vx * lx_y - vy * lx_x;
  const cyLen = Math.sqrt(cy_x * cy_x + cy_y * cy_y + cy_z * cy_z);
  cy_x /= cyLen; cy_y /= cyLen; cy_z /= cyLen;

  let cz_x = lx_y * cy_z - lx_z * cy_y;
  let cz_y = lx_z * cy_x - lx_x * cy_z;
  let cz_z = lx_x * cy_y - lx_y * cy_x;

  if (codeAngle !== 0) {
    const theta = codeAngle * Math.PI / 180;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    const ly_x = cy_x * cosT + cz_x * sinT;
    const ly_y = cy_y * cosT + cz_y * sinT;
    const ly_z = cy_z * cosT + cz_z * sinT;

    const lz_x = -cy_x * sinT + cz_x * cosT;
    const lz_y = -cy_y * sinT + cz_y * cosT;
    const lz_z = -cy_z * sinT + cz_z * cosT;

    cy_x = ly_x; cy_y = ly_y; cy_z = ly_z;
    cz_x = lz_x; cz_y = lz_y; cz_z = lz_z;
  }

  lambda[0] = lx_x; lambda[1] = lx_y; lambda[2] = lx_z;
  lambda[3] = cy_x; lambda[4] = cy_y; lambda[5] = cy_z;
  lambda[6] = cz_x; lambda[7] = cz_y; lambda[8] = cz_z;
  return lambda;
}

/**
 * Resolve a spring number to an EndRelease using the Spring table.
 * Convention (matching FrameModelMaker-Web):
 *   spring number 0 → rigid (no spring defined)
 *   spring number 1 → rigid (default rigid)
 *   spring number 2 → pin   (default pin)
 *   spring number ≥ 3 → look up in springs table
 */
function resolveSpring(
  springNumber: number,
  springMap: Map<number, { method: number; kTheta: number }>
): EndRelease {
  if (springNumber <= 0 || springNumber === 1) return RIGID;
  if (springNumber === 2) return PIN;
  const sp = springMap.get(springNumber);
  if (!sp) return RIGID;
  if (sp.method === 0 || sp.kTheta <= 0) return PIN;
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

  // Build spring lookup
  const springMap = new Map(
    (model.springs ?? []).map(s => [s.number, { method: s.method, kTheta: s.kTheta }])
  );

  const nodes: IndexedNode[] = model.nodes.map((n, i) => {
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
    const dz = nodeJ.z - nodeI.z;
    const L = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const section = model.sections.find((sec) => sec.id === m.sectionId);
    if (!section) {
      throw new Error(`部材 ${m.id} の断面 ${m.sectionId} が見つかりません`);
    }

    const material = model.materials.find((mat) => mat.id === section.materialId);
    if (!material) {
      throw new Error(`断面 ${section.id} の材料 ${section.materialId} が見つかりません`);
    }

    const lambda = computeLambda(dx, dy, dz, L, m.codeAngle);

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

    return {
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
      L,
      lambda,
      releases,
    };
  });

  const nodeCount = nodes.length;
  const dofCount = nodeCount * 6;

  // Build DOF mapping for coupling constraints (master-slave)
  const dofMap = new Int32Array(dofCount);
  for (let i = 0; i < dofCount; i++) dofMap[i] = i;

  const couplings = model.couplings ?? [];
  for (const c of couplings) {
    const masterIdx = nodeIdToIndex.get(c.masterNodeId);
    const slaveIdx = nodeIdToIndex.get(c.slaveNodeId);
    if (masterIdx === undefined || slaveIdx === undefined) continue;

    const flags = [c.ux, c.uy, c.uz, c.rx, c.ry, c.rz];
    for (let d = 0; d < 6; d++) {
      if (!flags[d]) continue;
      const slaveDof = slaveIdx * 6 + d;
      const masterDof = masterIdx * 6 + d;
      // Resolve chain: if master itself is a slave, follow the chain
      let resolved = masterDof;
      while (dofMap[resolved] !== resolved) resolved = dofMap[resolved]!;
      dofMap[slaveDof] = resolved;
    }
  }

  return {
    nodes,
    members,
    nodalLoads: model.nodalLoads,
    memberLoads: model.memberLoads,
    nodeCount,
    dofCount,
    nodeIdToIndex,
    memberIdToIndex,
    dofMap,
    extraFixedDofs,
  };
}
