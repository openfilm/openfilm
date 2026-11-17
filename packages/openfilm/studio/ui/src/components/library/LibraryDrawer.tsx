/**
 * The assets drawer's library (in the app's panel, over the chat, its composer under it), laid out as an editor's
 * library is: the categories along the top — the media (the project's and Saved, the media pane as it was), the
 * voices to speak a voice-over in or a recording from the microphone (VoicesPane, RecordPane), the captions a caption
 * track is made with (CaptionsPane), then OpenFilm's own templates, sounds, music, text, stickers, filters, effects and
 * transitions (lib/library),
 * then the tabs plugins bring (plugin-tabs) — and down the left the starred ones and the library's own,
 * its groups under it (a plugin's tab is its own, whole). What is shown is in
 * the accent color; a category's icon fills faintly too.
 *
 * A click picks a thing and tries it in the viewer. Hovering previews inside the library.
 * Enter or its "+" puts it in the film where the try showed it; a drag puts it where it is let go. A star keeps
 * it among the favorites, for every project.
 */
import { onRevealInLibrary, takeRevealed, type Revealed } from '@/lib/library-reveal';
import React from 'react';
import { AudioLines, BookmarkPlus, ChevronDown, ChevronsLeft, ChevronsRight, CircleHelp, FolderOpen, FolderPlus, Link2, Package, Pencil, Plus, Search, Star, Trash2, Upload, X } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { copyFromLibrary, inOrder, packKey, saveToEntry, shelfActions, useLibraryPlaces } from '@/lib/library-places';
import { pickFromComputer, refreshSaved, SAVED, savedActions, savedSources, starSaved, useSavedListing } from '@/lib/saved';
import { safeName, type MediaLink, type WorkspaceResource } from '@/lib/workspace-resources';
import {
  BUILT_IN, TEXT_COMPONENT, askHere, toggleFavorite, builtInItem, prepareLibraryItem, isLibraryItemReady, libraryDragItem, libraryUrl, mayNeedFetch, nameOf, posterUrl, prepareTemplatePreview, previewUrl, setAdded, templateExamplePath, templatePreviewUrl,
  inLibrary, makerName, savePack, useLibraryAdded, useLibraryFavorites, useLibraryHere, useLibraryIndex, type HereState, type LibraryCategory, type LibraryItem,
} from '@/lib/library';
import { openPlugins } from '@/lib/plugins-window';
import { COMMUNITY_ICON as Community, FEATURE_KINDS } from '../feature-kinds';
import { ConfirmDialog } from '../ConfirmDialog';
import { ContextMenu, type ContextMenuItem } from '../ContextMenu';
import { clearResourceDrag, dragPicture, peekResourceDrag, RESOURCE_DRAG_TYPE, setResourceDragData, type ResourceKind } from '@/lib/resource-drag';
import { ADD_COLOR, AudioArtwork, FOOT_ROOM, HereButton, MiniPlayer, MusicCard, ROUND, SoundRow, usePlayer, type LibraryHover } from './AudioList';
import { Empty } from './icons';
import { CategoryMark, useCategoryName, usePluginTabs, withTabs } from './plugin-tabs';
import { PluginSurface } from '../surfaces';
import { SourceBadge, SourceChips, sourcesIn, type Source } from './SourceChips';
import { TextStyleSample } from './TextStyleSample';
import { useSavedLooks } from '../CaptionPresets';
import { arrangedCategories } from '@/lib/library-categories';
import { PLAIN } from './OnPicture';
import { isClipMotion } from '@/lib/clip-presets';
import { useLibraryArrangement } from './arrangement';
import { RecordPane, type Recorder } from '../RecordPane';
import { useLibraryVoices, type SpeakVoice } from '@/lib/library-voices';
import { MY_VOICES } from '@/lib/private-voices';
import { providerName } from '@/lib/providers';
import { CaptionsPane, type CaptionsActions, type CaptionsSource } from './CaptionsPane';
import { STARRED, VoicesPane, type VoiceSample } from './VoicesPane';
import { CoversPane, type CoversActions, type CoversLine } from './CoversPane';

type OwnCategory = 'media' | 'voice' | 'captions' | 'cover' | 'coverPicture' | LibraryCategory;
/** One of OpenFilm's own categories, or a plugin's tab (by its plugin's id). */
type Category = OwnCategory | (string & {});
/* OpenFilm's order (the person's own in Settings › Advanced, lib/library-categories): the media, the voice-over and the
   captions, then the templates, the most a film is made with at once; the plugins' tabs come after these (the plugins
   themselves have a window of their own, PluginsWindow) */
export const CATEGORIES: OwnCategory[] = ['media', 'voice', 'captions', 'cover', 'coverPicture', 'template', 'sound', 'music', 'text', 'sticker', 'filter', 'effect', 'transition'];
/** What a cover is made with (the cover studio's library), its own two first: its looks and its picture. */
const COVER_CATEGORIES: string[] = ['cover', 'text', 'sticker', 'coverPicture'];
/** The voice-over's line that records from the microphone. */
const RECORD = 'record';

/** What of a folder a category shows: all of it for the media; sounds for music and sound effects; pictures for
 * stickers; pages (and clips saved as pages) for what goes on the film as a page. */
const kindsOf = (cat: Category): readonly ResourceKind[] | null =>
  cat === 'media' ? null : cat === 'music' || cat === 'sound' ? ['audio'] : cat === 'sticker' ? ['image'] : ['mg'];
/** Where the Community says how to make a thing of the library and send it in. */
const MAKING_GUIDE = 'https://github.com/openfilm/community/tree/main/assets#readme';

/** A line of the side bar: a new line of words, this project, the person's text looks, one of their folders, a pack. */
type Line = { key: string; kind: 'new' | 'project' | 'presets' | 'folder' | 'pack'; name: string; group?: string; link?: MediaLink; official?: boolean };

/* rows of a long list drawn at first, and more each time it is scrolled near its end */
const PAGE = 80;
const STICKER_PAGE = 32;
const HOVER_PREVIEW_MS = 280;

/* the text category's lines: a new line of words; the person's own (starred, presets); the library's looks (word art,
   `art:<group>` one of its groups) and its templates (`tpl:<group>`). Its motions are not here: they go on a line of
   words in the timeline, from the Text inspector */
/* a clip's motions (how it comes in, goes out, moves while shown) are not among the effects either: they are put on a
   clip from the inspector's Animation (ClipMotionSection); a camera move on a cut stays a transition */
const NEW_TEXT = 'new';
/* a namespace of the side bar shown whole: OpenFilm's own things of the category, or those got from the Community */
const OFFICIAL_ALL = '@official';
const COMMUNITY_ALL = '@community';
const PRESETS = 'presets';
const ART = 'art';
const TEMPLATES = 'tpl';
type TextSection = typeof ART | typeof TEMPLATES;
/** What a thing of the text category is to its lines: the new line, a look, a template, or none (a motion). */
const textKind = (item: LibraryItem): 'new' | typeof ART | typeof TEMPLATES | null =>
  item.id === TEXT_COMPONENT ? 'new' : item.kind === 'textstyle' ? ART : item.kind === 'page' ? TEMPLATES : null;
/** The section a line of the text category is under. */
const sectionOf = (line: string): TextSection | null =>
  line === ART || line.startsWith(`${ART}:`) ? ART : line === TEMPLATES || line.startsWith(`${TEMPLATES}:`) ? TEMPLATES : null;

/* the category shown and the line picked in each, kept while the drawer closes and opens again */
const SHOWN = {
  cat: 'media' as Category, group: {} as Partial<Record<Category, string>>,
  /* the line picked in each category, by its key */
  line: {} as Partial<Record<Category, string>>,
};
/* the line a category opens on the first time: a new line of words for the text, captions of what is said */
const firstLine = (cat: Category) => SHOWN.group[cat] ?? (cat === 'text' ? NEW_TEXT : cat === 'captions' ? 'speech' : cat === 'coverPicture' ? 'film' : '');

export interface LibraryActions {
  /** Enter or "+": a page or a sound at the playhead (a transition on the cut), a look on the clip. */
  add: (item: LibraryItem) => void;
  /** A click: tried in the viewer (null: no longer). */
  tryOut: (item: LibraryItem | null) => void;
}


/**
 * How far the side's foot (its 32 px way out: the Resource Center, more in the Community) stands off the drawer's
 * bottom. Under the app's chat, the way back to it stands in the composer's top row (`under` less `beside`: 4 px over
 * the button, 8 px under it), and the foot's middle meets that button's middle; elsewhere 10 px over what covers it.
 */
export const footInset = (under: number, beside: number): number => (under > beside ? Math.round((under + beside) / 2 - 14) : beside + 10);

