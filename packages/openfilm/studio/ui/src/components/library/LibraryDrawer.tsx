/**
 * The assets drawer's library (in the app's panel, over the chat, its composer under it), laid out as an editor's
 * library is: the categories along the top — the media (the project's and Saved, the media pane as it was), then
 * OpenFilm's own audio, text, stickers, effects, transitions and filters (lib/library) — and a category's groups down
 * the left, its things beside them. What is shown is in the accent color, nothing behind it.
 *
 * A thing plays in its card while the pointer rests on it. A click picks it and tries it in the viewer, on the picture
 * there (nothing is written; Esc, a click on it again, or another category takes it away); a sound is heard. A double
 * click, Enter, or its "+" puts it in the film where the try showed it; a drag puts it where it is let go. A star keeps
 * it among the favorites, for every project.
 */
import React from 'react';
import { ArrowRightLeft, Aperture, Clapperboard, Music, Pause, Play, Plus, Search, Sparkles, Star, Sticker, Type } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import {
  libraryDragItem, libraryUrl, nameOf, posterUrl, previewUrl, toggleFavorite, useLibraryFavorites, useLibraryIndex, waveUrl,
  type LibraryCategory, type LibraryItem,
} from '@/lib/library';
import { clearResourceDrag, setResourceDragData } from '@/lib/resource-drag';

type Category = 'media' | LibraryCategory;
const CATEGORIES: { id: Category; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'media', icon: Clapperboard },
  { id: 'sound', icon: Music },
  { id: 'text', icon: Type },
  { id: 'sticker', icon: Sticker },
  { id: 'effect', icon: Sparkles },
  { id: 'transition', icon: ArrowRightLeft },
  { id: 'filter', icon: Aperture },
];

/** The side bar's starred line: a category's things the person starred ('' is all of it, else one of its groups). */
const FAVORITES = '★';

/* the category shown and the line picked in each, kept while the drawer closes and opens again */
const SHOWN = { cat: 'media' as Category, group: {} as Partial<Record<Category, string>> };

export interface LibraryActions {
  /** A double click, Enter or "+": a page or a sound at the playhead (a transition on the cut), a look on the clip. */
  add: (item: LibraryItem) => void;
  /** A click: tried in the viewer (null: no longer). */
  tryOut: (item: LibraryItem | null) => void;
}

