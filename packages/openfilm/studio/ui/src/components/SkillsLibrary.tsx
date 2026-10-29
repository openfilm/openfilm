/**
 * Skills: what an agent can take up when making a film. Two views, switched in their own row:
 *
 *   · Installed  what agents get, the person's own first, then the official ones they installed, then this project's,
 *                then each agent's own (those the person installed in Codex, Claude Code…, off until let in). Each is a
 *                row with its switch: on, an agent takes it up whenever it fits; off, it stays here and no agent gets it.
 *   · Discover   OpenFilm's official skills, a catalog: one is installed to be used (it starts on).
 *
 * One opened is a page in place of the list, as an example is (the gallery's Back returns to the list as it was): its
 * preview or picture on the left; on the right its title and switch, what it is for, and what to do with it: Install,
 * or Try now (a new conversation with the skill named in its message), and uninstalling it (an official one) or moving
 * it to the trash (the person's own, a project's). Adding one (a link, a folder, made with the agent) is the app's own
 * dialog.
 */
import React from 'react';
import {
  Blocks, Check, Copy, Film, Folder, GitBranch, Github, Info, Layers, MessageSquarePlus, MonitorPlay,
  MoreHorizontal, Music, PenLine, PictureInPicture2, Plus, Presentation, Scissors, Search, Shapes, Sparkles, Trash2, Wand2, X,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost, type HostAgentId } from '@/lib/host';
import { sourcesApi, type SkillEntry } from '@/lib/project-sources';
import { ConfirmDialog } from './ConfirmDialog';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { SettingsSwitch } from './settings/ui';

export type SkillsView = 'installed' | 'discover';
type Kind = 'all' | 'workflow' | 'style';
/** One of an agent's own skills (Settings → Agents lets the same in). */
type AgentSkill = { name: string; description: string; allowed: boolean };
type AgentGroup = { id: HostAgentId; name: string; skills: AgentSkill[] };

export const byOrder = (a: SkillEntry, b: SkillEntry) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name);
/** words in the language shown, else its family's, else English, else any */
export const inLanguage = (words: Record<string, string> | undefined, lang: string) =>
  (words ? words[lang] ?? words[lang.split('-')[0]!] ?? words.en ?? Object.values(words)[0] : undefined);

/** A skill as people see it: its title and summary in the language shown, else its name and the agent's description. */
export function useSkillWords() {
  const lang = useLanguage();
  return (skill: SkillEntry) => ({
    title: inLanguage(skill.shown?.title, lang) ?? skill.name,
    summary: inLanguage(skill.shown?.summary, lang) ?? skill.description,
  });
}

/** An official one not installed is in the catalog only; the person's own and a project's are installed already. */
const installedOf = (skill: SkillEntry) => skill.installed !== false;

