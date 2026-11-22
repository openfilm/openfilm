/**
 * The desktop window's search (the sidebar's Search, ⌘K): a window in the middle of the page over everything, with the
 * person's projects, their conversations and what can be done (a new chat, a new project, the sidebar's pages) in one
 * list. Typed words narrow it; its kinds (all, projects, chats, actions) are pills under the field, ← → between them
 * while nothing is typed; ↑ ↓ pick a line, Enter opens it, Esc closes.
 *
 * With nothing typed it shows the recent: the conversations of the project open here, then the projects in the order
 * they were opened. Typed, it looks through every project's name and the conversations of the most recent ones.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Folder, Folders, LibraryBig, MessageSquare, Plus, Search, SquarePen, X } from 'lucide-react';
import { api, type Project } from '@/api';
import { useT } from '@/i18n';
import { studioHost, type HostConversationList } from '@/lib/host';
import { COMMUNITY_ICON as Community } from './feature-kinds';
import type { SidePage } from './DesktopNavigation';

type Kind = 'all' | 'projects' | 'chats' | 'actions';
const KINDS: Kind[] = ['all', 'projects', 'chats', 'actions'];
/* how many of the most recent projects have their conversations looked through */
const CHATS_OF = 12;
const RECENT = 6;

interface Line { key: string; kind: Exclude<Kind, 'all'>; icon: React.ReactNode; label: string; note?: string; run: () => void }

export function SearchPalette({ open, projectId, onClose, onOpenProject, onOpenChat, onNewChat, onNewProject, onPage }: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onOpenProject: (id: string) => void;
  onOpenChat: (projectId: string, sessionId: string) => void;
  onNewChat: () => void;
  onNewProject: () => void;
  onPage: (page: SidePage) => void;
}) {
  if (!open) return null;
  return createPortal(<Palette projectId={projectId} onClose={onClose} onOpenProject={onOpenProject} onOpenChat={onOpenChat}
    onNewChat={onNewChat} onNewProject={onNewProject} onPage={onPage} />, document.body);
}