export function LibraryDrawer({ media, mediaScope, onMediaScope, onUpload, onKeep, onPickSaved, onAddSaved, mediaRequest, actions, tried, templateStatus, previewBar, previewPicture, dismissRef, onPreviewStart, onDownloadFailed, captions, covers, speak, recorder, onServices, projectId = null, folder = '', under = 0, beside = under, shown: isShown = true }: {
  /** the media pane on the project's files or one of the person's folders (`mediaScope`), showing only `kinds` (null: all) */
  media: (kinds: readonly ResourceKind[] | null) => React.ReactNode;
  /** the project's own media, or a place of the person's shelf (lib/library-places), by its `saved/` path */
  mediaScope: string;
  onMediaScope: (next: string) => void;
  /** files of this computer put in the project (`project`) or one of the person's folders (its `saved/` path) */
  onUpload: (files: File[], into: string) => void;
  /** a file of the project kept in one of the person's folders (dropped on it) */
  onKeep: (path: string, name: string, into: string) => void;
  /** one of the person's own files starred, under the media's 收藏: taken in hand (clicked), put in the film ("+") */
  onPickSaved?: (file: WorkspaceResource | null) => void;
  onAddSaved?: (file: WorkspaceResource) => void;
  mediaRequest?: number;
  actions: LibraryActions;
  tried?: string | null;
  templateStatus: Partial<Record<string, 'failed'>>;
  previewBar: HTMLDivElement | null;
  previewPicture: HTMLDivElement | null;
  dismissRef: React.RefObject<() => boolean>;
  onPreviewStart: () => void;
  onDownloadFailed: () => void;
  /** where a caption track comes from: what is said, a file, or by hand (none: no workbench makes captions, and they are not shown) */
  captions?: CaptionsActions;
  /** a cover is open (the cover studio): its looks and its picture, and only what a cover is made with beside them */
  covers?: CoversActions;
  /** words spoken in a voice of the library, put on the film at the playhead (VoicesPane): null, or why not */
  speak?: SpeakVoice;
  /** recording from the microphone, the workbench's own so it goes on while another category is shown (RecordPane) */
  recorder?: Recorder;
  /** Settings › Services: where a voice's service is connected */
  onServices: () => void;
  /** the project shown, for its own skills */
  projectId?: string | null;
  /** its folder on this computer, told to a plugin's tab */
  folder?: string;
  /** how much of its foot the app's composer floats over: the lists run on under it, their ends scrolled clear of it
      (--drawer-under) */
  under?: number;
  /** as much beside the app's way back to the chat (over the middle only): the side bar's foot runs on down to it */
  beside?: number;
  shown?: boolean;
}) {
  const t = useT();
  const lang = useLanguage();
  const index = useLibraryIndex(true);
  /* the community's packs and things the person added: in the library beside OpenFilm's own */
  const added = useLibraryAdded();
  /* the person's folders, the order of the side bar, OpenFilm's own packs taken out */
  const { folders, order, hidden } = useLibraryPlaces();
  /* the categories shown, in the person's order, the tabs of the plugins on among them */
  const arranged = useLibraryArrangement();
  const tabs = usePluginTabs(projectId);
  const categoryName = useCategoryName(tabs);
  const categories = arrangedCategories(withTabs(CATEGORIES, tabs), arranged)
    .filter((c) => c.on && (c.id !== 'captions' || captions) && (c.id !== 'voice' || speak) && (covers ? COVER_CATEGORIES.includes(c.id) : c.id !== 'cover' && c.id !== 'coverPicture'))
    .sort((a, b) => (covers ? COVER_CATEGORIES.indexOf(a.id) - COVER_CATEGORIES.indexOf(b.id) : 0)).map((c) => c.id);
  const [shownCat, setCat] = React.useState<Category>(SHOWN.cat);
  /* one turned off while it was shown: the media in its place */
  const cat: Category = categories.includes(shownCat) ? shownCat : categories.includes('media') ? 'media' : categories[0] ?? 'media';
  /* the plugin whose tab is shown */
  const tab = tabs.find((p) => p.id === cat);
  const [group, setGroup] = React.useState<string>(firstLine(SHOWN.cat));
  /* the line picked in this category, by its key (the media's is the media pane's: `mediaScope`) */
  const [lineKey, setLineKey] = React.useState<string | undefined>(SHOWN.line[SHOWN.cat]);
  const [presets, , dropPreset] = useSavedLooks();
  const [query, setQuery] = React.useState('');
  /* the source the list is narrowed to (SourceChips), all of them by default */
  const [source, setSource] = React.useState<Source | ''>('');
  const [picked, setPicked] = React.useState<string | null>(null);
  const intent = React.useRef(0);
  const tryOut = React.useRef(actions.tryOut);
  tryOut.current = actions.tryOut;
  const player = usePlayer<LibraryItem>(onDownloadFailed);
  /* the voices: the services' (each a line), the person's own, the starred; one heard plays over the picture */
  const voices = useLibraryVoices();
  const favorites = useLibraryFavorites();
  const voicePlayer = usePlayer<VoiceSample>(onDownloadFailed, (sample) => sample.voice.sample ?? sample.id, true);
  const recording = recorder?.state === 'recording';
  const [hoverVisual, setHoverVisual] = React.useState<string | null>(null);
  const hovering = React.useRef<{ id: string; timer: number } | null>(null);
  const stopHover = React.useCallback(() => {
    if (hovering.current) window.clearTimeout(hovering.current.timer);
    hovering.current = null;
    setHoverVisual(null);
  }, []);
  React.useEffect(() => {
    window.addEventListener('blur', stopHover);
    return () => { window.removeEventListener('blur', stopHover); if (hovering.current) window.clearTimeout(hovering.current.timer); hovering.current = null; };
  }, [stopHover]);
  const hoverProps = (id: string, start: () => void): LibraryHover => ({
    onPointerEnter: (e) => {
      if (!isShown || e.pointerType !== 'mouse' || e.buttons) return;
      stopHover();
      hovering.current = { id, timer: window.setTimeout(start, HOVER_PREVIEW_MS) };
    },
    onPointerLeave: () => { if (hovering.current?.id === id) stopHover(); },
  });
  const prepareCard = async (item: LibraryItem): Promise<boolean> => {
    if (item.kind !== 'group') return !mayNeedFetch(item) || isLibraryItemReady(item.id) || prepareLibraryItem(item.id);
    await prepareTemplatePreview(item);
    // An unavailable example still has its bundled preview. Insertion prepares its music separately.
    return true;
  };
  const hoverCard = (item: LibraryItem): LibraryHover => hoverProps(item.id, () => {
    const request = hovering.current;
    void prepareCard(item).then((ok) => {
      if (ok && hovering.current === request && !item.still && ['page', 'group', 'motion'].includes(item.kind)) setHoverVisual(item.id);
    });
  });
  const closePreview = React.useCallback(() => {
    intent.current += 1;
    stopHover();
    player.close();
    voicePlayer.close();
    setPicked(null);
    tryOut.current(null);
  }, [player.close, voicePlayer.close, stopHover]);
  React.useLayoutEffect(() => {
    dismissRef.current = () => {
      stopHover();
      if (!picked && !tried && !player.item && !voicePlayer.item) return false;
      closePreview();
      return true;
    };
    return () => { dismissRef.current = () => false; };
  }, [dismissRef, closePreview, stopHover, picked, tried, player.item, voicePlayer.item]);
  /* the voice-over opened while recording: on the recording */
  const show = (next: Category) => {
    SHOWN.cat = next; setCat(next); setGroup(next === 'voice' && recording ? RECORD : firstLine(next)); setLineKey(SHOWN.line[next]); setQuery(''); setSource(''); closePreview();
  };
  /* a category asked for from elsewhere (the Community's page of a thing in it): shown, as the drawer opens or after */
  const showRef = React.useRef<(asked: Revealed) => void>(() => {});
  showRef.current = (asked: Revealed) => { show(asked.category); if (asked.group) { SHOWN.group[asked.category] = asked.group; setGroup(asked.group); } };
  React.useEffect(() => {
    const asked = takeRevealed();
    if (asked) showRef.current(asked);
    return onRevealInLibrary((next) => { takeRevealed(); showRef.current(next); });
  }, []);
  const pickGroup = (next: string) => { SHOWN.group[cat] = next; setGroup(next); setQuery(''); closePreview(); };
  React.useEffect(() => {
    if (mediaRequest == null) return;
    if (cat !== 'media') show('media');
    /* the project's files, not a namespace of the media's */
    SHOWN.group.media = ''; setGroup('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaRequest]);
  const bar = useSideways();
  const [rail, setRail] = React.useState(railWidth);
  /* the drawer closed: what was tried goes with it */
  React.useEffect(() => () => { intent.current += 1; tryOut.current(null); }, []);
  React.useLayoutEffect(() => { if (!isShown) closePreview(); }, [isShown, closePreview]);

  const q = query.trim().toLowerCase();
  /* the groups all of whose things are stills (the emoji's) */
  const stillGroups = React.useMemo(() => {
    const moving = new Set<string>();
    const seen = new Set<string>();
    for (const item of index?.items ?? []) {
      if (item.cat !== cat || !item.group) continue;
      seen.add(item.group);
      if (!item.still) moving.add(item.group);
    }
    return new Set([...seen].filter((g) => !moving.has(g)));
  }, [index, cat]);
  const stillGroup = (id: string) => stillGroups.has(id);
  /* the groups that hold only a clip's motions (In, Out, Loop): not lines here */
  const clipMotionGroups = React.useMemo(() => {
    const other = new Set<string>();
    const seen = new Set<string>();
    for (const item of index?.items ?? []) {
      if (item.cat !== cat || !item.group) continue;
      seen.add(item.group);
      if (!isClipMotion(item)) other.add(item.group);
    }
    return new Set([...seen].filter((g) => !other.has(g)));
  }, [index, cat]);
  const shown = React.useMemo(() => {
    const [section, of] = group.split(':');
    return (index?.items ?? []).filter((item) => {
      if (item.cat !== cat || isClipMotion(item) || !inLibrary(item, added) || hidden.includes(packKey(item.group))) return false;
      const text = cat === 'text' ? textKind(item) : null;
      if (cat === 'text' && !text) return false;
      if (q) return Object.values(item.name).some((n) => n?.toLowerCase().includes(q)) || item.tags?.some((tag) => tag.toLowerCase().includes(q));
      /* the starred of this category, whatever their groups */
      if (group === STARRED) return favorites.includes(item.id);
      /* a namespace whole: OpenFilm's own, or the Community's got (the text's looks and templates, not its new line) */
      if (group === OFFICIAL_ALL || group === COMMUNITY_ALL) return Boolean(item.by) === (group === COMMUNITY_ALL) && (cat !== 'text' || text === ART || text === TEMPLATES);
      /* the text's looks or templates: OpenFilm's own all (a section alone), or a pack's */
      if (cat === 'text') return text === section && (of ? item.group === of : !item.by);
      return item.group === group;
    }).sort((a, b) => Number(Boolean(a.still)) - Number(Boolean(b.still)));
  }, [index, cat, q, group, added, hidden, favorites]);
  /* the person's own files starred: under the media's 收藏, beside the library's things starred */
  const mineStarred = cat === 'media' && group === STARRED;
  const starredListing = useSavedListing(mineStarred && isShown, true, { view: 'starred' });
  const starredFiles = React.useMemo(() => (mineStarred ? [...starredListing.pages, ...starredListing.files] : [])
    .filter((f) => !q || f.name.toLowerCase().includes(q)), [mineStarred, starredListing, q]);
  const sources = React.useMemo(() => sourcesIn([...shown.map(sourceOf), ...(starredFiles.length ? ['mine' as const] : [])]), [shown, starredFiles]);
  const items = React.useMemo(() => source && sources.includes(source) ? shown.filter((item) => sourceOf(item) === source) : shown, [source, sources, shown]);
  const mineItems = source && sources.includes(source) && source !== 'mine' ? [] : starredFiles;
  const presetItems = React.useMemo(() => presets.map((p, i): LibraryItem => ({
    id: `presets/${p.id}`, cat: 'text', group: PRESETS, kind: 'textstyle',
    name: { en: t('assetDrawer.textPreset').replace('{n}', String(i + 1)) }, vars: p.vars,
  })), [presets, t]);
  const pickedItem = picked ? index?.items.find((i) => i.id === picked) ?? presetItems.find((i) => i.id === picked) : null;
  /* what of it still needs fetching (a sound, a piece of music, a template's music): its download shown first, then "+" */
  const hereOf = useLibraryHere();
  const cardHere = (item: LibraryItem): HereState => {
    const asset = hereOf(item.id);
    if (item.kind !== 'group') return asset;
    const example = hereOf(templateExamplePath(item));
    if (asset === 'fetching' || example === 'fetching') return 'fetching';
    return templateStatus[item.id] ?? (example === 'missing' ? 'missing' : 'here');
  };
  const pick = (item: LibraryItem) => {
    /* a media file of the Community's: picked and fetched (it goes in with "+" or a drag), nothing tried over the picture */
    if (item.kind === 'file') {
      setPicked(item.id);
      if (mayNeedFetch(item) && !isLibraryItemReady(item.id)) void prepareLibraryItem(item.id).then((ok) => { if (!ok) onDownloadFailed(); });
      return;
    }
    if (item.kind === 'sound') {
      setPicked(item.id);
      onPreviewStart();
      return;
    }
    if (!previewBar) { setPicked(item.id); return; }
    const state = cardHere(item);
    if (picked === item.id && state === 'fetching') return;
    if (tried === item.id && item.cat !== 'transition' && state !== 'failed') { closePreview(); return; }
    const round = ++intent.current;
    setPicked(item.id);
    onPreviewStart();
    if (item.kind !== 'group' && (!mayNeedFetch(item) || isLibraryItemReady(item.id))) { tryOut.current(item); return; }
    tryOut.current(null);
    void prepareCard(item).then((ok) => {
      if (round !== intent.current) return;
      if (ok) tryOut.current(item);
      else onDownloadFailed();
    });
  };
  /* prepare any required assets before adding */
  const addWhenHere = (it: LibraryItem) => {
    closePreview();
    if (!mayNeedFetch(it) || isLibraryItemReady(it.id)) { actions.add(it); return; }
    void prepareLibraryItem(it.id).then((ok) => { if (ok) actions.add(it); else onDownloadFailed(); });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, button, [role="slider"]') || !pickedItem) return;
    if (e.key === 'Escape') { e.preventDefault(); closePreview(); }
    if (e.key === 'Enter') { e.preventDefault(); addWhenHere(pickedItem); }
  };

  /* OpenFilm's own groups of this category (each a pack of the library), the moving ones before the stills; a group its
     things name that the index does not list is a pack too, by its id, so nothing of the library is out of reach */
  const listed = index?.groups[cat as LibraryCategory] ?? [];
  const unlisted = [...new Set((index?.items ?? []).filter((it) => it.cat === cat && !it.by && it.group && !isClipMotion(it)).map((it) => it.group))]
    .filter((id) => !listed.some((g) => g.id === id));
  const own = [...listed.filter((g) => !g.by && !clipMotionGroups.has(g.id)).map((g) => ({ id: g.id, name: nameOf(g.name, lang) })),
    ...unlisted.map((id) => ({ id, name: id }))]
    .sort((a, b) => Number(stillGroup(a.id)) - Number(stillGroup(b.id)));
  /* the community's packs added (one the index does not list, by its id) */
  const addedPacks = [...listed
    .filter((g) => g.by && (index?.items ?? []).some((it) => it.cat === cat && it.group === g.id && inLibrary(it, added)))
    .map((g) => ({ id: g.id, name: nameOf(g.name, lang) })),
    ...[...new Set((index?.items ?? []).filter((it) => it.cat === cat && it.by && it.group && inLibrary(it, added)).map((it) => it.group))]
      .filter((id) => !listed.some((g) => g.id === id)).map((id) => ({ id, name: id }))];
  /* a kind the Community has: more of it found there, and a thing's page there (its preview, its pack) */
  const inCommunity = (FEATURE_KINDS as readonly string[]).includes(cat);
  const [menu, setMenu] = React.useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  /* the side bar's own: a line's menu (or the "+" one), a folder being renamed, one being made */
  const [railMenu, setRailMenu] = React.useState<{ x: number; y: number; flipTo?: number; items: ContextMenuItem[] } | null>(null);
  const [renaming, setRenaming] = React.useState<string | null>(null);
  const [making, setMaking] = React.useState(false);
  const [gone, setGone] = React.useState<Line | null>(null);
  const uploadRef = React.useRef<HTMLInputElement>(null);
  const onListMenu = (e: React.MouseEvent) => {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-library-card], [data-library-audio]');
    const thing = id?.dataset.libraryCard ?? id?.dataset.libraryAudio;
    const item = thing ? index?.items.find((it) => it.id === thing) : undefined;
    if (!item) return;
    /* a media file of the Community's: kept as a file of the person's own too (a copy, theirs to change) */
    const keep = item.kind === 'file' ? saveToEntry(folders, { id: 'save', label: t('saved.add'), many: t('saved.addTo'), icon: <BookmarkPlus size={14} />,
      pick: (into) => keepInMine(`${BUILT_IN}/${item.id}`, into, nameOf(item.name, lang)) }) : [];
    const details = inCommunity ? [{ id: 'details', label: t('assetDrawer.seeDetails'),
      onSelect: () => openPlugins({ line: `kind:${cat as LibraryCategory}`, page: `asset:${item.id}` }) }] : [];
    if (!keep.length && !details.length) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, items: [...keep, ...details] });
  };
  /* a thing of the library copied into one of the person's folders, said once it is there */
  const keepInMine = (from: string, into: string, name?: string) => {
    void copyFromLibrary(from, into, name).then(
      () => setNotice(t('saved.added').replace('{n}', '1').replace('{place}', folders.find((f) => f.path === into)?.name ?? '')),
      (error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
  };
  /* the text category's groups, word art or templates by what they hold */
  const textGroups = React.useMemo(() => {
    const of = { [ART]: new Set<string>(), [TEMPLATES]: new Set<string>() };
    for (const item of index?.items ?? []) {
      const kind = item.cat === 'text' ? textKind(item) : null;
      if (kind === ART || kind === TEMPLATES) of[kind].add(item.group);
    }
    const named = (ids: Set<string>) => (index?.groups.text ?? []).filter((g) => ids.has(g.id)).map((g) => ({ id: g.id, name: nameOf(g.name, lang), by: g.by }));
    return { [ART]: named(of[ART]), [TEMPLATES]: named(of[TEMPLATES]) };
  }, [index, lang]);
  /* a folder or a pack held and moved up or down the side bar: it follows the pointer while the others make room, and
     takes its place as it is let go (Esc: back where it was) */
  const railNav = React.useRef<HTMLElement>(null);
  const [railDrag, setRailDrag] = React.useState<{ key: string; dy: number; from: number; to: number; step: number } | null>(null);
  /* a press that became a drag is not also a click */
  const railDragged = React.useRef(false);
  /* the side bar's lines: first what is the person's here (a new line of words, this project, their looks), then their
     folders and the packs as one list in their order */
  /* the media's side bar is where the person's files are (this project, their folders); every other category's is its
     groups, in folding sections (OpenFilm's, the Community's added packs; the text's looks and templates) */
  const sectioned = cat !== 'media' && cat !== 'voice' && cat !== 'captions' && cat !== 'cover' && cat !== 'coverPicture';
  const head: Line[] = [
    ...(cat === 'text' ? [{ key: NEW_TEXT, kind: 'new' as const, name: t('assetDrawer.textNew') }] : []),
    ...(sectioned ? [] : [{ key: 'project', kind: 'project' as const, name: t('assetDrawer.mediaProject') }]),
    ...(cat === 'text' ? [{ key: PRESETS, kind: 'presets' as const, name: t('assetDrawer.textPresets') }] : []),
  ];
  const packs: Line[] = cat === 'text'
    ? [ART, TEMPLATES].flatMap((section) => textGroups[section as TextSection]
      /* OpenFilm's own text is under 官方 as its looks and its templates, not pack by pack: the Community's packs got */
      .filter((g) => g.by && (added.includes(g.id) || (index?.items ?? []).some((it) => it.cat === 'text' && it.group === g.id && inLibrary(it, added))))
      .map((g) => ({ key: packKey(g.id), kind: 'pack' as const, name: g.name, group: `${section}:${g.id}` })))
    /* the media's too: OpenFilm's own packs of footage, pictures and sounds, and the Community's got (lines under 社区,
       not copies in 我的; one is kept there as well from its menu or by a drag) */
    : [...own.map((g) => ({ key: packKey(g.id), kind: 'pack' as const, name: g.name, group: g.id, official: true })),
      ...addedPacks.map((g) => ({ key: packKey(g.id), kind: 'pack' as const, name: g.name, group: g.id }))];
  const packsShown = packs.filter((p, i) => !hidden.includes(p.key) && packs.findIndex((o) => o.key === p.key) === i);
  /* the person's folders (the media's 我的), in their order; a category's packs (under 官方 and 社区) */
  const movable = sectioned ? packsShown : inOrder(
    folders.map((f): Line => ({ key: f.path, kind: 'folder', name: f.name, ...(f.link ? { link: f.link } : {}) })),
    (line) => line.key, order);
  /* the packs of a category, under its namespaces: OpenFilm's own (官方), those got from the Community (社区) */
  const officialPacks = cat === 'text' ? [] : packsShown.filter((p) => p.official);
  const communityPacks = packsShown.filter((p) => !p.official);
  const [folded, setFolded] = React.useState<Record<string, boolean>>(readFolded);
  const fold = (id: string) => setFolded((was) => { const next = { ...was, [`${cat}:${id}`]: !was[`${cat}:${id}`] }; keepFolded(next); return next; });
  const lines = [...head, ...movable];
  const holdLine = (e: React.PointerEvent<HTMLElement>, key: string) => {
    if (e.button !== 0 || renaming) return;
    const keys = movable.map((l) => l.key);
    const rows = keys.map((k) => railNav.current?.querySelector<HTMLElement>(`[data-rail-line="${CSS.escape(k)}"]`)?.getBoundingClientRect());
    const from = keys.indexOf(key);
    if (from < 0 || rows.some((r) => !r)) return;
    const mids = rows.map((r) => r!.top + r!.height / 2);
    const step = rows.length > 1 ? rows[1]!.top - rows[0]!.top : rows[0]!.height + 4;
    const y = e.clientY;
    let to = from, started = false;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - y;
      if (!started && Math.abs(dy) < 4) return;
      started = true;
      const middle = mids[from]! + dy;
      to = mids.filter((m, i) => i !== from && m < middle).length;
      setRailDrag({ key, dy, from, to, step });
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', escape, true);
      if (!started) return;
      railDragged.current = true;
      window.setTimeout(() => { railDragged.current = false; });
      if (commit && to !== from) {
        const next = keys.filter((k) => k !== key);
        next.splice(to, 0, key);
        void shelfActions.arrange(next);
      }
      setRailDrag(null);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const escape = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && started) { ev.preventDefault(); ev.stopPropagation(); end(false); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', escape, true);
  };
  /* where a line is drawn while one is dragged: the one held under the pointer, the ones it passed a line over */
  const railShift = (i: number, key: string): React.CSSProperties | undefined => {
    if (!railDrag) return undefined;
    const { from, to, step, dy } = railDrag;
    if (key === railDrag.key) return { transform: `translateY(${dy}px)`, position: 'relative', zIndex: 10 };
    const by = from < to && i > from && i <= to ? -step : from > to && i >= to && i < from ? step : 0;
    return { transform: `translateY(${by}px)`, transition: 'transform 150ms cubic-bezier(.2,.8,.2,1)' };
  };
  /* the voice-over and the captions have lines of their own, not the library's folders */
  const ownLines = cat === 'voice' || cat === 'captions' || cat === 'cover' || cat === 'coverPicture';
  /* the line picked: the media's is the media pane's; elsewhere the one picked last, else the first pack */
  const picking = cat === 'media' ? mediaScope : lineKey;
  const current = lines.find((line) => line.key === picking)
    ?? (cat === 'media' ? head[0] : lines.find((line) => line.kind === 'new') ?? movable.find((line) => line.kind === 'pack') ?? head[0])!;
  /* the media's files (this project's, a folder of the person's), unless one of its namespaces is shown (`group`) */
  const ownShown = !ownLines && (current.kind === 'project' || current.kind === 'folder') && !(cat === 'media' && group !== '');
  /* a namespace shown whole (or the text's looks or templates, OpenFilm's): no line in it lit */
  const wholeShown = group === STARRED || group === OFFICIAL_ALL || group === COMMUNITY_ALL || (cat === 'text' && (group === ART || group === TEMPLATES));
  const lineOn = (line: Line) => !(q && !ownShown) && (cat === 'media'
    ? (line.kind === 'pack' ? group === line.group : group === '' && line.key === current.key)
    : line.key === current.key && !(sectioned && wholeShown));
  const pickLine = (line: Line) => {
    SHOWN.line[cat] = line.key; setLineKey(line.key);
    if (line.kind === 'project' || line.kind === 'folder') { onMediaScope(line.key); if (cat === 'media') pickGroup(''); }
    else pickGroup(line.kind === 'new' ? NEW_TEXT : line.kind === 'presets' ? PRESETS : line.group ?? '');
  };  /* the side bar as namespaces (all but the media's): a box picks, or opens to the lines it holds */
  type RailNode = { key: string; name: string; on?: boolean; onPick?: () => void; line?: Line; children?: RailNode[] };
  const railPick = (id: string): RailNode => ({ key: id || 'all', name: '', on: group === id && !(q && id !== RECORD), onPick: () => pickGroup(id) });
  const ofLine = (line: Line): RailNode => ({ key: line.key, name: line.name, on: lineOn(line), onPick: () => pickLine(line), line });
  /* the voice-over's own: the person's (recording, then their voices cloned), the starred, the services */
  const inMine = cat === 'voice' && (group === MY_VOICES || group === RECORD);
  /* a category's namespaces: OpenFilm's own (shown only when it has some), then the Community's (always: the way to
     get more); each box shows all it holds, its lines below it one pack each */
  const officialChildren: RailNode[] = cat === 'text'
    ? [ART, TEMPLATES].filter((section) => textGroups[section as TextSection].some((g) => !g.by))
      .map((section) => ({ ...railPick(section), name: t(section === ART ? 'assetDrawer.textArt' : 'assetDrawer.textTemplates') }))
    : officialPacks.map(ofLine);
  const spaces: RailNode[] = [
    ...(officialChildren.length ? [{ ...railPick(OFFICIAL_ALL), key: 'openfilm', name: t('assetDrawer.railOfficial'), children: officialChildren }] : []),
    { ...railPick(COMMUNITY_ALL), key: 'community', name: t('assetDrawer.railCommunity'), children: communityPacks.map(ofLine) },
  ];
  const nodes: RailNode[] = cat === 'voice' ? [
    { ...railPick(STARRED), name: t('assetDrawer.favorites') },
    { key: 'mine', name: t('assetDrawer.railMine'), on: inMine && !q, onPick: () => pickGroup(MY_VOICES) },
    { key: 'services', name: t('assetDrawer.railServices'), children: [
      { ...railPick(''), name: t('assetDrawer.all') },
      ...(voices?.providers ?? []).map((s) => ({ ...railPick(s.id), name: providerName(s, lang) })),
    ] },
  ] : cat === 'cover' ? [
    { ...railPick(''), name: t('covers.allLooks') },
    ...(covers?.looks?.categories ?? []).map((c) => ({ ...railPick(c.id), name: nameOf(c.name, lang) })),
  ] : cat === 'coverPicture' ? [
    { ...railPick('film'), name: t('covers.fromFilm') },
    { ...railPick('local'), name: t('covers.fromLocal') },
    { ...railPick('color'), name: t('covers.fromColor') },
    { ...railPick('ai'), name: t('covers.fromAi') },
  ] : cat === 'captions' ? [
    { ...railPick('speech'), name: t('assetDrawer.captionsFromSpeech') },
    { ...railPick('file'), name: t('assetDrawer.captionsFromFile') },
    { ...railPick('hand'), name: t('assetDrawer.captionsByHand') },
  ] : [
    /* the same order in every category: (the text's new line), 收藏, (the text's 我的: its looks saved), 官方, 社区 */
    ...head.filter((l) => l.kind === 'new').map(ofLine),
    { ...railPick(STARRED), name: t('assetDrawer.favorites') },
    ...head.filter((l) => l.kind === 'presets').map((l) => ({ ...ofLine(l), name: t('assetDrawer.railMine') })),
    ...spaces,
  ];

  /* the line shown is the pack's or the folder's it says (as the drawer opens, as the category changes) */
  React.useEffect(() => {
    if (ownLines) return;
    if ((current.kind === 'project' || current.kind === 'folder') && mediaScope !== current.key) onMediaScope(current.key);
    const want = current.kind === 'pack' ? current.group ?? '' : current.kind === 'new' ? NEW_TEXT : current.kind === 'presets' ? PRESETS : null;
    if (want != null && want !== group) { SHOWN.group[cat] = want; setGroup(want); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current.key, cat]);
  /* a folder of the person's renamed in place: the folder itself, and the line picked follows it */
  const renameFolder = (line: Line, raw: string) => {
    const name = safeName(raw);
    const to = `${line.key.slice(0, line.key.lastIndexOf('/'))}/${name}`;
    if (!name || to === line.key) return;
    void savedActions.move(line.key, to).then((result) => { if (result === 'ok' && current.key === line.key) pickLine({ ...line, key: to }); });
  };
  const makeFolder = async (raw: string) => {
    const name = safeName(raw);
    if (!name) return;
    if (await savedActions.newFolder(`${SAVED}/${name}`) === 'ok') pickLine({ key: `${SAVED}/${name}`, kind: 'folder', name });
  };
  /* a line's menu: a folder of the person's renamed, shown in the file manager, taken away (a linked one: its link
     only), sent to the Community; a pack taken out of the library (the Community's go back to it) */
  const lineMenu = (line: Line): ContextMenuItem[] => line.kind === 'folder' ? [
    { id: 'rename', label: t('assets.rename'), icon: <Pencil size={14} />, onSelect: () => setRenaming(line.key) },
    { id: 'reveal', label: t('projects.revealFolder'), icon: <FolderOpen size={14} />, onSelect: () => savedActions.reveal(line.key, Boolean(line.link)) },
    { id: 'publish', label: t('assetDrawer.contribute'), icon: <Upload size={14} />, onSelect: () => openPlugins({ line: 'publish' }) },
    { id: 'delete', label: t(line.link ? 'resourceCenter.removeLink' : 'assets.delete'), icon: <Trash2 size={14} />, danger: true, onSelect: () => setGone(line) },
  ] : line.kind === 'pack' ? [
    /* the Community's packs only: OpenFilm's own are not in the Community (they are its 官方) */
    ...(inCommunity && !line.official ? [{ id: 'community', label: t('assetDrawer.seeInCommunity'), icon: <Community size={14} />, onSelect: () => openPlugins({ line: `kind:${cat as LibraryCategory}` }) }] : []),
    /* a pack of the Community's media: its files kept as a folder of the person's own too */
    ...(cat === 'media' && !line.official && line.group ? [{ id: 'save', label: t('assetDrawer.saveToMine'), icon: <BookmarkPlus size={14} />,
      onSelect: () => { const id = line.group!; void savePack(id, lang).then((path) => { refreshSaved(); setNotice(t('saved.added').replace('{n}', '1').replace('{place}', path.split('/').at(-1) ?? '')); },
        (error: unknown) => setNotice(error instanceof Error && error.message !== 'failed' ? error.message : t('assetDrawer.mediaSaveFailed'))); } }] : []),
    { id: 'remove', label: t('assetDrawer.removePack'), icon: <Trash2 size={14} />, onSelect: () => { if (line.official) void shelfActions.hide(line.key, true); else setAdded(line.key.slice(5), false); } },
  ] : [];
  /* what is dropped on one of the person's folders goes in it: files of this computer brought in, the folder's own moved,
     a file of the project kept there, a thing of the library or a pack copied there */
  const dropOn = (line: Line) => ({
    accepts: (data: DataTransfer) => [...data.types].includes('Files') || [...data.types].includes(RESOURCE_DRAG_TYPE) || Boolean(peekResourceDrag()),
    onDrop: (e: React.DragEvent) => {
      const files = [...e.dataTransfer.files];
      const thing = peekResourceDrag();
      clearResourceDrag();
      if (files.length && !thing) { onUpload(files, line.key); return; }
      if (!thing) return;
      const name = thing.path.split('/').at(-1) ?? thing.name;
      if (thing.path.startsWith(`${SAVED}/`)) void savedActions.move(thing.path, `${line.key}/${name}`);
      else if (thing.saved?.startsWith(`${BUILT_IN}/`) || thing.path.startsWith(`${BUILT_IN}/`)) {
        /* a file of the Community's by its name (its own file is named for the catalog) */
        const named = (thing.saved ?? thing.path).startsWith(`${BUILT_IN}/community/`) && thing.kind !== 'mg' && thing.kind !== 'other' ? thing.name : undefined;
        void copyFromLibrary(thing.saved ?? thing.path, line.key, named).catch((error: unknown) => setNotice(error instanceof Error ? error.message : String(error)));
      } else onKeep(thing.path, thing.name, line.key);
    },
  });
  /* where "Upload files…" puts them: the folder or the project shown, else the project */
  const uploadInto = ownShown ? current.key : 'project';
  const kindName = categoryName(cat);
  /* the media's "+ Add": folders made or linked, more from the Community, how to make media and contributing them (a
     folder's own upload is in its pane) */
  const addMenu = (): ContextMenuItem[] => [
    { id: 'folder', label: t('assets.newFolder'), icon: <FolderPlus size={14} />, onSelect: () => setMaking(true) },
    { id: 'link', label: t('assetDrawer.linkFolder'), note: t('resourceCenter.networkHint'), icon: <Link2 size={14} />, onSelect: () => void linkFolder() },
    { id: 'community', label: t('assetDrawer.getMore'), icon: <Community size={14} />, onSelect: () => openPlugins(inCommunity ? { line: `kind:${cat as LibraryCategory}` } : {}) },
    { id: 'how', label: t('assetDrawer.howToMake').replace('{kind}', kindName), icon: <CircleHelp size={14} />, onSelect: () => { window.open(MAKING_GUIDE, '_blank', 'noreferrer'); } },
    { id: 'publish', label: t('assetDrawer.contribute'), icon: <Upload size={14} />, onSelect: () => openPlugins({ line: 'publish' }) },
  ];
  /* OpenFilm's own packs taken out of this category: the menu that puts them back */
  const hiddenBack = (): ContextMenuItem[] => hidden.some((key) => packs.some((p) => p.key === key && p.official))
    ? [{ id: 'hidden', label: t('assetDrawer.removedPacks'), icon: <Package size={14} />,
      submenu: packs.filter((p) => p.official && hidden.includes(p.key)).map((p) => ({ id: p.key, label: p.name, onSelect: () => void shelfActions.hide(p.key, false) })) }]
    : [];
  /* "+ Add" of a category's side bar: more of it from the Community, how to make it, sending one, and OpenFilm's packs
     taken out, put back */
  const kindMenu = (): ContextMenuItem[] => [
    { id: 'community', label: t('assetDrawer.getMore'), icon: <Community size={14} />, onSelect: () => openPlugins(inCommunity ? { line: `kind:${cat as LibraryCategory}` } : {}) },
    { id: 'how', label: t('assetDrawer.howToMake').replace('{kind}', kindName), icon: <CircleHelp size={14} />, onSelect: () => { window.open(MAKING_GUIDE, '_blank', 'noreferrer'); } },
    { id: 'publish', label: t('assetDrawer.contribute'), icon: <Upload size={14} />, onSelect: () => openPlugins({ line: 'publish' }) },
    ...hiddenBack(),
  ];
  /* one of the person's folders (or a pack) in the media's side bar: renamed in place, held and moved, dropped on */
  const mineLine = (line: Line, i: number, look: 'box' | 'child') => renaming === line.key ? (
    <RailName key={line.key} value={line.name} onDone={(name) => { setRenaming(null); renameFolder(line, name); }} onCancel={() => setRenaming(null)} />
  ) : (
    <RailLine key={line.key} look={look} label={look === 'box' ? t('assetDrawer.railMine') : undefined} line={line} on={lineOn(line)}
      onPick={() => { if (!railDragged.current) pickLine(line); }}
      onMenu={(e) => { e.preventDefault(); setRailMenu({ x: e.clientX, y: e.clientY, items: lineMenu(line) }); }}
      onHold={look === 'child' ? (e) => holdLine(e, line.key) : undefined} held={railDrag?.key === line.key} style={look === 'child' ? railShift(i, line.key) : undefined}
      drop={line.kind === 'folder' ? dropOn(line) : undefined} />
  );
  const linkFolder = async () => {
    const picked = await pickFromComputer(t('assetLibrary.connectFolder'), true);
    if (picked === 'no-dialog') { setNotice(t('media.noDialog')); return; }
    if (!picked.length) return;
    const [landed] = await savedActions.bring(picked, SAVED, 'link');
    if (landed) pickLine({ key: landed, kind: 'folder', name: landed.split('/').at(-1) ?? landed });
  };
  const [notice, setNotice] = React.useState('');
  /* square cards for the looks (and the person's), wide ones for the templates */
  const textSquare = cat === 'text' && (sectionOf(group) === ART || group === PRESETS || group === NEW_TEXT);
  const askMusic = studioHost?.ask;
  const groupName = (id: string) => own.find((g) => g.id === id)?.name ?? '';
  const dragProps = (item: LibraryItem) => ({ onDragStart: dragOf(item, nameOf(item.name, lang)), onDragEnd: () => clearResourceDrag() });
  /* a long list (thousands of sounds) is drawn a page at a time, from its top again when what it lists changes */
  const pageSize = cat === 'sticker' ? STICKER_PAGE : PAGE;
  const pageKey = JSON.stringify([cat, group, query, source]);
  const [page, setPage] = React.useState({ key: pageKey, count: pageSize });
  const drawn = page.key === pageKey ? page.count : pageSize;
  const list = React.useRef<HTMLDivElement>(null);
  const nextPage = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    if (list.current) list.current.scrollTop = 0;
    setPage((prior) => prior.key === pageKey ? prior : { key: pageKey, count: pageSize });
  }, [pageKey, pageSize]);
  React.useEffect(() => {
    if (!isShown || drawn >= items.length || !list.current || !nextPage.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        observer.disconnect();
        setPage({ key: pageKey, count: drawn + pageSize });
      }
    }, { root: list.current, rootMargin: `0px 0px ${cat === 'sticker' ? 120 : 600}px` });
    observer.observe(nextPage.current);
    return () => observer.disconnect();
  }, [isShown, cat, drawn, items.length, pageKey, pageSize]);
  React.useEffect(() => {
    if (!isShown) return;
    const visible = items.slice(0, drawn);
    askHere([...visible.filter(mayNeedFetch).map((i) => i.id),
      ...visible.filter((i) => i.kind === 'group').map(templateExamplePath)]);
  }, [isShown, items, drawn]);

  /* a namespace of the side bar, as a box: one that shows its whole picks it (opened); its arrow, or a box that only
     holds others, folds it; each line under it a pack (or the voice-over's services) */
  const railNode = (node: RailNode): React.ReactNode => {
    if (!node.children) {
      return (
        <button key={node.key} type="button" onClick={node.onPick} aria-pressed={node.on} title={node.name}
          data-rail-line={node.line?.key} data-rail-kind={node.line?.kind}
          className={`${RAIL_BOX} ${node.on ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
        </button>
      );
    }
    const open = !folded[`${cat}:${node.key}`];
    const lit = Boolean(node.on) || node.children.some((c) => c.on);
    const whole = Boolean(node.onPick);
    return (
      <div key={node.key} className="flex flex-col" data-rail-section={node.key}>
        <button type="button" aria-expanded={node.children.length ? open : undefined} aria-pressed={whole ? Boolean(node.on) : undefined} title={node.name}
          onClick={(e) => {
            /* the box itself opens or folds it, as its arrow does; one that shows its whole is picked as it opens */
            const arrow = Boolean((e.target as HTMLElement).closest('[data-rail-fold]'));
            if (node.children?.length) fold(node.key);
            if (whole && !arrow && (!open || !node.children?.length)) node.onPick?.();
          }}
          className={`${RAIL_BOX} ${lit ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
          <span className="min-w-0 flex-1 truncate">{node.name}</span>
          {node.children.length ? (
            <span data-rail-fold="" className="-mr-1 grid h-5 w-5 shrink-0 place-items-center rounded hover:bg-[var(--bg-hover)]">
              <ChevronDown size={13} aria-hidden className={`transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
            </span>
          ) : null}
        </button>
        {open ? node.children.map((child) => (
          <button key={child.key} type="button" onClick={child.onPick} aria-pressed={child.on} title={child.name}
            data-rail-line={child.line?.key} data-rail-kind={child.line?.kind}
            onContextMenu={child.line ? (e) => { e.preventDefault(); setRailMenu({ x: e.clientX, y: e.clientY, items: lineMenu(child.line!) }); } : undefined}
            className={`${RAIL_CHILD} ${child.on ? 'text-[var(--accent)]' : 'text-[var(--text)] hover:text-[var(--accent)]'}`}>
            <span className="min-w-0 flex-1 truncate">{child.name}</span>
          </button>
        )) : null}
      </div>
    );
  };

  /* the bars and the library's things are the app's panel's (data-studio-host-panel): a press there keeps what is
     picked on the timeline and the picture, which a look or a transition goes on */
  return (
    /* a drag let go back in the drawer ends at once (lib/resource-drag) */
    <div className="flex h-full min-h-0 min-w-0 flex-col outline-none" tabIndex={-1} onKeyDown={onKey} onPointerDownCapture={stopHover} onDragStartCapture={stopHover} data-drag-home="" data-studio-library=""
      style={{ '--drawer-under': `${under}px`, '--drawer-beside': `${beside}px`, '--drawer-foot': `${footInset(under, beside)}px` } as React.CSSProperties}>
      {isShown && previewPicture && player.item ? (
        <AudioArtwork target={previewPicture} item={player.item} name={nameOf(player.item.name, lang)} playing={player.playing}
          progress={player.duration > 0 ? Math.min(1, player.time / player.duration) : 0} />
      ) : null}
      {isShown && previewPicture && voicePlayer.item ? (
        <AudioArtwork target={previewPicture} voice={voicePlayer.item.voice} name={voicePlayer.item.voice.name} playing={voicePlayer.playing} readLevel={voicePlayer.readLevel} />
      ) : null}
      {/* the categories, as high as the inspector's tabs beside it (40 px) so their lines meet; they keep their own
          spacing however wide the panel is, and more than fit scroll sideways (a wheel too), fading at the edge while
          the line under them runs whole; a button at the end takes them to their last (») and back to their first («),
          for a mouse without a sideways wheel */}
      <div className="flex h-10 shrink-0 border-b border-[var(--border)] bg-[var(--bg-panel)]" data-studio-host-panel="">
        <nav
          ref={bar.ref}
          onScroll={bar.read}
          onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}
          className={`flex h-full min-w-0 flex-1 overflow-x-auto px-1 [scrollbar-width:none] ${bar.end ? '' : '[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]'}`}
        >
          {categories.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => show(id)}
              aria-pressed={cat === id}
              className={`relative my-1 flex min-w-[46px] shrink-0 flex-col items-center justify-center gap-px whitespace-nowrap rounded-md px-2 text-[10.5px] leading-[13px] ${cat === id ? 'font-semibold text-[var(--accent)]' : 'font-medium text-[var(--text)] hover:text-[var(--accent)]'}`}
            >
              {/* the one shown: its icon and name in the accent, nothing else; the voice-over's with a red dot while it records */}
              <span className="relative flex">
                <CategoryMark id={id} tabs={tabs} on={cat === id} size={18} />
                {id === 'voice' && recording ? <span data-recording="" className="absolute -right-[3px] -top-[1px] h-[7px] w-[7px] animate-pulse rounded-full bg-[var(--err)]" aria-hidden /> : null}
              </span>
              {categoryName(id)}
            </button>
          ))}
        </nav>
        {bar.over ? (
          <button type="button" onClick={bar.toggle} title={t(bar.end ? 'assetDrawer.catsStart' : 'assetDrawer.catsMore')}
            aria-label={t(bar.end ? 'assetDrawer.catsStart' : 'assetDrawer.catsMore')}
            className="grid w-8 shrink-0 place-items-center text-[var(--text-muted)] hover:text-[var(--text)]">
            {bar.end ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
          </button>
        ) : null}
      </div>
      {/* a plugin's tab: its surface, the whole of the drawer under the categories */}
      {tab ? (
        <div className="flex min-h-0 flex-1" data-library-tab={tab.id}>
          {projectId ? <PluginSurface id={tab.id} page={tab.page} files={tab.files} program={tab.program} runs={tab.runs} inApp={tab.inApp} element={tab.element} projectId={projectId} folder={folder} keep /> : null}
        </div>
      ) : (
      <div className="flex min-h-0 flex-1">
        {/* as wide as the person dragged its edge (RAIL), kept for next time */}
        <div className="relative flex shrink-0" style={{ width: rail }}>
          <RailEdge width={rail} onWidth={setRail} />
          <nav ref={railNav} data-studio-host-panel="" className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto border-r border-[var(--border)] px-2 pb-[var(--drawer-foot)] pt-2.5">
            {/* the side bar is the library's folders: this project's, the person's own (the library folder's), the packs
                of the Community (OpenFilm's own among them), as one list in the person's order; the right side shows
                what of this category the line picked holds */}
            {/* the voice-over's, the captions' and every category's but the media's: namespaces, as boxes; one that holds
                others opens to them, each a line of its words (the media's are its folders, below) */}
            {ownLines || sectioned ? <div className="flex flex-col gap-2">{nodes.map(railNode)}</div> : (
              /* the media's: 导入 (this project), 收藏, 我的 (the person's folders; one alone is 我的 itself), then 官方 and 社区 */
              <div className="flex flex-col gap-2">
                {head.map((line) => <RailLine key={line.key} look="box" line={line} on={lineOn(line)} onPick={() => pickLine(line)} />)}
                {railNode({ ...railPick(STARRED), name: t('assetDrawer.favorites') })}
                {movable.length === 1 && renaming !== movable[0]!.key ? mineLine(movable[0]!, 0, 'box') : movable.length ? (
                  <div className="flex flex-col" data-rail-section="mine">
                    <button type="button" aria-expanded={!folded[`${cat}:mine`]} onClick={() => fold('mine')}
                      className={`${RAIL_BOX} ${movable.some(lineOn) ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>
                      <span className="min-w-0 flex-1 truncate">{t('assetDrawer.railMine')}</span>
                      <ChevronDown size={13} aria-hidden className={`shrink-0 transition-transform duration-150 ${folded[`${cat}:mine`] ? '' : 'rotate-180'}`} />
                    </button>
                    {folded[`${cat}:mine`] ? null : movable.map((line, i) => mineLine(line, i, 'child'))}
                  </div>
                ) : null}
                {spaces.map(railNode)}
              </div>
            )}
            {making ? <RailName value={t('assets.newFolder')} onDone={(name) => { setMaking(false); void makeFolder(name); }} onCancel={() => setMaking(false)} /> : null}
            {railMenu ? <ContextMenu x={railMenu.x} y={railMenu.y} flipTo={railMenu.flipTo} items={railMenu.items} onClose={() => setRailMenu(null)} /> : null}
            {notice ? <div role="status" className="rounded-md bg-[var(--bg-hover)] px-2 py-1.5 text-[11px] text-[var(--text-muted)]" onClick={() => setNotice('')}>{notice}</div> : null}
            <ConfirmDialog open={Boolean(gone)} danger={!gone?.link}
              title={gone?.link ? t('resourceCenter.removeLink') : t('media.deleteFolderTitle').replace('{name}', gone?.name ?? '')}
              description={gone?.link ? t('resourceCenter.removeLinkHint') : t('assets.deleteConfirm')}
              confirmLabel={gone?.link ? t('resourceCenter.removeLink') : t('assets.delete')} cancelLabel={t('confirm.cancel')}
              onCancel={() => setGone(null)}
              onConfirm={() => { const line = gone; setGone(null); if (line) void savedActions.remove(line.key).then((result) => { if (result === 'ok' && current.key === line.key) pickLine(head.find((l) => l.kind === 'project')!); }); }} />
            {/* at the side bar's foot: adding to the library (files, a folder, a linked one, more from the Community) */}
            <input ref={uploadRef} type="file" multiple className="hidden" onChange={(e) => { const files = [...(e.target.files ?? [])]; e.target.value = ''; if (files.length) onUpload(files, uploadInto); }} />
            {/* a category's: more of it from the Community; the media's: "+ Add", said beside its sign */}
            {sectioned ? (
              <button type="button" data-rail-add=""
                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setRailMenu({ x: r.left, y: r.bottom, flipTo: r.top - 4, items: kindMenu() }); }}
                className="mt-auto flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]">
                <Plus size={14} aria-hidden className="shrink-0" />
                <span className="truncate">{t('assetDrawer.addMenu')}</span>
              </button>
            ) : ownLines ? null : (
              <button type="button" data-rail-add=""
                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setRailMenu({ x: r.left, y: r.bottom, flipTo: r.top - 4, items: addMenu() }); }}
                className="mt-auto flex h-8 shrink-0 items-center gap-2 rounded-md px-2 text-left text-[12px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-1 focus-visible:outline-[var(--accent)]">
                <Plus size={14} aria-hidden className="shrink-0" />
                <span className="truncate">{t('assetDrawer.addMenu')}</span>
              </button>
            )}
          </nav>
        </div>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-studio-host-panel={ownShown ? undefined : ''}>
          {ownShown ? media(kindsOf(cat)) : cat === 'captions' ? (captions ? <CaptionsPane actions={captions} source={group as CaptionsSource} /> : null)
            : cat === 'cover' || cat === 'coverPicture' ? (covers ? <CoversPane actions={covers} category={cat === 'cover' ? 'cover' : 'coverPicture'} line={group as CoversLine} /> : null)
            : (
            <>
              {/* the person's own voice-over: recording at the top, then cloning their voice (and those cloned) */}
              {inMine ? (
                <div className="min-h-0 flex-1 overflow-y-auto pb-4" data-voice-mine="">
                  <h3 className="px-3 pb-2 pt-3 text-[12px] font-semibold text-[var(--text)]">{t('assetDrawer.voiceRecord')}</h3>
                  {recorder ? <RecordPane recorder={recorder} compact /> : null}
                  <h3 className="px-3 pb-2 pt-5 text-[12px] font-semibold text-[var(--text)]">{t('assetDrawer.mineClone')}</h3>
                  <VoicesPane group={MY_VOICES} query="" favorites={favorites} onServices={onServices} onAll={() => pickGroup('')} speak={speak}
                    onMyVoices={() => pickGroup(MY_VOICES)} projectId={projectId}
                    player={voicePlayer} previewBar={previewBar} picked={picked} onPick={(id) => { setPicked(id); onPreviewStart(); }} onClosePreview={closePreview} />
                </div>
              ) : (
            <>
              {/* a page has its own way back instead */}
              <div className="flex gap-2 px-3 pb-2 pt-2.5">
                <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-[var(--bg-field)] px-2.5 text-[var(--text-faint)] focus-within:ring-1 focus-within:ring-[var(--accent)]">
                  <Search size={14} />
                  <input
                    value={query}
                    onChange={(e) => { stopHover(); setQuery(e.target.value); }}
                    placeholder={t('assetDrawer.search').replace('{what}', categoryName(cat))}
                    className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
                  />
                </label>
              </div>
              {cat !== 'voice' && !(cat === 'text' && (group === NEW_TEXT || group === PRESETS)) ? <SourceChips sources={sources} value={source} onChange={setSource} /> : null}
              {cat === 'voice' ? <VoicesPane group={group} query={query} favorites={favorites} onServices={onServices} onAll={() => pickGroup('')} speak={speak}
                  onMyVoices={() => pickGroup(MY_VOICES)} projectId={projectId}
                  player={voicePlayer} previewBar={previewBar} picked={picked} onPick={(id) => { setPicked(id); onPreviewStart(); }} onClosePreview={closePreview} /> : (
              <>
              {/* a click on nothing lets the picked thing go */}
              <div
                ref={list}
                className={`min-h-0 flex-1 overflow-y-auto px-3 pt-0.5 ${!previewBar && player.item ? 'pb-3' : FOOT_ROOM}`}
                onClick={(e) => { if (e.target === e.currentTarget) closePreview(); }}
                onContextMenu={onListMenu}
              >
                {cat === 'text' && group === PRESETS && !q ? (
                  presets.length ? (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-x-2.5 gap-y-3">
                      {presetItems.map((item) => <PresetCard key={item.id} item={item} lang={lang} picked={picked === item.id}
                        onPick={() => pick(item)} onAdd={() => addWhenHere(item)} onDrop={() => dropPreset(item.id.slice('presets/'.length))} />)}
                    </div>
                  ) : <Empty icon="star" text={t('assetDrawer.textNoPresets')} />
                ) : !items.length && !mineItems.length ? (
                  q ? <Empty icon="search" text={t('assetDrawer.nothing').replace('{q}', query.trim())} />
                    : group === STARRED ? <Empty icon="star" text={t('assetDrawer.noFavorites')} />
                    /* nothing got from the Community yet: the way to get some, its kind's page there */
                    : group === COMMUNITY_ALL ? <Empty icon="community" text={t('assetDrawer.communityNone').replace('{kind}', kindName)}
                        action={t('assetDrawer.getMore')} block onAction={() => openPlugins(inCommunity ? { line: `kind:${cat as LibraryCategory}` } : {})} />
                    : cat === 'music' ? <Empty icon="music" text={t('assetDrawer.musicSoon')} action={askMusic ? t('assetDrawer.musicMake') : undefined}
                        onAction={() => askMusic?.({ text: t('assetDrawer.musicAsk'), refs: [] })} />
                        : null
                ) : cat === 'sound' ? (
                  <div className="flex flex-col gap-0.5">
                    {items.slice(0, drawn).map((it) => (
                      <SoundRow key={it.id} item={it} name={nameOf(it.name, lang)} group={groupName(it.group)} picked={picked === it.id} player={player} kept={favorites.includes(it.id)}
                        addTip={addTip(it, t)} onPick={() => pick(it)} onAdd={() => addWhenHere(it)} drag={dragProps(it)}
                        here={hereOf(it.id)} />
                    ))}
                  </div>
                ) : cat === 'music' ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                    {items.slice(0, drawn).map((it) => (
                      <MusicCard key={it.id} item={it} name={nameOf(it.name, lang)} group={groupName(it.group)} picked={picked === it.id} player={player} kept={favorites.includes(it.id)}
                        addTip={addTip(it, t)} onPick={() => pick(it)} onAdd={() => addWhenHere(it)} drag={dragProps(it)}
                        here={hereOf(it.id)} />
                    ))}
                  </div>
                ) : (
                  <div className={`grid gap-x-2.5 gap-y-3 ${cat === 'sticker' ? 'grid-cols-[repeat(auto-fill,minmax(104px,1fr))]' : cat === 'template' ? 'grid-cols-[repeat(auto-fill,minmax(150px,1fr))]' : textSquare || ON_FILM.has(cat) ? 'grid-cols-[repeat(auto-fill,minmax(84px,1fr))]' : cat === 'text' ? 'grid-cols-[repeat(auto-fill,minmax(120px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(96px,1fr))]'}`}>
                    {/* the person's own files starred (the media's 收藏), then the library's */}
                    {mineItems.map((file) => (
                      <SavedCard key={file.path} file={file} picked={picked === `saved:${file.path}`}
                        onPick={() => { setPicked(`saved:${file.path}`); onPickSaved?.(file); }} onAdd={onAddSaved ? () => onAddSaved(file) : undefined} />
                    ))}
                    {/* a page at a time as it is scrolled, as the sounds are (the emoji alone are some 1,600) */}
                    {items.slice(0, drawn).map((it) => (
                      <Card key={it.id} item={it} lang={lang} picked={picked === it.id} kept={favorites.includes(it.id)} mark={group === STARRED}
                        /* a template as wide as its film (16:9, two a row: its places, length and buttons side by side) */
                        square={cat === 'sticker' || textSquare || (ON_FILM.has(cat) && cat !== 'template')}
                        here={cardHere(it)} hover={hoverCard(it)} previewing={hoverVisual === it.id}
                        onPick={() => pick(it)} onAdd={() => addWhenHere(it)} />
                    ))}
                  </div>
                )}
                {drawn < items.length ? <div ref={nextPage} className="h-px" aria-hidden /> : null}
              </div>
              <MiniPlayer target={previewBar} player={player} name={player.item ? nameOf(player.item.name, lang) : ''} />
              {menu ? <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} /> : null}
              </>
              )}
            </>
              )}
            </>
          )}
        </div>
      </div>
      )}
    </div>
  );
}

