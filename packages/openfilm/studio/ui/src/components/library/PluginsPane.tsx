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
  ArrowLeft, ArrowUpRight, AudioLines, Box, Check, Clapperboard, Cloud, Film, FolderOpen, Images, Languages, Layers, Loader2, Megaphone, Mic,
  Globe, Music, Music2, Palette, Projector, Puzzle, RefreshCw, Scissors, Send, Spline, SquareTerminal, Star, Upload, Workflow, Github, type LucideIcon,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost, type HostAgentId } from '@/lib/host';
import { setPluginOn, usePlugins, type Plugin } from '@/lib/plugins';
import { closePlugins, FIRST_LINE, showPluginsLine, type PluginsLine } from '@/lib/plugins-window';
import { revealInLibrary } from '@/lib/library-reveal';
import { isPlugin, pluginOfSkill } from '@/lib/project-plugins';
import { communityOf, fetchErrorKey, forgetSeenSkills, makerOf, ownerOf, seenCatalog, seenSkills, sourcesApi, SourceError, watchSkills, type PublishCheck, type PublishVerify, type SkillEntry } from '@/lib/project-sources';
import { ConfirmDialog } from '../ConfirmDialog';
import {
  BringsLine, byOrder, CommandChips, ForDevelopers, HowToUse, TrustMark, hostOf, useScriptsConsent, inLanguage, PageSection, SkillCover, SkillMark, SkillPage, useSkillWords,
} from '../SkillPage';
import { CATEGORIES, categoryOfPlugin, categoryOfSkill, usesOfPlugin, type Category } from '@/lib/plugin-profile';
import { ProfileStrip } from './PluginProfile';
import { SettingsButton, SettingsGroup, SettingsSwitch } from '../settings/ui';
import { LARGE_DIALOG_COLUMN as PAGE_INSET } from '../dialog-chrome';
import { COMMUNITY_ICON, FEATURE_KINDS, KindIcon, isCodeKind, type FeatureKind } from '../feature-kinds';
import { libraryUrl, nameOf, posterUrl, previewUrl, templatePreviewUrl, TEXT_COMPONENT, toggleFavorite, useLibraryFavorites, useLibraryIndex, type LibraryCategory, type LibraryItem } from '@/lib/library';
import { isClipMotion } from '@/lib/clip-presets';
import { PLAIN } from './OnPicture';
import { TextStyleSample } from './TextStyleSample';

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
    if (!line.startsWith('kind:')) return;
    let live = true;
    const request = ++discoverRequest;
    setDiscover(seenCatalog() ? 'read' : 'reading');
    void sourcesApi.readDiscover(retry ? 0 : FRESH_MS).then(
      () => { if (request !== discoverRequest) return; discoverFailed = null; if (live) setDiscover('read'); },
      (e) => { if (request !== discoverRequest) return; discoverFailed = e instanceof SourceError && e.code === 'partial' ? 'partial' : 'failed'; if (live) setDiscover(discoverFailed); },
    );
    return () => { live = false; };
  }, [line, retry]);

  const agents = useAgentExtras(line === 'added');
  /* how many use each community item (anonymous counts; none when unknown) */
  const [stats, setStats] = React.useState<Record<string, { installs: number }>>({});
  React.useEffect(() => { let live = true; void sourcesApi.communityStats().then((r) => { if (live) setStats(r); }); return () => { live = false; }; }, []);
  const library = useLibraryIndex();
  /* what the person starred, in the library and here alike (one list: library ids, `skill:<uid>`) */
  const favorites = useLibraryFavorites();
  const kept = new Set(favorites);
  /* a kind with thousands (OpenFilm's sounds): shown a page at a time */
  const [shown, setShown] = React.useState(STORE_PAGE);
  React.useEffect(() => { setShown(STORE_PAGE); }, [line, query]);
  const lang = useLanguage();
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
  /* one made by someone else that brings scripts: asked before it is installed (SkillPage useScriptsConsent) */
  const consent = useScriptsConsent();
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
        <SkillPage key={page.uid} skill={page} setSkills={setSkills} projectId={projectId} onBack={() => open(from)} onAuthor={(owner) => showPluginsLine(`author:${owner}`)}
          onOn={() => { if (isPlugin(page)) workbenchOn(pluginOfSkill(page)); }} {...(studioHost?.useSkill ? { onTry: tryIt } : {})} />
      </div>
    );
  }
  /* one of the library's things: its page, with it shown as it is (`asset:<id>`) */
  const assetPage = opened?.startsWith(ASSET_PAGE) ? library?.items.find((it) => it.id === opened.slice(ASSET_PAGE.length)) : undefined;
  if (assetPage) {
    return <AssetPage item={assetPage} lang={lang} starred={kept.has(assetPage.id)} onBack={() => open(null)}
      onUse={() => { closePlugins(); revealInLibrary(assetPage.cat); }}
      {...(assetPage.by ? { onAuthor: () => showPluginsLine(`author:${(assetPage.by ?? '').toLowerCase()}`) } : {})} />;
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
  /* a project's own not allowed yet: no switch, but the way to look at it whole and allow it (its page) */
  const skillRow = (k: SkillEntry) => (
    <PluginRow key={k.uid} mark={<SkillMark skill={k} />} title={words(k).title} note={fromOf(k)}
      summary={k.revoked ? t('gallery.revokedNote').replace('{reason}', t(`gallery.revoked_${k.revoked.reason}`)) : k.waits ? t('assetDrawer.waitsNote') : k.update ? t('gallery.updateOut').replace('{version}', k.update.version) : words(k).summary} onOpen={() => open(k.uid)}
      control={k.revoked ? <span className="text-[13.5px] font-medium text-[var(--err)]">{t('gallery.revokedShort')}</span>
        : k.waits ? <SettingsButton onClick={() => open(k.uid)}>{t('assetDrawer.reviewAndAllow')}</SettingsButton>
        : <SettingsSwitch checked={!k.off} onChange={(on) => turnSkill(k, on)} label={t(k.off ? 'gallery.turnOn' : 'gallery.turnOff').replace('{name}', words(k).title)} />} />
  );
  /* a workbench is what shows outside the conversation: OpenFilm's with a workbench or a tab of the library, anyone's with a page */
  const ownBench = (p: Plugin) => Boolean(p.workbench || p.tab);

  /* the library's kinds as its tabs list them: OpenFilm's own first, then the community's (sent by someone, `by`); all
     there already, in the library's tabs (a clip's motion and a moving line of words are another tab's, not shown) */
  const assetsOf = (kind: LibraryCategory) => {
    const all = (library?.items ?? []).filter((it) => it.cat === kind && !isClipMotion(it) && it.kind !== 'textmotion'
      && matches(nameOf(it.name, lang), it.by, ...(it.tags ?? [])));
    return [...all.filter((it) => !it.by), ...all.filter((it) => it.by)];
  };
  const officialMark = <span className="inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11.5px] font-medium text-[var(--accent)]" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)' }}>{t('gallery.trustOfficial')}</span>;

  /* Added: what the person has, by kind; each kind's switches; OpenFilm's workbenches among them */
  if (line === 'added') {
    const benches = inOrder(ownMatched.filter((p) => ownBench(p) && !p.soon), categoryOfPlugin);
    const theirBenches = listed.filter((k) => isPlugin(k));
    const mine = inOrder(listed.filter((k) => !isPlugin(k)), categoryOfSkill);
    const ownSkills = ownMatched.filter((p) => !ownBench(p) && !p.soon);
    const connectors = agents.mcp.map((g) => ({ ...g, servers: g.servers.filter((k) => matches(k.name, k.detail)) })).filter((g) => g.servers.length);
    const agentSkills = agentsOwn;
    const nothing = !benches.length && !theirBenches.length && !mine.length && !ownSkills.length && !connectors.length && !agentSkills.length;
    return (
      <PluginsPage title={t('assetDrawer.place_added')} note={t('assetDrawer.note_added')}>
        {error ? <p role="alert" className="mb-4 text-[13.5px] text-[var(--warn)]">{error}</p> : null}
        {benches.length || theirBenches.length ? (
          <SettingsGroup title={<KindTitle kind="workbenches" />}>{benches.map(workbenchRow)}{theirBenches.map(skillRow)}</SettingsGroup>
        ) : null}
        {mine.length || ownSkills.length ? <SettingsGroup title={<KindTitle kind="skills" />}>{ownSkills.map(workbenchRow)}{mine.map(skillRow)}</SettingsGroup> : null}
        {/* what each agent brings of its own: its skills, its connectors, each let in here or not */}
        {agentSkills.map((g) => (
          <SettingsGroup key={`skills:${g.id}`} title={<KindTitle kind="skills" from={g.name} />} footnote={t('assetDrawer.agentOwnNote').replace('{name}', g.name)}>
            {g.skills.map((k) => (
              <PluginRow key={k.name} mark={<SkillMark skill={{}} />} title={k.name} summary={k.description}
                control={<SettingsSwitch checked={k.allowed} onChange={(on) => agents.allow(g.id, k.name, on)} label={t(k.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', k.name)} />} />
            ))}
          </SettingsGroup>
        ))}
        {connectors.map((g) => (
          <SettingsGroup key={`mcp:${g.id}`} title={<KindTitle kind="connectors" from={g.name} />}
            footnote={g.filtered ? t('assetDrawer.connectorsNote').replace('{name}', g.name) : t('assetDrawer.connectorsAll').replace('{name}', g.name)}>
            {g.servers.map((k) => (
              <PluginRow key={k.name} mark={<KindMark kind="connectors" />} title={k.name} summary={k.detail}
                control={g.filtered ? <SettingsSwitch checked={k.allowed} onChange={(on) => agents.allowMcp(g.id, k.name, on)} label={t(k.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', k.name)} /> : null} />
            ))}
          </SettingsGroup>
        ))}
        {nothing ? <Empty text={t(q ? 'assetDrawer.noSkillsFound' : 'assetDrawer.addedNone')} action={q ? undefined : { label: t('assetDrawer.place_discover'), run: () => showPluginsLine(FIRST_LINE) }} /> : null}
        {/* where Discover reads from: the OpenFilm Community, and others the person added (rarely: kept out of the side) */}
        {!q ? (
          <p className="mt-10 flex flex-wrap items-center gap-x-2 text-[13.5px] text-[var(--text-faint)]">
            {t('assetDrawer.sourcesLine')}
            <button type="button" onClick={() => showPluginsLine('sources')} className="text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline">{t('assetDrawer.sourcesManage')}</button>
          </p>
        ) : null}
      </PluginsPage>
    );
  }

  /* Publish: one's own, published to the community from here (PublishFlow); the other ways; the community's other
     indexes are under Sources (from Added's foot) */
  if (line === 'publish') {
    return (
      <PluginsPage title={t('assetDrawer.publishTitle')} note={t('assetDrawer.note_publish')} badge={t('assetDrawer.communityEarly')}>
        <p className="mb-8 rounded-[10px] bg-[var(--bg-field)] px-4 py-3 text-[14px] leading-relaxed text-[var(--text-muted)]">{t('assetDrawer.publishEarly')}</p>
        <PublishPanel skills={skills.filter((k) => k.source === 'mine' && !k.core)} words={words} />
      </PluginsPage>
    );
  }

  /* the other community indexes the person added, beside OpenFilm's own */
  if (line === 'sources') {
    return (
      <PluginsPage title={t('assetDrawer.sourcesTitle')} note={t('assetDrawer.note_sources')}>
        <SourcesPanel onChanged={() => setRetry((n) => n + 1)} />
      </PluginsPage>
    );
  }

  /* Discover: the catalog, as cards. OpenFilm's workbenches are here too, to turn on; what is installed or on stays,
     said so; what is still being made is shown as it will be, without a button (SOON) */
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
      trust: officialMark,
      cover: <GradientCover hue={HUES[p.icon ?? ''] ?? 220} Icon={PLUGIN_ICONS[p.icon ?? ''] ?? Puzzle} />, onOpen: () => open(`${PLUGIN_PAGE}${p.id}`),
      action: p.soon ? <SoonMark /> : p.on ? doneMark(t('assetDrawer.turnedOn')) : <SettingsButton onClick={() => turnPlugin(p, true)}>{t('assetDrawer.turnOnAction')}</SettingsButton>,
    };
  };
  const skillCard = (k: SkillEntry): StoreItem => ({
    key: k.uid, kind: isPlugin(k) ? 'workbenches' : 'skills', title: words(k).title, summary: words(k).summary,
    note: communityOf(k) ? makerOf(k) : t('assetDrawer.skillsOfficial'), cover: <SkillCover skill={k} title={words(k).title} />, onOpen: () => open(k.uid),
    trust: <TrustMark skill={k} />, author: ownerOf(k), onAuthor: () => showPluginsLine(`author:${ownerOf(k)}`), installs: stats[k.uid]?.installs,
    starred: kept.has(`skill:${k.uid}`), onStar: () => toggleFavorite(`skill:${k.uid}`),
    action: installedOf(k) ? doneMark(t('assetDrawer.installedMark')) : (
      <SettingsButton disabled={installing != null} onClick={() => consent.ask(k, () => install(k))}>
        {installing === k.uid ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{t(installing === k.uid ? 'gallery.installing' : 'gallery.install')}
      </SettingsButton>
    ),
  });
  const assetCard = (it: LibraryItem): StoreItem => ({
    /* its tags are English words: said only in English */
    key: it.id, kind: it.cat, title: nameOf(it.name, lang), summary: lang === 'en' ? (it.tags ?? []).slice(0, 4).join(t('assetDrawer.listSep')) : '',
    note: it.by ?? t('assetDrawer.skillsOfficial'), ...(it.by ? {} : { trust: officialMark }),
    ...(it.by ? { author: it.by.toLowerCase(), onAuthor: () => showPluginsLine(`author:${(it.by ?? '').toLowerCase()}`) } : {}),
    cover: <AssetCover item={it} lang={lang} />, onOpen: () => open(`${ASSET_PAGE}${it.id}`),
    starred: kept.has(it.id), onStar: () => toggleFavorite(it.id),
    action: doneMark(t('assetDrawer.inLibrary')),
  });
  const soonCards = SOON.filter((x) => matches(t(`assetDrawer.soon_${x.id}`), t(`assetDrawer.soon_${x.id}Note`))).map((x): StoreItem => ({
    key: `soon:${x.id}`, kind: x.kind, title: t(`assetDrawer.soon_${x.id}`), summary: t(`assetDrawer.soon_${x.id}Note`), note: t('assetDrawer.skillsOfficial'),
    cover: <GradientCover hue={x.hue} Icon={x.icon} />, action: <SoonMark />,
  }));
  const storeOf = (kind: FeatureKind): StoreItem[] => {
    if (kind === 'workbenches') {
      return [
        ...inOrder(ownMatched.filter((p) => ownBench(p) && !p.soon), categoryOfPlugin).map(benchCard),
        ...offered.filter((k) => isPlugin(k)).map(skillCard),
        ...inOrder(ownMatched.filter((p) => p.soon), categoryOfPlugin).map(benchCard),
      ];
    }
    if (kind === 'skills') return [...offered.filter((k) => !isPlugin(k)).map(skillCard), ...soonCards.filter((x) => x.kind === 'skills')];
    if (kind === 'connectors') return soonCards.filter((x) => x.kind === 'connectors');
    return assetsOf(kind).map(assetCard);
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
  /* the way to share what one made, wherever a shelf has nothing yet and at the foot of Discover */
  const publishCall = (text: string) => (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[12px] border border-dashed border-[var(--border-strong)] px-5 py-4">
      <p className="min-w-0 flex-1 text-[14.5px] leading-relaxed text-[var(--text-muted)]">{text}</p>
      <SettingsButton onClick={() => showPluginsLine('publish')}><Upload size={14} aria-hidden />{t('assetDrawer.publishAction')}</SettingsButton>
    </div>
  );
  const kindName = (kind: FeatureKind) => t(isCodeKind(kind) ? `assetDrawer.view_${kind}` : `assetDrawer.cat_${kind}`);

  /* Favorites: what the person starred, here or in the library, by kind */
  if (line === 'favorites') {
    const byId = new Map((library?.items ?? []).map((it) => [it.id, it]));
    const cards = favorites.flatMap((id): StoreItem[] => {
      if (id.startsWith('skill:')) { const k = found.find((x) => x.uid === id.slice('skill:'.length)); return k ? [skillCard(k)] : []; }
      const it = byId.get(id);
      return it && matches(nameOf(it.name, lang), it.by, ...(it.tags ?? [])) ? [assetCard(it)] : [];
    });
    const kinds = FEATURE_KINDS.filter((kind) => cards.some((c) => c.kind === kind));
    return (
      <PluginsPage title={t('assetDrawer.place_favorites')} note={t('assetDrawer.note_favorites')}>
        {consent.dialog}
        {kinds.map((kind) => (
          <section key={kind} className="mb-10 last:mb-0">
            <h3 className="mb-3 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]"><KindIcon kind={kind} size={17} />{kindName(kind)}</h3>
            <div className={STORE_GRID}>{cards.filter((c) => c.kind === kind).map((item) => <StoreCard key={item.key} item={item} />)}</div>
          </section>
        ))}
        {kinds.length ? null : <Empty text={t(q ? 'assetDrawer.noSkillsFound' : 'assetDrawer.favoritesNone')} action={q ? undefined : { label: t('assetDrawer.place_discover'), run: () => showPluginsLine(FIRST_LINE) }} />}
      </PluginsPage>
    );
  }

  const kind = line.slice('kind:'.length) as FeatureKind;
  const items = storeOf(kind);
  const kindNote = isCodeKind(kind) ? t(`assetDrawer.note_discover_${kind}`) : t('assetDrawer.note_kindAsset').replaceAll('{kind}', kindName(kind));
  return (
    <PluginsPage title={kindName(kind)} note={kindNote}>
      {consent.dialog}
      {status}
      {waiting && isCodeKind(kind) ? (
        <div role="status" aria-label={t('assetDrawer.discoverReading')} className={STORE_GRID}>
          {Array.from({ length: 6 }, (_, i) => <div key={i} aria-hidden className="skeleton aspect-[4/3] rounded-[12px]" />)}
        </div>
      ) : items.length ? (
        <>
          <div className={STORE_GRID}>{items.slice(0, shown).map((item) => <StoreCard key={item.key} item={item} />)}</div>
          {items.length > shown ? (
            <div className="mt-6 flex justify-center">
              <SettingsButton onClick={() => setShown((n) => n + STORE_PAGE)}>{t('assetDrawer.showMoreCards').replace('{n}', (items.length - shown).toLocaleString())}</SettingsButton>
            </div>
          ) : null}
        </>
      ) : q ? <Empty text={t('assetDrawer.noSkillsFound')} />
        : publishCall(t('assetDrawer.kindNone').replaceAll('{kind}', kindName(kind)))}
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
function PluginsPage({ title, note, badge, children }: { title: string; note: string; badge?: string; children: React.ReactNode }) {
  return (
    /* a page of its own: another place starts at its top */
    <div key={title} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-10 pb-12 pt-9">
      <div className="mx-auto w-full max-w-[920px]">
        <h2 className="flex items-center gap-2.5 text-[22px] font-semibold tracking-[-0.015em] text-[var(--text)]">
          {title}
          {badge ? <span className="rounded-full bg-[var(--bg-field)] px-2 text-[12px] font-medium leading-[20px] tracking-normal text-[var(--text-muted)]">{badge}</span> : null}
        </h2>
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
  /** how far it is vouched for (SkillPage TrustMark); whose it is, opening their page; how many use it */
  trust?: React.ReactNode; author?: string | undefined; onAuthor?: (() => void) | undefined; installs?: number | undefined;
  /** starred (the library's favorites, shared with it), and the star's press */
  starred?: boolean; onStar?: () => void;
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


const STORE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-4';
/** The page of one of the library's things: `asset:` and its id. */
const ASSET_PAGE = 'asset:';
/** How many cards of a kind are shown at once; more on asking. */
const STORE_PAGE = 48;

/**
 * One of the library's things on its page: shown as it is used (a moving one plays; a look on its picture beside the
 * picture as it was; a text style in words; a sound or music to listen to), whose it is, and where it is used (the
 * library's tab of its kind, opened from here), with its star.
 */
function AssetPage({ item, lang, starred, onBack, onUse, onAuthor }: {
  item: LibraryItem; lang: ReturnType<typeof useLanguage>; starred: boolean; onBack: () => void; onUse: () => void; onAuthor?: () => void;
}) {
  const t = useT();
  const kindName = t(`assetDrawer.cat_${item.cat}`);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-10 pb-12 pt-9">
      <div className="mx-auto w-full max-w-[920px]">
        <button type="button" onClick={onBack} className="-ml-1 mb-5 flex h-8 items-center gap-1.5 rounded-md pl-1.5 pr-2.5 text-[14px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
          <ArrowLeft size={14} />{t('gallery.back')}
        </button>
        {/* no larger than its pictures bear (the library's previews are small) */}
        <div className="max-w-[640px]"><AssetShow item={item} lang={lang} /></div>
        <div className="mt-6 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2.5">
              <h2 className="truncate text-[22px] font-semibold tracking-[-0.015em] text-[var(--text)]">{nameOf(item.name, lang)}</h2>
              {item.by ? null : <span className="inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11.5px] font-medium text-[var(--accent)]" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)' }}>{t('gallery.trustOfficial')}</span>}
            </div>
            <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[14px] text-[var(--text-muted)]">
              {item.by && onAuthor
                ? <button type="button" onClick={onAuthor} className="underline-offset-2 hover:text-[var(--text)] hover:underline">{item.by}</button>
                : <span>{item.by ?? t('assetDrawer.skillsOfficial')}</span>}
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5"><KindIcon kind={item.cat} size={14} />{kindName}</span>
            </p>
            <p className="mt-3 max-w-[560px] text-[14.5px] leading-relaxed text-[var(--text-muted)]">{t('assetDrawer.assetUseNote').replaceAll('{kind}', kindName)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <SettingsButton onClick={() => toggleFavorite(item.id)} aria-pressed={starred}>
              <Star size={14} fill={starred ? 'currentColor' : 'none'} className={starred ? 'text-[#ffd35a]' : ''} aria-hidden />{t(starred ? 'assetDrawer.unstar' : 'assetDrawer.star')}
            </SettingsButton>
            <SettingsButton variant="primary" onClick={onUse}>{t('assetDrawer.useInLibrary')}</SettingsButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One of the library's things large, as it is used: playing when it moves, heard when it sounds. */
function AssetShow({ item, lang }: { item: LibraryItem; lang: ReturnType<typeof useLanguage> }) {
  const t = useT();
  const [still, setStill] = React.useState(false);
  const frame = 'relative aspect-video w-full overflow-hidden rounded-[12px] border border-[var(--border)] bg-[var(--bg-field)]';
  if (item.kind === 'sound') {
    return (
      <div className="flex flex-col gap-3">
        <div className={frame}>
          {item.cover ? <img src={libraryUrl(item.cover)} alt="" className="absolute inset-0 h-full w-full object-cover" />
            : <GradientCover hue={item.cat === 'music' ? 286 : 200} Icon={item.cat === 'music' ? Music : AudioLines} />}
        </div>
        <audio controls preload="none" src={libraryUrl(item.id)} className="w-full" aria-label={nameOf(item.name, lang)} />
      </div>
    );
  }
  if (item.kind === 'look') {
    /* the picture as it was, and with the look on it */
    const src = item.sample ? libraryUrl(item.sample) : PLAIN;
    return (
      <div className="grid grid-cols-2 gap-3">
        {[false, true].map((on) => (
          <figure key={String(on)} className="min-w-0">
            <div className={frame}><img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" style={on ? { filter: item.filter } : undefined} /></div>
            <figcaption className="mt-1.5 text-center text-[12.5px] text-[var(--text-faint)]">{t(on ? 'assetDrawer.lookAfter' : 'assetDrawer.lookBefore')}</figcaption>
          </figure>
        ))}
      </div>
    );
  }
  if (item.kind === 'textstyle' || item.id === TEXT_COMPONENT) {
    return <div className={frame}><TextStyleSample lang={lang} vars={item.vars} {...(item.id === TEXT_COMPONENT ? { words: nameOf(item.name, lang) } : {})} /></div>;
  }
  /* a moving one plays (a template its example); one with no moving picture, or whose picture is not there, its poster */
  const video = item.kind === 'group' ? templatePreviewUrl(item) : previewUrl(item);
  const fit = item.cat === 'sticker' ? 'object-contain p-8' : 'object-cover';
  return (
    <div className={frame}>
      <img src={posterUrl(item)} alt="" className={`absolute inset-0 h-full w-full ${fit}`} />
      {still ? null : <video key={video} src={video} autoPlay muted loop playsInline onError={() => setStill(true)}
        className={`absolute inset-0 h-full w-full ${fit}`} />}
    </div>
  );
}

/**
 * One of the library's items as its card in the library draws it: a look on its sample picture, a text style in words
 * of the app's language, a sticker whole, a sound or a piece of music by its mark, the rest by its poster.
 */
function AssetCover({ item, lang }: { item: LibraryItem; lang: ReturnType<typeof useLanguage> }) {
  if (item.kind === 'sound') return <GradientCover hue={item.cat === 'music' ? 286 : 200} Icon={item.cat === 'music' ? Music : AudioLines} />;
  if (item.kind === 'look') return <img src={item.sample ? libraryUrl(item.sample) : PLAIN} alt="" loading="lazy" draggable={false} className="absolute inset-0 h-full w-full object-cover" style={{ filter: item.filter }} />;
  if (item.kind === 'textstyle' || item.id === TEXT_COMPONENT) return <TextStyleSample lang={lang} vars={item.vars} {...(item.id === TEXT_COMPONENT ? { words: nameOf(item.name, lang) } : {})} />;
  return <img src={posterUrl(item)} alt="" loading="lazy" decoding="async" draggable={false} className={`absolute inset-0 h-full w-full ${item.cat === 'sticker' ? 'object-contain p-4' : 'object-cover'}`} />;
}

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

/** A kind's mark (or `icon`) in a row's place for one that has no mark of its own (a connector, a way to publish). */
function KindMark({ kind, icon: Icon }: { kind: FeatureKind; icon?: LucideIcon }) {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[var(--bg-field)] text-[var(--text-muted)]">
      {Icon ? <Icon size={17} strokeWidth={1.7} aria-hidden /> : <KindIcon kind={kind} size={17} />}
    </span>
  );
}

/** A group's title in Added: its kind's mark and name, and whose it is when an agent brought it. */
function KindTitle({ kind, from }: { kind: FeatureKind; from?: string }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-[var(--text-muted)]"><KindIcon kind={kind} size={17} /></span>
      {t(isCodeKind(kind) ? `assetDrawer.view_${kind}` : `assetDrawer.cat_${kind}`)}
      {from ? <span className="text-[14px] font-normal text-[var(--text-faint)]">{t('assetDrawer.fromAgent').replace('{name}', from)}</span> : null}
    </span>
  );
}

/** One thing in Discover: its picture, its name and whose, what it is for, its kind and its button; a click opens its page. */
function StoreCard({ item }: { item: StoreItem }) {
  const t = useT();
  return (
    <div role={item.onOpen ? 'button' : undefined} tabIndex={item.onOpen ? 0 : undefined} data-store-card={item.title}
      onClick={item.onOpen} onKeyDown={(e) => { if (item.onOpen && e.key === 'Enter' && e.target === e.currentTarget) item.onOpen(); }}
      className={`flex min-w-0 flex-col overflow-hidden rounded-[12px] border border-[var(--border)] outline-none transition ${item.onOpen ? 'cursor-pointer hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)] focus-visible:shadow-[inset_0_0_0_1px_var(--accent)]' : ''}`}>
      <div className="group/cover relative aspect-video shrink-0 overflow-hidden border-b border-[var(--border)] bg-[var(--bg-field)]">
        {item.cover}
        {/* the star: shown on hover, and kept shown once starred */}
        {item.onStar ? (
          <button type="button" aria-pressed={Boolean(item.starred)} aria-label={t(item.starred ? 'assetDrawer.unstar' : 'assetDrawer.star')}
            onClick={(e) => { e.stopPropagation(); item.onStar?.(); }}
            className={`absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-full bg-black/55 transition hover:bg-black/70 focus-visible:flex ${item.starred ? 'flex text-[#ffd35a]' : 'hidden text-white group-hover/cover:flex'}`}>
            <Star size={15} fill={item.starred ? 'currentColor' : 'none'} strokeWidth={item.starred ? 0 : 2} />
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col p-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[15px] font-medium text-[var(--text)]">{item.title}</span>
          {item.trust}
        </div>
        {item.note ? (
          item.onAuthor
            ? <button type="button" onClick={(e) => { e.stopPropagation(); item.onAuthor?.(); }} className="mt-0.5 self-start truncate text-left text-[12.5px] text-[var(--text-faint)] underline-offset-2 hover:text-[var(--text)] hover:underline">{item.note}</button>
            : <span className="mt-0.5 truncate text-[12.5px] text-[var(--text-faint)]">{item.note}</span>
        ) : null}
        {item.summary ? <p className="mt-1 line-clamp-2 min-h-[42px] text-[13.5px] leading-[21px] text-[var(--text-muted)]">{item.summary}</p> : null}
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-[12.5px] text-[var(--text-faint)]"><KindIcon kind={item.kind} size={14} />{t(isCodeKind(item.kind) ? `assetDrawer.kind_${item.kind}` : `assetDrawer.cat_${item.kind}`)}
            {item.installs ? <span className="tabular-nums">· {t('assetDrawer.installs').replace('{n}', item.installs.toLocaleString())}</span> : null}</span>
          {/* the button is its own: a press there does not open the page */}
          <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>{item.action}</span>
        </div>
      </div>
    </div>
  );
}



/** What the publish check says is missing, as a person reads it. */
const MISSING_WORDS = { description: 'publishMissingDescription', title: 'publishMissingTitle', version: 'publishMissingVersion', license: 'publishMissingLicense' } as const;

/**
 * Publish: one's own workbenches and skills, each with Publish (PublishFlow); then the other ways (the command, the
 * community's guide; media through its repository for now).
 */
function PublishPanel({ skills, words }: { skills: SkillEntry[]; words: ReturnType<typeof useSkillWords> }) {
  const t = useT();
  const [picked, setPicked] = React.useState<SkillEntry | null>(null);
  if (picked) return <PublishFlow skill={picked} title={words(picked).title} onBack={() => setPicked(null)} />;
  return (
    <>
      <SettingsGroup title={t('assetDrawer.publishMineTitle')}>
        {skills.length ? skills.map((k) => (
          <PluginRow key={k.uid} mark={<SkillMark skill={k} />} title={words(k).title} summary={words(k).summary}
            control={<SettingsButton onClick={() => setPicked(k)}><Upload size={14} aria-hidden />{t('assetDrawer.publishStart')}</SettingsButton>} />
        )) : <p className="py-3 text-[14px] leading-relaxed text-[var(--text-faint)]">{t('assetDrawer.publishMineNone')}</p>}
      </SettingsGroup>
      <SettingsGroup title={t('assetDrawer.publishOther')}>
        <PluginRow mark={<KindMark kind="workbenches" icon={SquareTerminal} />} title={t('assetDrawer.publishCli')} summary={t('assetDrawer.publishCliNote')}
          control={<code className="select-all rounded-md bg-[var(--bg-field)] px-2 py-1 font-mono text-[12.5px] text-[var(--text)]">openfilm publish</code>} />
        <PluginRow mark={<KindMark kind="workbenches" icon={Github} />} title={t('assetDrawer.publishGithub')} summary={t('assetDrawer.publishGithubNote')}
          control={<a href="https://github.com/openfilm/community#readme" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--border)] px-3.5 text-[14px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)]">{t('assetDrawer.publishGuide')}<ArrowUpRight size={14} aria-hidden /></a>} />
        <PluginRow mark={<KindMark kind="sound" />} title={t('assetDrawer.publishAssets')} summary={t('assetDrawer.publishAssetsNote')}
          control={<a href="https://github.com/openfilm/community/tree/main/assets#readme" target="_blank" rel="noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border border-[var(--border)] px-3.5 text-[14px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-hover)]">{t('assetDrawer.publishGuide')}<ArrowUpRight size={14} aria-hidden /></a>} />
      </SettingsGroup>
    </>
  );
}

/** One step of publishing: its number lit once done, its title, what it says. */
function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="flex gap-4 border-t border-[var(--border)] py-5 first:border-t-0">
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${done ? 'bg-[var(--ok)] text-black' : 'bg-[var(--bg-field)] text-[var(--text-muted)]'}`}>
        {done ? <Check size={15} aria-hidden /> : n}
      </span>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15.5px] font-semibold text-[var(--text)]">{title}</h3>
        <div className="mt-1.5 text-[14px] leading-relaxed text-[var(--text-muted)]">{children}</div>
      </div>
    </section>
  );
}

/**
 * Publishing one's own, step by step, with no GitHub sign-in in OpenFilm: (1) read as the community's review will;
 * (2) put in a public repository of theirs at skills/<name>/, its address given, read there and compared with this
 * one; (3) its listing proposed on GitHub's page for a new file, prefilled (GitHub makes the pull request). The
 * address is kept for next time.
 */
function PublishFlow({ skill, title, onBack }: { skill: SkillEntry; title: string; onBack: () => void }) {
  const t = useT();
  const [check, setCheck] = React.useState<PublishCheck | null>(null);
  const [checking, setChecking] = React.useState(false);
  const kept = `openfilm.publish.repo.${skill.uid}`;
  const [repo, setRepo] = React.useState(() => { try { return localStorage.getItem(kept) ?? ''; } catch { return ''; } });
  const [verify, setVerify] = React.useState<PublishVerify | null>(null);
  const [verifying, setVerifying] = React.useState(false);
  /* what went wrong, shown in the step it went wrong in */
  const [error, setError] = React.useState<{ step: 1 | 2; message: string } | null>(null);
  const failed = (step: 1 | 2) => (e: unknown) => {
    const code = e instanceof SourceError ? e.code : null;
    const key = code === 'not-github' ? 'assetDrawer.publishGitHubOnly' : code === 'access' ? 'assetDrawer.publishNotFound' : fetchErrorKey(code);
    setError({ step, message: key ? t(key) : e instanceof Error ? e.message : String(e) });
  };
  const runCheck = () => { setChecking(true); setVerify(null); setError(null); void sourcesApi.publishCheck(skill.uid).then(setCheck, failed(1)).finally(() => setChecking(false)); };
  React.useEffect(runCheck, [skill.uid]);
  const runVerify = () => {
    setVerifying(true); setError(null);
    try { localStorage.setItem(kept, repo.trim()); } catch { /* not kept */ }
    void sourcesApi.publishVerify(skill.uid, repo.trim()).then(setVerify, (e) => { setVerify(null); failed(2)(e); }).finally(() => setVerifying(false));
  };
  const young = verify?.ageDays != null && verify.ageDays < 7;
  const high = check?.findings.filter((f) => f.severity === 'high') ?? [];
  return (
    <div>
      <button type="button" onClick={onBack} className="-ml-1 mb-4 flex h-8 items-center gap-1.5 rounded-md pl-1.5 pr-2.5 text-[14px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
        <ArrowLeft size={14} />{t('gallery.back')}
      </button>
      <h3 className="mb-2 text-[18px] font-semibold text-[var(--text)]">{t('assetDrawer.publishOne').replace('{name}', title)}</h3>
      <Step n={1} title={t('assetDrawer.publishStep1')} done={Boolean(check?.ready)}>
        {error?.step === 1 ? <p role="alert" className="mb-2 text-[var(--warn)]">{error.message}</p> : null}
        {!check ? error?.step === 1 ? null : <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" aria-hidden />{t('assetDrawer.publishChecking')}</span> : (
          <>
            <p>{check.ready ? t('assetDrawer.publishReady') : t('assetDrawer.publishNotReady')}</p>
            {check.missing.length ? <ul className="mt-2 list-disc pl-5">{check.missing.map((m) => <li key={m}>{t(`assetDrawer.${MISSING_WORDS[m]}`)}</li>)}</ul> : null}
            {check.findings.length ? (
              <ul className="mt-2 flex flex-col gap-1">
                {[...high, ...check.findings.filter((f) => f.severity !== 'high')].map((f, i) => (
                  <li key={i} className="flex min-w-0 items-baseline gap-2 font-mono text-[12.5px]">
                    <span className={`shrink-0 rounded px-1.5 font-sans text-[11.5px] ${f.severity === 'high' ? 'bg-[color-mix(in_srgb,var(--err)_20%,transparent)] text-[var(--err)]' : 'bg-[var(--bg-field)]'}`}>{t(`assetDrawer.severity_${f.severity}`)}</span>
                    <span className="min-w-0 truncate" title={f.quote}>{f.file}{f.line ? `:${f.line}` : ''}  {f.quote}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            <SettingsButton className="mt-3" disabled={checking} onClick={runCheck}>{t('assetDrawer.publishCheckAgain')}</SettingsButton>
          </>
        )}
      </Step>
      <Step n={2} title={t('assetDrawer.publishStep2')} done={Boolean(verify?.same) && !young}>
        <p>{t('assetDrawer.publishStep2Note').replace('{path}', `skills/${skill.name}/`)}</p>
        <div className="mt-3 flex gap-2">
          <input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="https://github.com/you/your-repo" disabled={!check?.ready}
            className="h-9 min-w-0 flex-1 rounded-[8px] border border-[var(--border)] bg-transparent px-3 font-mono text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--text-muted)] disabled:opacity-50" />
          <SettingsButton disabled={!check?.ready || !repo.trim() || verifying} onClick={runVerify}>
            {verifying ? <Loader2 size={14} className="animate-spin" aria-hidden /> : null}{t('assetDrawer.publishVerify')}
          </SettingsButton>
        </div>
        {error?.step === 2 ? <p role="alert" className="mt-3 text-[var(--warn)]">{error.message}</p> : null}
        {verify ? (
          <div className="mt-3">
            {verify.same ? <p className="text-[var(--ok)]">{t('assetDrawer.publishSame').replace('{commit}', verify.commit.slice(0, 7))}</p> : (
              <>
                <p className="text-[var(--warn)]">{t('assetDrawer.publishDiffer')}</p>
                {[...verify.differ.map((p) => [p, 'publishFileDiffers']), ...verify.onlyHere.map((p) => [p, 'publishFileNotPushed']), ...verify.onlyThere.map((p) => [p, 'publishFileOnlyThere'])].map(([p, why]) => (
                  <p key={`${p}${why}`} className="font-mono text-[12.5px]">{p} <span className="font-sans text-[var(--text-faint)]">· {t(`assetDrawer.${why}`)}</span></p>
                ))}
              </>
            )}
            {young ? <p className="mt-1 text-[var(--warn)]">{t('assetDrawer.publishYoung').replace('{n}', String(verify.ageDays))}</p> : null}
          </div>
        ) : null}
      </Step>
      <Step n={3} title={t('assetDrawer.publishStep3')} done={false}>
        <p>{t('assetDrawer.publishStep3Note')}</p>
        {verify?.same && !young ? (
          <a href={verify.proposeUrl} target="_blank" rel="noreferrer"
            className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[var(--primary)] px-4 text-[14.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)]">
            <Github size={15} aria-hidden />{t('assetDrawer.publishSubmit')}
          </a>
        ) : <p className="mt-2 text-[var(--text-faint)]">{t('assetDrawer.publishSubmitWait')}</p>}
      </Step>
    </div>
  );
}

/**
 * The community indexes Discover reads: OpenFilm's own (always, reviewed), then the ones the person added, each to
 * remove; and one more to add, after being told plainly that OpenFilm does not review what it lists.
 */
function SourcesPanel({ onChanged }: { onChanged: () => void }) {
  const t = useT();
  const [sources, setSources] = React.useState<string[] | null>(null);
  const [draft, setDraft] = React.useState('');
  const [asking, setAsking] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => { void sourcesApi.communitySources().then(setSources, () => setSources([])); }, []);
  const save = (next: string[]) => {
    setError(null);
    void sourcesApi.setCommunitySources(next).then((kept) => { setSources(kept); setDraft(''); onChanged(); }, (e) => setError(e instanceof Error ? e.message : String(e)));
  };
  return (
    <>
      <SettingsGroup title={t('assetDrawer.sourcesOfficial')}>
        <PluginRow mark={<KindMark kind="workbenches" icon={COMMUNITY_ICON} />} title="openfilm/community" note={t('gallery.trustReviewed')} summary={t('assetDrawer.sourcesOfficialNote')} control={null} />
      </SettingsGroup>
      <SettingsGroup title={t('assetDrawer.sourcesAdded')} footnote={t('assetDrawer.sourcesWarning')}>
        {(sources ?? []).map((address) => (
          <PluginRow key={address} mark={<KindMark kind="workbenches" icon={Globe} />} title={hostOf(address)} summary={address}
            control={<SettingsButton variant="quiet" onClick={() => save((sources ?? []).filter((a) => a !== address))}>{t('assetDrawer.sourcesRemove')}</SettingsButton>} />
        ))}
        <div className="flex gap-2 py-4">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="https://example.com/openfilm-index.json"
            className="h-9 min-w-0 flex-1 rounded-[8px] border border-[var(--border)] bg-transparent px-3 font-mono text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-[var(--text-muted)]" />
          <SettingsButton disabled={!draft.trim()} onClick={() => setAsking(true)}>{t('assetDrawer.sourcesAdd')}</SettingsButton>
        </div>
        {error ? <p role="alert" className="pb-3 text-[13.5px] text-[var(--warn)]">{error}</p> : null}
      </SettingsGroup>
      <ConfirmDialog open={asking} title={t('assetDrawer.sourcesAddTitle')} description={t('assetDrawer.sourcesAddNote').replace('{host}', hostOf(draft.trim()))}
        confirmLabel={t('assetDrawer.sourcesAdd')} onCancel={() => setAsking(false)} onConfirm={() => { setAsking(false); save([...(sources ?? []), draft.trim()]); }} />
    </>
  );
}