export function SkillsLibrary({ skills, setSkills, projectId, opened, onOpen, onBack, onTry, initialView }: {
  skills: SkillEntry[];
  setSkills: React.Dispatch<React.SetStateAction<SkillEntry[]>>;
  projectId: string | null;
  /** the skill whose page is open (the gallery keeps it: its Back and Esc return to the list) */
  opened: SkillEntry | null;
  onOpen: (skill: SkillEntry) => void;
  /** back to the list (the skill opened was removed) */
  onBack: () => void;
  /** Try now: a new conversation with the skill named (none: Studio without the app's chat) */
  onTry?: (skill: SkillEntry) => void;
  /** the view it opens on (none: Installed when anything is, else Discover) */
  initialView?: SkillsView;
}) {
  const t = useT();
  const words = useSkillWords();
  const [view, setView] = React.useState<SkillsView>(() => initialView ?? (skills.some(installedOf) ? 'installed' : 'discover'));
  const [kind, setKind] = React.useState<Kind>('all');
  const [query, setQuery] = React.useState('');
  const [removing, setRemoving] = React.useState<SkillEntry | null>(null);
  const agents = useAgentSkills();

  /* each change shown at once, then the list read again (watchSkills) */
  const patch = (name: string, change: (k: SkillEntry) => SkillEntry) => setSkills((list) => list.map((k) => (k.name === name ? change(k) : k)));
  const reload = () => { void sourcesApi.skills(projectId).then(setSkills); };
  const turn = (skill: SkillEntry, on: boolean) => {
    patch(skill.name, (k) => { const { off: _was, ...rest } = k; return on ? rest : { ...rest, off: true }; });
    void sourcesApi.setSkillOn(skill.name, on).catch(reload);
  };
  const install = (skill: SkillEntry, installed: boolean) => {
    patch(skill.name, (k) => { const { off: _was, ...rest } = k; return { ...rest, installed }; });
    void sourcesApi.setSkillInstalled(skill.name, installed).catch(reload);
  };
  const remove = (skill: SkillEntry) => {
    if (skill.source === 'official') { install(skill, false); return; }
    setRemoving(skill);
  };

  const q = query.trim().toLowerCase();
  const matches = (k: SkillEntry) => !q || [words(k).title, words(k).summary, k.name].some((w) => w?.toLowerCase().includes(q));
  const installed = skills.filter(installedOf).filter(matches);
  const groups = [
    { id: 'mine', label: t('gallery.mine'), hint: t('gallery.mineHint'), items: installed.filter((k) => k.source === 'mine').sort(byOrder) },
    { id: 'official', label: t('gallery.fromOpenFilm'), hint: t('gallery.officialHint'), items: installed.filter((k) => k.source === 'official').sort(byOrder) },
    { id: 'project', label: t('gallery.project'), hint: t('gallery.projectHint'), items: installed.filter((k) => k.source === 'project').sort(byOrder) },
  ];
  const catalog = skills.filter((k) => k.source === 'official' && (kind === 'all' || (kind === 'style') === (k.kind === 'style')) && matches(k)).sort(byOrder);
  const count = skills.filter(installedOf).length + agents.groups.reduce((n, g) => n + g.skills.filter((s) => s.allowed).length, 0);

  const chip = (selected: boolean, label: React.ReactNode, onClick: () => void, key: string) => (
    <button key={key} type="button" role="tab" aria-selected={selected} onClick={onClick}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-[13px] transition ${selected ? 'bg-[var(--bg-hover)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
      {label}
    </button>
  );

  const confirm = (
    <ConfirmDialog open={removing != null} danger
      title={t('gallery.removeTitle').replace('{name}', removing ? words(removing).title : '')}
      description={t('gallery.removeHint')} confirmLabel={t('gallery.remove')}
      onCancel={() => setRemoving(null)}
      onConfirm={() => {
        const skill = removing;
        setRemoving(null);
        if (!skill) return;
        if (opened?.name === skill.name) onBack();
        setSkills((list) => list.filter((k) => !(k.source === skill.source && k.name === skill.name)));
        void sourcesApi.removeSkill(skill.name, projectId).finally(reload);
      }} />
  );

  return (
    <>
    {/* one opened: its page in place of the list; the list stays, hidden, so Back finds it as it was (its view, its
        search, where it was scrolled to) */}
    {opened ? (
      <SkillPage key={`${opened.source}:${opened.name}`} skill={skills.find((k) => k.source === opened.source && k.name === opened.name) ?? opened}
        projectId={projectId} onTurn={(on) => turn(opened, on)} onInstall={(on) => install(opened, on)}
        onRemove={() => remove(opened)} onTry={onTry}
        onCoverChanged={(cover) => patch(opened.name, (k) => (k.source === 'mine' ? { ...k, cover: cover ?? undefined } : k))} />
    ) : null}
    <div className="pb-10" hidden={Boolean(opened)}>
      <div className="sticky top-0 z-[1] flex items-center gap-1 bg-[var(--app-content-bg)] px-6 pb-4">
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {chip(view === 'installed', <>{t('gallery.installed')}{count ? <span className="text-[var(--text-faint)]">{count}</span> : null}</>, () => setView('installed'), 'installed')}
          {chip(view === 'discover', t('gallery.discover'), () => setView('discover'), 'discover')}
          {view === 'discover' ? (
            <>
              <span className="mx-2 h-4 w-px shrink-0 bg-[var(--border-strong)]" />
              {chip(kind === 'all', t('gallery.all'), () => setKind('all'), 'all')}
              {chip(kind === 'workflow', t('gallery.workflow'), () => setKind('workflow'), 'workflow')}
              {chip(kind === 'style', t('gallery.style'), () => setKind('style'), 'style')}
            </>
          ) : null}
          <AboutSkills />
        </div>
        {studioHost?.skills ? (
          <button type="button" onClick={() => studioHost?.skills?.add()}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] border border-[var(--border)] px-3 text-[13px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"><Plus size={14} />{t('gallery.addSkill')}</button>
        ) : null}
        <label className="ml-2 flex h-9 w-[240px] shrink-0 items-center gap-2 rounded-[9px] bg-[var(--surface-2)] px-3 text-[var(--text-faint)] ring-1 ring-[var(--border)] focus-within:ring-[var(--border-strong)]">
          <Search size={14} strokeWidth={1.75} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('gallery.search')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
          {query ? <button type="button" aria-label={t('project.close')} onClick={() => setQuery('')} className="hover:text-[var(--text)]"><X size={13} /></button> : null}
        </label>
      </div>

      <div className="px-6">
        {view === 'installed' ? (
          <div className="mx-auto flex max-w-[880px] flex-col gap-8">
            {groups.map((g) => (g.id === 'project' && !g.items.length) || (q && !g.items.length) ? null : (
              <section key={g.id}>
                <GroupHead label={g.label} hint={g.hint} />
                {g.items.length ? g.items.map((k) => (
                  <SkillRow key={`${k.source}:${k.name}`} skill={k} onOpen={() => onOpen(k)} onTurn={(on) => turn(k, on)}
                    menu={rowMenu(k)} />
                )) : g.id === 'mine' ? <NoSkills /> : (
                  <p className="px-2 py-3 text-[12.5px] text-[var(--text-muted)]">
                    {t('gallery.noneInstalled')}{' '}
                    <button type="button" onClick={() => setView('discover')} className="font-medium text-[var(--text)] underline-offset-2 hover:underline">{t('gallery.discover')}</button>
                  </p>
                )}
              </section>
            ))}
            {agents.groups.map((g) => {
              const items = g.skills.filter((s) => !q || [s.name, s.description].some((w) => w.toLowerCase().includes(q)));
              return items.length ? (
                <section key={g.id}>
                  <GroupHead label={t('gallery.fromAgent').replace('{name}', g.name)} hint={t('gallery.agentHint')} />
                  {items.map((s) => <AgentSkillRow key={s.name} skill={s} onTurn={(on) => agents.allow(g.id, s.name, on)} />)}
                </section>
              ) : null;
            })}
          </div>
        ) : catalog.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-8">
            {catalog.map((k) => <CatalogCard key={k.name} skill={k} onOpen={() => onOpen(k)} onInstall={() => install(k, true)} />)}
          </div>
        ) : <p className="py-14 text-center text-[13px] text-[var(--text-muted)]">{t('gallery.noMatch')}</p>}
      </div>

    </div>
    {confirm}
    </>
  );

  function rowMenu(k: SkillEntry): ContextMenuEntry[] {
    return [
      ...(onTry ? [{ id: 'try', icon: <MessageSquarePlus size={14} />, label: t('gallery.tryNow'), disabled: Boolean(k.off), onSelect: () => onTry(k) }] : []),
      { id: 'open', icon: <Info size={14} />, label: t('gallery.details'), onSelect: () => onOpen(k) },
      { id: 'sep', separator: true },
      { id: 'remove', icon: <Trash2 size={14} />, label: t(k.source === 'official' ? 'gallery.uninstall' : 'gallery.remove'), danger: true, onSelect: () => remove(k) },
    ];
  }
}