/** A thing's star: kept among the favorites of its category, for every project. */
function StarButton({ item, kept, className }: { item: LibraryItem; kept: boolean; className: string }) {
  const t = useT();
  return (
    <button type="button" aria-label={t(kept ? 'assetDrawer.unstar' : 'assetDrawer.star')} aria-pressed={kept}
      onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }} className={className}>
      {/* hollow until starred, then filled in the star's own color */}
      <Star size={11} fill={kept ? 'currentColor' : 'none'} strokeWidth={kept ? 0 : 2.2} />
    </button>
  );
}

/** A namespace of the side bar, as a box (one that opens, its heading); a line under one that opened. */
const RAIL_BOX = 'flex h-[26px] w-full shrink-0 select-none items-center gap-1 rounded-[4px] bg-[var(--bg-field)] px-2.5 text-left text-[11.5px] font-semibold transition-colors hover:bg-[var(--bg-pressed)]';
const RAIL_CHILD = 'flex h-7 w-full shrink-0 items-center px-2.5 text-left text-[11.5px] font-semibold transition-colors';

/** The sections of the side bars folded, by category and section, kept on this computer. */
const FOLDED_KEY = 'openfilm.library.folded';
function readFolded(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(FOLDED_KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; }
}
function keepFolded(folded: Record<string, boolean>): void {
  try { localStorage.setItem(FOLDED_KEY, JSON.stringify(folded)); } catch { /* for this time only */ }
}

