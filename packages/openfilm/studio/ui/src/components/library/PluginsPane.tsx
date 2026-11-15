/**
 * The plugins (in their own window, components/PluginsWindow): everything that teaches OpenFilm one more kind of work.
 * A plugin is a package (skills, commands, a surface); one that shows only in the conversation is a skill, one that
 * also shows outside it is a plugin (lib/project-plugins isPlugin). People look for what OpenFilm can do, not for which
 * of the two it is, so both are here, each in the one category of what it helps make (lib/plugin-profile).
 *
 * The page of the plugins' window, read as a page of Settings: rows under titled groups, in the order a film is made
 * (all categories, or the one picked on the side). A row is its mark, its title, what it is for, and its switch (a
 * plugin: on, its workbench or its tab of the library is shown and agents are given its skills; a skill: on, agents
 * take it up when it fits; off, neither, and a film made with it plays and exports the same). Where one comes from,
 * when it is not OpenFilm's own, is a word after its title; OpenFilm's still being made are last in their category, with
 * no switch. A click opens its page, which sums it up at the top as a model's page does (library/PluginProfile), then
 * says what it does, where to open it and what it brings: a plugin of OpenFilm's own here, any other its skill's
 * (SkillPage). Discover lists everything there is to install, OpenFilm's and then the community's, each with Install,
 * or said installed once it is (it stays there). Turning on a plugin with a workbench says where it now is, with the
 * way to show it (`onWorkbenchOn`).
 */
import React from 'react';
import {
  ArrowLeft, ArrowUpRight, AudioLines, Box, Check, ChevronRight, Clapperboard, Cloud, Film, FolderOpen, Images, Languages, Layers, Loader2, Megaphone, Mic,
  Music, Music2, Palette, Projector, Puzzle, RefreshCw, Scissors, Send, Spline, Workflow, type LucideIcon,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost, type HostAgentId } from '@/lib/host';
import { setPluginOn, usePlugins, type Plugin } from '@/lib/plugins';
import { showPluginsLine, type PluginsLine } from '@/lib/plugins-window';
import { isPlugin, pluginOfSkill } from '@/lib/project-plugins';
import { communityOf, forgetSeenSkills, makerOf, seenCatalog, seenSkills, sourcesApi, SourceError, watchSkills, type SkillEntry } from '@/lib/project-sources';
import {
  BringsLine, byOrder, CommandChips, ForDevelopers, HowToUse, inLanguage, PageSection, SkillCover, SkillMark, SkillPage, useSkillWords,
} from '../SkillPage';
import { CATEGORIES, categoryOfPlugin, categoryOfSkill, usesOfPlugin, type Category } from '@/lib/plugin-profile';
import { ProfileStrip } from './PluginProfile';
import { SettingsButton, SettingsGroup, SettingsSwitch } from '../settings/ui';
import { LARGE_DIALOG_COLUMN as PAGE_INSET } from '../dialog-chrome';
import { KIND_ICONS, type FeatureKind } from '../feature-kinds';

export const PLUGIN_ICONS: Record<string, LucideIcon> = {
  film: Film, folder: FolderOpen, scissors: Scissors, workflow: Workflow, clapperboard: Clapperboard, audio: AudioLines, palette: Palette, layers: Layers,
  projector: Projector, spline: Spline, box: Box,
};
/** each mark its own color, as the skills' are */
const HUES: Record<string, number> = { film: 28, folder: 212, scissors: 18, workflow: 188, clapperboard: 262, audio: 286, palette: 328, layers: 42, projector: 262, spline: 150, box: 222 };

/** A plugin as people see it: its title and summary in the language shown, else its id. */
export function usePluginWords() {
  const lang = useLanguage();
  return (plugin: Pick<Plugin, 'id' | 'title' | 'summary'>) => ({ title: inLanguage(plugin.title, lang) ?? plugin.id, summary: inLanguage(plugin.summary, lang) ?? '' });
}

function PluginMark({ plugin, big = false }: { plugin: Plugin; big?: boolean }) {
  const Mark = PLUGIN_ICONS[plugin.icon ?? ''] ?? Puzzle;
  const hue = HUES[plugin.icon ?? ''] ?? 220;
  return (
    <span aria-hidden className={`flex shrink-0 items-center justify-center ${big ? 'h-12 w-12 rounded-[12px]' : 'h-9 w-9 rounded-[9px]'}`}
      style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `light-dark(hsl(${hue} 62% 40%), hsl(${hue} 80% 72%))`, boxShadow: `inset 0 0 0 1px hsl(${hue} 70% 60% / 0.28)` }}>
      <Mark size={big ? 22 : 17} strokeWidth={1.7} />
    </span>
  );
}

const Beta = ({ children }: { children: React.ReactNode }) => (
  <span className="shrink-0 rounded bg-[var(--bg-hover)] px-1.5 py-0.5 text-[10.5px] font-medium leading-none text-[var(--text-muted)]">{children}</span>
);

