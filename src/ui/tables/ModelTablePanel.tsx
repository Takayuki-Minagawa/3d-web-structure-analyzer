import React, { useMemo, useState } from 'react';
import { useProjectStore } from '../../state/projectStore';
import { useSelectionStore } from '../../state/selectionStore';
import { getActiveLoadCaseId, getLoadCases } from '../../core/model/loadCases';
import { memberLabel, nodeLabel } from '../../core/model/displayNumbers';
import type { MemberLoad, MemberLoadDirection, Restraint } from '../../core/model/types';
import { restraintFromPreset } from '../../core/model/restraints';
import { useT, type TKey } from '../../i18n';
import {
  exportModelTable,
  importModelTable,
  restraintPreset,
  type ModelTableKind,
} from './modelTableClipboard';

interface Props {
  open: boolean;
  onClose: () => void;
}

const TABS: { kind: ModelTableKind; labelKey: TKey }[] = [
  { kind: 'nodes', labelKey: 'table.tab.nodes' },
  { kind: 'members', labelKey: 'table.tab.members' },
  { kind: 'nodalLoads', labelKey: 'table.tab.nodalLoads' },
  { kind: 'memberLoads', labelKey: 'table.tab.memberLoads' },
];

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.split(`{${key}}`).join(String(value)),
    template,
  );
}

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function supportFromPreset(value: string, current: Restraint): Restraint {
  return restraintFromPreset(value) ?? current;
}

