/**
 * The library's skills, in the drawer: what an agent takes up when making a film. The side bar picks the installed
 * ones or OpenFilm's still to install (Discover).
 *
 * Installed, each skill is a line: its mark (its cover, else its icon), its title, what it is for under it, and its
 * switch: on, agents take it up when it fits; off, no agent gets it. A click opens its page (SkillPage), which has its
 * uid. They are in parts, each headed with its count: the person's own first (theirs, and this project's), OpenFilm's
 * system skills (how a film is made, its media, its canvas, in the order agents are given them), the community's
 * installed, then each agent's own under that agent's name (off until let in). The person's own and the community's
 * are there with none too, as an invitation: Import, and Browse community (Discover). Import is beside the search too
 * (LibraryDrawer). Each part folds under its head (kept while Studio is open). Discover is a gallery of tiles to
 * browse: cover, title, what it is for; under the pointer a star and a "+", which names it in the chat's message (its
 * page has Install). A star keeps a skill among the favorites (the side bar's Favorites), as the library's things are.
 */
import React from 'react';
import { ChevronDown, Compass, FolderDown, Plus, Star } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost, type HostAgentId } from '@/lib/host';
import { toggleFavorite, useLibraryFavorites } from '@/lib/library';
import { communityOf, makerOf, seenCatalog, seenSkills, sourcesApi, watchSkills, type SkillEntry } from '@/lib/project-sources';
import { byOrder, SkillCover, SkillMark, SkillPage, useSkillWords } from '../SkillPage';
import { SettingsSwitch } from '../settings/ui';
import { ADD_HOVER, PANEL_ROUND, ROUND } from './AudioList';
import { SourceBadge, SourceChips, sourcesIn, type Source } from './SourceChips';

/** One of Discover's not installed is there only; the person's own and a project's are installed already. */
const installedOf = (skill: SkillEntry) => skill.installed !== false;

/* Discover is read again as it opens, unless it was a minute ago; what it last read shows meanwhile */
const FRESH_MS = 60 * 1000;
/* Discover could not be read when last asked, while Studio is open */
let discoverFailed = false;

export type SkillsLine = 'favorites' | 'installed' | 'discover';

/** A skill among the library's favorites (lib/library), by its uid. */
const starOf = (skill: SkillEntry) => `skill:${skill.uid}`;

/* the parts folded, kept while Studio is open */
const FOLDED = new Set<string>();

/** One of an agent's own skills, and whether OpenFilm lets it in. */
type AgentSkill = { name: string; description: string; allowed: boolean };
type AgentGroup = { id: HostAgentId; name: string; skills: AgentSkill[] };

