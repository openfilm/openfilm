/**
 * The library's plugins, in the drawer: everything that teaches OpenFilm one more kind of work, in one list. A plugin
 * is a package (skills, commands, a surface); one that shows only in the conversation is a skill, one that also shows
 * outside it is a plugin (lib/project-plugins isPlugin). People look for what OpenFilm can do, not for which of the two
 * it is, so both are here: OpenFilm's own plugins (lib/plugins; src/plugins.mjs: the edit, the canvas, Motion, and
 * those still being made, with no switch), the skills installed and the plugins someone made (lib/project-sources),
 * and each agent's own skills. The side bar picks the installed ones, the starred, or Discover (OpenFilm's and the
 * community's still to install); chips across the top pick by what a thing brings: a workbench, a skill, a connection
 * (none yet). OpenFilm's own system skills are not lines of their own: each is on the page of the plugin it goes with.
 *
 * Each is a line: its mark, its title, what it is for under it, small badges of what it brings, and its switch (a
 * plugin: on, its workbench or its tab of the library is shown and agents are given its skills; a skill: on, agents
 * take it up when it fits; off, neither, and a film made with it plays and exports the same). A click opens its page:
 * a plugin of OpenFilm's own here (what it does, how to use it, what it brings), any other its skill's (SkillPage).
 * Installed, they are in parts, each headed with its count and folded under its head (kept while Studio is open):
 * OpenFilm's own and those installed from it, the person's own (theirs, and this project's), the community's, then
 * each agent's own under that agent's name (off until let in), then OpenFilm's still being made. The person's own and
 * the community's are there with none too, as an invitation: Import, and Browse community (Discover). Import is beside
 * the search too (LibraryDrawer). Discover is a gallery of tiles to browse: cover, title, what it is for; under the
 * pointer a star and a "+", which names it in the chat's message (its page has Install). A star keeps a skill among the
 * favorites (the side bar's Favorites), as the library's things are. Turning on a plugin with a workbench says where it
 * now is, with the way to show it (`onWorkbenchOn`).
 */
import React from 'react';
import {
  ArrowLeft, AudioLines, ChevronDown, Clapperboard, Compass, Film, FolderDown, FolderOpen, Layers, Palette, Plus, Puzzle, RefreshCw, Scissors, Star, Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost, type HostAgentId } from '@/lib/host';
import { toggleFavorite, useLibraryFavorites } from '@/lib/library';
import { setPluginOn, usePlugins, type Plugin } from '@/lib/plugins';
import { isPlugin, pluginOfSkill } from '@/lib/project-plugins';
import { communityOf, forgetSeenSkills, makerOf, seenCatalog, seenSkills, sourcesApi, SourceError, watchSkills, type SkillEntry } from '@/lib/project-sources';
import {
  BringsBadges, BringsLine, byOrder, CommandChips, HowToUse, inLanguage, PageSection, SkillCover, SkillMark, SkillPage, skillBrings, useSkillWords, type Brings,
} from '../SkillPage';
import { SettingsSwitch } from '../settings/ui';
import { ADD_COLOR, PANEL_ROUND, ROUND } from './AudioList';
import { SourceBadge, SourceChips, sourcesIn, type Source } from './SourceChips';

export const PLUGIN_ICONS: Record<string, LucideIcon> = {
  film: Film, folder: FolderOpen, scissors: Scissors, workflow: Workflow, clapperboard: Clapperboard, audio: AudioLines, palette: Palette, layers: Layers,
};
/** each mark its own color, as the skills' are */
const HUES: Record<string, number> = { film: 28, folder: 212, scissors: 18, workflow: 188, clapperboard: 262, audio: 286, palette: 328, layers: 42 };

/** A plugin as people see it: its title and summary in the language shown, else its id. */
export function usePluginWords() {
  const lang = useLanguage();
  return (plugin: Pick<Plugin, 'id' | 'title' | 'summary'>) => ({ title: inLanguage(plugin.title, lang) ?? plugin.id, summary: inLanguage(plugin.summary, lang) ?? '' });
}

