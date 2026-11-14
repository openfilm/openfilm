/**
 * The screening room, as the element its plugin brings (plugins/screening): the film played large, as it will be
 * exported, and the plainest ways to point at what to change, each a reference in the app's chat for the person to say
 * what they want there: this moment, a part of the picture circled, a stretch of picture, sound or captions dragged on
 * the strip, a shot, a sound, a caption, the whole film. Nothing here edits the film. When the film changes (the
 * agent's work), the places are counted and played one after another. It reaches Studio only through its public
 * interface (`openfilm/studio`), as any plugin's element does, and plays the film with the page's own player.
 */
import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ChevronLeft, ChevronRight, Crosshair, Film, Keyboard, Pause, Play, SquareDashed, X } from 'lucide-react';
import { addPluginWords, useT } from '@/i18n';
import { projectEvents, type Film as FilmValue } from '@/api';
import { Player } from '@/editor/player';
import { type FilmInfo, type PreviewHandle } from '@/editor/Preview';
import { fileStem, filmClipKind } from '@/lib/film';
import type { ClipSpan } from '@/lib/film-shape';
import type { StageBox, StudioRef } from '@/lib/host';
import { momentRef, regionRef } from '@/lib/studio-refs';
import { Tooltip } from '@/components/Tooltip';
import { chat, onCommand, project, toast } from '@/studio';
import { useProject, useProvide } from '@/studio/react';
import { changedRanges, clock, cuesOf, linkOf, timeLabel, type Clock, type Cue, type Range } from './screening-model';
import { MOD, ShortcutSheet, useHeldSheet } from './ShortcutSheet';
import { Stage } from './Stage';
import { Strip, useClock, type Block, type Lane, type Mark } from './Strip';

addPluginWords('screening', import.meta.glob('../../../../../plugins/screening/i18n/*.json', { eager: true, import: 'default' }));

/** The plugin's words: `w('changed', { n: 3 })`. */
function useWords() {
  const t = useT();
  return React.useCallback((key: string, values: Record<string, string | number> = {}) => (
    Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), t(`plugin.screening.${key}`))
  ), [t]);
}

const STAGE = { w: 1920, h: 1080 };
/** How far ← → step, s; with ⇧, one frame. */
const STEP_S = 5;
const FRAME_S = 1 / 30;
/** Before each change watched, this much of what comes before it, s. */
const LEAD_S = 1;
const SPEEDS = [1, 1.5, 2] as const;

