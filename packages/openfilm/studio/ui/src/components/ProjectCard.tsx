/**
 * The project in front, named in the middle of the top bar, and its card, which opens while the pointer rests on the
 * name (lib/hover-open: a click keeps it): the film's picture, its name and folder, what it is (its length, frame,
 * rate, clips), what can be done to it (rename, cover from this frame, show its folder), then the other projects. In an
 * app that keeps several open (lib/host.ts `tabs`) they come first, each with its light while it has something to
 * say: breathing while its agent works, amber while it waits for an answer, its percent while it exports; the name has
 * a dot while another one waits or works. Then the recent ones, and All projects (`onAll`).
 *
 * A double click on the name renames the project (`actions.onRename`).
 */
import React from 'react';
import { ChevronDown, FolderOpen, Image as ImageIcon, Pencil, X } from 'lucide-react';
import { api, type Project } from '@/api';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/export-jobs';
import { useHoverOpen } from '@/lib/hover-open';
import { studioHost, type HostTab } from '@/lib/host';
import { Popover } from './Popover';
import { posterUrl } from './ProjectCover';
import { Tooltip } from './Tooltip';

/** how many recent projects the card shows (the rest are in All projects) */
const RECENT = 6;

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

/** What the card says about the project in front. */
export interface ProjectFacts {
  project: Project;
  durationMs: number;
  stage: { w: number; h: number };
  fps: number;
  clips: number;
}

export interface ProjectActions {
  onRename?: () => void;
  onCoverFromFrame?: () => void;
  onReveal?: () => void;
}

const ROW = 'group flex h-8 w-full min-w-0 items-center gap-2 rounded-lg px-2 text-left text-[13px] transition';
const ACTION = 'flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';

export function ProjectCard({ name, facts, actions = {}, onOpen, onAll }: {
  /** the project in front (none: the window with no project) */
  name?: string;
  facts?: ProjectFacts;
  actions?: ProjectActions;
  /** a recent project opened (in its tab, where there are tabs) */
  onOpen: (projectId: string) => void;
  onAll: () => void;
}) {
  const t = useT();
  const host = studioHost?.tabs;
  const { tabs, self } = useHostTabs();
  const hover = useHoverOpen();
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  React.useEffect(() => {
    if (!hover.open) return;
    void api.projects().then(setProjects, () => setProjects([]));
  }, [hover.open]);

  const names = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const titleOf = (tab: HostTab) => tab.title || names.get(tab.projectId) || t('project.untitled');
  const others = tabs.filter((tab) => tab.id !== self);
  const openIds = new Set(tabs.map((tab) => tab.projectId));
  const recent = (projects ?? [])
    .filter((p) => !openIds.has(p.id) && p.id !== facts?.project.id && !p.missing)
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, RECENT);
  /* another open project waits for the person, or works: said on the name, so it is seen without opening the card */
  const waiting = others.some((tab) => tab.asking);
  const working = others.some((tab) => tab.working);
  const go = (run: () => void) => { hover.setOpen(false); run(); };
  const heading = (words: string) => <div className="px-2 pb-1 pt-2 text-[11.5px] text-[var(--text-faint)]">{words}</div>;
  const facet = (words: string) => <span className="rounded-md bg-[var(--bg-hover)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">{words}</span>;

  return (
    <Popover
      open={hover.open}
      onOpenChange={hover.setOpen}
      align="center"
      trigger={(
        <button
          type="button"
          aria-label={t('switcher.label')}
          aria-haspopup="dialog"
          aria-expanded={hover.open}
          {...hover.trigger}
          onDoubleClick={() => { if (actions.onRename) { hover.setOpen(false); actions.onRename(); } }}
          className={`flex h-[26px] min-w-0 max-w-[28ch] items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${hover.open ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}
        >
          <span className="min-w-0 truncate">{name || t('switcher.label')}</span>
          {waiting ? <span aria-label={t('switcher.asking')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#e8a23a]" />
            : working ? <span aria-label={t('switcher.working')} className="status-breathe h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" /> : null}
          <ChevronDown size={13} className="shrink-0 text-[var(--text-faint)]" />
        </button>
      )}
    >
      <div {...hover.card} className="flex w-[340px] flex-col overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-lg)]">
        {facts ? (
          <div className="flex flex-col gap-2.5 p-3">
            <img src={posterUrl(facts.project)} alt="" draggable={false}
              className="aspect-video w-full rounded-lg bg-black object-cover" />
            <div className="min-w-0">
              <div className="truncate text-[14px] font-semibold text-[var(--text)]" title={facts.project.name}>{facts.project.name || t('project.untitled')}</div>
              {/* cut at its start: its last folders, the project's own, are what tell it apart */}
              <div dir="rtl" className="truncate text-left text-[11.5px] text-[var(--text-faint)]" title={facts.project.path}><bdi dir="ltr">{facts.project.path}</bdi></div>
            </div>
            <div className="flex flex-wrap gap-1">
              {facet(formatDuration(facts.durationMs))}
              {facet(`${facts.stage.w} × ${facts.stage.h}`)}
              {facet(`${Math.round(facts.fps * 100) / 100} fps`)}
              {facet(facts.clips === 1 ? t('selectionBar.oneClip') : t('selectionBar.clips').replace('{n}', String(facts.clips)))}
            </div>
            <div className="-mx-1 flex flex-wrap gap-0.5">
              {actions.onRename ? <button type="button" className={ACTION} onClick={() => go(actions.onRename!)}><Pencil size={13} />{t('projectMenu.rename')}</button> : null}
              {actions.onCoverFromFrame ? <button type="button" className={ACTION} onClick={() => go(actions.onCoverFromFrame!)}><ImageIcon size={13} />{t('switcher.cover')}</button> : null}
              {actions.onReveal ? <button type="button" className={ACTION} onClick={() => go(actions.onReveal!)}><FolderOpen size={13} />{t('switcher.reveal')}</button> : null}
            </div>
          </div>
        ) : null}
        <div className={`flex flex-col p-1 ${facts ? 'border-t border-[var(--border)]' : ''}`}>
          <div className="max-h-[300px] overflow-y-auto">
            {host && others.length ? heading(t('switcher.open')) : null}
            {host ? others.map((tab) => (
              <div key={tab.id} className={`${ROW} text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]`}>
                <button type="button" onClick={() => go(() => host.show(tab.id))} className="flex h-full min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="min-w-0 flex-1 truncate">{titleOf(tab)}</span>
                  <Light tab={tab} />
                </button>
                <Tooltip label={t('switcher.close')}>
                  <button type="button" aria-label={t('switcher.close')} onClick={() => host.close(tab.id)}
                    className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-active)] hover:text-[var(--text)] group-hover:flex">
                    <X size={13} />
                  </button>
                </Tooltip>
              </div>
            )) : null}
            {recent.length ? heading(t('switcher.recent')) : null}
            {recent.map((p) => (
              <button key={p.id} type="button" onClick={() => go(() => onOpen(p.id))}
                className={`${ROW} text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]`}>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => go(onAll)} className={`${ROW} mt-0.5 text-[var(--text)] hover:bg-[var(--bg-hover)]`}>
            {t('switcher.all')}
          </button>
        </div>
      </div>
    </Popover>
  );
}
