import type {
  AnalysisError,
  AnalysisMode,
  Material,
  Member,
  MemberLoad,
  ProjectModel,
  Section,
  StructuralNode,
} from './types';
import {
  findMembersWithUnsupported2dOrientation,
  findNodesOffAnalysisPlane,
  getAnalysisMode,
  get2dModeConfig,
  getEffectiveRestraint,
  getMemberOutOfPlaneLocalAxes,
  type TwoDimensionalModeConfig,
} from './analysisMode';
import {
  findMembersWithUnsupportedTorsionRestraint,
  formatUnsupportedTorsionRestraintMessage,
} from './torsionRestraint';
import { findCouplingIssues, isActiveNodeCoupling } from './couplings';
import { memberLabel, nodeLabel } from './displayNumbers';
import { DOF_NAMES, dofValues } from './restraints';

const RELATIVE_LOAD_TOLERANCE = 1e-12;
/** Relative slack for load positions compared against computed member lengths. */
const POSITION_TOLERANCE = 1e-9;

interface LoadScaleContext {
  representativeLength: number;
  forceScale: number;
  memberLengths: Map<string, number>;
}

/** Lookups shared by the individual validation passes. */
interface ValidationContext {
  model: ProjectModel;
  errors: AnalysisError[];
  analysisMode: AnalysisMode;
  twoDimensionalConfig: TwoDimensionalModeConfig | null;
  loadScale: LoadScaleContext;
  nodeById: Map<string, StructuralNode>;
  memberById: Map<string, Member>;
  sectionById: Map<string, Section>;
  materialById: Map<string, Material>;
  nodeReferenceLabel: (id: string) => string;
  memberReferenceLabel: (id: string) => string;
}

type ModelLookups = Pick<
  ValidationContext,
  'nodeById' | 'memberById' | 'sectionById' | 'materialById'
>;

function memberMaterial(
  lookups: ModelLookups,
  memberId: string
): { section: Section | undefined; material: Material | undefined } {
  const member = lookups.memberById.get(memberId);
  const section = member ? lookups.sectionById.get(member.sectionId) : undefined;
  const material = section ? lookups.materialById.get(section.materialId) : undefined;
  return { section, material };
}

function createLoadScaleContext(model: ProjectModel, lookups: ModelLookups): LoadScaleContext {
  const memberLengths = new Map<string, number>();
  let representativeLength = 0;
  for (const member of model.members) {
    const nodeI = lookups.nodeById.get(member.ni);
    const nodeJ = lookups.nodeById.get(member.nj);
    if (!nodeI || !nodeJ) continue;
    const length = Math.hypot(nodeJ.x - nodeI.x, nodeJ.y - nodeI.y, nodeJ.z - nodeI.z);
    if (!Number.isFinite(length)) continue;
    memberLengths.set(member.id, length);
    representativeLength = Math.max(representativeLength, length);
  }
  const lengthScale = representativeLength > 0 ? representativeLength : 1;
  let forceScale = 0;
  for (const load of model.nodalLoads) {
    forceScale = Math.max(
      forceScale,
      Math.abs(load.fx), Math.abs(load.fy), Math.abs(load.fz),
      Math.abs(load.mx) / lengthScale,
      Math.abs(load.my) / lengthScale,
      Math.abs(load.mz) / lengthScale
    );
  }
  for (const load of model.memberLoads) {
    const memberLength = memberLengths.get(load.memberId) ?? lengthScale;
    if (load.type === 'point') forceScale = Math.max(forceScale, Math.abs(load.value));
    else if (load.type === 'udl') forceScale = Math.max(forceScale, Math.abs(load.value) * memberLength);
    else if (load.type === 'trapezoid') {
      forceScale = Math.max(
        forceScale,
        Math.max(Math.abs(load.value), Math.abs(load.valueEnd)) * memberLength
      );
    } else if (load.type === 'temperature' || load.type === 'selfWeight') {
      const { section, material } = memberMaterial(lookups, load.memberId);
      if (load.type === 'temperature') {
        forceScale = Math.max(
          forceScale,
          Math.abs((material?.E ?? 0) * (section?.A ?? 0)
            * (material?.expansion ?? 0) * load.value)
        );
      } else {
        const gravity = model.gravity ?? { x: 0, y: 0, z: 0 };
        forceScale = Math.max(
          forceScale,
          Math.abs((material?.density ?? 0) * (section?.A ?? 0)
            * Math.hypot(gravity.x, gravity.y, gravity.z) * load.value * memberLength)
        );
      }
    }
    else if (load.type === 'cmq') {
      forceScale = Math.max(
        forceScale,
        Math.abs(load.iQx), Math.abs(load.iQy), Math.abs(load.iQz),
        Math.abs(load.jQx), Math.abs(load.jQy), Math.abs(load.jQz),
        Math.abs(load.iMy) / lengthScale, Math.abs(load.iMz) / lengthScale,
        Math.abs(load.jMy) / lengthScale, Math.abs(load.jMz) / lengthScale,
        Math.abs(load.moy) / lengthScale, Math.abs(load.moz) / lengthScale
      );
    }
  }
  if (!Number.isFinite(forceScale)) forceScale = 0;
  return { representativeLength: lengthScale, forceScale, memberLengths };
}

