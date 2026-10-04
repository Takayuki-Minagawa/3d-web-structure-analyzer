import { isActiveNodeCoupling } from './couplings';
import type { ProjectModel } from './types';
import { validateModel } from './validation';

export interface ModelDiagnostic {
  code: 'validation' | 'coincident-nodes' | 'duplicate-members' | 'isolated-nodes' | 'disconnected-components';
  severity: 'error' | 'warning';
  nodeIds: string[];
  memberIds: string[];
  message?: string;
}

interface Component {
  nodeIds: string[];
  memberIds: string[];
}

/**
 * Report input errors and advisory topology findings without editing the model.
 * Connectivity describes declared links, not structural stability: supports,
 * releases and which DOFs are coupled still determine whether analysis succeeds.
 * Results follow model order, with validation errors before topology warnings.
 */
export function diagnoseModel(model: ProjectModel): ModelDiagnostic[] {
  const diagnostics: ModelDiagnostic[] = validateModel(model).map((error) => ({
    code: 'validation',
    severity: 'error',
    nodeIds: error.nodeId === undefined ? [] : [error.nodeId],
    memberIds: error.elementId === undefined ? [] : [error.elementId],
    message: error.message,
  }));
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  const adjacency = new Map<string, string[]>([...nodeIds].map((id) => [id, []]));
  const coordinateGroups = new Map<string, Set<string>>();
  const memberGroups = new Map<string, Component>();

  for (const node of model.nodes) {
    // JSON serializes signed zero identically; reject nonfinite coordinates so
    // null representations of NaN/Infinity cannot create coincident groups.
    if (![node.x, node.y, node.z].every(Number.isFinite)) continue;
    const key = JSON.stringify([node.x, node.y, node.z]);
    const group = coordinateGroups.get(key) ?? new Set<string>();
    group.add(node.id);
    coordinateGroups.set(key, group);
  }
  for (const group of coordinateGroups.values()) {
    if (group.size > 1) {
      diagnostics.push({
        code: 'coincident-nodes', severity: 'warning', nodeIds: [...group], memberIds: [],
      });
    }
  }

  function connect(first: string, second: string): void {
    if (first === second || !nodeIds.has(first) || !nodeIds.has(second)) return;
    adjacency.get(first)!.push(second);
    adjacency.get(second)!.push(first);
  }

  for (const member of model.members) {
    const endpoints = member.ni < member.nj ? [member.ni, member.nj] : [member.nj, member.ni];
    // Structured keys avoid collisions even if imported IDs contain separators.
    const key = JSON.stringify(endpoints);
    const group = memberGroups.get(key) ?? {
      nodeIds: [...new Set([member.ni, member.nj])], memberIds: [],
    };
    group.memberIds.push(member.id);
    memberGroups.set(key, group);
    connect(member.ni, member.nj);
  }
  for (const group of memberGroups.values()) {
    if (group.memberIds.length > 1) {
      diagnostics.push({ code: 'duplicate-members', severity: 'warning', ...group });
    }
  }
  for (const coupling of model.couplings ?? []) {
    if (isActiveNodeCoupling(coupling, nodeIds)) {
      connect(coupling.masterNodeId, coupling.slaveNodeId);
    }
  }

  const isolated = [...nodeIds].filter((id) => adjacency.get(id)!.length === 0);
  if (isolated.length > 0) {
    diagnostics.push({
      code: 'isolated-nodes', severity: 'warning', nodeIds: isolated, memberIds: [],
    });
  }

  // Iterative traversal avoids call-stack limits on large imported structures.
  const componentByNode = new Map<string, Component>();
  const components: Component[] = [];
  for (const id of nodeIds) {
    if (componentByNode.has(id)) continue;
    const component: Component = { nodeIds: [], memberIds: [] };
    components.push(component);
    const pending = [id];
    componentByNode.set(id, component);
    while (pending.length > 0) {
      const current = pending.pop()!;
      for (const neighbor of adjacency.get(current)!) {
        if (componentByNode.has(neighbor)) continue;
        componentByNode.set(neighbor, component);
        pending.push(neighbor);
      }
    }
  }
  // Populate lists separately to preserve the input's node and member ordering.
  for (const id of nodeIds) componentByNode.get(id)!.nodeIds.push(id);
  for (const member of model.members) {
    if (member.ni === member.nj || !nodeIds.has(member.ni) || !nodeIds.has(member.nj)) continue;
    componentByNode.get(member.ni)!.memberIds.push(member.id);
  }
  const memberComponents = components.filter((component) => component.memberIds.length > 0);
  if (memberComponents.length > 1) {
    for (const component of memberComponents) {
      diagnostics.push({ code: 'disconnected-components', severity: 'warning', ...component });
    }
  }
  return diagnostics;
}
