import React from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { PANE_BAR, PANE_TITLE, PANE_BTN, PANE_ICON } from './dock-pane-bar';
import { Tooltip } from './Tooltip';

/** The inspector's pane for anything that is not a film selection (a media file's properties). */
export function InspectorPanel({ title, width, onClose, children }: {
  title: string; width: number; onClose: () => void; children: React.ReactNode;
}) {
  const t = useT();
  return (
    <aside aria-label={title} data-inspector-panel data-film-inspector className="relative flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-[7px] bg-[var(--dock-pane)] text-[var(--text)]" style={{ width }} onKeyDown={event => {
      if ((event.target as Element).closest('input, select, textarea, button')) event.stopPropagation();
    }}>
      <div className={PANE_BAR}>
        <span className={`${PANE_TITLE} flex-1 px-1`}>{title}</span>
        <Tooltip label={t('inspector.hide')} side="bottom">
          <button type="button" aria-label={t('inspector.hide')} onClick={onClose} className={PANE_BTN}><X size={PANE_ICON} /></button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-5">{children}</div>
    </aside>
  );
}