export function SkillsPane({ line, query, projectId, opened, onOpen, onDiscover }: {
  line: SkillsLine;
  /** Discover, from the community's invitation */
  onDiscover: () => void;
  query: string;
  projectId: string | null;
  /** the skill whose page is shown (its name), none: the list */
  opened: string | null;
  onOpen: (name: string | null) => void;
}) {
  const t = useT();
  const words = useSkillWords();
  const [skills, setSkills] = React.useState<SkillEntry[]>(() => seenSkills(projectId) ?? []);
  React.useEffect(() => {
    let live = true;
    void sourcesApi.skills(projectId).then((list) => { if (live) setSkills(list); }, () => {});
    const stop = watchSkills(projectId, (list) => { if (live) setSkills(list); });
    return () => { live = false; stop(); };
  }, [projectId]);

  /* Discover: what it last read shows at once, and it is read again behind it (Studio reads it as it starts too); before
     anything was ever read, its tiles' places show while it is */
  const [discover, setDiscover] = React.useState<'reading' | 'read' | 'failed'>(() => (seenCatalog() ? (discoverFailed ? 'failed' : 'read') : 'reading'));
  React.useEffect(() => {
    if (line !== 'discover') return;
    let live = true;
    if (!seenCatalog()) setDiscover('reading');
    void sourcesApi.readDiscover(FRESH_MS).then(
      () => { discoverFailed = false; if (live) setDiscover('read'); },
      () => { discoverFailed = true; if (live) setDiscover('failed'); },
    );
    return () => { live = false; };
  }, [line]);

  const installed = line === 'installed';
  const favorites = useLibraryFavorites();
  const starred = (skill: SkillEntry) => favorites.includes(starOf(skill));
  const [, refold] = React.useReducer((n: number) => n + 1, 0);
  const fold = (key: string) => { if (FOLDED.has(key)) FOLDED.delete(key); else FOLDED.add(key); refold(); };
  const agents = useAgentSkills(installed);
  const q = query.trim().toLowerCase();
  const found = skills
    .filter((k) => !q || [words(k).title, words(k).summary, k.name, k.uid].some((w) => w?.toLowerCase().includes(q)))
    .sort(byOrder);
  /* OpenFilm's own in the order agents are given them, as the API lists them */
  const system = installed ? skills.filter((k) => k.core && found.includes(k)) : [];
  /* Discover's installed: OpenFilm's own, then the community's (each made by someone else, under their name) */
  const listed = installed ? found.filter((k) => !k.core && k.source === 'official' && installedOf(k)) : [];
  const official = listed.filter((k) => !communityOf(k));
  const community = listed.filter(communityOf);
  const mine = installed ? found.filter((k) => k.source !== 'official') : [];
  const offered = line === 'discover' ? found.filter((k) => k.source === 'official' && !installedOf(k)) : [];
  /* Discover by whose: OpenFilm's own, the community's, or all (chips only when both are there) */
  const [whose, setWhose] = React.useState<Source | ''>('');
  const sourceOf = (k: SkillEntry): Source => (communityOf(k) ? 'community' : 'official');
  const whoseThere = sourcesIn(offered.map(sourceOf));
  const toInstall = whose && whoseThere.includes(whose) ? offered.filter((k) => sourceOf(k) === whose) : offered;
  const own = agents.groups
    .map((g) => ({ ...g, skills: g.skills.filter((k) => !q || [k.name, k.description].some((w) => w.toLowerCase().includes(q))) }))
    .filter((g) => g.skills.length);
  const turn = (skill: SkillEntry, on: boolean) => {
    setSkills((list) => list.map((k) => (k.uid === skill.uid ? (on ? { ...k, off: undefined } : { ...k, off: true as const }) : k)));
    void sourcesApi.setSkillOn(skill.uid, on).catch(() => { void sourcesApi.skills(projectId).then(setSkills); });
  };
  /* named in the message as agents know it (`as`: another of its name is beside it) */
  const tryIt = (skill: SkillEntry) => studioHost?.useSkill?.({ name: skill.as ?? skill.uid.replace('/', '-'), description: skill.description, title: words(skill).title, newConversation: true });
  /* "+": named in the message being written, in this conversation */
  const addIt = studioHost?.useSkill
    ? (skill: SkillEntry) => studioHost?.useSkill?.({ name: skill.as ?? skill.uid.replace('/', '-'), description: skill.description, title: words(skill).title })
    : undefined;
  const tileOf = (skill: SkillEntry) => (
    <SkillTile key={skill.uid} skill={skill} kept={starred(skill)} onOpen={() => onOpen(skill.uid)} {...(addIt ? { onAdd: () => addIt(skill) } : {})} />
  );
  /* a page asked for by uid, or by the name agents know it by (the chat's) */
  const page = opened ? skills.find((k) => k.uid === opened) ?? skills.find((k) => (k.as ?? k.name) === opened) : undefined;
  if (page) {
    return <SkillPage key={page.uid} skill={page} setSkills={setSkills} projectId={projectId} onBack={() => onOpen(null)}
      {...(studioHost?.useSkill ? { onTry: tryIt } : {})} />;
  }
  if (line === 'discover') {
    /* what Discover could not read now: the skills it had when it last could, said with when; none ever read */
    const read = seenCatalog();
    const note = discover === 'failed'
      ? (read ? t('assetDrawer.discoverOffline').replace('{when}', new Date(read).toLocaleString()) : t('assetDrawer.discoverNever'))
      : null;
    const anyThere = skills.some((k) => k.source === 'official' && !k.core);
    /* the first read under way: the tiles' places, said as Discover being read */
    const waiting = discover === 'reading' && !toInstall.length && !q;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {note ? <p role="status" className="shrink-0 px-3 pb-2 text-[12px] leading-[18px] text-[var(--text-muted)]">{note}</p> : null}
        <SourceChips sources={whoseThere} value={whose} onChange={setWhose} />
        {toInstall.length || waiting ? (
          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(var(--drawer-under,0px)+12px)] pt-0.5">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-2.5 gap-y-3.5" {...(waiting ? { role: 'status', 'aria-label': t('assetDrawer.discoverReading') } : {})}>
              {waiting ? Array.from({ length: 6 }, (_, i) => (
                <div key={i} aria-hidden className="flex flex-col gap-1.5">
                  <div className="skeleton aspect-video w-full rounded-[8px]" />
                  <div className="skeleton h-3 w-2/3 rounded" />
                </div>
              )) : toInstall.map(tileOf)}
            </div>
          </div>
        ) : note && !read ? null : <Empty text={t(q ? 'assetDrawer.noSkillsFound' : anyThere ? 'assetDrawer.allSkillsInstalled' : 'assetDrawer.discoverNone')} />}
      </div>
    );
  }
  const lineOf = (skill: SkillEntry) => (
    <SkillLine key={skill.uid} mark={<SkillMark skill={skill} />} title={words(skill).title}
      under={skill.update ? t('gallery.updateOut').replace('{version}', skill.update.version) : skill.retired ? `${t('gallery.retiredMark')} · ${words(skill).summary}` : words(skill).summary}
      tip={words(skill).summary} on={!skill.off} onOpen={() => onOpen(skill.uid)} kept={starred(skill)} onStar={() => toggleFavorite(starOf(skill))}
      label={t(skill.off ? 'gallery.turnOn' : 'gallery.turnOff').replace('{name}', words(skill).title)} onChange={(on) => turn(skill, on)} />
  );
  if (line === 'favorites') {
    /* the starred: those installed as lines (their switch), those still to install as Discover's tiles */
    const kept = found.filter(starred);
    const lines = kept.filter(installedOf), tiles = kept.filter((k) => !installedOf(k));
    if (!kept.length) return <Empty text={t(q ? 'assetDrawer.noSkillsFound' : 'assetDrawer.noFavorites')} />;
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-[calc(var(--drawer-under,0px)+12px)] pt-0.5">
        {lines.length ? <div>{lines.map(lineOf)}</div> : null}
        {tiles.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-2.5 gap-y-3.5">{tiles.map(tileOf)}</div> : null}
      </div>
    );
  }
  const importSkill = studioHost?.skills?.add;
  type Part = { key: string; title: string; lines: React.ReactNode[]; empty?: React.ReactNode };
  const parts = ([
    /* the person's own first, and the community's: with none, an invitation (not while searching) */
    { key: 'mine', title: t('assetDrawer.skillsMine'), lines: mine.map(lineOf), ...(q ? {} : {
      empty: <Invitation icon={<FolderDown size={16} strokeWidth={1.75} />} title={t('assetDrawer.mineEmptyTitle')}
        text={t(importSkill ? 'assetDrawer.mineEmpty' : 'assetDrawer.mineEmptyCli')}
        {...(importSkill ? { action: { label: t('assetDrawer.mineImport'), run: importSkill } } : {})} />,
    }) },
    { key: 'system', title: t('assetDrawer.skillsSystem'), lines: system.map(lineOf) },
    { key: 'official', title: t('assetDrawer.skillsOfficial'), lines: official.map(lineOf) },
    { key: 'community', title: t('assetDrawer.skillsCommunity'), lines: community.map(lineOf), ...(q || official.length ? {} : {
      empty: <Invitation icon={<Compass size={16} strokeWidth={1.75} />} title={t('assetDrawer.communityEmptyTitle')}
        text={t('assetDrawer.communityEmpty')} action={{ label: t('assetDrawer.communityBrowse'), run: onDiscover }} />,
    }) },
    /* each agent's own under its name: whose they are */
    ...own.map((g) => ({
      key: g.id, title: t('assetDrawer.skillsAgentOwn').replace('{name}', g.name),
      lines: g.skills.map((k) => <SkillLine key={k.name} mark={<SkillMark skill={{}} />} title={k.name} under={k.description} tip={k.description} on={k.allowed}
        label={t(k.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', k.name)} onChange={(on) => agents.allow(g.id, k.name, on)} />),
    })),
  ] as Part[]).filter((p) => p.lines.length || p.empty);
  if (!parts.length) return <Empty text={t('assetDrawer.noSkillsFound')} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-[calc(var(--drawer-under,0px)+12px)] pt-0.5">
      {parts.map((p) => {
        const folded = FOLDED.has(p.key) && !q;
        return (
          <section key={p.key}>
            {/* its head folds it (a search shows every part) */}
            <button type="button" onClick={() => fold(p.key)} aria-expanded={!folded}
              className="group/head mb-1 flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[11.5px] font-medium text-[var(--text-muted)] hover:text-[var(--text)]">
              {p.title}<span className="tabular-nums text-[var(--text-faint)]">{p.lines.length}</span>
              <ChevronDown size={13} className={`ml-auto text-[var(--text-faint)] transition-transform ${folded ? '-rotate-90' : ''}`} />
            </button>
            {folded ? null : p.lines}
            {folded || p.lines.length ? null : p.empty}
          </section>
        );
      })}
    </div>
  );
}

/** A part with none yet: what it is for and the one thing to do, in a dashed frame where its lines would be. */
function Invitation({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-dashed border-[var(--border-strong)] px-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-field)] text-[var(--text-muted)]">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-medium leading-[17px] text-[var(--text)]">{title}</div>
        <div className="mt-0.5 text-[11.5px] leading-[16px] text-[var(--text-faint)]">{text}</div>
      </div>
      {action ? (
        <button type="button" onClick={action.run}
          className="h-7 shrink-0 rounded-md bg-[var(--bg-field)] px-2.5 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]">{action.label}</button>
      ) : null}
    </div>
  );
}

