import React, { useState } from 'react';
import { useProjectStore } from '../../state/projectStore';
import { useT } from '../../i18n';

type TabId = 'displacements' | 'reactions' | 'endForces';

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
        <div className="error-text">{error.message}</div>
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
        <div className="table-wrapper">
          <table>
            <thead>
              <tr><th>{t('results.node')}</th><th>Rx</th><th>Ry</th><th>Rz</th><th>Mx</th><th>My</th><th>Mz</th></tr>
            </thead>
            <tbody>
              {model.nodes
                .map((n, i) => ({ n, i }))
                .filter(({ n }) => {
                  const r = n.restraint;
                  return r.ux || r.uy || r.uz || r.rx || r.ry || r.rz;
                })
                .map(({ n, i }) => {
                  const r = n.restraint;
                  return (
                    <tr key={n.id}>
                      <td>{n.id.substring(0, 5)}</td>
                      <td>{r.ux ? fmt(result.reactions[i * 6]) : '-'}</td>
                      <td>{r.uy ? fmt(result.reactions[i * 6 + 1]) : '-'}</td>
                      <td>{r.uz ? fmt(result.reactions[i * 6 + 2]) : '-'}</td>
                      <td>{r.rx ? fmt(result.reactions[i * 6 + 3]) : '-'}</td>
                      <td>{r.ry ? fmt(result.reactions[i * 6 + 4]) : '-'}</td>
                      <td>{r.rz ? fmt(result.reactions[i * 6 + 5]) : '-'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
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

function fmt(v: number | undefined): string {
  if (v === undefined) return '-';
  if (Math.abs(v) < 1e-10) return '0.000';
  if (Math.abs(v) >= 1e4 || Math.abs(v) < 1e-3) return v.toExponential(3);
  return v.toFixed(4);
}
