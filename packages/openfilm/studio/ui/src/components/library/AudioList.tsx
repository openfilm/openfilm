/**
 * The library's sounds and music as the assets drawer lists them: a sound a row (its tile in its group's colors with
 * its group's mark, its name, length and waveform), a piece of music a card (its cover, else one drawn, its name, mood
 * and length),
 * and one player under the list for what was clicked (a voice's sample too, VoicesPane): play and pause, how far it has
 * played, dragged to any moment. Rows and cards keep their size under the pointer: their buttons are always there, only
 * shown on it, a star and a "+" of one size.
 */
import React from 'react';
import {
  AlertCircle, AudioWaveform, Bell, Car, Cat, Cpu, Download, Footprints, Laugh, Leaf, MousePointerClick, Pause, Play, Plus, RotateCw, Square, Star, Users, Wind, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '@/i18n';
import { coverLook, heardHere, libraryUrl, mayNeedFetch, soundLook, toggleFavorite, useLibraryHere, waveUrl, type HereState, type LibraryItem } from '@/lib/library';
import { createPreviewPlayer, type Playable, type PreviewError, type PreviewState } from '@/lib/library-player';
import { useMediaImage } from '@/lib/media-queue';
import styles from './AudioList.module.css';

/** each group of sounds its mark on its tile */
const MARKS: Record<string, LucideIcon> = {
  transition: Wind, ui: MousePointerClick, impact: Zap, ambience: AudioWaveform, foley: Footprints, nature: Leaf,
  animals: Cat, people: Users, tech: Cpu, cartoon: Laugh, stings: Bell, vehicles: Car,
};

/** A length as the list says it: seconds under a minute (0.7 s), else minutes and seconds (1:04). */
export function lengthOf(ms: number, t: (path: string) => string): string {
  if (ms < 60_000) return t('assetDrawer.seconds').replace('{s}', String(Math.round(ms / 100) / 10));
  return clock(ms / 1000);
}
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** What the player plays: a thing of the library, or a voice (its sample). */
export type { Playable } from '@/lib/library-player';

export interface Player<T extends Playable = LibraryItem> {
  item: T | null;
  playing: boolean;
  loading: boolean;
  downloading: boolean;
  slow: boolean;
  error: PreviewError | null;
  status: PreviewState<T>['status'];
  /** seconds played, and its length */
  time: number;
  duration: number;
  /** play it from the start (or go on, when it is the one paused); pause it when it plays. `src`: where it is heard,
      a library thing's own file by default */
  toggle: (item: T, src?: string) => void;
  pause: () => void;
  seek: (sec: number) => void;
  close: () => void;
}

/** The drawer's player: what plays, how far, and its controls. Stops when the drawer goes. */
export function usePlayer<T extends Playable = LibraryItem>(): Player<T> {
  const [player] = React.useState(() => createPreviewPlayer<T>({ onReady: heardHere }));
  const state = React.useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
  const hereOf = useLibraryHere();
  const playing = state.status === 'playing';
  React.useEffect(() => player.close, [player]);
  React.useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    const tick = () => { player.tick(); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, player]);
  return {
    ...state, playing, loading: state.status === 'loading',
    downloading: state.status === 'loading' && !state.ready && Boolean(state.item && mayNeedFetch(state.item) && hereOf(state.item.id) !== 'here'),
    toggle: (next, src) => player.toggle(next, src ?? (state.item?.id === next.id ? undefined : libraryUrl(next.id))),
    pause: player.pause, seek: player.seek, close: player.close,
  };
}

/** A press on a button of a row or card: not its click, nor its double click. */
const own = { onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() };

/** A row's or card's star and "+": round, of one size; on the panel tinted with the words' color, the "+" in the
    accent under the pointer. Over a picture they are dark glass instead (LibraryDrawer's cards). */
export const ROUND = 'h-5 w-5 shrink-0 place-items-center rounded-full';
export const PANEL_ROUND = `${ROUND} bg-[var(--bg-pressed)]`;
export const ON_PANEL = `grid ${PANEL_ROUND}`;
export const ADD_HOVER = 'hover:bg-[var(--accent)] hover:text-[var(--on-accent)]';

/**
 * The add button is available when the asset is local. A remote asset has a passive status badge: clicking it
 * reaches the card's preview action, just like clicking anywhere else on the card.
 */
