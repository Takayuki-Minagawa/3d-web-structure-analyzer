import type {
  DofName,
  IndexedModel,
  ReleasedMemberMode,
  StabilityDiagnostic,
} from '../model/types';

const DOF_NAMES: DofName[] = ['ux', 'uy', 'uz', 'rx', 'ry', 'rz'];
const MAX_ZERO_STIFFNESS_DIAGNOSTICS = 6;
const MAX_RELEASE_DIAGNOSTICS = 4;

interface DofDescriptor {
  nodeId: string;
  dof: DofName;
  dofIndex: number;
}

interface RowNorm {
  sourceDof: number;
  norm: number;
}

export function createSingularStabilityDiagnostics(
  model: IndexedModel,
  stiffness: Float64Array,
  freeDofs: number[],
  pivotIndex?: number
): StabilityDiagnostic[] {
  const diagnostics: StabilityDiagnostic[] = [];
  const seen = new Set<string>();
  const suspectNodeIds = new Set<string>();
  const pivotDof = pivotIndex === undefined ? undefined : freeDofs[pivotIndex];

  // Kept defensive in case solver metadata and free DOF ordering diverge later.
  if (pivotDof !== undefined) {
    const desc = describeDof(model, pivotDof);
    if (desc) {
      diagnostics.push({
        kind: 'singular-pivot',
        nodeId: desc.nodeId,
        dof: desc.dof,
        dofIndex: desc.dofIndex,
      });
      seen.add(`dof:${desc.dofIndex}`);
      addRelatedNodeIdsForDof(model, desc.dofIndex, suspectNodeIds);
    }
  }

  let zeroStiffnessDiagnosticCount = 0;
  for (const row of findZeroStiffnessDofs(model, stiffness, freeDofs)) {
    if (seen.has(`dof:${row.sourceDof}`)) continue;
    const desc = describeDof(model, row.sourceDof);
    if (!desc) continue;
    diagnostics.push({
      kind: 'zero-stiffness-dof',
      nodeId: desc.nodeId,
      dof: desc.dof,
      dofIndex: desc.dofIndex,
    });
    seen.add(`dof:${desc.dofIndex}`);
    addRelatedNodeIdsForDof(model, desc.dofIndex, suspectNodeIds);
    zeroStiffnessDiagnosticCount++;
    if (zeroStiffnessDiagnosticCount >= MAX_ZERO_STIFFNESS_DIAGNOSTICS) {
      break;
    }
  }

  let releaseDiagnosticCount = 0;
  for (const diagnostic of findBothEndReleaseDiagnostics(model, suspectNodeIds)) {
    if (releaseDiagnosticCount >= MAX_RELEASE_DIAGNOSTICS) {
      break;
    }
    diagnostics.push(diagnostic);
    releaseDiagnosticCount++;
  }

  return diagnostics;
}

function describeDof(model: IndexedModel, sourceDof: number): DofDescriptor | null {
  const nodeIndex = Math.floor(sourceDof / 6);
  const dof = DOF_NAMES[sourceDof % 6];
  const node = model.nodes[nodeIndex];
  if (!node || !dof) return null;
  return { nodeId: node.id, dof, dofIndex: sourceDof };
}

function addRelatedNodeIdsForDof(
  model: IndexedModel,
  sourceDof: number,
  nodeIds: Set<string>
): void {
  const sourceNode = model.nodes[Math.floor(sourceDof / 6)];
  if (sourceNode) nodeIds.add(sourceNode.id);

  for (let dof = 0; dof < model.dofCount; dof++) {
    if (model.dofMap[dof] !== sourceDof) continue;
    const coupledNode = model.nodes[Math.floor(dof / 6)];
    if (coupledNode) nodeIds.add(coupledNode.id);
  }
}

function findZeroStiffnessDofs(
  model: IndexedModel,
  stiffness: Float64Array,
  freeDofs: number[]
): RowNorm[] {
  const norms = freeDofs.map((sourceDof) => ({
    sourceDof,
    norm: freeRowAbsSum(stiffness, model.dofCount, sourceDof, freeDofs),
  }));
  const maxNorm = norms.reduce((max, row) => Math.max(max, row.norm), 0);
  const tolerance = Math.max(1e-14, maxNorm * 1e-12);
  return norms
    .filter((row) => row.norm <= tolerance)
    .slice(0, MAX_ZERO_STIFFNESS_DIAGNOSTICS + 1);
}

function freeRowAbsSum(
  stiffness: Float64Array,
  dofCount: number,
  sourceDof: number,
  freeDofs: number[]
): number {
  let sum = 0;
  const rowOffset = sourceDof * dofCount;
  for (const colDof of freeDofs) {
    sum += Math.abs(stiffness[rowOffset + colDof]!);
  }
  return sum;
}

function findBothEndReleaseDiagnostics(
  model: IndexedModel,
  suspectNodeIds: Set<string>
): StabilityDiagnostic[] {
  if (suspectNodeIds.size === 0) return [];

  const diagnostics: StabilityDiagnostic[] = [];
  for (const member of model.members) {
    const nodeI = model.nodes[member.ni];
    const nodeJ = model.nodes[member.nj];
    if (!nodeI || !nodeJ) continue;
    if (!suspectNodeIds.has(nodeI.id) && !suspectNodeIds.has(nodeJ.id)) continue;

    const released: ReleasedMemberMode[] = [];
    if (member.releases[0].type === 'pin' && member.releases[3].type === 'pin') {
      released.push('localXTwist');
    }
    if (member.releases[1].type === 'pin' && member.releases[4].type === 'pin') {
      released.push('localYBending');
    }
    if (member.releases[2].type === 'pin' && member.releases[5].type === 'pin') {
      released.push('localZBending');
    }
    if (released.length === 0) continue;

    diagnostics.push({
      kind: 'released-member',
      elementId: member.id,
      released,
    });
  }
  return diagnostics;
}
