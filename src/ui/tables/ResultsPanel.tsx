import React, { useMemo } from 'react';
import { useProjectStore } from '../../state/projectStore';
import type { AnalysisResultView } from '../../state/projectStore';
import { useT } from '../../i18n';
import type { TKey } from '../../i18n';
import type { AnalysisResult, ProjectModel } from '../../core/model/types';
import { buildEffectiveReactionRows } from './reactionRows';
import { memberLabel, nodeLabel } from '../../core/model/displayNumbers';
import { formatEngineering } from '../../core/formatEngineering';
import type { SerializedComponentEnvelope } from '../../worker/protocol';
import { useViewStore, type ResultsTab } from '../../state/viewStore';
import { AnalysisErrorDetails } from './AnalysisErrorDetails';
import { EigenResults } from './EigenResults';

type StaticTab = Exclude<ResultsTab, 'modal' | 'buckling'>;

const TABS: ReadonlyArray<{ id: ResultsTab; labelKey: TKey }> = [
  { id: 'displacements', labelKey: 'results.displacements' },
  { id: 'reactions', labelKey: 'results.reactions' },
  { id: 'endForces', labelKey: 'results.endForces' },
  { id: 'modal', labelKey: 'results.modal' },
  { id: 'buckling', labelKey: 'results.buckling' },
];

export const ResultsPanel: React.FC = () => {
  const activeTab = useViewStore((s) => s.resultsTab);
  const setActiveTab = useViewStore((s) => s.setResultsTab);
  const isAnalyzing = useProjectStore((s) => s.isAnalyzing);
  const t = useT();

  if (isAnalyzing) {
    return <div className="results-panel"><p>{t('results.analyzing')}</p></div>;
  }

  return (
    <div className="results-panel">
      <div className="tab-bar">
        {TABS.map((tab) => (
          <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>{t(tab.labelKey)}</button>
        ))}
      </div>
      {activeTab === 'modal' || activeTab === 'buckling'
        ? <EigenResults kind={activeTab} />
        : <StaticResults activeTab={activeTab} />}
    </div>
  );
};