/** The film's shots and sounds where they play (a clip not placed by the player yet is left out); the top track last. */
function blocksOf(film: FilmValue | null, spans: readonly ClipSpan[]): { picture: Block[]; sound: Block[] } {
  const placed = new Map(spans.map((s) => [s.id, s]));
  const picture: Block[] = [], sound: Block[] = [];
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
  const [film, setFilm] = React.useState<FilmValue | null>(null);
  const [unread, setUnread] = React.useState(false);
  /* the film as it was when the person last looked: what changed since is counted */
  const [seen, setSeen] = React.useState<FilmValue | null>(null);
  const [info, setInfo] = React.useState<FilmInfo | null>(null);
  const time = React.useMemo(() => clock(0), []);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<number>(1);
  const [boxing, setBoxing] = React.useState(false);
  const [cues, setCues] = React.useState<Cue[]>([]);
  /* what the message being written points at (the chat says, numbered as it numbers them); with no chat, what was copied */
  const [draft, setDraft] = React.useState<StudioRef[]>([]);
  const [copied, setCopied] = React.useState<StudioRef[]>([]);
  const [watching, setWatching] = React.useState<{ ranges: Range[]; i: number } | null>(null);
  const [dropping, setDropping] = React.useState(false);
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const preview = React.useRef<PreviewHandle>(null);
  const player = React.useRef<Player | null>(null);
  player.current ??= new Player();
  const shown = state?.shown === 'screening';
  const folder = state?.film ?? null;
  const stage = film?.stage ?? STAGE;
  const duration = info?.duration ?? 0;
  const held = useHeldSheet(shown);

  /* ── the film, read now and each time film.html changes ── */
  const read = React.useCallback(async () => {
    try {
      const got = await project(projectId).film.read();
      if (!got.value) { setUnread(!got.missing); return; }
      setUnread(false);
      setFilm(got.value as FilmValue);
      setSeen((was) => was ?? (got.value as FilmValue));
    } catch { setUnread(true); }
  }, [projectId]);
  React.useEffect(() => { void read(); return projectEvents(projectId, (e) => { if (e.type === 'film') void read(); }); }, [projectId, read]);

  /* ── the page's own player: what is heard and seen is what is exported ── */
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
    time.set(at);
  }, [time]);
  const pause = React.useCallback(() => {
    const p = player.current!;
    if (!p.playing) return;
    p.pause();
    preview.current?.seek(p.time());
    setPlaying(false);
    time.set(p.time());
  }, [time]);
  const play = React.useCallback(() => {
    const p = player.current!;
    if (p.playing || !p.duration) return;
    if (p.time() >= p.duration - 0.05) seek(0);
    void p.play();
    setPlaying(true);
  }, [seek]);
  const toggle = React.useCallback(() => { if (player.current!.playing) pause(); else play(); }, [pause, play]);
  const cycleSpeed = React.useCallback(() => {
    setSpeed((s) => { const next = SPEEDS[(SPEEDS.indexOf(s as 1) + 1) % SPEEDS.length]!; player.current!.setRate(next); return next; });
  }, []);
  /* while it plays: the time, the end, and the next change watched */
  const watchingRef = React.useRef(watching);
  watchingRef.current = watching;
  React.useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const p = player.current!;
      const t = p.time();
      time.set(t);
      const now = watchingRef.current;
      if (now) {
        const range = now.ranges[now.i]!;
        if (t >= range.end + 0.3) {
          const next = now.i + 1;
          if (next < now.ranges.length) { setWatching({ ...now, i: next }); seek(Math.max(0, now.ranges[next]!.start - LEAD_S)); }
          else { pause(); return; }
        }
      }
      if (!p.playing || t >= p.duration - 1e-3) { pause(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, pause, seek, time]);
  React.useEffect(() => { if (!shown) { pause(); setBoxing(false); setSheetOpen(false); } }, [shown, pause]);

  /* ── captions: each caption track's lines ── */
  React.useEffect(() => {
    if (!film || !folder) { setCues([]); return; }
    let live = true;
    const tracks = film.tracks.flatMap((track) => (track.captions && !track.hidden ? [track.captions.src] : []));
    void Promise.all(tracks.map((src) => fetch(new URL(src, folder)).then((r) => (r.ok ? r.text() : '')).catch(() => '')))
      .then((texts) => { if (live) setCues(texts.flatMap((text) => cuesOf(text))); });
    return () => { live = false; };
  }, [film, folder]);

  const blocks = React.useMemo(() => blocksOf(film, info?.spans ?? []), [film, info]);

  /* ── what the chat's message points at; a link to the film opened here ── */
  React.useEffect(() => onCommand((command) => { if (command.type === 'draft-refs') setDraft(command.refs); }), []);
  const blocksRef = React.useRef(blocks);
  blocksRef.current = blocks;
  useProvide('screening', {
    opens: ['film.html'],
    show: (link) => {
      const fragment = link.split('#')[1] ?? '';
      const span = /^t=([\d.]+)/.exec(fragment);
      if (span) { pause(); seek(Number(span[1])); return; }
      const clip = fragment ? [...blocksRef.current.picture, ...blocksRef.current.sound].find((b) => b.clip.id === fragment) : undefined;
      if (clip) { pause(); seek(clip.at); }
    },
  });

  /* ── pointing: a reference in the chat (opened if folded); with no chat, a link copied for the person's agent ── */
  const refer = React.useCallback((ref: StudioRef) => {
    setBoxing(false);
    if (chat.refer) {
      chat.refer(ref);
      if (state?.chat && !state.chat.open) state.chat.toggle();
      return;
    }
    void navigator.clipboard?.writeText(linkOf(ref)).catch(() => {});
    setCopied((list) => [...list, ref]);
    toast(w('copied'));
  }, [state?.chat, w]);
  const marks: Mark[] = (chat.refer ? draft : copied).map((ref, i) => ({ n: i + 1, ref }));
  const unrefer = React.useCallback((ref: StudioRef) => {
    if (chat.refer) chat.unrefer?.(ref);
    else setCopied((list) => list.filter((r) => r !== ref));
  }, []);
  const now = () => player.current!.time();
  const pointMoment = React.useCallback(() => { pause(); refer(momentRef(projectId, player.current!.time() * 1000)); }, [pause, refer, projectId]);
  const pointWhole = React.useCallback(() => refer({ kind: 'range', start: 0, end: duration, clipIds: [...blocks.picture, ...blocks.sound].map((b) => b.clip.id) }), [refer, duration, blocks]);
  const pointBox = (box: StageBox) => {
    pause();
    const t = now();
    refer(regionRef(projectId, t * 1000, box, { clipIds: blocks.picture.filter((b) => t >= b.at && t < b.end).map((b) => b.clip.id), texts: [] }, stage));
  };
  const pointBlock = (b: Block) => {
    const file = state?.files.find((f) => f.path === b.clip.src.split('#')[0]);
    const poster = file && b.kind === 'picture' ? (state?.sources.poster?.(file) ?? (file.kind === 'image' ? state?.sources.file(file) : undefined)) : undefined;
    refer({ kind: 'clip', id: b.clip.id, loc: null, label: fileStem(b.clip.src), clipKind: filmClipKind(b.clip), src: b.clip.src, start: b.at, end: b.end, track: b.track, ...(poster ? { image: { src: poster } } : {}) });
  };
  const pointCue = (c: Cue) => refer({ kind: 'subtitle', start: c.start, end: c.end, text: c.text, index: c.index });
  const pointSpan = (lane: Lane, a: number, b: number) => {
    const [start, end] = a < b ? [a, b] : [b, a];
    if (end - start < 0.1) return;
    if (lane === 'captions') {
      const lines = cues.filter((c) => c.end > start && c.start < end);
      if (lines.length && lines.length <= 3) { for (const c of lines) pointCue(c); return; }
    }
    const pool = lane === 'sound' ? blocks.sound : lane === 'picture' ? blocks.picture : [...blocks.picture, ...blocks.sound];
    refer({ kind: 'range', start, end, clipIds: pool.filter((x) => x.end > start && x.at < end).map((x) => x.clip.id) });
  };

  /* ── what changed since the person last looked ── */
  const changes = React.useMemo(() => changedRanges(seen, film, info?.spans ?? []), [seen, film, info]);
  const watchChange = React.useCallback((i: number) => {
    if (!changes.length) return;
    const at = Math.max(0, Math.min(i, changes.length - 1));
    setWatching({ ranges: changes, i: at });
    seek(Math.max(0, changes[at]!.start - LEAD_S));
    play();
  }, [changes, seek, play]);
  const closeChanges = React.useCallback(() => { setSeen(film); setWatching(null); }, [film]);

  /* ── keys, while the screening room is shown ── */
  React.useEffect(() => {
    if (!shown) return;
    const press = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || el?.closest('input, textarea, [contenteditable="true"], [role="dialog"], [data-studio-host-panel]')) return;
      const take = () => { e.preventDefault(); e.stopPropagation(); };
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === ' ') { take(); toggle(); }
      else if (key === 'ArrowLeft' || key === 'ArrowRight') { take(); pause(); seek(now() + (key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? FRAME_S : STEP_S)); }
      else if (key === 'm') { take(); pointMoment(); }
      else if (key === 'b') { take(); setBoxing((on) => !on); }
      else if (key === 'w') { take(); pointWhole(); }
      else if (key === 'c' && changes.length) { take(); watchChange(0); }
      else if (key === 's') { take(); cycleSpeed(); }
      else if (key === 'Escape' && (boxing || sheetOpen || watching)) { take(); setBoxing(false); setSheetOpen(false); if (watching) { pause(); setWatching(null); } }
    };
    window.addEventListener('keydown', press, true);
    return () => window.removeEventListener('keydown', press, true);
  }, [shown, toggle, pause, seek, pointMoment, pointWhole, changes, watchChange, cycleSpeed, boxing, sheetOpen, watching]); // eslint-disable-line react-hooks/exhaustive-deps

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
        const fileKind = /\.(mp4|mov|m4v|webm|mkv)$/i.test(path) ? 'video' : /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(path) ? 'audio' : 'image';
        refer({ kind: 'file', path, fileKind });
      }
    } catch (error) { toast(error instanceof Error ? error.message : String(error), { error: true }); }
  };

  if (!state || !folder) return <div className="h-full bg-[var(--bg-viewer)]" />;
  const empty = film != null && !blocks.picture.length && !blocks.sound.length;
  const sheet = [
    [{ keys: ['Space'], label: w('kPlay') }, { keys: ['←', '→'], label: w('kStep') }, { keys: ['⇧', '←', '→'], label: w('kFrame') }, { keys: ['S'], label: w('kSpeed') }, { keys: ['Esc'], label: w('kCancel') }],
    [{ keys: ['M'], label: w('kMoment') }, { keys: ['B'], label: w('kBox') }, { keys: ['W'], label: w('kWhole') }, { keys: ['C'], label: w('kChanges') }, { keys: [w('kDragKey')], label: w('kLane') }],
  ];
  const floating = boxing ? (
    <Pill>
      <SquareDashed size={14} className="text-[var(--accent)]" />
      <span>{w('boxHint')}</span>
      <PillButton label={w('cancel')} onClick={() => setBoxing(false)}><X size={13} /></PillButton>
    </Pill>
  ) : changes.length && !empty ? (
    <Pill>
      <span className="h-2 w-2 rounded-full bg-[var(--warn)]" />
      <span className="tabular-nums">{watching ? `${watching.i + 1} / ${watching.ranges.length}` : changes.length === 1 ? w('changed1') : w('changed', { n: changes.length })}</span>
      {watching ? (
        <>
          <PillButton label={w('prevChange')} onClick={() => watchChange(watching.i - 1)}><ChevronLeft size={14} /></PillButton>
          <PillButton label={w('nextChange')} onClick={() => watchChange(watching.i + 1)}><ChevronRight size={14} /></PillButton>
        </>
      ) : (
        <Tooltip label={w('watchChanges')} shortcut="C">
          <button type="button" onClick={() => watchChange(0)} className="flex h-6 items-center gap-1 rounded-full bg-[var(--warn)] pl-2 pr-2.5 text-[11.5px] font-semibold text-black transition hover:brightness-110">
            <Play size={11} fill="currentColor" />{w('watchChanges')}
          </button>
        </Tooltip>
      )}
      <PillButton label={w('close')} onClick={closeChanges}><X size={13} /></PillButton>
    </Pill>
  ) : null;

  return (
    <div data-screening="" className="relative flex h-full min-h-0 w-full flex-col bg-[var(--bg-viewer)] text-[var(--text)]"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDropping(false); }}
      onDrop={(e) => { void drop(e); }}>
      <Stage stage={stage} folder={folder} preview={preview} time={() => player.current?.time() ?? 0} onInfo={onInfo} boxing={boxing}
        marks={marks} clock={time} unread={unread ? w('notRead') : null} over={floating} removeLabel={w('remove')}
        empty={empty ? { title: w('emptyTitle'), sub: state.chat ? w('emptySub') : w('emptyBrowserSub'), ...(state.chat && !state.chat.open ? { openChat: { label: w('openChat'), onOpen: state.chat.toggle } } : {}) } : null}
        onToggle={toggle} onBox={pointBox} onRemove={(m) => unrefer(m.ref)} />
      {/* the player's bar: playing on the left, pointing in the middle, the shortcuts on the right */}
      <div className="relative flex h-12 shrink-0 items-center gap-2 border-t border-[color:var(--border)] bg-[var(--bg-panel)] px-3">
        <Tooltip label={playing ? w('pause') : w('play')} shortcut="Space">
          <button type="button" aria-label={playing ? w('pause') : w('play')} onClick={toggle}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--primary)] text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] active:scale-95">
            {playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-[2px]" />}
          </button>
        </Tooltip>
        <TimeReadout source={time} duration={duration} />
        <Tooltip label={w('speed')} shortcut="S">
          <button type="button" onClick={cycleSpeed} aria-label={w('speed')}
            className={`h-6 min-w-[38px] rounded-md px-1.5 font-mono text-[11.5px] font-medium tabular-nums transition hover:bg-[var(--bg-hover)] ${speed === 1 ? 'text-[var(--text-muted)]' : 'bg-[var(--bg-hover)] text-[var(--accent)]'}`}>
            {speed}×
          </button>
        </Tooltip>
        <div role="toolbar" className="absolute left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-[color:var(--border)] bg-[var(--bg-hover)] p-[3px]">
          <ToolButton label={w('moment')} shortcut="M" onClick={pointMoment}><Crosshair size={16} /></ToolButton>
          <ToolButton label={w('box')} shortcut="B" on={boxing} onClick={() => setBoxing((on) => !on)}><SquareDashed size={16} /></ToolButton>
          <ToolButton label={w('whole')} shortcut="W" onClick={pointWhole}><Film size={16} /></ToolButton>
        </div>
        <div className="ml-auto flex items-center">
          <Tooltip label={`${w('shortcuts')} · ${w('kHold')}`} shortcut={MOD}>
            <button type="button" aria-label={w('shortcuts')} onClick={() => setSheetOpen((open) => !open)}
              className={`grid h-7 w-7 place-items-center rounded-md transition hover:bg-[var(--bg-hover)] ${sheetOpen ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
              <Keyboard size={15} />
            </button>
          </Tooltip>
        </div>
      </div>
      <Strip duration={duration} clock={time} blocks={blocks} cues={cues} marks={marks} changes={changes} state={state}
        words={{ picture: w('lanePicture'), sound: w('laneSound'), captions: w('laneCaptions'), laneHint: w('laneHint'), pointShot: w('pointShot'), pointSound: w('pointSound'), pointLine: w('pointLine'), remove: w('remove') }}
        onSeek={(t) => { pause(); seek(t); }} onSpan={pointSpan} onPointBlock={pointBlock} onPointCue={pointCue} onRemove={unrefer} />
      {held || sheetOpen ? <ShortcutSheet title={w('sheetTitle')} groups={sheet} hold={{ keys: [MOD], label: w('kHold') }} /> : null}
      {dropping ? (
        <div className="pointer-events-none absolute inset-3 z-30 grid place-items-center rounded-2xl border-2 border-dashed border-[color:var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] text-[15px] font-medium text-[var(--accent)]">
          {w('dropHere')}
        </div>
      ) : null}
    </div>
  );
}

function TimeReadout({ source, duration }: { source: Clock; duration: number }) {
  const t = useClock(source);
  return (
    <span className="shrink-0 font-mono text-[12px] tabular-nums">
      <span className="text-[var(--text)]">{timeLabel(t)}</span>
      <span className="text-[var(--text-faint)]"> / {timeLabel(duration)}</span>
    </span>
  );
}

function ToolButton({ label, shortcut, on = false, onClick, children }: { label: string; shortcut: string; on?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip label={label} shortcut={shortcut}>
      <button type="button" aria-label={label} aria-pressed={on} onClick={onClick}
        className={`grid h-8 w-10 place-items-center rounded-full transition active:scale-95 ${on ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'text-[var(--text)] hover:bg-[var(--bg-pressed)]'}`}>
        {children}
      </button>
    </Tooltip>
  );
}

/** What floats over the top of the picture. */
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <div className="pointer-events-auto flex h-9 items-center gap-2 rounded-full border border-white/10 bg-black/70 pl-3.5 pr-1.5 text-[12.5px] font-medium text-white shadow-[0_8px_24px_rgb(0_0_0/.35)] backdrop-blur-md">
      {children}
    </div>
  );
}

function PillButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip label={label}>
      <button type="button" aria-label={label} onClick={onClick} className="grid h-6 w-6 place-items-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white">{children}</button>
    </Tooltip>
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