/** Nothing to list: a word in the middle. */
function Empty({ text }: { text: string }) {
  return <p className="px-4 pt-12 text-center text-[12.5px] leading-relaxed text-[var(--text-faint)]">{text}</p>;
}

/**
 * An installed skill: its mark, its title and what is under it, its star (under the pointer, or kept) and its switch; a
 * click opens its page (an agent's own has neither page nor star).
 */
function SkillLine({ mark, title, under, tip, on, label, onChange, onOpen, kept = false, onStar }: {
  mark: React.ReactNode; title: string; under: string; tip?: string; on: boolean; label: string;
  onChange: (on: boolean) => void; onOpen?: () => void; kept?: boolean; onStar?: () => void;
}) {
  const t = useT();
  return (
    <div role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} title={tip}
      onClick={onOpen} onKeyDown={(e) => { if (onOpen && e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}
      className={`group flex items-center gap-2.5 rounded-[8px] px-1 py-1.5 outline-none ${onOpen ? 'cursor-pointer hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]' : ''}`}>
      <span className={on ? '' : 'opacity-50'}>{mark}</span>
      <div className="min-w-0 flex-1">
        <div className={`truncate text-[12.5px] font-medium leading-[17px] ${on ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{title}</div>
        <div className={`truncate text-[11px] leading-[15px] text-[var(--text-faint)]`}>{under}</div>
      </div>
      {onStar ? (
        <button type="button" aria-label={t(kept ? 'assetDrawer.unstar' : 'assetDrawer.star')} aria-pressed={kept}
          onClick={(e) => { e.stopPropagation(); onStar(); }}
          className={`${PANEL_ROUND} ${kept ? 'grid text-[#ffd35a]' : 'hidden text-[var(--text)] group-hover:grid'}`}>
          <Star size={11} fill={kept ? 'currentColor' : 'none'} strokeWidth={kept ? 0 : 2.2} />
        </button>
      ) : null}
      {/* the switch is its own: a press there does not open the page */}
      <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><SettingsSwitch checked={on} onChange={onChange} label={label} /></span>
    </div>
  );
}

/** Adding one of the person's own (the app's dialog: a link or a folder). */
export function ImportButton({ onClick }: { onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onClick}
      className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-[var(--bg-field)] px-2.5 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]">
      <Plus size={14} />{t('assetDrawer.skillImport')}
    </button>
  );
}

/** The skills each of the person's agents has of its own, for the agents that can be told which to leave out (read when `shown`). */
function useAgentSkills(shown: boolean) {
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
  React.useEffect(() => { if (shown) void read(); }, [shown, read]);
  const allow = (id: HostAgentId, name: string, allowed: boolean) => {
    setGroups((list) => list.map((g) => (g.id === id ? { ...g, skills: g.skills.map((k) => (k.name === name ? { ...k, allowed } : k)) } : g)));
    void host?.allowSkill?.(id, name, allowed)?.catch(() => {}).finally(() => { void read(); });
  };
  return { groups: shown ? groups : [], allow };
}

/**
 * One skill to install, in Discover: its cover (its preview under the pointer), its title and what it is for under it;
 * over the cover's corner, as a library card's, a star and a "+" that names it in the chat (Install is on its page).
 */
function SkillTile({ skill, kept, onOpen, onAdd }: { skill: SkillEntry; kept: boolean; onOpen: () => void; onAdd?: () => void }) {
  const t = useT();
  const { title, summary } = useSkillWords()(skill);
  const [hover, setHover] = React.useState(false);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }} title={title}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="group min-w-0 cursor-pointer select-none outline-none">
      <div className="relative aspect-video overflow-hidden rounded-md bg-[var(--bg-field)] ring-1 ring-transparent group-hover:ring-[var(--text-faint)] group-focus-visible:ring-[var(--accent)]">
        <SkillCover key={skill.cover ?? ''} skill={skill} title={title} small playing={hover} />
        {/* the community's wear who made it on the corner */}
        {communityOf(skill) ? <SourceBadge source="community" by={makerOf(skill)} /> : null}
        <span className="absolute bottom-1 right-1 flex items-center gap-1">
          <button type="button" aria-label={t(kept ? 'assetDrawer.unstar' : 'assetDrawer.star')} aria-pressed={kept}
            onClick={(e) => { e.stopPropagation(); toggleFavorite(starOf(skill)); }}
            className={`${ROUND} bg-black/55 ${kept ? 'grid text-[#ffd35a]' : 'hidden text-white group-hover:grid'}`}>
            <Star size={11} fill={kept ? 'currentColor' : 'none'} strokeWidth={kept ? 0 : 2.2} />
          </button>
          {onAdd ? (
            <button type="button" title={t('assetDrawer.skillAdd')} aria-label={t('assetDrawer.skillAdd')} onClick={(e) => { e.stopPropagation(); onAdd(); }}
              className={`${ROUND} ${ADD_HOVER} hidden bg-black/55 text-white group-hover:grid`}>
              <Plus size={12} strokeWidth={2.6} />
            </button>
          ) : null}
        </span>
      </div>
      <div className="mt-1.5 truncate px-0.5 text-[12px] font-medium text-[var(--text-muted)] group-hover:text-[var(--text)]">{title}</div>
      {/* one this computer cannot run says so where its summary is */}
      {skill.elsewhere && skill.platforms ? (
        <div className="truncate px-0.5 text-[10.5px] text-[var(--warn)]">{t('gallery.onlyOnShort').replace('{where}', skill.platforms.map((p) => t(`gallery.platform_${p}`)).join(' / '))}</div>
      ) : <div className="truncate px-0.5 text-[10.5px] text-[var(--text-faint)]" title={summary}>{summary}</div>}
    </div>
  );
}