export function HereButton({ here, addTip, onAdd, className, show = '' }: {
  here: HereState; addTip: string; onAdd: () => void; className: string; show?: string;
}) {
  const t = useT();
  if (here === 'here') {
    return (
      <button type="button" title={addTip} aria-label={addTip} {...own} onClick={(e) => { e.stopPropagation(); onAdd(); }} className={`${className} ${ADD_HOVER} ${show}`}>
        <Plus size={12} strokeWidth={2.6} />
      </button>
    );
  }
  const label = t(here === 'fetching' ? 'assetDrawer.downloading' : here === 'failed' ? 'assetDrawer.previewFailed' : 'assetDrawer.previewDownloadPlay');
  return (
    <span role="img" aria-label={label} data-library-download={here}
      className={`grid ${className} ${here === 'failed' ? 'text-[#ff8a80]' : ''}`}><Download size={12} strokeWidth={2.6} /></span>
  );
}

/** The pending preview's promise, shared by the row and the player. */
export function previewMessage(player: Pick<Player, 'error' | 'slow' | 'downloading'>, t: (path: string) => string): string {
  return t(player.error === 'timeout' ? 'assetDrawer.previewTimeout' : player.error ? 'assetDrawer.previewFailed'
    : player.downloading ? player.slow ? 'assetDrawer.previewDownloadSlow' : 'assetDrawer.previewDownloading'
      : player.slow ? 'assetDrawer.previewSlow' : 'assetDrawer.previewLoading');
}

/** Unknown download size: animate activity without inventing a percentage. */
export function LoadingBar({ label }: { label: string }) {
  return <span className={styles.loading} role="progressbar" aria-label={label} data-audio-loading="" />;
}

function Buttons({ item, kept, addTip, onAdd, always, here = 'here', downloading }: {
  item: LibraryItem; kept: boolean; addTip: string; onAdd: () => void; always?: boolean; here?: HereState; downloading: boolean;
}) {
  const t = useT();
  const show = always ? '' : 'invisible group-hover:visible';
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <button type="button" aria-label={t(kept ? 'assetDrawer.unstar' : 'assetDrawer.star')} aria-pressed={kept} {...own}
        onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}
        className={`${ON_PANEL} ${kept ? 'visible text-[#ffd35a]' : `${show} text-[var(--text)]`}`}>
        <Star size={11} fill={kept ? 'currentColor' : 'none'} strokeWidth={kept ? 0 : 2.2} />
      </button>
      {here === 'here' ? <HereButton here={here} addTip={addTip} onAdd={onAdd} className={`${ON_PANEL} text-[var(--text)]`} show={show} />
        : <span role="img" data-library-download={downloading || here === 'fetching' ? 'fetching' : here}
          aria-label={t(downloading ? 'assetDrawer.previewDownloading' : here === 'fetching' ? 'assetDrawer.downloading' : 'assetDrawer.previewDownloadPlay')}
          className={`${ON_PANEL} ${here === 'failed' ? 'text-[#ff8a80]' : 'text-[var(--text-muted)]'}`}>
          <Download size={12} />
        </span>}
    </span>
  );
}