export const ModelTablePanel: React.FC<Props> = ({ open, onClose }) => {
  const t = useT();
  const model = useProjectStore((state) => state.model);
  const loadModel = useProjectStore((state) => state.loadModel);
  const addNode = useProjectStore((state) => state.addNode);
  const updateNode = useProjectStore((state) => state.updateNode);
  const removeNode = useProjectStore((state) => state.removeNode);
  const addMember = useProjectStore((state) => state.addMember);
  const updateMember = useProjectStore((state) => state.updateMember);
  const removeMember = useProjectStore((state) => state.removeMember);
  const addNodalLoad = useProjectStore((state) => state.addNodalLoad);
  const updateNodalLoad = useProjectStore((state) => state.updateNodalLoad);
  const removeNodalLoad = useProjectStore((state) => state.removeNodalLoad);
  const addMemberLoad = useProjectStore((state) => state.addMemberLoad);
  const updateMemberLoad = useProjectStore((state) => state.updateMemberLoad);
  const removeMemberLoad = useProjectStore((state) => state.removeMemberLoad);
  const selectNode = useSelectionStore((state) => state.selectNode);
  const selectMember = useSelectionStore((state) => state.selectMember);
  const focusSelection = useSelectionStore((state) => state.focusSelection);
  const [tab, setTab] = useState<ModelTableKind>('nodes');
  const [clipboardText, setClipboardText] = useState('');
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  const memberById = useMemo(() => new Map(model.members.map((member) => [member.id, member])), [model.members]);
  const loadCases = getLoadCases(model);

  if (!open) return null;

  const selectAndFocusNode = (id: string) => {
    selectNode(id);
    focusSelection();
  };
  const selectAndFocusMember = (id: string) => {
    selectMember(id);
    focusSelection();
  };

  const copy = async () => {
    const value = exportModelTable(model, tab);
    setClipboardText(value);
    try {
      await navigator.clipboard.writeText(value);
      setMessage({ text: t('table.status.copied'), error: false });
    } catch {
      setMessage({ text: t('table.status.copyFallback'), error: true });
    }
  };

  const readClipboard = async () => {
    try {
      const value = await navigator.clipboard.readText();
      setClipboardText(value);
      setMessage({ text: t('table.status.clipboardRead'), error: false });
    } catch {
      setMessage({ text: t('table.status.clipboardFallback'), error: true });
    }
  };

  const applyPaste = () => {
    try {
      const result = importModelTable(model, tab, clipboardText);
      loadModel(result.model);
      const warnings = result.warnings.length
        ? formatMessage(t('table.status.warning'), { warnings: result.warnings.join(' / ') })
        : '';
      setMessage({
        text: formatMessage(t('table.status.applied'), { count: result.imported, warnings }),
        error: result.warnings.length > 0,
      });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : t('table.status.failed'), error: true });
    }
  };

  return (
    <div className="modal-overlay" role="presentation">
      <section className="modal-content model-table-modal" role="dialog" aria-modal="true" aria-label={t('table.title')}>
        <header className="modal-header">
          <h2>{t('table.title')}</h2>
          <button onClick={onClose}>{t('common.close')}</button>
        </header>
        <div className="table-editor-tabs" role="tablist">
          {TABS.map((item) => (
            <button key={item.kind} className={tab === item.kind ? 'active' : ''} onClick={() => setTab(item.kind)}>
              {t(item.labelKey)}
            </button>
          ))}
        </div>
        <div className="model-table-scroll">
          {tab === 'nodes' && (
            <table className="edit-table">
              <thead><tr><th>No</th><th>X [{model.units.length}]</th><th>Y [{model.units.length}]</th><th>Z [{model.units.length}]</th><th>{t('table.support')}</th><th /></tr></thead>
              <tbody>
                {model.nodes.map((node) => (
                  <tr key={node.id} onClick={() => selectAndFocusNode(node.id)}>
                    <td>{nodeLabel(node)}</td>
                    {(['x', 'y', 'z'] as const).map((axis) => (
                      <td key={axis}><input type="number" value={node[axis]} onChange={(event) => updateNode(node.id, { [axis]: numeric(event.target.value) })} /></td>
                    ))}
                    <td>
                      <select value={restraintPreset(node.restraint)} onChange={(event) => updateNode(node.id, { restraint: supportFromPreset(event.target.value, node.restraint) })}>
                        <option value="free">{t('common.free')}</option><option value="pin">{t('common.pin')}</option><option value="roller-z">{t('common.rollerZ')}</option><option value="fixed">{t('common.fixed')}</option>
                        {!['free', 'pin', 'roller-z', 'fixed'].includes(restraintPreset(node.restraint)) && <option value={restraintPreset(node.restraint)}>{t('common.custom')}</option>}
                      </select>
                    </td>
                    <td><button className="danger" onClick={(event) => { event.stopPropagation(); removeNode(node.id); }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'members' && (
            <table className="edit-table">
              <thead><tr><th>No</th><th>{t('table.iNode')}</th><th>{t('table.jNode')}</th><th>{t('table.section')}</th><th>{t('table.codeAngle')} [°]</th><th /></tr></thead>
              <tbody>
                {model.members.map((member) => (
                  <tr key={member.id} onClick={() => selectAndFocusMember(member.id)}>
                    <td>{memberLabel(member)}</td>
                    {(['ni', 'nj'] as const).map((end) => (
                      <td key={end}><select value={member[end]} onChange={(event) => updateMember(member.id, { [end]: event.target.value })}>
                        {model.nodes.map((node) => <option key={node.id} value={node.id}>{nodeLabel(node)}</option>)}
                      </select></td>
                    ))}
                    <td><select value={member.sectionId} onChange={(event) => updateMember(member.id, { sectionId: event.target.value })}>
                      {model.sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
                    </select></td>
                    <td><input type="number" value={member.codeAngle} onChange={(event) => updateMember(member.id, { codeAngle: numeric(event.target.value) })} /></td>
                    <td><button className="danger" onClick={(event) => { event.stopPropagation(); removeMember(member.id); }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'nodalLoads' && (
            <table className="edit-table">
              <thead><tr><th>{t('table.target')}</th><th>{t('table.case')}</th>{['Fx', 'Fy', 'Fz', 'Mx', 'My', 'Mz'].map((key) => <th key={key}>{key} [{key.startsWith('M') ? model.units.moment : model.units.force}]</th>)}<th /></tr></thead>
              <tbody>
                {model.nodalLoads.map((load) => (
                  <tr key={load.id} onClick={() => selectAndFocusNode(load.nodeId)}>
                    <td><select value={load.nodeId} onChange={(event) => updateNodalLoad(load.id, { nodeId: event.target.value })}>{model.nodes.map((node) => <option key={node.id} value={node.id}>{nodeLabel(node)}</option>)}</select></td>
                    <td><select value={load.loadCaseId} onChange={(event) => updateNodalLoad(load.id, { loadCaseId: event.target.value })}>{loadCases.map((loadCase) => <option key={loadCase.id} value={loadCase.id}>{loadCase.name}</option>)}</select></td>
                    {(['fx', 'fy', 'fz', 'mx', 'my', 'mz'] as const).map((key) => <td key={key}><input type="number" value={load[key]} onChange={(event) => updateNodalLoad(load.id, { [key]: numeric(event.target.value) })} /></td>)}
                    <td><button className="danger" onClick={(event) => { event.stopPropagation(); removeNodalLoad(load.id); }}>×</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === 'memberLoads' && (
            <table className="edit-table">
              <thead><tr><th>{t('table.target')}</th><th>{t('table.case')}</th><th>{t('table.type')}</th><th>{t('table.direction')}</th><th>{t('table.value')}</th><th>a</th><th>w2</th><th>b</th><th /></tr></thead>
              <tbody>
                {model.memberLoads.map((load) => (
                  <MemberLoadRow key={load.id} load={load} model={model} memberName={memberLabel(memberById.get(load.memberId))} onSelect={selectAndFocusMember} onUpdate={updateMemberLoad} onRemove={removeMemberLoad} />
                ))}
              </tbody>
            </table>
          )}
        </div>
        <footer className="table-editor-footer">
          <div className="table-editor-actions">
            <button onClick={() => {
              if (tab === 'nodes') addNode(0, 0, 0);
              else if (tab === 'members' && model.nodes.length >= 2) addMember(model.nodes[0]!.id, model.nodes[1]!.id);
              else if (tab === 'nodalLoads' && model.nodes[0]) addNodalLoad({ nodeId: model.nodes[0].id, loadCaseId: getActiveLoadCaseId(model), fx: 0, fy: 0, fz: 0, mx: 0, my: 0, mz: 0 });
              else if (tab === 'memberLoads' && model.members[0]) addMemberLoad({ memberId: model.members[0].id, loadCaseId: getActiveLoadCaseId(model), type: 'udl', direction: 'localZ', value: 0 });
            }}>{t('table.addRow')}</button>
            <button onClick={copy}>{t('table.copyTsv')}</button>
            <button onClick={readClipboard}>{t('table.readClipboard')}</button>
            <button onClick={applyPaste} disabled={!clipboardText.trim()}>{t('table.applyTsv')}</button>
          </div>
          <textarea value={clipboardText} onChange={(event) => setClipboardText(event.target.value)} placeholder={t('table.tsvPlaceholder')} />
          {message && <div className={message.error ? 'error-text' : 'status-text'}>{message.text}</div>}
        </footer>
      </section>
    </div>
  );
};

interface MemberLoadRowProps {
  load: MemberLoad;
  model: ReturnType<typeof useProjectStore.getState>['model'];
  memberName: string;
  onSelect: (id: string) => void;
  onUpdate: ReturnType<typeof useProjectStore.getState>['updateMemberLoad'];
  onRemove: ReturnType<typeof useProjectStore.getState>['removeMemberLoad'];
}

const MemberLoadRow: React.FC<MemberLoadRowProps> = ({ load, model, memberName, onSelect, onUpdate, onRemove }) => {
  const t = useT();
  const loadCases = getLoadCases(model);
  const value = 'value' in load ? load.value : 0;
  const directions: MemberLoadDirection[] = load.type === 'selfWeight'
    ? ['globalX', 'globalY', 'globalZ']
    : load.type === 'temperature'
      ? ['localX']
      : ['localX', 'localY', 'localZ', 'globalX', 'globalY', 'globalZ'];
  const typeLabel = load.type === 'udl'
    ? t('prop.loadTypeUdl')
    : load.type === 'trapezoid'
      ? t('prop.loadTypeTrapezoid')
    : load.type === 'point'
      ? t('prop.loadTypePoint')
      : load.type === 'temperature'
        ? t('prop.loadTypeTemperature')
        : load.type === 'selfWeight'
          ? t('prop.loadTypeSelfWeight')
          : t('prop.loadTypeCmq');
  return (
    <tr onClick={() => onSelect(load.memberId)}>
      <td title={memberName}><select value={load.memberId} onChange={(event) => onUpdate(load.id, { memberId: event.target.value })}>{model.members.map((member) => <option key={member.id} value={member.id}>{memberLabel(member)}</option>)}</select></td>
      <td><select value={load.loadCaseId} onChange={(event) => onUpdate(load.id, { loadCaseId: event.target.value })}>{loadCases.map((loadCase) => <option key={loadCase.id} value={loadCase.id}>{loadCase.name}</option>)}</select></td>
      <td>{typeLabel}</td>
      <td>{'direction' in load ? <select value={load.direction} disabled={load.type === 'temperature'} onChange={(event) => onUpdate(load.id, { direction: event.target.value as MemberLoadDirection })}>{directions.map((direction) => <option key={direction}>{direction}</option>)}</select> : '—'}</td>
      <td>{'value' in load ? <input type="number" value={value} onChange={(event) => onUpdate(load.id, { value: numeric(event.target.value) })} /> : 'CMQ'}</td>
      <td>{load.type === 'point' || load.type === 'trapezoid' ? <input type="number" value={load.a} onChange={(event) => onUpdate(load.id, { a: numeric(event.target.value) })} /> : '—'}</td>
      <td>{load.type === 'trapezoid' ? <input type="number" value={load.valueEnd} onChange={(event) => onUpdate(load.id, { valueEnd: numeric(event.target.value) })} /> : '—'}</td>
      <td>{load.type === 'trapezoid' ? <input type="number" value={load.b} onChange={(event) => onUpdate(load.id, { b: numeric(event.target.value) })} /> : '—'}</td>
      <td><button className="danger" onClick={(event) => { event.stopPropagation(); onRemove(load.id); }}>×</button></td>
    </tr>
  );
};
