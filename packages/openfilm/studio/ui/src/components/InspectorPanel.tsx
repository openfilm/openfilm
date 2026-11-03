import React from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { PANE_BAR, PANE_TITLE, PANE_BTN, PANE_ICON } from './dock-pane-bar';
import { Tooltip } from './Tooltip';

/** A tab of the pane's bar: what it shows, picked there. */
export type InspectorTab = { id: string; label: string };

/**
 * The inspector's pane for anything that is not a film selection (a media file's properties). With `tabs` its bar
 * names its parts instead of its title, the one shown (`tab`) lit.
 */
export function InspectorPanel({ title, width, onClose, tabs, tab, onTab, children }: {
  title: string; width: number; onClose: () => void; children: React.ReactNode;
  tabs?: readonly InspectorTab[]; tab?: string; onTab?: (id: string) => void;
}) {
  const t = useT();
  return (
    <aside aria-label={title} data-inspector-panel data-film-inspector className="relative flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-[var(--dock-pane)] text-[var(--text)]" style={{ width }} onKeyDown={event => {
      if ((event.target as Element).closest('input, select, textarea, button')) event.stopPropagation();
    }}>
      <div className={PANE_BAR}>
        {tabs ? (
          <div role="tablist" aria-label={title} className="flex min-w-0 flex-1 items-center gap-3 px-1">
            {tabs.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={x.id === tab} data-inspector-tab={x.id} onClick={() => onTab?.(x.id)}
                className={`shrink-0 text-[12.5px] font-medium transition-colors ${x.id === tab ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                {x.label}
              </button>
            ))}
          </div>
        ) : <span className={`${PANE_TITLE} flex-1 px-1`}>{title}</span>}
        <Tooltip label={t('inspector.hide')} side="bottom">
          <button type="button" aria-label={t('inspector.hide')} onClick={onClose} className={PANE_BTN}><X size={PANE_ICON} /></button>
        </Tooltip>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-5">{children}</div>
    </aside>
  );
}