/** Where a workbench is picked: the edit's views (Motion: laid out in the edit's arrangement, lib/blocks) at the top of its timeline, any other at the top right. */
const pickedOnTimeline = (plugin: Plugin) => plugin.workbench !== 'edit' && plugin.blocks === 'edit';

/** A page asked for of one of OpenFilm's own plugins: `plugin:<id>` (anything else names a skill). */
export const PLUGIN_PAGE = 'plugin:';

/** One of Discover's not installed is there only; the person's own and a project's are installed already. */
const installedOf = (skill: SkillEntry) => skill.installed !== false;

/* Discover is read again as it opens, unless it was a minute ago; what it last read shows meanwhile */
const FRESH_MS = 60 * 1000;
/* Discover could not be read when last asked, while Studio is open */
let discoverFailed: 'failed' | 'partial' | null = null;
let discoverRequest = 0;

/** One of an agent's own skills, and whether OpenFilm lets it in. */
type AgentSkill = { name: string; description: string; allowed: boolean };
type AgentGroup = { id: HostAgentId; name: string; skills: AgentSkill[] };
/** An agent's connectors (its own MCP servers): `filtered` false, it cannot be told, and has them all. */
type McpGroup = { id: HostAgentId; name: string; filtered: boolean; servers: Array<{ name: string; detail: string; allowed: boolean }> };

