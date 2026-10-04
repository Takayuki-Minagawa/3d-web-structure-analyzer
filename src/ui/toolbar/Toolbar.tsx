import React from 'react';
import { useViewStore } from '../../state/viewStore';
import { useT } from '../../i18n';
import type { EditTool, DisplayMode } from '../../state/viewStore';
import type { TKey } from '../../i18n';
import { redoProject, undoProject, useProjectHistory } from '../../state/projectStore';
import type { AnalysisKind } from '../../worker/protocol';

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
  { id: 'modeShape', labelKey: 'display.modeShape' },
  { id: 'N', labelKey: 'display.N' },
  { id: 'Vy', labelKey: 'display.Vy' },
  { id: 'Vz', labelKey: 'display.Vz' },
  { id: 'Mx', labelKey: 'display.Mx' },
  { id: 'My', labelKey: 'display.My' },
  { id: 'Mz', labelKey: 'display.Mz' },
];

interface ToolbarProps {
  onRunAnalysis: (kind: AnalysisKind) => void;
  onCancelAnalysis: () => void;
  isAnalyzing: boolean;
  onOpenGenerator: () => void;
  onOpenTables: () => void;
  onOpenDiagnostics: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({ onRunAnalysis, onCancelAnalysis, isAnalyzing, onOpenGenerator, onOpenTables, onOpenDiagnostics }) => {
  const editTool = useViewStore((s) => s.editTool);
  const setEditTool = useViewStore((s) => s.setEditTool);
  const displayMode = useViewStore((s) => s.displayMode);
  const setDisplayMode = useViewStore((s) => s.setDisplayMode);
  const t = useT();
  const canUndo = useProjectHistory((state) => state.pastStates.length > 0);
  const canRedo = useProjectHistory((state) => state.futureStates.length > 0);

  return (
    <div className="toolbar">
      <div className="toolbar-section">
        <div className="toolbar-title">{t('toolbar.history')}</div>
        <div className="toolbar-inline">
          <button className="toolbar-btn" disabled={!canUndo} onClick={undoProject} title={t('toolbar.undoTitle')}><span className="toolbar-icon">↶</span><span className="toolbar-label">{t('toolbar.undo')}</span></button>
          <button className="toolbar-btn" disabled={!canRedo} onClick={redoProject} title={t('toolbar.redoTitle')}><span className="toolbar-icon">↷</span><span className="toolbar-label">{t('toolbar.redo')}</span></button>
        </div>
        <button className="toolbar-btn" onClick={onOpenGenerator}><span className="toolbar-icon">▦</span><span className="toolbar-label">{t('toolbar.generator')}</span></button>
        <button className="toolbar-btn" onClick={onOpenTables}><span className="toolbar-icon">▤</span><span className="toolbar-label">{t('toolbar.tables')}</span></button>
      </div>
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

      <div className="toolbar-section toolbar-analysis">
        <div className="toolbar-title">{t('toolbar.analysis')}</div>
        <button className="toolbar-btn" onClick={onOpenDiagnostics}>
          <span className="toolbar-label">{t('diagnostics.title')}</span>
        </button>
        <button className={`toolbar-btn ${isAnalyzing ? 'cancel-btn' : 'run-btn'}`} onClick={isAnalyzing ? onCancelAnalysis : () => onRunAnalysis('static')}>
          {isAnalyzing ? `■ ${t('results.analyzing')}` : `\u25B6 ${t('toolbar.run')}`}
        </button>
        <button className="toolbar-btn" disabled={isAnalyzing} onClick={() => onRunAnalysis('modal')} title={t('toolbar.runModalTitle')}>
          <span className="toolbar-label">{t('toolbar.runModal')}</span>
        </button>
        <button className="toolbar-btn" disabled={isAnalyzing} onClick={() => onRunAnalysis('buckling')} title={t('toolbar.runBucklingTitle')}>
          <span className="toolbar-label">{t('toolbar.runBuckling')}</span>
        </button>
      </div>
    </div>
  );
};
