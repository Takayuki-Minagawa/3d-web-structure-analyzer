import type { ProjectModel, AnalysisError } from './types';
import {
  findNodesOffXzPlane,
  findMembersWithUnsupportedXz2dOrientation,
  getAnalysisMode,
  getEffectiveRestraint,
  XZ_2D_MODE,
} from './analysisMode';

const LOAD_TOLERANCE = 1e-9;

function isNonzero(value: number): boolean {
  return Math.abs(value) > LOAD_TOLERANCE;
}

export function validateModel(model: ProjectModel): AnalysisError[] {
  const errors: AnalysisError[] = [];
  const analysisMode = getAnalysisMode(model);
  const isXz2d = analysisMode === XZ_2D_MODE;

  if (isXz2d) {
    const offPlaneNodes = findNodesOffXzPlane(model);
    if (offPlaneNodes.length > 0) {
      errors.push({
        type: 'validation',
        message: `2D X-Z平面モードでは全節点のY座標が0である必要があります。対象節点: ${offPlaneNodes.map((n) => n.id).join(', ')}`,
        nodeId: offPlaneNodes[0]!.id,
      });
    }

    const unsupportedMembers = findMembersWithUnsupportedXz2dOrientation(model);
    if (unsupportedMembers.length > 0) {
      errors.push({
        type: 'validation',
        message: `2D X-Z平面モードでは部材コード角を0度または180度系にしてください。対象部材: ${unsupportedMembers.map((m) => m.id).join(', ')}`,
        elementId: unsupportedMembers[0]!.id,
      });
    }
  }

  // Check: at least one node
  if (model.nodes.length === 0) {
    errors.push({
      type: 'validation',
      message: '節点が1つもありません。少なくとも1つの節点を作成してください。',
    });
  }

  // Check: at least one member
  if (model.members.length === 0) {
    errors.push({
      type: 'validation',
      message: '部材が1つもありません。少なくとも1つの部材を作成してください。',
    });
  }

  // Check: materials
  if (model.materials.length === 0) {
    errors.push({
      type: 'validation',
      message: '材料が定義されていません。',
    });
  }
  for (const mat of model.materials) {
    if (mat.E <= 0) {
      errors.push({
        type: 'validation',
        message: `材料 "${mat.name}" のヤング係数 E が正でありません (E=${mat.E})。`,
        elementId: mat.id,
      });
    }
    if (mat.G <= 0) {
      errors.push({
        type: 'validation',
        message: `材料 "${mat.name}" のせん断弾性係数 G が正でありません (G=${mat.G})。`,
        elementId: mat.id,
      });
    }
  }

  // Check: sections
  if (model.sections.length === 0) {
    errors.push({
      type: 'validation',
      message: '断面が定義されていません。',
    });
  }
  for (const sec of model.sections) {
    if (sec.A <= 0) {
      errors.push({
        type: 'validation',
        message: `断面 "${sec.name}" の断面積 A が正でありません (A=${sec.A})。`,
        elementId: sec.id,
      });
    }
    if (sec.Ix < 0) {
      errors.push({
        type: 'validation',
        message: `断面 "${sec.name}" のねじり定数 Ix が負です (Ix=${sec.Ix})。`,
        elementId: sec.id,
      });
    }
    if (sec.Iy <= 0) {
      errors.push({
        type: 'validation',
        message: `断面 "${sec.name}" の断面二次モーメント Iy が正でありません (Iy=${sec.Iy})。`,
        elementId: sec.id,
      });
    }
    if (sec.Iz <= 0) {
      errors.push({
        type: 'validation',
        message: `断面 "${sec.name}" の断面二次モーメント Iz が正でありません (Iz=${sec.Iz})。`,
        elementId: sec.id,
      });
    }
  }

  const nodeIds = new Set(model.nodes.map((n) => n.id));

  // Check: members
  for (const m of model.members) {
    if (!nodeIds.has(m.ni)) {
      errors.push({
        type: 'validation',
        message: `部材 ${m.id} の始端節点 ${m.ni} が存在しません。`,
        elementId: m.id,
      });
    }
    if (!nodeIds.has(m.nj)) {
      errors.push({
        type: 'validation',
        message: `部材 ${m.id} の終端節点 ${m.nj} が存在しません。`,
        elementId: m.id,
      });
    }

    // Zero-length member (3D distance)
    const ni = model.nodes.find((n) => n.id === m.ni);
    const nj = model.nodes.find((n) => n.id === m.nj);
    if (ni && nj) {
      const dx = nj.x - ni.x;
      const dy = nj.y - ni.y;
      const dz = nj.z - ni.z;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-10) {
        errors.push({
          type: 'validation',
          message: `部材 ${m.id} の長さが 0 です。節点座標を確認してください。`,
          elementId: m.id,
        });
      }
    }

    // Section reference
    if (!model.sections.some((sec) => sec.id === m.sectionId)) {
      errors.push({
        type: 'validation',
        message: `部材 ${m.id} の断面 ${m.sectionId} が見つかりません。`,
        elementId: m.id,
      });
    }
  }

  // Check: constraint sufficiency (3 translational directions)
  const effectiveRestraints = model.nodes.map((n) =>
    getEffectiveRestraint(n.restraint, analysisMode)
  );
  const hasUx = effectiveRestraints.some((r) => r.ux);
  const hasUy = effectiveRestraints.some((r) => r.uy);
  const hasUz = effectiveRestraints.some((r) => r.uz);
  if (!hasUx || !hasUy || !hasUz) {
    errors.push({
      type: 'validation',
      message:
        '拘束不足の可能性があります。少なくともX, Y, Z 各方向の並進拘束が必要です。',
    });
  }

  // Check: isolated nodes
  const connectedNodes = new Set<string>();
  for (const m of model.members) {
    connectedNodes.add(m.ni);
    connectedNodes.add(m.nj);
  }
  for (const n of model.nodes) {
    if (!connectedNodes.has(n.id) && model.members.length > 0) {
      errors.push({
        type: 'validation',
        message: `節点 ${n.id} はどの部材にも接続されていません（孤立節点）。`,
        nodeId: n.id,
      });
    }
  }

  // Check: member loads
  const memberIds = new Set(model.members.map((m) => m.id));
  for (const ml of model.memberLoads) {
    if (!memberIds.has(ml.memberId)) {
      errors.push({
        type: 'validation',
        message: `部材荷重 ${ml.id} の対象部材 ${ml.memberId} が見つかりません。`,
        elementId: ml.id,
      });
    }
    if (isXz2d) {
      if ((ml.type === 'point' || ml.type === 'udl') &&
          ml.direction === 'localY' &&
          isNonzero(ml.value)) {
        errors.push({
          type: 'validation',
          message: `2D X-Z平面モードでは部材荷重 ${ml.id} の localY 方向荷重は使用できません。localX または localZ を使用してください。`,
          elementId: ml.id,
        });
      }
      if (ml.type === 'cmq') {
        const invalid = [
          ['iQy', ml.iQy],
          ['jQy', ml.jQy],
          ['iMz', ml.iMz],
          ['jMz', ml.jMz],
          ['moz', ml.moz],
        ].filter(([, value]) => isNonzero(value as number));
        if (invalid.length > 0) {
          errors.push({
            type: 'validation',
            message: `2D X-Z平面モードではCMQ荷重 ${ml.id} の面外成分 (${invalid.map(([name]) => name).join(', ')}) は使用できません。`,
            elementId: ml.id,
          });
        }
      }
    }
  }

  // Check: nodal loads
  for (const nl of model.nodalLoads) {
    if (!nodeIds.has(nl.nodeId)) {
      errors.push({
        type: 'validation',
        message: `節点荷重 ${nl.id} の対象節点 ${nl.nodeId} が見つかりません。`,
        nodeId: nl.nodeId,
      });
    }
    if (isXz2d) {
      const invalid = [
        ['fy', nl.fy],
        ['mx', nl.mx],
        ['mz', nl.mz],
      ].filter(([, value]) => isNonzero(value as number));
      if (invalid.length > 0) {
        errors.push({
          type: 'validation',
          message: `2D X-Z平面モードでは節点荷重 ${nl.id} の面外成分 (${invalid.map(([name]) => name).join(', ')}) は使用できません。fx, fz, my を使用してください。`,
          nodeId: nl.nodeId,
        });
      }
    }
  }

  return errors;
}
