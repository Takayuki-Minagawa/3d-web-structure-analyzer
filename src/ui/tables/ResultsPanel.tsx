import React, { useState, useMemo } from 'react';
import { useProjectStore } from '../../state/projectStore';
import { useT } from '../../i18n';
import type { TKey } from '../../i18n';
import type {
  AnalysisError,
  DofName,
  ProjectModel,
  ReleasedMemberMode,
  StabilityDiagnostic,
} from '../../core/model/types';
import { buildEffectiveReactionRows } from './reactionRows';

type TabId = 'displacements' | 'reactions' | 'endForces';
type Translate = (key: TKey) => string;

const DOF_LABEL_KEYS: Record<DofName, TKey> = {
  ux: 'results.dof.ux',
  uy: 'results.dof.uy',
  uz: 'results.dof.uz',
  rx: 'results.dof.rx',
  ry: 'results.dof.ry',
  rz: 'results.dof.rz',
};

const RELEASE_LABEL_KEYS: Record<ReleasedMemberMode, TKey> = {
  localXTwist: 'results.release.localXTwist',
  localYBending: 'results.release.localYBending',
  localZBending: 'results.release.localZBending',
};

export const ResultsPanel: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabId>('displacements');
  const model = useProjectStore((s) => s.model);
  const result = useProjectStore((s) => s.analysisResult);
  const error = useProjectStore((s) => s.analysisError);
  const isAnalyzing = useProjectStore((s) => s.isAnalyzing);
  const isResultStale = useProjectStore((s) => s.isResultStale);
  const t = useT();

  if (isAnalyzing) {
    return <div className="results-panel"><p>{t('results.analyzing')}</p></div>;
  }

  if (error) {
    return (
      <div className="results-panel">
        <AnalysisErrorDetails error={error} />
      </div>
    );
  }

  if (!result) {
    return <div className="results-panel"><p className="muted">{t('results.noResults')}</p></div>;
  }

  return (
    <div className="results-panel">
      {isResultStale && <div className="warning-text">{t('results.stale')}</div>}
      <div className="tab-bar">
        <button className={activeTab === 'displacements' ? 'active' : ''} onClick={() => setActiveTab('displacements')}>{t('results.displacements')}</button>
        <button className={activeTab === 'reactions' ? 'active' : ''} onClick={() => setActiveTab('reactions')}>{t('results.reactions')}</button>
        <button className={activeTab === 'endForces' ? 'active' : ''} onClick={() => setActiveTab('endForces')}>{t('results.endForces')}</button>
      </div>

      {activeTab === 'displacements' && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>{t('results.node')}</th><th>ux</th><th>uy</th><th>uz</th><th>rx</th><th>ry</th><th>rz</th></tr>
            </thead>
            <tbody>
              {model.nodes.map((n, i) => (
                <tr key={n.id}>
                  <td>{n.id.substring(0, 5)}</td>
                  <td>{fmt(result.displacements[i * 6])}</td>
                  <td>{fmt(result.displacements[i * 6 + 1])}</td>
                  <td>{fmt(result.displacements[i * 6 + 2])}</td>
                  <td>{fmt(result.displacements[i * 6 + 3])}</td>
                  <td>{fmt(result.displacements[i * 6 + 4])}</td>
                  <td>{fmt(result.displacements[i * 6 + 5])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'reactions' && (
        <ReactionTable model={model} result={result} />
      )}

      {activeTab === 'endForces' && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>{t('results.member')}</th>
                <th>Ni</th><th>Vyi</th><th>Vzi</th><th>Mxi</th><th>Myi</th><th>Mzi</th>
                <th>Nj</th><th>Vyj</th><th>Vzj</th><th>Mxj</th><th>Myj</th><th>Mzj</th>
              </tr>
            </thead>
            <tbody>
              {model.members.map((m) => {
                const ef = result.elementEndForces[m.id];
                if (!ef) return null;
                return (
                  <tr key={m.id}>
                    <td>{m.id.substring(0, 5)}</td>
                    {Array.from({ length: 12 }, (_, k) => (
                      <td key={k}>{fmt(ef[k])}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="warnings">
          {result.warnings.map((w, i) => (
            <div key={i} className="warning-text">{w}</div>
          ))}
        </div>
      )}
    </div>
  );
};

const AnalysisErrorDetails: React.FC<{ error: AnalysisError }> = ({ error }) => {
  const t = useT();
  const diagnostics = error.diagnostics ?? [];

  return (
    <div className="analysis-error">
      <div className="error-text">{formatAnalysisErrorMessage(error, t)}</div>
      {diagnostics.length > 0 && (
        <div className="diagnostics-list">
          <div className="diagnostics-title">{t('results.diagnostics')}</div>
          {diagnostics.map((diagnostic, index) => (
            <DiagnosticItem key={`${diagnostic.kind}-${index}`} diagnostic={diagnostic} />
          ))}
        </div>
      )}
    </div>
  );
};

const DiagnosticItem: React.FC<{ diagnostic: StabilityDiagnostic }> = ({ diagnostic }) => {
  const t = useT();
  const formatted = formatDiagnostic(diagnostic, t);
  const meta = [
    diagnostic.nodeId ? `${t('results.node')} ${diagnostic.nodeId}` : null,
    diagnostic.elementId ? `${t('results.member')} ${diagnostic.elementId}` : null,
    diagnostic.dof ? `DOF ${diagnostic.dof}` : null,
  ].filter((item): item is string => item !== null);

  return (
    <div className="diagnostic-item">
      <div>{formatted.message}</div>
      {meta.length > 0 && <div className="diagnostic-meta">{meta.join(' / ')}</div>}
      <div className="diagnostic-suggestion">
        <span>{t('results.diagnosticSuggestion')}</span>
        {formatted.suggestion}
      </div>
    </div>
  );
};

function formatAnalysisErrorMessage(error: AnalysisError, t: Translate): string {
  if (error.type === 'singular') return t('results.error.singular');
  return error.message;
}

function formatDiagnostic(
  diagnostic: StabilityDiagnostic,
  t: Translate
): { message: string; suggestion: string } {
  if (diagnostic.kind === 'singular-pivot') {
    return {
      message: formatText(t, 'results.diagnostic.singularPivot.message', {
        nodeId: diagnostic.nodeId ?? '-',
        dofLabel: formatDofLabel(diagnostic.dof, t),
      }),
      suggestion: t('results.diagnostic.singularPivot.suggestion'),
    };
  }

  if (diagnostic.kind === 'zero-stiffness-dof') {
    return {
      message: formatText(t, 'results.diagnostic.zeroStiffness.message', {
        nodeId: diagnostic.nodeId ?? '-',
        dofLabel: formatDofLabel(diagnostic.dof, t),
      }),
      suggestion: t('results.diagnostic.zeroStiffness.suggestion'),
    };
  }

  return {
    message: formatText(t, 'results.diagnostic.releasedMember.message', {
      memberId: diagnostic.elementId ?? '-',
      releasedModes: formatReleasedModes(diagnostic, t),
    }),
    suggestion: t('results.diagnostic.releasedMember.suggestion'),
  };
}

function formatText(
  t: Translate,
  key: TKey,
  values: Record<string, string>
): string {
  return Object.entries(values).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(value),
    t(key)
  );
}

function formatDofLabel(dof: StabilityDiagnostic['dof'], t: Translate): string {
  if (!dof) return '-';
  return t(DOF_LABEL_KEYS[dof]);
}

function formatReleasedModes(diagnostic: StabilityDiagnostic, t: Translate): string {
  const released = diagnostic.released ?? [];
  if (released.length === 0) return '-';
  const separator = t('results.listSeparator');
  return released.map((mode) => t(RELEASE_LABEL_KEYS[mode])).join(separator);
}

function useEffectiveReactions(model: ProjectModel, reactions: number[]) {
  return useMemo(
    () => buildEffectiveReactionRows(model, reactions),
    [model, reactions]
  );
}

const ReactionTable: React.FC<{
  model: ProjectModel;
  result: import('../../state/projectStore').AnalysisResult;
}> = ({ model, result }) => {
  const t = useT();
  const { rows, hasSharedReactions } = useEffectiveReactions(model, result.reactions);

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr><th>{t('results.node')}</th><th>Rx</th><th>Ry</th><th>Rz</th><th>Mx</th><th>My</th><th>Mz</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.nodeId}>
              <td>{row.nodeId.substring(0, 5)}</td>
              {row.cells.map((cell, k) => (
                <td key={k}>
                  {cell.value !== null
                    ? `${fmt(cell.value)}${cell.isShared ? '*' : ''}`
                    : cell.isShared
                      ? t('results.coupledShared')
                      : '-'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {hasSharedReactions && (
        <div className="warning-text">{t('results.coupledReactionNote')}</div>
      )}
    </div>
  );
};

function fmt(v: number | undefined): string {
  if (v === undefined) return '-';
  if (Math.abs(v) < 1e-10) return '0.000';
  if (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3) return v.toExponential(3);
  return v.toFixed(4);
}
