/**
 * What a workbench is for and how it is used, said where its name is (the top right): its mark, name and one line
 * (`summary`), then its `details`, a line each (when to use it, how, …), from its plugin (openfilm.json), and the keys
 * that go from one workbench to another. It comes by
 * itself the first time a workbench is shown (kept in this browser), and again from the workbench menu's "?".
 * It is a dialog in the middle of the window, with what the editor draws of its own help (studio `help`) under its
 * plugin's words; Esc, its × or a click beside it puts it away.
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
import { editorHelps, type EditorHelp } from '@/studio/hub';

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
  const helps = React.useSyncExternalStore(editorHelps.subscribe, editorHelps.get);
  React.useEffect(() => {
    if (!plugin) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) onClose(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [plugin, onClose]);
  if (!plugin || typeof document === 'undefined') return null;
  const { title, summary } = words(plugin);
  const details = inLanguage(plugin.details, lang);
  const own = helps.get(plugin.workbench ?? '');
  return createPortal(
    <div className="fixed inset-0 z-[9000] grid place-items-center bg-black/45 p-6" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-label={title} data-workbench-guide={plugin.workbench}
        className={`flex max-h-full w-full flex-col overflow-hidden rounded-[16px] border border-[var(--border-strong)] bg-[var(--bg-raised)] text-[var(--text)] shadow-[0_24px_64px_rgb(0_0_0/.45)] ${own ? 'max-w-[820px]' : 'max-w-[560px]'}`}
        style={{ animation: 'openfilm-rise 0.18s ease-out both' }}>
        <div className="flex items-start gap-3.5 border-b border-[var(--border)] px-6 py-5">
          <WorkbenchMark plugin={plugin} size={44} />
          <div className="min-w-0 flex-1">
            <h2 className="text-[17px] font-semibold leading-[24px]">{title}</h2>
            {summary ? <p className="mt-0.5 text-[13px] leading-[19px] text-[var(--text-muted)]">{summary}</p> : null}
          </div>
          <button type="button" aria-label={t('guide.close')} onClick={onClose}
            className="-mr-2 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 overflow-auto px-6 pb-5 pt-2">
          {details ? <PluginDetails text={details} /> : null}
          {/* the editor's own: how it is used step by step, its keys */}
          {own ? <OwnHelp key={plugin.workbench} draw={own} /> : null}
          <dl className="mt-4 flex flex-col gap-1.5 border-t border-[var(--border)] pt-3.5 text-[12.5px] text-[var(--text-muted)]">
            {benches > 1 ? (
              <div className="flex items-center justify-between gap-3">
                <dt>{t('guide.keysSwitch')}</dt>
                <dd><kbd className={KEY}>{workbenchKey(1)}</kbd> – <kbd className={KEY}>{workbenchKey(Math.min(9, benches))}</kbd></dd>
              </div>
            ) : null}
            {benches > 1 && back ? (
              <div className="flex items-center justify-between gap-3">
                <dt>{t('settings.shortcuts.actions.work-mode')}</dt>
                <dd><kbd className={KEY}>{back}</kbd></dd>
              </div>
            ) : null}
            <div className="flex items-center justify-between gap-3">
              <dt>{t('guide.keysHelp')}</dt>
              <dd><kbd className={KEY}>?</kbd></dd>
            </div>
          </dl>
        </div>
      </section>
    </div>,
    document.body,
  );
}

/** What the editor draws into its help itself (studio `help.set`). */
function OwnHelp({ draw }: { draw: EditorHelp }) {
  const into = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => (into.current ? draw(into.current) : undefined), [draw]);
  return <div ref={into} className="mt-4 border-t border-[var(--border)] pt-4" />;
}
