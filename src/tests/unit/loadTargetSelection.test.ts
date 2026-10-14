import { afterEach, describe, expect, it } from 'vitest';
import { generateCantileverTemplate } from '../../core/model/generators';
import { resolveAnalysisLoadModel } from '../../core/model/loadCases';
import { parseProjectFile } from '../../io/projectFileParser';
import { resolveViewportLoads } from '../../rendering/loadPresentation';
import { useProjectStore } from '../../state/projectStore';
import { selectLoadTarget } from '../../ui/panels/property/loadTargetSelection';

afterEach(() => {
  useProjectStore.getState().resetModel();
  useProjectStore.temporal.getState().clear();
});

describe('load target selection', () => {
  it.each([
    { value: 'case:wind:east', selectedCase: 'wind:east', selectedCombination: null, fx: 12 },
    { value: 'combo:uls:wind:east', selectedCase: null, selectedCombination: 'uls:wind:east', fx: 18 },
  ])('preserves imported IDs when selecting $value', ({ value, selectedCase, selectedCombination, fx }) => {
    const model = generateCantileverTemplate();
    model.loadCases!.push({ id: 'wind:east', name: 'Wind East' });
    model.nodalLoads.push({
      id: 'wind-load', loadCaseId: 'wind:east', nodeId: model.nodes[1]!.id,
      fx: 12, fy: 0, fz: 0, mx: 0, my: 0, mz: 0,
    });
    model.loadCombinations = [{
      id: 'uls:wind:east', name: 'ULS Wind East', factors: [{ loadCaseId: 'wind:east', factor: 1.5 }],
    }];
    const imported = parseProjectFile({ schemaVersion: 2, savedAt: '2026-10-14T00:00:00Z', model });
    useProjectStore.getState().loadModel(imported.model);

    // Exercise the same selection handler used by the property editor.
    selectLoadTarget(value, useProjectStore.getState());
    const selected = useProjectStore.getState().model;
    expect(selected.activeLoadCaseId).toBe(selectedCase ?? model.activeLoadCaseId);
    expect(selected.activeLoadCombinationId).toBe(selectedCombination);
    expect(() => resolveViewportLoads(selected, { kind: 'editing' })).not.toThrow();
    expect(resolveAnalysisLoadModel(selected).nodalLoads).toEqual([
      expect.objectContaining({ loadCaseId: 'wind:east', fx }),
    ]);
  });
});
