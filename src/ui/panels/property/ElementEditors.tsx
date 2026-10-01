import React from 'react';
import type {
  GlobalMemberLoadDirection,
  MemberLoad,
  MemberLoadDirection,
  Restraint,
} from '../../../core/model/types';
import { get2dModeConfig, getAnalysisMode, getDefaultMemberLoadDirectionForMode } from '../../../core/model/analysisMode';
import { getActiveLoadCaseId, getLoadCases } from '../../../core/model/loadCases';
import { memberLabel, nodeLabel } from '../../../core/model/displayNumbers';
import {
  DOF_NAMES,
  FREE_RESTRAINT,
  restraintFromPreset,
  restraintPresetName,
} from '../../../core/model/restraints';
import { formatEngineering } from '../../../core/formatEngineering';
import { useT } from '../../../i18n';
import { useProjectStore } from '../../../state/projectStore';
import { useSelectionStore } from '../../../state/selectionStore';


function NumberField({ value, unit, onChange, disabled }: { value: number; unit?: string; onChange: (value: number) => void; disabled?: boolean }) {
  return <span className="unit-input"><input type="number" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} />{unit && <span>{unit}</span>}</span>;
}

function restraintPreset(restraint: Restraint): string {
  return restraintPresetName(restraint) ?? 'custom';
}

function presetRestraint(value: string, current: Restraint): Restraint {
  return restraintFromPreset(value) ?? current;
}