export function LibraryDrawer({ media, mediaScope, onMediaScope, actions }: {
  media: React.ReactNode;
  mediaScope: 'project' | 'saved';
  onMediaScope: (next: 'project' | 'saved') => void;
  actions: LibraryActions;
}) {
  const t = useT();
  const lang = useLanguage();
  const index = useLibraryIndex();
  const favorites = useLibraryFavorites();
  const [cat, setCat] = React.useState<Category>(SHOWN.cat);
  const [group, setGroup] = React.useState<string>(SHOWN.group[SHOWN.cat] ?? '');
  const [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState<string | null>(null);
  const tryOut = React.useRef(actions.tryOut);
  tryOut.current = actions.tryOut;
  const pick = (item: LibraryItem | null) => {
    setPicked(item?.id ?? null);
    if (item?.kind !== 'sound') tryOut.current(item);
  };
  const show = (next: Category) => { SHOWN.cat = next; setCat(next); setGroup(SHOWN.group[next] ?? ''); setQuery(''); pick(null); };
  const pickGroup = (next: string) => { SHOWN.group[cat] = next; setGroup(next); };
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

  /* the bars and the library's things are the app's panel's (data-studio-host-panel): a press there keeps what is
     picked on the timeline and the picture, which a look or a transition goes on */
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col outline-none" tabIndex={-1} onKeyDown={onKey}>
      <nav data-studio-host-panel="" className="flex shrink-0 overflow-x-auto border-b border-[var(--dock-line)] px-0.5 pb-0.5 pt-1 [scrollbar-width:none]">
        {CATEGORIES.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => show(id)}
            aria-pressed={cat === id}
            className={`flex min-w-[44px] flex-1 flex-col items-center gap-0.5 whitespace-nowrap px-0.5 pb-1 pt-1 text-[11px] ${cat === id ? 'text-[var(--tl-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
          >
            <Icon size={18} strokeWidth={1.6} />
            {t(`assetDrawer.cat_${id}`)}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 flex-1">
        <nav data-studio-host-panel="" className="flex w-[84px] shrink-0 flex-col overflow-y-auto border-r border-[var(--dock-line)] py-2">
          {cat === 'media' ? (
            <>
              <SideItem head on={mediaScope === 'project'} onClick={() => onMediaScope('project')}>{t('assetDrawer.mediaProject')}</SideItem>
              <SideItem head on={mediaScope === 'saved'} onClick={() => onMediaScope('saved')}>{t('assetDrawer.mediaSaved')}</SideItem>
            </>
          ) : (
            <>
              <SideItem head on={group === FAVORITES && !q} onClick={() => pickGroup(FAVORITES)}>{t('assetDrawer.favorites')}</SideItem>
              <SideItem head on={!group && !q} onClick={() => pickGroup('')}>{t('assetDrawer.all')}</SideItem>
              {(index?.groups[cat] ?? []).map((g) => (
                <SideItem key={g.id} on={group === g.id && !q} onClick={() => pickGroup(g.id)}>{nameOf(g.name, lang)}</SideItem>
              ))}
            </>
          )}
        </nav>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-studio-host-panel={cat === 'media' ? undefined : ''}>
          {cat === 'media' ? media : (
            <>
              <div className="px-2.5 pb-1.5 pt-2">
                <label className="flex min-w-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--text-faint)]">
                  <Search size={13} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t('assetDrawer.search').replace('{what}', t(`assetDrawer.cat_${cat}`))}
                    className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
                  />
                </label>
              </div>
              {/* a click on nothing lets the picked thing go */}
              <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 pt-1" onClick={(e) => { if (e.target === e.currentTarget) pick(null); }}>
                {!items.length ? (
                  <p className="px-2 py-8 text-center text-[12px] leading-relaxed text-[var(--text-faint)]">
                    {q ? t('assetDrawer.nothing').replace('{q}', query.trim()) : group === FAVORITES ? t('assetDrawer.noFavorites') : ''}
                  </p>
                ) : cat === 'sound' ? (
                  <div className="flex flex-col">
                    {items.map((it) => (
                      <SoundRow key={it.id} item={it} lang={lang} picked={picked === it.id} kept={favorites.includes(it.id)}
                        onPick={() => pick(it)} onAdd={() => actions.add(it)} />
                    ))}
                  </div>
                ) : (
                  <div className={`grid gap-x-2 gap-y-2.5 ${cat === 'sticker' ? 'grid-cols-[repeat(auto-fill,minmax(64px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(92px,1fr))]'}`}>
                    {items.map((it) => (
                      <Card key={it.id} item={it} lang={lang} picked={picked === it.id} kept={favorites.includes(it.id)} square={cat === 'sticker'}
                        onPick={() => pick(picked === it.id ? null : it)} onAdd={() => actions.add(it)} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** One line of the side bar: a heading of its own (all, the starred, the media's two) or a group, indented. */
function SideItem({ head, on, onClick, children }: { head?: boolean; on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`truncate py-1.5 pr-2 text-left text-[12px] ${head ? 'pl-3 font-semibold' : 'pl-5'} ${on ? 'text-[var(--tl-accent)]' : head ? 'text-[var(--text)] hover:text-[var(--tl-accent)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
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
      <div className={`relative overflow-hidden rounded-[5px] ${square ? 'aspect-square bg-[var(--surface-2)]' : 'aspect-video bg-black'} ${picked ? 'outline outline-2 -outline-offset-1 outline-[var(--tl-accent)]' : 'outline outline-1 outline-[var(--border)]'}`}>
        {item.kind === 'look'
          ? <img src={SAMPLE} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" style={{ filter: item.filter }} />
          : <img src={posterUrl(item)} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />}
        {hover && item.kind !== 'look' ? <video src={previewUrl(item)} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
        <StarButton item={item} kept={kept} className={`absolute right-1 top-1 h-[18px] w-[18px] place-items-center drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)] ${kept ? 'grid text-[#ffd35a]' : 'hidden text-white group-hover:grid'}`} />
        <AddButton item={item} onAdd={onAdd} className="absolute bottom-1 right-1 hidden h-5 w-5 place-items-center rounded-full bg-[var(--tl-accent)] text-black shadow group-hover:grid" />
      </div>
      <div className={`mt-1 truncate text-[11px] ${picked ? 'text-[var(--tl-accent)]' : 'text-[var(--text-dim)]'}`}>{name}</div>
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
      className="group relative grid cursor-default select-none grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1.5 hover:bg-[var(--bg-hover)]"
      draggable
      onDragStart={dragOf(item, name)}
      onDragEnd={() => clearResourceDrag()}
      onClick={click}
      onDoubleClick={onAdd}
      title={name}
    >
      <span aria-label={playing ? t('assetDrawer.stop') : t('assetDrawer.play')} className={`grid h-[34px] w-[34px] place-items-center rounded-md bg-[var(--surface-2)] ${picked ? 'text-[var(--tl-accent)]' : 'text-[var(--text-muted)]'}`}>
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </span>
      <span className="min-w-0">
        <span className={`block truncate text-[12px] ${picked ? 'text-[var(--tl-accent)]' : 'text-[var(--text)]'}`}>{name}</span>
        <span className="flex items-center gap-1.5">
          <img src={waveUrl(item)} alt="" draggable={false} className="h-3 w-[88px] object-fill opacity-55" />
          <span className="text-[10.5px] text-[var(--text-faint)]">{t('assetDrawer.seconds').replace('{s}', String(Math.round((item.durationMs ?? 0) / 100) / 10))}</span>
        </span>
      </span>
      <span className="flex items-center gap-1.5">
        <StarButton item={item} kept={kept} className={kept ? 'text-[#ffd35a]' : 'invisible text-[var(--text-faint)] hover:text-[var(--text)] group-hover:visible'} />
        <AddButton item={item} onAdd={onAdd} className="invisible grid h-5 w-5 place-items-center rounded-full bg-[var(--tl-accent)] text-black group-hover:visible" />
      </span>
    </div>
  );
}
