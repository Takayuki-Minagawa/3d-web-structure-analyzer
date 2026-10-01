import React from 'react';
import type { AnalysisMode } from '../../../core/model/types';
import { get2dModeConfig, getAnalysisMode } from '../../../core/model/analysisMode';
import { getActiveLoadCaseId, getLoadCases, getLoadCombinations } from '../../../core/model/loadCases';
import { nodeLabel } from '../../../core/model/displayNumbers';
import { DOF_NAMES } from '../../../core/model/restraints';
import { useT } from '../../../i18n';
import { useProjectStore, type AnalysisModeUpdateResult } from '../../../state/projectStore';
import { useSelectionStore } from '../../../state/selectionStore';

export const AnalysisSettingsEditor: React.FC = () => {
  const t = useT();
  const model = useProjectStore((state) => state.model);
  const setAnalysisMode = useProjectStore((state) => state.setAnalysisMode);
  const flattenNodesTo2dPlane = useProjectStore((state) => state.flattenNodesTo2dPlane);
  const [error, setError] = React.useState<Extract<AnalysisModeUpdateResult, { ok: false }> | null>(null);
  const mode = getAnalysisMode(model);
  const errorConfig = error ? get2dModeConfig(error.mode) : null;
  const errorMessage = error && errorConfig
    ? t('prop.analysisModeError')
        .replace('{plane}', errorConfig.planeLabel)
        .replace('{coordinate}', errorConfig.lockedCoordinateLabel)
        .replace('{nodes}', error.nodeIds
          .map((nodeId) => nodeLabel(model.nodes.find((node) => node.id === nodeId)))
          .join(', '))
    : '';
  return <div className="project-editor">
    <div className="prop-row"><label>{t('prop.analysisMode')}</label><select value={mode} onChange={(event) => { const next = event.target.value as AnalysisMode; const result = setAnalysisMode(next); setError(result.ok ? null : result); }}><option value="3d">{t('prop.analysisMode3d')}</option><option value="xz2d">{t('prop.analysisModeXz2d')}</option><option value="xy2d">{t('prop.analysisModeXy2d')}</option><option value="yz2d">{t('prop.analysisModeYz2d')}</option></select></div>
    {error && <><div className="warning-text">{errorMessage}</div><button className="small" onClick={() => { flattenNodesTo2dPlane(error.mode); const result = setAnalysisMode(error.mode); if (result.ok) setError(null); }}>{t('prop.switchAfterFlatten')}</button></>}
    {get2dModeConfig(mode) && <div className="muted">{t('prop.outOfPlaneLocked')}</div>}
  </div>;
};

export const GravityEditor: React.FC = () => {
  const t = useT();
  const model = useProjectStore((state) => state.model);
  const updateGravity = useProjectStore((state) => state.updateGravity);
  const gravity = model.gravity ?? { x: 0, y: 0, z: 0 };
  return <div className="project-editor">
    <div className="muted">{t('prop.gravityDescription')}</div>
    {(['x', 'y', 'z'] as const).map((axis) => <div className="prop-row" key={axis}>
      <label>g{axis.toUpperCase()}</label>
      <input type="number" step="any" value={gravity[axis]} onChange={(event) => {
        const value = event.target.valueAsNumber;
        if (Number.isFinite(value)) updateGravity({ [axis]: value });
      }} />
    </div>)}
    <div className="prop-actions"><button onClick={() => updateGravity({ x: 0, y: 0, z: 0 })}>{t('prop.gravityZero')}</button></div>
  </div>;
};