function Palette({ projectId, onClose, onOpenProject, onOpenChat, onNewChat, onNewProject, onPage }: Omit<React.ComponentProps<typeof SearchPalette>, 'open'>) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const [kind, setKind] = React.useState<Kind>('all');
  const [active, setActive] = React.useState(0);
  const [projects, setProjects] = React.useState<Project[]>([]);
  const [chats, setChats] = React.useState<Record<string, HostConversationList>>({});
  const input = React.useRef<HTMLInputElement>(null);
  const list = React.useRef<HTMLDivElement>(null);
  const previous = React.useRef<HTMLElement | null>(null);
  React.useLayoutEffect(() => {
    previous.current = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => { if (previous.current?.isConnected) previous.current.focus({ preventScroll: true }); };
  }, []);
  React.useEffect(() => {
    let live = true;
    const bridge = studioHost?.conversations;
    void api.projects().then(rows => {
      if (!live) return;
      const listed = rows.filter(p => !p.missing).sort((a, b) => (b.id === projectId ? 1 : 0) - (a.id === projectId ? 1 : 0) || b.openedAt - a.openedAt);
      setProjects(listed);
      for (const project of listed.slice(0, CHATS_OF)) {
        const here = bridge?.get();
        const read = here?.projectId === project.id ? Promise.resolve(here) : bridge?.list(project.id);
        void read?.then(result => { if (live) setChats(old => ({ ...old, [project.id]: result })); }, () => {});
      }
    }, () => {});
    return () => { live = false; };
  }, [projectId]);

  const close = (then?: () => void) => { onClose(); then?.(); };
  const nameOf = (id: string) => projects.find(p => p.id === id)?.name ?? '';
  const needle = query.trim().toLocaleLowerCase();
  const matches = (...words: (string | undefined)[]) => !needle || words.some(word => word?.toLocaleLowerCase().includes(needle));
  const chatLines: (Line & { match: string[] })[] = Object.entries(chats)
    .sort(([a], [b]) => projects.findIndex(p => p.id === a) - projects.findIndex(p => p.id === b))
    .flatMap(([id, list]) => list.sessions.map(session => {
      const title = session.title || t('desktopNavigation.newChat');
      return { key: `chat:${id}:${session.id}`, kind: 'chats' as const, icon: <MessageSquare size={16} strokeWidth={1.7} />, label: title,
        note: t('searchPalette.inProject').replace('{name}', nameOf(id)), run: () => close(() => onOpenChat(id, session.id)), match: [title, nameOf(id)] };
    }))
    .filter(line => matches(...line.match));
  const projectLines: Line[] = projects.filter(p => matches(p.name, p.path)).map(p => ({
    key: `project:${p.id}`, kind: 'projects', icon: <Folder size={16} strokeWidth={1.7} />, label: p.name || t('project.untitled'),
    run: () => close(() => onOpenProject(p.id)),
  }));
  const actionLines: Line[] = ([
    { key: 'new-chat', kind: 'actions', icon: <SquarePen size={16} strokeWidth={1.7} />, label: t('desktopNavigation.newChat'), run: () => close(onNewChat) },
    { key: 'new-project', kind: 'actions', icon: <Plus size={16} strokeWidth={1.7} />, label: t('searchPalette.newProject'), run: () => close(onNewProject) },
    { key: 'page-projects', kind: 'actions', icon: <Folders size={16} strokeWidth={1.7} />, label: t('projects.sideProjects'), run: () => close(() => onPage('projects')) },
    { key: 'page-community', kind: 'actions', icon: <Community size={16} strokeWidth={1.7} />, label: t('assetDrawer.pluginsWindow'), run: () => close(() => onPage('community')) },
    { key: 'page-library', kind: 'actions', icon: <LibraryBig size={16} strokeWidth={1.7} />, label: t('desktopNavigation.library'), run: () => close(() => onPage('library')) },
  ] satisfies Line[]).filter(line => matches(line.label));

  /* the sections shown: nothing typed, the recent first; typed, what matches of each kind */
  const sections: { title: string; lines: Line[] }[] = [];
  const of = (k: Exclude<Kind, 'all'>) => kind === 'all' || kind === k;
  if (!needle && kind === 'all') {
    const here = chatLines.filter(line => line.key.startsWith(`chat:${projectId}:`)).slice(0, 3);
    sections.push({ title: t('searchPalette.recent'), lines: [...here, ...projectLines.slice(0, RECENT - here.length)] });
    sections.push({ title: t('searchPalette.actions'), lines: actionLines });
  } else {
    if (of('projects')) sections.push({ title: t('searchPalette.projects'), lines: needle ? projectLines : projectLines.slice(0, 30) });
    if (of('chats')) sections.push({ title: t('searchPalette.chats'), lines: needle ? chatLines : chatLines.slice(0, 30) });
    if (of('actions')) sections.push({ title: t('searchPalette.actions'), lines: actionLines });
  }
  const shown = sections.filter(section => section.lines.length);
  const lines = shown.flatMap(section => section.lines);
  const at = Math.min(active, Math.max(0, lines.length - 1));
  React.useEffect(() => { setActive(0); }, [query, kind]);
  React.useLayoutEffect(() => {
    list.current?.querySelector<HTMLElement>('[data-active]')?.scrollIntoView({ block: 'nearest' });
  }, [at]);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActive(Math.min(lines.length - 1, at + 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(Math.max(0, at - 1)); }
    else if (event.key === 'Enter') { event.preventDefault(); lines[at]?.run(); }
    else if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && !query) {
      event.preventDefault();
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      setKind(KINDS[(KINDS.indexOf(kind) + step + KINDS.length) % KINDS.length]!);
    }
  };
  let index = -1;
  const key = (text: string) => <kbd className="min-w-[20px] rounded-[5px] border border-[var(--frame-line)] px-1.5 text-center text-[11px] leading-[18px] text-[var(--text-muted)]">{text}</kbd>;
  return (
    <div className="fixed inset-0 z-[10060] flex items-start justify-center bg-black/45 px-4 pt-[14vh]" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('desktopNavigation.search')} data-search-palette onKeyDown={onKey}
        className="flex max-h-[min(640px,76vh)] w-full max-w-[680px] flex-col overflow-hidden rounded-[16px] border border-[var(--frame-line)] bg-[var(--bg-raised)] text-[var(--text)] shadow-[0_24px_70px_-12px_rgba(0,0,0,0.6)]">
        <div className="flex items-center gap-3 px-5 pt-4">
          <Search size={17} strokeWidth={1.7} className="shrink-0 text-[var(--text-muted)]" aria-hidden />
          <input ref={input} type="search" value={query} placeholder={t('searchPalette.placeholder')} aria-label={t('searchPalette.placeholder')}
            role="combobox" aria-expanded aria-controls="search-palette-list" aria-activedescendant={lines[at] ? `search-line-${at}` : undefined}
            onChange={event => setQuery(event.target.value)}
            className="h-9 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[var(--text-muted)] [&::-webkit-search-cancel-button]:hidden" />
          <button type="button" aria-label={t('searchPalette.close')} onClick={() => close()}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><X size={16} aria-hidden /></button>
        </div>
        <div role="tablist" className="flex gap-1 border-b border-[var(--frame-line)] px-4 pb-3 pt-2.5">
          {KINDS.map(k => <button key={k} type="button" role="tab" aria-selected={kind === k} tabIndex={-1} onClick={() => { setKind(k); input.current?.focus(); }}
            className={`h-7 rounded-[7px] px-2.5 text-[13px] transition-colors ${kind === k ? 'bg-[var(--bg-field)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
            {t(`searchPalette.${k}`)}
          </button>)}
        </div>
        <div ref={list} id="search-palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2.5 pb-2.5">
          {shown.length ? shown.map(section => <div key={section.title} role="group" aria-label={section.title}>
            <div className="px-2.5 pb-1.5 pt-4 text-[12px] text-[var(--text-muted)]">{section.title}</div>
            {section.lines.map(line => {
              index += 1;
              const on = index === at;
              const mine = index;
              return <div key={line.key} id={`search-line-${mine}`} role="option" aria-selected={on} data-active={on || undefined} data-search-line={line.key}
                onMouseMove={() => { if (active !== mine) setActive(mine); }} onClick={line.run}
                className={`flex h-10 cursor-default items-center gap-3 rounded-[9px] px-2.5 text-[14px] ${on ? 'bg-[var(--bg-field)]' : ''}`}>
                <span className="grid w-5 shrink-0 place-items-center text-[var(--text-muted)]">{line.icon}</span>
                <span className="min-w-0 truncate">{line.label}</span>
                {line.note ? <span className="min-w-0 shrink truncate text-[12.5px] text-[var(--text-faint)]">{line.note}</span> : null}
                {on ? <span className="ml-auto shrink-0 text-[var(--text-muted)]" aria-hidden>↵</span> : null}
              </div>;
            })}
          </div>) : <p role="status" className="px-2.5 py-10 text-center text-[13px] text-[var(--text-muted)]">{t('searchPalette.none')}</p>}
        </div>
        <div className="flex items-center gap-5 border-t border-[var(--frame-line)] px-5 py-3 text-[12px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1.5">{t('searchPalette.close')}{key('Esc')}</span>
          <span className="flex items-center gap-1.5">{t('searchPalette.type')}{key('←')}{key('→')}</span>
          <span className="ml-auto flex items-center gap-1.5">{t('searchPalette.open')}{key('↵')}</span>
        </div>
      </div>
    </div>
  );
}