/** The skills each of the person's agents has of its own, for the agents that can be told which to leave out. */
function useAgentSkills() {
  const [groups, setGroups] = React.useState<AgentGroup[]>([]);
  const host = studioHost?.agents;
  const read = React.useCallback(async () => {
    if (!host?.skills) return;
    const agents = (await host.list().catch(() => [])).filter((a) => a.status === 'ready' && a.shown);
    const read = await Promise.all(agents.map(async (a) => {
      const own = await host.skills!(a.id).catch(() => null);
      return own?.filtered && own.skills.length ? { id: a.id, name: a.name, skills: own.skills } : null;
    }));
    setGroups(read.filter((g): g is AgentGroup => g != null));
  }, [host]);
  React.useEffect(() => { void read(); }, [read]);
  const allow = (id: HostAgentId, name: string, allowed: boolean) => {
    setGroups((list) => list.map((g) => (g.id === id ? { ...g, skills: g.skills.map((s) => (s.name === name ? { ...s, allowed } : s)) } : g)));
    void host?.allowSkill?.(id, name, allowed)?.catch(() => {}).finally(() => { void read(); });
  };
  return { groups, allow };
}

function GroupHead({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="mb-1 flex items-baseline gap-3 px-2">
      <h3 className="text-[14px] font-semibold text-[var(--text)]">{label}</h3>
      <span className="truncate text-[12px] text-[var(--text-faint)]">{hint}</span>
    </div>
  );
}