/** A sound's tile: its group's colors and mark; play or pause on it under the pointer and while it plays. */
export function Tile({ item, playing, loading = false, size, cover }: { item: LibraryItem; playing: boolean; loading?: boolean; size: number; cover?: boolean }) {
  const look = React.useMemo(() => (cover ? coverLook(item) : soundLook(item)), [item, cover]);
  const Mark = MARKS[item.group] ?? AudioWaveform;
  return (
    <span className="relative grid shrink-0 place-items-center overflow-hidden rounded-lg text-white" style={{ width: size, height: size }}>
      <span className={`absolute -inset-1 ${cover ? '' : 'blur-[2px]'}`} style={look} />
      {cover && item.cover ? <img src={libraryUrl(item.cover)} alt="" draggable={false} loading="lazy" className="absolute inset-0 h-full w-full object-cover" /> : null}
      {cover ? null : <Mark size={size * 0.38} strokeWidth={1.8} className={`relative drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)] ${playing || loading ? 'opacity-0' : 'opacity-90 group-hover:opacity-0'}`} />}
      <span className={`absolute inset-0 grid place-items-center bg-black/35 ${playing || loading ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-black/45">
          {loading ? <Square size={11} fill="currentColor" /> : playing ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="translate-x-px" />}
        </span>
      </span>
    </span>
  );
}

/** Its waveform as a mask: lit in the accent as far as it has played, the rest quiet. */
function Wave({ item, played }: { item: LibraryItem; played: number }) {
  const lit = Math.round(played * 1000) / 10;
  /* Eighty rows may be drawn at once. Their cloud waveforms share the bounded background queue so a click's
     audio request has a free connection, even when none of those pictures is cached yet. */
  const image = useMediaImage(waveUrl(item));
  return (
    <span aria-hidden className="block h-4 w-full" style={{
      visibility: image ? 'visible' : 'hidden',
      WebkitMaskImage: image ? `url(${image})` : undefined, maskImage: image ? `url(${image})` : undefined, WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
      background: `linear-gradient(to right, var(--accent) ${lit}%, var(--text-faint) ${lit}%)`,
    }} />
  );
}

export function SoundRow({ item, name, group, picked, player, kept, addTip, onPick, onAdd, drag, here }: {
  here?: HereState;
  item: LibraryItem; name: string; group: string; picked: boolean; player: Player; kept: boolean; addTip: string;
  onPick: () => void; onAdd: () => void; drag: React.HTMLAttributes<HTMLDivElement>;
}) {
  const t = useT();
  const mine = player.item?.id === item.id;
  return (
    <div
      {...drag}
      draggable
      data-library-audio={item.id}
      data-audio-preview={mine ? player.status : undefined}
      aria-busy={mine && player.loading}
      className={`group grid h-[60px] cursor-default select-none grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 ${picked || mine ? 'bg-[var(--bg-field)]' : 'hover:bg-[var(--bg-field)]'}`}
      onClick={() => { onPick(); player.toggle(item); }}
      onDoubleClick={onAdd}
      title={name}
    >
      <Tile item={item} playing={mine && player.playing} loading={mine && player.loading} size={44} />
      <span className="flex min-w-0 flex-col justify-center gap-1">
        <span className="flex h-6 min-w-0 items-center gap-2">
          <span className={`truncate text-[12.5px] font-medium ${picked || mine ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{name}</span>
          <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{group}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--text-faint)]">{lengthOf(item.durationMs ?? 0, t)}</span>
          <Buttons item={item} kept={kept} addTip={addTip} onAdd={onAdd} here={here} downloading={mine && player.downloading} />
        </span>
        <span className="flex h-4 min-w-0 items-center gap-2">
          {mine && player.loading ? <LoadingBar label={previewMessage(player, t)} />
            : <Wave item={item} played={mine && player.duration ? player.time / player.duration : 0} />}
        </span>
      </span>
    </div>
  );
}

