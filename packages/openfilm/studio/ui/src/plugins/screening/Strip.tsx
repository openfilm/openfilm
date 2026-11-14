/**
 * The film's shape under the picture: a ruler, and a lane each of picture (the shots as a filmstrip), sound (each sound
 * with its waveform) and captions. A click goes there; a drag picks a stretch of that lane to point at; the round
 * button on a shot, a sound or a caption points at it. What the message being written points at is marked, numbered as
 * the chat numbers it, each with its way to take it out; the places the agent changed are lit.
 */
import * as React from 'react';
import { AudioLines, Captions, Clapperboard, Target, X } from 'lucide-react';
import type { Clip } from '@/api';
import { fileStem } from '@/lib/film';
import type { StudioRef } from '@/lib/host';
import { loadWavePeaks } from '@/lib/workspace-resources';
import { Tooltip } from '@/components/Tooltip';
import type { ProjectState } from '@/studio';
import { peaksOfClip, ticksOf, timeLabel, type Clock, type Cue, type Range } from './screening-model';

/** A clip of the film where it plays, and which lane it is in. */
export interface Block { clip: Clip; track: number; at: number; end: number; kind: 'picture' | 'sound' }
export type Lane = 'picture' | 'sound' | 'captions';
/** What the message being written points at, with its number there. */
export interface Mark { n: number; ref: StudioRef }

const LANE_H: Record<Lane, number> = { picture: 46, sound: 30, captions: 22 };
/** How far the pointer moves before a press on a lane is a drag (a stretch), px. */
const DRAG_PX = 4;

export function useClock(source: Clock): number {
  return React.useSyncExternalStore(source.subscribe, source.get, source.get);
}

