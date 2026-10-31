/**
 * The assets drawer's library (in the app's panel, over the chat, its composer under it), laid out as an editor's
 * library is: the categories along the top — the media (the project's and Saved, the media pane as it was), the
 * voices to speak a voice-over in, then OpenFilm's own sounds, music, text, stickers, filters, effects and transitions
 * (lib/library) — and down the left the starred ones and the library's own, its groups under it. What is shown is in
 * the accent color; a category's icon fills faintly too.
 *
 * A thing plays in its card while the pointer rests on it. A click picks it and tries it in the viewer, on the picture
 * there (nothing is written; Esc, a click on it again, or another category takes it away); a sound is heard. A double
 * click, Enter, or its "+" puts it in the film where the try showed it; a drag puts it where it is let go. A star keeps
 * it among the favorites, for every project.
 */
import React from 'react';
import { AudioLines, ChevronDown, Pause, Play, Plus, Search, Star } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import {
  libraryDragItem, libraryUrl, nameOf, posterUrl, previewUrl, toggleFavorite, useLibraryFavorites, useLibraryIndex, waveUrl,
  type LibraryCategory, type LibraryItem,
} from '@/lib/library';
import { clearResourceDrag, setResourceDragData } from '@/lib/resource-drag';
import { useLibraryVoices } from '@/lib/library-voices';
import { CategoryIcon, Empty } from './icons';
import { FEATURED, STARRED, VoicesPane } from './VoicesPane';

type Category = 'media' | 'voice' | LibraryCategory;
const CATEGORIES: Category[] = ['media', 'voice', 'sound', 'music', 'text', 'sticker', 'filter', 'effect', 'transition'];

/** The side bar's starred line: a category's things the person starred ('' is all of it, else one of its groups). */
const FAVORITES = STARRED;

/* rows of a long list drawn at first, and more each time it is scrolled near its end */
const PAGE = 80;

/* the category shown, the line picked in each, and whether the library's own groups are folded, kept while the
   drawer closes and opens again */
const SHOWN = { cat: 'media' as Category, group: {} as Partial<Record<Category, string>>, folded: false };

export interface LibraryActions {
  /** A double click, Enter or "+": a page or a sound at the playhead (a transition on the cut), a look on the clip. */
  add: (item: LibraryItem) => void;
  /** A click: tried in the viewer (null: no longer). */
  tryOut: (item: LibraryItem | null) => void;
}