export function PluginsPane({ line, query, projectId, opened, onOpen, onWorkbenchOn }: {
  line: PluginsLine;
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
  const [error, setError] = React.useState<string | null>(null);
  /* the plugin's page a skill's page was opened from, which its Back returns to */
  const [from, setFrom] = React.useState<string | null>(null);
  const open = (key: string | null) => { setError(null); setFrom(key && opened?.startsWith(PLUGIN_PAGE) && !key.startsWith(PLUGIN_PAGE) ? opened : null); onOpen(key); };

  /* Discover: what it last read shows at once, and it is read again behind it (Studio reads it as it starts too); before
     anything was ever read, its tiles' places show while it is */
  const [discover, setDiscover] = React.useState<'reading' | 'read' | 'failed' | 'partial'>(() => (seenCatalog() ? discoverFailed ?? 'read' : 'reading'));
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    if (!line.startsWith('discover')) return;
    let live = true;
    const request = ++discoverRequest;
    setDiscover(seenCatalog() ? 'read' : 'reading');
    void sourcesApi.readDiscover(retry ? 0 : FRESH_MS).then(
      () => { if (request !== discoverRequest) return; discoverFailed = null; if (live) setDiscover('read'); },
      (e) => { if (request !== discoverRequest) return; discoverFailed = e instanceof SourceError && e.code === 'partial' ? 'partial' : 'failed'; if (live) setDiscover(discoverFailed); },
    );
    return () => { live = false; };
  }, [line, retry]);

  const agents = useAgentExtras(line === 'skills' || line === 'connectors');
  const q = query.trim().toLowerCase();
  const matches = (...said: (string | undefined)[]) => !q || said.some((w) => w?.toLowerCase().includes(q));
  const found = skills
    .filter((k) => !k.core)
    .filter((k) => matches(words(k).title, words(k).summary, k.name, k.uid))
    .sort(byOrder);
  const ownMatched = own.filter((p) => matches(pluginWords(p).title, pluginWords(p).summary, p.id));
  const listed = found.filter((k) => installedOf(k));
  const offered = found.filter((k) => k.source === 'official');
  const agentsOwn = agents.groups
    .map((g) => ({ ...g, skills: g.skills.filter((k) => matches(k.name, k.description)) }))
    .filter((g) => g.skills.length);

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
  /* installed from Discover's list, as its page installs it: it stays there, said installed */
  const [installing, setInstalling] = React.useState<string | null>(null);
  const install = (skill: SkillEntry) => {
    setInstalling(skill.uid);
    setError(null);
    void sourcesApi.setSkillInstalled(skill.uid, true).then(
      () => sourcesApi.skills(projectId).then(setSkills),
      (e: unknown) => setError(t('gallery.installFailed').replace('{why}', e instanceof Error ? e.message : String(e))),
    ).finally(() => setInstalling(null));
  };

  /* a page: one of OpenFilm's own plugins, or a skill asked for by uid or by the name agents know it by (the chat's) */
  const ownPage = opened?.startsWith(PLUGIN_PAGE) ? own.find((p) => p.id === opened.slice(PLUGIN_PAGE.length)) : undefined;
  if (ownPage) {
    return <PluginPage plugin={ownPage} skills={skills} error={error} onBack={() => open(null)} onOpen={open}
      onTurn={ownPage.soon ? undefined : (on) => turnPlugin(ownPage, on)} />;
  }
  const page = opened && !opened.startsWith(PLUGIN_PAGE) ? skills.find((k) => k.uid === opened) ?? skills.find((k) => (k.as ?? k.name) === opened) : undefined;
  if (page) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <SkillPage key={page.uid} skill={page} setSkills={setSkills} projectId={projectId} onBack={() => open(from)}
          onOn={() => { if (isPlugin(page)) workbenchOn(pluginOfSkill(page)); }} {...(studioHost?.useSkill ? { onTry: tryIt } : {})} />
      </div>
    );
  }
  /* in the film's order (the category each says it is in), else as they were */
  const inOrder = <T,>(list: T[], categoryOf: (item: T) => Category) => list
    .map((item, i) => ({ item, i, c: CATEGORIES.indexOf(categoryOf(item)) })).sort((x, y) => x.c - y.c || x.i - y.i).map((x) => x.item);
  /* a workbench, on its switch */
  const workbenchRow = (p: Plugin) => {
    const { title, summary } = pluginWords(p);
    return <PluginRow key={p.id} mark={<PluginMark plugin={p} />} title={title} note={p.beta ? t('assetDrawer.pluginBeta') : undefined} summary={summary}
      onOpen={() => open(`${PLUGIN_PAGE}${p.id}`)}
      control={<SettingsSwitch checked={p.on} onChange={(on) => turnPlugin(p, on)} label={t(p.on ? 'assetDrawer.pluginTurnOff' : 'assetDrawer.pluginTurnOn').replace('{name}', title)} />} />;
  };
  /* a skill installed (or a workbench someone made, turned as the skill it is), on its switch */
  const fromOf = (skill: SkillEntry) => (communityOf(skill) ? makerOf(skill)
    : skill.source === 'mine' ? t('assetDrawer.source_mine') : skill.source === 'project' ? t('assetDrawer.skillProject') : undefined);
  const skillRow = (k: SkillEntry) => (
    <PluginRow key={k.uid} mark={<SkillMark skill={k} />} title={words(k).title} note={fromOf(k)}
      summary={k.update ? t('gallery.updateOut').replace('{version}', k.update.version) : words(k).summary} onOpen={() => open(k.uid)}
      control={<SettingsSwitch checked={!k.off} onChange={(on) => turnSkill(k, on)} label={t(k.off ? 'gallery.turnOn' : 'gallery.turnOff').replace('{name}', words(k).title)} />} />
  );
  /* a workbench is what shows outside the conversation: OpenFilm's with a workbench or a tab of the library, anyone's with a page */
  const ownBench = (p: Plugin) => Boolean(p.workbench || p.tab);

  if (line === 'workbenches') {
    const benches = inOrder(ownMatched.filter((p) => ownBench(p) && !p.soon), categoryOfPlugin);
    const theirs = listed.filter((k) => isPlugin(k));
    /* OpenFilm's still being made (each a workbench to be, none declared yet) */
    const soon = inOrder(ownMatched.filter((p) => p.soon), categoryOfPlugin);
    return (
      <PluginsPage title={t('assetDrawer.view_workbenches')} note={t('assetDrawer.note_workbenches')}>
        {error ? <p role="alert" className="mb-4 text-[13.5px] text-[var(--warn)]">{error}</p> : null}
        {benches.length || theirs.length ? <SettingsGroup>{benches.map(workbenchRow)}{theirs.map(skillRow)}</SettingsGroup> : null}
        {/* OpenFilm's still being made, so the whole of it is in sight: no switch */}
        {soon.length ? (
          <SettingsGroup title={t('assetDrawer.comingSoon')}>
            {soon.map((p) => {
              const { title, summary } = pluginWords(p);
              return <PluginRow key={p.id} dim mark={<PluginMark plugin={p} />} title={title} summary={summary} onOpen={() => open(`${PLUGIN_PAGE}${p.id}`)} control={null} />;
            })}
          </SettingsGroup>
        ) : null}
        {!benches.length && !theirs.length && !soon.length ? <Empty text={t('assetDrawer.noSkillsFound')} /> : null}
      </PluginsPage>
    );
  }

  if (line === 'skills') {
    const mine = inOrder(listed.filter((k) => !isPlugin(k)), categoryOfSkill);
    /* OpenFilm's own plugins with no surface: theirs is a skill too */
    const ownSkills = ownMatched.filter((p) => !ownBench(p) && !p.soon);
    return (
      <PluginsPage title={t('assetDrawer.view_skills')} note={t('assetDrawer.note_skills')}>
        {mine.length || ownSkills.length ? <SettingsGroup>{ownSkills.map(workbenchRow)}{mine.map(skillRow)}</SettingsGroup>
          : <Empty text={t(q ? 'assetDrawer.noSkillsFound' : 'assetDrawer.noSkillsYet')} action={q ? undefined : { label: t('assetDrawer.view_discover'), run: () => showPluginsLine('discover') }} />}
        {/* each agent's own, off here until let in */}
        {agentsOwn.map((g) => (
          <SettingsGroup key={g.id} title={t('assetDrawer.skillsAgentOwn').replace('{name}', g.name)} footnote={t('assetDrawer.agentOwnNote').replace('{name}', g.name)}>
            {g.skills.map((k) => (
              <PluginRow key={k.name} mark={<SkillMark skill={{}} />} title={k.name} summary={k.description}
                control={<SettingsSwitch checked={k.allowed} onChange={(on) => agents.allow(g.id, k.name, on)} label={t(k.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', k.name)} />} />
            ))}
          </SettingsGroup>
        ))}
      </PluginsPage>
    );
  }

  if (line === 'connectors') {
    const groups = agents.mcp.map((g) => ({ ...g, servers: g.servers.filter((k) => matches(k.name, k.detail)) })).filter((g) => g.servers.length);
    return (
      <PluginsPage title={t('assetDrawer.view_connectors')} note={t('assetDrawer.note_connectors')}>
        {groups.length ? groups.map((g) => (
          <SettingsGroup key={g.id} title={t('assetDrawer.connectorsOf').replace('{name}', g.name)}
            footnote={g.filtered ? undefined : t('assetDrawer.connectorsAll').replace('{name}', g.name)}>
            {g.servers.map((k) => (
              <PluginRow key={k.name} mark={<KindMark kind="connectors" />} title={k.name} summary={k.detail}
                control={g.filtered ? <SettingsSwitch checked={k.allowed} onChange={(on) => agents.allowMcp(g.id, k.name, on)} label={t(k.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', k.name)} /> : null} />
            ))}
          </SettingsGroup>
        )) : <Empty text={t(q ? 'assetDrawer.noSkillsFound' : 'assetDrawer.noConnectorsYet')} action={q ? undefined : { label: t('assetDrawer.seeConnectors'), run: () => showPluginsLine('discover:connectors') }} />}
      </PluginsPage>
    );
  }

  /* Discover: what there is to add, as cards. OpenFilm's workbenches are here too, to turn on; what is installed or on
     stays, said so; what is still being made is shown as it will be, without a button (soon.ts) */
  const read = seenCatalog();
  const note = discover === 'partial' ? t('assetDrawer.discoverPartial') : discover === 'failed'
    ? (read ? t('assetDrawer.discoverOffline').replace('{when}', new Date(read).toLocaleString()) : t('assetDrawer.discoverNever'))
    : null;
  const waiting = discover === 'reading' && !offered.length && !q;
  const doneMark = (word: string) => <span className="inline-flex h-8 items-center gap-1.5 text-[13.5px] text-[var(--text-muted)]"><Check size={15} aria-hidden />{word}</span>;
  const benchCard = (p: Plugin): StoreItem => {
    const { title, summary } = pluginWords(p);
    return {
      key: p.id, kind: 'workbenches', title, summary, note: p.beta ? t('assetDrawer.pluginBeta') : t('assetDrawer.skillsOfficial'),
      cover: <GradientCover hue={HUES[p.icon ?? ''] ?? 220} Icon={PLUGIN_ICONS[p.icon ?? ''] ?? Puzzle} />, onOpen: () => open(`${PLUGIN_PAGE}${p.id}`),
      action: p.soon ? <SoonMark /> : p.on ? doneMark(t('assetDrawer.turnedOn')) : <SettingsButton onClick={() => turnPlugin(p, true)}>{t('assetDrawer.turnOnAction')}</SettingsButton>,
    };
  };
  const skillCard = (k: SkillEntry): StoreItem => ({
    key: k.uid, kind: isPlugin(k) ? 'workbenches' : 'skills', title: words(k).title, summary: words(k).summary,
    note: communityOf(k) ? makerOf(k) : t('assetDrawer.skillsOfficial'), cover: <SkillCover skill={k} title={words(k).title} />, onOpen: () => open(k.uid),
    action: installedOf(k) ? doneMark(t('assetDrawer.installedMark')) : (
      <SettingsButton disabled={installing != null} onClick={() => install(k)}>
        {installing === k.uid ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{t(installing === k.uid ? 'gallery.installing' : 'gallery.install')}
      </SettingsButton>
    ),
  });
  const soonCards = SOON.filter((x) => matches(t(`assetDrawer.soon_${x.id}`), t(`assetDrawer.soon_${x.id}Note`))).map((x): StoreItem => ({
    key: `soon:${x.id}`, kind: x.kind, title: t(`assetDrawer.soon_${x.id}`), summary: t(`assetDrawer.soon_${x.id}Note`), note: t('assetDrawer.skillsOfficial'),
    cover: <GradientCover hue={x.hue} Icon={x.icon} />, action: <SoonMark />,
  }));
  const official = offered.filter((k) => !communityOf(k));
  const store: Record<'workbenches' | 'skills' | 'connectors' | 'community', StoreItem[]> = {
    workbenches: [
      ...inOrder(ownMatched.filter((p) => ownBench(p) && !p.soon), categoryOfPlugin).map(benchCard),
      ...official.filter((k) => isPlugin(k)).map(skillCard),
      ...inOrder(ownMatched.filter((p) => p.soon), categoryOfPlugin).map(benchCard),
      ...soonCards.filter((x) => x.kind === 'workbenches'),
    ],
    skills: [...official.filter((k) => !isPlugin(k)).map(skillCard), ...soonCards.filter((x) => x.kind === 'skills')],
    connectors: soonCards.filter((x) => x.kind === 'connectors'),
    community: offered.filter((k) => communityOf(k)).map(skillCard),
  };
  const status = (
    <>
      {note ? (
        <div role="status" className="mb-6 flex items-start gap-3 text-[14px] leading-relaxed text-[var(--text-muted)]">
          <p className="min-w-0 flex-1">{note}</p>
          <SettingsButton onClick={() => setRetry((n) => n + 1)}><RefreshCw size={14} />{t('assetDrawer.discoverRetry')}</SettingsButton>
        </div>
      ) : null}
      {error ? <p role="alert" className="mb-4 text-[13.5px] text-[var(--warn)]">{error}</p> : null}
    </>
  );
  const communityEmpty = (
    <div className="flex flex-col items-start gap-3 rounded-[12px] border border-dashed border-[var(--border-strong)] p-5">
      <p className="text-[14.5px] leading-relaxed text-[var(--text-muted)]">{t('assetDrawer.communityEmpty')}</p>
      <a href={MAKE_GUIDE} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--border)] px-3.5 text-[14px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)]">
        {t('assetDrawer.communityHow')}<ArrowUpRight size={14} aria-hidden />
      </a>
    </div>
  );

  if (line === 'discover') {
    /* the one shown big: OpenFilm's newest skill with a moving preview, else its newest workbench */
    const hero = official.find((k) => k.preview && !isPlugin(k)) ?? official.find((k) => k.cover);
    const heroItem = hero ? skillCard(hero) : store.workbenches[0];
    return (
      <PluginsPage title={t('assetDrawer.discover_featured')} note={t('assetDrawer.note_featured')}>
        {status}
        {heroItem && !q ? <Hero item={heroItem} preview={hero?.preview} label={t('assetDrawer.discover_featured')} /> : null}
        {(['workbenches', 'skills', 'connectors'] as const).map((kind) => store[kind].length ? (
          <StoreShelf key={kind} title={t(`assetDrawer.view_${kind}`)} more={t('assetDrawer.seeAll')} onMore={() => showPluginsLine(`discover:${kind}`)}>
            {store[kind].slice(0, 3).map((item) => <StoreCard key={item.key} item={item} />)}
          </StoreShelf>
        ) : null)}
        <StoreShelf title={t('assetDrawer.discover_community')} more={t('assetDrawer.seeAll')} onMore={() => showPluginsLine('discover:community')} empty={communityEmpty}>
          {store.community.slice(0, 3).map((item) => <StoreCard key={item.key} item={item} />)}
        </StoreShelf>
      </PluginsPage>
    );
  }

  const kind = line.slice('discover:'.length) as 'workbenches' | 'skills' | 'connectors' | 'community';
  const items = store[kind];
  return (
    <PluginsPage title={t(kind === 'community' ? 'assetDrawer.discover_community' : `assetDrawer.view_${kind}`)} note={t(`assetDrawer.note_discover_${kind}`)}>
      {status}
      {waiting ? (
        <div role="status" aria-label={t('assetDrawer.discoverReading')} className={STORE_GRID}>
          {Array.from({ length: 6 }, (_, i) => <div key={i} aria-hidden className="skeleton aspect-[4/3] rounded-[12px]" />)}
        </div>
      ) : items.length ? <div className={STORE_GRID}>{items.map((item) => <StoreCard key={item.key} item={item} />)}</div>
        : kind === 'community' && !q ? communityEmpty
        : note && !read ? null : <Empty text={t(q ? 'assetDrawer.noSkillsFound' : 'assetDrawer.discoverNone')} />}
    </PluginsPage>
  );
}

/**
 * One of OpenFilm's own plugins on its page: its mark, title, category and switch; what it is for; its profile at the
 * top, as a model's page sums a model up (library/PluginProfile); what it does, in a few lines; how to use it; what it
 * brings (its workbench or its tab of the library, the skills it teaches an agent with what each is for, each opening
 * its own page, and its commands); and that it is part of OpenFilm (it ships with it: nothing to allow, nothing to remove).
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
  const details = inLanguage(plugin.details, lang);
  const taught = plugin.skills.map((name) => skills.find((k) => k.core && k.name === name)).filter((k): k is SkillEntry => k != null);
  const how = plugin.workbench ? (pickedOnTimeline(plugin) ? 'assetDrawer.howTimeline' : 'assetDrawer.howWorkbench') : plugin.tab ? 'assetDrawer.howTab' : null;
  return (
    <>
      <div className={`flex shrink-0 ${PAGE_INSET} pb-2 pt-6`}>
        <button type="button" onClick={onBack} className="-ml-1 flex h-8 items-center gap-1.5 rounded-md pl-1.5 pr-2.5 text-[14px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <ArrowLeft size={14} />{t('gallery.back')}
        </button>
      </div>
      <div className={`min-h-0 flex-1 overflow-y-auto ${PAGE_INSET} pb-12 pt-0.5`} data-plugin-page={plugin.id}>
        <div className="flex items-start gap-3">
          <PluginMark plugin={plugin} big />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="min-w-0 truncate text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{title}</h2>
              {plugin.beta ? <Beta>{t('assetDrawer.pluginBeta')}</Beta> : null}
              {plugin.soon ? <Beta>{t('assetDrawer.pluginsSoon')}</Beta> : null}
            </div>
            <div className="mt-1.5 flex min-w-0 items-center gap-2 text-[13px] text-[var(--text-faint)]">
              <span className="truncate">{t(plugin.workbench || plugin.tab ? 'assetDrawer.kind_workbench' : 'assetDrawer.kind_skill')} · {t('assetDrawer.skillsOfficial')}</span>
            </div>
          </div>
          {onTurn ? <SettingsSwitch checked={plugin.on} onChange={onTurn}
            label={t(plugin.on ? 'assetDrawer.pluginTurnOff' : 'assetDrawer.pluginTurnOn').replace('{name}', title)} /> : null}
        </div>
        <p className="mt-3.5 text-[15px] leading-[21px] text-[var(--text)]">{summary}</p>
        {error ? <p role="alert" className="mt-2 text-[13.5px] text-[var(--warn)]">{error}</p> : null}
        <ProfileStrip profile={plugin.profile} uses={usesOfPlugin(plugin)} />
        {/* what it does, each line's lead a shade brighter, to find at a glance */}
        {details ? (
          <div className="mt-4">
            {details.split('\n').map((text) => {
              const lead = /^(.{1,24}?[：:])\s*(.+)$/.exec(text);
              return (
                <p key={text} className="mt-2 text-[14px] leading-[20px] text-[var(--text-muted)]">
                  {lead ? <><span className="font-medium text-[var(--text)]">{lead[1]}</span> {lead[2]}</> : text}
                </p>
              );
            })}
          </div>
        ) : null}
        {how && !plugin.soon ? <HowToUse where text={t(how)} /> : null}
        {/* it ships with OpenFilm: it is turned off rather than removed */}
        <p className="mt-5 text-[14px] leading-[20px] text-[var(--text-muted)]">{t(plugin.soon ? 'assetDrawer.pluginSoonNote' : 'assetDrawer.pluginOffNote')}</p>
        {/* what it is made of, for whoever makes such things: folded */}
        <ForDevelopers>
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
                      <div className={`truncate text-[14px] font-medium leading-[17px] ${k.off ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{skillWords(k).title}</div>
                      <div className="line-clamp-2 text-[12px] leading-[15px] text-[var(--text-faint)]">{k.description}</div>
                    </div>
                  </div>
                ))}
              </BringsLine>
            ) : null}
            {plugin.commands?.length ? <BringsLine kind={t('assetDrawer.brings_commands')}><CommandChips name={plugin.id} commands={plugin.commands} /></BringsLine> : null}
          </PageSection>
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13.5px] text-[var(--text-muted)]">
            <span className="shrink-0">{t('assetDrawer.pluginPart')}</span>
            <span className="min-w-0 truncate font-mono text-[12px] text-[var(--text-faint)]">openfilm/{plugin.id}</span>
          </div>
        </ForDevelopers>
      </div>
    </>
  );
}

/** Nothing to list: a word under the title, and where to go instead. */
function Empty({ text, action }: { text: string; action?: { label: string; run: () => void } | undefined }) {
  return (
    <div className="flex flex-col items-start gap-3 pt-2">
      <p className="text-[14.5px] leading-relaxed text-[var(--text-faint)]">{text}</p>
      {action ? <SettingsButton onClick={action.run}>{action.label}</SettingsButton> : null}
    </div>
  );
}

/** A list's page: its title, what the list is in one line, then the list, in the middle of the room the window gives. */
function PluginsPage({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-10 pb-12 pt-9">
      <div className="mx-auto w-full max-w-[920px]">
        <h2 className="text-[22px] font-semibold tracking-[-0.015em] text-[var(--text)]">{title}</h2>
        <p className="mb-6 mt-2 max-w-[640px] text-[14.5px] leading-relaxed text-[var(--text-muted)]">{note}</p>
        {children}
      </div>
    </div>
  );
}

/**
 * A plugin or a skill as a row of Settings: its mark, its title (a word after it: Beta, or where it comes from), what it
 * is for under it, its control on the right (a switch, Install, a word); a click beside the control opens its page.
 */
function PluginRow({ mark, title, note, summary, control, onOpen, dim = false }: {
  mark: React.ReactNode; title: string; note?: string | undefined; summary: string; control: React.ReactNode; onOpen?: () => void; dim?: boolean;
}) {
  return (
    <div role={onOpen ? 'button' : undefined} tabIndex={onOpen ? 0 : undefined} data-plugin-line={title}
      onClick={onOpen} onKeyDown={(e) => { if (onOpen && e.key === 'Enter' && e.target === e.currentTarget) onOpen(); }}
      className={`-mx-3 flex min-h-[72px] items-center gap-4 rounded-[10px] px-3 py-3.5 outline-none transition ${onOpen ? 'cursor-pointer hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]' : ''}`}>
      <span className={`shrink-0 ${dim ? 'opacity-50' : ''}`}>{mark}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className={`truncate text-[15px] ${dim ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>{title}</span>
          {note ? <span className="shrink-0 text-[12.5px] text-[var(--text-faint)]">{note}</span> : null}
        </div>
        {summary ? <p className="mt-1 line-clamp-2 text-[14px] leading-[1.55] text-[var(--text-muted)]">{summary}</p> : null}
      </div>
      {/* the control is its own: a press there does not open the page */}
      <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{control}</div>
    </div>
  );
}

/**
 * What each of the person's agents brings of its own, for the agents that can be told which to leave out (read when
 * `shown`): its skills, and its connectors (the MCP servers the person added to it; an agent that cannot be told has
 * them all, said so).
 */
function useAgentExtras(shown: boolean) {
  const [groups, setGroups] = React.useState<AgentGroup[]>([]);
  const [mcp, setMcp] = React.useState<McpGroup[]>([]);
  const host = studioHost?.agents;
  const read = React.useCallback(async () => {
    if (!host) return;
    const agents = (await host.list().catch(() => [])).filter((a) => a.status === 'ready' && a.shown);
    const skills = await Promise.all(agents.map(async (a) => {
      const own = host.skills ? await host.skills(a.id).catch(() => null) : null;
      return own?.filtered && own.skills.length ? { id: a.id, name: a.name, skills: own.skills } : null;
    }));
    const servers = await Promise.all(agents.map(async (a) => {
      const own = host.mcp ? await host.mcp(a.id).catch(() => null) : null;
      return own?.servers.length ? { id: a.id, name: a.name, filtered: own.filtered, servers: own.servers } : null;
    }));
    setGroups(skills.filter((g): g is AgentGroup => g != null));
    setMcp(servers.filter((g): g is McpGroup => g != null));
  }, [host]);
  React.useEffect(() => { if (shown) void read(); }, [shown, read]);
  const allow = (id: HostAgentId, name: string, allowed: boolean) => {
    setGroups((list) => list.map((g) => (g.id === id ? { ...g, skills: g.skills.map((k) => (k.name === name ? { ...k, allowed } : k)) } : g)));
    void host?.allowSkill?.(id, name, allowed)?.catch(() => {}).finally(() => { void read(); });
  };
  const allowMcp = (id: HostAgentId, name: string, allowed: boolean) => {
    setMcp((list) => list.map((g) => (g.id === id ? { ...g, servers: g.servers.map((k) => (k.name === name ? { ...k, allowed } : k)) } : g)));
    void host?.allowMcp?.(id, name, allowed)?.catch(() => {}).finally(() => { void read(); });
  };
  return { groups: shown ? groups : [], mcp: shown ? mcp : [], allow, allowMcp };
}

/** One thing in Discover, as its card shows it. */
type StoreItem = {
  key: string; kind: FeatureKind; title: string; summary: string; note?: string | undefined;
  cover: React.ReactNode; action: React.ReactNode; onOpen?: () => void;
};

/**
 * What Discover will offer and does not yet, shown as it will be, with no button: the final shape of each shelf while
 * the catalog fills. Each goes once the real one is in the catalog.
 */
const SOON: ReadonlyArray<{ id: string; kind: FeatureKind; hue: number; icon: LucideIcon }> = [
  { id: 'ad', kind: 'skills', hue: 18, icon: Megaphone },
  { id: 'talk', kind: 'skills', hue: 200, icon: Mic },
  { id: 'beat', kind: 'skills', hue: 286, icon: Music2 },
  { id: 'translate', kind: 'skills', hue: 150, icon: Languages },
  { id: 'stock', kind: 'connectors', hue: 212, icon: Images },
  { id: 'sounds', kind: 'connectors', hue: 262, icon: Music },
  { id: 'drive', kind: 'connectors', hue: 188, icon: Cloud },
  { id: 'publish', kind: 'connectors', hue: 328, icon: Send },
];

/** How to make a workbench or a skill of one's own. */
const MAKE_GUIDE = 'https://github.com/openfilm/openfilm/blob/main/packages/openfilm/plugins/README.md';

const STORE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4';

/** A picture for what has none: its mark large on a wash of its color. */
function GradientCover({ hue, Icon }: { hue: number; Icon: LucideIcon }) {
  return (
    <div aria-hidden className="absolute inset-0 flex items-center justify-center"
      style={{ background: `radial-gradient(110% 90% at 25% 0%, hsl(${hue} 70% 55% / 0.24), transparent 62%), radial-gradient(90% 80% at 100% 100%, hsl(${hue} 70% 50% / 0.14), transparent 60%), var(--bg-field)` }}>
      <span className="flex h-14 w-14 items-center justify-center rounded-[14px]"
        style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `light-dark(hsl(${hue} 62% 40%), hsl(${hue} 80% 72%))`, boxShadow: `0 0 0 1px hsl(${hue} 70% 60% / 0.28)` }}>
        <Icon size={24} strokeWidth={1.6} />
      </span>
    </div>
  );
}

