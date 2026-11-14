/**
 * The screening room, as the element its plugin brings (plugins/screening): the film as it will be exported, played
 * large, and plain tools to point at what to change (this moment, a part of the picture, a stretch, a shot, a sound,
 * a caption, the whole film), each a reference put in the app's chat for the person to say what they want there. A
 * strip under the picture shows the film's shots, sounds and captions in order, to see its shape and to point; nothing
 * here edits the film. When the film changes (the agent's work), the changes are counted and can be watched one after
 * another. It reaches Studio only through its public interface (`openfilm/studio`), as any plugin's element does,
 * and plays the film with the page's own player, so what is seen and heard is what is exported.
 */
import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Pause, Play } from 'lucide-react';
import { addPluginWords, useT } from '@/i18n';
import { projectEvents, type Clip, type Film } from '@/api';
import { Player } from '@/editor/player';
import { Preview, type FilmInfo, type PreviewHandle } from '@/editor/Preview';
import { fileStem, filmClipKind } from '@/lib/film';
import type { ClipSpan } from '@/lib/film-shape';
import type { StageBox, StudioRef } from '@/lib/host';
import { momentRef, REGION_MIN_PX, regionRef } from '@/lib/studio-refs';
import { chat, onCommand, project, toast, type ProjectState } from '@/studio';
import { useProject, useProvide } from '@/studio/react';
import { changedRanges, cuesOf, linkOf, timeLabel, type Cue, type Range } from './screening-model';

addPluginWords('screening', import.meta.glob('../../../../../plugins/screening/i18n/*.json', { eager: true, import: 'default' }));

/** The plugin's words: `w('empty')`, with `{name}` filled from `values`. */
function useWords() {
  const t = useT();
  return React.useCallback((key: string, values: Record<string, string | number> = {}) => (
    Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), t(`plugin.screening.${key}`))
  ), [t]);
}

/** What the person is pointing with: none (the player as it is), or a tool waiting for its gesture. */
type Tool = null | 'box' | 'range' | 'shot' | 'sound' | 'line';
/** How far a key steps the film, seconds. */
const STEP_S = 5;
/** Before each change watched, this much of what comes before it, seconds. */
const LEAD_S = 1;
const STAGE = { w: 1920, h: 1080 };

/** A block of the strip: a clip of the film where it plays, and what it is. */
interface Block { clip: Clip; track: number; at: number; end: number; kind: 'picture' | 'sound' }

/** The film's shots, sounds and captions, where they play (the player's spans; a clip not placed yet is left out). */
function stripOf(film: Film | null, spans: readonly ClipSpan[]): { picture: Block[]; sound: Block[] } {
  const placed = new Map(spans.map((s) => [s.id, s]));
  const picture: Block[] = [], sound: Block[] = [];
  /* the top track (0) drawn last, over those under it */
  (film?.tracks ?? []).forEach((track, i) => {
    if (track.hidden) return;
    for (const clip of track.clips) {
      const span = placed.get(clip.id);
      if (!span || clip.disabled) continue;
      const block: Block = { clip, track: i, at: span.at, end: span.end, kind: filmClipKind(clip) === 'audio' ? 'sound' : 'picture' };
      (block.kind === 'sound' ? sound : picture).push(block);
    }
  });
  picture.sort((a, b) => b.track - a.track);
  return { picture, sound };
}