function isRelativelyNonzero(valueAsForce: number, forceScale: number): boolean {
  if (!Number.isFinite(valueAsForce)) return true;
  return Math.abs(valueAsForce) > forceScale * RELATIVE_LOAD_TOLERANCE;
}

function findDuplicateIds(items: readonly { id: string }[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) duplicates.add(item.id);
    else seen.add(item.id);
  }
  return [...duplicates];
}

function createValidationContext(model: ProjectModel): ValidationContext {
  const analysisMode = getAnalysisMode(model);
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const memberById = new Map(model.members.map((member) => [member.id, member]));
  const lookups: ModelLookups = {
    nodeById,
    memberById,
    sectionById: new Map(model.sections.map((section) => [section.id, section])),
    materialById: new Map(model.materials.map((material) => [material.id, material])),
  };
  return {
    model,
    errors: [],
    analysisMode,
    twoDimensionalConfig: get2dModeConfig(analysisMode),
    loadScale: createLoadScaleContext(model, lookups),
    ...lookups,
    nodeReferenceLabel: (id) => {
      const node = nodeById.get(id);
      return node ? nodeLabel(node) : id;
    },
    memberReferenceLabel: (id) => {
      const member = memberById.get(id);
      return member ? memberLabel(member) : id;
    },
  };
}

function validateTwoDimensionalGeometry(context: ValidationContext): void {
  const { model, errors, analysisMode, twoDimensionalConfig } = context;
  if (!twoDimensionalConfig) return;

  const offPlaneNodes = findNodesOffAnalysisPlane(model, analysisMode);
  if (offPlaneNodes.length > 0) {
    errors.push({
      type: 'validation',
      message: `2D ${twoDimensionalConfig.planeLabel}平面モードでは全節点の${twoDimensionalConfig.lockedCoordinateLabel}座標が0である必要があります。対象節点: ${offPlaneNodes.map(nodeLabel).join(', ')}`,
      nodeId: offPlaneNodes[0]!.id,
    });
  }

  const unsupportedMembers = findMembersWithUnsupported2dOrientation(model, analysisMode);
  if (unsupportedMembers.length > 0) {
    errors.push({
      type: 'validation',
      message: `2D ${twoDimensionalConfig.planeLabel}平面モードでは部材コード角を0度または180度系にしてください。対象部材: ${unsupportedMembers.map(memberLabel).join(', ')}`,
      elementId: unsupportedMembers[0]!.id,
    });
  }
}

function validateModelSize({ model, errors }: ValidationContext): void {
  if (model.nodes.length === 0) {
    errors.push({
      type: 'validation',
      message: '節点が1つもありません。少なくとも1つの節点を作成してください。',
    });
  }
  if (model.members.length === 0) {
    errors.push({
      type: 'validation',
      message: '部材が1つもありません。少なくとも1つの部材を作成してください。',
    });
  }
}