/** How wide the side bar may be dragged, and where its width is kept on this computer. */
const RAIL = { min: 88, max: 220, start: 112, key: 'openfilm.library.rail' };
const clampRail = (w: number) => Math.round(Math.min(RAIL.max, Math.max(RAIL.min, w)));
function railWidth(): number {
  try { const w = Number(localStorage.getItem(RAIL.key)); return w ? clampRail(w) : RAIL.start; } catch { return RAIL.start; }
}

/** The side bar's right edge: dragged (or arrowed) to make it wider or narrower, within RAIL. */
function RailEdge({ width, onWidth }: { width: number; onWidth: (w: number) => void }) {
  const drag = React.useRef<{ x: number; width: number } | null>(null);
  const keep = (w: number) => { try { localStorage.setItem(RAIL.key, String(w)); } catch { /* kept for this time only */ } };
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={RAIL.min}
      aria-valuemax={RAIL.max}
      aria-valuenow={width}
      tabIndex={0}
      data-studio-host-panel=""
      className="absolute inset-y-0 -right-[4px] z-10 w-[7px] cursor-col-resize outline-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, width };
        document.body.style.cursor = 'col-resize';
      }}
      onPointerMove={(e) => { if (drag.current) onWidth(clampRail(drag.current.width + e.clientX - drag.current.x)); }}
      onPointerUp={(e) => {
        if (!drag.current) return;
        const w = clampRail(drag.current.width + e.clientX - drag.current.x);
        drag.current = null;
        document.body.style.cursor = '';
        onWidth(w);
        keep(w);
      }}
      onPointerCancel={() => { drag.current = null; document.body.style.cursor = ''; }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        const w = clampRail(width + (e.key === 'ArrowRight' ? 12 : -12));
        onWidth(w);
        keep(w);
      }}
    />
  );
}

