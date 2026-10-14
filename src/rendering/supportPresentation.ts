import { formatEngineering } from '../core/formatEngineering';
import { getModel2dModeConfig } from '../core/model/analysisMode';
import { DOF_NAMES } from '../core/model/restraints';
import { getTorsionRestraintSourceDofEntries } from '../core/model/torsionRestraint';
import type { DofName, ProjectModel, StructuralNode } from '../core/model/types';

export interface SupportPresentation {
  node: StructuralNode;
  explicit: DofName[];
  automatic: DofName[];
  torsion: DofName[];
  springs: Array<{ dof: DofName; stiffness: number }>;
  translationCount: number;
  rotationCount: number;
  label: string;
}

/** Keep source restraints distinguishable from 2D constraints and support springs. */
export function getSupportPresentations(model: ProjectModel): SupportPresentation[] {
  const automatic = getModel2dModeConfig(model)?.autoFixedDofs ?? [];
  const torsionSources = getTorsionRestraintSourceDofEntries(model);
  return model.nodes.flatMap((node) => {
    const explicit = DOF_NAMES.filter((dof) => node.restraint[dof]);
    const torsion = [...new Set(torsionSources.filter((entry) => entry.nodeId === node.id)
      .map((entry) => DOF_NAMES[entry.dofOffset]!))];
    const springs = DOF_NAMES.flatMap((dof) => {
      const stiffness = (model.nodeSprings ?? []).filter((spring) => spring.nodeId === node.id)
        .reduce((sum, spring) => sum + spring[dof], 0);
      return stiffness > 0 ? [{ dof, stiffness }] : [];
    });
    if (explicit.length + automatic.length + torsion.length + springs.length === 0) return [];
    const effective = new Set([...explicit, ...automatic, ...torsion]);
    const labelParts: string[] = [];
    const u = explicit.filter((dof) => dof.startsWith('u')).map((dof) => dof.slice(1)).join('');
    const r = explicit.filter((dof) => dof.startsWith('r')).map((dof) => dof.slice(1)).join('');
    if (u) labelParts.push(`u:${u}`);
    if (r) labelParts.push(`r:${r}`);
    if (automatic.length) labelParts.push(`2D:${automatic.join(',')}`);
    if (torsion.length) labelParts.push(`T:${torsion.join(',')}`);
    for (const spring of springs) {
      const unit = spring.dof.startsWith('u') ? `${model.units.force}/${model.units.length}` : `${model.units.moment}/rad`;
      labelParts.push(`k${spring.dof}=${formatEngineering(spring.stiffness)} ${unit}`);
    }
    return [{
      node, explicit, automatic: [...automatic], torsion, springs,
      translationCount: DOF_NAMES.slice(0, 3).filter((dof) => effective.has(dof)).length,
      rotationCount: DOF_NAMES.slice(3).filter((dof) => effective.has(dof)).length,
      label: labelParts.join(' · '),
    }];
  });
}
