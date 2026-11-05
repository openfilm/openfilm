/**
 * The assets drawer's library (in the app's panel, over the chat, its composer under it), laid out as an editor's
 * library is: the categories along the top — the media (the project's and Saved, the media pane as it was), the
 * skills an agent takes up (SkillsPane), the voices to speak a voice-over in, then OpenFilm's own sounds, music, text,
 * the captions a caption track is made with (CaptionsPane), stickers, filters, effects and transitions (lib/library) — and down the left the starred ones and the library's own,
 * its groups under it. What is shown is in
 * the accent color; a category's icon fills faintly too.
 *
 * A thing plays in its card while the pointer rests on it. A click picks it and tries it in the viewer, on the picture
 * there (nothing is written; Esc, a click on it again, or another category takes it away); a sound is heard. A double
 * click, Enter, or its "+" puts it in the film where the try showed it; a drag puts it where it is let go. A star keeps
 * it among the favorites, for every project.
 */
import React from 'react';
import { ChevronDown, ChevronsLeft, ChevronsRight, Plus, Search, Star } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import {
  libraryDragItem, libraryUrl, nameOf, posterUrl, previewUrl, toggleFavorite, useLibraryFavorites, useLibraryIndex,
  type LibraryCategory, type LibraryItem,
} from '@/lib/library';
import { clearResourceDrag, dragPicture, setResourceDragData } from '@/lib/resource-drag';
import { useLibraryVoices, type LibraryVoice, type VoiceAccess } from '@/lib/library-voices';
import { ADD_HOVER, FOOT_ROOM, MiniPlayer, MusicCard, ROUND, SoundRow, libraryArt, usePlayer } from './AudioList';
import { CaptionsPane, type CaptionsActions } from './CaptionsPane';
import { CategoryIcon, Empty } from './icons';
import { FEATURED, STARRED, VoicesPane } from './VoicesPane';
import { ImportButton, SkillsPane, type SkillsLine } from './SkillsPane';
import { SourceBadge, SourceChips, sourcesIn, type Source } from './SourceChips';

type Category = 'media' | 'skill' | 'voice' | 'captions' | LibraryCategory;
const CATEGORIES: Category[] = ['media', 'skill', 'captions', 'voice', 'sound', 'music', 'text', 'sticker', 'filter', 'effect', 'transition', 'template'];

/** The side bar's starred line: a category's things the person starred ('' is all of it, else one of its groups). */
const FAVORITES = STARRED;

/* rows of a long list drawn at first, and more each time it is scrolled near its end */
const PAGE = 80;

/* the category shown, the line picked in each, and whether the library's own groups are folded, kept while the
   drawer closes and opens again; and the last skills request (`showSkills`) followed, so a drawer opened again later
   does not follow it twice */
const SHOWN = { cat: 'media' as Category, group: {} as Partial<Record<Category, string>>, folded: false, request: 0 };

export interface LibraryActions {
  /** A double click, Enter or "+": a page or a sound at the playhead (a transition on the cut), a look on the clip. */
  add: (item: LibraryItem) => void;
  /** A click: tried in the viewer (null: no longer). */
  tryOut: (item: LibraryItem | null) => void;
}

/** The skills shown from outside the drawer (the app's chat): Discover, or one skill's page; `n` tells one request from the next. */
export type SkillsRequest = { name?: string; n: number };

