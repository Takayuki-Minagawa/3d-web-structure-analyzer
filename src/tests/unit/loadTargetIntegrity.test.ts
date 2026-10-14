import { describe, expect, it } from 'vitest';
import { generateCantileverTemplate } from '../../core/model/generators';
import { validateModel } from '../../core/model/validation';
import { buildIndexedModel } from '../../core/model/indexing';
import { analyzeAllLoadTargets } from '../../core/analysis/analyzeLoadTargets';
import { analyzeBuckling } from '../../core/analysis/eigenAnalysis';
import { getActiveLoadCaseId, resolveAnalysisLoadModel, resolveLoadTargetModel } from '../../core/model/loadCases';

describe('explicit load identities', () => {
  it('rejects an unknown nodal load case before assembly or resolution', () => {
    const model = generateCantileverTemplate();
    model.nodalLoads[0]!.loadCaseId = 'typo-live';
    expect(validateModel(model).map((e) => e.message).join('\n')).toContain('nodalLoads[0].loadCaseId');
    expect(() => analyzeAllLoadTargets(model)).toThrow('typo-live');
    expect(() => resolveAnalysisLoadModel(model)).toThrow('typo-live');
    expect(() => buildIndexedModel(model)).toThrow('typo-live');
  });
  it('rejects unknown combination terms even at a zero factor', () => {
    const model = generateCantileverTemplate();
    model.loadCombinations = [{ id: 'u', name: 'U', factors: [{ loadCaseId: 'missing', factor: 0 }] }];
    expect(() => analyzeAllLoadTargets(model)).toThrow('missing');
    delete (model.loadCombinations[0]!.factors[0] as { loadCaseId?: string }).loadCaseId;
    expect(() => analyzeAllLoadTargets(model)).toThrow('factors[0].loadCaseId');
  });
  it('rejects nonfinite coefficients and duplicate target IDs', () => {
    const model = generateCantileverTemplate();
    const id = getActiveLoadCaseId(model);
    model.loadCombinations = [{ id, name: 'Duplicate', factors: [{ loadCaseId: id, factor: NaN }] }];
    const messages = validateModel(model).map((e) => e.message).join('\n');
    expect(messages).toContain('loadCombinations[0].id');
    expect(messages).toContain('factors[0].factor');
  });
  it('does not fall back for explicit static, active or buckling targets', () => {
    const model = generateCantileverTemplate();
    expect(() => resolveLoadTargetModel(model, { id: 'missing', name: '', type: 'loadCase' })).toThrow('targetId');
    expect(() => analyzeBuckling(model, { targetId: 'missing' })).toThrow('targetId');
    model.activeLoadCaseId = 'missing';
    expect(() => resolveAnalysisLoadModel(model)).toThrow('activeLoadCaseId');
    model.activeLoadCaseId = model.loadCases![0]!.id;
    model.activeLoadCombinationId = 'missing';
    expect(() => resolveAnalysisLoadModel(model)).toThrow('activeLoadCombinationId');
  });
  it('keeps omitted loadCaseId compatible with the first declared case', () => {
    const model = generateCantileverTemplate();
    delete model.nodalLoads[0]!.loadCaseId;
    expect(validateModel(model)).toEqual([]);
    expect(resolveAnalysisLoadModel(model).nodalLoads).toHaveLength(1);
    expect(analyzeAllLoadTargets(model).results).toHaveLength(1);
  });
});