function validateUniqueIds({ model, errors }: ValidationContext): void {
  const idGroups: Array<{
    label: string;
    items: readonly { id: string }[];
    location?: 'node' | 'element';
  }> = [
    { label: '節点', items: model.nodes, location: 'node' },
    { label: '部材', items: model.members, location: 'element' },
    { label: '材料', items: model.materials },
    { label: '断面', items: model.sections },
    { label: 'バネ', items: model.springs ?? [] },
    { label: '節点バネ', items: model.nodeSprings ?? [] },
    { label: '節点荷重', items: model.nodalLoads },
    { label: '部材荷重', items: model.memberLoads },
    { label: 'カップリング', items: model.couplings ?? [] },
    { label: '強制変位', items: model.prescribedDisplacements ?? [] },
    { label: '節点質量', items: model.nodeMasses ?? [] },
  ];
  for (const group of idGroups) {
    for (const duplicateId of findDuplicateIds(group.items)) {
      const error: AnalysisError = {
        type: 'validation',
        message: `${group.label} ID "${duplicateId}" が重複しています。`,
      };
      if (group.location === 'node') error.nodeId = duplicateId;
      else if (group.location === 'element') error.elementId = duplicateId;
      errors.push(error);
    }
  }
}

function validateNodeCoordinates({ model, errors }: ValidationContext): void {
  for (const node of model.nodes) {
    const invalidCoordinates = (['x', 'y', 'z'] as const)
      .filter((coordinate) => !Number.isFinite(node[coordinate]));
    if (invalidCoordinates.length > 0) {
      errors.push({
        type: 'validation',
        message: `節点 ${nodeLabel(node)} の座標 (${invalidCoordinates.join(', ')}) が有限値ではありません。`,
        nodeId: node.id,
      });
    }
  }
}

function validateMaterials({ model, errors }: ValidationContext): void {
  if (model.materials.length === 0) {
    errors.push({
      type: 'validation',
      message: '材料が定義されていません。',
    });
  }
  for (const mat of model.materials) {
    if (!Number.isFinite(mat.E) || mat.E <= 0) {
      errors.push({
        type: 'validation',
        message: `材料 "${mat.name}" のヤング係数 E が正でありません (E=${mat.E})。`,
      });
    }
    if (!Number.isFinite(mat.G) || mat.G <= 0) {
      errors.push({
        type: 'validation',
        message: `材料 "${mat.name}" のせん断弾性係数 G が正でありません (G=${mat.G})。`,
      });
    }
    if (!Number.isFinite(mat.expansion)) {
      errors.push({
        type: 'validation',
        message: `材料 "${mat.name}" の線膨張係数が有限値ではありません (expansion=${mat.expansion})。`,
      });
    }
    if (mat.density !== undefined && (!Number.isFinite(mat.density) || mat.density < 0)) {
      errors.push({
        type: 'validation',
        message: `材料 "${mat.name}" の密度が有限な非負値ではありません (density=${mat.density})。`,
      });
    }
  }
}

function validateSections({ model, errors }: ValidationContext): void {
  if (model.sections.length === 0) {
    errors.push({
      type: 'validation',
      message: '断面が定義されていません。',
    });
  }
  for (const sec of model.sections) {
    if (!Number.isFinite(sec.A) || sec.A <= 0) {
      errors.push({
        type: 'validation',
        message: `断面 "${sec.name}" の断面積 A が正でありません (A=${sec.A})。`,
      });
    }
    if (!Number.isFinite(sec.Ix) || sec.Ix < 0) {
      errors.push({
        type: 'validation',
        message: `断面 "${sec.name}" のねじり定数 Ix が有限な非負値ではありません (Ix=${sec.Ix})。`,
      });
    }
    if (!Number.isFinite(sec.Iy) || sec.Iy <= 0) {
      errors.push({
        type: 'validation',
        message: `断面 "${sec.name}" の断面二次モーメント Iy が正でありません (Iy=${sec.Iy})。`,
      });
    }
    if (!Number.isFinite(sec.Iz) || sec.Iz <= 0) {
      errors.push({
        type: 'validation',
        message: `断面 "${sec.name}" の断面二次モーメント Iz が正でありません (Iz=${sec.Iz})。`,
      });
    }
    for (const shearRatio of ['ky', 'kz'] as const) {
      if (!Number.isFinite(sec[shearRatio]) || sec[shearRatio] < 0) {
        errors.push({
          type: 'validation',
          message: `断面 "${sec.name}" のせん断面積比 ${shearRatio} が有限な非負値ではありません (${shearRatio}=${sec[shearRatio]})。`,
        });
      }
    }
  }
}

