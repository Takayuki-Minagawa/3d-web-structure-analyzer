import React, { useEffect } from 'react';
import { useT } from '../i18n';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const HelpDialog: React.FC<Props> = ({ open, onClose }) => {
  const t = useT();

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!open) return null;

  const sections = [
    {
      title: t('help.section.basic'),
      items: [
        t('help.basic.zoom'),
        t('help.basic.pan'),
        t('help.basic.select'),
        t('help.basic.drag'),
        t('help.basic.delete'),
        t('help.basic.escape'),
      ],
    },
    {
      title: t('help.section.tools'),
      items: [
        t('help.tools.addNode'),
        t('help.tools.addMember'),
        t('help.tools.setSupport'),
        t('help.tools.nodalLoad'),
        t('help.tools.memberLoad'),
        t('help.tools.editProps'),
      ],
    },
    {
      title: t('help.section.analysis'),
      items: [
        t('help.analysis.run'),
        t('help.analysis.display'),
        t('help.analysis.scale'),
        t('help.analysis.results'),
      ],
    },
    {
      title: t('help.section.file'),
      items: [
        t('help.file.save'),
        t('help.file.load'),
        t('help.file.sample'),
        t('help.file.autosave'),
      ],
    },
    {
      title: t('help.section.signs'),
      items: [
        t('help.signs.coord'),
        t('help.signs.axial'),
        t('help.signs.load'),
        t('help.signs.local'),
        t('help.signs.display'),
      ],
    },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('help.title')}</h2>
          <button onClick={onClose}>{t('help.close')}</button>
        </div>
        <div className="modal-body">
          {sections.map((sec) => (
            <div key={sec.title} className="help-section">
              <h3>{sec.title}</h3>
              <ul>
                {sec.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
