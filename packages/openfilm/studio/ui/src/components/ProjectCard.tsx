/**
 * The project in front, named in the middle of the top bar, and its card, opened by clicking the
 * name or its arrow (lib/click-open): the film's picture, its name and folder, what it is (its length, frame,
 * rate, clips), what can be done to it (rename, cover from this frame, show its folder), then the other projects. In an
 * app that keeps several open (lib/host.ts `tabs`) they come first, each with its light while it has something to
 * say: breathing while its agent works, amber while it waits for an answer, its percent while it exports; the name has
 * a dot while another one waits or works. All projects (`onAll`) keeps the recent projects.
 *
 * Rename stays in the card's actions; All projects opens the complete project library.
 */
import React from 'react';
import { ArrowUpRight, ChevronDown, Clapperboard, FolderOpen, Image as ImageIcon, LayoutGrid, Pencil, X } from 'lucide-react';
import { api, type Project } from '@/api';
import { useT } from '@/i18n';
import { formatDuration } from '@/lib/export-jobs';
import { useClickOpen } from '@/lib/click-open';
import { posterRetryDelay, posterTry } from '@/lib/projects-page';
import { studioHost, type HostTab } from '@/lib/host';
import { Popover } from './Popover';
import { posterUrl } from './ProjectCover';
import { Tooltip } from './Tooltip';
import menu from './WorkspaceMenu.module.css';

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
  if (tab.asking) return <span title={t('switcher.asking')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--warn)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--warn)_18%,transparent)]" />;
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