/** Validates the rotational spring table and returns the declared numbers. */
function validateSprings({ model, errors }: ValidationContext): Set<number> {
  const springNumbers = new Set<number>();
  for (const spring of model.springs ?? []) {
    if (!Number.isInteger(spring.number) || spring.number < 0) {
      errors.push({
        type: 'validation',
        message: `バネ ${spring.id} の番号が非負整数ではありません (number=${spring.number})。`,
      });
    }
    if (springNumbers.has(spring.number)) {
      errors.push({
        type: 'validation',
        message: `バネ番号 ${spring.number} が重複しています。`,
      });
    }
    springNumbers.add(spring.number);
    if (!Number.isFinite(spring.kTheta) || spring.kTheta < 0) {
      errors.push({
        type: 'validation',
        message: `バネ ${spring.id} の回転剛性 kTheta が有限な非負値ではありません (kTheta=${spring.kTheta})。`,
      });
    }
  }
  return springNumbers;
}

function validateGravity({ model, errors }: ValidationContext): void {
  const gravity = model.gravity;
  if (!gravity) return;
  const invalidGravity = (['x', 'y', 'z'] as const)
    .filter((component) => !Number.isFinite(gravity[component]));
  if (invalidGravity.length > 0) {
    errors.push({
      type: 'validation',
      message: `重力加速度の成分 (${invalidGravity.join(', ')}) が有限値ではありません。`,
    });
  }
}

function validateNodeSprings(context: ValidationContext): void {
  const { model, errors, nodeById, nodeReferenceLabel } = context;
  for (const spring of model.nodeSprings ?? []) {
    if (!nodeById.has(spring.nodeId)) {
      errors.push({
        type: 'validation',
        message: `節点バネ ${spring.id} の対象節点 ${nodeReferenceLabel(spring.nodeId)} が見つかりません。`,
        nodeId: spring.nodeId,
      });
    }
    const invalid = DOF_NAMES
      .filter((component) => !Number.isFinite(spring[component]) || spring[component] < 0);
    if (invalid.length > 0) {
      errors.push({
        type: 'validation',
        message: `節点バネ ${spring.id} の剛性成分 (${invalid.join(', ')}) が有限な非負値ではありません。`,
        nodeId: spring.nodeId,
      });
    }
  }
}

function validateCouplingsAndTorsionRestraints({ model, errors }: ValidationContext): void {
  for (const issue of findCouplingIssues(model)) {
    errors.push({
      type: 'validation',
      message: issue.message,
    });
  }
  for (const member of findMembersWithUnsupportedTorsionRestraint(model)) {
    errors.push({
      type: 'validation',
      message: formatUnsupportedTorsionRestraintMessage(memberLabel(member)),
      elementId: member.id,
    });
  }
}

function validateMembers(context: ValidationContext, springNumbers: ReadonlySet<number>): void {
  const { model, errors, nodeById, sectionById, nodeReferenceLabel } = context;
  for (const m of model.members) {
    const displayMember = memberLabel(m);
    if (!Number.isFinite(m.codeAngle)) {
      errors.push({
        type: 'validation',
        message: `部材 ${displayMember} のコード角が有限値ではありません (codeAngle=${m.codeAngle})。`,
        elementId: m.id,
      });
    }
    const ni = nodeById.get(m.ni);
    const nj = nodeById.get(m.nj);
    if (!ni) {
      errors.push({
        type: 'validation',
        message: `部材 ${displayMember} の始端節点 ${nodeReferenceLabel(m.ni)} が存在しません。`,
        elementId: m.id,
      });
    }
    if (!nj) {
      errors.push({
        type: 'validation',
        message: `部材 ${displayMember} の終端節点 ${nodeReferenceLabel(m.nj)} が存在しません。`,
        elementId: m.id,
      });
    }

    // Zero-length member (3D distance)
    if (ni && nj) {
      const dx = nj.x - ni.x;
      const dy = nj.y - ni.y;
      const dz = nj.z - ni.z;
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (L < 1e-10) {
        errors.push({
          type: 'validation',
          message: `部材 ${displayMember} の長さが 0 です。節点 ${nodeLabel(ni)} / ${nodeLabel(nj)} の座標を確認してください。`,
          elementId: m.id,
        });
      }
    }

    // Section reference
    if (!sectionById.has(m.sectionId)) {
      errors.push({
        type: 'validation',
        message: `部材 ${displayMember} の断面 ${m.sectionId} が見つかりません。`,
        elementId: m.id,
      });
    }

    const springAssignments = [
      ['ix', m.iSprings?.x ?? 0],
      ['iy', m.iSprings?.y ?? 0],
      ['iz', m.iSprings?.z ?? 0],
      ['jx', m.jSprings?.x ?? 0],
      ['jy', m.jSprings?.y ?? 0],
      ['jz', m.jSprings?.z ?? 0],
    ] as const;
    for (const [endDof, springNumber] of springAssignments) {
      if (!Number.isInteger(springNumber) || springNumber < 0) {
        errors.push({
          type: 'validation',
          message: `部材 ${displayMember} の ${endDof} バネ番号が非負整数ではありません (${springNumber})。`,
          elementId: m.id,
        });
      } else if (springNumber >= 3 && !springNumbers.has(springNumber)) {
        errors.push({
          type: 'validation',
          message: `部材 ${displayMember} の ${endDof} が参照するバネ番号 ${springNumber} が見つかりません。`,
          elementId: m.id,
        });
      }
    }
  }
}