export const LoadCasesEditor: React.FC = () => {
  const t = useT();
  const model = useProjectStore((state) => state.model);
  const addLoadCase = useProjectStore((state) => state.addLoadCase);
  const updateLoadCase = useProjectStore((state) => state.updateLoadCase);
  const removeLoadCase = useProjectStore((state) => state.removeLoadCase);
  const setActiveLoadCase = useProjectStore((state) => state.setActiveLoadCase);
  const addLoadCombination = useProjectStore((state) => state.addLoadCombination);
  const updateLoadCombination = useProjectStore((state) => state.updateLoadCombination);
  const removeLoadCombination = useProjectStore((state) => state.removeLoadCombination);
  const setActiveLoadCombination = useProjectStore((state) => state.setActiveLoadCombination);
  const cases = getLoadCases(model);
  const combinations = getLoadCombinations(model);
  const activeCase = getActiveLoadCaseId(model);
  const target = model.activeLoadCombinationId ? `combo:${model.activeLoadCombinationId}` : `case:${activeCase}`;
  return <div className="project-editor">
    <div className="prop-row"><label>{t('prop.analysisTarget')}</label><select value={target} onChange={(event) => { const [kind, id] = event.target.value.split(':'); if (kind === 'combo') setActiveLoadCombination(id ?? null); else if (id) setActiveLoadCase(id); }}>
      {cases.map((loadCase) => <option key={loadCase.id} value={`case:${loadCase.id}`}>{t('prop.loadCase')} {loadCase.name}</option>)}
      {combinations.map((combo) => <option key={combo.id} value={`combo:${combo.id}`}>{t('prop.loadCombination')} {combo.name}</option>)}
    </select></div>
    <div className="compact-list">{cases.map((loadCase) => <div className="compact-row" key={loadCase.id}><input value={loadCase.name} onChange={(event) => updateLoadCase(loadCase.id, { name: event.target.value })} />{cases.length > 1 && <button className="danger" onClick={() => removeLoadCase(loadCase.id)}>×</button>}</div>)}</div>
    {combinations.map((combo) => <details className="nested-details" key={combo.id}><summary>{combo.name}</summary><div className="compact-row"><input value={combo.name} onChange={(event) => updateLoadCombination(combo.id, { name: event.target.value })} /><button className="danger" onClick={() => removeLoadCombination(combo.id)}>×</button></div>{cases.map((loadCase) => { const factor = combo.factors.find((item) => item.loadCaseId === loadCase.id)?.factor ?? 0; return <div className="prop-row" key={loadCase.id}><label>{loadCase.name}</label><input type="number" value={factor} onChange={(event) => updateLoadCombination(combo.id, { factors: [...combo.factors.filter((item) => item.loadCaseId !== loadCase.id), { loadCaseId: loadCase.id, factor: Number(event.target.value) }] })} /></div>; })}</details>)}
    <div className="prop-actions"><button onClick={() => addLoadCase()}>{t('prop.addLoadCase')}</button><button onClick={() => addLoadCombination()}>{t('prop.addLoadCombination')}</button></div>
  </div>;
};

export const CouplingsEditor: React.FC = () => {
  const t = useT();
  const model = useProjectStore((state) => state.model);
  const addCoupling = useProjectStore((state) => state.addCoupling);
  const updateCoupling = useProjectStore((state) => state.updateCoupling);
  const removeCoupling = useProjectStore((state) => state.removeCoupling);
  return <div className="project-editor">
    {(model.couplings ?? []).length === 0 && <div className="muted">{t('prop.noCouplings')}</div>}
    {(model.couplings ?? []).map((coupling) => <div className="editable-item" key={coupling.id}>
      <div className="prop-row"><label>{t('prop.masterNode')}</label><select value={coupling.masterNodeId} onChange={(event) => updateCoupling(coupling.id, { masterNodeId: event.target.value })}>{model.nodes.map((node) => <option key={node.id} value={node.id}>{nodeLabel(node)}</option>)}</select></div>
      <div className="prop-row"><label>{t('prop.slaveNode')}</label><select value={coupling.slaveNodeId} onChange={(event) => updateCoupling(coupling.id, { slaveNodeId: event.target.value })}>{model.nodes.map((node) => <option key={node.id} value={node.id}>{nodeLabel(node)}</option>)}</select></div>
      <div className="dof-grid">{DOF_NAMES.map((dof) => <label key={dof}><input type="checkbox" checked={coupling[dof]} onChange={(event) => updateCoupling(coupling.id, { [dof]: event.target.checked })} />{dof}</label>)}</div>
      <button className="danger small" onClick={() => removeCoupling(coupling.id)}>{t('prop.delete')}</button>
    </div>)}
    <div className="prop-actions"><button disabled={model.nodes.length < 2} onClick={() => { const master = model.nodes[0]; const slave = model.nodes[1]; if (master && slave) addCoupling({ masterNodeId: master.id, slaveNodeId: slave.id, ux: true, uy: true, uz: true, rx: false, ry: false, rz: false }); }}>{t('prop.addCoupling')}</button></div>
  </div>;
};