/**
 * A line of the media's side bar, its name alone: a box (Import; Mine when it is one folder, `label`) or a line under
 * Mine (each of the person's folders). A folder is held and moved to another place among them (`onHold`; `held` while it
 * is, drawn where `style` says), and takes what is dropped on it (`drop`).
 */
function RailLine({ line, on, onPick, onMenu, onHold, held = false, style, drop, look = 'child', label }: {
  line: Line; on: boolean; onPick: () => void; onMenu?: (e: React.MouseEvent) => void;
  look?: 'box' | 'child'; label?: string;
  onHold?: (e: React.PointerEvent<HTMLElement>) => void; held?: boolean; style?: React.CSSProperties;
  drop?: { accepts: (data: DataTransfer) => boolean; onDrop: (e: React.DragEvent) => void };
}) {
  const [over, setOver] = React.useState(false);
  return (
    <button type="button" onClick={onPick} onContextMenu={onMenu} aria-pressed={on} title={line.link?.to ?? line.name}
      data-rail-line={line.key} data-rail-kind={line.kind} data-rail-held={held ? '' : undefined} style={style}
      /* held by the pointer, not the browser's own drag (no ghost picture, and the list moves as it goes) */
      draggable={false} onPointerDown={onHold}
      onDragOver={(e) => { if (!drop?.accepts(e.dataTransfer)) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; setOver(true); }}
      /* left for another line, not for one of its own parts */
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => {
        setOver(false);
        if (drop?.accepts(e.dataTransfer)) { e.preventDefault(); e.stopPropagation(); drop.onDrop(e); }
      }}
      /* the one shown in the accent; a folder something is dragged over, ringed; the one held, lifted */
      className={`${look === 'box' ? RAIL_BOX : `${RAIL_CHILD} rounded-md`} ${on ? 'text-[var(--accent)]' : `text-[var(--text)] ${look === 'child' ? 'hover:text-[var(--accent)]' : ''}`} ${held ? 'cursor-grabbing bg-[var(--bg-raised)] shadow-[0_6px_18px_rgba(0,0,0,0.28)] ring-1 ring-[var(--border-strong)]' : ''} ${over ? 'ring-1 ring-[var(--accent)]' : ''} ${line.link?.missing ? 'opacity-60' : ''}`}>
      <span className="min-w-0 flex-1 truncate">{label ?? line.name}</span>
    </button>
  );
}

