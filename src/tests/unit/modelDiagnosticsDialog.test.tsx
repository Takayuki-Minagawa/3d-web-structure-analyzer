import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePortalFrameTemplate } from '../../core/model/generators';
import { useI18nStore } from '../../i18n';
import { translations, type TKey } from '../../i18n/translations';
import { ModelDiagnosticsDialog } from '../../ui/dialogs/ModelDiagnosticsDialog';

vi.mock('../../i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../i18n')>();
  return {
    ...actual,
    // Server rendering otherwise uses Zustand's initial (Japanese) locale.
    useT: () => (key: TKey) => translations[actual.useI18nStore.getState().lang][key],
  };
});
const originalLanguage = useI18nStore.getState().lang;
afterEach(() => {
  useI18nStore.setState({ lang: originalLanguage });
});

describe('model diagnostics dialog', () => {
  it('shows a clear input check without promising stability', () => {
    useI18nStore.setState({ lang: 'en' });
    const markup = renderToStaticMarkup(<ModelDiagnosticsDialog
      model={generatePortalFrameTemplate()} onClose={() => undefined} onSelect={() => undefined} />);
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('No input or connectivity issues were found.');
    expect(markup).toContain('does not guarantee structural stability');
    expect(markup).not.toContain('Select and show entities');
  });

  it('shows Japanese warning text and stable display numbers for reversed duplicate members', () => {
    useI18nStore.setState({ lang: 'ja' });
    const model = generatePortalFrameTemplate();
    const member = model.members[0]!;
    model.members.push({ ...member, id: 'duplicate', number: 99, ni: member.nj, nj: member.ni });
    const markup = renderToStaticMarkup(<ModelDiagnosticsDialog
      model={model} onClose={() => undefined} onSelect={() => undefined} />);
    expect(markup).toContain('同じ節点対を結ぶ部材が複数あります');
    expect(markup).toContain('M99');
    expect(markup).toContain('該当箇所を選択・表示');
    expect(markup).toContain('diagnostic-warning');
  });

  it('does not offer selection for an error referencing only a deleted member', () => {
    const model = generatePortalFrameTemplate();
    model.memberLoads.push({ id: 'missing', memberId: 'deleted', type: 'udl', direction: 'localY', value: 1 });
    const markup = renderToStaticMarkup(<ModelDiagnosticsDialog
      model={model} onClose={() => undefined} onSelect={() => undefined} />);
    expect(markup).toContain('diagnostic-error');
    // Only the Close button remains; nonexistent entity IDs cannot be selected.
    expect(markup.match(/<button/g)).toHaveLength(1);
  });
});