export function ProjectCard({ name, facts, actions = {}, onAll, trigger, disabled = false }: {
  /** the project in front (none: the window with no project) */
  name?: string;
  trigger?: (popup: ReturnType<typeof useClickOpen>, activity: 'asking' | 'working' | null) => React.ReactNode;
  disabled?: boolean;
  facts?: ProjectFacts;
  actions?: ProjectActions;
  onAll: () => void;
}) {
  const t = useT();
  const host = studioHost?.tabs;
  const { tabs, self } = useHostTabs();
  const popup = useClickOpen();
  React.useEffect(() => { if (disabled) popup.dismiss(); }, [disabled, popup.dismiss]);
  const cover = facts ? posterUrl(facts.project) : null;
  const [coverAttempt, setCoverAttempt] = React.useState<{ url: string; n: number; failed: boolean } | null>(null);
  const tried = coverAttempt && coverAttempt.url === cover ? coverAttempt : { url: cover ?? '', n: 0, failed: false };
  const again = tried.failed ? posterRetryDelay(tried.n) : null;
  React.useEffect(() => {
    if (!popup.open || again == null) return undefined;
    const timer = setTimeout(() => setCoverAttempt({ url: tried.url, n: tried.n + 1, failed: false }), again);
    return () => clearTimeout(timer);
  }, [popup.open, again, tried.url, tried.n]);
  const hasCover = facts && (facts.project.cover != null || (facts.clips > 0 && facts.durationMs > 0));
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  React.useEffect(() => {
    if (!popup.open) return;
    void api.projects().then(setProjects, () => setProjects([]));
  }, [popup.open]);

  const names = new Map((projects ?? []).map((p) => [p.id, p.name]));
  const titleOf = (tab: HostTab) => tab.title || names.get(tab.projectId) || t('project.untitled');
  const others = tabs.filter((tab) => tab.id !== self);
  /* another open project waits for the person, or works: said on the name, so it is seen without opening the card */
  const waiting = others.some((tab) => tab.asking);
  const working = others.some((tab) => tab.working);
  const go = (run: () => void) => { popup.dismiss(); run(); };

  return (
    <Popover
      open={popup.open && !disabled}
      onOpenChange={(next) => { if (next) popup.setOpen(true); else popup.dismiss(); }}
      align="center"
      trigger={trigger ? trigger(popup, waiting ? 'asking' : working ? 'working' : null) : (
        <button
          type="button"
          aria-label={t('switcher.label')}
          aria-haspopup="dialog"
          aria-expanded={popup.open}

          onClick={(event) => { event.stopPropagation(); popup.toggle(); }}
          className={`flex h-[26px] min-w-0 max-w-[28ch] items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] ${popup.open ? 'bg-[var(--bg-hover)] text-[var(--text)]' : ''}`}
        >
          <span className="min-w-0 truncate">{name || t('switcher.label')}</span>
          {waiting ? <span aria-label={t('switcher.asking')} className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--warn)]" />
            : working ? <span aria-label={t('switcher.working')} className="status-breathe h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-muted)]" /> : null}
          <ChevronDown size={13} className="shrink-0 text-[var(--text-faint)]" />
        </button>
      )}
    >
      <div data-project-card role="dialog" aria-label={t('switcher.label')} className={`${menu.menu} ${menu.topbar}`}>
        {facts ? (
          <>
            <div className={menu.summary}>
              <div className={menu.thumbnail} style={{ width: Math.min(72, 64 * facts.stage.w / facts.stage.h), height: Math.min(64, 72 * facts.stage.h / facts.stage.w) }}>
                {hasCover && (!tried.failed || again != null) ? <img
                  src={posterTry(tried.url, tried.n)} alt="" draggable={false}
                  style={tried.failed ? { display: 'none' } : undefined}
                  onLoad={() => setCoverAttempt({ url: tried.url, n: tried.n, failed: false })}
                  onError={() => setCoverAttempt({ url: tried.url, n: tried.n, failed: true })}
                /> : null}
                {!hasCover || tried.failed ? <Clapperboard size={22} strokeWidth={1.5} /> : null}
              </div>
              <div className={menu.summaryText}>
                <div className={menu.title} title={facts.project.name}>{facts.project.name || t('project.untitled')}</div>
                <div className={menu.metadata}>
                  <span>{formatDuration(facts.durationMs)}</span><span aria-hidden className={menu.separator}>·</span>
                  <span>{facts.stage.w} × {facts.stage.h}</span><span aria-hidden className={menu.separator}>·</span>
                  <span>{Math.round(facts.fps * 100) / 100} fps</span><span aria-hidden className={menu.separator}>·</span>
                  <span>{facts.clips === 1 ? t('switcher.oneClip') : t('switcher.clips').replace('{n}', String(facts.clips))}</span>
                </div>
                <div className={menu.path} title={facts.project.path}><bdi dir="ltr">{facts.project.path}</bdi></div>
              </div>
            </div>
            <div className={`${menu.actions} ${menu.projectActions}`}>
              {actions.onRename ? <button type="button" className={menu.action} onClick={() => go(actions.onRename!)}><Pencil size={12} /><span>{t('projectMenu.rename')}</span></button> : null}
              {actions.onCoverFromFrame ? <button type="button" className={menu.action} title={t('switcher.cover')} aria-label={t('switcher.cover')} onClick={() => go(actions.onCoverFromFrame!)}><ImageIcon size={12} /><span>{t('switcher.coverShort')}</span></button> : null}
              {actions.onReveal ? <button type="button" className={menu.action} onClick={() => go(actions.onReveal!)}><FolderOpen size={12} /><span>{t('switcher.reveal')}</span></button> : null}
            </div>
          </>
        ) : null}
        {host && others.length ? <div className={menu.projectList}>
          <div className={menu.section}><span>{t('switcher.open')}</span><span>{others.length}</span></div>
          {others.map((tab) => (
            <div key={tab.id} className={menu.row}>
              <button type="button" onClick={() => go(() => host.show(tab.id))} className={menu.primary}>
                <Clapperboard size={13} className={menu.rowIcon} />
                <span className={menu.rowName}>{titleOf(tab)}</span>
                <Light tab={tab} />
              </button>
              <Tooltip label={t('switcher.close')}>
                <button type="button" aria-label={t('switcher.close')} onClick={() => host.close(tab.id)} className={`${menu.iconButton} ${menu.close}`}><X size={12} /></button>
              </Tooltip>
            </div>
          ))}
        </div> : null}
        <div className={menu.footer}>
          <button type="button" onClick={() => go(onAll)} className={`${menu.row} ${menu.all}`}>
            <LayoutGrid size={14} className={menu.rowIcon} /><span className={menu.rowName}>{t('switcher.all')}</span><ArrowUpRight size={13} className={menu.rowIcon} />
          </button>
        </div>
      </div>
    </Popover>
  );
}
