import { useEffect, useMemo, useRef } from 'react';
import { diagnoseModel, type ModelDiagnostic } from '../../core/model/modelDiagnostics';
import { memberLabel, nodeLabel } from '../../core/model/displayNumbers';
import type { ProjectModel } from '../../core/model/types';
import { useT, type TKey } from '../../i18n';

const messageKeys: Record<Exclude<ModelDiagnostic['code'], 'validation'>, TKey> = {
  'coincident-nodes': 'diagnostics.coincidentNodes',
  'duplicate-members': 'diagnostics.duplicateMembers',
  'isolated-nodes': 'diagnostics.isolatedNodes',
  'disconnected-components': 'diagnostics.disconnectedComponents',
};

interface Props {
  model: ProjectModel;
  onClose: () => void;
  onSelect: (diagnostic: ModelDiagnostic) => void;
}

/** Mounted only while open so diagnostics never run on every canvas edit. */
export function ModelDiagnosticsDialog({ model, onClose, onSelect }: Props) {
  const t = useT();
  const dialogRef = useRef<HTMLElement>(null);
  const diagnostics = useMemo(() => diagnoseModel(model), [model]);
  const nodeById = useMemo(() => new Map(model.nodes.map((node) => [node.id, node])), [model]);
  const memberById = useMemo(() => new Map(model.members.map((member) => [member.id, member])), [model]);
  const errors = diagnostics.filter((item) => item.severity === 'error').length;

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
      if (event.key !== 'Tab' || !dialog) return;
      const buttons = Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const first = buttons[0];
      const last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" role="presentation" onClick={onClose}>
      <section ref={dialogRef} className="modal-content model-diagnostics" role="dialog" aria-modal="true"
        aria-label={t('diagnostics.title')} aria-describedby="diagnostics-note" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <h2>{t('diagnostics.title')}</h2>
          <button type="button" onClick={onClose}>{t('common.close')}</button>
        </header>
        <div className="modal-body">
          <p id="diagnostics-note" className="diagnostics-note">{t('diagnostics.note')}</p>
          <p className="diagnostics-summary" role="status">
            {t('diagnostics.errors')}: {errors} · {t('diagnostics.warnings')}: {diagnostics.length - errors}
          </p>
          {diagnostics.length === 0 ? <p className="success-text">{t('diagnostics.noIssues')}</p> : (
            <ul className="diagnostics-list">
              {diagnostics.map((item, index) => {
                const nodes = item.nodeIds.filter((id) => nodeById.has(id));
                const members = item.memberIds.filter((id) => memberById.has(id));
                const labels = [
                  ...nodes.map((id) => nodeLabel(nodeById.get(id))),
                  ...members.map((id) => memberLabel(memberById.get(id))),
                ];
                return <li key={`${item.code}-${index}`} className={`diagnostic-item diagnostic-${item.severity}`}>
                  <strong>{t(item.severity === 'error' ? 'diagnostics.error' : 'diagnostics.warning')}</strong>
                  <p>{item.code === 'validation' ? item.message : t(messageKeys[item.code])}</p>
                  {labels.length > 0 && <p className="diagnostic-entities">{labels.slice(0, 24).join(', ')}{labels.length > 24 ? ` … (+${labels.length - 24})` : ''}</p>}
                  {(nodes.length > 0 || members.length > 0) && <button type="button" onClick={() => onSelect({ ...item, nodeIds: nodes, memberIds: members })}>
                    {t('diagnostics.locate')}
                  </button>}
                </li>;
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