/** Constraint sufficiency: every translational direction needs a support. */
function validateSupportSufficiency({ model, errors, analysisMode }: ValidationContext): void {
  const effectiveRestraints = model.nodes.map((n) =>
    getEffectiveRestraint(n.restraint, analysisMode)
  );
  const supportSprings = model.nodeSprings ?? [];
  const hasUx = effectiveRestraints.some((r) => r.ux) || supportSprings.some((spring) => spring.ux > 0);
  const hasUy = effectiveRestraints.some((r) => r.uy) || supportSprings.some((spring) => spring.uy > 0);
  const hasUz = effectiveRestraints.some((r) => r.uz) || supportSprings.some((spring) => spring.uz > 0);
  if (!hasUx || !hasUy || !hasUz) {
    errors.push({
      type: 'validation',
      message:
        '拘束不足の可能性があります。少なくともX, Y, Z 各方向の並進拘束が必要です。',
    });
  }
}

function validateIsolatedNodes({ model, errors, analysisMode, nodeById }: ValidationContext): void {
  const connectedNodes = new Set<string>();
  for (const m of model.members) {
    connectedNodes.add(m.ni);
    connectedNodes.add(m.nj);
  }
  for (const spring of model.nodeSprings ?? []) {
    if (dofValues(spring).some((stiffness) => stiffness > 0)) {
      connectedNodes.add(spring.nodeId);
    }
  }
  const nodeIds = new Set(nodeById.keys());
  for (const coupling of model.couplings ?? []) {
    if (isActiveNodeCoupling(coupling, nodeIds)) {
      connectedNodes.add(coupling.masterNodeId);
      connectedNodes.add(coupling.slaveNodeId);
    }
  }
  for (const n of model.nodes) {
    const fullyRestrained = dofValues(getEffectiveRestraint(n.restraint, analysisMode)).every(Boolean);
    if (!connectedNodes.has(n.id) && !fullyRestrained && model.members.length > 0) {
      errors.push({
        type: 'validation',
        message: `節点 ${nodeLabel(n)} はどの部材にも接続されていません（孤立節点）。`,
        nodeId: n.id,
      });
    }
  }
}

function memberLength(context: ValidationContext, memberId: string): number | undefined {
  const member = context.memberById.get(memberId);
  const nodeI = member ? context.nodeById.get(member.ni) : undefined;
  const nodeJ = member ? context.nodeById.get(member.nj) : undefined;
  if (!nodeI || !nodeJ) return undefined;
  const length = Math.hypot(nodeJ.x - nodeI.x, nodeJ.y - nodeI.y, nodeJ.z - nodeI.z);
  return Number.isFinite(length) ? length : undefined;
}

