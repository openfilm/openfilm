/**
 * The plugins (in their own window, components/PluginsWindow): everything that teaches OpenFilm one more kind of work.
 * A plugin is a package (skills, commands, a surface); one that shows only in the conversation is a skill, one that
 * also shows outside it is a plugin (lib/project-plugins isPlugin). People look for what OpenFilm can do, not for which
 * of the two it is, so both are here, each in the one category of what it helps make (lib/plugin-profile).
 *
 * Mine: the person's workbenches as tiles in their order (dragged to change it), their skills as lines, what an agent
 * brings of its own folded; each with its switch (a plugin: on, its workbench or its tab of the library is shown and
 * agents are given its skills; a skill: on, agents take it up when it fits; off, neither, and a film made with it
 * plays and exports the same). Discover and Favorites show each kind as what it is (library/CommunityViews). A click
 * opens its page, which sums it up at the top as a model's page does (library/PluginProfile), then
 * says what it does, where to open it and what it brings: a plugin of OpenFilm's own here, any other its skill's
 * (SkillPage). Discover lists everything there is to install, OpenFilm's and then the community's, each with Install,
 * or said installed once it is (it stays there). Turning on a plugin with a workbench says where it now is, with the
 * way to show it (`onWorkbenchOn`).
 */
import React from 'react';
import {
  ArrowLeft, ArrowUpRight, AudioLines, BadgeCheck, Box, Check, ChevronLeft, ChevronRight, Clapperboard, Github, Globe, BookOpenText, Loader2, Music, Power, Puzzle, RefreshCw, SquareTerminal, Trash2, Upload, X, type LucideIcon,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost, type HostAgentId } from '@/lib/host';
import { inPersonsOrder, isInstalled, removePlugin, setPluginOn, setWorkbenchOrder, usePlugins, useWorkbenchOrder, type Plugin } from '@/lib/plugins';
import { MAC } from '@/lib/keymap-store';
import { openExample, showPluginsLine, type PluginsLine } from '@/lib/plugins-window';
import { isPlugin, pluginOfSkill } from '@/lib/project-plugins';
import { communityOf, fetchErrorKey, forgetSeenSkills, makerOf, ownerOf, seenCatalog, seenExamples, seenSkills, sourcesApi, SourceError, watchSkills, type Example, type PublishCheck, type PublishVerify, type SkillEntry } from '@/lib/project-sources';
import { ConfirmDialog } from '../ConfirmDialog';
import type { ContextMenuEntry } from '../ContextMenu';
import {
  BringsLine, byOrder, CommandChips, ForDevelopers, HowToUse, TrustMark, hostOf, useScriptsConsent, inLanguage, PageSection, SkillCover, SkillMark, SkillPage, useSkillWords,
} from '../SkillPage';
import { CATEGORIES, categoryOfSkill, usesOfPlugin, type Category } from '@/lib/plugin-profile';
import { ProfileStrip } from './PluginProfile';
import { SettingsButton, SettingsGroup, SettingsSwitch } from '../settings/ui';
import { LARGE_DIALOG_COLUMN as PAGE_INSET } from '../dialog-chrome';
import { ASSET_KINDS, COMMUNITY_ICON, KindIcon, isCodeKind, type FeatureKind } from '../feature-kinds';
import { BUILT_IN, inLibrary, libraryUrl, soundLook, nameOf, packItems, packOf, posterUrl, previewUrl, savePack, setAdded, templatePreviewUrl, TEXT_COMPONENT, useLibraryAdded, useLibraryIndex, type LibraryCategory, type LibraryItem, type LibraryPack } from '@/lib/library';
import { isClipMotion } from '@/lib/clip-presets';
import { copyFromLibrary, packKey, shelfActions, useLibraryPlaces } from '@/lib/library-places';
import { refreshSaved, SAVED } from '@/lib/saved';
import { PLAIN } from './OnPicture';
import { TextStyleSample } from './TextStyleSample';

export { PLUGIN_ICONS } from '../WorkbenchMark';
import { WorkbenchMark } from '../WorkbenchMark';
import { AppIcon } from '../AppIcon';
import { DetailShell, Facts, ManageButton, PageButton, StateMark, STORE_GRID, StoreChips, StoreCard, StoreSection } from './Store';
import { AddButton, ASSET_GRID, AssetCover, AssetTile, Badge, BenchGrid, GroupList, InMark, FoldedGroup, GradientCover, Hero, PackTile, packGrid, ROW_GRID, Scroller, Shelf, SoundList, shapeOf, type BenchTileItem, type Featured, type GroupItem } from './CommunityViews';

/** A plugin as people see it: its title and summary in the language shown, else its id. */
export function usePluginWords() {
  const lang = useLanguage();
  return (plugin: Pick<Plugin, 'id' | 'title' | 'summary'>) => ({ title: inLanguage(plugin.title, lang) ?? plugin.id, summary: inLanguage(plugin.summary, lang) ?? '' });
}