export function MusicCard({ item, name, group, picked, player, kept, addTip, onPick, onAdd, drag, here }: {
  here?: HereState;
  item: LibraryItem; name: string; group: string; picked: boolean; player: Player; kept: boolean; addTip: string;
  onPick: () => void; onAdd: () => void; drag: React.HTMLAttributes<HTMLDivElement>;
}) {
  const t = useT();
  const mine = player.item?.id === item.id;
  return (
    <div
      {...drag}
      draggable
      data-library-audio={item.id}
      data-audio-preview={mine ? player.status : undefined}
      aria-busy={mine && player.loading}
      className={`group flex h-[92px] cursor-default select-none gap-2.5 rounded-xl p-2 ring-1 ${picked || mine ? 'bg-[var(--bg-field)] ring-[var(--accent)]' : 'bg-[var(--bg-raised)] ring-transparent hover:bg-[var(--bg-field)]'}`}
      onClick={() => { onPick(); player.toggle(item); }}
      onDoubleClick={onAdd}
      title={name}
    >
      <Tile item={item} playing={mine && player.playing} loading={mine && player.loading} size={76} cover />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`line-clamp-2 text-[12.5px] font-medium leading-[17px] ${picked || mine ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{name}</span>
        <span className="mt-0.5 truncate text-[11px] text-[var(--text-faint)]">{group} · {lengthOf(item.durationMs ?? 0, t)}</span>
        {mine && player.loading ? <span className="mt-1"><LoadingBar label={previewMessage(player, t)} /></span> : null}
        <span className="mt-auto flex justify-end"><Buttons item={item} kept={kept} addTip={addTip} onAdd={onAdd} always here={here} downloading={mine && player.downloading} /></span>
      </span>
    </div>
  );
}

/** The room a list keeps at its foot without the player: the composer's, and air. */
export const FOOT_ROOM = 'pb-[calc(var(--drawer-under,0px)+12px)]';

/** A library thing's picture in the player: its tile, a piece of music's cover. */
export const libraryArt = (item: LibraryItem, playing: boolean) => <Tile item={item} playing={playing} size={40} cover={item.cat === 'music'} />;

/**
 * The player under the list: what was clicked (`art` its picture, play or pause on it), and how far it has played,
 * dragged to any moment. It stands on the list's foot, its lower edge on the app's composer under it (--drawer-under),
 * so neither a strip of the drawer between them nor the player beside the composer shows.
 */
export function MiniPlayer<T extends Playable>({ player, name, group, art }: {
  player: Player<T>; name: string; group: string; art: (item: T, playing: boolean) => React.ReactNode;
}) {
  const t = useT();
  const { item } = player;
  const [dragged, setDragged] = React.useState<number | null>(null);
  React.useEffect(() => { setDragged(null); }, [item?.id, player.loading, player.error]);
  if (!item) return null;
  const at = dragged ?? player.time;
  const length = player.duration || (item.durationMs ?? 0) / 1000;
  /* a short sound by tenths of a second, anything longer as minutes and seconds */
  const say = (sec: number) => (length < 10 ? `${sec.toFixed(1)}` : clock(sec));
  return (
    /* on the drawer's own ground, a hairline above it: the composer's card under it sits on the same ground, as one
       stack, not a lighter strip ending on the card */
    <div className="mb-[var(--drawer-under,0px)] flex h-[60px] shrink-0 items-center gap-3 border-t border-[var(--border)] bg-[var(--bg-panel)] px-4" data-studio-host-panel="" data-audio-player={player.status}>
      <button type="button" className="group relative shrink-0 cursor-default" onClick={() => player.toggle(item)}
        aria-label={t(player.loading ? 'assetDrawer.previewCancel' : player.error ? 'assetDrawer.previewRetry' : player.playing ? 'assetDrawer.pause' : 'assetDrawer.play')}>
        {art(item, player.playing)}
        {player.loading || player.error ? <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/60 text-white">
          {player.error ? <RotateCw size={15} /> : <Square size={12} fill="currentColor" />}
        </span> : null}
      </button>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[12.5px] font-medium text-[var(--text)]">{name}</span>
          <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{group}</span>
        </span>
        {player.loading ? (
          <span className="flex h-4 items-center"><LoadingBar label={previewMessage(player, t)} /></span>
        ) : player.error ? (
          <span className="flex h-4 items-center gap-2 text-[#ff8a80]" role="status" aria-live="polite">
            <span className="sr-only">{previewMessage(player, t)}</span>
            <AlertCircle size={13} aria-hidden />
            <button type="button" aria-label={t('assetDrawer.previewRetry')} title={t('assetDrawer.previewRetry')}
              className="grid h-5 w-5 place-items-center text-[var(--accent)]" onClick={() => player.toggle(item)}><RotateCw size={13} /></button>
          </span>
        ) : <span className="flex items-center gap-2 text-[11px] tabular-nums">
          <span className="text-[var(--accent)]">{say(at)}</span>
          <Scrub at={Math.min(at, length)} length={length} label={t('assetDrawer.seek')}
            onDrag={setDragged} onLet={(sec) => { player.seek(sec); setDragged(null); }} />
          <span className="text-[var(--text-faint)]">{say(length)}</span>
        </span>}
      </span>
      <button type="button" aria-label={t('assetDrawer.close')} onClick={player.close}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--bg-field)] text-[var(--text-muted)] hover:text-[var(--text)]">
        <X size={14} />
      </button>
    </div>
  );
}

/** How far it has played, as a plain bar: pressed or dragged anywhere along it to go there; arrows step a second. */
function Scrub({ at, length, label, onDrag, onLet }: {
  at: number; length: number; label: string; onDrag: (sec: number) => void; onLet: (sec: number) => void;
}) {
  const bar = React.useRef<HTMLDivElement>(null);
  const held = React.useRef(false);
  const secAt = (x: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (x - r.left) / r.width)) * length;
  };
  const lit = length ? Math.min(100, (at / length) * 100) : 0;
  return (
    <div
      ref={bar}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(length)}
      aria-valuenow={Math.round(at)}
      className="group/scrub relative h-4 min-w-0 flex-1 cursor-pointer outline-none"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); held.current = true; onDrag(secAt(e.clientX)); }}
      onPointerMove={(e) => { if (held.current) onDrag(secAt(e.clientX)); }}
      onPointerUp={(e) => { if (!held.current) return; held.current = false; onLet(secAt(e.clientX)); }}
      onPointerCancel={() => { held.current = false; }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        onLet(Math.min(length, Math.max(0, at + (e.key === 'ArrowRight' ? 1 : -1))));
      }}
    >
      <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--bg-hover)]" />
      <span className="absolute left-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-[var(--accent)]" style={{ width: `${lit}%` }} />
      <span className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--accent)] transition-transform group-hover/scrub:scale-125" style={{ left: `${lit}%` }} />
    </div>
  );
}