export const UnitsEditor: React.FC = () => {
  const t = useT();
  const model = useProjectStore((state) => state.model);
  const updateUnits = useProjectStore((state) => state.updateUnits);
  const presets = [
    { label: 'kN · cm', force: 'kN', length: 'cm', moment: 'kN·cm' },
    { label: 'kN · m', force: 'kN', length: 'm', moment: 'kN·m' },
    { label: 'N · mm', force: 'N', length: 'mm', moment: 'N·mm' },
  ];
  return <div className="project-editor"><div className="unit-presets">{presets.map((preset) => <button key={preset.label} className={model.units.force === preset.force && model.units.length === preset.length ? 'active' : ''} onClick={() => updateUnits(preset)}>{preset.label}</button>)}</div><div className="muted">{t('prop.unitsNote')}</div></div>;
};

export const SelectionOperations: React.FC = () => {
  const t = useT();
  const selectedNodeIds = useSelectionStore((state) => state.selectedNodeIds);
  const selectedMemberIds = useSelectionStore((state) => state.selectedMemberIds);
  const selectNode = useSelectionStore((state) => state.selectNode);
  const selectMember = useSelectionStore((state) => state.selectMember);
  const duplicateSelection = useProjectStore((state) => state.duplicateSelection);
  const mirrorSelection = useProjectStore((state) => state.mirrorSelection);
  const [offset, setOffset] = React.useState({ x: 100, y: 0, z: 0 });
  const [copies, setCopies] = React.useState(1);
  const [axis, setAxis] = React.useState<'x' | 'y' | 'z'>('x');
  const selectResult = (result: { nodeIds: string[]; memberIds: string[] }) => { result.nodeIds.forEach((id, index) => selectNode(id, index > 0)); result.memberIds.forEach((id, index) => selectMember(id, result.nodeIds.length > 0 || index > 0)); };
  return <div className="project-editor"><div className="prop-row"><label>{t('prop.selectedCount')}</label><span>{selectedNodeIds.size + selectedMemberIds.size}</span></div>{(['x', 'y', 'z'] as const).map((coordinate) => <div className="prop-row" key={coordinate}><label>Δ{coordinate.toUpperCase()}</label><input type="number" value={offset[coordinate]} onChange={(event) => setOffset({ ...offset, [coordinate]: Number(event.target.value) })} /></div>)}<div className="prop-row"><label>{t('prop.arrayCount')}</label><input type="number" min="1" value={copies} onChange={(event) => setCopies(Math.max(1, Number(event.target.value)))} /></div><div className="prop-actions"><button onClick={() => selectResult(duplicateSelection([...selectedNodeIds], [...selectedMemberIds], offset, copies))}>{t('prop.arraySelection')}</button></div><div className="prop-row"><label>{t('prop.mirrorAxis')}</label><select value={axis} onChange={(event) => setAxis(event.target.value as 'x' | 'y' | 'z')}><option>x</option><option>y</option><option>z</option></select></div><div className="prop-actions"><button onClick={() => selectResult(mirrorSelection([...selectedNodeIds], [...selectedMemberIds], axis))}>{t('prop.mirrorSelection')}</button></div></div>;
};

export const ModelSummary: React.FC = () => {
  const t = useT();
  const model = useProjectStore((state) => state.model);
  const analysisError = useProjectStore((state) => state.analysisError);
  const analysisResult = useProjectStore((state) => state.analysisResult);
  const isResultStale = useProjectStore((state) => state.isResultStale);
  const selectNode = useSelectionStore((state) => state.selectNode);
  const selectMember = useSelectionStore((state) => state.selectMember);
  const focusSelection = useSelectionStore((state) => state.focusSelection);
  const goToError = () => {
    if (analysisError?.nodeId) selectNode(analysisError.nodeId);
    else if (analysisError?.elementId) selectMember(analysisError.elementId);
    else return;
    focusSelection();
  };
  return <div className="project-editor"><div className="summary-grid"><span>{t('prop.nodeCount')}</span><strong>{model.nodes.length}</strong><span>{t('prop.memberCount')}</span><strong>{model.members.length}</strong><span>{t('prop.nodalLoadCount')}</span><strong>{model.nodalLoads.length}</strong><span>{t('prop.memberLoadCount')}</span><strong>{model.memberLoads.length}</strong></div>{isResultStale && analysisResult && <div className="warning-text">{t('prop.staleWarning')}</div>}{analysisError && <button className="error-link" onClick={goToError}>{analysisError.message}</button>}</div>;
};