export function LibraryDrawer({ media, mediaScope, onMediaScope, actions, onServices }: {
  media: React.ReactNode;
  /** the project's own media, what it took from the library, or Saved */
  mediaScope: 'project' | 'picked' | 'saved';
  onMediaScope: (next: 'project' | 'picked' | 'saved') => void;
  actions: LibraryActions;
  /** Settings › Services: where a voice's service is connected */
  onServices: () => void;
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
  const [picked, setPicked] = React.useState<string | null>(null);
  const tryOut = React.useRef(actions.tryOut);
  tryOut.current = actions.tryOut;
  const pick = (item: LibraryItem | null) => {
    setPicked(item?.id ?? null);
    if (item?.kind !== 'sound') tryOut.current(item);
  };
  const show = (next: Category) => { SHOWN.cat = next; setCat(next); setGroup(SHOWN.group[next] ?? ''); setQuery(''); pick(null); };
  const pickGroup = (next: string) => { SHOWN.group[cat] = next; setGroup(next); setQuery(''); };
  const fold = () => { SHOWN.folded = !folded; setFolded(!folded); };
  const [rail, setRail] = React.useState(railWidth);
  /* the drawer closed: what was tried goes with it */
  React.useEffect(() => () => tryOut.current(null), []);

  const q = query.trim().toLowerCase();
  const items = (index?.items ?? []).filter((item) => item.cat === cat && (q
    ? Object.values(item.name).some((n) => n?.toLowerCase().includes(q))
    : group === FAVORITES ? favorites.includes(item.id) : !group || item.group === group));
  const pickedItem = picked ? index?.items.find((i) => i.id === picked) ?? null : null;

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || !pickedItem) return;
    if (e.key === 'Escape') { e.preventDefault(); pick(null); }
    if (e.key === 'Enter') { e.preventDefault(); actions.add(pickedItem); }
  };

  /* the library's own lines under its fold: all of it, then its groups (a voice's: the services) */
  const own = cat === 'voice'
    ? (voices?.providers ?? []).map((s) => ({ id: s.id, name: s.name }))
    : (index?.groups[cat as LibraryCategory] ?? []).map((g) => ({ id: g.id, name: nameOf(g.name, lang) }));
  const askMusic = studioHost?.ask;
  const groupName = (id: string) => own.find((g) => g.id === id)?.name ?? '';
  /* a long list (thousands of sounds) is drawn a page at a time, from its top again when what it lists changes */
  const [drawn, setDrawn] = React.useState(PAGE);
  React.useEffect(() => setDrawn(PAGE), [cat, group, query]);

  /* the bars and the library's things are the app's panel's (data-studio-host-panel): a press there keeps what is
     picked on the timeline and the picture, which a look or a transition goes on */
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col outline-none" tabIndex={-1} onKeyDown={onKey}>
      {/* the categories, as high as the inspector's tabs beside it (40 px) so their lines meet; they keep their own
          spacing however wide the panel is, and more than fit scroll sideways (a wheel too), fading at the edge while
          the line under them runs whole */}
      <div className="h-10 shrink-0 border-b border-[var(--dock-line)]" data-studio-host-panel="">
        <nav
          onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}
          className="flex h-full overflow-x-auto px-1 [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] [scrollbar-width:none]"
        >
          {CATEGORIES.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => show(id)}
              aria-pressed={cat === id}
              className={`relative flex h-full min-w-[46px] shrink-0 flex-col items-center justify-center gap-px whitespace-nowrap px-2 text-[10.5px] leading-[13px] ${cat === id ? 'font-semibold text-[var(--tl-accent)]' : 'font-medium text-[var(--text-muted)] hover:text-[var(--text)]'}`}
            >
              {/* the one shown: its color, its icon filled, and a line under it */}
              {cat === id ? <span aria-hidden className="absolute inset-x-2 bottom-0 h-[2px] rounded-full bg-[var(--tl-accent)]" /> : null}
              <CategoryIcon id={id} on={cat === id} size={18} />
              {t(`assetDrawer.cat_${id}`)}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex min-h-0 flex-1">
        {/* as wide as the person dragged its edge (RAIL), kept for next time */}
        <div className="relative flex shrink-0" style={{ width: rail }}>
          <RailEdge width={rail} onWidth={setRail} />
          <nav data-studio-host-panel="" className="flex min-w-0 flex-1 flex-col gap-1 overflow-y-auto border-r border-[var(--dock-line)] px-2 py-2.5">
            {cat === 'media' ? (
              <>
                {/* what came into this project, folded: its own media, then what it took from the library; then Saved */}
                <SideBox on={mediaScope !== 'saved' && folded} open={!folded} onClick={fold}>{t('assetDrawer.mediaImport')}</SideBox>
                {folded ? null : (
                  <div className="flex flex-col pb-1">
                    <SideLine on={mediaScope === 'project'} onClick={() => onMediaScope('project')}>{t('assetDrawer.mediaProject')}</SideLine>
                    <SideLine on={mediaScope === 'picked'} onClick={() => onMediaScope('picked')}>{t('assetDrawer.mediaPicked')}</SideLine>
                  </div>
                )}
                <SideBox on={mediaScope === 'saved'} onClick={() => onMediaScope('saved')}>{t('assetDrawer.mediaSaved')}</SideBox>
              </>
            ) : (
              <>
                <SideBox on={group === FAVORITES && !q} onClick={() => pickGroup(FAVORITES)}>{t('assetDrawer.favorites')}</SideBox>
                {cat === 'voice' ? <SideBox on={group === FEATURED && !q} onClick={() => pickGroup(FEATURED)}>{t('assetDrawer.featured')}</SideBox> : null}
                <SideBox on={group !== FAVORITES && group !== FEATURED && folded && !q} open={!folded} onClick={fold}>
                  {t(cat === 'voice' ? 'assetDrawer.services' : 'assetDrawer.official')}
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
          {cat === 'media' ? media : (
            <>
              <div className="px-3 pb-2 pt-2.5">
                <label className="flex h-8 min-w-0 items-center gap-2 rounded-md bg-[var(--surface-2)] px-2.5 text-[var(--text-faint)] focus-within:ring-1 focus-within:ring-[var(--tl-accent)]">
                  <Search size={14} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('assetDrawer.search').replace('{what}', t(`assetDrawer.cat_${cat}`))}
                    className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
                  />
                </label>
              </div>
              {cat === 'voice' ? <VoicesPane group={group} query={query} favorites={favorites} onServices={onServices} onAll={() => pickGroup('')} /> : (
              /* a click on nothing lets the picked thing go */
              <div
                className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-0.5"
                onClick={(e) => { if (e.target === e.currentTarget) pick(null); }}
                onScroll={(e) => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight > el.scrollHeight - 800 && drawn < items.length) setDrawn(drawn + PAGE); }}
              >
                {!items.length ? (
                  q ? <Empty icon="search" text={t('assetDrawer.nothing').replace('{q}', query.trim())} />
                    : group === FAVORITES ? <Empty icon="star" text={t('assetDrawer.noFavorites')} action={t('assetDrawer.seeAll')} onAction={() => pickGroup('')} />
                      : cat === 'music' ? <Empty icon="music" text={t('assetDrawer.musicSoon')} action={askMusic ? t('assetDrawer.musicMake') : undefined}
                        onAction={() => askMusic?.({ text: t('assetDrawer.musicAsk'), refs: [] })} />
                        : null
                ) : cat === 'sound' || cat === 'music' ? (
                  <div className="flex flex-col gap-0.5">
                    {items.slice(0, drawn).map((it) => (
                      <SoundRow key={it.id} item={it} lang={lang} group={groupName(it.group)} picked={picked === it.id} kept={favorites.includes(it.id)}
                        onPick={() => pick(it)} onAdd={() => actions.add(it)} />
                    ))}
                  </div>
                ) : (
                  <div className={`grid gap-x-2.5 gap-y-3 ${cat === 'sticker' ? 'grid-cols-[repeat(auto-fill,minmax(68px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(96px,1fr))]'}`}>
                    {items.map((it) => (
                      <Card key={it.id} item={it} lang={lang} picked={picked === it.id} kept={favorites.includes(it.id)} square={cat === 'sticker'}
                        onPick={() => pick(picked === it.id ? null : it)} onAdd={() => actions.add(it)} />
                    ))}
                  </div>
                )}
              </div>
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
      className="group/edge absolute inset-y-0 -right-[4px] z-10 w-[7px] cursor-col-resize outline-none"
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
    >
      <span className="absolute inset-y-0 left-[3px] w-px bg-transparent group-hover/edge:bg-[var(--tl-accent)] group-focus-visible/edge:bg-[var(--tl-accent)]" />
    </div>
  );
}

/** A line of the side bar of its own (the starred, the library's own, the media's two): a box. `open`: it folds the lines under it. */
function SideBox({ on, open, onClick, children }: { on: boolean; open?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={open === undefined ? on : undefined}
      aria-expanded={open}
      title={typeof children === 'string' ? children : undefined}
      className={`flex h-8 shrink-0 items-center justify-between gap-1 rounded-md bg-[var(--surface-2)] px-2.5 text-left text-[12px] font-medium hover:bg-[var(--bg-hover)] ${on ? 'text-[var(--tl-accent)]' : 'text-[var(--text)]'}`}
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
      className={`truncate whitespace-nowrap px-2.5 py-1.5 text-left text-[12px] ${on ? 'font-medium text-[var(--tl-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
    >
      {children}
    </button>
  );
}

/** Where its "+" (and a double click) puts it, said in its tooltip. */
function addTip(item: LibraryItem, t: (path: string) => string): string {
  return t(item.cat === 'transition' ? 'assetDrawer.addCut' : item.kind === 'look' ? 'assetDrawer.addLook' : 'assetDrawer.addPlayhead');
}

/** What a drag of `item` carries to the timeline (or the chat). */
function dragOf(item: LibraryItem, name: string) {
  const drag = libraryDragItem(item, name);
  return drag ? (e: React.DragEvent) => { setResourceDragData(e.dataTransfer, drag); e.dataTransfer.effectAllowed = 'copy'; } : undefined;
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
      <Star size={13} fill="currentColor" strokeWidth={0} />
    </button>
  );
}

function AddButton({ item, onAdd, className }: { item: LibraryItem; onAdd: () => void; className: string }) {
  const t = useT();
  return (
    <button type="button" title={addTip(item, t)} aria-label={addTip(item, t)} onClick={(e) => { e.stopPropagation(); onAdd(); }} {...own} className={className}>
      <Plus size={12} strokeWidth={3} />
    </button>
  );
}

const SAMPLE = libraryUrl('filters/sample.jpg');

function Card({ item, lang, picked, kept, square, onPick, onAdd }: {
  item: LibraryItem; lang: ReturnType<typeof useLanguage>; picked: boolean; kept: boolean; square: boolean; onPick: () => void; onAdd: () => void;
}) {
  const [hover, setHover] = React.useState(false);
  const name = nameOf(item.name, lang);
  return (
    <div
      className="group relative min-w-0 cursor-default select-none"
      draggable
      onDragStart={dragOf(item, name)}
      onDragEnd={() => clearResourceDrag()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPick}
      onDoubleClick={onAdd}
      title={name}
    >
      <div className={`relative overflow-hidden rounded-md bg-[var(--surface-2)] ${square ? 'aspect-square' : 'aspect-video'} ${picked ? 'ring-2 ring-[var(--tl-accent)]' : 'ring-1 ring-transparent group-hover:ring-[var(--text-faint)]'}`}>
        {item.kind === 'look'
          ? <img src={SAMPLE} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" style={{ filter: item.filter }} />
          : <img src={posterUrl(item)} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />}
        {hover && item.kind !== 'look' ? <video src={previewUrl(item)} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
        <StarButton item={item} kept={kept} className={`absolute right-1 top-1 h-5 w-5 place-items-center rounded-full bg-black/45 ${kept ? 'grid text-[#ffd35a]' : 'hidden text-white group-hover:grid'}`} />
        <AddButton item={item} onAdd={onAdd} className="absolute bottom-1 right-1 hidden h-[22px] w-[22px] place-items-center rounded-full bg-[var(--tl-accent)] text-black shadow-md group-hover:grid" />
      </div>
      <div className={`mt-1.5 truncate px-0.5 text-[11.5px] ${picked ? 'text-[var(--tl-accent)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text)]'}`}>{name}</div>
    </div>
  );
}

/** A sound's length as the list says it: seconds under a minute (0.7 s), else minutes and seconds (1:04). */
function lengthOf(ms: number, t: (path: string) => string): string {
  if (ms < 60_000) return t('assetDrawer.seconds').replace('{s}', String(Math.round(ms / 100) / 10));
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* the sound playing in the drawer: one at a time */
let playingSound: HTMLAudioElement | null = null;

/* a sound's tile, tinted by its group so the kinds of sound read apart down the list */
const TINTS = ['#3b6fd8', '#8a4fd8', '#d8507a', '#d88a3b', '#3bab8a', '#5f8fa8'];
const tintOf = (group: string) => TINTS[[...group].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % TINTS.length]!;

/**
 * A sound or a piece of music: its tile (playing it under the pointer), its name, group and length, and its waveform
 * across the row, lit in the accent as far as it has played.
 */
function SoundRow({ item, lang, group, picked, kept, onPick, onAdd }: {
  item: LibraryItem; lang: ReturnType<typeof useLanguage>; group: string; picked: boolean; kept: boolean; onPick: () => void; onAdd: () => void;
}) {
  const t = useT();
  const [playing, setPlaying] = React.useState(false);
  const [played, setPlayed] = React.useState(0);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => () => { audio.current?.pause(); }, []);
  /* how far it has played, each frame while it plays */
  React.useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    const tick = () => {
      const a = audio.current;
      if (a?.duration) setPlayed(a.currentTime / a.duration);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  /* a click picks it and plays it; a click on it again stops it */
  const click = () => {
    onPick();
    if (playing) { audio.current?.pause(); return; }
    playingSound?.pause();
    audio.current ??= new Audio(libraryUrl(item.id));
    const a = audio.current;
    a.currentTime = 0;
    setPlayed(0);
    a.onpause = () => setPlaying(false);
    a.onended = () => { setPlaying(false); setPlayed(0); };
    playingSound = a;
    void a.play().then(() => setPlaying(true), () => setPlaying(false));
  };
  const name = nameOf(item.name, lang);
  const lit = Math.round(played * 1000) / 10;
  const tint = tintOf(item.group);
  return (
    <div
      className={`group relative grid cursor-default select-none grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 py-2 ${picked ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}
      draggable
      onDragStart={dragOf(item, name)}
      onDragEnd={() => clearResourceDrag()}
      onClick={click}
      onDoubleClick={onAdd}
      title={name}
    >
      <span
        aria-label={playing ? t('assetDrawer.stop') : t('assetDrawer.play')}
        className="relative grid h-11 w-11 place-items-center overflow-hidden rounded-lg text-white"
        style={{ background: `linear-gradient(140deg, ${tint}, color-mix(in srgb, ${tint} 45%, #101010))` }}
      >
        <AudioLines size={18} strokeWidth={1.8} className={`opacity-85 ${playing ? 'hidden' : 'group-hover:hidden'}`} />
        <span className={`absolute inset-0 place-items-center bg-black/30 ${playing ? 'grid' : 'hidden group-hover:grid'}`}>
          {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="translate-x-px" />}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`truncate text-[12.5px] font-medium ${picked || playing ? 'text-[var(--tl-accent)]' : 'text-[var(--text)]'}`}>{name}</span>
          <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{group}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--text-faint)] group-hover:hidden">
            {lengthOf(item.durationMs ?? 0, t)}
          </span>
          <span className="ml-auto hidden shrink-0 items-center gap-1.5 group-hover:flex">
            <StarButton item={item} kept={kept} className={kept ? 'text-[#ffd35a]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'} />
            <AddButton item={item} onAdd={onAdd} className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[var(--tl-accent)] text-black" />
          </span>
          {kept ? <Star size={11} fill="#ffd35a" strokeWidth={0} className="shrink-0 group-hover:hidden" /> : null}
        </span>
        {/* its waveform as a mask: lit as far as it has played, the rest quiet */}
        <span
          aria-hidden
          className="block h-[18px] w-full"
          style={{
            WebkitMaskImage: `url(${waveUrl(item)})`, maskImage: `url(${waveUrl(item)})`,
            WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
            background: `linear-gradient(to right, var(--tl-accent) ${lit}%, var(--text-faint) ${lit}%)`,
          }}
        />
      </span>
    </div>
  );
}