/** An installed skill: its picture, title and what it does (or where it came from), its switch and its menu. */
function SkillRow({ skill, onOpen, onTurn, menu }: { skill: SkillEntry; onOpen: () => void; onTurn: (on: boolean) => void; menu: ContextMenuEntry[] }) {
  const t = useT();
  const w = useSkillWords()(skill);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}
      className="group flex cursor-pointer items-center gap-3.5 rounded-[10px] px-2 py-2 outline-none transition hover:bg-[var(--bg-hover)] focus-visible:bg-[var(--bg-hover)]">
      <div className={`relative h-[46px] w-[82px] shrink-0 overflow-hidden rounded-[7px] ring-1 ring-[var(--border)] transition-opacity ${skill.off ? 'opacity-45' : ''}`}>
        <SkillCover key={skill.cover ?? ''} skill={skill} title={w.title} small />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[13.5px] font-medium ${skill.off ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{w.title}</div>
        <div className="truncate text-[12px] text-[var(--text-muted)]">{skill.off ? t('gallery.offLine') : w.summary}</div>
      </div>
      <span onClick={(e) => e.stopPropagation()} className="flex shrink-0 items-center gap-1">
        <SettingsSwitch checked={!skill.off} onChange={onTurn} label={t(skill.off ? 'gallery.turnOn' : 'gallery.turnOff').replace('{name}', w.title)} />
        <MoreMenu items={menu} />
      </span>
    </div>
  );
}

