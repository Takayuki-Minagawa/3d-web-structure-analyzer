import type { CouplingConstraint, ProjectModel } from './types';
import { DOF_NAMES, dofValues } from './restraints';

/** Whether a declared coupling connects two existing nodes in at least one DOF. */
export function isActiveNodeCoupling(
  coupling: CouplingConstraint,
  nodeIds: ReadonlySet<string>
): boolean {
  return coupling.masterNodeId !== coupling.slaveNodeId
    && nodeIds.has(coupling.masterNodeId)
    && nodeIds.has(coupling.slaveNodeId)
    && dofValues(coupling).some(Boolean);
}

export type CouplingIssueKind =
  | 'missing-master'
  | 'missing-slave'
  | 'self-coupling'
  | 'duplicate-slave'
  | 'cycle';

export interface CouplingIssue {
  kind: CouplingIssueKind;
  couplingId: string;
  message: string;
}

interface DofParentBuildResult {
  parent: Int32Array;
  issues: CouplingIssue[];
}

function buildDirectDofParents(
  model: ProjectModel,
  nodeIdToIndex: Map<string, number>
): DofParentBuildResult {
  const dofCount = model.nodes.length * 6;
  const parent = new Int32Array(dofCount);
  for (let dof = 0; dof < dofCount; dof++) parent[dof] = dof;

  const issues: CouplingIssue[] = [];
  const slaveOwner = new Map<number, { couplingId: string; masterDof: number }>();

  for (const coupling of model.couplings ?? []) {
    const masterIndex = nodeIdToIndex.get(coupling.masterNodeId);
    const slaveIndex = nodeIdToIndex.get(coupling.slaveNodeId);
    if (masterIndex === undefined) {
      issues.push({
        kind: 'missing-master',
        couplingId: coupling.id,
        message: `カップリング ${coupling.id} のマスター節点 ${coupling.masterNodeId} が存在しません。`,
      });
    }
    if (slaveIndex === undefined) {
      issues.push({
        kind: 'missing-slave',
        couplingId: coupling.id,
        message: `カップリング ${coupling.id} のスレーブ節点 ${coupling.slaveNodeId} が存在しません。`,
      });
    }
    if (masterIndex === undefined || slaveIndex === undefined) continue;

    const flags = dofValues(coupling);
    if (masterIndex === slaveIndex && flags.some(Boolean)) {
      issues.push({
        kind: 'self-coupling',
        couplingId: coupling.id,
        message: `カップリング ${coupling.id} は同じ節点 ${coupling.masterNodeId} をマスターとスレーブに指定しています。`,
      });
      continue;
    }

    for (let localDof = 0; localDof < 6; localDof++) {
      if (!flags[localDof]) continue;
      const slaveDof = slaveIndex * 6 + localDof;
      const masterDof = masterIndex * 6 + localDof;
      const previous = slaveOwner.get(slaveDof);
      if (previous) {
        issues.push({
          kind: 'duplicate-slave',
          couplingId: coupling.id,
          message: `節点 ${coupling.slaveNodeId} の ${DOF_NAMES[localDof]} はカップリング ${previous.couplingId} と ${coupling.id} で重複してスレーブに指定されています。`,
        });
        continue;
      }
      slaveOwner.set(slaveDof, { couplingId: coupling.id, masterDof });
      parent[slaveDof] = masterDof;
    }
  }

  if (issues.length > 0) return { parent, issues };

  const completed = new Uint8Array(dofCount);
  for (let start = 0; start < dofCount; start++) {
    if (completed[start]) continue;
    const path: number[] = [];
    const positionInPath = new Map<number, number>();
    let current = start;

    while (parent[current] !== current && !completed[current]) {
      const cycleStart = positionInPath.get(current);
      if (cycleStart !== undefined) {
        const cycleDofs = path.slice(cycleStart);
        const owner = slaveOwner.get(current);
        issues.push({
          kind: 'cycle',
          couplingId: owner?.couplingId ?? '',
          message: `カップリング ${cycleDofs.map((dof) => {
            const node = model.nodes[Math.floor(dof / 6)];
            return `${node?.id ?? '?'}:${DOF_NAMES[dof % 6]}`;
          }).join(' → ')} が循環しています。`,
        });
        return { parent, issues };
      }
      positionInPath.set(current, path.length);
      path.push(current);
      current = parent[current]!;
    }

    for (const dof of path) completed[dof] = 1;
    completed[current] = 1;
  }

  return { parent, issues };
}

export function findCouplingIssues(model: ProjectModel): CouplingIssue[] {
  const nodeIdToIndex = new Map(model.nodes.map((node, index) => [node.id, index]));
  return buildDirectDofParents(model, nodeIdToIndex).issues;
}

/**
 * Resolve all slave-to-master chains after reading every declaration, then
 * path-compress the map so the result is independent of declaration order.
 */
export function resolveDofMap(
  model: ProjectModel,
  nodeIdToIndex = new Map(model.nodes.map((node, index) => [node.id, index]))
): Int32Array {
  const { parent, issues } = buildDirectDofParents(model, nodeIdToIndex);
  if (issues.length > 0) throw new Error(issues[0]!.message);

  for (let start = 0; start < parent.length; start++) {
    let root = start;
    while (parent[root] !== root) root = parent[root]!;

    let current = start;
    while (parent[current] !== current) {
      const next = parent[current]!;
      parent[current] = root;
      current = next;
    }
  }
  return parent;
}