function Screening({ projectId }: { projectId: string }) {
  const w = useWords();
  const state = useProject(projectId);
  const [film, setFilm] = React.useState<Film | null>(null);
  const [unread, setUnread] = React.useState(false);
  /* the film as it was when the person last looked: what changed since is counted */
  const baseline = React.useRef<Film | null>(null);
  const [info, setInfo] = React.useState<FilmInfo | null>(null);
  const [timeMs, setTimeMs] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [tool, setTool] = React.useState<Tool>(null);
  const [cues, setCues] = React.useState<Cue[]>([]);
  /* what the message being written points at, numbered as the chat numbers it */
  const [draft, setDraft] = React.useState<StudioRef[]>([]);
  const [watching, setWatching] = React.useState<{ ranges: Range[]; i: number } | null>(null);
  const [dropping, setDropping] = React.useState(false);
  const preview = React.useRef<PreviewHandle>(null);
  const player = React.useRef<Player | null>(null);
  player.current ??= new Player();
  const shown = state?.shown === 'screening';
  const folder = state?.film ?? null;
  const stage = film?.stage ?? STAGE;
  const duration = info?.duration ?? 0;

  /* ── the film, read now and each time film.html changes ── */
  const read = React.useCallback(async () => {
    try {
      const got = await project(projectId).film.read();
      if (!got.value) { setUnread(!got.missing); return; }
      setUnread(false);
      setFilm(got.value as Film);
      baseline.current ??= got.value as Film;
    } catch { setUnread(true); }
  }, [projectId]);
  React.useEffect(() => { void read(); return projectEvents(projectId, (e) => { if (e.type === 'film') void read(); }); }, [projectId, read]);

  /* ── the player: the page's own, so what is heard and seen is what is exported ── */
  React.useEffect(() => {
    const p = player.current!;
    p.onAnchor = (anchor) => preview.current?.play?.(anchor);
    return () => { p.onAnchor = null; p.close(); };
  }, []);
  React.useEffect(() => { if (film) preview.current?.update(film as never); }, [film, folder]);
  const onInfo = React.useCallback((next: FilmInfo) => {
    setInfo(next);
    if (folder) player.current!.load(new URL(folder).origin, next.sounds, next.duration);
    if (!player.current!.playing) preview.current?.seek(player.current!.time());
  }, [folder]);
  const seek = React.useCallback((t: number) => {
    const p = player.current!;
    const at = Math.max(0, Math.min(t, p.duration || t));
    p.seek(at);
    if (!p.playing) preview.current?.seek(at);
    setTimeMs(at * 1000);
  }, []);
  const pause = React.useCallback(() => {
    const p = player.current!;
    if (!p.playing) return;
    p.pause();
    preview.current?.seek(p.time());
    setPlaying(false);
    setTimeMs(p.time() * 1000);
  }, []);
  const play = React.useCallback(() => {
    const p = player.current!;
    if (p.playing || !p.duration) return;
    if (p.time() >= p.duration - 0.05) seek(0);
    void p.play();
    setPlaying(true);
  }, [seek]);
  /* while it plays: the time shown, the end, and the next change watched */
  const watchingRef = React.useRef(watching);
  watchingRef.current = watching;
  React.useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const p = player.current!;
      const t = p.time();
      setTimeMs(t * 1000);
      const now = watchingRef.current;
      if (now) {
        const range = now.ranges[now.i]!;
        if (t >= range.end + 0.3) {
          const next = now.i + 1;
          if (next < now.ranges.length) { setWatching({ ...now, i: next }); seek(Math.max(0, now.ranges[next]!.start - LEAD_S)); }
          else { pause(); setWatching(null); return; }
        }
      }
      if (!p.playing || t >= p.duration - 1e-3) { pause(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, pause, seek]);
  /* another workbench shown: the film stops */
  React.useEffect(() => { if (!shown) pause(); }, [shown, pause]);

  /* ── captions: each caption track's lines ── */
  React.useEffect(() => {
    if (!film || !folder) { setCues([]); return; }
    let live = true;
    const tracks = film.tracks.flatMap((track) => (track.captions && !track.hidden ? [track.captions.src] : []));
    void Promise.all(tracks.map((src) => fetch(new URL(src, folder)).then((r) => (r.ok ? r.text() : '')).catch(() => '')))
      .then((texts) => { if (live) setCues(texts.flatMap((text) => cuesOf(text))); });
    return () => { live = false; };
  }, [film, folder]);

  /* ── what the chat's message points at, numbered ── */
  React.useEffect(() => onCommand((command) => {
    if (command.type === 'draft-refs') setDraft(command.refs);
  }), []);
  /* a link to a moment or a stretch of the film, opened here */
  useProvide('screening', {
    show: (link) => {
      const m = /#t=([\d.]+)/.exec(link);
      if (m) { pause(); seek(Number(m[1])); }
    },
  });

  /* ── pointing: a reference in the chat (opened if folded), or, with no chat, a link copied for the person's agent ── */
  const refer = React.useCallback((ref: StudioRef) => {
    setTool(null);
    if (chat.refer) {
      chat.refer(ref);
      if (state?.chat && !state.chat.open) state.chat.toggle();
      baseline.current = film;
      return;
    }
    const link = linkOf(ref);
    void navigator.clipboard?.writeText(link).catch(() => {});
    toast(w('copied', { link }));
  }, [state?.chat, film, w]);
  const blocks = React.useMemo(() => stripOf(film, info?.spans ?? []), [film, info]);
  const pictureAt = React.useCallback((t: number) => blocks.picture.filter((b) => t >= b.at && t < b.end).map((b) => b.clip.id), [blocks]);
  const pointMoment = () => { pause(); const t = player.current!.time(); refer(momentRef(projectId, t * 1000)); };
  const pointWhole = () => refer({ kind: 'range', start: 0, end: duration, clipIds: [...blocks.picture, ...blocks.sound].map((b) => b.clip.id) });
  const pointBlock = (b: Block) => {
    const file = state?.files.find((f) => f.path === b.clip.src.split('#')[0]);
    const poster = file && b.kind === 'picture' ? (state?.sources.poster?.(file) ?? (file.kind === 'image' ? state?.sources.file(file) : undefined)) : undefined;
    refer({ kind: 'clip', id: b.clip.id, loc: null, label: fileStem(b.clip.src), clipKind: filmClipKind(b.clip), src: b.clip.src, start: b.at, end: b.end, track: b.track, ...(poster ? { image: { src: poster } } : {}) });
  };
  const pointCue = (cue: Cue) => refer({ kind: 'subtitle', start: cue.start, end: cue.end, text: cue.text, index: cue.index });
  const pointRange = (a: number, b: number) => {
    const [start, end] = a < b ? [a, b] : [b, a];
    if (end - start < 0.05) return;
    refer({ kind: 'range', start, end, clipIds: [...blocks.picture, ...blocks.sound].filter((x) => x.end > start && x.at < end).map((x) => x.clip.id) });
  };

  /* ── keys, while this workbench is shown: Space, ← →, Esc ── */
  React.useEffect(() => {
    if (!shown) return;
    const press = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || el?.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      if (e.key === ' ') { e.preventDefault(); if (player.current!.playing) pause(); else play(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seek(player.current!.time() + (e.key === 'ArrowLeft' ? -STEP_S : STEP_S)); }
      else if (e.key === 'Escape' && tool) { e.preventDefault(); setTool(null); }
    };
    window.addEventListener('keydown', press, true);
    return () => window.removeEventListener('keydown', press, true);
  }, [shown, tool, pause, play, seek]);

  /* ── what changed since the person last looked ── */
  const changes = React.useMemo(() => changedRanges(baseline.current, film, info?.spans ?? []), [film, info]);
  const watchChanges = () => {
    if (!changes.length) return;
    setWatching({ ranges: changes, i: 0 });
    seek(Math.max(0, changes[0]!.start - LEAD_S));
    play();
  };
  const closeChanges = () => { baseline.current = film; setWatching(null); setTimeMs((t) => t + 0); };

  /* ── files dropped: into the project, and pointed at ── */
  const drop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropping(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    toast(w('importing'));
    try {
      const paths = await project(projectId).importFiles(files, { into: 'assets' });
      for (const path of paths) {
        const kind = /\.(mp4|mov|m4v|webm|mkv)$/i.test(path) ? 'video' : /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(path) ? 'audio' : 'image';
        refer({ kind: 'file', path, fileKind: kind });
      }
    } catch (error) { toast(error instanceof Error ? error.message : String(error), { error: true }); }
  };

  if (!state || !folder) return <div className="h-full bg-[var(--bg-panel)]" />;
  const empty = film != null && !blocks.picture.length && !blocks.sound.length;
  const hint = tool === 'box' ? w('boxHint') : tool === 'range' ? w('rangeHint') : tool === 'shot' ? w('shotHint') : tool === 'sound' ? w('soundHint') : tool === 'line' ? w('lineHint') : null;
  return (
    <div data-screening="" className="relative flex h-full min-h-0 w-full flex-col bg-[var(--bg-panel)] text-[var(--text)]"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
      onDrop={(e) => { void drop(e); }}>
      <Picture stage={stage} folder={folder} preview={preview} player={player} onInfo={onInfo} tool={tool}
        draft={draft} timeMs={timeMs} playing={playing} empty={empty} emptyText={state.chat ? w('empty') : w('emptyBrowser')}
        unread={unread ? w('notRead') : null} hintText={w('pictureHint')}
        over={<>
        {hint ? (
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg bg-[var(--accent)] px-4 py-2 text-[13px] font-medium text-[var(--on-accent)] shadow-lg">
            <span className="flex-1">{hint}</span>
            <button type="button" onClick={() => setTool(null)} className="rounded px-2 py-0.5 hover:bg-white/15">{w('cancel')} · Esc</button>
          </div>
        ) : null}
        {changes.length && !empty ? (
          <div className="pointer-events-auto flex items-center gap-3 rounded-lg border border-[color:var(--border-strong)] bg-[var(--bg-raised)] px-4 py-2 text-[13px] shadow-lg">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--warn)]" /><span className="flex-1 font-medium">{watching ? w('changeOf', { i: watching.i + 1, n: watching.ranges.length }) : changes.length === 1 ? w('changed1') : w('changed', { n: changes.length })}</span>
            <button type="button" onClick={watchChanges} className="rounded px-2 py-0.5 font-medium hover:bg-[var(--bg-hover)]">{w('watchChanges')} ▸</button>
            <button type="button" onClick={closeChanges} className="rounded px-2 py-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)]">{w('close')}</button>
          </div>
        ) : null}
        </>}
        onClick={() => { if (tool === 'box') return; if (player.current!.playing) pause(); else play(); }}
        onBox={(box) => { pause(); refer(regionRef(projectId, player.current!.time() * 1000, box, { clipIds: pictureAt(player.current!.time()), texts: [] }, stage)); }} />
      {/* the player's bar and the pointing tools */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-t border-[color:var(--border)] px-4 py-2.5">
        <button type="button" aria-label={playing ? w('pause') : w('play')} title={playing ? w('pause') : w('play')}
          onClick={() => (playing ? pause() : play())}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)]">
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
        </button>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-[var(--text-muted)]">{timeLabel(timeMs / 1000)} / {timeLabel(duration)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={w('point')}>
          <span className="mr-1 text-[12px] font-medium text-[var(--text-muted)]">{w('point')}</span>
          <ToolButton label={w('moment')} onClick={pointMoment} />
          <ToolButton label={w('box')} on={tool === 'box'} onClick={() => setTool(tool === 'box' ? null : 'box')} />
          <ToolButton label={w('range')} on={tool === 'range'} onClick={() => setTool(tool === 'range' ? null : 'range')} />
          <ToolButton label={w('shot')} on={tool === 'shot'} onClick={() => setTool(tool === 'shot' ? null : 'shot')} />
          {blocks.sound.length ? <ToolButton label={w('sound')} on={tool === 'sound'} onClick={() => setTool(tool === 'sound' ? null : 'sound')} /> : null}
          {cues.length ? <ToolButton label={w('line')} on={tool === 'line'} onClick={() => setTool(tool === 'line' ? null : 'line')} /> : null}
          <ToolButton label={w('whole')} onClick={pointWhole} />
        </div>
      </div>
      <Strip duration={duration} timeMs={timeMs} blocks={blocks} cues={cues} tool={tool} draft={draft} changes={changes} state={state}
        rowWords={{ picture: w('rowPicture'), sound: w('rowSound'), captions: w('rowCaptions') }}
        onSeek={(t) => { seek(t); }} onRange={pointRange} onBlock={(b) => { if (tool === 'shot' || tool === 'sound') pointBlock(b); else seek(b.at); }}
        onCue={(c) => { if (tool === 'line') pointCue(c); else seek(c.start); }} />
      {dropping ? (
        <div className="pointer-events-none absolute inset-3 grid place-items-center rounded-xl border-2 border-dashed border-[color:var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[15px] font-medium text-[var(--accent)]">
          {w('dropHere')}
        </div>
      ) : null}
    </div>
  );
}