/** One of an agent's own skills: its name and description, and whether OpenFilm lets it in. */
function AgentSkillRow({ skill, onTurn }: { skill: AgentSkill; onTurn: (on: boolean) => void }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3.5 rounded-[10px] px-2 py-2">
      <div className={`flex h-[46px] w-[82px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--surface-2)] text-[var(--text-faint)] ring-1 ring-[var(--border)] ${skill.allowed ? '' : 'opacity-45'}`}>
        <Blocks size={16} strokeWidth={1.6} />
      </div>
      <div className="min-w-0 flex-1">
        <div className={`truncate font-mono text-[13px] ${skill.allowed ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{skill.name}</div>
        {skill.description ? <div className="truncate text-[12px] text-[var(--text-muted)]" title={skill.description}>{skill.description}</div> : null}
      </div>
      <span className="flex shrink-0 items-center gap-1">
        <SettingsSwitch checked={skill.allowed} onChange={onTurn} label={t(skill.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', skill.name)} />
        <span className="w-[26px]" />
      </span>
    </div>
  );
}

/** One of OpenFilm's in the catalog: its picture (its preview under the pointer), title, summary, and Install. */
function CatalogCard({ skill, onOpen, onInstall }: { skill: SkillEntry; onOpen: () => void; onInstall: () => void }) {
  const t = useT();
  const w = useSkillWords()(skill);
  const [hover, setHover] = React.useState(false);
  return (
    <div className="flex min-w-0 flex-col">
      <button type="button" onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="group flex min-w-0 flex-col text-left outline-none">
        <div className="relative aspect-video w-full overflow-hidden rounded-[12px] ring-1 ring-[var(--border)] transition group-hover:ring-[var(--border-strong)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--text-muted)]">
          <SkillCover key={skill.cover ?? ''} skill={skill} title={w.title} playing={hover} />
        </div>
      </button>
      <div className="mt-3 flex min-w-0 items-start gap-3">
        <button type="button" tabIndex={-1} onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="truncate text-[14.5px] font-semibold tracking-[-0.005em] text-[var(--text)]">{w.title}</div>
          {w.summary ? <div className="mt-1 line-clamp-2 text-[12.5px] leading-[18px] text-[var(--text-muted)]">{w.summary}</div> : null}
        </button>
        {installedOf(skill) ? (
          <span className="flex h-8 shrink-0 items-center gap-1 px-1 text-[12.5px] text-[var(--text-faint)]"><Check size={13} />{t('gallery.installedOne')}</span>
        ) : (
          <button type="button" onClick={onInstall}
            className="h-8 shrink-0 rounded-[8px] border border-[var(--border)] px-3 text-[12.5px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)]">{t('gallery.install')}</button>
        )}
      </div>
    </div>
  );
}

/** A "…" that opens its menu under it. */
function MoreMenu({ items }: { items: ContextMenuEntry[] }) {
  const t = useT();
  const [anchor, setAnchor] = React.useState<{ x: number; y: number; top: number } | null>(null);
  const button = React.useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={button} type="button" aria-label={t('gallery.more')} aria-expanded={anchor != null} aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          const box = e.currentTarget.getBoundingClientRect();
          setAnchor((cur) => (cur ? null : { x: box.right, y: box.bottom + 4, top: box.top - 4 }));
        }}
        className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
        <MoreHorizontal size={15} />
      </button>
      {anchor ? <ContextMenu x={anchor.x} y={anchor.y} flipTo={anchor.top} align="end" trigger={button} onClose={() => setAnchor(null)} items={items} /> : null}
    </>
  );
}

/**
 * A skill on its own, in place of the list: its preview (or picture) large on the left; on the right its title and
 * switch, kind and version, where it came from, who it is for and what it does, and at the bottom installing it or
 * Try now, then uninstalling it (an official one) or moving it to the trash (the person's own, a project's).
 */
function SkillPage({ skill, projectId, onTurn, onInstall, onRemove, onTry, onCoverChanged }: {
  skill: SkillEntry; projectId: string | null; onTurn: (on: boolean) => void; onInstall: (on: boolean) => void;
  onRemove: () => void; onTry?: (skill: SkillEntry) => void; onCoverChanged: (cover: string | null) => void;
}) {
  const t = useT();
  const lang = useLanguage();
  const words = useSkillWords()(skill);
  const details = inLanguage(skill.shown?.details, lang);
  const installed = installedOf(skill);
  const group = skill.source === 'official' ? (skill.kind === 'style' ? 'gallery.style' : 'gallery.workflow') : skill.source === 'mine' ? 'gallery.mine' : 'gallery.project';
  const source = skill.repository ?? (skill.origin?.from === 'link' ? skill.origin.address : undefined);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const coverInput = React.useRef<HTMLInputElement>(null);
  const changeCover = async (file: File | null) => {
    setBusy(true);
    setError(null);
    try {
      let cover: string | null = null;
      if (file) {
        if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(t('gallery.coverInvalid'));
        cover = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error(t('gallery.coverInvalid')));
          reader.readAsDataURL(file);
        });
        const image = new Image();
        image.src = cover;
        await image.decode().catch(() => { throw new Error(t('gallery.coverInvalid')); });
      }
      onCoverChanged(await sourcesApi.setSkillCover(skill.name, cover, projectId));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)] border-t border-[var(--border)]">
      <div className="flex min-h-0 flex-col items-center justify-center gap-4 bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] p-8">
        <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-black ring-1 ring-[var(--border)]">
          {skill.preview ? <video src={skill.preview} poster={skill.cover} autoPlay muted loop controls playsInline className="absolute inset-0 h-full w-full object-contain" />
            : <SkillCover key={skill.cover ?? ''} skill={skill} title={words.title} big />}
        </div>
        {skill.source === 'mine' ? <div className="flex flex-wrap items-center justify-center gap-3 text-[12px] text-[var(--text-muted)]">
          <button type="button" disabled={busy} onClick={() => coverInput.current?.click()} className="h-9 rounded-[9px] px-3 text-[13px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40">{t(skill.cover ? 'gallery.changeCover' : 'gallery.chooseCover')}</button>
          <input ref={coverInput} type="file" accept="image/png,image/jpeg,image/webp" aria-label={t(skill.cover ? 'gallery.changeCover' : 'gallery.chooseCover')} disabled={busy} hidden
            onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void changeCover(file); }} />
          {skill.cover ? <button type="button" disabled={busy} onClick={() => void changeCover(null)} className="h-9 rounded-[9px] px-3 text-[13px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40">{t('gallery.removeCover')}</button> : null}
          {busy ? <span role="status">{t('gallery.coverSaving')}</span> : null}
        </div> : null}
        {error ? <p role="alert" className="text-[12px] text-[var(--warn)]">{error}</p> : null}
      </div>
      <div className="flex min-h-0 flex-col border-l border-[var(--border)]">
        <div className="min-h-0 flex-1 overflow-y-auto px-7 pt-7">
          <div className="flex items-start gap-3">
            <h2 className="min-w-0 flex-1 text-[22px] font-semibold leading-tight tracking-[-0.015em] text-[var(--text)]">{words.title}</h2>
            {installed ? <SettingsSwitch checked={!skill.off} onChange={onTurn} label={t(skill.off ? 'gallery.turnOn' : 'gallery.turnOff').replace('{name}', words.title)} /> : null}
          </div>
          {skill.off ? <p className="mt-2 text-[12.5px] text-[var(--text-muted)]">{t('gallery.skillOff')}</p> : null}
          <div className="mt-2.5 flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <span>{t(group)}</span>
            {skill.version ? <span className="rounded-[5px] border border-[var(--border)] px-1.5 py-[1px] font-mono text-[10.5px] text-[var(--text-dim)]">v{skill.version}</span> : null}
            {/* its source: OpenFilm's repository, or the address one of the person's came from */}
            {source ? (
              <a href={source} target="_blank" rel="noreferrer" title={source} aria-label={t('gallery.viewSource')}
                className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><Github size={14} strokeWidth={1.75} /></a>
            ) : null}
          </div>
          <Origin skill={skill} />
          {words.summary ? <p className="mt-5 text-[14px] leading-[22px] text-[var(--text)]">{words.summary}</p> : null}
          {details ? details.split('\n').map((line) => <p key={line} className="mt-3 text-[13.5px] leading-[22px] text-[var(--text-muted)]">{line}</p>) : null}
        </div>
        <div className="shrink-0 px-7 pb-7 pt-4">
          {!installed ? (
            <button type="button" onClick={() => onInstall(true)}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--text)] text-[14px] font-medium text-[var(--bg)] transition hover:opacity-90"><Plus size={15} />{t('gallery.install')}</button>
          ) : onTry ? (
            <button type="button" onClick={() => onTry(skill)} disabled={skill.off} title={skill.off ? t('gallery.tryOff') : undefined}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--text)] text-[14px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:opacity-40"><MessageSquarePlus size={15} />{t('gallery.tryNow')}</button>
          ) : null}
          {installed ? (
            <button type="button" onClick={onRemove}
              className="mt-2 flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] text-[13px] text-[var(--text-muted)] transition hover:bg-[color-mix(in_srgb,var(--err)_12%,transparent)] hover:text-[var(--err)]">
              <Trash2 size={14} />{t(skill.source === 'official' ? 'gallery.uninstall' : 'gallery.remove')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** What skills are for, behind the (i). */
function AboutSkills() {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <span className="relative ml-1 flex shrink-0" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={t('gallery.aboutSkills')} aria-expanded={open} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--text-faint)] transition hover:text-[var(--text)]">
        <Info size={15} strokeWidth={1.75} />
      </button>
      {open ? (
        <span role="tooltip" className="fixed z-[10060] mt-9 w-[400px] whitespace-pre-line rounded-[10px] border border-[var(--border-strong)] bg-[var(--dock-pane)] px-4 py-3.5 text-[12.5px] leading-[20px] text-[var(--text-muted)] shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
          {t('gallery.skillKinds')}
        </span>
      ) : null}
    </span>
  );
}

/** None of the person's skills yet: what theirs are for, and how to get one. */
function NoSkills() {
  const t = useT();
  return (
    <div className="mt-1 flex items-center gap-4 rounded-[12px] border border-dashed border-[var(--border-strong)] px-5 py-4">
      <Sparkles size={18} strokeWidth={1.5} className="shrink-0 text-[var(--text-faint)]" />
      <p className="min-w-0 flex-1 text-[12.5px] leading-[19px] text-[var(--text-muted)]">{t('gallery.noSkills')}</p>
      {studioHost?.skills ? (
        <button type="button" onClick={() => studioHost?.skills?.add()}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-[var(--border)] px-3 text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"><Plus size={13} />{t('gallery.addSkill')}</button>
      ) : null}
    </div>
  );
}

/** Where one of the person's skills came from, as a short line: GitHub · owner/repo, a folder's name, or made here. */
function Origin({ skill }: { skill: SkillEntry }) {
  const t = useT();
  const o = skill.origin;
  if (!o) return null;
  let icon = <Wand2 size={12} />, text = t('gallery.made');
  if (o.from === 'link') {
    icon = <GitBranch size={12} />;
    try { const u = new URL(o.address); text = `${u.hostname.replace(/^www\./, '').replace(/\.com$/, '').replace(/^github$/, 'GitHub').replace(/^gitlab$/, 'GitLab')} · ${u.pathname.split('/').filter(Boolean).slice(0, 2).join('/')}`; } catch { text = o.address; }
  } else if (o.from === 'folder') {
    icon = <Folder size={12} />;
    text = `${t('gallery.fromFolder')} · ${o.address.split(/[\\/]/).filter(Boolean).pop() ?? o.address}`;
  }
  return <div title={o.from === 'made' ? undefined : o.address} className="mt-2 flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--text-faint)]">{icon}<span className="truncate">{text}</span></div>;
}

const ICONS: Record<string, LucideIcon> = {
  copy: Copy, scissors: Scissors, monitor: MonitorPlay, shapes: Shapes, pip: PictureInPicture2, pen: PenLine, film: Film,
  music: Music, presentation: Presentation, layers: Layers,
};
/** each mark its own color, so the covers tell apart at a glance */
const HUES: Record<string, number> = { copy: 212, scissors: 18, monitor: 188, shapes: 262, pip: 328, pen: 42, film: 28, music: 286, presentation: 228, layers: 6 };

/** A skill's picture: its cover, else its preview's first frame, else a tile of its mark in its own color. */
function SkillCover({ skill, title, small = false, big = false, playing = false }: { skill: SkillEntry; title: string; small?: boolean; big?: boolean; playing?: boolean }) {
  const [failed, setFailed] = React.useState(false);
  if (skill.cover && !failed) {
    return (
      <>
        <img src={skill.cover} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        {playing && skill.preview ? <video src={skill.preview} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
      </>
    );
  }
  const Mark = ICONS[skill.icon ?? ''] ?? Sparkles;
  const hue = HUES[skill.icon ?? ''] ?? 220;
  return (
    <div aria-label={title} className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
      style={{ background: `radial-gradient(110% 90% at 25% 0%, hsl(${hue} 70% 55% / 0.22), transparent 62%), radial-gradient(90% 80% at 100% 100%, hsl(${hue} 70% 50% / 0.12), transparent 60%), var(--surface-2)` }}>
      <span className={`flex items-center justify-center ${small ? 'h-7 w-7 rounded-[8px]' : big ? 'h-16 w-16 rounded-[14px]' : 'h-14 w-14 rounded-[14px]'}`}
        style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `hsl(${hue} 80% 72%)`, boxShadow: `0 0 0 1px hsl(${hue} 70% 60% / 0.28)` }}>
        <Mark size={small ? 14 : big ? 28 : 24} strokeWidth={1.6} />
      </span>
      {/* a card has its title under it; the page's big picture carries it */}
      {big ? <span className="line-clamp-2 text-[22px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</span> : null}
    </div>
  );
}