const Beta = Badge;

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

  const agents = useAgentExtras(line === 'plugins' || line === 'skills');
  /* how many use each community item (anonymous counts; none when unknown) */
  const [stats, setStats] = React.useState<Record<string, { installs: number }>>({});
  React.useEffect(() => { let live = true; void sourcesApi.communityStats().then((r) => { if (live) setStats(r); }); return () => { live = false; }; }, []);
  const library = useLibraryIndex();
  /* the community's packs and things added to the library; OpenFilm's own are in it unless taken out of the drawer */
  const added = useLibraryAdded();
  const { hidden, folders } = useLibraryPlaces();
  const packIn = (p: LibraryPack) => (p.official ? !hidden.includes(packKey(p.group)) : added.includes(p.id));
  const failed = (e: unknown) => setError(e instanceof Error && e.message !== 'failed' ? e.message : t('assetDrawer.mediaSaveFailed'));
  /* a pack of media is kept as a folder of the person's own (its files copied in, the pack then added); any other is added */
  const addPack = (p: LibraryPack) => {
    if (p.official) { void shelfActions.hide(packKey(p.group), false); return; }
    if (p.cats.length && p.cats.every((c) => (c as string) === 'media')) { setError(null); void savePack(p.id, lang).then(() => refreshSaved(), failed); return; }
    setAdded(p.id, true); seePackVersion(p);
  };
  /* a media file alone goes into the person's first folder (as "Save to" puts things); any other thing is added */
  const addThing = (it: LibraryItem) => {
    if (it.kind !== 'file') { setAdded(it.id, true); return; }
    setError(null);
    void copyFromLibrary(`${BUILT_IN}/${it.id}`, folders[0]?.path ?? SAVED, nameOf(it.name, lang)).then(() => setAdded(it.id, true), failed);
  };
  /* a pack taken out of the library: one of OpenFilm's own hidden from the drawer (got back here), any other let go
     (media saved into a folder of the person's stay theirs) */
  const removePack = (p: LibraryPack) => {
    if (p.official) { void shelfActions.hide(packKey(p.group), true); return; }
    setAdded(p.id, false);
  };
  /* a community pack got, whose catalog has a newer version than the one the person got */
  const packNewer = (p: LibraryPack) => !p.official && packIn(p) && Boolean(p.version) && (p.version ?? 0) > seenPackVersion(p);
  /* got again at its newer version: media saved anew into a folder of its own, any other is read from the catalog as it is */
  const updatePack = (p: LibraryPack) => {
    seePackVersion(p);
    if (p.cats.length && p.cats.every((c) => (c as string) === 'media')) { setError(null); void savePack(p.id, lang).then(() => refreshSaved(), failed); return; }
    setAdded(p.id, true);
  };
  /* a kind with thousands (OpenFilm's sounds): shown a page at a time */
  const [shown, setShown] = React.useState(STORE_PAGE);
  /* one of the library's things shown large over the page, among those it was opened from (stepped through by arrows) */
  const [preview, setPreview] = React.useState<{ items: readonly LibraryItem[]; at: number } | null>(null);
  /* one of the library's things asked for by its page (`asset:<id>`, from elsewhere): shown large over its kind's page */
  React.useEffect(() => {
    const it = opened?.startsWith(ASSET_PAGE) ? library?.items.find((x) => x.id === opened.slice(ASSET_PAGE.length)) : undefined;
    if (!it) return;
    setPreview({ items: [it], at: 0 });
    onOpen(null);
    showPluginsLine(`kind:${it.cat}`);
  }, [opened, library, onOpen]);
  /* the kind of plugin, the category of skill picked on their pages (none: all) */
  const [pluginSort, setPluginSort] = React.useState<'editors' | 'connectors' | 'community' | null>(null);
  const [skillSort, setSkillSort] = React.useState<Category | null>(null);
  /* the order the person put their workbenches in */
  const benchOrder = useWorkbenchOrder();
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
  /* one of OpenFilm's own the person got, removed: back in the store to get (one OpenFilm comes with is only turned off) */
  const dropPlugin = (plugin: Plugin) => {
    setError(null);
    void removePlugin(plugin.id).then(() => { forgetSeenSkills(); return sourcesApi.skills(projectId).then(setSkills); })
      .catch((e: unknown) => setError(e instanceof Error && e.message !== 'failed' ? e.message : t('assetDrawer.pluginFailed')));
  };
  /* a skill (or a plugin someone made) removed: an official one back in the store, the person's own or a project's to the trash */
  const dropSkill = (skill: SkillEntry) => {
    setSkills((list) => (skill.source === 'official' ? list.map((k) => (k.uid === skill.uid ? { ...k, installed: false } : k)) : list.filter((k) => k.uid !== skill.uid)));
    const done = skill.source === 'official' ? sourcesApi.setSkillInstalled(skill.uid, false) : sourcesApi.removeSkill(skill.uid, projectId);
    void Promise.resolve(done).catch(() => {}).finally(() => { void sourcesApi.skills(projectId).then(setSkills); });
  };
  /* what can be done with one of the person's own, from its gear: turn it off or on, remove it, see its page */
  const manageItems = (o: { on: boolean; title: string; onTurn: (on: boolean) => void; onRemove?: (() => void) | undefined; onOpen: () => void; trash?: boolean }): ContextMenuEntry[] => [
    { id: 'turn', label: t(o.on ? 'assetDrawer.manageOff' : 'assetDrawer.manageOn'), icon: <Power size={15} />, onSelect: () => o.onTurn(!o.on) },
    { id: 'page', label: t('assetDrawer.managePage'), icon: <ArrowUpRight size={15} />, onSelect: o.onOpen },
    ...(o.onRemove ? [{ id: 'sep', separator: true } as ContextMenuEntry, { id: 'remove', label: t(o.trash ? 'gallery.remove' : 'assetDrawer.manageRemove'), icon: <Trash2 size={15} />, danger: true, onSelect: o.onRemove }] : []),
  ];
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
      onTurn={ownPage.soon ? undefined : (on) => turnPlugin(ownPage, on)} onRemove={ownPage.builtIn || !isInstalled(ownPage) ? undefined : () => dropPlugin(ownPage)} />;
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
  /* in the film's order (the category each says it is in), else as they were */
  const inOrder = <T,>(list: T[], categoryOf: (item: T) => Category) => list
    .map((item, i) => ({ item, i, c: CATEGORIES.indexOf(categoryOf(item)) })).sort((x, y) => x.c - y.c || x.i - y.i).map((x) => x.item);
  /* a skill installed (or a workbench someone made, turned as the skill it is), on its switch */
  const fromOf = (skill: SkillEntry) => (communityOf(skill) ? makerOf(skill)
    : skill.source === 'mine' ? t('assetDrawer.source_mine') : skill.source === 'project' ? t('assetDrawer.skillProject') : undefined);
  /* a workbench is what shows outside the conversation: OpenFilm's with a workbench or a tab of the library, anyone's with a page */
  /* a plugin, not a skill: it brings an editor (a workbench, a tab) or connects the agent to a service */
  const ownBench = (p: Plugin) => Boolean(p.workbench || p.tab || p.mcpServers);

  /* the library's kinds as its tabs list them: OpenFilm's own first, then the community's (sent by someone, `by`); all
     there already, in the library's tabs (a clip's motion and a moving line of words are another tab's, not shown) */
  const assetsOf = (kind: LibraryCategory | 'media') => {
    const all = (library?.items ?? []).filter((it) => (it.cat as string) === kind && !isClipMotion(it) && it.kind !== 'textmotion'
      && matches(nameOf(it.name, lang), it.by, ...(it.tags ?? [])));
    return [...all.filter((it) => !it.by), ...all.filter((it) => it.by)];
  };

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
     said so */
  const read = seenCatalog();
  const note = discover === 'partial' ? t('assetDrawer.discoverPartial') : discover === 'failed'
    ? (read ? t('assetDrawer.discoverOffline').replace('{when}', new Date(read).toLocaleString()) : t('assetDrawer.discoverNever'))
    : null;
  const waiting = discover === 'reading' && !offered.length && !q;
  /* whose it is: OpenFilm's own with its tick, else its maker and how far the community vouches for it */
  const publisher = (k?: SkillEntry) => (k && communityOf(k)
    ? <span className="inline-flex min-w-0 items-center gap-1.5"><span className="truncate">{makerOf(k)}</span><TrustMark skill={k} /></span>
    : <span className="inline-flex items-center gap-1">OpenFilm<BadgeCheck size={13} strokeWidth={2} aria-label={t('gallery.trustOfficial')} className="text-[var(--text-muted)]" /></span>);
  /* how many use it, else what kind of thing it is */
  const metaOf = (installs: number | undefined, kind: string) => (installs ? t('assetDrawer.installs').replace('{n}', installs.toLocaleString()) : kind);
  /* one of OpenFilm's own plugins in the store: Get, or said here (installed, or off) */
  const pluginCard = (p: Plugin) => {
    const { title, summary } = pluginWords(p);
    const got = isInstalled(p);
    return <StoreCard key={p.id} icon={<WorkbenchMark plugin={p} size={44} />} title={title} summary={summary} onOpen={() => open(`${PLUGIN_PAGE}${p.id}`)}
      by={publisher()} badges={p.beta && !p.soon ? <Beta>{t('assetDrawer.pluginBeta')}</Beta> : null} dim={got && !p.on}
      action={p.soon ? <SoonMark /> : got ? <StateMark off={!p.on} />
        : <AddButton label={t('assetDrawer.getNamed').replace('{name}', title)} onClick={() => turnPlugin(p, true)} />} />;
  };
  /* a plugin or a skill of the catalog (OpenFilm's or the community's): Get installs it, asked first when it brings scripts */
  const catalogCard = (k: SkillEntry) => (
    <StoreCard key={k.uid} icon={isPlugin(k) ? <WorkbenchMark plugin={pluginOfSkill(k)} size={44} /> : <SkillMark skill={k} size={44} />}
      cover={isPlugin(k) ? undefined : (hover) => <SkillCover skill={k} title={words(k).title} playing={hover} />}
      title={words(k).title} summary={words(k).summary} onOpen={() => open(k.uid)} by={publisher(k)} dim={installedOf(k) && Boolean(k.off)}
      meta={metaOf(stats[k.uid]?.installs, t(`assetDrawer.skillCat_${categoryOfSkill(k)}`))}
      action={installedOf(k) ? <StateMark off={Boolean(k.off)} />
        : <AddButton label={t('assetDrawer.getNamed').replace('{name}', words(k).title)} busy={installing === k.uid} disabled={installing != null} onClick={() => consent.ask(k, () => install(k))} />} />
  );
  /* a pack among its kind's things: its picture, its name, how many it holds; added whole to the library from here */
  const packTile = (p: LibraryPack) => (
    <PackTile key={p.id} cat={p.cats[0] ?? 'sound'} name={nameOf(p.name, lang)} count={t('assetDrawer.countItems').replace('{n}', p.count.toLocaleString())} by={p.by ?? t('assetDrawer.skillsOfficial')}
      cover={<PackCover pack={p} first={packItems(library, p)[0]} lang={lang} />} here={packIn(p)} newer={packNewer(p)}
      onOpen={() => open(`${PACK_PAGE}${p.id}`)} onAdd={() => addPack(p)} />
  );
  /* one of the library's things large over the page: what to do with it is its pack's (got whole), or, a file, kept */
  const lightbox = preview ? (
    <AssetLightbox items={preview.items} at={preview.at} lang={lang} onAt={(at) => setPreview({ ...preview, at })} onClose={() => setPreview(null)}
      packOf={(it) => { const p = packOf(library, it); return p && !p.lone ? p : undefined; }} packIn={packIn} here={(it) => inLibrary(it, added)}
      onGetPack={addPack} onAdd={addThing} onPack={(p) => { setPreview(null); open(`${PACK_PAGE}${p.id}`); }} />
  ) : null;
  /* the packs of a kind (none: of every kind): OpenFilm's first, then the community's (a thing listed alone is among the things, not here) */
  const packsOf = (kind: FeatureKind | null) => (library?.packs ?? [])
    .filter((p) => !p.lone && (!kind || (p.cats as readonly string[]).includes(kind)) && matches(nameOf(p.name, lang), p.by))
    .sort((a, b) => Number(Boolean(b.official)) - Number(Boolean(a.official)));
  /* the library's things as what they are: moving pictures, stickers, words in a grid; sounds and music in a list;
     each with one thing to do, adding it to the library */
  const assetTile = (it: LibraryItem, i: number, list: readonly LibraryItem[]) => (
    <AssetTile key={it.id} item={it} lang={lang} here={inLibrary(it, added)} onOpen={() => setPreview({ items: list, at: i })} onAdd={() => addThing(it)} />
  );
  const assetsView = (cat: string, list: readonly LibraryItem[]) => {
    const shape = shapeOf(cat);
    if (shape !== 'sound') return <div className={ASSET_GRID[shape]}>{list.map(assetTile)}</div>;
    return <SoundList items={list} lang={lang} onOpen={(it) => setPreview({ items: list, at: Math.max(0, list.indexOf(it)) })}
      action={(it) => (inLibrary(it, added) ? <InMark label={t('assetDrawer.inLibrary')} />
        : <AddButton label={t('assetDrawer.addToLibrary')} text={t('assetDrawer.add')} onClick={() => addThing(it)} />)} />;
  };
  const status = (
    <>
      {note ? (
        <div role="status" className="mb-6 flex items-start gap-3 rounded-[14px] bg-[var(--bg-field)] px-4 py-3 text-[13.5px] leading-relaxed text-[var(--text-muted)]">
          <p className="min-w-0 flex-1">{note}</p>
          <SettingsButton onClick={() => setRetry((n) => n + 1)}><RefreshCw size={14} />{t('assetDrawer.discoverRetry')}</SettingsButton>
        </div>
      ) : null}
      {error ? <p role="alert" className="mb-4 text-[13.5px] text-[var(--warn)]">{error}</p> : null}
    </>
  );
  /* the way to share what one made, wherever a shelf has nothing yet and at the foot of Discover */
  const publishCall = (text: string) => (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[18px] bg-[var(--bg-field)] px-6 py-5">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-[var(--bg-pressed)] text-[var(--accent)]"><Upload size={19} aria-hidden /></span>
      <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-[var(--text-muted)]">{text}</p>
      <AddButton label={t('assetDrawer.publishAction')} text={t('assetDrawer.publishAction')} onClick={() => showPluginsLine('publish')} />
    </div>
  );
  const kindName = (kind: FeatureKind) => t(isCodeKind(kind) ? `assetDrawer.view_${kind}` : `assetDrawer.cat_${kind}`);

  /* a pack: what it holds, each seen or heard large; got whole, removed, or got again when the Community has a newer one (`pack:<id>`) */
  const packPage = opened?.startsWith(PACK_PAGE) ? library?.packs?.find((p) => p.id === opened.slice(PACK_PAGE.length)) : undefined;
  if (packPage) {
    const things = packItems(library, packPage).filter((it) => !isClipMotion(it) && it.kind !== 'textmotion');
    return (
      <>
        <PackPage pack={packPage} items={things} lang={lang} here={packIn(packPage)} newer={packNewer(packPage)}
          view={assetsView(things[0]?.cat ?? '', things)} onBack={() => open(null)}
          onAdd={() => addPack(packPage)} onRemove={() => removePack(packPage)} onUpdate={() => updatePack(packPage)}
          {...(packPage.by ? { onAuthor: () => showPluginsLine(`author:${(packPage.by ?? '').toLowerCase()}`) } : {})} />
        {lightbox}
      </>
    );
  }

  /* an author's page: what they made, plugins and skills as Discover lists them, then the library's things */
  if (line.startsWith('author:')) {
    const who = line.slice('author:'.length);
    const theirs = found.filter((k) => communityOf(k) && ownerOf(k) === who);
    const theirThings = (library?.items ?? []).filter((it) => it.by?.toLowerCase() === who && matches(nameOf(it.name, lang), ...(it.tags ?? [])));
    return (
      <PluginsPage key={line} title={who} note={t('assetDrawer.note_author').replace('{n}', String(theirs.length + theirThings.length))}>
        {consent.dialog}
        {theirs.length ? <div className={`mb-8 ${ROW_GRID}`}>{theirs.map(catalogCard)}</div> : null}
        {theirThings.length ? <div className={ASSET_GRID.video}>{theirThings.map(assetTile)}</div> : null}
        {lightbox}
      </PluginsPage>
    );
  }

  /* what there is of each sort: OpenFilm's own plugins (turned on here), the catalog's plugins and skills (installed
     here), what is still being made */
  const ownPlugins = ownMatched.filter((p) => ownBench(p) && !p.soon);
  const catalogPlugins = offered.filter((k) => isPlugin(k));
  const catalogSkills = offered.filter((k) => !isPlugin(k));
  const byInstalls = <T extends SkillEntry>(list: T[]) => [...list].sort((a, b) => (stats[b.uid]?.installs ?? 0) - (stats[a.uid]?.installs ?? 0));

  /* Mine: what the person has, managed as Settings lists things. What can be updated first; their plugins in their
     order (dragged to change it: the top right's menu and its keys follow), each on its switch; their skills, each on
     its switch; what an agent brings of its own and what it connects to, folded into a line each */
  if (line === 'mine') {
    const theirBenches = listed.filter((k) => isPlugin(k));
    const skillOf = new Map(theirBenches.map((k) => [k.uid, k]));
    const benchList = inPersonsOrder([...ownPlugins.filter(isInstalled), ...theirBenches.map(pluginOfSkill)], benchOrder);
    /* the keys the top right's menu gives them (Motion is picked on the edit's timeline) */
    const keyed = benchList.filter((p) => p.on && p.workbench && p.workbench !== 'motion');
    const benchItems = benchList.map((p): BenchTileItem => {
      const k = skillOf.get(p.id);
      const at = keyed.indexOf(p);
      const keyHint = at >= 0 && at < 9 ? `${MAC ? '⌥' : 'Alt+'}${at + 1}` : undefined;
      if (k) {
        const title = words(k).title;
        return { plugin: p, title, summary: words(k).summary, keyHint, onOpen: () => open(k.uid),
          badges: fromOf(k) ? <span className="shrink-0 truncate text-[12px] text-[var(--text-faint)]">{fromOf(k)}</span> : undefined,
          control: <MineControl off={Boolean(k.off)} label={t('assetDrawer.manageNamed').replace('{name}', title)}
            items={manageItems({ on: !k.off, title, onTurn: (on) => turnSkill(k, on), onRemove: () => dropSkill(k), onOpen: () => open(k.uid), trash: k.source !== 'official' })} /> };
      }
      const { title, summary } = pluginWords(p);
      return { plugin: p, title, summary, keyHint, onOpen: () => open(`${PLUGIN_PAGE}${p.id}`),
        badges: p.beta ? <Beta>{t('assetDrawer.pluginBeta')}</Beta> : undefined,
        control: <MineControl off={!p.on} label={t('assetDrawer.manageNamed').replace('{name}', title)}
          items={manageItems({ on: p.on, title, onTurn: (on) => turnPlugin(p, on), onRemove: p.builtIn ? undefined : () => dropPlugin(p), onOpen: () => open(`${PLUGIN_PAGE}${p.id}`) })} /> };
    });
    const connectors = agents.mcp.map((g) => ({ ...g, servers: g.servers.filter((k) => matches(k.name, k.detail)) })).filter((g) => g.servers.length);
    const mineSkills = inOrder(listed.filter((k) => !isPlugin(k)), categoryOfSkill);
    const ownSkills = ownMatched.filter((p) => !ownBench(p) && !p.soon && isInstalled(p));
    const updates = listed.filter((k) => k.update && !k.revoked);
    const skillRows: GroupItem[] = [
      ...ownSkills.map((p): GroupItem => {
        const { title, summary } = pluginWords(p);
        return { key: p.id, icon: <WorkbenchMark plugin={p} size={36} />, title, summary, dim: !p.on, onOpen: () => open(`${PLUGIN_PAGE}${p.id}`),
          badges: p.beta ? <Beta>{t('assetDrawer.pluginBeta')}</Beta> : undefined,
          control: <MineControl off={!p.on} label={t('assetDrawer.manageNamed').replace('{name}', title)}
            items={manageItems({ on: p.on, title, onTurn: (on) => turnPlugin(p, on), onRemove: p.builtIn ? undefined : () => dropPlugin(p), onOpen: () => open(`${PLUGIN_PAGE}${p.id}`) })} /> };
      }),
      ...mineSkills.map((k): GroupItem => ({
        key: k.uid, icon: <SkillMark skill={k} size={36} />, title: words(k).title, dim: Boolean(k.off), onOpen: () => open(k.uid),
        summary: k.revoked ? t('gallery.revokedNote').replace('{reason}', t(`gallery.revoked_${k.revoked.reason}`)) : k.waits ? t('assetDrawer.waitsNote') : words(k).summary,
        badges: fromOf(k) ? <span className="shrink-0 truncate text-[12px] text-[var(--text-faint)]">{fromOf(k)}</span> : undefined,
        control: k.revoked ? <span className="text-[13px] font-medium text-[var(--err)]">{t('gallery.revokedShort')}</span>
          : k.waits ? <AddButton label={t('assetDrawer.reviewAndAllow')} text={t('assetDrawer.reviewAndAllow')} onClick={() => open(k.uid)} />
          : <MineControl off={Boolean(k.off)} label={t('assetDrawer.manageNamed').replace('{name}', words(k).title)}
            items={manageItems({ on: !k.off, title: words(k).title, onTurn: (on) => turnSkill(k, on), onRemove: k.core ? undefined : () => dropSkill(k), onOpen: () => open(k.uid), trash: k.source !== 'official' })} />,
      })),
    ];
    /* the library's packs the person got from the Community, and OpenFilm's own they took out (to put back) */
    const packThumb = (p: LibraryPack) => (
      <span className="relative block h-9 w-9 overflow-hidden rounded-[9px] bg-[var(--bg-pressed)]"><PackCover pack={p} first={packItems(library, p)[0]} lang={lang} /></span>
    );
    const packRows: GroupItem[] = [
      ...(library?.packs ?? []).filter((p) => !p.lone && !p.official && added.includes(p.id) && matches(nameOf(p.name, lang), p.by)).map((p): GroupItem => {
        const name = nameOf(p.name, lang);
        const newer = packNewer(p);
        return { key: `pack:${p.id}`, icon: packThumb(p), title: name, onOpen: () => open(`${PACK_PAGE}${p.id}`),
          summary: [p.by, t('assetDrawer.countItems').replace('{n}', p.count.toLocaleString()), p.version ? `v${p.version}` : ''].filter(Boolean).join(' · '),
          badges: newer ? <span className="shrink-0 rounded-full bg-[var(--text)] px-1.5 py-0.5 text-[10.5px] font-semibold leading-none text-[var(--dialog-main)]">{t('assetDrawer.packNewer')}</span> : undefined,
          control: (
            <span className="flex items-center gap-1.5">
              {newer ? <AddButton label={t('assetDrawer.packUpdate').replace('{v}', String(p.version))} text={t('assetDrawer.update')} onClick={() => updatePack(p)} /> : null}
              <ManageButton label={t('assetDrawer.manageNamed').replace('{name}', name)} items={[
                { id: 'page', label: t('assetDrawer.managePage'), icon: <ArrowUpRight size={15} />, onSelect: () => open(`${PACK_PAGE}${p.id}`) },
                { id: 'sep', separator: true },
                { id: 'remove', label: t('assetDrawer.packRemove'), icon: <Trash2 size={15} />, danger: true, onSelect: () => removePack(p) },
              ]} />
            </span>
          ) };
      }),
      ...(library?.packs ?? []).filter((p) => p.official && !p.lone && hidden.includes(packKey(p.group)) && matches(nameOf(p.name, lang))).map((p): GroupItem => ({
        key: `hidden:${p.id}`, icon: packThumb(p), title: nameOf(p.name, lang), dim: true, onOpen: () => open(`${PACK_PAGE}${p.id}`),
        summary: t('assetDrawer.packTakenOut'),
        control: <AddButton label={t('assetDrawer.packPutBack')} text={t('assetDrawer.packPutBack')} onClick={() => addPack(p)} />,
      })),
    ];
    const nothing = !benchItems.length && !connectors.length && !skillRows.length && !agentsOwn.length && !packRows.length;
    const count = t('assetDrawer.mineCount').replace('{plugins}', String(benchItems.length)).replace('{skills}', String(skillRows.length));
    return (
      <PluginsPage key={line} title={t('assetDrawer.place_mine')} note={nothing ? undefined : count}>
        {consent.dialog}
        {status}
        {updates.length ? (
          <Shelf title={t('assetDrawer.updates')}>
            <GroupList items={updates.map((k): GroupItem => ({
              key: `update:${k.uid}`, icon: <SkillMark skill={k} size={36} />, title: words(k).title, onOpen: () => open(k.uid),
              summary: t('gallery.updateOut').replace('{version}', k.update!.version),
              control: <AddButton label={t('assetDrawer.update')} text={t('assetDrawer.update')} busy={installing === k.uid}
                onClick={() => { setInstalling(k.uid); void sourcesApi.updateSkill(k.uid).then(() => sourcesApi.skills(projectId).then(setSkills), (e: unknown) => setError(e instanceof Error ? e.message : String(e))).finally(() => setInstalling(null)); }} />,
            }))} />
          </Shelf>
        ) : null}
        {benchItems.length ? (
          <Shelf title={t('assetDrawer.tab_plugins')} note={benchItems.length > 1 ? t('assetDrawer.dragToSort') : undefined}>
            <BenchGrid items={benchItems} onOrder={(ids) => { void setWorkbenchOrder(ids); }} />
          </Shelf>
        ) : null}
        {skillRows.length || agentsOwn.length ? (
          <Shelf title={t('assetDrawer.tab_skills')} note={t('assetDrawer.note_mineSkills')}>
            {skillRows.length ? <GroupList items={skillRows} /> : null}
            {agentsOwn.map((g) => (
              <FoldedGroup key={`skills:${g.id}`} icon={BookOpenText} title={t('assetDrawer.agentSkillsTitle').replace('{name}', g.name)}
                count={t('assetDrawer.agentSkillsCount').replace('{n}', String(g.skills.length)).replace('{on}', String(g.skills.filter((k) => k.allowed).length))}
                footnote={t('assetDrawer.agentOwnNote').replace('{name}', g.name)}>
                {g.skills.map((k) => (
                  <AgentLine key={k.name} title={k.name} detail={k.description}
                    control={<SettingsSwitch checked={k.allowed} onChange={(on) => agents.allow(g.id, k.name, on)} label={t(k.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', k.name)} />} />
                ))}
              </FoldedGroup>
            ))}
          </Shelf>
        ) : null}
        {packRows.length ? (
          <Shelf title={t('assetDrawer.minePacks')} note={t('assetDrawer.note_minePacks')}>
            <GroupList items={packRows} />
          </Shelf>
        ) : null}
        {connectors.length ? (
          <Shelf title={t('assetDrawer.connectors')} note={t('assetDrawer.note_connectors')}>
            {connectors.map((g) => (
              <FoldedGroup key={`mcp:${g.id}`} icon={Puzzle} title={t('assetDrawer.agentConnectorsTitle').replace('{name}', g.name)}
                count={t('assetDrawer.agentConnectorsCount').replace('{n}', String(g.servers.length))}
                footnote={g.filtered ? t('assetDrawer.connectorsNote').replace('{name}', g.name) : t('assetDrawer.connectorsAll').replace('{name}', g.name)}>
                {g.servers.map((k) => (
                  <AgentLine key={k.name} title={k.name} detail={k.detail}
                    control={g.filtered ? <SettingsSwitch checked={k.allowed} onChange={(on) => agents.allowMcp(g.id, k.name, on)} label={t(k.allowed ? 'gallery.turnOff' : 'gallery.turnOn').replace('{name}', k.name)} /> : null} />
                ))}
              </FoldedGroup>
            ))}
          </Shelf>
        ) : null}
        {nothing ? <Empty text={t(q ? 'assetDrawer.noSkillsFound' : 'assetDrawer.mineNone')} action={q ? undefined : { label: t('assetDrawer.tab_plugins'), run: () => showPluginsLine('plugins') }} /> : null}
      </PluginsPage>
    );
  }

  /* Plugins: a banner of what is put forward, OpenFilm's own (turned on here), the catalog's (installed here), each
     on a shelf */
  if (line === 'examples') return <ExamplesStore query={q} />;
  /* Plugins: what each kind is (editors: a way of working on the film; connectors: a service the agent reaches), each
     a grid of cards; OpenFilm's own first, then the catalog's, then the community's. Get, then it is the person's */
  if (line === 'plugins') {
    const officialCatalog = byInstalls(catalogPlugins.filter((k) => !communityOf(k)));
    const community = byInstalls(catalogPlugins.filter((k) => communityOf(k)));
    const editors = ownPlugins.filter((p) => !p.mcpServers);
    const connectors = ownPlugins.filter((p) => p.mcpServers);
    const sorts = [
      { key: 'editors' as const, label: t('assetDrawer.shelfEditors'), note: t('assetDrawer.note_shelfEditors'), cards: [...editors.map(pluginCard), ...officialCatalog.map(catalogCard)] },
      { key: 'connectors' as const, label: t('assetDrawer.shelfConnectors'), note: t('assetDrawer.note_shelfConnectors'), cards: connectors.map(pluginCard) },
      { key: 'community' as const, label: t('assetDrawer.fromCommunity'), note: undefined, cards: community.map(catalogCard) },
    ].filter((x) => x.cards.length);
    const pick = sorts.some((x) => x.key === pluginSort) ? pluginSort : null;
    return (
      <PluginsPage key={line} title={t('assetDrawer.tab_plugins')} note={q ? undefined : t('assetDrawer.note_plugins')}>
        {consent.dialog}
        {status}
        <StoreChips label={t('assetDrawer.tab_plugins')} value={pick} onChange={setPluginSort}
          items={sorts.length > 1 ? [{ key: null, label: t('assetDrawer.allItems') }, ...sorts.map((x) => ({ key: x.key, label: x.label, count: x.cards.length }))] : []} />
        {sorts.filter((x) => !pick || x.key === pick).map((x) => (
          <StoreSection key={x.key} title={x.label} note={x.note}><div className={STORE_GRID}>{x.cards}</div></StoreSection>
        ))}
        {!sorts.length ? <Empty text={t('assetDrawer.noSkillsFound')} /> : null}
        {q ? null : publishCall(t('assetDrawer.publishCall'))}
      </PluginsPage>
    );
  }

  /* Skills: a grid for each kind of work they help with (OpenFilm's and the community's together, the most used
     first), one kind at a time when picked */
  if (line === 'skills') {
    const shelves = CATEGORIES.map((c) => ({ c, list: byInstalls(catalogSkills.filter((k) => categoryOfSkill(k) === c)) })).filter((x) => x.list.length);
    const pick = shelves.some((x) => x.c === skillSort) ? skillSort : null;
    return (
      <PluginsPage key={line} title={t('assetDrawer.tab_skills')} note={q ? undefined : t('assetDrawer.note_skills')}>
        {consent.dialog}
        {status}
        <StoreChips label={t('assetDrawer.tab_skills')} value={pick} onChange={setSkillSort}
          items={shelves.length > 1 ? [{ key: null, label: t('assetDrawer.allItems') }, ...shelves.map(({ c, list }) => ({ key: c, label: t(`assetDrawer.skillCat_${c}`), count: list.length }))] : []} />
        {waiting ? (
          <div role="status" aria-label={t('assetDrawer.discoverReading')} className={STORE_GRID}>
            {Array.from({ length: 6 }, (_, i) => <div key={i} aria-hidden className="skeleton h-[156px] rounded-[14px]" />)}
          </div>
        ) : null}
        {shelves.filter((x) => !pick || x.c === pick).map(({ c, list }) => (
          <StoreSection key={c} title={t(`assetDrawer.skillCat_${c}`)} note={t(`assetDrawer.skillCatNote_${c}`)}><div className={STORE_GRID}>{list.map(catalogCard)}</div></StoreSection>
        ))}
        {!catalogSkills.length && !waiting ? <Empty text={t('assetDrawer.noSkillsFound')} /> : null}
        {q ? null : publishCall(t('assetDrawer.publishCall'))}
      </PluginsPage>
    );
  }

  /* The library's things there are to get, a kind at a time or all of them: packs are what is got (and kept in step
     with the Community), each thing seen large over the page and stepped through. All: each kind's packs, a row each;
     one kind (`kind:<kind>`): its packs, then every one of its things. No banner, no coloured tiles: their own pictures */
  const kind = line.startsWith('kind:') ? line.slice('kind:'.length) as FeatureKind : null;
  /* the media always (packs of footage, pictures and sounds of any kind: a kind that grows from the Community); the others
     when the library has some */
  const kinds = ASSET_KINDS.filter((k) => k === 'media' || (library?.items ?? []).some((it) => it.cat === k));
  const kindChips = (
    <StoreChips label={t('assetDrawer.tab_assets')} value={kind} onChange={(k) => showPluginsLine(k ? `kind:${k}` : 'assets')}
      items={[{ key: null, label: t('assetDrawer.allItems') }, ...kinds.map((k) => ({ key: k, label: kindName(k), count: assetsOf(k as LibraryCategory).length, icon: <KindIcon kind={k} size={14} /> }))]} />
  );
  if (!kind) {
    const rows = kinds.map((k) => ({ k, packs: packsOf(k) })).filter((x) => x.packs.length);
    return (
      <PluginsPage key={line} title={t('assetDrawer.tab_assets')} note={q ? undefined : t('assetDrawer.note_assets')}>
        {status}
        {kindChips}
        {rows.map(({ k, packs }) => (
          <StoreSection key={k} title={kindName(k)} note={t('assetDrawer.packsCount').replace('{n}', packs.length.toLocaleString())}
            all={() => showPluginsLine(`kind:${k}`)}>
            <div className={packGrid(k)}>{packs.slice(0, shapeOf(k) === 'sound' || shapeOf(k) === 'sticker' ? 6 : 4).map(packTile)}</div>
          </StoreSection>
        ))}
        {q && !rows.length ? <Empty text={t('assetDrawer.noSkillsFound')} /> : null}
        {q ? null : publishCall(t('assetDrawer.kindNone').replaceAll('{kind}', t('assetDrawer.tab_assets')))}
        {lightbox}
      </PluginsPage>
    );
  }
  const things = assetsOf(kind as LibraryCategory);
  const packs = packsOf(kind);
  return (
    <PluginsPage key={line} title={kindName(kind)} note={q ? undefined : t('assetDrawer.note_kindAsset').replaceAll('{kind}', kindName(kind))}>
      {status}
      {kindChips}
      {things.length || packs.length ? (
        <>
          {packs.length ? <StoreSection title={t('assetDrawer.packs')} note={t('assetDrawer.packsCount').replace('{n}', packs.length.toLocaleString())}><div className={packGrid(kind)}>{packs.map(packTile)}</div></StoreSection> : null}
          <StoreSection title={t('assetDrawer.allItems')} note={t('assetDrawer.countItems').replace('{n}', things.length.toLocaleString())}>
            {assetsView(kind, things.slice(0, shown))}
            {things.length > shown ? (
              <div className="mt-6 flex justify-center">
                <SettingsButton onClick={() => setShown((n) => n + STORE_PAGE)}>{t('assetDrawer.showMoreCards').replace('{n}', (things.length - shown).toLocaleString())}</SettingsButton>
              </div>
            ) : null}
          </StoreSection>
        </>
      ) : q ? <Empty text={t('assetDrawer.noSkillsFound')} />
        : publishCall(t('assetDrawer.kindNone').replaceAll('{kind}', kindName(kind)))}
      {lightbox}
    </PluginsPage>
  );
}

/** Where examples are made and sent from. */
const EXAMPLES_REPO = 'https://github.com/openfilm/community#list-an-example';

/**
 * Examples: whole projects made with OpenFilm, to start from or learn from (the projects window copies one into a new
 * project). A banner of what is put forward, then a shelf for each kind of film; one opened is its page in the
 * projects window. Anyone can send one; the foot says how.
 */
function ExamplesStore({ query }: { query: string }) {
  const t = useT();
  const [examples, setExamples] = React.useState<Example[] | null>(() => seenExamples());
  React.useEffect(() => { let live = true; void sourcesApi.examples().then((list) => { if (live) setExamples(list); }); return () => { live = false; }; }, []);
  const all = examples ?? [];
  /* the kind of film each is; those without one are Other beside the kinds, or All when no example has a kind */
  const sorted = all.some((e) => e.category);
  const kindLabel = (c: string | null) => { if (!c) return t(sorted ? 'assetDrawer.examplesOther' : 'assetDrawer.allItems'); const key = `gallery.cat.${c}`; const label = t(key); return label === key ? c : label; };
  const list = all.filter((e) => !query || [e.title, e.description, kindLabel(e.category)].some((w) => w.toLowerCase().includes(query)));
  const kinds = [...new Set(list.map((e) => e.category))].sort((a, b) => (a == null ? 1 : 0) - (b == null ? 1 : 0));
  const featured: Featured[] = list.filter((e) => e.poster).slice(0, 5).map((e) => ({
    key: e.id, eyebrow: e.category ? kindLabel(e.category) : t('assetDrawer.examplesEyebrow'), title: e.title, summary: e.description, hue: hueOf(e.id), picture: e.poster ?? undefined,
    onOpen: () => openExample(e.id), action: <HeroButton label={t('assetDrawer.exampleOpen')} onClick={() => openExample(e.id)} />,
  }));
  return (
    <PluginsPage key="examples" title={t('assetDrawer.tab_examples')} note={query ? undefined : t('assetDrawer.note_examples')}>
      {query ? null : <Hero items={featured} />}
      {examples == null ? (
        <div role="status" aria-label={t('gallery.loading')} className="grid grid-cols-[repeat(auto-fill,minmax(248px,1fr))] gap-6">
          {Array.from({ length: 6 }, (_, i) => <div key={i} aria-hidden className="skeleton aspect-video rounded-[12px]" />)}
        </div>
      ) : null}
      {kinds.map((k) => (
        <Shelf key={k ?? ''} title={kindLabel(k)}>
          <Scroller width={272}>{list.filter((e) => e.category === k).map((e) => <ExampleTile key={e.id} example={e} kind={kindLabel(e.category)} />)}</Scroller>
        </Shelf>
      ))}
      {examples && !list.length ? <Empty text={query ? t('assetDrawer.noSkillsFound') : t('gallery.empty')} /> : null}
      {query ? null : (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-[18px] bg-[var(--bg-field)] px-6 py-5">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-[var(--bg-pressed)] text-[var(--text)]"><Clapperboard size={19} strokeWidth={1.6} aria-hidden /></span>
          <p className="min-w-0 flex-1 text-[14px] leading-relaxed text-[var(--text-muted)]">{t('assetDrawer.examplesCall')}</p>
          <AddButton label={t('assetDrawer.examplesSend')} text={t('assetDrawer.examplesSend')} onClick={() => { window.open(EXAMPLES_REPO, '_blank', 'noreferrer'); }} />
        </div>
      )}
    </PluginsPage>
  );
}

/** An example on a shelf: its poster (its preview playing under the pointer), its title, its kind and length. */
function ExampleTile({ example, kind }: { example: Example; kind: string }) {
  const [hover, setHover] = React.useState(false);
  const length = example.duration ? `${Math.floor(example.duration / 60)}:${String(Math.floor(example.duration % 60)).padStart(2, '0')}` : null;
  return (
    <button type="button" onClick={() => openExample(example.id)} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className="group flex w-full flex-col text-left outline-none" data-community-example={example.id}>
      <span className="relative block aspect-video w-full overflow-hidden rounded-[12px] bg-[var(--bg-field)] ring-1 ring-inset ring-[var(--border)] transition group-hover:ring-[var(--border-strong)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--text-muted)]">
        {example.poster ? <img src={example.poster} alt="" loading="lazy" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
          : <span className="absolute inset-0 grid place-items-center text-[var(--text-faint)]"><Clapperboard size={24} strokeWidth={1.5} /></span>}
        {hover && example.video ? <video src={example.video} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
        {length ? <span className="absolute bottom-2 right-2 rounded-[5px] bg-black/60 px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-white backdrop-blur-sm">{length}</span> : null}
      </span>
      <span className="mt-2.5 line-clamp-1 text-[14px] font-medium text-[var(--text)]">{example.title}</span>
      <span className="mt-0.5 line-clamp-1 text-[12.5px] text-[var(--text-muted)]">{example.description || kind}</span>
    </button>
  );
}

/** A thing's colour on a page's banner, from its name (the same each time). */
const hueOf = (key: string) => [...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

/** The banner's button: white on its colour. */
function HeroButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex h-9 items-center rounded-full bg-white px-5 text-[14px] font-semibold text-black shadow-[0_6px_18px_rgba(0,0,0,0.25)] transition hover:bg-white/90 active:scale-[0.97]">
      {label}
    </button>
  );
}

/**
 * One of OpenFilm's own plugins on its page, as an editor's extension page: its mark, name, whose and what it is for;
 * what to do (Get; once got Turn off or Turn on, and Remove, which one OpenFilm comes with has not: it is turned off);
 * then what it does, how to use it and what it brings, its facts at the side.
 */
function PluginPage({ plugin, skills, error, onBack, onOpen, onTurn, onRemove }: {
  plugin: Plugin; skills: readonly SkillEntry[]; error: string | null; onBack: () => void; onOpen: (key: string) => void;
  /** got and turned on, or off (none: not made yet) */
  onTurn?: ((on: boolean) => void) | undefined;
  /** removed (none: OpenFilm comes with it) */
  onRemove?: (() => void) | undefined;
}) {
  const t = useT();
  const lang = useLanguage();
  const { title, summary } = usePluginWords()(plugin);
  const skillWords = useSkillWords();
  const details = inLanguage(plugin.details, lang);
  const taught = plugin.skills.map((name) => skills.find((k) => k.core && k.name === name)).filter((k): k is SkillEntry => k != null);
  const how = plugin.workbench ? (pickedOnTimeline(plugin) ? 'assetDrawer.howTimeline' : 'assetDrawer.howWorkbench') : plugin.tab ? 'assetDrawer.howTab' : null;
  const got = isInstalled(plugin);
  const kind = t(plugin.mcpServers ? 'assetDrawer.kind_connector' : plugin.workbench || plugin.tab ? 'assetDrawer.kind_editor' : 'assetDrawer.kind_skill');
  const actions = plugin.soon ? <SoonMark /> : !onTurn ? null : !got
    ? <PageButton kind="main" onClick={() => onTurn(true)}>{t('assetDrawer.get')}</PageButton>
    : <>
      {plugin.on ? <PageButton onClick={() => onTurn(false)}>{t('assetDrawer.manageOff')}</PageButton>
        : <PageButton kind="main" onClick={() => onTurn(true)}>{t('assetDrawer.manageOn')}</PageButton>}
      {onRemove ? <PageButton kind="danger" onClick={onRemove}><Trash2 size={13} aria-hidden />{t('assetDrawer.manageRemove')}</PageButton> : null}
      <span className="ml-1 text-[13px] text-[var(--text-faint)]">{t(plugin.on ? 'assetDrawer.stateInstalled' : 'assetDrawer.stateOff')}</span>
    </>;
  return (
    <DetailShell onBack={onBack} data={{ 'data-plugin-page': plugin.id }} icon={<WorkbenchMark plugin={plugin} size={88} />} title={title}
      badges={plugin.beta ? <Beta>{t('assetDrawer.pluginBeta')}</Beta> : null}
      byline={<><span className="inline-flex items-center gap-1 text-[var(--text-muted)]">OpenFilm<BadgeCheck size={13} strokeWidth={2} aria-hidden /></span><span aria-hidden>·</span><span>{kind}</span></>}
      summary={summary} actions={actions}
      notice={error ? <p role="alert" className="mt-4 text-[13.5px] text-[var(--warn)]">{error}</p> : null}
      aside={(
        <Facts title={t('assetDrawer.factsTitle')} items={[
          { key: 'kind', name: t('assetDrawer.factKind'), value: kind },
          { key: 'maker', name: t('assetDrawer.factMaker'), value: t('assetDrawer.skillsOfficial') },
          { key: 'state', name: t('assetDrawer.factState'), value: t(!got ? 'assetDrawer.stateNotGot' : plugin.on ? 'assetDrawer.stateInstalled' : 'assetDrawer.stateOff') },
          plugin.builtIn ? { key: 'builtin', name: t('assetDrawer.factBuiltIn'), value: t('assetDrawer.factBuiltInNote') } : null,
          plugin.profile?.cost ? { key: 'cost', name: t('assetDrawer.factCost'), value: t(`assetDrawer.cost_${plugin.profile.cost}`) } : null,
        ]} />
      )}>
      <ProfileStrip profile={plugin.profile} uses={usesOfPlugin(plugin)} />
      {/* what it does, each line's lead a shade brighter, to find at a glance */}
      {details ? (
        <div className="mt-2">
          {details.split('\n').map((text) => {
            const lead = /^(.{1,24}?[：:])\s*(.+)$/.exec(text);
            return (
              <p key={text} className="mt-2 text-[14px] leading-[21px] text-[var(--text-muted)]">
                {lead ? <><span className="font-medium text-[var(--text)]">{lead[1]}</span> {lead[2]}</> : text}
              </p>
            );
          })}
        </div>
      ) : null}
      {how && !plugin.soon ? <HowToUse where text={t(how)} /> : null}
      {/* a connector: got and on, the agent reaches the service; it signs in there the first time, as in its terminal */}
      {plugin.mcpServers && !details ? <HowToUse text={t('assetDrawer.howConnector').replaceAll('{name}', title)} /> : null}
      <p className="mt-5 text-[13.5px] leading-[20px] text-[var(--text-faint)]">{plugin.mcpServers ? t('assetDrawer.connectorOffNote').replaceAll('{name}', title) : t(plugin.soon ? 'assetDrawer.pluginSoonNote' : 'assetDrawer.pluginOffNote')}</p>
      {/* what it is made of, for whoever makes such things: folded */}
      <ForDevelopers>
        <PageSection title={t('assetDrawer.pluginBrings')}>
          {plugin.workbench ? <BringsLine kind={t('assetDrawer.brings_workbench')}>{title}</BringsLine> : null}
          {plugin.tab ? <BringsLine kind={t('assetDrawer.brings_tab')}>{inLanguage(plugin.tab.title, lang) ?? title}</BringsLine> : null}
          {/* a connector's MCP servers, each where it is (an address, or the program run) */}
          {plugin.mcpServers ? (
            <BringsLine kind={t('assetDrawer.brings_mcp')}>
              {Object.entries(plugin.mcpServers).map(([name, server]) => (
                <div key={name} className="truncate font-mono text-[12.5px] text-[var(--text-muted)]" data-connector-server={name}>
                  {name} · {server.type === 'http' ? server.url : server.command}
                </div>
              ))}
            </BringsLine>
          ) : null}
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
    </DetailShell>
  );
}

/** One of what an agent brings of its own, in its folded group: its name, what it is, its switch. */
function AgentLine({ title, detail, control }: { title: string; detail: string; control: React.ReactNode }) {
  return (
    <div className="flex min-h-[48px] items-center gap-3 border-b border-[var(--border)] py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] text-[var(--text)]">{title}</div>
        {detail ? <div className="truncate text-[12.5px] text-[var(--text-faint)]" title={detail}>{detail}</div> : null}
      </div>
      {control}
    </div>
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
function PluginsPage({ title, note, badge, children }: { title: string; note?: string; badge?: string; children: React.ReactNode }) {
  return (
    /* a page of its own: another place starts at its top (its key, given by whoever shows it) */
    <div className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${PAGE_INSET} pb-12 pt-9`}>
      <h2 className="flex items-center gap-2.5 text-[30px] font-bold tracking-[-0.03em] text-[var(--text)]">
        {title}
        {badge ? <span className="rounded-full bg-[var(--bg-field)] px-2 text-[12px] font-medium leading-[20px] tracking-normal text-[var(--text-muted)]">{badge}</span> : null}
      </h2>
      {note ? <p className="mt-1 max-w-[640px] text-[14px] leading-relaxed text-[var(--text-muted)]">{note}</p> : null}
      <div className="mt-8">{children}</div>
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




/** The page of one of the library's things: `asset:` and its id. */
const ASSET_PAGE = 'asset:';
/** The page of a pack: `pack:` and its id. */
const PACK_PAGE = 'pack:';

/* the version of each community pack the person last saw (added, or told of a newer one): a newer one is said in Mine */
const SEEN_KEY = (id: string) => `openfilm.pack.seen.${id}`;
function seePackVersion(pack: LibraryPack): void {
  try { if (pack.version) localStorage.setItem(SEEN_KEY(pack.id), String(pack.version)); } catch { /* not kept: said again */ }
}
/** The version of a community pack the person got (none kept: the one they see now, so nothing is said). */
function seenPackVersion(pack: LibraryPack): number {
  try { const v = Number(localStorage.getItem(SEEN_KEY(pack.id))); if (v > 0) return v; } catch { /* none kept */ }
  return pack.version ?? 0;
}
/** How many cards of a kind are shown at once; more on asking. */
const STORE_PAGE = 48;

/** A pack's picture: its own, else its first thing's. */
function PackCover({ pack, first, lang }: { pack: LibraryPack; first: LibraryItem | undefined; lang: ReturnType<typeof useLanguage> }) {
  if (pack.cover) return <img src={libraryUrl(pack.cover)} alt="" loading="lazy" draggable={false} className="absolute inset-0 h-full w-full object-cover" />;
  if (first?.cover) return <img src={libraryUrl(first.cover)} alt="" loading="lazy" draggable={false} className="absolute inset-0 h-full w-full object-cover" />;
  /* sounds: soft light in their group's colors, as the library's tiles */
  if (first?.kind === 'sound' && first.cat === 'sound') {
    return (
      <div aria-hidden className="absolute inset-0 flex items-center justify-center" style={soundLook({ id: pack.id, group: first.group })}>
        <AudioLines size={26} className="text-white/85" />
      </div>
    );
  }
  return first ? <AssetCover item={first} lang={lang} /> : <GradientCover hue={220} Icon={Box} />;
}

/**
 * A pack's page, laid out as a plugin's: its picture, name, whose it is, what it holds; what to do (Get; once got,
 * Remove; Get the new version when the Community has one); its facts at the side; then what it holds, each opening large.
 */
function PackPage({ pack, items, view, lang, here, newer, onBack, onAdd, onRemove, onUpdate, onAuthor }: {
  pack: LibraryPack; items: LibraryItem[]; view: React.ReactNode; lang: ReturnType<typeof useLanguage>; here: boolean; newer: boolean;
  onBack: () => void; onAdd: () => void; onRemove: () => void; onUpdate: () => void; onAuthor?: () => void;
}) {
  const t = useT();
  const kinds = pack.cats.map((c) => t(`assetDrawer.cat_${c}`)).join(t('assetDrawer.listSep'));
  const by = pack.by && onAuthor
    ? <button type="button" onClick={onAuthor} className="text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text)] hover:underline">{pack.by}</button>
    : <span className="inline-flex items-center gap-1 text-[var(--text-muted)]">{pack.by ?? 'OpenFilm'}{pack.by ? null : <BadgeCheck size={13} strokeWidth={2} aria-hidden />}</span>;
  const actions = !here ? <PageButton kind="main" onClick={onAdd}>{t('assetDrawer.get')}</PageButton> : (
    <>
      {newer ? <PageButton kind="main" onClick={onUpdate}><RefreshCw size={13} aria-hidden />{t('assetDrawer.packUpdate').replace('{v}', String(pack.version ?? ''))}</PageButton> : null}
      <PageButton kind="danger" onClick={onRemove}><Trash2 size={13} aria-hidden />{t('assetDrawer.packRemove')}</PageButton>
      <span className="ml-1 inline-flex items-center gap-1 text-[13px] text-[var(--text-faint)]"><Check size={13} aria-hidden />{t('assetDrawer.stateGot')}</span>
    </>
  );
  return (
    <DetailShell onBack={onBack} data={{ 'data-pack-page': pack.id }} title={nameOf(pack.name, lang)} summary={pack.about}
      icon={<div className="relative h-[104px] w-[104px] overflow-hidden rounded-[18px] bg-[var(--bg-field)] shadow-[0_8px_24px_rgba(0,0,0,0.18)]"><PackCover pack={pack} first={items[0]} lang={lang} /></div>}
      byline={<>{by}<span aria-hidden>·</span><span>{kinds}</span><span aria-hidden>·</span><span className="tabular-nums">{t('assetDrawer.countItems').replace('{n}', items.length.toLocaleString())}</span></>}
      actions={actions}
      aside={(
        <Facts title={t('assetDrawer.factsTitle')} items={[
          { key: 'maker', name: t('assetDrawer.factMaker'), value: pack.by ?? t('assetDrawer.skillsOfficial') },
          { key: 'kind', name: t('assetDrawer.factKind'), value: kinds },
          { key: 'count', name: t('assetDrawer.factCount'), value: items.length.toLocaleString() },
          pack.version && !pack.official ? { key: 'version', name: t('assetDrawer.factVersion'), value: `v${pack.version}` } : null,
          { key: 'license', name: t('assetDrawer.factLicense'), value: pack.license ?? t('assetDrawer.licenseFree') },
          { key: 'state', name: t('assetDrawer.factState'), value: t(!here ? 'assetDrawer.stateNotGot' : newer ? 'assetDrawer.packNewer' : 'assetDrawer.stateGot') },
        ]} />
      )}>
      {here ? <p className="mb-5 text-[13.5px] leading-[20px] text-[var(--text-faint)]">{t(pack.official ? 'assetDrawer.packOfficialNote' : 'assetDrawer.packSyncNote')}</p> : null}
      {view}
    </DetailShell>
  );
}

/**
 * One of the library's things large, over the page it was opened from: shown as it is used, its name, whose, its kind
 * and its pack; what to do with it (its pack got whole; a file of footage, a picture or a recording kept on its own).
 * The arrows (and ← →) step through the others there; Esc, the cross or a click outside closes it.
 */
function AssetLightbox({ items, at, lang, onAt, onClose, packOf: packOfItem, packIn, here, onGetPack, onAdd, onPack }: {
  items: readonly LibraryItem[]; at: number; lang: ReturnType<typeof useLanguage>; onAt: (at: number) => void; onClose: () => void;
  packOf: (item: LibraryItem) => LibraryPack | undefined; packIn: (pack: LibraryPack) => boolean; here: (item: LibraryItem) => boolean;
  onGetPack: (pack: LibraryPack) => void; onAdd: (item: LibraryItem) => void; onPack: (pack: LibraryPack) => void;
}) {
  const t = useT();
  const item = items[Math.min(at, items.length - 1)];
  const step = React.useCallback((by: number) => { if (items.length > 1) onAt((at + by + items.length) % items.length); }, [at, items.length, onAt]);
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onClose(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); step(e.key === 'ArrowLeft' ? -1 : 1); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose, step]);
  if (!item) return null;
  const pack = packOfItem(item);
  const name = nameOf(item.name, lang);
  const file = item.kind === 'file';
  const action = file
    ? (here(item) ? <span className="inline-flex h-8 items-center gap-1 text-[13px] text-[var(--text-faint)]"><Check size={13} aria-hidden />{t('assetDrawer.savedToMine')}</span>
      : <PageButton kind="main" onClick={() => onAdd(item)}>{t('assetDrawer.saveToMine')}</PageButton>)
    : pack ? (packIn(pack) ? <span className="inline-flex h-8 items-center gap-1 text-[13px] text-[var(--text-faint)]"><Check size={13} aria-hidden />{t('assetDrawer.stateGot')}</span>
      : <PageButton kind="main" onClick={() => onGetPack(pack)}>{t('assetDrawer.getPack')}</PageButton>)
      : here(item) ? <span className="inline-flex h-8 items-center gap-1 text-[13px] text-[var(--text-faint)]"><Check size={13} aria-hidden />{t('assetDrawer.stateGot')}</span>
        : <PageButton kind="main" onClick={() => onAdd(item)}>{t('assetDrawer.get')}</PageButton>;
  const arrow = 'absolute top-1/2 z-[1] grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/65';
  /* drawn in the window itself (it is on the page's top layer: nothing put on the body shows over it) */
  return (
    <div role="dialog" aria-modal="true" aria-label={name} data-asset-preview={item.id}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/70 p-6 backdrop-blur-[2px]">
      <div className="relative flex max-h-full w-[min(940px,100%)] flex-col overflow-hidden rounded-[18px] bg-[var(--dialog-main)] shadow-[0_30px_80px_rgba(0,0,0,0.55)]">
        <div className="relative bg-black/40 p-4">
          <div className="mx-auto max-w-[760px]"><AssetShow key={item.id} item={item} lang={lang} /></div>
          {items.length > 1 ? <>
            <button type="button" aria-label={t('assetDrawer.previous')} onClick={() => step(-1)} className={`${arrow} left-4`}><ChevronLeft size={20} /></button>
            <button type="button" aria-label={t('assetDrawer.next')} onClick={() => step(1)} className={`${arrow} right-4`}><ChevronRight size={20} /></button>
          </> : null}
          <button type="button" aria-label={t('assetDrawer.closePreview')} onClick={onClose}
            className="absolute right-3 top-3 z-[1] grid h-8 w-8 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/65"><X size={16} /></button>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-6 py-5">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[18px] font-semibold tracking-[-0.01em] text-[var(--text)]">{name}</h3>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-[var(--text-faint)]">
              <span>{item.by ?? t('assetDrawer.skillsOfficial')}</span>
              <span aria-hidden>·</span>
              <span className="inline-flex items-center gap-1.5"><KindIcon kind={item.cat} size={13} />{t(`assetDrawer.cat_${item.cat}`)}</span>
              {pack ? <><span aria-hidden>·</span>
                <button type="button" onClick={() => onPack(pack)} className="inline-flex items-center gap-0.5 underline-offset-2 hover:text-[var(--text)] hover:underline">
                  {t('assetDrawer.inPackLine').replace('{name}', nameOf(pack.name, lang))}<ChevronRight size={13} aria-hidden /></button></> : null}
              <span aria-hidden>·</span>
              <span>{pack?.license || t('assetDrawer.licenseFree')}</span>
            </p>
          </div>
          {items.length > 1 ? <span className="text-[12.5px] tabular-nums text-[var(--text-faint)]">{at + 1} / {items.length}</span> : null}
          {action}
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

/** One of the person's own in Mine: Off when it is, and its gear (turn it off or on, remove it, its page). */
function MineControl({ off, label, items }: { off: boolean; label: string; items: readonly ContextMenuEntry[] }) {
  const t = useT();
  return (
    <span className="flex items-center gap-1.5">
      {off ? <span className="rounded-full bg-[var(--bg-pressed)] px-2 py-0.5 text-[11.5px] font-medium text-[var(--text-muted)]">{t('assetDrawer.stateOff')}</span> : null}
      <ManageButton label={label} items={items} />
    </span>
  );
}

/** Not out yet: a word where its button will be. */
function SoonMark() {
  const t = useT();
  return <span className="inline-flex h-7 items-center rounded-full bg-[var(--bg-field)] px-2.5 text-[12.5px] text-[var(--text-muted)]">{t('assetDrawer.comingSoon')}</span>;
}

/** A kind's mark (or `icon`) in a row's place for one that has no mark of its own (a connector, a way to publish). */
function KindMark({ kind, icon, size = 36 }: { kind: FeatureKind; icon?: LucideIcon; size?: number }) {
  return <AppIcon kind={kind === 'plugins' ? 'plugin' : 'skill'} mark={icon} size={size} />;
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
        <PluginRow mark={<KindMark kind="plugins" icon={SquareTerminal} />} title={t('assetDrawer.publishCli')} summary={t('assetDrawer.publishCliNote')}
          control={<code className="select-all rounded-md bg-[var(--bg-field)] px-2 py-1 font-mono text-[12.5px] text-[var(--text)]">openfilm publish</code>} />
        <PluginRow mark={<KindMark kind="plugins" icon={Github} />} title={t('assetDrawer.publishGithub')} summary={t('assetDrawer.publishGithubNote')}
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
        <PluginRow mark={<KindMark kind="plugins" icon={COMMUNITY_ICON} />} title="openfilm/community" note={t('gallery.trustReviewed')} summary={t('assetDrawer.sourcesOfficialNote')} control={null} />
      </SettingsGroup>
      <SettingsGroup title={t('assetDrawer.sourcesAdded')} footnote={t('assetDrawer.sourcesWarning')}>
        {(sources ?? []).map((address) => (
          <PluginRow key={address} mark={<KindMark kind="plugins" icon={Globe} />} title={hostOf(address)} summary={address}
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
