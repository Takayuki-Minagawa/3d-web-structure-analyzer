import type { Member, MemberId, ProjectModel, StructuralNode } from './types';
import { getAnalysisMode } from './analysisMode';
import { FREE_RESTRAINT } from './restraints';

const SUBDIVISION_PREFIX = '__sub';
const NO_SPRINGS = { x: 0, y: 0, z: 0 };
/** Spring number of the built-in rigid connection. */
const RIGID_SPRING = 1;

export interface SubdividedModel {
  /** Structure-only model: original nodes first, then interior nodes. */
  model: ProjectModel;
  /** Ordered element ids making up each original member. */
  segments: Map<MemberId, MemberId[]>;
  /** Elements per member actually used for each original member. */
  divisionsByMember: Map<MemberId, number>;
}

/**
 * Split every member into `divisions` collinear elements for eigenvalue
 * analyses, where one cubic element per member cannot represent member-local
 * vibration or buckling shapes.
 *
 * The result carries the structure only (member loads are dropped; their
 * effect enters through the axial forces of a separate static analysis).
 * End releases stay on the outermost elements. Interior nodes only gain
 * stiffness from the member itself, so two cases need care:
 *  - a member without torsional stiffness (Ix = 0) is left undivided in 3D,
 *    because its interior twist DOFs would be unrestrained;
 *  - a member whose twist is pinned at both ends keeps only one of the two
 *    releases, which still transmits no torque but anchors the interior
 *    twist DOFs to an end node.
 */
export function subdivideMembers(model: ProjectModel, divisions: number): SubdividedModel {
  const count = Math.max(1, Math.floor(divisions));
  const segments = new Map<MemberId, MemberId[]>();
  const divisionsByMember = new Map<MemberId, number>();
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));
  const sectionById = new Map(model.sections.map((section) => [section.id, section]));
  const is3d = getAnalysisMode(model) === '3d';
  const springStiffness = new Map((model.springs ?? []).map((spring) => [spring.number, spring.kTheta]));
  // Mirrors the spring-number convention of the indexing step: 2 is a pin,
  // custom numbers (>= 3) are pins only when their stiffness is zero.
  const isPin = (springNumber: number): boolean =>
    springNumber === 2 || (springNumber >= 3 && springStiffness.get(springNumber) === 0);
  const interiorNodes: StructuralNode[] = [];
  const members: Member[] = [];

  for (const member of model.members) {
    const nodeI = nodeById.get(member.ni);
    const nodeJ = nodeById.get(member.nj);
    const hasTorsionalStiffness = (sectionById.get(member.sectionId)?.Ix ?? 0) > 0;
    const memberDivisions = nodeI && nodeJ && (hasTorsionalStiffness || !is3d) ? count : 1;
    divisionsByMember.set(member.id, memberDivisions);
    if (memberDivisions === 1 || !nodeI || !nodeJ) {
      segments.set(member.id, [member.id]);
      members.push(member);
      continue;
    }

    const iSprings = member.iSprings ?? NO_SPRINGS;
    const jSprings = member.jSprings ?? NO_SPRINGS;
    const twistPinnedAtBothEnds = isPin(iSprings.x) && isPin(jSprings.x);
    // Anchor at the end whose nodal twist is known to be restrained, if any.
    const anchorEnd = member.torsionRestraint === 'j' ? 'j' : 'i';
    const nodeIds = [member.ni];
    for (let k = 1; k < memberDivisions; k++) {
      const ratio = k / memberDivisions;
      const id = `${SUBDIVISION_PREFIX}:${member.id}:n${k}`;
      interiorNodes.push({
        id,
        x: nodeI.x + (nodeJ.x - nodeI.x) * ratio,
        y: nodeI.y + (nodeJ.y - nodeI.y) * ratio,
        z: nodeI.z + (nodeJ.z - nodeI.z) * ratio,
        restraint: { ...FREE_RESTRAINT },
      });
      nodeIds.push(id);
    }
    nodeIds.push(member.nj);

    const elementIds: MemberId[] = [];
    for (let k = 0; k < memberDivisions; k++) {
      const id = `${SUBDIVISION_PREFIX}:${member.id}:e${k}`;
      const isFirst = k === 0;
      const isLast = k === memberDivisions - 1;
      elementIds.push(id);
      members.push({
        id,
        ni: nodeIds[k]!,
        nj: nodeIds[k + 1]!,
        sectionId: member.sectionId,
        codeAngle: member.codeAngle,
        iSprings: isFirst
          ? { ...iSprings, x: twistPinnedAtBothEnds && anchorEnd === 'i' ? RIGID_SPRING : iSprings.x }
          : { ...NO_SPRINGS },
        jSprings: isLast
          ? { ...jSprings, x: twistPinnedAtBothEnds && anchorEnd === 'j' ? RIGID_SPRING : jSprings.x }
          : { ...NO_SPRINGS },
        torsionRestraint:
          (isFirst && member.torsionRestraint === 'i') ? 'i'
            : (isLast && member.torsionRestraint === 'j') ? 'j'
              : 'none',
      });
    }
    segments.set(member.id, elementIds);
  }

  if (interiorNodes.length === 0) {
    return { model: { ...model, memberLoads: [] }, segments, divisionsByMember };
  }
  return {
    model: {
      ...model,
      nodes: [...model.nodes, ...interiorNodes],
      members,
      memberLoads: [],
    },
    segments,
    divisionsByMember,
  };
}
