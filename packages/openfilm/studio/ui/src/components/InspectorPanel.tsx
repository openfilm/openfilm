import React from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { PANE_BAR, PANE_TITLE, PANE_BTN, PANE_ICON } from './dock-pane-bar';
import { Tooltip } from './Tooltip';
import { isTypingTarget } from './typing-target';

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
    <aside aria-label={title} data-inspector-panel data-film-inspector className="relative flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden bg-[var(--bg-panel)] text-[var(--text)]" style={{ width }} onKeyDown={event => {
      /* typing is the field's, Space and Enter a button's, the arrows a slider's; every other key is the editor's (⌘Z
         undoes the change a button or slider just made) */
      const el = event.target as Element;
      if (isTypingTarget(el) || ((event.key === ' ' || event.key === 'Enter') && el.closest('button, input, [role="button"]'))
        || (event.key.startsWith('Arrow') && el.closest('input[type="range"]'))) event.stopPropagation();
    }}>
      {tabs ? (
        /* tabs as the other inspectors have them (the library's categories beside them): its 40 px bar and line, the
           one shown in the accent on a raised fill */
        <div className="flex h-10 shrink-0 items-stretch gap-1 border-b border-[var(--border)] px-2">
          <div role="tablist" aria-label={title} className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto [scrollbar-width:none]">
            {tabs.map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={x.id === tab} data-inspector-tab={x.id} onClick={() => onTab?.(x.id)}
                className={`relative my-1.5 flex-none whitespace-nowrap rounded-md px-2.5 text-[11.5px] outline-none transition-colors ${x.id === tab
                  ? 'bg-[var(--bg-picked)] font-semibold text-[var(--accent)]'
                  : 'font-medium text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                {x.label}
              </button>
            ))}
          </div>
          <Tooltip label={t('inspector.hide')} side="bottom">
            <button type="button" aria-label={t('inspector.hide')} onClick={onClose} className={`${PANE_BTN} self-center`}><X size={PANE_ICON} /></button>
          </Tooltip>
        </div>
      ) : (
        <div className={PANE_BAR}>
          <span className={`${PANE_TITLE} flex-1 px-1`}>{title}</span>
          <Tooltip label={t('inspector.hide')} side="bottom">
            <button type="button" aria-label={t('inspector.hide')} onClick={onClose} className={PANE_BTN}><X size={PANE_ICON} /></button>
          </Tooltip>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-5">{children}</div>
    </aside>
  );
}
