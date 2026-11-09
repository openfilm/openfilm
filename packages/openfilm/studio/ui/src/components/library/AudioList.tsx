/**
 * The library's sounds and music as the assets drawer lists them: a sound a row (its tile in its group's colors with
 * its group's mark, its name, length and waveform), a piece of music a card (its cover, else one drawn, its name, mood
 * and length),
 * and one player under the viewer for what was clicked (a voice's sample too, VoicesPane): play and pause, how far it has
 * played, dragged to any moment. Rows and cards keep their size under the pointer: their buttons are always there, only
 * shown on it, a star and a "+" of one size.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import {
  AudioWaveform, Bell, Car, Cat, Cpu, Download, Footprints, Laugh, Leaf, LoaderCircle, MousePointerClick, Music2, Pause, Play, Plus, RotateCw, Square, Star, Users, Wind, Zap,
  type LucideIcon,
} from 'lucide-react';
import { useT } from '@/i18n';
import { coverLook, failedHere, heardHere, isLibraryItemReady, libraryUrl, soundLook, toggleFavorite, useLibraryHere, waveUrl, type HereState, type LibraryItem } from '@/lib/library';
import { createPreviewPlayer, type Playable, type PreviewError, type PreviewState } from '@/lib/library-player';
import { keyAction } from '@/lib/keymap-store';
import { useMediaImage } from '@/lib/media-queue';
import { PANE_BAR, PANE_BTN, PANE_ICON } from '../dock-pane-bar';
import { isTextField, isTypingTarget } from '../typing-target';
import { voicePalette, voicePaletteLook } from '@/lib/library-voices';
import artwork from './AudioArtwork.module.css';
import { VoiceOrbCanvas } from './VoiceOrbCanvas';

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
  readLevel: () => number;
  close: () => void;
}

/** The drawer's player: what plays, how far, and its controls. Stops when the drawer goes. */
export function usePlayer<T extends Playable>(onFailed: () => void, cacheKey: (item: T) => string = (item) => item.id, analyse = false): Player<T> {
  const [player] = React.useState(() => createPreviewPlayer<T>({ analyse, onReady: (item) => heardHere(cacheKey(item)) }));
  const state = React.useSyncExternalStore(player.subscribe, player.getSnapshot, player.getSnapshot);
  const hereOf = useLibraryHere();
  const id = state.item ? cacheKey(state.item) : null;
  const reportFailure = React.useRef(onFailed);
  reportFailure.current = onFailed;
  React.useEffect(() => {
    if (!state.error || !id) return;
    if (!state.ready && !isLibraryItemReady(id)) failedHere(id);
    reportFailure.current();
  }, [state.error, id, state.ready]);
  const playing = state.status === 'playing';
  const loading = state.status === 'loading';
  const downloading = Boolean(loading && id && hereOf(id, true) !== 'here');
  React.useEffect(() => player.close, [player]);
  React.useEffect(() => {
    if (!playing) return undefined;
    let frame = 0;
    const tick = () => { player.tick(); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, player]);
  return {
    ...state, playing, loading, downloading,
    toggle: (next, src) => player.toggle(next, src ?? (state.item?.id === next.id ? undefined : libraryUrl(next.id))),
    pause: player.pause, seek: player.seek, readLevel: player.readLevel, close: player.close,
  };
}

/** A row's or card's star and "+": round, of one size; on the panel tinted with the words' color, the "+" in the
    accent under the pointer. Over a picture they are dark glass instead (LibraryDrawer's cards). */
export const ROUND = 'h-5 w-5 shrink-0 place-items-center rounded-full';
export const PANEL_ROUND = `${ROUND} bg-[var(--bg-pressed)]`;
export const ON_PANEL = `grid ${PANEL_ROUND}`;
export const ADD_HOVER = 'hover:bg-[var(--accent)] hover:text-[var(--on-accent)]';
export const ADD_COLOR = 'bg-[var(--accent)] text-[var(--on-accent)] hover:brightness-110';

/**
 * The add button is available when the asset is local. A remote asset has a passive status badge: clicking it
 * reaches the card's preview action, just like clicking anywhere else on the card.
 */
export function HereButton({ here, addTip, onAdd, onRetry, className, show = 'grid' }: {
  here: HereState; addTip: string; onAdd: () => void; onRetry: () => void; className: string; show?: string;
}) {
  if (here === 'here') {
    return (
      <button type="button" aria-label={addTip} onClick={(e) => { e.stopPropagation(); onAdd(); }} className={`${ROUND} ${ADD_COLOR} ${show}`}>
        <Plus size={12} strokeWidth={2.6} />
      </button>
    );
  }
  return <DownloadBadge state={here} onRetry={onRetry} className={className} />;
}

export function DownloadBadge({ state, onRetry, onDownload, className }: {
  state: Exclude<HereState, 'here'>; onRetry: () => void; onDownload?: () => void; className: string;
}) {
  const t = useT();
  if (state === 'failed') {
    const label = t('assetDrawer.previewRetry');
    return <button type="button" data-library-download={state} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onRetry(); }}
      className={`grid ${className} !bg-[#622824] text-white hover:!bg-[#853630]`}>
      <RotateCw size={13} strokeWidth={2.4} />
    </button>;
  }
  if (state === 'fetching') return (
    <span role="progressbar" aria-label={t('assetDrawer.downloading')} data-library-download={state} className={`grid ${className}`}>
      <LoaderCircle size={14} strokeWidth={2.4} className="animate-spin motion-reduce:animate-none" />
    </span>
  );
  if (onDownload) return (
    <button type="button" aria-label={t('assetDrawer.previewDownloadPlay')} data-library-download={state}
      onClick={(e) => { e.stopPropagation(); onDownload(); }} className={`grid ${className}`}>
      <Download size={12} strokeWidth={2.6} />
    </button>
  );
  return (
    <span role="img" aria-label={t('assetDrawer.previewDownloadPlay')} data-library-download={state}
      className={`grid ${className}`}><Download size={12} strokeWidth={2.6} /></span>
  );
}