export const NodeEditor: React.FC<{ nodeId: string }> = ({ nodeId }) => {
  const t = useT();
  const model = useProjectStore((state) => state.model);
  const updateNode = useProjectStore((state) => state.updateNode);
  const removeNode = useProjectStore((state) => state.removeNode);
  const addNodeSpring = useProjectStore((state) => state.addNodeSpring);
  const updateNodeSpring = useProjectStore((state) => state.updateNodeSpring);
  const removeNodeSpring = useProjectStore((state) => state.removeNodeSpring);
  const addNodalLoad = useProjectStore((state) => state.addNodalLoad);
  const updateNodalLoad = useProjectStore((state) => state.updateNodalLoad);
  const removeNodalLoad = useProjectStore((state) => state.removeNodalLoad);
  const addPrescribedDisplacement = useProjectStore((state) => state.addPrescribedDisplacement);
  const updatePrescribedDisplacement = useProjectStore((state) => state.updatePrescribedDisplacement);
  const removePrescribedDisplacement = useProjectStore((state) => state.removePrescribedDisplacement);
  const addNodeMass = useProjectStore((state) => state.addNodeMass);
  const updateNodeMass = useProjectStore((state) => state.updateNodeMass);
  const removeNodeMass = useProjectStore((state) => state.removeNodeMass);
  const clearSelection = useSelectionStore((state) => state.clearSelection);
  const node = model.nodes.find((candidate) => candidate.id === nodeId);
  if (!node) return null;
  const locked = get2dModeConfig(getAnalysisMode(model))?.lockedCoordinate;
  const loads = model.nodalLoads.filter((load) => load.nodeId === nodeId);
  const nodeSprings = (model.nodeSprings ?? []).filter((spring) => spring.nodeId === nodeId);
  const prescribed = (model.prescribedDisplacements ?? []).filter((item) => item.nodeId === nodeId);
  const nodeMasses = (model.nodeMasses ?? []).filter((item) => item.nodeId === nodeId);
  const hasRestraint = DOF_NAMES.some((dof) => node.restraint[dof]);
  const cases = getLoadCases(model);

  return (
    <div className="element-editor">
      <h4 title={node.id}>{nodeLabel(node)}</h4>
      <section className="prop-group">
        <div className="prop-title">{t('prop.coordinates')}</div>
        {(['x', 'y', 'z'] as const).map((axis) => <div className="prop-row" key={axis}><label>{axis.toUpperCase()}</label><NumberField value={node[axis]} unit={model.units.length} disabled={locked === axis} onChange={(value) => updateNode(node.id, { [axis]: value })} /></div>)}
      </section>
      <section className="prop-group">
        <div className="prop-title">{t('prop.nodeSprings')}</div>
        {nodeSprings.map((spring, index) => <div className="load-item" key={spring.id}>
          <div className="muted">{t('prop.spring')} {index + 1}</div>
          {DOF_NAMES.map((dof) => <div className="prop-row" key={dof}>
            <label>k{dof}</label>
            <NumberField
              value={spring[dof]}
              unit={dof.startsWith('r') ? model.units.moment : `${model.units.force}/${model.units.length}`}
              onChange={(value) => updateNodeSpring(spring.id, { [dof]: Math.max(0, value) })}
            />
          </div>)}
          <button className="danger small" onClick={() => removeNodeSpring(spring.id)}>{t('prop.removeSpring')}</button>
        </div>)}
        <div className="prop-actions"><button onClick={() => addNodeSpring({ nodeId, ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })}>{t('prop.addSpring')}</button></div>
      </section>
      <section className="prop-group">
        <div className="prop-title">{t('prop.restraints')}</div>
        <div className="prop-row"><label>{t('prop.supportPreset')}</label><select value={restraintPreset(node.restraint)} onChange={(event) => updateNode(node.id, { restraint: presetRestraint(event.target.value, node.restraint) })}><option value="free">{t('prop.supportFree')}</option><option value="pin">{t('prop.supportPin')}</option><option value="roller-z">{t('prop.supportRollerZ')}</option><option value="fixed">{t('prop.supportFixed')}</option>{restraintPreset(node.restraint) === 'custom' && <option value="custom">{t('prop.supportCustom')}</option>}</select></div>
        <div className="dof-grid">{DOF_NAMES.map((dof) => <label key={dof}><input type="checkbox" checked={node.restraint[dof]} onChange={(event) => updateNode(node.id, { restraint: { ...node.restraint, [dof]: event.target.checked } })} />{dof}</label>)}</div>
      </section>
      <section className="prop-group">
        <div className="prop-title">{t('prop.nodalLoads')}</div>
        {loads.map((load) => <div className="load-item" key={load.id}>
          <div className="prop-row"><label>{t('prop.loadCase')}</label><select value={load.loadCaseId} onChange={(event) => updateNodalLoad(load.id, { loadCaseId: event.target.value })}>{cases.map((loadCase) => <option key={loadCase.id} value={loadCase.id}>{loadCase.name}</option>)}</select></div>
          {(['fx', 'fy', 'fz', 'mx', 'my', 'mz'] as const).map((key) => <div className="prop-row" key={key}><label>{key.toUpperCase()}</label><NumberField value={load[key]} unit={key.startsWith('m') ? model.units.moment : model.units.force} onChange={(value) => updateNodalLoad(load.id, { [key]: value })} /></div>)}
          <button className="danger small" onClick={() => removeNodalLoad(load.id)}>{t('prop.removeLoad')}</button>
        </div>)}
        <div className="prop-actions"><button onClick={() => addNodalLoad({ nodeId, loadCaseId: getActiveLoadCaseId(model), fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 })}>{t('prop.addLoad')}</button></div>
      </section>
      <section className="prop-group">
        <div className="prop-title">{t('prop.prescribedDisplacements')}</div>
        {prescribed.map((item) => <div className="load-item" key={item.id}>
          <div className="prop-row"><label>{t('prop.loadCase')}</label><select value={item.loadCaseId} onChange={(event) => updatePrescribedDisplacement(item.id, { loadCaseId: event.target.value })}>{cases.map((loadCase) => <option key={loadCase.id} value={loadCase.id}>{loadCase.name}</option>)}</select></div>
          {DOF_NAMES.map((dof) => <div className="prop-row" key={dof}>
            <label>{dof}</label>
            <NumberField
              value={item[dof]}
              unit={dof.startsWith('r') ? 'rad' : model.units.length}
              disabled={!node.restraint[dof]}
              onChange={(value) => updatePrescribedDisplacement(item.id, { [dof]: value })}
            />
          </div>)}
          <button className="danger small" onClick={() => removePrescribedDisplacement(item.id)}>{t('prop.delete')}</button>
        </div>)}
        {!hasRestraint && <div className="muted">{t('prop.prescribedDisplacementNote')}</div>}
        <div className="prop-actions"><button disabled={!hasRestraint} onClick={() => addPrescribedDisplacement({ nodeId, loadCaseId: getActiveLoadCaseId(model), ux: 0, uy: 0, uz: 0, rx: 0, ry: 0, rz: 0 })}>{t('prop.addPrescribedDisplacement')}</button></div>
      </section>
      <section className="prop-group">
        <div className="prop-title">{t('prop.nodeMasses')}</div>
        {nodeMasses.map((item) => <div className="load-item" key={item.id}>
          <div className="prop-row"><label>m</label><NumberField value={item.mass} onChange={(value) => updateNodeMass(item.id, { mass: Math.max(0, value) })} /></div>
          <button className="danger small" onClick={() => removeNodeMass(item.id)}>{t('prop.delete')}</button>
        </div>)}
        <div className="muted">{t('prop.nodeMassNote')}</div>
        <div className="prop-actions"><button onClick={() => addNodeMass({ nodeId, mass: 0 })}>{t('prop.addNodeMass')}</button></div>
      </section>
      <div className="prop-actions"><button className="danger" onClick={() => { removeNode(node.id); clearSelection(); }}>{t('prop.deleteNode')}</button></div>
    </div>
  );
};

