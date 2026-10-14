import type { ProjectModel } from '../../core/model/types';
import {
  buildPhysicalSupportReactionRows,
  buildSupportReactionLayout,
  buildSupportReactionVector,
} from '../../core/supportReactions';

export type { ReactionCell, ReactionRow } from '../../core/supportReactions';

export function buildEffectiveReactionRows(
  model: ProjectModel,
  reactions: ArrayLike<number>,
  displacements?: ArrayLike<number>,
) {
  const layout = buildSupportReactionLayout(model);
  // Legacy callers without springs did not supply displacements. Free spring
  // reactions can also be read directly; mixed rigid/spring DOFs need u.
  const values = buildSupportReactionVector(model, reactions, displacements ?? [], layout);
  if (!displacements) {
    for (let source = 0; source < values.length; source++) {
      if (layout.springStiffnesses[source]! > 0 && !layout.rigidOwners.has(layout.dofMap[source]!)) {
        values[source] = reactions[source] ?? 0;
      }
    }
  }
  return buildPhysicalSupportReactionRows(model, values, layout);
}