function validateMemberLoad(context: ValidationContext, ml: MemberLoad): void {
  const { model, errors, memberById, memberReferenceLabel } = context;
  const displayMember = memberReferenceLabel(ml.memberId);
  if (!memberById.has(ml.memberId)) {
    errors.push({
      type: 'validation',
      message: `部材荷重 ${ml.id} の対象部材 ${displayMember} が見つかりません。`,
      elementId: ml.memberId,
    });
  }
  if (ml.type === 'point') {
    if (!Number.isFinite(ml.a)) {
      errors.push({
        type: 'validation',
        message: `集中荷重 ${ml.id}（対象 ${displayMember}）の位置 a が有限値ではありません (a=${ml.a})。`,
        elementId: ml.memberId,
      });
    } else {
      const length = memberLength(context, ml.memberId);
      if (length !== undefined && (ml.a < 0 || ml.a > length)) {
        errors.push({
          type: 'validation',
          message: `集中荷重 ${ml.id} の位置 a=${ml.a} は部材 ${displayMember} の範囲 0〜${length} 外です。`,
          elementId: ml.memberId,
        });
      }
    }
  }
  if (ml.type === 'trapezoid') {
    if (!Number.isFinite(ml.a) || !Number.isFinite(ml.b)) {
      errors.push({
        type: 'validation',
        message: `分布荷重 ${ml.id}（対象 ${displayMember}）の範囲 a, b が有限値ではありません (a=${ml.a}, b=${ml.b})。`,
        elementId: ml.memberId,
      });
    } else {
      const length = memberLength(context, ml.memberId);
      const tolerance = POSITION_TOLERANCE * Math.max(length ?? 1, 1);
      if (!(ml.b > ml.a) || ml.a < -tolerance || (length !== undefined && ml.b > length + tolerance)) {
        errors.push({
          type: 'validation',
          message: `分布荷重 ${ml.id} の範囲 a=${ml.a}, b=${ml.b} は部材 ${displayMember} の範囲 0〜${length ?? '?'} 内で a < b である必要があります。`,
          elementId: ml.memberId,
        });
      }
    }
    if (!Number.isFinite(ml.valueEnd)) {
      errors.push({
        type: 'validation',
        message: `部材荷重 ${ml.id}（対象 ${displayMember}）の終端荷重値が有限値ではありません (valueEnd=${ml.valueEnd})。`,
        elementId: ml.memberId,
      });
    }
  }
  if (ml.type !== 'cmq' && !Number.isFinite(ml.value)) {
    errors.push({
      type: 'validation',
      message: `部材荷重 ${ml.id}（対象 ${displayMember}）の荷重値が有限値ではありません (value=${ml.value})。`,
      elementId: ml.memberId,
    });
  }
  if (ml.type === 'selfWeight') {
    const { material } = memberMaterial(context, ml.memberId);
    if (!material || !(material.density !== undefined && material.density > 0)) {
      errors.push({
        type: 'validation',
        message: `自重荷重 ${ml.id}（対象 ${displayMember}）には正の材料密度が必要です。`,
        elementId: ml.memberId,
      });
    }
    const gravity = model.gravity;
    if (!gravity || Math.hypot(gravity.x, gravity.y, gravity.z) === 0) {
      errors.push({
        type: 'validation',
        message: `自重荷重 ${ml.id}（対象 ${displayMember}）には非ゼロの重力加速度ベクトルが必要です。`,
        elementId: ml.memberId,
      });
    }
  }
  if (ml.type === 'cmq') {
    const invalidComponents = ([
      'iQx', 'iQy', 'iQz', 'iMy', 'iMz',
      'jQx', 'jQy', 'jQz', 'jMy', 'jMz', 'moy', 'moz',
    ] as const).filter((component) => !Number.isFinite(ml[component]));
    if (invalidComponents.length > 0) {
      errors.push({
        type: 'validation',
        message: `CMQ荷重 ${ml.id}（対象 ${displayMember}）の成分 (${invalidComponents.join(', ')}) が有限値ではありません。`,
        elementId: ml.memberId,
      });
    }
  }
  validateMemberLoadIn2dMode(context, ml, displayMember);
}