/** Not out yet: a word where its button will be. */
function SoonMark() {
  const t = useT();
  return <span className="inline-flex h-7 items-center rounded-full bg-[var(--bg-field)] px-2.5 text-[12.5px] text-[var(--text-muted)]">{t('assetDrawer.comingSoon')}</span>;
}

/** A kind's mark in a row's place for one (a connector has no mark of its own). */
function KindMark({ kind }: { kind: FeatureKind }) {
  const Mark = KIND_ICONS[kind];
  return <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[var(--bg-field)] text-[var(--text-muted)]"><Mark size={17} strokeWidth={1.7} /></span>;
}

/** One thing in Discover: its picture, its name and whose, what it is for, its kind and its button; a click opens its page. */
function StoreCard({ item }: { item: StoreItem }) {
  const t = useT();
  const Mark = KIND_ICONS[item.kind];
  return (
    <div role={item.onOpen ? 'button' : undefined} tabIndex={item.onOpen ? 0 : undefined} data-store-card={item.title}
      onClick={item.onOpen} onKeyDown={(e) => { if (item.onOpen && e.key === 'Enter' && e.target === e.currentTarget) item.onOpen(); }}
      className={`flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] outline-none transition ${item.onOpen ? 'cursor-pointer hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]' : ''}`}>
      <div className="relative aspect-video shrink-0 overflow-hidden border-b border-[var(--border)] bg-[var(--bg-field)]">{item.cover}</div>
      <div className="flex min-h-0 flex-1 flex-col p-3.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[15px] font-medium text-[var(--text)]">{item.title}</span>
          {item.note ? <span className="shrink-0 text-[12.5px] text-[var(--text-faint)]">{item.note}</span> : null}
        </div>
        <p className="mt-1 line-clamp-2 min-h-[42px] text-[13.5px] leading-[21px] text-[var(--text-muted)]">{item.summary}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-[var(--text-faint)]"><Mark size={14} strokeWidth={1.75} aria-hidden />{t(`assetDrawer.kind_${item.kind}`)}</span>
          {/* the button is its own: a press there does not open the page */}
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{item.action}</span>
        </div>
      </div>
    </div>
  );
}