/** A folder's name typed in the side bar: a new one's, or one renamed. Enter or leaving it keeps it; Esc does not. */
function RailName({ value, onDone, onCancel }: { value: string; onDone: (name: string) => void; onCancel: () => void }) {
  const t = useT();
  const done = React.useRef(false);
  return (
    <input autoFocus defaultValue={value} aria-label={t('assets.rename')} maxLength={120}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done.current = true; onCancel(); }
        if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); }
      }}
      onBlur={(e) => { if (done.current) return; done.current = true; onDone(e.currentTarget.value); }}
      className="h-8 shrink-0 rounded-md bg-[var(--bg-field)] px-2.5 text-[12px] font-medium text-[var(--text)] outline-none ring-1 ring-[var(--accent)]" />
  );
}

/** Where its "+" puts it, said in its tooltip. */
function addTip(item: LibraryItem, t: (path: string) => string): string {
  return t(item.cat === 'transition' ? 'assetDrawer.addCut' : item.kind === 'look' || item.kind === 'motion' ? 'assetDrawer.addLook' : 'assetDrawer.addPlayhead');
}

/** What a drag of `item` carries to the timeline (or the chat). */
function dragOf(item: LibraryItem, name: string) {
  const drag = libraryDragItem(item, name);
  return drag ? (e: React.DragEvent) => { setResourceDragData(e.dataTransfer, drag); dragPicture(e); e.dataTransfer.effectAllowed = 'copyMove'; } : undefined;
}