export function Strip(props: {
  duration: number; clock: Clock; blocks: { picture: Block[]; sound: Block[] }; cues: readonly Cue[]; marks: readonly Mark[];
  changes: readonly Range[]; state: ProjectState;
  words: { picture: string; sound: string; captions: string; laneHint: string; pointShot: string; pointSound: string; pointLine: string; remove: string };
  onSeek: (t: number) => void; onSpan: (lane: Lane, a: number, b: number) => void; onPointBlock: (b: Block) => void; onPointCue: (c: Cue) => void; onRemove: (ref: StudioRef) => void;
}) {
  const { duration, clock, blocks, cues, marks, changes, state, words, onSeek, onSpan, onPointBlock, onPointCue, onRemove } = props;
  const area = React.useRef<HTMLDivElement>(null);
  const [hover, setHover] = React.useState<number | null>(null);
  const [span, setSpan] = React.useState<{ lane: Lane; a: number; b: number } | null>(null);
  const press = React.useRef<{ lane: Lane | 'ruler'; x: number; t: number; moved: boolean } | null>(null);
  const pct = (t: number) => `${duration ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0}%`;
  const width = (a: number, b: number) => `${duration ? Math.max(0, ((Math.min(b, duration) - Math.max(a, 0)) / duration) * 100) : 0}%`;
  const timeAt = (clientX: number) => {
    const r = area.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };
  const lanes: Lane[] = ['picture', ...(blocks.sound.length ? ['sound' as const] : []), ...(cues.length ? ['captions' as const] : [])];
  const { marks: ticks } = React.useMemo(() => ticksOf(duration), [duration]);

  const down = (lane: Lane | 'ruler') => (e: React.PointerEvent) => {
    if (e.button !== 0 || !duration) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = timeAt(e.clientX);
    press.current = { lane, x: e.clientX, t, moved: false };
    if (lane === 'ruler') onSeek(t);
  };
  const move = (e: React.PointerEvent) => {
    if (duration) setHover(timeAt(e.clientX));
    const p = press.current;
    if (!p) return;
    const t = timeAt(e.clientX);
    if (p.lane === 'ruler') { onSeek(t); return; }
    if (!p.moved && Math.abs(e.clientX - p.x) < DRAG_PX) return;
    p.moved = true;
    setSpan({ lane: p.lane, a: p.t, b: t });
  };
  const up = (e: React.PointerEvent) => {
    const p = press.current;
    press.current = null;
    if (!p || p.lane === 'ruler') return;
    if (p.moved && span) { onSpan(span.lane, span.a, span.b); setSpan(null); return; }
    setSpan(null);
    onSeek(timeAt(e.clientX));
  };

  const markOf = (test: (ref: StudioRef) => boolean) => marks.filter((m) => test(m.ref));
  const icons: Record<Lane, React.ReactNode> = { picture: <Clapperboard size={14} />, sound: <AudioLines size={14} />, captions: <Captions size={14} /> };
  const laneWords: Record<Lane, string> = { picture: words.picture, sound: words.sound, captions: words.captions };

  return (
    <div className="shrink-0 select-none border-t border-[color:var(--border)] bg-[var(--bg-panel)] px-3 pb-3 pt-1.5">
      <div className="grid grid-cols-[22px_minmax(0,1fr)] gap-x-2">
        {/* the lanes' marks */}
        <div className="flex flex-col gap-1 pt-[22px] text-[var(--text-faint)]">
          {lanes.map((lane) => (
            <Tooltip key={lane} label={laneWords[lane]}>
              <span className="grid place-items-center" style={{ height: LANE_H[lane] }}>{icons[lane]}</span>
            </Tooltip>
          ))}
        </div>
        <div ref={area} className="relative" onPointerMove={move} onPointerLeave={() => setHover(null)} onPointerUp={up}>
          {/* the ruler: where a click goes, a drag scrubs */}
          <div className="relative mb-1 h-[18px] cursor-pointer" onPointerDown={down('ruler')}>
            {ticks.map((t) => (
              <span key={t} className="absolute bottom-0 top-[9px] border-l border-[color:var(--border-strong)]" style={{ left: pct(t) }}>
                <span className="absolute -top-[10px] left-1 font-mono text-[9.5px] tabular-nums text-[var(--text-faint)]">{timeLabel(t)}</span>
              </span>
            ))}
            {changes.map((c, i) => <span key={i} className="absolute bottom-0 h-[3px] rounded-full bg-[var(--warn)]" style={{ left: pct(c.start), width: width(c.start, c.end) }} />)}
          </div>
          {/* the lanes */}
          <div className="flex flex-col gap-1">
            {lanes.map((lane) => (
              <div key={lane} data-lane={lane} title={words.laneHint} onPointerDown={down(lane)}
                className="relative cursor-pointer overflow-hidden rounded-[5px] bg-[var(--bg-hover)]" style={{ height: LANE_H[lane] }}>
                {lane === 'captions' ? cues.map((c) => {
                  const on = markOf((r) => r.kind === 'subtitle' && Math.abs(r.start - c.start) < 0.01);
                  return (
                    <div key={c.index} className={`group absolute inset-y-[2px] flex items-center overflow-hidden rounded-[4px] border bg-[var(--bg-raised)] px-1.5 text-[10.5px] text-[var(--text-muted)] ${on.length ? 'border-[color:var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[color:var(--border)]'}`}
                      style={{ left: pct(c.start), width: width(c.start, c.end) }} title={c.text}>
                      <span className="truncate">{c.text}</span>
                      <PointButton label={words.pointLine} onPoint={() => onPointCue(c)} tiny />
                    </div>
                  );
                }) : (lane === 'picture' ? blocks.picture : blocks.sound).map((b) => {
                  const on = markOf((r) => r.kind === 'clip' && r.id === b.clip.id);
                  return (
                    <BlockView key={`${b.track}:${b.clip.id}`} block={b} state={state} left={pct(b.at)} width={width(b.at, b.end)} marked={on.length > 0}
                      pointLabel={lane === 'picture' ? words.pointShot : words.pointSound} onPoint={() => onPointBlock(b)} />
                  );
                })}
              </div>
            ))}
          </div>
          {/* over every lane: the changes, the stretches pointed at, the one being dragged, the marks, the playhead */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[22px]">
            {changes.map((c, i) => <span key={i} className="absolute inset-y-0 rounded-[4px] bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--warn)_60%,transparent)]" style={{ left: pct(c.start), width: width(c.start, c.end) }} />)}
            {marks.map((m) => (m.ref.kind === 'range' ? <span key={m.n} className="absolute inset-y-0 rounded-[4px] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] ring-1 ring-inset ring-[var(--accent)]" style={{ left: pct(m.ref.start), width: width(m.ref.start, m.ref.end) }} /> : null))}
            {span ? (
              <span className="absolute rounded-[4px] bg-[color-mix(in_srgb,var(--accent)_30%,transparent)] ring-1 ring-inset ring-[var(--accent)]"
                style={{ left: pct(Math.min(span.a, span.b)), width: width(Math.min(span.a, span.b), Math.max(span.a, span.b)), top: laneTop(lanes, span.lane), height: LANE_H[span.lane] }} />
            ) : null}
            {marks.map((m) => (m.ref.kind === 'time' || m.ref.kind === 'region' ? <span key={m.n} className="absolute inset-y-0 w-px -translate-x-1/2 bg-[var(--accent)]" style={{ left: pct(m.ref.time) }} /> : null))}
          </div>
          {/* the marks' numbers on the ruler, each turning into its × */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-30 h-[18px]">
            {marks.map((m) => {
              const at = markTime(m.ref);
              return at == null ? null : (
                <span key={m.n} className="pointer-events-auto absolute top-0 -translate-x-1/2" style={{ left: pct(at) }}>
                  <MarkBadge n={m.n} label={words.remove} onRemove={() => onRemove(m.ref)} />
                </span>
              );
            })}
          </div>
          {hover != null && !press.current ? <HoverLine t={hover} left={pct(hover)} poster={posterAt(blocks.picture, hover, state)} /> : null}
          <Playhead clock={clock} duration={duration} />
        </div>
      </div>
    </div>
  );
}

/** The picture of the shot on top at `t`, for the hover's preview. */
function posterAt(picture: readonly Block[], t: number, state: ProjectState): string | undefined {
  for (let i = picture.length - 1; i >= 0; i--) {
    const b = picture[i]!;
    if (t >= b.at && t < b.end) return posterOf(b, state);
  }
  return undefined;
}

function posterOf(b: Block, state: ProjectState): string | undefined {
  const path = b.clip.src.split('#')[0]!;
  const file = state.files.find((f) => f.path === path);
  if (!file || b.kind !== 'picture') return undefined;
  return file.kind === 'image' ? state.sources.file(file) : /\.html?$/i.test(path) ? state.sources.pagePoster?.(file) : state.sources.poster?.(file);
}

/** Under the pointer: a line, the time, and above it the shot there. */
function HoverLine({ t, left, poster }: { t: number; left: string; poster: string | undefined }) {
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-[color-mix(in_srgb,var(--text)_55%,transparent)]" style={{ left }}>
      <div className="absolute bottom-full left-1/2 mb-2 flex -translate-x-1/2 flex-col items-center gap-1">
        {poster ? <span className="block h-[54px] w-[96px] rounded-md bg-cover bg-center shadow-[0_6px_18px_rgb(0_0_0/.45)] ring-1 ring-white/15" style={{ backgroundImage: `url("${poster}")` }} /> : null}
        <span className="rounded bg-[var(--bg-raised)] px-1.5 py-px font-mono text-[10.5px] tabular-nums text-[var(--text)] shadow ring-1 ring-[var(--border-strong)]">{timeLabel(t)}</span>
      </div>
    </div>
  );
}

/** Where a mark is on the ruler: a moment, a box's moment, a stretch's start, a clip's or a line's start. */
function markTime(ref: StudioRef): number | null {
  switch (ref.kind) {
    case 'time': case 'region': return ref.time;
    case 'range': return ref.start;
    case 'clip': return ref.start;
    case 'subtitle': return ref.start;
    default: return null;
  }
}

const laneTop = (lanes: readonly Lane[], lane: Lane) => lanes.slice(0, lanes.indexOf(lane)).reduce((y, l) => y + LANE_H[l] + 4, 0);

function Playhead({ clock, duration }: { clock: Clock; duration: number }) {
  const t = useClock(clock);
  const left = `${duration ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0}%`;
  return (
    <div className="pointer-events-none absolute bottom-0 top-[4px] z-20 -translate-x-1/2" style={{ left }}>
      <span className="absolute left-1/2 top-0 h-[10px] w-[10px] -translate-x-1/2 rounded-[3px] bg-[var(--tl-playhead)]" />
      <span className="absolute bottom-0 left-1/2 top-[6px] w-[2px] -translate-x-1/2 bg-[var(--tl-playhead)]" />
    </div>
  );
}

/** A number of what the message points at; under the pointer it is the way to take it out. */
export function MarkBadge({ n, label, onRemove, className = '' }: { n: number; label: string; onRemove: () => void; className?: string }) {
  return (
    <button type="button" aria-label={`${label} ${n}`} title={label} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onRemove(); }}
      className={`group/badge grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[var(--accent)] px-1 text-[10.5px] font-semibold leading-none text-[var(--on-accent)] shadow-[0_1px_4px_rgb(0_0_0/.35)] transition hover:bg-[var(--err)] ${className}`}>
      <span className="group-hover/badge:hidden">{n}</span>
      <X size={11} strokeWidth={2.6} className="hidden group-hover/badge:block" />
    </button>
  );
}