/** A shelf of Discover's front page: its kind's name, its first three (none: `empty`), and the way to all of them. */
function StoreShelf({ title, more, onMore, children, empty }: { title: string; more: string; onMore: () => void; children: React.ReactNode; empty?: React.ReactNode }) {
  return (
    <section className="mb-10 last:mb-0">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</h3>
        <button type="button" onClick={onMore} className="inline-flex items-center gap-0.5 text-[13.5px] text-[var(--text-muted)] transition hover:text-[var(--text)]">
          {more}<ChevronRight size={14} aria-hidden />
        </button>
      </div>
      {React.Children.count(children) ? <div className={STORE_GRID}>{children}</div> : empty}
    </section>
  );
}

/** Discover's one shown big: its moving preview (else its picture) beside what it is and its button. */
function Hero({ item, preview, label }: { item: StoreItem; preview?: string | undefined; label: string }) {
  return (
    <div role={item.onOpen ? 'button' : undefined} tabIndex={item.onOpen ? 0 : undefined} onClick={item.onOpen}
      onKeyDown={(e) => { if (item.onOpen && e.key === 'Enter' && e.target === e.currentTarget) item.onOpen(); }}
      className="mb-10 grid cursor-pointer overflow-hidden rounded-[14px] border border-[var(--border)] outline-none transition hover:border-[var(--border-strong)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)] md:grid-cols-[1.25fr_1fr]">
      <div className="relative aspect-video overflow-hidden bg-black">
        {item.cover}
        {preview ? <video src={preview} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
      </div>
      <div className="flex min-w-0 flex-col justify-center gap-2 p-6">
        <span className="text-[12.5px] font-medium text-[var(--accent)]">{label}</span>
        <h3 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-[var(--text)]">{item.title}</h3>
        {item.note ? <span className="text-[13px] text-[var(--text-faint)]">{item.note}</span> : null}
        <p className="line-clamp-3 text-[14.5px] leading-relaxed text-[var(--text-muted)]">{item.summary}</p>
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>{item.action}</div>
      </div>
    </div>
  );
}