/**
 * A look the person saved (in the Text inspector's word art, or a caption's): drawn as it is; a drag or "+"
 * puts a new line of words in it (`onAdd` with it as a text style), "×" lets it go.
 */
function PresetCard({ item, lang, picked, onPick, onAdd, onDrop }: {
  item: LibraryItem; lang: ReturnType<typeof useLanguage>; picked: boolean;
  onPick: () => void; onAdd: () => void; onDrop: () => void;
}) {
  const t = useT();
  const { vars } = item;
  const name = nameOf(item.name, lang);
  const text = builtInItem(`${BUILT_IN}/${TEXT_COMPONENT}`);
  const drag = text ? libraryDragItem(text, name) : null;
  return (
    <div className="group relative min-w-0 cursor-default select-none" aria-label={name} data-library-card={item.id} draggable={Boolean(drag)}
      onDragStart={drag ? (e) => { setResourceDragData(e.dataTransfer, { ...drag, vars }); dragPicture(e); e.dataTransfer.effectAllowed = 'copyMove'; } : undefined}
      onDragEnd={() => clearResourceDrag()} onClick={(e) => { if (e.detail < 2) onPick(); }}>
      <div className={`relative aspect-square overflow-hidden rounded-md ${picked ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-transparent group-hover:ring-[var(--text-faint)]'}`}>
        <TextStyleSample vars={vars} lang={lang} />
        <span className="absolute bottom-1 right-1 flex items-center gap-1">
          <button type="button" aria-label={t('assetDrawer.textDropPreset')} onClick={(e) => { e.stopPropagation(); onDrop(); }}
            className={`${ROUND} hidden bg-black/55 text-white group-hover:grid`}><X size={11} strokeWidth={2.6} /></button>
          <AddButton item={item} onAdd={onAdd} className={`${ROUND} ${ADD_COLOR} ${picked ? 'grid' : 'hidden group-hover:grid'}`} />
        </span>
      </div>
      <div className="mt-1.5 truncate px-0.5 text-[11.5px] text-[var(--text-muted)] group-hover:text-[var(--text)]">{name}</div>
    </div>
  );
}



