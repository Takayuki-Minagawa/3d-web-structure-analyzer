import type { FrameJsonDocument } from './frameJsonTypes';
import type {
  ProjectModel,
  StructuralNode,
  Material,
  Section,
  Spring,
  Member,
  NodalLoad,
  MemberLoad,
  CMQMemberLoad,
} from '../core/model/types';

let seqCounter = 0;
function nextSeq(): string {
  return String(++seqCounter);
}

/**
 * Convert a FrameJsonDocument to the internal ProjectModel.
 * Uses the original numeric numbers from FrameJson as IDs (string form).
 * Extracts loads from the specified load case index.
 */
export function convertFrameJson(
  doc: FrameJsonDocument,
  loadCaseIndex?: number
): ProjectModel {
  seqCounter = 0;
  const caseIdx = loadCaseIndex ?? doc.loadCaseIndex;

  // Build node number -> boundary map
  const boundaryMap = new Map(
    doc.boundaries.map(b => [b.nodeNumber, b])
  );

  // Build material number -> id map
  const matNumberToId = new Map<number, string>();
  const materials: Material[] = doc.materials.map(m => {
    const id = String(m.number);
    matNumberToId.set(m.number, id);
    return {
      id,
      name: m.name || `Material ${m.number}`,
      E: m.young,
      G: m.shear > 0 ? m.shear : m.young / (2 * (1 + (m.poisson || 0.3))),
      nu: m.poisson || 0.3,
      expansion: m.expansion,
    };
  });

  // Build section number -> id map
  const secNumberToId = new Map<number, string>();
  const sections: Section[] = doc.sections.map(s => {
    const id = String(s.number);
    secNumberToId.set(s.number, id);
    const matId = matNumberToId.get(s.materialNumber) ?? materials[0]?.id ?? '';
    return {
      id,
      name: s.comment || `Section ${s.number}`,
      materialId: matId,
      A: s.p1_A,
      Ix: s.p2_Ix,
      Iy: s.p3_Iy,
      Iz: s.p4_Iz,
      ky: s.ky,
      kz: s.kz,
    };
  });

  // Springs
  const springs: Spring[] = doc.springs.map(s => ({
    id: String(s.number),
    number: s.number,
    method: s.method,
    kTheta: s.kTheta,
  }));

  // Build node number -> id map (use original number as id)
  const nodeNumberToId = new Map<number, string>();
  const nodes: StructuralNode[] = doc.nodes.map(n => {
    const id = String(n.number);
    nodeNumberToId.set(n.number, id);
    const bc = boundaryMap.get(n.number);
    return {
      id,
      x: n.x,
      y: n.y,
      z: n.z,
      restraint: {
        ux: bc ? bc.deltaX !== 0 : false,
        uy: bc ? bc.deltaY !== 0 : false,
        uz: bc ? bc.deltaZ !== 0 : false,
        rx: bc ? bc.thetaX !== 0 : false,
        ry: bc ? bc.thetaY !== 0 : false,
        rz: bc ? bc.thetaZ !== 0 : false,
      },
    };
  });

  // Nodal loads (from active load case)
  const nodalLoads: NodalLoad[] = [];
  for (const n of doc.nodes) {
    const load = n.loads[caseIdx];
    if (!load) continue;
    if (load.p1 === 0 && load.p2 === 0 && load.p3 === 0 &&
        load.m1 === 0 && load.m2 === 0 && load.m3 === 0) continue;
    const nodeId = nodeNumberToId.get(n.number);
    if (!nodeId) continue;
    nodalLoads.push({
      id: `nl${nextSeq()}`,
      nodeId,
      fx: load.p1,
      fy: load.p2,
      fz: load.p3,
      mx: load.m1,
      my: load.m2,
      mz: load.m3,
    });
  }

  // Members and member loads
  const members: Member[] = [];
  const memberLoads: MemberLoad[] = [];

  for (const m of doc.members) {
    const id = String(m.number);
    const ni = nodeNumberToId.get(m.iNodeNumber);
    const nj = nodeNumberToId.get(m.jNodeNumber);
    if (!ni || !nj) continue;

    const secId = secNumberToId.get(m.sectionNumber) ?? sections[0]?.id ?? '';

    members.push({
      id,
      ni,
      nj,
      sectionId: secId,
      codeAngle: m.p3,
      iSprings: { x: m.ixSpring, y: m.iySpring, z: m.izSpring },
      jSprings: { x: m.jxSpring, y: m.jySpring, z: m.jzSpring },
      torsionRestraint: 'none',
    });

    // CMQ loads for this member
    const cmq = m.cmqLoads[caseIdx];
    if (cmq && !(
      cmq.iQx === 0 && cmq.iQy === 0 && cmq.iQz === 0 &&
      cmq.iMy === 0 && cmq.iMz === 0 &&
      cmq.jQx === 0 && cmq.jQy === 0 && cmq.jQz === 0 &&
      cmq.jMy === 0 && cmq.jMz === 0 &&
      cmq.moy === 0 && cmq.moz === 0
    )) {
      const cmqLoad: CMQMemberLoad = {
        id: `cmq${nextSeq()}`,
        memberId: id,
        type: 'cmq',
        iQx: cmq.iQx,
        iQy: cmq.iQy,
        iQz: cmq.iQz,
        iMy: cmq.iMy,
        iMz: cmq.iMz,
        jQx: cmq.jQx,
        jQy: cmq.jQy,
        jQz: cmq.jQz,
        jMy: cmq.jMy,
        jMz: cmq.jMz,
        moy: cmq.moy,
        moz: cmq.moz,
      };
      memberLoads.push(cmqLoad);
    }

    // Member distributed/concentrated loads for this member
    const ml = m.memberLoads[caseIdx];
    if (ml && !(ml.p1 === 0 && ml.p2 === 0 && ml.p3 === 0 &&
                ml.scale === 0 && ml.unitLoad === 0)) {
      const dirMap: Record<number, 'localX' | 'localY' | 'localZ'> = {
        0: 'localX', 1: 'localY', 2: 'localZ',
      };
      const dir = dirMap[ml.direction] ?? 'localY';
      const loadValue = ml.unitLoad * ml.scale || ml.p1;

      if (ml.type === 0 && loadValue !== 0) {
        memberLoads.push({
          id: `ml${nextSeq()}`,
          memberId: id,
          type: 'udl',
          direction: dir,
          value: loadValue,
        });
      } else if (ml.type === 1 && loadValue !== 0) {
        memberLoads.push({
          id: `ml${nextSeq()}`,
          memberId: id,
          type: 'point',
          direction: dir,
          value: loadValue,
          a: ml.p2,
        });
      }
    }
  }

  return {
    title: doc.title || 'Imported Model',
    // FrameJson is imported as a full 3D frame. Native ProjectFile JSON
    // preserves analysisMode when users need 2D-mode round-tripping.
    analysisMode: '3d',
    nodes,
    materials,
    sections,
    springs,
    members,
    couplings: [],
    nodalLoads,
    memberLoads,
    units: { force: 'kN', length: 'cm', moment: 'kN·cm' },
  };
}
