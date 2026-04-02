import React from 'react';
import { useViewStore } from '../../state/viewStore';
import { useT } from '../../i18n';
import type { EditTool, DisplayMode } from '../../state/viewStore';
import type { TKey } from '../../i18n';

const tools: { id: EditTool; labelKey: TKey; icon: string }[] = [
  { id: 'select', labelKey: 'tool.select', icon: '\u2299' },
  { id: 'addNode', labelKey: 'tool.addNode', icon: '\uFF0B' },
  { id: 'addMember', labelKey: 'tool.addMember', icon: '\u2500' },
  { id: 'setSupport', labelKey: 'tool.setSupport', icon: '\u25BD' },
  { id: 'addNodalLoad', labelKey: 'tool.addNodalLoad', icon: '\u2193' },
  { id: 'addMemberLoad', labelKey: 'tool.addMemberLoad', icon: '\u21E3' },
];

const displayModes: { id: DisplayMode; labelKey: TKey }[] = [
  { id: 'model', labelKey: 'display.model' },
  { id: 'deformation', labelKey: 'display.deformation' },
  { id: 'N', labelKey: 'display.N' },
  { id: 'Vy', labelKey: 'display.Vy' },
  { id: 'Vz', labelKey: 'display.Vz' },
  { id: 'Mx', labelKey: 'display.Mx' },
  { id: 'My', labelKey: 'display.My' },
  { id: 'Mz', labelKey: 'display.Mz' },
];

export const Toolbar: React.FC<{ onRunAnalysis: () => void }> = ({ onRunAnalysis }) => {
  const editTool = useViewStore((s) => s.editTool);
  const setEditTool = useViewStore((s) => s.setEditTool);
  const displayMode = useViewStore((s) => s.displayMode);
  const setDisplayMode = useViewStore((s) => s.setDisplayMode);
  const t = useT();

  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <div className="toolbar-title">{t('toolbar.edit')}</div>
        {tools.map((tool) => (
          <button
            key={tool.id}
            className={`toolbar-btn ${editTool === tool.id ? 'active' : ''}`}
            onClick={() => setEditTool(tool.id)}
            title={t(tool.labelKey)}
          >
            <span className="toolbar-icon">{tool.icon}</span>
            <span className="toolbar-label">{t(tool.labelKey)}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-section">
        <div className="toolbar-title">{t('toolbar.display')}</div>
        {displayModes.map((m) => (
          <button
            key={m.id}
            className={`toolbar-btn ${displayMode === m.id ? 'active' : ''}`}
            onClick={() => setDisplayMode(m.id)}
          >
            <span className="toolbar-label">{t(m.labelKey)}</span>
          </button>
        ))}
      </div>

      <div className="toolbar-section">
        <button className="toolbar-btn run-btn" onClick={onRunAnalysis}>
          {'\u25B6'} {t('toolbar.run')}
        </button>
      </div>
    </div>
  );
};
