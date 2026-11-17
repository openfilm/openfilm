/**
 * What a workbench is for and how it is used, said where its name is (the top right): its mark, name and one line
 * (`summary`), then its `details`, a line each (when to use it, how, …), from its plugin (openfilm.json), and the keys
 * that go from one workbench to another. It comes by
 * itself the first time a workbench is shown (kept in this browser), and again from the workbench menu's "?".
 * It lies over the page without holding it: the workbench under it is used as ever, and Esc or "Got it" puts it away.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { useKeyHint } from '@/lib/keymap-store';
import type { Plugin } from '@/lib/plugins';
import { workbenchKey } from './ModeSwitcher';
import { inLanguage } from './SkillPage';
import { PluginDetails, usePluginWords } from './library/PluginsPane';
import { WorkbenchMark } from './WorkbenchMark';

const SEEN_KEY = 'openfilm.guide.seen';
const KEY = 'rounded-[4px] bg-[var(--bg-hover)] px-1.5 py-px font-sans text-[11px] tabular-nums text-[var(--text)]';

const seenOnes = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};
const markSeen = (workbench: string) => {
  try { const was = seenOnes(); if (!was.includes(workbench)) localStorage.setItem(SEEN_KEY, JSON.stringify([...was, workbench])); } catch { /* for this launch only */ }
};

/**
 * The guide of the workbench shown: which one is open (null: none), opened by itself for one not seen before (not
 * while a browser is driven by a program, whose clicks it would be in the way of), and by `open`.
 */
export function useWorkbenchGuide(shown: string | null, plugins: readonly Plugin[]) {
  const [open, setOpen] = React.useState<string | null>(null);
  const known = plugins.some((p) => p.workbench === shown && p.details);
  React.useEffect(() => {
    if (!shown || !known || navigator.webdriver) return;
    if (!seenOnes().includes(shown)) { markSeen(shown); setOpen(shown); }
    else setOpen((was) => (was && was !== shown ? null : was));
  }, [shown, known]);
  const plugin = open ? plugins.find((p) => p.workbench === open) ?? null : null;
  return { plugin, open: (workbench: string) => { markSeen(workbench); setOpen(workbench); }, close: () => setOpen(null) };
}

export function WorkbenchGuide({ plugin, benches, onClose }: {
  plugin: Plugin | null;
  /** how many workbenches there are to go between (their keys are said under the rest; one alone: none) */
  benches: number;
  onClose: () => void;
}) {
  const t = useT();
  const keyHint = useKeyHint();
  const back = keyHint('work-mode');
  const lang = useLanguage();
  const words = usePluginWords();
  React.useEffect(() => {
    if (!plugin) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [plugin, onClose]);
  if (!plugin || typeof document === 'undefined') return null;
  const { title, summary } = words(plugin);
  const details = inLanguage(plugin.details, lang);
  return createPortal(
    <section role="dialog" aria-modal="false" aria-label={title} data-workbench-guide={plugin.workbench}
      className="fixed right-3 top-[42px] z-[9000] w-[380px] max-w-[calc(100vw-24px)] rounded-[12px] border border-[var(--border-strong)] bg-[var(--bg-raised)] p-4 text-[var(--text)] shadow-[var(--shadow-lg)]"
      style={{ animation: 'openfilm-rise 0.18s ease-out both' }}>
      <div className="flex items-start gap-3">
        <WorkbenchMark plugin={plugin} size={36} />
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold leading-[20px]">{title}</h2>
          {summary ? <p className="mt-0.5 text-[12.5px] leading-[18px] text-[var(--text-muted)]">{summary}</p> : null}
        </div>
        <button type="button" aria-label={t('guide.close')} onClick={onClose}
          className="-mr-1 -mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <X size={14} />
        </button>
      </div>
      {details ? <PluginDetails text={details} small className="mt-2.5 border-t border-[var(--border)] pt-1.5" /> : null}
      {benches > 1 ? (
        <dl className="mt-2.5 flex flex-col gap-1 border-t border-[var(--border)] pt-2.5 text-[12px] text-[var(--text-muted)]">
          <div className="flex items-center justify-between gap-3">
            <dt>{t('guide.keysSwitch')}</dt>
            <dd><kbd className={KEY}>{workbenchKey(1)}</kbd>{benches > 1 ? <> – <kbd className={KEY}>{workbenchKey(Math.min(9, benches))}</kbd></> : null}</dd>
          </div>
          {back ? (
            <div className="flex items-center justify-between gap-3">
              <dt>{t('settings.shortcuts.actions.work-mode')}</dt>
              <dd><kbd className={KEY}>{back}</kbd></dd>
            </div>
          ) : null}
        </dl>
      ) : null}
    </section>,
    document.body,
  );
}
