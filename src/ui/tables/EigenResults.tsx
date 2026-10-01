import React from 'react';
import { formatEngineering } from '../../core/formatEngineering';
import { useT } from '../../i18n';
import type { EigenAnalysisKind } from '../../state/analysisResults';
import { useProjectStore } from '../../state/projectStore';
import { useViewStore } from '../../state/viewStore';
import { AnalysisErrorDetails } from './AnalysisErrorDetails';

const DIRECTIONS = ['X', 'Y', 'Z'] as const;

function fmt(value: number): string {
  return formatEngineering(value, { significantDigits: 5, zeroTolerance: 1e-12 });
}

function percent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}`;
}

/** Mode table of a modal or buckling analysis; clicking a row shows its shape. */
export const EigenResults: React.FC<{ kind: EigenAnalysisKind }> = ({ kind }) => {
  const t = useT();
  const model = useProjectStore((s) => s.model);
  const modalResult = useProjectStore((s) => s.modalResult);
  const bucklingResult = useProjectStore((s) => s.bucklingResult);
  const eigenError = useProjectStore((s) => s.eigenErrors[kind]);
  const shapeView = useViewStore((s) => s.shapeView);
  const displayMode = useViewStore((s) => s.displayMode);
  const showModeShape = useViewStore((s) => s.showModeShape);

  const result = kind === 'modal' ? modalResult : bucklingResult;
  if (eigenError?.sourceModel === model) return <AnalysisErrorDetails error={eigenError.error} model={model} />;
  if (!result) {
    return <p className="muted">{t(kind === 'modal' ? 'results.modalHint' : 'results.bucklingHint')}</p>;
  }
  if (result.sourceModel !== model) {
    return <><p className="warning-text">{t('results.stale')}</p><p className="muted">{t('results.eigenStaleHidden')}</p></>;
  }

  const isShown = (index: number) =>
    displayMode === 'modeShape' && shapeView?.kind === kind && shapeView.index === index;
  const rowProps = (index: number) => ({
    className: isShown(index) ? 'eigen-row active' : 'eigen-row',
    onClick: () => showModeShape({ kind, index }),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      showModeShape({ kind, index });
    },
    tabIndex: 0,
    'aria-selected': isShown(index),
    title: t('results.showModeShape'),
  });
  const summary = t('results.eigenSummary')
    .replace('{divisions}', String(result.divisions))
    .replace('{dofs}', String(result.freeDofCount));

  return (
    <>
      <div className="result-view-controls">
        {bucklingResult && kind === 'buckling' && (
          <span>{t('results.bucklingTarget').replace('{target}', bucklingResult.target.name)}</span>
        )}
        <span className="result-factorization">{summary}</span>
      </div>
      <div className="table-wrapper">
        {kind === 'modal' && modalResult ? (
          <table>
            <thead>
              <tr>
                <th>{t('results.mode')}</th><th>f [Hz]</th><th>T [s]</th><th>ω [rad/s]</th>
                {DIRECTIONS.map((direction) => <th key={`b${direction}`}>β{direction}</th>)}
                {DIRECTIONS.map((direction) => <th key={`m${direction}`}>{t('results.effectiveMass')} {direction} [%]</th>)}
              </tr>
            </thead>
            <tbody>
              {modalResult.modes.map((mode, index) => (
                <tr key={mode.index} {...rowProps(index)}>
                  <td>{mode.index}</td>
                  <td>{fmt(mode.frequency)}</td>
                  <td>{fmt(mode.period)}</td>
                  <td>{fmt(mode.omega)}</td>
                  {mode.participation.map((value, direction) => <td key={`b${direction}`}>{fmt(value)}</td>)}
                  {mode.effectiveMassRatio.map((value, direction) => <td key={`m${direction}`}>{percent(value)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table>
            <thead>
              <tr><th>{t('results.mode')}</th><th>{t('results.loadFactor')}</th></tr>
            </thead>
            <tbody>
              {(bucklingResult?.modes ?? []).map((mode, index) => (
                <tr key={mode.index} {...rowProps(index)}>
                  <td>{mode.index}</td>
                  <td>{fmt(mode.loadFactor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="muted">{t(kind === 'modal' ? 'results.modalNote' : 'results.bucklingNote')}</div>
      {result.warnings.length > 0 && (
        <div className="warnings">
          {result.warnings.map((warning, index) => <div key={index} className="warning-text">{warning}</div>)}
        </div>
      )}
    </>
  );
};