function ToolButton({ label, on = false, onClick }: { label: string; on?: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`h-7 rounded-full border px-3 text-[12.5px] font-medium transition ${on ? 'border-[color:var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]' : 'border-[color:var(--border-strong)] text-[var(--text)] hover:border-[color:var(--accent)] hover:text-[var(--accent)]'}`}>
      {label}
    </button>
  );
}

/** The picture, as large as fits: the film played by the page's player, and boxes drawn on it to point at a part. */
function Picture({ stage, folder, preview, player, onInfo, tool, draft, timeMs, playing, empty, emptyText, unread, hintText, over, onClick, onBox }: {
  stage: { w: number; h: number }; folder: string; preview: React.RefObject<PreviewHandle | null>; player: React.RefObject<Player | null>;
  onInfo: (info: FilmInfo) => void; tool: Tool; draft: readonly StudioRef[]; timeMs: number; playing: boolean; empty: boolean; emptyText: string;
  unread: string | null; hintText: string; over: React.ReactNode; onClick: () => void; onBox: (box: StageBox) => void;
}) {
  const room = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    const el = room.current;
    if (!el) return;
    const fit = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const k = Math.max(0, Math.min((size.w - 32) / stage.w, (size.h - 32) / stage.h));
  const box = { w: stage.w * k, h: stage.h * k };
  const [drag, setDrag] = React.useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const at = (e: React.PointerEvent) => { const r = e.currentTarget.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const marks = draft.flatMap((ref, i) => (ref.kind === 'region' && Math.abs(ref.time * 1000 - timeMs) < 60 ? [{ n: i + 1, box: ref.box }] : []));
  return (
    <div ref={room} className="relative grid min-h-0 flex-1 place-items-center overflow-hidden bg-[var(--bg-viewer)]">
      {(
        <div className="relative" style={{ width: box.w, height: box.h }}>
          <Preview ref={preview} folder={folder} stage={stage} time={() => (player.current?.time() ?? 0)} onInfo={onInfo} />
          {/* pointing on the picture: a click plays or pauses, a drag (or a drag with the box tool) circles a part */}
          <div data-capture-hide="" className={`group absolute inset-0 ${tool === 'box' ? 'cursor-crosshair' : 'cursor-pointer'}`}
            onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); const p = at(e); setDrag({ x1: p.x, y1: p.y, x2: p.x, y2: p.y }); }}
            onPointerMove={(e) => { if (!drag) return; const p = at(e); setDrag({ ...drag, x2: p.x, y2: p.y }); }}
            onPointerUp={() => {
              if (!drag) return;
              const d = drag;
              setDrag(null);
              const big = Math.abs(d.x2 - d.x1) >= REGION_MIN_PX && Math.abs(d.y2 - d.y1) >= REGION_MIN_PX;
              if (!big) { onClick(); return; }
              const x = Math.max(0, Math.min(d.x1, d.x2)) / k, y = Math.max(0, Math.min(d.y1, d.y2)) / k;
              onBox({ x: Math.round(x), y: Math.round(y), w: Math.round(Math.min(stage.w - x, Math.abs(d.x2 - d.x1) / k)), h: Math.round(Math.min(stage.h - y, Math.abs(d.y2 - d.y1) / k)) });
            }}>
            {!playing && !empty && !tool ? (
              <span className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-3 py-1 text-[12px] text-white opacity-0 transition group-hover:opacity-100">{hintText}</span>
            ) : null}
            {drag ? <span className="absolute rounded-sm border-2 border-[color:var(--accent)] bg-[color-mix(in_srgb,var(--accent)_15%,transparent)]"
              style={{ left: Math.min(drag.x1, drag.x2), top: Math.min(drag.y1, drag.y2), width: Math.abs(drag.x2 - drag.x1), height: Math.abs(drag.y2 - drag.y1) }} /> : null}
            {marks.map((m) => (
              <span key={m.n} className="absolute rounded-sm border-2 border-[color:var(--accent)]" style={{ left: m.box.x * k, top: m.box.y * k, width: m.box.w * k, height: m.box.h * k }}>
                <Badge n={m.n} className="-left-2.5 -top-2.5" />
              </span>
            ))}
          </div>
          {empty || unread ? (
            <div className="pointer-events-none absolute inset-0 grid place-items-center p-8 text-center text-[16px] leading-relaxed text-white/80">{unread ?? emptyText}</div>
          ) : null}
        </div>
      )}
      {/* what is said over the picture (a tool's hint, the changes): over it, so the picture keeps its size */}
      <div className="pointer-events-none absolute inset-x-0 top-3 z-10 flex flex-col items-center gap-2 px-4">{over}</div>
    </div>
  );
}