/** Out-of-plane member-load components are not representable in 2D modes. */
function validateMemberLoadIn2dMode(
  context: ValidationContext,
  ml: MemberLoad,
  displayMember: string
): void {
  const { model, errors, analysisMode, twoDimensionalConfig, loadScale, memberById } = context;
  if (!twoDimensionalConfig) return;

  const member = memberById.get(ml.memberId);
  const outOfPlaneAxes = member
    ? getMemberOutOfPlaneLocalAxes(model, member, analysisMode)
    : { localY: false, localZ: false };
  const length = loadScale.memberLengths.get(ml.memberId)
    ?? loadScale.representativeLength;
  if (ml.type === 'point' || ml.type === 'udl' || ml.type === 'trapezoid') {
    const localOutOfPlane =
      (ml.direction === 'localY' && outOfPlaneAxes.localY) ||
      (ml.direction === 'localZ' && outOfPlaneAxes.localZ);
    const globalOutOfPlane =
      ml.direction === `global${twoDimensionalConfig.planeNormal.toUpperCase()}`;
    const intensity = ml.type === 'trapezoid'
      ? Math.max(Math.abs(ml.value), Math.abs(ml.valueEnd))
      : Math.abs(ml.value);
    const directionalForce = intensity * (ml.type === 'point' ? 1 : length);
    if ((localOutOfPlane || globalOutOfPlane) &&
        isRelativelyNonzero(directionalForce, loadScale.forceScale)) {
      errors.push({
        type: 'validation',
        message: `2D ${twoDimensionalConfig.planeLabel}平面モードでは部材荷重 ${ml.id}（対象 ${displayMember}）の面外方向荷重 (${ml.direction}) は使用できません。localX または面内のローカル方向を使用してください。`,
        elementId: ml.memberId,
      });
    }
  }
  if (ml.type === 'selfWeight' && member) {
    const { section, material } = memberMaterial(context, ml.memberId);
    const gravityComponent = model.gravity?.[twoDimensionalConfig.planeNormal] ?? 0;
    const outOfPlaneForce = (material?.density ?? 0) * (section?.A ?? 0)
      * gravityComponent * ml.value * length;
    if (isRelativelyNonzero(outOfPlaneForce, loadScale.forceScale)) {
      errors.push({
        type: 'validation',
        message: `2D ${twoDimensionalConfig.planeLabel}平面モードでは自重荷重 ${ml.id}（対象 ${displayMember}）に面外重力成分を使用できません。`,
        elementId: ml.memberId,
      });
    }
  }
  if (ml.type === 'cmq') {
    const invalid: Array<[string, number]> = [];
    if (outOfPlaneAxes.localY) {
      invalid.push(['iQy', ml.iQy], ['jQy', ml.jQy]);
    } else {
      invalid.push(
        ['iMy', ml.iMy / loadScale.representativeLength],
        ['jMy', ml.jMy / loadScale.representativeLength],
        ['moy', ml.moy / loadScale.representativeLength]
      );
    }
    if (outOfPlaneAxes.localZ) {
      invalid.push(['iQz', ml.iQz], ['jQz', ml.jQz]);
    } else {
      invalid.push(
        ['iMz', ml.iMz / loadScale.representativeLength],
        ['jMz', ml.jMz / loadScale.representativeLength],
        ['moz', ml.moz / loadScale.representativeLength]
      );
    }
    const nonzeroInvalid = invalid.filter(([, value]) =>
      isRelativelyNonzero(value, loadScale.forceScale)
    );
    if (nonzeroInvalid.length > 0) {
      errors.push({
        type: 'validation',
        message: `2D ${twoDimensionalConfig.planeLabel}平面モードではCMQ荷重 ${ml.id}（対象 ${displayMember}）の面外成分 (${nonzeroInvalid.map(([name]) => name).join(', ')}) は使用できません。`,
        elementId: ml.memberId,
      });
    }
  }
}

function validateNodalLoads(context: ValidationContext): void {
  const { model, errors, nodeById, twoDimensionalConfig, loadScale, nodeReferenceLabel } = context;
  for (const nl of model.nodalLoads) {
    const displayNode = nodeReferenceLabel(nl.nodeId);
    if (!nodeById.has(nl.nodeId)) {
      errors.push({
        type: 'validation',
        message: `節点荷重 ${nl.id} の対象節点 ${displayNode} が見つかりません。`,
        nodeId: nl.nodeId,
      });
    }
    const invalidComponents = (['fx', 'fy', 'fz', 'mx', 'my', 'mz'] as const)
      .filter((component) => !Number.isFinite(nl[component]));
    if (invalidComponents.length > 0) {
      errors.push({
        type: 'validation',
        message: `節点荷重 ${nl.id}（対象 ${displayNode}）の成分 (${invalidComponents.join(', ')}) が有限値ではありません。`,
        nodeId: nl.nodeId,
      });
    }
    if (twoDimensionalConfig) {
      const invalid = twoDimensionalConfig.invalidNodalLoadComponents
        .map((name) => [
          name,
          name.startsWith('m')
            ? nl[name] / loadScale.representativeLength
            : nl[name],
        ] as const)
        .filter(([, value]) => isRelativelyNonzero(value, loadScale.forceScale));
      if (invalid.length > 0) {
        errors.push({
          type: 'validation',
          message: `2D ${twoDimensionalConfig.planeLabel}平面モードでは節点荷重 ${nl.id}（対象 ${displayNode}）の面外成分 (${invalid.map(([name]) => name).join(', ')}) は使用できません。${twoDimensionalConfig.allowedNodalLoadComponents.join(', ')} を使用してください。`,
          nodeId: nl.nodeId,
        });
      }
    }
  }
}

