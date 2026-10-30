/**
 * The assets drawer's library (in the app's panel, over the chat, its composer under it): a rail of categories down
 * its left — the media (the project's and Saved, the media pane as it was), then OpenFilm's own audio, text, stickers,
 * effects, transitions and filters (lib/library) — and the category's things beside it, in their groups.
 *
 * A thing plays as the pointer rests on it, a click shows what it is below (where it comes from, what it becomes in
 * the film) with its button, and a drag puts a page or a sound on the timeline as a thing of Saved goes there. A look
 * or a fade is not a clip: its button puts it on the clips picked, or on a cut.
 */
import React from 'react';
import { ArrowRightLeft, Aperture, Image as ImageIcon, Music, Pause, Play, Plus, Search, Sparkles, Sticker, Type, X } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import {
  libraryDragItem, nameOf, posterUrl, previewUrl, libraryUrl, useLibraryIndex, waveUrl,
  type LibraryCategory, type LibraryItem,
} from '@/lib/library';
import { clearResourceDrag, setResourceDragData } from '@/lib/resource-drag';

type Category = 'media' | LibraryCategory;
const CATEGORIES: { id: Category; icon: React.ComponentType<{ size?: number; strokeWidth?: number }> }[] = [
  { id: 'media', icon: ImageIcon },
  { id: 'sound', icon: Music },
  { id: 'text', icon: Type },
  { id: 'sticker', icon: Sticker },
  { id: 'effect', icon: Sparkles },
  { id: 'transition', icon: ArrowRightLeft },
  { id: 'filter', icon: Aperture },
];

/* the category shown, kept while the drawer closes and opens again */
const SHOWN = { cat: 'media' as Category, group: {} as Partial<Record<Category, string>> };

export interface LibraryActions {
  /** A page or a sound at the playhead (taken into the project first). */
  place: (item: LibraryItem) => void;
  /** A look on the picked clips. */
  look: (item: LibraryItem) => void;
  /** A fade on the cut nearest the playhead or the picked clip. */
  fade: (item: LibraryItem) => void;
}