function PluginMark({ plugin, big = false }: { plugin: Plugin; big?: boolean }) {
  const Mark = PLUGIN_ICONS[plugin.icon ?? ''] ?? Puzzle;
  const hue = HUES[plugin.icon ?? ''] ?? 220;
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center ${big ? 'h-12 w-12 rounded-[11px]' : 'h-8 w-8 rounded-[7px]'}`}
      style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `hsl(${hue} 80% 72%)`, boxShadow: `inset 0 0 0 1px hsl(${hue} 70% 60% / 0.28)` }}>
      <Mark size={big ? 22 : 15} strokeWidth={1.7} />
    </span>
  );
}

const Beta = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10.5px] font-medium leading-none text-[var(--text-muted)]">{children}</span>
);

/** What a plugin of OpenFilm's own brings. */
const pluginBrings = (p: Plugin): Brings[] => [
  ...(p.workbench ? ['workbench' as const] : []), ...(p.tab ? ['tab' as const] : []), ...(p.skills.length ? ['skill' as const] : []), ...(p.commands?.length ? ['commands' as const] : []),
];

/** Where a workbench is picked: the edit's views (Motion: laid out in the edit's arrangement, lib/blocks) at the top of its timeline, any other at the top right. */
const pickedOnTimeline = (plugin: Plugin) => plugin.workbench !== 'edit' && plugin.blocks === 'edit';

/** The side bar's lines. */
export type SkillsLine = 'favorites' | 'installed' | 'discover';
/** The chips across the top: all, or what a thing brings. */
export type PluginFilter = 'all' | 'workbench' | 'skill' | 'connection';
const FILTERS: PluginFilter[] = ['all', 'workbench', 'skill', 'connection'];
/** Whether a thing that brings `brings` is among those `filter` picks (a tab of the library is a surface, as a workbench is). */
const picks = (filter: PluginFilter, brings: readonly Brings[]) => filter === 'all' || brings.includes(filter) || (filter === 'workbench' && brings.includes('tab'));

/** A page asked for of one of OpenFilm's own plugins: `plugin:<id>` (anything else names a skill). */
export const PLUGIN_PAGE = 'plugin:';

/** One of Discover's not installed is there only; the person's own and a project's are installed already. */
const installedOf = (skill: SkillEntry) => skill.installed !== false;

/* Discover is read again as it opens, unless it was a minute ago; what it last read shows meanwhile */
const FRESH_MS = 60 * 1000;
/* Discover could not be read when last asked, while Studio is open */
let discoverFailed: 'failed' | 'partial' | null = null;
let discoverRequest = 0;

/** A skill among the library's favorites (lib/library), by its uid. */
const starOf = (skill: SkillEntry) => `skill:${skill.uid}`;

/* the parts folded and the chip picked, kept while Studio is open */
const FOLDED = new Set<string>();
const SHOWN: { filter: PluginFilter } = { filter: 'all' };

/** One of an agent's own skills, and whether OpenFilm lets it in. */
type AgentSkill = { name: string; description: string; allowed: boolean };
type AgentGroup = { id: HostAgentId; name: string; skills: AgentSkill[] };

export function PluginsPane({ line, query, projectId, opened, onOpen, onDiscover, onWorkbenchOn }: {
  line: SkillsLine;
  /** Discover, from the community's invitation */
  onDiscover: () => void;
  query: string;
  projectId: string | null;
  /** the page shown (a skill's uid or the name agents know it by; `plugin:<id>` one of OpenFilm's own plugins), none: the list */
  opened: string | null;
  onOpen: (key: string | null) => void;
  /** a plugin with a workbench was turned on here */
  onWorkbenchOn?: (plugin: Plugin) => void;
}) {
  const t = useT();
  const words = useSkillWords();
  const pluginWords = usePluginWords();
  const own = usePlugins();
  const [skills, setSkills] = React.useState<SkillEntry[]>(() => seenSkills(projectId) ?? []);
  React.useEffect(() => {
    let live = true;
    void sourcesApi.skills(projectId).then((list) => { if (live) setSkills(list); }, () => {});
    const stop = watchSkills(projectId, (list) => { if (live) setSkills(list); });
    return () => { live = false; stop(); };
  }, [projectId]);
  const [filter, setFilterState] = React.useState<PluginFilter>(SHOWN.filter);
  const setFilter = (next: PluginFilter) => { SHOWN.filter = next; setFilterState(next); };
  const [error, setError] = React.useState<string | null>(null);
  /* the plugin's page a skill's page was opened from, which its Back returns to */
  const [from, setFrom] = React.useState<string | null>(null);
  const open = (key: string | null) => { setError(null); setFrom(key && opened?.startsWith(PLUGIN_PAGE) && !key.startsWith(PLUGIN_PAGE) ? opened : null); onOpen(key); };

  /* Discover: what it last read shows at once, and it is read again behind it (Studio reads it as it starts too); before
     anything was ever read, its tiles' places show while it is */
  const [discover, setDiscover] = React.useState<'reading' | 'read' | 'failed' | 'partial'>(() => (seenCatalog() ? discoverFailed ?? 'read' : 'reading'));
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    if (line !== 'discover') return;
    let live = true;
    const request = ++discoverRequest;
    setDiscover(seenCatalog() ? 'read' : 'reading');
    void sourcesApi.readDiscover(retry ? 0 : FRESH_MS).then(
      () => { if (request !== discoverRequest) return; discoverFailed = null; if (live) setDiscover('read'); },
      (e) => { if (request !== discoverRequest) return; discoverFailed = e instanceof SourceError && e.code === 'partial' ? 'partial' : 'failed'; if (live) setDiscover(discoverFailed); },
    );
    return () => { live = false; };
  }, [line, retry]);

  const installed = line === 'installed';
  const favorites = useLibraryFavorites();
  const starred = (skill: SkillEntry) => favorites.includes(starOf(skill));
  const [, refold] = React.useReducer((n: number) => n + 1, 0);
  const fold = (key: string) => { if (FOLDED.has(key)) FOLDED.delete(key); else FOLDED.add(key); refold(); };
  const agents = useAgentSkills(installed);
  const q = query.trim().toLowerCase();
  const matches = (...said: (string | undefined)[]) => !q || said.some((w) => w?.toLowerCase().includes(q));
  const found = skills
    .filter((k) => !k.core)
    .filter((k) => matches(words(k).title, words(k).summary, k.name, k.uid))
    .sort(byOrder);
  const shown = (k: SkillEntry) => picks(filter, skillBrings(k));
  /* OpenFilm's own plugins: those made, and those still being made (no switch) */
  const ownFound = own.filter((p) => matches(pluginWords(p).title, pluginWords(p).summary, p.id) && picks(filter, pluginBrings(p)));
  /* Discover's installed: OpenFilm's own, then the community's (each made by someone else, under their name) */
  const listed = installed ? found.filter((k) => k.source === 'official' && installedOf(k)) : [];
  const official = listed.filter((k) => !communityOf(k));
  const community = listed.filter(communityOf);
  const mine = installed ? found.filter((k) => k.source !== 'official') : [];
  const offered = line === 'discover' ? found.filter((k) => k.source === 'official' && !installedOf(k)) : [];
  /* Discover by whose: OpenFilm's own, the community's, or all (chips only when both are there) */
  const [whose, setWhose] = React.useState<Source | ''>('');
  const sourceOf = (k: SkillEntry): Source => (communityOf(k) ? 'community' : 'official');
  const whoseThere = sourcesIn(offered.map(sourceOf));
  const toInstall = (whose && whoseThere.includes(whose) ? offered.filter((k) => sourceOf(k) === whose) : offered).filter(shown);
  const agentsOwn = filter === 'all' || filter === 'skill' ? agents.groups
    .map((g) => ({ ...g, skills: g.skills.filter((k) => matches(k.name, k.description)) }))
    .filter((g) => g.skills.length) : [];

  /* a plugin with a workbench turned on: where it now is said, with the way to show it */
  const workbenchOn = (plugin: Plugin) => { if (plugin.workbench) onWorkbenchOn?.(plugin); };
  /* one of OpenFilm's own plugins: its skills go on and off with it, so what was last seen of them is let go and read again */
  const turnPlugin = (plugin: Plugin, on: boolean) => {
    setError(null);
    void setPluginOn(plugin.id, on).then(() => {
      if (on) workbenchOn(plugin);
      forgetSeenSkills();
      return sourcesApi.skills(projectId).then(setSkills);
    }).catch((e: unknown) => setError(e instanceof Error && e.message !== 'failed' ? e.message : t('assetDrawer.pluginFailed')));
  };
  /* a skill, or a plugin someone made (turned as the skill it is) */
  const turnSkill = (skill: SkillEntry, on: boolean) => {
    setSkills((list) => list.map((k) => (k.uid === skill.uid ? (on ? { ...k, off: undefined, plugin: undefined } : { ...k, off: true as const }) : k)));
    void sourcesApi.setSkillOn(skill.uid, on).then(() => { if (on && isPlugin(skill)) workbenchOn(pluginOfSkill(skill)); },
      () => { void sourcesApi.skills(projectId).then(setSkills); });
  };
  /* named in the message as agents know it (`as`: another of its name is beside it) */
  const tryIt = (skill: SkillEntry) => studioHost?.useSkill?.({ name: skill.as ?? skill.uid.replace('/', '-'), description: skill.description, title: words(skill).title, newConversation: true });
  /* "+": named in the message being written, in this conversation */
  const addIt = studioHost?.useSkill
    ? (skill: SkillEntry) => studioHost?.useSkill?.({ name: skill.as ?? skill.uid.replace('/', '-'), description: skill.description, title: words(skill).title })
    : undefined;
  const tileOf = (skill: SkillEntry) => (
    <SkillTile key={skill.uid} skill={skill} kept={starred(skill)} onOpen={() => open(skill.uid)} {...(addIt ? { onAdd: () => addIt(skill) } : {})} />
  );
  const chips = (
    <div className="flex shrink-0 flex-wrap gap-1.5 px-3 pb-2" role="group" aria-label={t('assetDrawer.filterLabel')}>
      {FILTERS.map((f) => (
        <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)} data-plugin-filter={f}
          className={`h-6 rounded-full border px-2.5 text-[11px] transition ${filter === f ? 'border-[var(--accent)] text-[var(--accent)]' : 'border-[var(--border-strong)] text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
          {t(`assetDrawer.filter_${f}`)}
        </button>
      ))}
    </div>
  );

  /* a page: one of OpenFilm's own plugins, or a skill asked for by uid or by the name agents know it by (the chat's) */
  const ownPage = opened?.startsWith(PLUGIN_PAGE) ? own.find((p) => p.id === opened.slice(PLUGIN_PAGE.length)) : undefined;
  if (ownPage) {
    return <PluginPage plugin={ownPage} skills={skills} error={error} onBack={() => open(null)} onOpen={open}
      onTurn={ownPage.soon ? undefined : (on) => turnPlugin(ownPage, on)} />;
  }
  const page = opened && !opened.startsWith(PLUGIN_PAGE) ? skills.find((k) => k.uid === opened) ?? skills.find((k) => (k.as ?? k.name) === opened) : undefined;
  if (page) {
    return <SkillPage key={page.uid} skill={page} setSkills={setSkills} projectId={projectId} onBack={() => open(from)}
      onOn={() => { if (isPlugin(page)) workbenchOn(pluginOfSkill(page)); }} {...(studioHost?.useSkill ? { onTry: tryIt } : {})} />;
  }
  /* the connections a plugin brings: none can bring one yet */
  if (filter === 'connection') {
    return <div className="flex min-h-0 flex-1 flex-col">{chips}<Empty text={t('assetDrawer.connectionsEmpty')} /></div>;
  }
  if (line === 'discover') {
    /* what Discover could not read now: the skills it had when it last could, said with when; none ever read */
    const read = seenCatalog();
    const note = discover === 'partial' ? t('assetDrawer.discoverPartial') : discover === 'failed'
      ? (read ? t('assetDrawer.discoverOffline').replace('{when}', new Date(read).toLocaleString()) : t('assetDrawer.discoverNever'))
      : null;
    const anyThere = skills.some((k) => k.source === 'official' && !k.core);
    /* the first read under way: the tiles' places, said as Discover being read */
    const waiting = discover === 'reading' && !toInstall.length && !q;
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {chips}
        {note ? <div role="status" className="flex shrink-0 items-start gap-2 px-3 pb-2 text-[12px] leading-[18px] text-[var(--text-muted)]"><p className="min-w-0 flex-1">{note}</p><button type="button" onClick={() => setRetry((n) => n + 1)} className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 text-[var(--text)] hover:bg-[var(--bg-hover)]"><RefreshCw size={12} />{t('assetDrawer.discoverRetry')}</button></div> : null}
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
        ) : note && !read ? null : <Empty text={t(q ? 'assetDrawer.noSkillsFound' : filter !== 'all' && offered.length ? 'assetDrawer.filterNone' : anyThere ? 'assetDrawer.allSkillsInstalled' : 'assetDrawer.discoverNone')} />}
      </div>
    );
  }
  const lineOf = (skill: SkillEntry) => (
    <PluginLine key={skill.uid} mark={<SkillMark skill={skill} />} title={words(skill).title} brings={skillBrings(skill)}
      under={skill.update ? t('gallery.updateOut').replace('{version}', skill.update.version) : skill.retired ? `${t('gallery.retiredMark')} · ${words(skill).summary}` : words(skill).summary}
      tip={words(skill).summary} on={!skill.off} onOpen={() => open(skill.uid)} kept={starred(skill)} onStar={() => toggleFavorite(starOf(skill))}
      label={t(skill.off ? 'gallery.turnOn' : 'gallery.turnOff').replace('{name}', words(skill).title)} onChange={(on) => turnSkill(skill, on)} />
  );
  const ownLineOf = (p: Plugin) => {
    const { title, summary } = pluginWords(p);
    return (
      <PluginLine key={p.id} mark={<PluginMark plugin={p} />} title={title} beta={p.beta ? t('assetDrawer.pluginBeta') : undefined} brings={pluginBrings(p)}
        under={summary} tip={summary} on={p.soon ? undefined : p.on} onOpen={() => open(`${PLUGIN_PAGE}${p.id}`)}
        label={t(p.on ? 'assetDrawer.pluginTurnOff' : 'assetDrawer.pluginTurnOn').replace('{name}', title)} onChange={(on) => turnPlugin(p, on)} />
    );
  };
  if (line === 'favorites') {
    /* the starred: those installed as lines (their switch), those still to install as Discover's tiles */
    const kept = found.filter(starred).filter(shown);
    const lines = kept.filter(installedOf), tiles = kept.filter((k) => !installedOf(k));
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {chips}
        {!kept.length ? <Empty text={t(q ? 'assetDrawer.noSkillsFound' : 'assetDrawer.noFavorites')} /> : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-[calc(var(--drawer-under,0px)+12px)] pt-0.5">
            {lines.length ? <div>{lines.map(lineOf)}</div> : null}
            {tiles.length ? <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-x-2.5 gap-y-3.5">{tiles.map(tileOf)}</div> : null}
          </div>
        )}
      </div>
    );
  }
  const importSkill = studioHost?.skills?.add;
  /* the invitations are about skills: shown on All and on Skills, not while searching */
  const invite = !q && (filter === 'all' || filter === 'skill');
  const officialSkills = official.filter(shown);
  type Part = { key: string; title: string; lines: React.ReactNode[]; empty?: React.ReactNode };
  const parts = ([
    /* OpenFilm's own plugins, then the skills installed from OpenFilm */
    { key: 'official', title: t('assetDrawer.skillsOfficial'), lines: [...ownFound.filter((p) => !p.soon).map(ownLineOf), ...officialSkills.map(lineOf)] },
    /* the person's own, and the community's: with none, an invitation */
    { key: 'mine', title: t('assetDrawer.skillsMine'), lines: mine.filter(shown).map(lineOf), ...(invite ? {
      empty: <Invitation icon={<FolderDown size={16} strokeWidth={1.75} />} title={t('assetDrawer.mineEmptyTitle')}
        text={t(importSkill ? 'assetDrawer.mineEmpty' : 'assetDrawer.mineEmptyCli')}
        {...(importSkill ? { action: { label: t('assetDrawer.mineImport'), run: importSkill } } : {})} />,
    } : {}) },
    { key: 'community', title: t('assetDrawer.skillsCommunity'), lines: community.filter(shown).map(lineOf), ...(!invite || official.length ? {} : {
      empty: <Invitation icon={<Compass size={16} strokeWidth={1.75} />} title={t('assetDrawer.communityEmptyTitle')}
        text={t('assetDrawer.communityEmpty')} action={{ label: t('assetDrawer.communityBrowse'), run: onDiscover }} />,
    }) },
    /* each agent's own under its name: whose they are */
    ...agentsOwn.map((g) => ({
      key: g.id, title: t('assetDrawer.skillsAgentOwn').replace('{name}', g.name),
      lines: g.skills.map((k) => <PluginLine key={k.name} mark={<SkillMark skill={{}} />} title={k.name} under={k.description} tip={k.description} on={k.allowed} brings={['skill']}
        label={t(k.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', k.name)} onChange={(on) => agents.allow(g.id, k.name, on)} />),
    })),
    /* OpenFilm's still being made, so the whole of it is in sight */
    { key: 'soon', title: t('assetDrawer.pluginsSoon'), lines: ownFound.filter((p) => p.soon).map(ownLineOf) },
  ] as Part[]).filter((p) => p.lines.length || p.empty);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {chips}
      {error ? <p role="alert" className="px-4 pb-2 text-[12px] text-[var(--warn)]">{error}</p> : null}
      {!parts.length ? <Empty text={t(q ? 'assetDrawer.noSkillsFound' : 'assetDrawer.filterNone')} /> : (
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-[calc(var(--drawer-under,0px)+12px)] pt-0.5">
          {parts.map((p) => {
            const folded = FOLDED.has(p.key) && !q;
            return (
              <section key={p.key} data-plugins-part={p.key}>
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
      )}
    </div>
  );
}

/**
 * One of OpenFilm's own plugins on its page: its mark, title and switch; what it does; how to use it; what it brings
 * (its workbench or its tab of the library, the skills it teaches an agent with what each is for, each opening its own
 * page, and its commands); and that it is part of OpenFilm (it ships with it: nothing to allow, nothing to remove).
 */
function PluginPage({ plugin, skills, error, onBack, onOpen, onTurn }: {
  plugin: Plugin; skills: readonly SkillEntry[]; error: string | null; onBack: () => void; onOpen: (key: string) => void;
  /** its switch (none: not made yet) */
  onTurn?: ((on: boolean) => void) | undefined;
}) {
  const t = useT();
  const lang = useLanguage();
  const { title, summary } = usePluginWords()(plugin);
  const skillWords = useSkillWords();
  const taught = plugin.skills.map((name) => skills.find((k) => k.core && k.name === name)).filter((k): k is SkillEntry => k != null);
  const how = plugin.workbench ? (pickedOnTimeline(plugin) ? 'assetDrawer.howTimeline' : 'assetDrawer.howWorkbench') : plugin.tab ? 'assetDrawer.howTab' : null;
  return (
    <>
      <div className="flex shrink-0 px-3 pb-2 pt-2.5">
        <button type="button" onClick={onBack} className="-ml-1 flex h-8 items-center gap-1.5 rounded-md pl-1.5 pr-2.5 text-[12.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <ArrowLeft size={14} />{t('gallery.back')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[calc(var(--drawer-under,0px)+16px)] pt-0.5" data-plugin-page={plugin.id}>
        <div className="flex items-center gap-3">
          <PluginMark plugin={plugin} big />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h2 className="min-w-0 truncate text-[17px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{title}</h2>
            {plugin.beta ? <Beta>{t('assetDrawer.pluginBeta')}</Beta> : null}
          </div>
          {onTurn ? <SettingsSwitch checked={plugin.on} onChange={onTurn}
            label={t(plugin.on ? 'assetDrawer.pluginTurnOff' : 'assetDrawer.pluginTurnOn').replace('{name}', title)} /> : null}
        </div>
        <p className="mt-3 text-[12.5px] leading-[19px] text-[var(--text)]">{summary}</p>
        <p className="mt-2 text-[12px] leading-[18px] text-[var(--text-muted)]">{t(plugin.soon ? 'assetDrawer.pluginSoonNote' : 'assetDrawer.pluginOffNote')}</p>
        {error ? <p role="alert" className="mt-2 text-[12px] text-[var(--warn)]">{error}</p> : null}
        {how && !plugin.soon ? <HowToUse text={t(how)} /> : null}
        {plugin.workbench || plugin.tab || taught.length || plugin.commands?.length ? (
          <PageSection title={t('assetDrawer.pluginBrings')}>
            {plugin.workbench ? <BringsLine kind={t('assetDrawer.brings_workbench')}>{title}</BringsLine> : null}
            {plugin.tab ? <BringsLine kind={t('assetDrawer.brings_tab')}>{inLanguage(plugin.tab.title, lang) ?? title}</BringsLine> : null}
            {/* the skills it teaches an agent, each opening its own page */}
            {taught.length ? (
              <BringsLine kind={t('assetDrawer.brings_skill')}>
                {taught.map((k) => (
                  <div key={k.uid} role="button" tabIndex={0} onClick={() => onOpen(k.uid)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(k.uid); }}
                    className="-mx-1 flex cursor-pointer items-center gap-2.5 rounded-[8px] px-1 py-1 outline-none hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]">
                    <span className={k.off ? 'opacity-50' : ''}><SkillMark skill={k} /></span>
                    <div className="min-w-0 flex-1">
                      <div className={`truncate text-[12.5px] font-medium leading-[17px] ${k.off ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{skillWords(k).title}</div>
                      <div className="line-clamp-2 text-[11px] leading-[15px] text-[var(--text-faint)]">{k.description}</div>
                    </div>
                  </div>
                ))}
              </BringsLine>
            ) : null}
            {plugin.commands?.length ? <BringsLine kind={t('assetDrawer.brings_commands')}><CommandChips name={plugin.id} commands={plugin.commands} /></BringsLine> : null}
          </PageSection>
        ) : null}
        {/* it ships with OpenFilm: its source is OpenFilm's, it is turned off rather than removed */}
        <div className="mt-5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[var(--text-muted)]">
          <span className="shrink-0">{t('assetDrawer.pluginPart')}</span>
          <span className="min-w-0 truncate font-mono text-[11px] text-[var(--text-faint)]">openfilm/{plugin.id}</span>
        </div>
      </div>
    </>
  );
}

/** A part with none yet: what it is for and the one thing to do, in a dashed frame where its lines would be. */
function Invitation({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: { label: string; run: () => void } }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed border-[var(--border-strong)] px-3 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-field)] text-[var(--text-muted)]">{icon}</span>
      <div className="min-w-[150px] flex-1">
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
 * A plugin or a skill: its mark, its title (and Beta) with badges of what it brings, what is under it, its star (under
 * the pointer, or kept) and its switch (none: one not made yet); a click opens its page (an agent's own has neither
 * page nor star).
 */
function PluginLine({ mark, title, beta, brings, under, tip, on, label, onChange, onOpen, kept = false, onStar }: {
  mark: React.ReactNode; title: string; beta?: string | undefined; brings: readonly Brings[]; under: string; tip?: string; on: boolean | undefined; label: string;
  onChange: (on: boolean) => void; onOpen?: () => void; kept?: boolean; onStar?: () => void;
}) {
  const t = useT();
  const lit = on !== false;
  return (
    <div role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} title={tip} data-plugin-line={title}
      onClick={onOpen} onKeyDown={(e) => { if (onOpen && e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}
      className={`group flex items-center gap-2.5 rounded-[8px] px-1 py-1.5 outline-none ${onOpen ? 'cursor-pointer hover:bg-[var(--bg-hover)] focus-visible:ring-1 focus-visible:ring-[var(--accent)]' : ''}`}>
      <span className={lit && on !== undefined ? '' : 'opacity-50'}>{mark}</span>
      {/* what it brings before what it is for, their words shown where the list is wide enough */}
      <div className="@container min-w-0 flex-1">
        <div className={`flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium leading-[17px] ${lit && on !== undefined ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
          <span className="truncate">{title}</span>{beta ? <Beta>{beta}</Beta> : null}
        </div>
        <div className="flex min-w-0 items-center gap-1 text-[11px] leading-[15px] text-[var(--text-faint)]">
          <BringsBadges brings={brings} /><span className="min-w-0 truncate">{under}</span>
        </div>
      </div>
      {onStar ? (
        <button type="button" aria-label={t(kept ? 'assetDrawer.unstar' : 'assetDrawer.star')} aria-pressed={kept}
          onClick={(e) => { e.stopPropagation(); onStar(); }}
          className={`${PANEL_ROUND} ${kept ? 'grid text-[#ffd35a]' : 'hidden text-[var(--text)] group-hover:grid'}`}>
          <Star size={11} fill={kept ? 'currentColor' : 'none'} strokeWidth={kept ? 0 : 2.2} />
        </button>
      ) : null}
      {/* the switch is its own: a press there does not open the page */}
      {on === undefined ? null : <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}><SettingsSwitch checked={on} onChange={onChange} label={label} /></span>}
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
              className={`${ROUND} ${ADD_COLOR} hidden group-hover:grid focus-visible:grid`}>
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