export function LibraryDrawer({ media, mediaScope, onMediaScope, actions, captions, speak, onServices, projectId = null, showSkills, under = 0 }: {
  media: React.ReactNode;
  /** the project's own media, or Saved */
  mediaScope: 'project' | 'saved';
  onMediaScope: (next: 'project' | 'saved') => void;
  actions: LibraryActions;
  /** where a caption track comes from: what is said, a file, or new */
  captions: CaptionsActions;
  /** words spoken in a voice of the library, put on the film at the playhead (VoicesPane): null, or why not */
  speak?: (voice: LibraryVoice, access: VoiceAccess, text: string) => Promise<string | null>;
  /** Settings › Services: where a voice's service is connected */
  onServices: () => void;
  /** the project shown, for its own skills */
  projectId?: string | null;
  showSkills?: SkillsRequest | null;
  /** how much of its foot the app's composer floats over: the lists run on under it, their ends scrolled clear of it
      (--drawer-under) */
  under?: number;
}) {
  const t = useT();
  const lang = useLanguage();
  const index = useLibraryIndex();
  const favorites = useLibraryFavorites();
  const voices = useLibraryVoices();
  const [cat, setCat] = React.useState<Category>(SHOWN.cat);
  const [group, setGroup] = React.useState<string>(SHOWN.group[SHOWN.cat] ?? '');
  const [folded, setFolded] = React.useState(SHOWN.folded);
  const [query, setQuery] = React.useState('');
  /* the skill whose page is shown in place of the skills' tiles */
  const [skillOpen, setSkillOpen] = React.useState<string | null>(null);
  /* the source the list is narrowed to (SourceChips), all of them by default */
  const [source, setSource] = React.useState<Source | ''>('');
  const [picked, setPicked] = React.useState<string | null>(null);
  const tryOut = React.useRef(actions.tryOut);
  tryOut.current = actions.tryOut;
  const pick = (item: LibraryItem | null) => {
    setPicked(item?.id ?? null);
    if (item?.kind !== 'sound') tryOut.current(item);
  };
  /* another category: what played in the last one stops and its player goes */
  const closePlayer = React.useRef<() => void>(() => {});
  const show = (next: Category) => { SHOWN.cat = next; setCat(next); setGroup(SHOWN.group[next] ?? ''); setQuery(''); setSource(''); setSkillOpen(null); pick(null); closePlayer.current(); };
  const pickGroup = (next: string) => { SHOWN.group[cat] = next; setGroup(next); setQuery(''); setSkillOpen(null); };
  /* a request from outside: the skills, on Discover or on one's page (followed once, by its `n`) */
  React.useEffect(() => {
    if (!showSkills || showSkills.n === SHOWN.request) return;
    SHOWN.request = showSkills.n;
    if (cat !== 'skill') show('skill');
    if (!showSkills.name) { SHOWN.group.skill = 'discover'; setGroup('discover'); }
    setSkillOpen(showSkills.name ?? null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSkills?.n]);
  const fold = () => { SHOWN.folded = !folded; setFolded(!folded); };
  const bar = useSideways();
  const [rail, setRail] = React.useState(railWidth);
  /* the drawer closed: what was tried goes with it */
  React.useEffect(() => () => tryOut.current(null), []);

  /* the skills' line: one of the installed (Installed alone, as kept before, is all of them), else Discover */
  /* the skills: Discover (first opened), else the installed (any line of them kept before is that now) */
  /* Installed first opened */
  const skillLine: SkillsLine = group === 'discover' ? 'discover' : group === FAVORITES ? 'favorites' : 'installed';
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
  /* what moves before what stands still (animated stickers before the emoji), each in the library's own order */
  const shown = (index?.items ?? []).filter((item) => item.cat === cat && (q
    ? [...Object.values(item.name), ...(item.tags ?? [])].some((n) => n?.toLowerCase().includes(q))
    : group === FAVORITES ? favorites.includes(item.id) : !group || item.group === group))
    .sort((a, b) => Number(Boolean(a.still)) - Number(Boolean(b.still)));
  const sources = sourcesIn(shown.map(sourceOf));
  const items = source && sources.includes(source) ? shown.filter((item) => sourceOf(item) === source) : shown;
  const pickedItem = picked ? index?.items.find((i) => i.id === picked) ?? null : null;

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || !pickedItem) return;
    if (e.key === 'Escape') { e.preventDefault(); pick(null); }
    if (e.key === 'Enter') { e.preventDefault(); actions.add(pickedItem); }
  };

  /* the library's own lines under its fold: all of it, then its groups (a voice's: the services) */
  const own = cat === 'voice'
    ? (voices?.providers ?? []).map((s) => ({ id: s.id, name: s.name }))
    : (index?.groups[cat as LibraryCategory] ?? []).map((g) => ({ id: g.id, name: nameOf(g.name, lang) }))
      /* the groups of what moves first, those of stills (the emoji's) after them */
      .sort((a, b) => Number(stillGroup(a.id)) - Number(stillGroup(b.id)));
  const askMusic = studioHost?.ask;
  const groupName = (id: string) => own.find((g) => g.id === id)?.name ?? '';
  /* what a sound or a piece of music plays in, under the list */
  const player = usePlayer();
  closePlayer.current = player.close;
  const dragProps = (item: LibraryItem) => ({ onDragStart: dragOf(item, nameOf(item.name, lang), lang), onDragEnd: () => clearResourceDrag() });
  /* a long list (thousands of sounds) is drawn a page at a time, from its top again when what it lists changes */
  const [drawn, setDrawn] = React.useState(PAGE);
  React.useEffect(() => setDrawn(PAGE), [cat, group, query, source]);

  /* the bars and the library's things are the app's panel's (data-studio-host-panel): a press there keeps what is
     picked on the timeline and the picture, which a look or a transition goes on */
  return (
    /* a drag let go back in the drawer ends at once (lib/resource-drag) */
    <div className="flex h-full min-h-0 min-w-0 flex-col outline-none" tabIndex={-1} onKeyDown={onKey} data-drag-home="" data-studio-library=""
      style={{ '--drawer-under': `${under}px` } as React.CSSProperties}>
      {/* the categories, as high as the inspector's tabs beside it (40 px) so their lines meet; they keep their own
          spacing however wide the panel is, and more than fit scroll sideways (a wheel too), fading at the edge while
          the line under them runs whole; a button at the end takes them to their last (») and back to their first («),
          for a mouse without a sideways wheel */}
      <div className="flex h-10 shrink-0 border-b border-[var(--border)]" data-studio-host-panel="">
        <nav
          ref={bar.ref}
          onScroll={bar.read}
          onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}
          className={`flex h-full min-w-0 flex-1 overflow-x-auto px-1 [scrollbar-width:none] ${bar.end ? '' : '[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)]'}`}
        >
          {CATEGORIES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => show(id)}
              aria-pressed={cat === id}
              className={`relative my-1 flex min-w-[46px] shrink-0 flex-col items-center justify-center gap-px whitespace-nowrap rounded-md px-2 text-[10.5px] leading-[13px] ${cat === id ? 'bg-[var(--bg-picked)] font-semibold text-[var(--accent)]' : 'font-medium text-[var(--text-muted)] hover:text-[var(--text)]'}`}
            >
              {/* the one shown: the accent on a raised fill, its icon filled */}
              <CategoryIcon id={id} on={cat === id} size={18} />
              {t(`assetDrawer.cat_${id}`)}
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
      <div className="flex min-h-0 flex-1">
        {/* as wide as the person dragged its edge (RAIL), kept for next time */}
        <div className="relative flex shrink-0" style={{ width: rail }}>
          <RailEdge width={rail} onWidth={setRail} />
          <nav data-studio-host-panel="" className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto border-r border-[var(--border)] px-2 pb-[calc(var(--drawer-under,0px)+10px)] pt-2.5">
            {cat === 'media' ? (
              <>
                {/* what the person brought into this project (what it took from the library stays in its category),
                    then Saved */}
                <SideBox on={mediaScope === 'project'} onClick={() => onMediaScope('project')}>{t('assetDrawer.mediaImport')}</SideBox>
                <SideBox on={mediaScope === 'saved'} onClick={() => onMediaScope('saved')}>{t('assetDrawer.favorites')}</SideBox>
              </>
            ) : cat === 'skill' ? (
              <>
                {/* Installed first opened, in parts by whose they are (SkillsPane); the starred; Discover, OpenFilm's to take up */}
                <SideBox on={skillLine === 'installed'} onClick={() => pickGroup('installed')}>{t('assetDrawer.skillsInstalled')}</SideBox>
                <SideBox on={skillLine === 'favorites'} onClick={() => pickGroup(FAVORITES)}>{t('assetDrawer.favorites')}</SideBox>
                <SideBox on={skillLine === 'discover'} onClick={() => pickGroup('discover')}>{t('assetDrawer.skillsDiscover')}</SideBox>
              </>
            ) : cat === 'captions' ? (
              <>
                {/* caption tracks made here; their look is the caption inspector's */}
                <SideBox on onClick={() => pickGroup('')}>{t('assetDrawer.captionsNewLine')}</SideBox>
              </>
            ) : (
              <>
                <SideBox on={group === FAVORITES && !q} onClick={() => pickGroup(FAVORITES)}>{t('assetDrawer.favorites')}</SideBox>
                {cat === 'voice' ? <SideBox on={group === FEATURED && !q} onClick={() => pickGroup(FEATURED)}>{t('assetDrawer.featured')}</SideBox> : null}
                <SideBox on={group !== FAVORITES && group !== FEATURED && folded && !q} holds={group !== FAVORITES && group !== FEATURED && !folded && !q} open={!folded} onClick={fold}>
                  {t(cat === 'voice' ? 'assetDrawer.services' : 'assetDrawer.library')}
                </SideBox>
                {folded ? null : (
                  <div className="flex flex-col pb-1">
                    <SideLine on={!group && !q} onClick={() => pickGroup('')}>{t('assetDrawer.all')}</SideLine>
                    {own.map((g) => <SideLine key={g.id} on={group === g.id && !q} onClick={() => pickGroup(g.id)}>{g.name}</SideLine>)}
                  </div>
                )}
              </>
            )}
          </nav>
        </div>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-studio-host-panel={cat === 'media' ? undefined : ''}>
          {cat === 'media' ? media : cat === 'captions' ? <CaptionsPane actions={captions} /> : (
            <>
              {/* a skill's page has its own way back instead */}
              <div className="flex gap-2 px-3 pb-2 pt-2.5" hidden={cat === 'skill' && skillOpen != null}>
                <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-[var(--bg-field)] px-2.5 text-[var(--text-faint)] focus-within:ring-1 focus-within:ring-[var(--accent)]">
                  <Search size={14} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('assetDrawer.search').replace('{what}', t(`assetDrawer.cat_${cat}`))}
                    className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
                  />
                </label>
                {/* the person's own skills come in here, the app's way (a link or a folder) */}
                {cat === 'skill' && skillLine === 'installed' && studioHost?.skills?.add ? <ImportButton onClick={studioHost.skills.add} /> : null}
              </div>
              {cat !== 'skill' && cat !== 'voice' ? <SourceChips sources={sources} value={source} onChange={setSource} /> : null}
              {cat === 'skill' ? <SkillsPane line={skillLine} query={query} projectId={projectId} opened={skillOpen} onOpen={setSkillOpen} onDiscover={() => pickGroup('discover')} />
                : cat === 'voice' ? <VoicesPane group={group} query={query} favorites={favorites} onServices={onServices} onAll={() => pickGroup('')} speak={speak} /> : (
              <>
              {/* a click on nothing lets the picked thing go; the player is under the list */}
              <div
                className={`min-h-0 flex-1 overflow-y-auto px-3 pt-0.5 ${player.item ? 'pb-3' : FOOT_ROOM}`}
                onClick={(e) => { if (e.target === e.currentTarget) pick(null); }}
                onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 800 && drawn < items.length) setDrawn(drawn + PAGE); }}
              >
                {!items.length ? (
                  q ? <Empty icon="search" text={t('assetDrawer.nothing').replace('{q}', query.trim())} />
                    : group === FAVORITES ? <Empty icon="star" text={t('assetDrawer.noFavorites')} action={t('assetDrawer.seeAll')} onAction={() => pickGroup('')} />
                      : cat === 'music' ? <Empty icon="music" text={t('assetDrawer.musicSoon')} action={askMusic ? t('assetDrawer.musicMake') : undefined}
                        onAction={() => askMusic?.({ text: t('assetDrawer.musicAsk'), refs: [] })} />
                        : null
                ) : cat === 'sound' ? (
                  <div className="flex flex-col gap-0.5">
                    {items.slice(0, drawn).map((it) => (
                      <SoundRow key={it.id} item={it} name={nameOf(it.name, lang)} group={groupName(it.group)} picked={picked === it.id} player={player}
                        kept={favorites.includes(it.id)} addTip={addTip(it, t)} onPick={() => pick(it)} onAdd={() => actions.add(it)} drag={dragProps(it)} />
                    ))}
                  </div>
                ) : cat === 'music' ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
                    {items.slice(0, drawn).map((it) => (
                      <MusicCard key={it.id} item={it} name={nameOf(it.name, lang)} group={groupName(it.group)} picked={picked === it.id} player={player}
                        kept={favorites.includes(it.id)} addTip={addTip(it, t)} onPick={() => pick(it)} onAdd={() => actions.add(it)} drag={dragProps(it)} />
                    ))}
                  </div>
                ) : (
                  <div className={`grid gap-x-2.5 gap-y-3 ${cat === 'sticker' ? 'grid-cols-[repeat(auto-fill,minmax(68px,1fr))]' : cat === 'template' ? 'grid-cols-[repeat(auto-fill,minmax(140px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(96px,1fr))]'}`}>
                    {/* a page at a time as it is scrolled, as the sounds are (the emoji alone are some 1,600) */}
                    {items.slice(0, drawn).map((it) => (
                      <Card key={it.id} item={it} lang={lang} picked={picked === it.id} kept={favorites.includes(it.id)} square={cat === 'sticker'}
                        onPick={() => pick(picked === it.id ? null : it)} onAdd={() => actions.add(it)} />
                    ))}
                  </div>
                )}
              </div>
              <MiniPlayer player={player} name={player.item ? nameOf(player.item.name, lang) : ''} group={player.item ? groupName(player.item.group) : ''} art={libraryArt} />
              </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
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