export function LibraryDrawer({ media, actions }: { media: React.ReactNode; actions: LibraryActions }) {
  const t = useT();
  const lang = useLanguage();
  const index = useLibraryIndex();
  const [cat, setCat] = React.useState<Category>(SHOWN.cat);
  const [group, setGroup] = React.useState<string>(SHOWN.group[SHOWN.cat] ?? '');
  const [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState<string | null>(null);
  const show = (next: Category) => { SHOWN.cat = next; setCat(next); setGroup(SHOWN.group[next] ?? ''); setPicked(null); setQuery(''); };
  const pickGroup = (next: string) => { SHOWN.group[cat] = next; setGroup(next); };

  const groups = cat === 'media' ? [] : index?.groups[cat] ?? [];
  const q = query.trim().toLowerCase();
  const items = (index?.items ?? []).filter((item) => item.cat === cat
    && (q ? Object.values(item.name).some((n) => n?.toLowerCase().includes(q)) : !group || item.group === group));
  const item = items.find((i) => i.id === picked) ?? (index?.items.find((i) => i.id === picked) ?? null);

  /* the rail and the library's things are the app's panel's (data-studio-host-panel): a press there keeps what is
     picked on the timeline and the picture, which their buttons act on */
  return (
    <div className="flex h-full min-h-0 min-w-0">
      <nav data-studio-host-panel="" className="flex w-[60px] shrink-0 flex-col gap-px overflow-y-auto border-r border-[var(--dock-line)] px-1 py-1.5">
        {CATEGORIES.map(({ id, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => show(id)}
            aria-pressed={cat === id}
            className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[10px] tracking-tight ${cat === id ? 'bg-[var(--surface-2)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}
          >
            <Icon size={18} strokeWidth={1.6} />
            <span className="max-w-full whitespace-nowrap">{t(`assetDrawer.cat_${id}`)}</span>
          </button>
        ))}
      </nav>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col" data-studio-host-panel={cat === 'media' ? undefined : ''}>
        {cat === 'media' ? media : (
          <>
            <div className="flex items-center gap-1.5 px-2.5 pb-1.5 pt-2">
              <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[var(--text-faint)]">
                <Search size={13} />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('assetDrawer.search').replace('{what}', t(`assetDrawer.cat_${cat}`))}
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
                />
              </label>
            </div>
            {groups.length > 1 && !q ? (
              <div className="flex shrink-0 gap-1 overflow-x-auto px-2.5 pb-1.5 [scrollbar-width:none]">
                {[{ id: '', name: { en: t('assetDrawer.all') } }, ...groups].map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => pickGroup(g.id)}
                    className={`shrink-0 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11.5px] ${group === g.id ? 'border-[var(--text)] bg-[var(--text)] text-[var(--bg)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                  >
                    {g.id ? nameOf(g.name, lang) : g.name.en}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 pt-1">
              {q && !items.length ? <p className="px-2 py-8 text-center text-[12px] text-[var(--text-faint)]">{t('assetDrawer.nothing').replace('{q}', query.trim())}</p> : null}
              {cat === 'sound' ? (
                <div className="flex flex-col">
                  {items.map((it) => <SoundRow key={it.id} item={it} lang={lang} picked={picked === it.id} onPick={() => setPicked(it.id)} onAdd={() => actions.place(it)} />)}
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(98px,1fr))] gap-x-2 gap-y-2.5">
                  {items.map((it) => <Card key={it.id} item={it} lang={lang} picked={picked === it.id} onPick={() => setPicked(it.id)} onAdd={() => (it.kind === 'look' ? actions.look(it) : it.kind === 'fade' ? actions.fade(it) : actions.place(it))} />)}
                </div>
              )}
            </div>
            {item ? <Details item={item} lang={lang} actions={actions} onClose={() => setPicked(null)} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

/** What a drag of `item` carries, when it is a clip (a page, a sound). */
function onDragStartOf(item: LibraryItem, name: string) {
  const drag = libraryDragItem(item, name);
  if (!drag) return undefined;
  return (e: React.DragEvent) => { setResourceDragData(e.dataTransfer, drag); e.dataTransfer.effectAllowed = 'copy'; };
}

const SAMPLE = libraryUrl('filters/sample.jpg');

/** Its picture: the poster, its preview playing while the pointer is on it (a look: the sample, in that look). */
function Picture({ item, playing }: { item: LibraryItem; playing: boolean }) {
  if (item.kind === 'look') return <img src={SAMPLE} alt="" draggable={false} className="h-full w-full object-cover" style={{ filter: item.filter }} />;
  return (
    <>
      <img src={posterUrl(item)} alt="" draggable={false} className="h-full w-full object-cover" />
      {playing ? <video src={previewUrl(item)} autoPlay loop muted playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
    </>
  );
}

function Card({ item, lang, picked, onPick, onAdd }: { item: LibraryItem; lang: ReturnType<typeof useLanguage>; picked: boolean; onPick: () => void; onAdd: () => void }) {
  const [hover, setHover] = React.useState(false);
  const name = nameOf(item.name, lang);
  const drag = onDragStartOf(item, name);
  return (
    <div
      className="group relative min-w-0 cursor-default select-none"
      draggable={Boolean(drag)}
      onDragStart={drag}
      onDragEnd={() => clearResourceDrag()}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onPick}
      title={name}
    >
      <div className={`relative aspect-video overflow-hidden rounded-md bg-black ${picked ? 'outline outline-2 outline-[var(--accent)]' : 'outline outline-1 outline-[var(--border)]'}`}>
        <Picture item={item} playing={hover} />
        <button
          type="button"
          aria-label={name}
          onClick={(e) => { e.stopPropagation(); onAdd(); }}
          className="absolute right-1 top-1 hidden h-5 w-5 place-items-center rounded bg-black/60 text-white group-hover:grid"
        >
          <Plus size={12} strokeWidth={2.4} />
        </button>
      </div>
      <div className="mt-1 truncate text-[11px] text-[var(--text-dim)]">{name}</div>
    </div>
  );
}

/* the sound playing in the drawer: one at a time */
let playingSound: HTMLAudioElement | null = null;

function SoundRow({ item, lang, picked, onPick, onAdd }: { item: LibraryItem; lang: ReturnType<typeof useLanguage>; picked: boolean; onPick: () => void; onAdd: () => void }) {
  const t = useT();
  const [playing, setPlaying] = React.useState(false);
  const audio = React.useRef<HTMLAudioElement | null>(null);
  React.useEffect(() => () => { audio.current?.pause(); }, []);
  const toggle = () => {
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
  const drag = onDragStartOf(item, name);
  return (
    <div
      className={`group grid cursor-default select-none grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1.5 ${picked ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--bg-hover)]'}`}
      draggable={Boolean(drag)}
      onDragStart={drag}
      onDragEnd={() => clearResourceDrag()}
      onClick={onPick}
    >
      <button type="button" aria-label={playing ? t('assetDrawer.stop') : t('assetDrawer.play')} onClick={(e) => { e.stopPropagation(); toggle(); }} className="grid h-8 w-8 place-items-center rounded-md bg-[var(--surface-2)] text-[var(--text)]">
        {playing ? <Pause size={13} /> : <Play size={13} />}
      </button>
      <div className="min-w-0">
        <div className="truncate text-[12px] text-[var(--text)]">{name}</div>
        <div className="flex items-center gap-1.5">
          <img src={waveUrl(item)} alt="" draggable={false} className="h-3.5 w-24 object-fill opacity-60" />
          <span className="text-[10.5px] text-[var(--text-faint)]">{t('assetDrawer.seconds').replace('{s}', String(Math.round((item.durationMs ?? 0) / 100) / 10))}</span>
        </div>
      </div>
      <button type="button" aria-label={name} onClick={(e) => { e.stopPropagation(); onAdd(); }} className="grid h-6 w-6 place-items-center rounded text-[var(--text-faint)] opacity-0 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] group-hover:opacity-100">
        <Plus size={13} />
      </button>
    </div>
  );
}

/** What it becomes in the film, said plainly. */
function becomes(item: LibraryItem, t: (path: string) => string): string {
  const file = item.src ? `saved/openfilm/${item.id.replaceAll('/', '-')}/${item.src}` : '';
  if (item.kind === 'look') return t('assetDrawer.becomes_look').replace('{filter}', item.filter ?? '');
  if (item.kind === 'sound') return t('assetDrawer.becomes_sound');
  if (item.kind === 'fade') return item.fade === 'dissolve' ? t('assetDrawer.becomes_fade_dissolve') : t('assetDrawer.becomes_fade_dip').replace('{what}', t(item.fade === 'dip-white' ? 'assetDrawer.dipWhite' : 'assetDrawer.dipBlack'));
  if (item.place === 'cut') return t('assetDrawer.becomes_cut').replace('{file}', file);
  return t(`assetDrawer.becomes_${item.cat}`).replace('{file}', file);
}

/** A thing picked: below the things, its picture, where it comes from, what it becomes, and its button. */
function Details({ item, lang, actions, onClose }: { item: LibraryItem; lang: ReturnType<typeof useLanguage>; actions: LibraryActions; onClose: () => void }) {
  const t = useT();
  const action = item.kind === 'look' ? () => actions.look(item) : item.kind === 'fade' ? () => actions.fade(item) : () => actions.place(item);
  const label = item.kind === 'look' ? t('assetDrawer.useOnClips') : item.kind === 'fade' || item.place === 'cut' ? t('assetDrawer.addCut') : t('assetDrawer.addPlayhead');
  const hint = item.kind === 'look' ? t('assetDrawer.clickHint') : item.kind === 'fade' ? '' : t('assetDrawer.dragHint');
  return (
    <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[62%] flex-col border-t border-[var(--border-strong)] bg-[var(--surface)] shadow-[0_-12px_30px_rgba(0,0,0,0.35)]">
      <div className="flex items-center justify-between px-3 py-1.5 text-[11.5px] text-[var(--text-muted)]">
        <span>{t(`assetDrawer.cat_${item.cat}`)}</span>
        <button type="button" aria-label={t('assetDrawer.close')} onClick={onClose} className="grid h-6 w-6 place-items-center rounded hover:bg-[var(--bg-hover)]"><X size={13} /></button>
      </div>
      <div className="grid min-h-0 grid-cols-[40%_minmax(0,1fr)] gap-x-3 gap-y-2 overflow-y-auto px-3 pb-3">
        {item.kind === 'sound' ? null : (
          <div className="relative aspect-video overflow-hidden rounded-md bg-black outline outline-1 outline-[var(--border)]"><Picture item={item} playing /></div>
        )}
        <div className={`min-w-0 ${item.kind === 'sound' ? 'col-span-2' : ''}`}>
          <div className="mb-1 text-[13.5px] font-semibold text-[var(--text)]">{nameOf(item.name, lang)}</div>
          <div className="text-[11px] leading-snug text-[var(--text-muted)]">{t('assetDrawer.sourceBuiltIn')}</div>
        </div>
        <div className="col-span-2 rounded-md bg-[var(--surface-2)] px-2.5 py-2 text-[11.5px] leading-relaxed text-[var(--text-dim)] [overflow-wrap:anywhere]">
          <div className="text-[10.5px] text-[var(--text-muted)]">{t('assetDrawer.becomes')}</div>
          {becomes(item, t)}
        </div>
        <div className="col-span-2 flex items-center gap-2">
          <button type="button" onClick={action} className="rounded-md bg-[var(--text)] px-3 py-1.5 text-[12px] font-semibold text-[var(--bg)]">{label}</button>
          {hint ? <span className="text-[11px] text-[var(--text-faint)]">{hint}</span> : null}
        </div>
      </div>
    </div>
  );
}