const StaticResults: React.FC<{ activeTab: StaticTab }> = ({ activeTab }) => {
  const model = useProjectStore((s) => s.model);
  const result = useProjectStore((s) => s.analysisResult);
  const analysisResults = useProjectStore((s) => s.analysisResults);
  const analysisEnvelope = useProjectStore((s) => s.analysisEnvelope);
  const analysisFactorizationCount = useProjectStore((s) => s.analysisFactorizationCount);
  const analysisResultView = useProjectStore((s) => s.analysisResultView);
  const selectAnalysisResultView = useProjectStore((s) => s.selectAnalysisResultView);
  const error = useProjectStore((s) => s.analysisError);
  const isResultStale = useProjectStore((s) => s.isResultStale);
  const t = useT();
  const targetNames = useMemo(
    () => new Map(analysisResults.map((item) => [item.target.id, item.target.name])),
    [analysisResults],
  );
  const envelopeBound = analysisResultView?.kind === 'envelope'
    ? analysisResultView.bound
    : null;
  const resultViewValue = analysisResultView?.kind === 'target'
    ? `target:${analysisResultView.targetId}`
    : analysisResultView?.kind === 'envelope'
      ? `envelope:${analysisResultView.bound}`
      : '';

  const changeResultView = (value: string) => {
    const targetId = value.startsWith('target:') ? value.slice('target:'.length) : '';
    const envelopeBoundValue = value.startsWith('envelope:')
      ? value.slice('envelope:'.length)
      : '';
    const view: AnalysisResultView | null = targetId
      ? { kind: 'target', targetId }
      : envelopeBoundValue === 'min' || envelopeBoundValue === 'max'
        ? { kind: 'envelope', bound: envelopeBoundValue }
        : null;
    if (view) selectAnalysisResultView(view);
  };

  if (error) return <AnalysisErrorDetails error={error} model={model} />;
  if (!result) return <p className="muted">{t('results.noResults')}</p>;
  if (isResultStale) {
    return <><p className="warning-text">{t('results.stale')}</p><p className="muted">{t('results.staleHidden')}</p></>;
  }

  return (
    <>
      {analysisResults.length > 0 && (
        <div className="result-view-controls">
          <label>
            {t('results.resultView')}
            <select value={resultViewValue} onChange={(event) => changeResultView(event.target.value)}>
              <optgroup label={t('results.casesCombinations')}>
                {analysisResults.map((item) => <option key={`${item.target.type}:${item.target.id}`} value={`target:${item.target.id}`}>{item.target.type === 'loadCase' ? t('results.casePrefix') : t('results.combinationPrefix')}: {item.target.name}</option>)}
              </optgroup>
              {analysisEnvelope && <optgroup label={t('results.envelope')}><option value="envelope:min">{t('results.minimum')}</option><option value="envelope:max">{t('results.maximum')}</option></optgroup>}
            </select>
          </label>
          {analysisFactorizationCount !== null && <span className="result-factorization">{t('results.factorizationCount').replace('{count}', String(analysisFactorizationCount))}</span>}
        </div>
      )}

      {activeTab === 'displacements' && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>{t('results.node')}</th><th>ux</th><th>uy</th><th>uz</th><th>rx</th><th>ry</th><th>rz</th></tr>
            </thead>
            <tbody>
              {model.nodes.map((n, i) => (
                <tr key={n.id}>
                  <td>{nodeLabel(n)}</td>
                  {Array.from({ length: 6 }, (_, component) => envelopeBound && analysisEnvelope
                    ? <EnvelopeValueCell key={component} envelope={analysisEnvelope.displacements} index={i * 6 + component} bound={envelopeBound} targetNames={targetNames} governingTemplate={t('results.governing')} />
                    : <td key={component}>{fmt(result.displacements[i * 6 + component])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activeTab === 'reactions' && (
        envelopeBound && analysisEnvelope
          ? <EnvelopeNodeTable model={model} envelope={analysisEnvelope.reactions} bound={envelopeBound} targetNames={targetNames} labels={['Rx', 'Ry', 'Rz', 'Mx', 'My', 'Mz']} governingTemplate={t('results.governing')} />
          : <ReactionTable model={model} result={result} />
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
                const envelope = analysisEnvelope?.elementEndForces[m.id];
                if (envelopeBound ? !envelope : !ef) return null;
                return (
                  <tr key={m.id}>
                    <td>{memberLabel(m)}</td>
                    {Array.from({ length: 12 }, (_, k) => (
                      envelopeBound && envelope
                        ? <EnvelopeValueCell key={k} envelope={envelope} index={k} bound={envelopeBound} targetNames={targetNames} governingTemplate={t('results.governing')} />
                        : <td key={k}>{fmt(ef?.[k])}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!envelopeBound && result.warnings.length > 0 && (
        <div className="warnings">
          {result.warnings.map((w, i) => (
            <div key={i} className="warning-text">{w}</div>
          ))}
        </div>
      )}
    </>
  );
};

function useEffectiveReactions(model: ProjectModel, reactions: number[]) {
  return useMemo(
    () => buildEffectiveReactionRows(model, reactions),
    [model, reactions]
  );
}

const EnvelopeValueCell: React.FC<{
  envelope: SerializedComponentEnvelope<number[]>;
  index: number;
  bound: 'min' | 'max';
  targetNames: ReadonlyMap<string, string>;
  governingTemplate: string;
}> = ({ envelope, index, bound, targetNames, governingTemplate }) => {
  const values = bound === 'min' ? envelope.min : envelope.max;
  const targetIds = bound === 'min' ? envelope.minTargetIds : envelope.maxTargetIds;
  const targetId = targetIds[index];
  const targetName = targetId ? targetNames.get(targetId) ?? targetId : '';
  return <td title={targetName ? governingTemplate.replace('{target}', targetName) : undefined}>
    <span>{fmt(values[index])}</span>
    {targetName && <small className="envelope-target">{targetName}</small>}
  </td>;
};

const EnvelopeNodeTable: React.FC<{
  model: ProjectModel;
  envelope: SerializedComponentEnvelope<number[]>;
  bound: 'min' | 'max';
  targetNames: ReadonlyMap<string, string>;
  labels: readonly string[];
  governingTemplate: string;
}> = ({ model, envelope, bound, targetNames, labels, governingTemplate }) => {
  const t = useT();
  return <div className="table-wrapper">
    <table>
      <thead><tr><th>{t('results.node')}</th>{labels.map((label) => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{model.nodes.map((node, nodeIndex) => <tr key={node.id}>
        <td>{nodeLabel(node)}</td>
        {labels.map((label, component) => <EnvelopeValueCell key={label} envelope={envelope} index={nodeIndex * 6 + component} bound={bound} targetNames={targetNames} governingTemplate={governingTemplate} />)}
      </tr>)}</tbody>
    </table>
  </div>;
};

const ReactionTable: React.FC<{
  model: ProjectModel;
  result: AnalysisResult;
}> = ({ model, result }) => {
  const t = useT();
  const { rows, hasSharedReactions, hasInvalidCouplings } = useEffectiveReactions(model, result.reactions);
  const nodeById = new Map(model.nodes.map((node) => [node.id, node]));

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr><th>{t('results.node')}</th><th>Rx</th><th>Ry</th><th>Rz</th><th>Mx</th><th>My</th><th>Mz</th></tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.nodeId}>
              <td>{nodeLabel(nodeById.get(row.nodeId))}</td>
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
      {hasInvalidCouplings && (
        <div className="warning-text">{t('results.invalidCouplingReactionFallback')}</div>
      )}
      {hasSharedReactions && (
        <div className="warning-text">{t('results.coupledReactionNote')}</div>
      )}
    </div>
  );
};

function fmt(v: number | undefined): string {
  if (v === undefined) return '-';
  return formatEngineering(v, { significantDigits: 5, zeroTolerance: 1e-10 });
}