/**
 * A prescribed displacement replaces the zero value of a support, so each
 * nonzero component must sit on a DOF the node itself restrains.
 */
function validatePrescribedDisplacements(context: ValidationContext): void {
  const { model, errors, nodeById, twoDimensionalConfig, nodeReferenceLabel } = context;
  for (const item of model.prescribedDisplacements ?? []) {
    const node = nodeById.get(item.nodeId);
    const displayNode = nodeReferenceLabel(item.nodeId);
    if (!node) {
      errors.push({
        type: 'validation',
        message: `強制変位 ${item.id} の対象節点 ${displayNode} が見つかりません。`,
        nodeId: item.nodeId,
      });
      continue;
    }
    const invalidComponents = DOF_NAMES.filter((dof) => !Number.isFinite(item[dof]));
    if (invalidComponents.length > 0) {
      errors.push({
        type: 'validation',
        message: `強制変位 ${item.id}（対象 ${displayNode}）の成分 (${invalidComponents.join(', ')}) が有限値ではありません。`,
        nodeId: item.nodeId,
      });
      continue;
    }
    const unrestrained = DOF_NAMES.filter((dof) => item[dof] !== 0 && !node.restraint[dof]);
    if (unrestrained.length > 0) {
      errors.push({
        type: 'validation',
        message: `強制変位 ${item.id}（対象 ${displayNode}）の成分 (${unrestrained.join(', ')}) は拘束されていない自由度です。強制変位は支持条件で固定した自由度にのみ指定できます。`,
        nodeId: item.nodeId,
      });
    }
    if (twoDimensionalConfig) {
      const outOfPlane = twoDimensionalConfig.autoFixedDofs.filter((dof) => item[dof] !== 0);
      if (outOfPlane.length > 0) {
        errors.push({
          type: 'validation',
          message: `2D ${twoDimensionalConfig.planeLabel}平面モードでは強制変位 ${item.id}（対象 ${displayNode}）の面外成分 (${outOfPlane.join(', ')}) は使用できません。`,
          nodeId: item.nodeId,
        });
      }
    }
  }
}

function validateNodalMasses(context: ValidationContext): void {
  const { model, errors, nodeById, nodeReferenceLabel } = context;
  for (const item of model.nodeMasses ?? []) {
    if (!nodeById.has(item.nodeId)) {
      errors.push({
        type: 'validation',
        message: `節点質量 ${item.id} の対象節点 ${nodeReferenceLabel(item.nodeId)} が見つかりません。`,
        nodeId: item.nodeId,
      });
    }
    if (!Number.isFinite(item.mass) || item.mass < 0) {
      errors.push({
        type: 'validation',
        message: `節点質量 ${item.id} が有限な非負値ではありません (mass=${item.mass})。`,
        nodeId: item.nodeId,
      });
    }
  }
}

export function validateModel(model: ProjectModel): AnalysisError[] {
  const context = createValidationContext(model);

  validateTwoDimensionalGeometry(context);
  validateModelSize(context);
  validateUniqueIds(context);
  validateNodeCoordinates(context);
  validateMaterials(context);
  validateSections(context);
  const springNumbers = validateSprings(context);
  validateGravity(context);
  validateNodeSprings(context);
  validateCouplingsAndTorsionRestraints(context);
  validateMembers(context, springNumbers);
  validateSupportSufficiency(context);
  validateIsolatedNodes(context);
  for (const load of model.memberLoads) validateMemberLoad(context, load);
  validateNodalLoads(context);
  validatePrescribedDisplacements(context);
  validateNodalMasses(context);

  return context.errors;
}