function Badge({ n, className = '' }: { n: number; className?: string }) {
  return <span className={`absolute grid h-5 w-5 place-items-center rounded-full bg-[var(--accent)] text-[11px] font-semibold text-[var(--on-accent)] ${className}`}>{n}</span>;
}

/**
 * The film's shape, under the picture: a ruler (a click goes there; with the stretch tool, a drag points at a stretch)
 * and a row each of shots, sounds and captions. A click on one goes to it; with its tool, points at it.
 */
function Strip({ duration, timeMs, blocks, cues, tool, draft, changes, state, rowWords, onSeek, onRange, onBlock, onCue }: {
  duration: number; timeMs: number; blocks: { picture: Block[]; sound: Block[] }; cues: readonly Cue[]; tool: Tool; draft: readonly StudioRef[];
  changes: readonly Range[]; state: ProjectState; rowWords: { picture: string; sound: string; captions: string };
  onSeek: (t: number) => void; onRange: (a: number, b: number) => void; onBlock: (b: Block) => void; onCue: (c: Cue) => void;
}) {
  const ruler = React.useRef<HTMLDivElement>(null);
  const [span, setSpan] = React.useState<{ a: number; b: number } | null>(null);
  const [scrubbing, setScrubbing] = React.useState(false);
  const pct = (t: number) => `${duration ? Math.max(0, Math.min(100, (t / duration) * 100)) : 0}%`;
  const timeAt = (clientX: number) => {
    const r = ruler.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };
  const posterOf = (b: Block) => {
    const file = state.files.find((f) => f.path === b.clip.src.split('#')[0]);
    if (!file) return undefined;
    return file.kind === 'image' ? state.sources.file(file) : /\.html?$/i.test(file.path) ? state.sources.pagePoster?.(file) : state.sources.poster?.(file);
  };
  const numberOf = (test: (ref: StudioRef) => boolean) => draft.flatMap((ref, i) => (test(ref) ? [i + 1] : []));
  const timeMarks: Array<{ n: number; t: number; end?: number }> = draft.flatMap((ref, i) => (ref.kind === 'time' || ref.kind === 'region' ? [{ n: i + 1, t: ref.time }] : ref.kind === 'range' ? [{ n: i + 1, t: ref.start, end: ref.end }] : []));
  const pick = tool === 'shot' || tool === 'sound' || tool === 'line';
  const rows: Array<{ id: 'picture' | 'sound' | 'captions'; label: string; h: number }> = [
    { id: 'picture', label: rowWords.picture, h: 44 },
    ...(blocks.sound.length ? [{ id: 'sound' as const, label: rowWords.sound, h: 22 }] : []),
    ...(cues.length ? [{ id: 'captions' as const, label: rowWords.captions, h: 22 }] : []),
  ];
  return (
    <div className="shrink-0 select-none border-t border-[color:var(--border)] px-4 pb-3 pt-2">
      <div className="flex gap-2">
        <div className="flex w-12 shrink-0 flex-col gap-1 pt-[18px] text-[11px] text-[var(--text-muted)]">
          {rows.map((r) => <span key={r.id} className="flex items-center" style={{ height: r.h }}>{r.label}</span>)}
        </div>
        <div className="relative min-w-0 flex-1">
          {/* the ruler: a click goes there, a drag scrubs (with the stretch tool, points at the stretch) */}
          <div ref={ruler} className={`relative mb-1 h-[14px] rounded-sm ${tool === 'range' ? 'cursor-col-resize bg-[color-mix(in_srgb,var(--accent)_18%,transparent)]' : 'cursor-pointer bg-[var(--bg-hover)]'}`}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const t = timeAt(e.clientX);
              if (tool === 'range') setSpan({ a: t, b: t }); else { setScrubbing(true); onSeek(t); }
            }}
            onPointerMove={(e) => { const t = timeAt(e.clientX); if (span) setSpan({ ...span, b: t }); else if (scrubbing) onSeek(t); }}
            onPointerUp={() => { if (span) { onRange(span.a, span.b); setSpan(null); } setScrubbing(false); }}>
            {timeMarks.map((m) => (m.end != null
              ? <span key={`s${m.n}`} className="absolute inset-y-0 bg-[color-mix(in_srgb,var(--accent)_35%,transparent)]" style={{ left: pct(m.t), width: `calc(${pct(m.end)} - ${pct(m.t)})` }} />
              : null))}
            {timeMarks.map((m) => (
              <span key={m.n} className="absolute top-0" style={{ left: pct(m.t) }}><Badge n={m.n} className="-top-[3px] -translate-x-1/2 scale-[.8]" /></span>
            ))}
          </div>
          {/* the stretch being dragged with the stretch tool, and the changes, over every row */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 top-[18px] z-10">
            {changes.map((c, i) => <span key={i} className="absolute inset-y-0 rounded-sm border-2 border-[color:var(--warn)]" style={{ left: pct(c.start), width: `calc(${pct(c.end)} - ${pct(c.start)})` }} />)}
            {span ? <span className="absolute inset-y-0 bg-[color-mix(in_srgb,var(--accent)_30%,transparent)]" style={{ left: pct(Math.min(span.a, span.b)), width: `calc(${pct(Math.max(span.a, span.b))} - ${pct(Math.min(span.a, span.b))})` }} /> : null}
          </div>
          <div className="flex flex-col gap-1">
            {rows.map((r) => (
              <div key={r.id} className="relative overflow-hidden rounded-sm bg-[var(--bg-hover)]" style={{ height: r.h }}>
                {r.id === 'captions' ? cues.map((c) => {
                  const n = numberOf((ref) => ref.kind === 'subtitle' && Math.abs(ref.start - c.start) < 0.01);
                  return (
                    <button key={c.index} type="button" title={c.text} onClick={() => onCue(c)}
                      className={`absolute inset-y-0 truncate rounded-sm border px-1 text-left text-[10.5px] ${tool === 'line' ? 'border-[color:var(--accent)] bg-[color-mix(in_srgb,var(--accent)_20%,transparent)]' : 'border-[color:var(--border-strong)] bg-[var(--bg-panel)]'}`}
                      style={{ left: pct(c.start), width: `calc(${pct(c.end)} - ${pct(c.start)})` }}>
                      {c.text}{n.map((x) => <Badge key={x} n={x} className="right-0.5 top-0.5 scale-75" />)}
                    </button>
                  );
                }) : (r.id === 'picture' ? blocks.picture : blocks.sound).map((b) => {
                  const poster = r.id === 'picture' ? posterOf(b) : undefined;
                  const n = numberOf((ref) => ref.kind === 'clip' && ref.id === b.clip.id);
                  const live = (tool === 'shot' && b.kind === 'picture') || (tool === 'sound' && b.kind === 'sound');
                  return (
                    <button key={`${b.track}:${b.clip.id}`} type="button" title={fileStem(b.clip.src)} onClick={() => onBlock(b)}
                      className={`absolute inset-y-0 overflow-hidden rounded-sm border bg-cover bg-center ${live ? 'border-[color:var(--accent)] ring-2 ring-[var(--accent)]' : pick ? 'border-[color:var(--border)] opacity-60' : 'border-black/30'} ${b.kind === 'sound' ? 'bg-[color-mix(in_srgb,var(--clip-audio)_35%,var(--bg-panel))]' : 'bg-[var(--bg-panel)]'}`}
                      style={{ left: pct(b.at), width: `max(3px, calc(${pct(b.end)} - ${pct(b.at)}))`, ...(poster ? { backgroundImage: `url("${poster}")` } : {}) }}>
                      {b.kind === 'sound' && duration && (b.end - b.at) / duration > 0.05 ? <span className="block truncate px-1 text-left text-[10.5px] leading-[20px]">{fileStem(b.clip.src)}</span> : null}
                      {n.map((x) => <Badge key={x} n={x} className="right-0.5 top-0.5" />)}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          {/* the playhead */}
          <span className="pointer-events-none absolute bottom-0 top-0 z-20 w-0.5 -translate-x-1/2 bg-[var(--tl-playhead)]" style={{ left: pct(timeMs / 1000) }} />
        </div>
      </div>
    </div>
  );
}

export default class ScreeningWorkbench extends HTMLElement {
  #root: Root | null = null;

  connectedCallback(): void {
    const projectId = this.getAttribute('project-id');
    if (!projectId || this.#root) return;
    this.style.display = 'contents';
    /* ids made in this root are told apart from the shell's (React's useId counts from the start in each root) */
    this.#root = createRoot(this, { identifierPrefix: 'screening-' });
    this.#root.render(<StrictMode><Screening projectId={projectId} /></StrictMode>);
  }

  disconnectedCallback(): void {
    /* after the render that took the element out, and only if it was not put back meanwhile: an element moved keeps
       what it holds */
    queueMicrotask(() => {
      if (this.isConnected || !this.#root) return;
      const root = this.#root;
      this.#root = null;
      root.unmount();
    });
  }
}
