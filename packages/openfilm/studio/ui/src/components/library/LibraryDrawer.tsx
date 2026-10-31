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
import { ChevronDown, Pause, Play, Plus, Search, Star } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import {
  libraryDragItem, libraryUrl, nameOf, posterUrl, previewUrl, toggleFavorite, useLibraryFavorites, useLibraryIndex, waveUrl,
  type LibraryCategory, type LibraryItem,
} from '@/lib/library';
import { clearResourceDrag, setResourceDragData } from '@/lib/resource-drag';
import { useLibraryVoices } from '@/lib/library-voices';
import { CategoryIcon, Empty } from './icons';
import { STARRED, VoicesPane } from './VoicesPane';

type Category = 'media' | 'voice' | LibraryCategory;
const CATEGORIES: Category[] = ['media', 'voice', 'sound', 'music', 'text', 'sticker', 'filter', 'effect', 'transition'];

/** The side bar's starred line: a category's things the person starred ('' is all of it, else one of its groups). */
const FAVORITES = STARRED;

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
  mediaScope: 'project' | 'saved';
  onMediaScope: (next: 'project' | 'saved') => void;
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

  /* the bars and the library's things are the app's panel's (data-studio-host-panel): a press there keeps what is
     picked on the timeline and the picture, which a look or a transition goes on */
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col outline-none" tabIndex={-1} onKeyDown={onKey}>
      {/* the categories keep their own spacing however wide the panel is; more than fit scroll sideways (a wheel too) */}
      <nav
        data-studio-host-panel=""
        onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY; }}
        className="flex shrink-0 overflow-x-auto border-b border-[var(--dock-line)] px-1 [mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] [scrollbar-width:none]"
      >
        {CATEGORIES.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => show(id)}
            aria-pressed={cat === id}
            className={`flex min-w-[50px] shrink-0 flex-col items-center gap-[3px] whitespace-nowrap px-2 pb-1.5 pt-2 text-[11.5px] font-medium ${cat === id ? 'text-[var(--tl-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
          >
            <CategoryIcon id={id} on={cat === id} />
            {t(`assetDrawer.cat_${id}`)}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1">
        {/* as wide as its longest line (up to a limit), so no group's name is cut */}
        <nav data-studio-host-panel="" className="flex min-w-[104px] max-w-[148px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--dock-line)] px-2 py-2.5">
          {cat === 'media' ? (
            <>
              <SideBox on={mediaScope === 'project'} onClick={() => onMediaScope('project')}>{t('assetDrawer.mediaProject')}</SideBox>
              <SideBox on={mediaScope === 'saved'} onClick={() => onMediaScope('saved')}>{t('assetDrawer.mediaSaved')}</SideBox>
            </>
          ) : (
            <>
              <SideBox on={group === FAVORITES && !q} onClick={() => pickGroup(FAVORITES)}>{t('assetDrawer.favorites')}</SideBox>
              <SideBox on={group !== FAVORITES && folded && !q} open={!folded} onClick={fold}>
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
              <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-0.5" onClick={(e) => { if (e.target === e.currentTarget) pick(null); }}>
                {!items.length ? (
                  q ? <Empty icon="search" text={t('assetDrawer.nothing').replace('{q}', query.trim())} />
                    : group === FAVORITES ? <Empty icon="star" text={t('assetDrawer.noFavorites')} action={t('assetDrawer.seeAll')} onAction={() => pickGroup('')} />
                      : cat === 'music' ? <Empty icon="music" text={t('assetDrawer.musicSoon')} action={askMusic ? t('assetDrawer.musicMake') : undefined}
                        onAction={() => askMusic?.({ text: t('assetDrawer.musicAsk'), refs: [] })} />
                        : null
                ) : cat === 'sound' || cat === 'music' ? (
                  <div className="flex flex-col gap-0.5">
                    {items.map((it) => (
                      <SoundRow key={it.id} item={it} lang={lang} picked={picked === it.id} kept={favorites.includes(it.id)}
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

/* the sound playing in the drawer: one at a time */
let playingSound: HTMLAudioElement | null = null;

function SoundRow({ item, lang, picked, kept, onPick, onAdd }: {
  item: LibraryItem; lang: ReturnType<typeof useLanguage>; picked: boolean; kept: boolean; onPick: () => void; onAdd: () => void;
}) {
  const t = useT();
  const [playing, setPlaying] = React.useState(false);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => () => { audio.current?.pause(); }, []);
  /* a click picks it and plays it; a click on it again stops it */
  const click = () => {
    onPick();
    if (playing) { audio.current?.pause(); return; }
    playingSound?.pause();
    audio.current ??= new Audio(libraryUrl(item.id));
    const a = audio.current;
    a.currentTime = 0;
    a.onpause = () => setPlaying(false);
    a.onended = () => setPlaying(false);
    playingSound = a;
    void a.play().then(() => setPlaying(true), () => setPlaying(false));
  };
  const name = nameOf(item.name, lang);
  return (
    <div
      className={`group relative grid cursor-default select-none grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg px-2 py-2 ${picked ? 'bg-[var(--surface-2)]' : 'hover:bg-[var(--surface-2)]'}`}
      draggable
      onDragStart={dragOf(item, name)}
      onDragEnd={() => clearResourceDrag()}
      onClick={click}
      onDoubleClick={onAdd}
      title={name}
    >
      <span aria-label={playing ? t('assetDrawer.stop') : t('assetDrawer.play')} className={`grid h-10 w-10 place-items-center rounded-md bg-[var(--bg-hover)] ${picked ? 'text-[var(--tl-accent)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text)]'}`}>
        {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </span>
      <span className="min-w-0">
        <span className={`block truncate text-[12.5px] font-medium ${picked ? 'text-[var(--tl-accent)]' : 'text-[var(--text)]'}`}>{name}</span>
        <span className="mt-0.5 flex items-center gap-2">
          <img src={waveUrl(item)} alt="" draggable={false} className="h-3 w-[88px] object-fill opacity-55" />
          <span className="text-[10.5px] text-[var(--text-faint)]">{t('assetDrawer.seconds').replace('{s}', String(Math.round((item.durationMs ?? 0) / 100) / 10))}</span>
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <StarButton item={item} kept={kept} className={kept ? 'text-[#ffd35a]' : 'invisible text-[var(--text-faint)] hover:text-[var(--text)] group-hover:visible'} />
        <AddButton item={item} onAdd={onAdd} className="invisible grid h-[22px] w-[22px] place-items-center rounded-full bg-[var(--tl-accent)] text-black group-hover:visible" />
      </span>
    </div>
  );
}