/** The round button on a shot, a sound or a line that points at it. */
function PointButton({ label, onPoint, tiny = false }: { label: string; onPoint: () => void; tiny?: boolean }) {
  return (
    <Tooltip label={label}>
      <button type="button" aria-label={label} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onPoint(); }}
        className={`absolute right-1 top-1/2 grid -translate-y-1/2 place-items-center rounded-full bg-black/65 text-white opacity-0 transition hover:bg-[var(--accent)] group-hover:opacity-100 ${tiny ? 'h-4 w-4' : 'h-6 w-6'}`}>
        <Target size={tiny ? 10 : 13} />
      </button>
    </Tooltip>
  );
}

/** A shot as a filmstrip of its picture, or a sound as its waveform. */
function BlockView({ block, state, left, width, marked, pointLabel, onPoint }: {
  block: Block; state: ProjectState; left: string; width: string; marked: boolean; pointLabel: string; onPoint: () => void;
}) {
  const file = state.files.find((f) => f.path === block.clip.src.split('#')[0]);
  const poster = posterOf(block, state);
  return (
    <div className={`group absolute inset-y-0 overflow-hidden rounded-[4px] ${marked ? 'z-[1] ring-2 ring-inset ring-[var(--accent)]' : 'ring-1 ring-inset ring-black/25'} ${block.kind === 'sound' ? 'bg-[color-mix(in_srgb,var(--clip-audio)_22%,var(--bg-panel))]' : 'bg-[color-mix(in_srgb,var(--clip-video)_25%,var(--bg-panel))]'}`}
      style={{ left, width: `max(3px, ${width})`, ...(poster ? { backgroundImage: `url("${poster}")`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' } : {}) }}
      title={fileStem(block.clip.src)}>
      {block.kind === 'sound' && file ? <Wave url={state.sources.wave(file)} clip={block.clip} seconds={block.end - block.at} fileSeconds={(file.durationMs ?? 0) / 1000} /> : null}
      <PointButton label={pointLabel} onPoint={onPoint} />
    </div>
  );
}

/** A sound clip's waveform, from the part of its file it plays. */
function Wave({ url, clip, seconds, fileSeconds }: { url: string; clip: Clip; seconds: number; fileSeconds: number }) {
  const [peaks, setPeaks] = React.useState<number[] | null>(null);
  React.useEffect(() => {
    let live = true;
    void loadWavePeaks(url, true).then((p) => { if (live) setPeaks(p); });
    return () => { live = false; };
  }, [url]);
  const part = React.useMemo(() => (peaks ? peaksOfClip(peaks, fileSeconds || seconds, clip.time?.[0] ?? 0, seconds, clip.speed ?? 1) : []), [peaks, fileSeconds, seconds, clip]);
  if (!part.length) return null;
  const n = part.length;
  const d = part.map((p, i) => `M${(i / n) * 100} ${50 - p * 46}V${50 + p * 46}`).join('');
  return (
    <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      <path d={d} stroke="var(--clip-audio)" strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.9} />
    </svg>
  );
}
