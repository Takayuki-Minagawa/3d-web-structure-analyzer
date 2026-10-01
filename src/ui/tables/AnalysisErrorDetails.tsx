import React from 'react';
import { useT } from '../../i18n';
import type { TKey } from '../../i18n';
import type {
  AnalysisError,
  DofName,
  ProjectModel,
  ReleasedMemberMode,
  StabilityDiagnostic,
} from '../../core/model/types';
import { memberLabel, nodeLabel } from '../../core/model/displayNumbers';
import { useSelectionStore } from '../../state/selectionStore';

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

export const AnalysisErrorDetails: React.FC<{ error: AnalysisError; model: ProjectModel }> = ({ error, model }) => {
  const t = useT();
  const selectNode = useSelectionStore((state) => state.selectNode);
  const selectMember = useSelectionStore((state) => state.selectMember);
  const focusSelection = useSelectionStore((state) => state.focusSelection);
  const diagnostics = error.diagnostics ?? [];
  const hasNodeTarget = Boolean(error.nodeId && model.nodes.some((node) => node.id === error.nodeId));
  const hasMemberTarget = Boolean(error.elementId && model.members.some((member) => member.id === error.elementId));
  const goToError = () => {
    if (hasNodeTarget && error.nodeId) selectNode(error.nodeId);
    else if (hasMemberTarget && error.elementId) selectMember(error.elementId);
    else return;
    focusSelection();
  };

  return (
    <div className="analysis-error">
      {hasNodeTarget || hasMemberTarget
        ? <button className="error-link error-text" onClick={goToError}>{formatAnalysisErrorMessage(error, t)}</button>
        : <div className="error-text">{formatAnalysisErrorMessage(error, t)}</div>}
      {diagnostics.length > 0 && (
        <div className="diagnostics-list">
          <div className="diagnostics-title">{t('results.diagnostics')}</div>
          {diagnostics.map((diagnostic, index) => (
            <DiagnosticItem key={`${diagnostic.kind}-${index}`} diagnostic={diagnostic} model={model} />
          ))}
        </div>
      )}
    </div>
  );
};

const DiagnosticItem: React.FC<{ diagnostic: StabilityDiagnostic; model: ProjectModel }> = ({ diagnostic, model }) => {
  const t = useT();
  const selectNode = useSelectionStore((state) => state.selectNode);
  const selectMember = useSelectionStore((state) => state.selectMember);
  const focusSelection = useSelectionStore((state) => state.focusSelection);
  const displayNodeId = diagnostic.nodeId ? nodeLabel(model.nodes.find((node) => node.id === diagnostic.nodeId)) : undefined;
  const displayMemberId = diagnostic.elementId ? memberLabel(model.members.find((member) => member.id === diagnostic.elementId)) : undefined;
  const formatted = formatDiagnostic({ ...diagnostic, ...(displayNodeId ? { nodeId: displayNodeId } : {}), ...(displayMemberId ? { elementId: displayMemberId } : {}) }, t);
  const meta = [
    displayNodeId ? `${t('results.node')} ${displayNodeId}` : null,
    displayMemberId ? `${t('results.member')} ${displayMemberId}` : null,
    diagnostic.dof ? `DOF ${diagnostic.dof}` : null,
  ].filter((item): item is string => item !== null);

  return (
    <button className="diagnostic-item diagnostic-button" onClick={() => { if (diagnostic.nodeId) selectNode(diagnostic.nodeId); else if (diagnostic.elementId) selectMember(diagnostic.elementId); else return; focusSelection(); }}>
      <div>{formatted.message}</div>
      {meta.length > 0 && <div className="diagnostic-meta">{meta.join(' / ')}</div>}
      <div className="diagnostic-suggestion">
        <span>{t('results.diagnosticSuggestion')}</span>
        {formatted.suggestion}
      </div>
    </button>
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