/** A line of the side bar of its own (the starred, the library's own, the media's two): a box. `open`: it folds the lines under it. */
function SideBox({ on, holds = false, open, onClick, children }: {
  on: boolean;
  /** a heading whose line under it is the one shown (it is open): a lighter fill than the line's own */
  holds?: boolean;
  open?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={open === undefined ? on : undefined}
      aria-expanded={open}
      title={typeof children === 'string' ? children : undefined}
      /* the one shown: the accent on a raised fill; a heading whose line is the one shown, a lighter fill; the others
         plain until pointed at */
      className={`flex h-8 shrink-0 items-center justify-between gap-1 rounded-md px-2.5 text-left text-[12px] ${on ? 'bg-[var(--bg-picked)] font-semibold text-[var(--accent)]' : holds ? 'bg-[var(--bg-hover)] font-medium text-[var(--text)] hover:bg-[var(--bg-pressed)]' : 'font-medium text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}
    >
      <span className="truncate whitespace-nowrap">{children}</span>
      {open === undefined ? null : <ChevronDown size={13} className={`shrink-0 text-[var(--text-faint)] transition-transform ${open ? 'rotate-180' : ''}`} />}
    </button>
  );
}

/** A line under the library's own: all of it, or a group. */
function SideLine({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      title={typeof children === 'string' ? children : undefined}
      className={`truncate whitespace-nowrap rounded-md px-2.5 py-1.5 text-left text-[12px] ${on ? 'bg-[var(--bg-picked)] font-semibold text-[var(--accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
    >
      {children}
    </button>
  );
}

/** Where its "+" (and a double click) puts it, said in its tooltip. */
function addTip(item: LibraryItem, t: (path: string) => string): string {
  return t(item.cat === 'transition' ? 'assetDrawer.addCut' : item.kind === 'look' || item.kind === 'motion' ? 'assetDrawer.addLook' : 'assetDrawer.addPlayhead');
}

/** What a drag of `item` carries to the timeline (or the chat). */
function dragOf(item: LibraryItem, name: string, lang: Parameters<typeof libraryDragItem>[2]) {
  const drag = libraryDragItem(item, name, lang);
  return drag ? (e: React.DragEvent) => { setResourceDragData(e.dataTransfer, drag); dragPicture(e); e.dataTransfer.effectAllowed = 'copyMove'; } : undefined;
}

/** A press on a card's own button: not a pick, nor a double click's add. */
const own = { onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() };

function StarButton({ item, kept, className }: { item: LibraryItem; kept: boolean; className: string }) {
  const t = useT();
  return (
    <button
      type="button"
      aria-label={t(kept ? 'assetDrawer.unstar' : 'assetDrawer.star')}
      aria-pressed={kept}
      onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}
      {...own}
      className={className}
    >
      {/* hollow until starred, then filled in the star's own color */}
      <Star size={11} fill={kept ? 'currentColor' : 'none'} strokeWidth={kept ? 0 : 2.2} />
    </button>
  );
}

function AddButton({ item, onAdd, className }: { item: LibraryItem; onAdd: () => void; className: string }) {
  const t = useT();
  return (
    <button type="button" title={addTip(item, t)} aria-label={addTip(item, t)} onClick={(e) => { e.stopPropagation(); onAdd(); }} {...own} className={className}>
      <Plus size={12} strokeWidth={2.6} />
    </button>
  );
}

const SAMPLE = libraryUrl('filters/sample.jpg');

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

function Card({ item, lang, picked, kept, square, onPick, onAdd }: {
  item: LibraryItem; lang: ReturnType<typeof useLanguage>; picked: boolean; kept: boolean; square: boolean; onPick: () => void; onAdd: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const name = nameOf(item.name, lang);
  return (
    <div
      className="group relative min-w-0 cursor-default select-none"
      draggable
      onDragStart={dragOf(item, name, lang)}
      onDragEnd={() => clearResourceDrag()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPick}
      onDoubleClick={onAdd}
      title={item.by ? `${name} · @${item.by}` : name}
    >
      <div className={`relative overflow-hidden rounded-md bg-[var(--bg-field)] ${square ? 'aspect-square' : 'aspect-video'} ${picked ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-transparent group-hover:ring-[var(--text-faint)]'}`}>
        {item.kind === 'look'
          ? <img src={item.sample ? libraryUrl(item.sample) : SAMPLE} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" style={{ filter: item.filter }} />
          /* a sticker whole in its square card (a wide one is not cut at its ends); loaded as it comes into view */
          : <img src={posterUrl(item)} alt="" draggable={false} loading="lazy" decoding="async" className={`absolute inset-0 h-full w-full ${square ? 'object-contain' : 'object-cover'}`} />}
        {hover && item.kind !== 'look' && !item.still ? <video src={previewUrl(item)} autoPlay loop muted playsInline className={`absolute inset-0 h-full w-full ${square ? 'object-contain' : 'object-cover'}`} /> : null}
        {/* the star and the "+" side by side, of one size, dark glass over the picture */}
        <span className="absolute bottom-1 right-1 flex items-center gap-1">
          <StarButton item={item} kept={kept} className={`${ROUND} bg-black/55 ${kept ? 'grid text-[#ffd35a]' : 'hidden text-white group-hover:grid'}`} />
          <AddButton item={item} onAdd={onAdd} className={`${ROUND} ${ADD_HOVER} hidden bg-black/55 text-white group-hover:grid`} />
        </span>
        {item.kind === 'group' ? <TemplateBadge item={item} /> : null}
        <SourceBadge source={sourceOf(item)} />
      </div>
      <div className={`mt-1.5 truncate px-0.5 text-[11.5px] ${picked ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text)]'}`}>{name}</div>
    </div>
  );
}