function Buttons({ item, kept, addTip, onAdd, onRetry, always, here = 'here' }: {
  item: LibraryItem; kept: boolean; addTip: string; onAdd: () => void; onRetry: () => void; always?: boolean; here?: HereState;
}) {
  const t = useT();
  const show = always ? 'grid' : 'grid invisible group-hover:visible focus-visible:visible';
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <button type="button" aria-label={t(kept ? 'assetDrawer.unstar' : 'assetDrawer.star')} aria-pressed={kept}
        onClick={(e) => { e.stopPropagation(); toggleFavorite(item.id); }}
        className={`${ON_PANEL} ${kept ? 'visible text-[#ffd35a]' : `${show} text-[var(--text)]`}`}>
        <Star size={11} fill={kept ? 'currentColor' : 'none'} strokeWidth={kept ? 0 : 2.2} />
      </button>
      <HereButton here={here} addTip={addTip} onAdd={onAdd} onRetry={onRetry} className={`${ON_PANEL} text-[var(--text)]`} show={show} />
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
function Wave({ item, played, className = 'h-4' }: { item: LibraryItem; played: number; className?: string }) {
  const lit = Math.round(played * 1000) / 10;
  /* Eighty rows may be drawn at once. Their cloud waveforms share the bounded background queue so a click's
     audio request has a free connection, even when none of those pictures is cached yet. */
  const image = useMediaImage(waveUrl(item));
  return (
    <span aria-hidden className={`block w-full ${className}`} style={{
      visibility: image ? 'visible' : 'hidden',
      WebkitMaskImage: image ? `url(${image})` : undefined, maskImage: image ? `url(${image})` : undefined, WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
      background: `linear-gradient(to right, var(--accent) ${lit}%, var(--text-faint) ${lit}%)`,
    }} />
  );
}

/** A cover in the viewer, independent of the transport beneath it. */
export function AudioArtwork({ target, item, voice, name, playing, progress = 0, readLevel }: {
  target: HTMLDivElement;
  item?: LibraryItem;
  voice?: Parameters<typeof voicePalette>[0];
  name: string;
  playing: boolean;
  progress?: number;
  readLevel?: () => number;
}) {
  const t = useT();
  const kind = item?.cat === 'music' ? 'music' : item ? 'sound' : 'voice';
  const cover = useMediaImage(kind === 'music' && item?.cover ? libraryUrl(item.cover) : null, true, 'visible');
  const Mark = kind === 'music' ? Music2 : MARKS[item?.group ?? ''] ?? AudioWaveform;
  const look = item ? (kind === 'music' ? coverLook(item) : soundLook(item)) : undefined;
  const palette = React.useMemo(() => voice ? voicePalette(voice) : null, [voice]);
  const lighting = palette ? { '--voice-glow': palette.spots[1].color } as React.CSSProperties : undefined;
  return createPortal(
    <div className={artwork.surface} style={lighting} data-library-audio-cover={kind} data-playing={playing}>
      <div className={artwork.content}>
        <div className={`${artwork.art} ${kind === 'voice' ? artwork.orb : kind === 'sound' ? artwork.sound : ''}`} style={look} aria-hidden="true">
          {palette ? <VoiceOrbCanvas palette={palette} playing={playing} readLevel={readLevel}><span data-voice-avatar-base="" className={artwork.fallback} style={voicePaletteLook(palette)} /></VoiceOrbCanvas> : cover ? <img src={cover} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
            : <Mark size={48} strokeWidth={1.55} />}
        </div>
        <div className="min-w-0 max-w-full text-center">
          <div className="truncate text-[15px] font-semibold leading-tight">{name}</div>
          <div className="mt-1 text-[11px] text-[var(--text-muted)]">{t(`assetDrawer.cat_${kind}`)}</div>
        </div>
        {item && kind === 'sound' ? <Wave item={item} played={progress} className="h-5" /> : null}
      </div>
    </div>, target,
  );
}

export type LibraryHover = Pick<React.HTMLAttributes<HTMLDivElement>, 'onPointerEnter' | 'onPointerLeave'>;

export function SoundRow({ item, name, group, picked, player, kept, addTip, onPick, onAdd, drag, here }: {
  here?: HereState;
  item: LibraryItem; name: string; group: string; picked: boolean; player: Player; kept: boolean; addTip: string;
  onPick: () => void; onAdd: () => void; drag: React.HTMLAttributes<HTMLDivElement>;
}) {
  const t = useT();
  const mine = player.item?.id === item.id;
  const play = () => { onPick(); player.toggle(item); };
  const downloading = mine && player.downloading;
  return (
    <div
      {...drag}
      draggable
      data-library-audio={item.id}
      data-audio-preview={mine ? player.status : undefined}
      aria-busy={downloading}
      className={`group grid h-[60px] cursor-default select-none grid-cols-[44px_minmax(0,1fr)] items-center gap-3 rounded-lg px-2 ${picked || mine ? 'bg-[var(--bg-field)]' : 'hover:bg-[var(--bg-field)]'}`}
      onClick={(e) => { if (e.detail < 2) play(); }}
      aria-label={name}
    >
      <Tile item={item} playing={mine && (player.playing || player.loading)} loading={downloading} size={44} />
      <span className="flex min-w-0 flex-col justify-center gap-1">
        <span className="flex h-6 min-w-0 items-center gap-2">
          <span className={`truncate text-[12.5px] font-medium ${picked || mine ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{name}</span>
          <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{group}</span>
          <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--text-faint)]">{lengthOf(item.durationMs ?? 0, t)}</span>
          <Buttons item={item} kept={kept} addTip={addTip} onAdd={onAdd} onRetry={play} always={picked} here={downloading ? 'fetching' : here} />
        </span>
        <span className="flex h-4 min-w-0 items-center gap-2">
          <Wave item={item} played={mine && player.duration ? player.time / player.duration : 0} />
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
  const play = () => { onPick(); player.toggle(item); };
  const downloading = mine && player.downloading;
  return (
    <div
      {...drag}
      draggable
      data-library-audio={item.id}
      data-audio-preview={mine ? player.status : undefined}
      aria-busy={downloading}
      className={`group flex h-[92px] cursor-default select-none gap-2.5 rounded-xl p-2 ring-1 ${picked || mine ? 'bg-[var(--bg-field)] ring-[var(--accent)]' : 'bg-[var(--bg-raised)] ring-transparent hover:bg-[var(--bg-field)]'}`}
      onClick={(e) => { if (e.detail < 2) play(); }}
      aria-label={name}
    >
      <Tile item={item} playing={mine && (player.playing || player.loading)} loading={downloading} size={76} cover />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={`line-clamp-2 text-[12.5px] font-medium leading-[17px] ${picked || mine ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`}>{name}</span>
        <span className="mt-0.5 truncate text-[11px] text-[var(--text-faint)]">{group} · {lengthOf(item.durationMs ?? 0, t)}</span>
        <span className="mt-auto flex justify-end"><Buttons item={item} kept={kept} addTip={addTip} onAdd={onAdd} onRetry={play} always here={downloading ? 'fetching' : here} /></span>
      </span>
    </div>
  );
}

/** The room a list keeps at its foot without the player: the composer's, and air. */
export const FOOT_ROOM = 'pb-[calc(var(--drawer-under,0px)+12px)]';

/** The play shortcut belongs to the asset while its controls are in the viewer. */
export function useAssetPlaybackKey(active: boolean, toggle: () => void) {
  const action = React.useRef(toggle);
  action.current = toggle;
  React.useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (event.defaultPrevented || el?.closest?.('[role="dialog"], [role="menu"]') || keyAction(event) !== 'play-pause') return;
      if (el?.closest?.('[data-studio-library]') ? isTextField(el) : isTypingTarget(el)) return;
      if (el?.closest?.('button:focus-visible')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) action.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);
}

/** Sounds, music and voice samples take over the transport under the viewer. */
export function MiniPlayer<T extends Playable>({ target, player, name }: {
  target: HTMLDivElement | null; player: Player<T>; name: string;
}) {
  const t = useT();
  const { item } = player;
  const [dragged, setDragged] = React.useState<number | null>(null);
  React.useEffect(() => { setDragged(null); }, [item?.id, player.loading, player.error]);
  const toggle = () => { if (item) player.toggle(item); };
  useAssetPlaybackKey(Boolean(target && item), toggle);
  if (!item) return null;
  const at = dragged ?? player.time;
  const length = player.duration || (item.durationMs ?? 0) / 1000;
  const say = (sec: number) => (length < 10 ? sec.toFixed(1) : clock(sec));
  const active = player.playing || player.loading;
  const label = t(player.downloading ? 'assetDrawer.previewCancel' : player.error ? 'assetDrawer.previewRetry' : active ? 'assetDrawer.pause' : 'assetDrawer.play');
  const bar = (
    <div className={`${PANE_BAR} gap-2 px-2 text-[11px] tabular-nums text-[var(--text)] ${target ? '' : 'mb-[var(--drawer-under,0px)] border-t border-[var(--border)]'}`} data-audio-player={player.status}>
      <button type="button" className={PANE_BTN} onMouseDown={(e) => e.preventDefault()} onClick={toggle} title={label} aria-label={label}>
        {player.error ? <RotateCw size={PANE_ICON} /> : player.downloading ? <Square size={PANE_ICON - 3} fill="currentColor" />
          : active ? <Pause size={PANE_ICON} fill="currentColor" /> : <Play size={PANE_ICON} fill="currentColor" />}
      </button>
      <span className="min-w-0 max-w-[36%] truncate text-[12px]" title={name}>{name}</span>
      {player.downloading || player.error ? null : <>
        <span className="shrink-0 text-[var(--text-muted)]">{say(at)}</span>
        <Scrub at={Math.min(at, length)} length={length} label={t('assetDrawer.seek')}
          onDrag={setDragged} onLet={(sec) => { player.seek(sec); setDragged(null); }} />
        <span className="shrink-0 text-[var(--text-faint)]">{say(length)}</span>
      </>}
    </div>
  );
  return target ? createPortal(bar, target) : bar;
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