function AddButton({ item, onAdd, className }: { item: LibraryItem; onAdd: () => void; className: string }) {
  const t = useT();
  return (
    <button type="button" aria-label={addTip(item, t)} onClick={(e) => { e.stopPropagation(); onAdd(); }} className={className}>
      <Plus size={12} strokeWidth={2.6} />
    </button>
  );
}

/** A template's clips for the person's own pictures, and how long it runs. */
/** Where a thing of the library comes from: the community's when someone sent it (`by`), else OpenFilm's own. */
const sourceOf = (item: LibraryItem): Source => (item.by ? 'community' : 'official');

function TemplateBadge({ item }: { item: LibraryItem }) {
  const t = useT();
  const secs = Math.round((item.durationMs ?? 0) / 1000);
  return (
    <span className="pointer-events-none absolute bottom-1 left-1 rounded-[4px] bg-black/55 px-1.5 py-[1px] text-[10px] font-medium tabular-nums text-white">
      {item.slots ? `${t('assetDrawer.slots').replace('{n}', String(item.slots))} · ` : ''}{secs}s
    </span>
  );
}

/**
 * One of the person's own files starred, among the media's 收藏: its picture (a recording, its sign), its name, its star
 * (taken off here), "+" to put it in the film; dragged as a file of theirs is from the media pane.
 */
function SavedCard({ file, picked, onPick, onAdd }: { file: WorkspaceResource; picked: boolean; onPick: () => void; onAdd?: () => void }) {
  const t = useT();
  const picture = file.kind === 'video' || file.kind === 'mg' ? savedSources.poster?.(file) ?? savedSources.pagePoster?.(file)
    : file.kind === 'image' ? savedSources.file(file) : undefined;
  return (
    <div data-saved-card={file.path} className="group relative min-w-0 cursor-default select-none" draggable aria-label={file.name}
      onDragStart={(e) => { setResourceDragData(e.dataTransfer, { ...file, saved: file.path }); dragPicture(e); e.dataTransfer.effectAllowed = 'copyMove'; }}
      onDragEnd={() => clearResourceDrag()} onClick={(e) => { if (e.detail < 2) onPick(); }}>
      <div className={`relative aspect-video overflow-hidden rounded-md bg-[var(--bg-field)] ${picked ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-transparent group-hover:ring-[var(--text-faint)]'}`}>
        {picture ? <img src={picture} alt="" draggable={false} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
          : <span className="absolute inset-0 grid place-items-center text-[var(--text-faint)]"><AudioLines size={22} aria-hidden /></span>}
        <span className="absolute bottom-1 right-1 flex items-center gap-1">
          <button type="button" aria-label={t('assetDrawer.unstar')} aria-pressed onClick={(e) => { e.stopPropagation(); void starSaved(file.path, false); }}
            className={`${ROUND} grid bg-black/55 text-[#ffd35a]`}><Star size={11} fill="currentColor" strokeWidth={0} /></button>
          {onAdd ? (
            <button type="button" aria-label={t('assetDrawer.addPlayhead')} onClick={(e) => { e.stopPropagation(); onAdd(); }}
              className={`${ROUND} ${ADD_COLOR} ${picked ? 'grid' : 'hidden group-hover:grid'}`}><Plus size={12} strokeWidth={2.6} /></button>
          ) : null}
        </span>
        <SourceBadge source="mine" />
      </div>
      <div className={`mt-1.5 truncate px-0.5 text-[11.5px] ${picked ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text)]'}`}>{file.name}</div>
    </div>
  );
}

/**
 * A row that scrolls sideways: whether it holds more than it shows (`over`) and is scrolled to its end, kept as it
 * scrolls and as it is sized; `toggle` takes it to its end, or from there back to its start.
 */
function useSideways() {
  const ref = React.useRef<HTMLElement>(null);
  const [state, setState] = React.useState({ over: false, end: false });
  const read = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const over = el.scrollWidth > el.clientWidth + 1;
    const end = over && el.scrollLeft + el.clientWidth >= el.scrollWidth - 1;
    setState((s) => (s.over === over && s.end === end ? s : { over, end }));
  }, []);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    read();
    const seen = new ResizeObserver(read);
    seen.observe(el);
    return () => seen.disconnect();
  }, [read]);
  const toggle = () => ref.current?.scrollTo({ left: state.end ? 0 : ref.current.scrollWidth, behavior: 'smooth' });
  return { ref, read, toggle, ...state };
}

/* what is put on the film itself (a filter, an effect, a transition, a template): square cards, shown on the film's
   own picture where they can be */
const ON_FILM = new Set<Category>(['filter', 'effect', 'transition', 'template']);

function Card({ item, lang, picked, kept, square, here, hover, previewing, onPick, onAdd, mark = false }: {
  item: LibraryItem; lang: ReturnType<typeof useLanguage>; picked: boolean; kept: boolean; square: boolean; here: HereState; hover: LibraryHover; previewing: boolean;
  onPick: () => void; onAdd: () => void;
  /** its source on its corner (官方, 社区 · who made it): in 收藏, where things of every source are side by side */
  mark?: boolean;
}) {
  const t = useT();
  /* Static posters keep the grid from running pages or decoding video before a click. */
  const fit = item.cat === 'sticker' ? 'object-contain' : 'object-cover';
  const name = nameOf(item.name, lang);
  /* a text style and the line of words in the page's own: drawn in the app's language */
  const drawn = item.kind === 'textstyle' || item.kind === 'textmotion' || item.id === TEXT_COMPONENT;
  return (
    <div
      data-library-card={item.id}
      {...hover}
      aria-busy={here === 'fetching'}
      className="group relative min-w-0 cursor-default select-none"
      draggable
      onDragStart={dragOf(item, name)}
      onDragEnd={() => clearResourceDrag()}
      onClick={(e) => { if (e.detail < 2) onPick(); }}
      aria-label={name}
    >
      <div className={`relative overflow-hidden rounded-md bg-[var(--bg-field)] ${square ? 'aspect-square' : 'aspect-video'} ${picked ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-transparent group-hover:ring-[var(--text-faint)]'}`}>
        {item.kind === 'look'
          ? <img src={item.sample ? libraryUrl(item.sample) : PLAIN} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" style={{ filter: item.filter }} />
          /* a recording of the Community's media: no picture of its own */
          : item.kind === 'file' && item.media === 'audio' ? <span className="absolute inset-0 grid place-items-center text-[var(--text-faint)]"><AudioLines size={22} aria-hidden /></span>
          /* a sticker whole in its square card (a wide one is not cut at its ends); loaded as it comes into view */
          : drawn ? <TextStyleSample lang={lang} vars={item.vars} {...(item.id === TEXT_COMPONENT ? { words: name } : {})} />
          : <img src={posterUrl(item)} alt="" draggable={false} loading="lazy" decoding="async" className={`absolute inset-0 h-full w-full ${fit}`} />}
        {previewing ? (
          <video src={item.kind === 'group' ? templatePreviewUrl(item) : previewUrl(item)} data-library-hover-preview="" autoPlay muted loop playsInline
            onPlaying={(e) => { e.currentTarget.style.opacity = '1'; }}
            className={`pointer-events-none absolute inset-0 h-full w-full opacity-0 ${fit}`} />
        ) : null}
        {/* the star and the download or add control side by side */}
        <span className="absolute bottom-1 right-1 flex items-center gap-1">
          {/* the download badge changes to an add button when the asset is ready */}
          <StarButton item={item} kept={kept} className={`${ROUND} bg-black/55 ${kept ? 'grid text-[#ffd35a]' : 'hidden text-white group-hover:grid'}`} />
          <HereButton here={here} addTip={addTip(item, t)} onAdd={onAdd} onRetry={onPick} className={`${ROUND} bg-black/55 text-white`} show={picked ? 'grid' : 'hidden group-hover:grid'} />
        </span>
        {item.kind === 'group' ? <TemplateBadge item={item} /> : null}
        {mark ? <SourceBadge source={sourceOf(item)} by={item.by ? `${t('assetDrawer.source_community')} · ${makerName(item.by)}` : undefined} always /> : null}
      </div>
      {/* the new line's card says its name itself */}
      {item.id === TEXT_COMPONENT ? null : <div className={`mt-1.5 truncate px-0.5 text-[11.5px] ${picked ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text)]'}`}>{name}</div>}
    </div>
  );
}
