/**
 * The project in front, named at the top bar's middle, and the way to another, as an editor's: one project shows at a
 * time, the others the app has open stay as they were behind it (their agents at work), and a click on the name lists
 * them, then the recent ones, then All projects (`onAll`). An open project has a light while it has something to say:
 * breathing while its agent works, amber while it waits for an answer, its percent while it exports; the name has a dot
 * while another one waits. A double click on the name renames it (`onRename`).
 *
 * The app's tabs (lib/host.ts `tabs`) are what is open; they are no longer drawn as tabs.
 */
import React from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { api, type Project } from '@/api';
import { useT } from '@/i18n';
import { studioHost, type HostTab } from '@/lib/host';
import { Popover } from './Popover';

/** how many recent projects the list shows (the rest are in All projects) */
const RECENT = 8;

/** The app's open projects, live, and which is this page's. */
export function useHostTabs() {
  const [tabs, setTabs] = React.useState<HostTab[]>([]);
  const [self, setSelf] = React.useState<string | null>(null);
  React.useEffect(() => {
    const host = studioHost?.tabs;
    if (!host) return undefined;
    let alive = true;
    void host.list().then((r) => { if (alive) { setTabs(r.tabs); setSelf(r.self); } });
    const stop = host.onChange((next) => setTabs(next));
    return () => { alive = false; stop(); };
  }, []);
  return { tabs, self };
}

/** An open project's light: what it is doing, or nothing. */
function Light({ tab }: { tab: HostTab }) {
  const t = useT();
  if (tab.asking) return <span title={t('switcher.asking')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#e8a23a] shadow-[0_0_0_2px_rgba(232,162,58,0.18)]" />;
  if (tab.exporting != null) return <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-faint)]">{t('switcher.exporting').replace('{n}', String(Math.round(tab.exporting * 100)))}</span>;
  if (tab.working) return <span title={t('switcher.working')} className="status-breathe h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" />;
  return null;
}

const ROW = 'group flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] transition';

export function ProjectSwitcher({ name, onAll, onRename }: {
  /** the project in front (none: the launcher) */
  name?: string;
  onAll: () => void;
  onRename?: () => void;
}) {
  const t = useT();
  const host = studioHost?.tabs;
  const { tabs, self } = useHostTabs();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    void api.projects().then(setProjects, () => setProjects([]));
  }, [open]);
  if (!host) return null;

  const names = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const titleOf = (tab: HostTab) => tab.title || names.get(tab.projectId) || t('project.untitled');
  const needle = query.trim().toLowerCase();
  const hit = (words: string) => !needle || words.toLowerCase().includes(needle);
  const openTabs = tabs.filter((tab) => hit(titleOf(tab)));
  const openIds = new Set(tabs.map((tab) => tab.projectId));
  const recent = (projects ?? [])
    .filter((p) => !openIds.has(p.id) && !p.missing && hit(p.name))
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, RECENT);
  /* another open project waits for the person, or works: said on the name, so it is seen without opening the list */
  const others = tabs.filter((tab) => tab.id !== self);
  const waiting = others.some((tab) => tab.asking);
  const working = others.some((tab) => tab.working);
  const pick = (go: () => void) => { setOpen(false); go(); };
  const heading = (words: string) => <div className="px-2 pb-1 pt-2.5 text-[11.5px] text-[var(--text-faint)]">{words}</div>;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger={(
        <button
          type="button"
          aria-label={t('switcher.label')}
          aria-haspopup="dialog"
          aria-expanded={open}
          onDoubleClick={() => { if (onRename) { setOpen(false); onRename(); } }}
          className={`flex h-[26px] min-w-0 max-w-[28ch] items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${open ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}
        >
          <span className="min-w-0 truncate">{name || t('switcher.label')}</span>
          {waiting ? <span aria-label={t('switcher.asking')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#e8a23a]" />
            : working ? <span aria-label={t('switcher.working')} className="status-breathe h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" /> : null}
          <ChevronDown size={13} className="shrink-0 text-[var(--text-faint)]" />
        </button>
      )}
    >
      <div className="flex w-[320px] flex-col rounded-[10px] border border-[var(--border)] bg-[var(--panel)] p-1 shadow-[var(--shadow-lg)]">
        <label className="flex h-8 items-center gap-2 px-2 text-[13px]">
          <Search size={13} className="shrink-0 text-[var(--text-faint)]" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('switcher.search')}
            className="min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
        </label>
        <div className="max-h-[420px] overflow-y-auto">
          {openTabs.length ? heading(t('switcher.open')) : null}
          {openTabs.map((tab) => (
            <div key={tab.id} className={`${ROW} ${tab.id === self ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
              <button type="button" onClick={() => pick(() => { if (tab.id !== self) host.show(tab.id); })}
                className="flex h-full min-w-0 flex-1 items-center gap-2 text-left">
                <span className="min-w-0 flex-1 truncate">{titleOf(tab)}</span>
                <Light tab={tab} />
              </button>
              <button type="button" aria-label={t('switcher.close')} title={t('switcher.close')} onClick={() => host.close(tab.id)}
                className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-active)] hover:text-[var(--text)] group-hover:flex">
                <X size={13} />
              </button>
            </div>
          ))}
          {recent.length ? heading(t('switcher.recent')) : null}
          {recent.map((p) => (
            <button key={p.id} type="button" onClick={() => pick(() => host.open(p.id))}
              className={`${ROW} text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]`}>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
            </button>
          ))}
          {projects && needle && !openTabs.length && !recent.length ? (
            <div className="flex h-8 items-center px-2 text-[12.5px] text-[var(--text-faint)]">{t('switcher.none')}</div>
          ) : null}
        </div>
        <div className="mt-1 border-t border-[var(--border)] pt-1">
          <button type="button" onClick={() => pick(onAll)} className={`${ROW} text-[var(--text)] hover:bg-[var(--bg-hover)]`}>
            {t('switcher.all')}
          </button>
        </div>
      </div>
    </Popover>
  );
}