const CMQ_KEYS = ['iQx', 'iQy', 'iQz', 'iMy', 'iMz', 'jQx', 'jQy', 'jQz', 'jMy', 'jMz', 'moy', 'moz'] as const;
const MEMBER_LOAD_DIRECTIONS: MemberLoadDirection[] = ['localX', 'localY', 'localZ', 'globalX', 'globalY', 'globalZ'];
const GLOBAL_LOAD_DIRECTIONS: GlobalMemberLoadDirection[] = ['globalX', 'globalY', 'globalZ'];

export const MemberEditor: React.FC<{ memberId: string }> = ({ memberId }) => {
  const t = useT();
  const model = useProjectStore((state) => state.model);
  const updateMember = useProjectStore((state) => state.updateMember);
  const removeMember = useProjectStore((state) => state.removeMember);
  const addMemberLoad = useProjectStore((state) => state.addMemberLoad);
  const updateMemberLoad = useProjectStore((state) => state.updateMemberLoad);
  const replaceMemberLoad = useProjectStore((state) => state.replaceMemberLoad);
  const removeMemberLoad = useProjectStore((state) => state.removeMemberLoad);
  const clearSelection = useSelectionStore((state) => state.clearSelection);
  const member = model.members.find((candidate) => candidate.id === memberId);
  if (!member) return null;
  const ni = model.nodes.find((node) => node.id === member.ni);
  const nj = model.nodes.find((node) => node.id === member.nj);
  const length = ni && nj ? Math.hypot(nj.x - ni.x, nj.y - ni.y, nj.z - ni.z) : 0;
  const loads = model.memberLoads.filter((load) => load.memberId === memberId);
  const cases = getLoadCases(model);

  const changeLoadType = (load: MemberLoad, type: MemberLoad['type']) => {
    const loadCaseId = load.loadCaseId ?? getActiveLoadCaseId(model);
    const previousValue = 'value' in load ? load.value : type === 'selfWeight' ? 1 : 0;
    const previousDirection = 'direction' in load ? load.direction : 'localZ';
    if (type === 'cmq') {
      replaceMemberLoad(load.id, { memberId, loadCaseId, type, iQx: 0, iQy: 0, iQz: 0, iMy: 0, iMz: 0, jQx: 0, jQy: 0, jQz: 0, jMy: 0, jMz: 0, moy: 0, moz: 0 });
    } else if (type === 'point') {
      replaceMemberLoad(load.id, { memberId, loadCaseId, type, direction: previousDirection, value: previousValue, a: length / 2 });
    } else if (type === 'udl') {
      replaceMemberLoad(load.id, { memberId, loadCaseId, type, direction: previousDirection, value: previousValue });
    } else if (type === 'trapezoid') {
      replaceMemberLoad(load.id, { memberId, loadCaseId, type, direction: previousDirection, value: previousValue, valueEnd: previousValue, a: 0, b: length });
    } else if (type === 'temperature') {
      replaceMemberLoad(load.id, { memberId, loadCaseId, type, direction: 'localX', value: previousValue });
    } else {
      replaceMemberLoad(load.id, { memberId, loadCaseId, type, direction: load.type === 'selfWeight' ? load.direction : 'globalZ', value: 'value' in load ? load.value : 1 });
    }
  };

  return (
    <div className="element-editor">
      <h4 title={member.id}>{memberLabel(member)}</h4>
      <section className="prop-group">
        <div className="prop-row"><label>i / j</label><span>{nodeLabel(ni)} → {nodeLabel(nj)}</span></div>
        <div className="prop-row"><label>{t('prop.length')}</label><span>{formatEngineering(length)} {model.units.length}</span></div>
        <div className="prop-row"><label>{t('prop.section')}</label><select value={member.sectionId} onChange={(event) => updateMember(member.id, { sectionId: event.target.value })}>{model.sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></div>
        <div className="prop-row"><label>{t('prop.codeAngle')}</label><NumberField value={member.codeAngle} unit="°" onChange={(value) => updateMember(member.id, { codeAngle: value })} /></div>
        <div className="prop-row"><label>{t('prop.torsionRestraint')}</label><select value={member.torsionRestraint ?? 'none'} onChange={(event) => updateMember(member.id, { torsionRestraint: event.target.value as 'none' | 'i' | 'j' })}><option value="none">{t('prop.torsionRestraintNone')}</option><option value="i">{t('prop.torsionRestraintI')}</option><option value="j">{t('prop.torsionRestraintJ')}</option></select></div>
      </section>
      <section className="prop-group">
        <div className="prop-title">{t('prop.memberLoads')}</div>
        {loads.map((load) => <div className="load-item" key={load.id}>
          <div className="prop-row"><label>{t('prop.loadCase')}</label><select value={load.loadCaseId} onChange={(event) => updateMemberLoad(load.id, { loadCaseId: event.target.value })}>{cases.map((loadCase) => <option key={loadCase.id} value={loadCase.id}>{loadCase.name}</option>)}</select></div>
          <div className="prop-row"><label>{t('prop.loadType')}</label><select value={load.type} onChange={(event) => changeLoadType(load, event.target.value as MemberLoad['type'])}><option value="udl">{t('prop.loadTypeUdl')}</option><option value="trapezoid">{t('prop.loadTypeTrapezoid')}</option><option value="point">{t('prop.loadTypePoint')}</option><option value="cmq">{t('prop.loadTypeCmq')}</option><option value="temperature">{t('prop.loadTypeTemperature')}</option><option value="selfWeight">{t('prop.loadTypeSelfWeight')}</option></select></div>
          {(load.type === 'point' || load.type === 'udl' || load.type === 'trapezoid') && <>
            <div className="prop-row"><label>{t('prop.loadDirection')}</label><select value={load.direction} onChange={(event) => updateMemberLoad(load.id, { direction: event.target.value as MemberLoadDirection })}>{MEMBER_LOAD_DIRECTIONS.map((direction) => <option key={direction}>{direction}</option>)}</select></div>
            <div className="prop-row"><label>{load.type === 'trapezoid' ? t('prop.valueStart') : t('prop.value')}</label><NumberField value={load.value} unit={load.type === 'point' ? model.units.force : `${model.units.force}/${model.units.length}`} onChange={(value) => updateMemberLoad(load.id, { value })} /></div>
          </>}
          {load.type === 'trapezoid' && <>
            <div className="prop-row"><label>{t('prop.valueEnd')}</label><NumberField value={load.valueEnd} unit={`${model.units.force}/${model.units.length}`} onChange={(valueEnd) => updateMemberLoad(load.id, { valueEnd })} /></div>
            <div className="prop-row"><label>a</label><NumberField value={load.a} unit={model.units.length} onChange={(value) => updateMemberLoad(load.id, { a: Math.max(0, Math.min(length, value)) })} /></div>
            <div className="prop-row"><label>b</label><NumberField value={load.b} unit={model.units.length} onChange={(value) => updateMemberLoad(load.id, { b: Math.max(0, Math.min(length, value)) })} /></div>
          </>}
          {load.type === 'temperature' && <div className="prop-row"><label>ΔT</label><NumberField value={load.value} onChange={(value) => updateMemberLoad(load.id, { value })} /></div>}
          {load.type === 'selfWeight' && <>
            <div className="prop-row"><label>{t('prop.selfWeightDisplayDirection')}</label><select value={load.direction} title={t('prop.selfWeightDirectionTitle')} onChange={(event) => updateMemberLoad(load.id, { direction: event.target.value as GlobalMemberLoadDirection })}>{GLOBAL_LOAD_DIRECTIONS.map((direction) => <option key={direction}>{direction}</option>)}</select></div>
            <div className="prop-row"><label>{t('prop.multiplier')}</label><NumberField value={load.value} onChange={(value) => updateMemberLoad(load.id, { value })} /></div>
          </>}
          {load.type === 'point' && <div className="prop-row"><label>a</label><NumberField value={load.a} unit={model.units.length} onChange={(value) => updateMemberLoad(load.id, { a: Math.max(0, Math.min(length, value)) })} /></div>}
          {load.type === 'cmq' && <div className="cmq-grid">{CMQ_KEYS.map((key) => <label key={key}><span>{key}</span><input type="number" value={load[key]} onChange={(event) => updateMemberLoad(load.id, { [key]: Number(event.target.value) })} /></label>)}</div>}
          <button className="danger small" onClick={() => removeMemberLoad(load.id)}>{t('prop.removeLoad')}</button>
        </div>)}
        <div className="prop-actions"><button onClick={() => addMemberLoad({ memberId, loadCaseId: getActiveLoadCaseId(model), type: 'udl', direction: getDefaultMemberLoadDirectionForMode(model, memberId, getAnalysisMode(model)), value: 0 })}>{t('prop.addLoad')}</button></div>
      </section>
      <div className="prop-actions"><button className="danger" onClick={() => { removeMember(member.id); clearSelection(); }}>{t('prop.deleteMember')}</button></div>
    </div>
  );
};

export const BulkEditor: React.FC<{ nodeIds: Set<string>; memberIds: Set<string> }> = ({ nodeIds, memberIds }) => {
  const t = useT();
  const model = useProjectStore((state) => state.model);
  const updateNodes = useProjectStore((state) => state.updateNodes);
  const updateMembers = useProjectStore((state) => state.updateMembers);
  const removeNode = useProjectStore((state) => state.removeNode);
  const removeMember = useProjectStore((state) => state.removeMember);
  const clearSelection = useSelectionStore((state) => state.clearSelection);
  return <div className="element-editor"><h4>{t('prop.bulkEdit')}</h4>
    <div className="prop-group"><div className="prop-row"><label>{t('prop.selection')}</label><span>{nodeIds.size} {t('prop.nodesShort')} / {memberIds.size} {t('prop.membersShort')}</span></div>
      {nodeIds.size > 0 && <div className="prop-row"><label>{t('prop.supports')}</label><select defaultValue="" onChange={(event) => event.target.value && updateNodes(nodeIds, { restraint: presetRestraint(event.target.value, { ...FREE_RESTRAINT }) })}><option value="">—</option><option value="free">{t('prop.supportFree')}</option><option value="pin">{t('prop.supportPin')}</option><option value="roller-z">{t('prop.supportRollerZ')}</option><option value="fixed">{t('prop.supportFixed')}</option></select></div>}
      {memberIds.size > 0 && <div className="prop-row"><label>{t('prop.section')}</label><select defaultValue="" onChange={(event) => event.target.value && updateMembers(memberIds, { sectionId: event.target.value })}><option value="">—</option>{model.sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}</select></div>}
    </div>
    <div className="prop-actions"><button className="danger" onClick={() => { memberIds.forEach(removeMember); nodeIds.forEach(removeNode); clearSelection(); }}>{t('prop.deleteSelection')}</button></div>
  </div>;
};
