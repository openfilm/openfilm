/**
 * The screening room, as the element its plugin brings (plugins/screening): the film played large, as it will be
 * exported, and the plainest ways to point at what to change, each a reference in the app's chat for the person to say
 * what they want there: a moment or a stretch, picked over the strip of its frames, and a part of the picture, circled
 * on it. Nothing here edits the film, and nothing is brought in here (the chat takes files). It reaches Studio only through its public
 * interface (`openfilm/studio`), as any plugin's element does, and plays the film with the page's own player.
 */
import * as React from 'react';
import { StrictMode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { addPluginWords, useT } from '@/i18n';
import { projectEvents, type Film as FilmValue } from '@/api';
import { Player } from '@/editor/player';
import { type FilmInfo, type PreviewHandle } from '@/editor/Preview';
import { filmClipKind } from '@/lib/film';
import type { ClipSpan } from '@/lib/film-shape';
import type { StageBox, StudioRef } from '@/lib/host';
import { momentRef, regionRef } from '@/lib/studio-refs';
import { Tooltip } from '@/components/Tooltip';
import { chat, help, links, onCommand, project, toast } from '@/studio';
import { useBlock, useProject, useProvide } from '@/studio/react';
import { clock, cuesOf, linkOf, sameRef, timeLabel, timeOf, type Clock, type Cue, type View } from './screening-model';
import { Scrubber, useClock, type Mark, type MarkState, type ScrubberHandle } from './Scrubber';
import { Btn, SpeedMenu } from './Controls';
import { FullscreenButton } from '@/components/player-controls/MediaButtons';
import { Icon, PATH_PAUSE, PATH_PLAY, VolumeControl } from '@/components/player-controls/controls-bar';
import { SheetBody } from './ShortcutSheet';
import { Stage } from './Stage';

addPluginWords('screening', import.meta.glob('../../../../../plugins/screening/i18n/*.json', { eager: true, import: 'default' }));

/** The plugin's words: `w('kPlay')`, with `{name}` values filled in. */
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
const SPEEDS = [1, 1.5, 2] as const;
/** How long a mark found rings, ms. */
const FLASH_MS = 1600;

/** A clip of the film where it plays, and whether it is seen or heard. */
interface Block { clip: import('@/api').Clip; track: number; at: number; end: number; kind: 'picture' | 'sound' }
/**
 * Whether the person has used each way that is not seen until used (kept in this browser): until then, where it is
 * used says how, once.
 */
type Lesson = 'box' | 'moment' | 'range' | 'zoom';
const LESSON_KEY = (lesson: Lesson) => `openfilm.screening.used.${lesson}`;
function useLessons(): [Record<Lesson, boolean>, (lesson: Lesson) => void] {
  const [used, setUsed] = React.useState<Record<Lesson, boolean>>(() => {
    const read = (lesson: Lesson) => { try { return localStorage.getItem(LESSON_KEY(lesson)) === '1'; } catch { return false; } };
    return { box: read('box'), moment: read('moment'), range: read('range'), zoom: read('zoom') };
  });
  const learn = React.useCallback((lesson: Lesson) => {
    setUsed((was) => (was[lesson] ? was : { ...was, [lesson]: true }));
    try { localStorage.setItem(LESSON_KEY(lesson), '1'); } catch { /* this time only */ }
  }, []);
  return [used, learn];
}

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
  const [info, setInfo] = React.useState<FilmInfo | null>(null);
  const time = React.useMemo(() => clock(0), []);
  const [playing, setPlaying] = React.useState(false);
  const [speed, setSpeed] = React.useState<number>(1);
  const [used, learn] = useLessons();
  /* how much of the film the bar shows: closer in, times are read to a tenth or a hundredth */
  const [shownView, setShownView] = React.useState<View>({ from: 0, span: 0 });
  const scrubber = React.useRef<ScrubberHandle>(null);
  /* the picture's width on screen: the bar under it is as wide */
  const [fit, setFit] = React.useState(0);
  const [cues, setCues] = React.useState<Cue[]>([]);
  /* what the message being written points at (the chat says, numbered as it numbers them); with no chat, what was copied */
  const [draft, setDraft] = React.useState<StudioRef[]>([]);
  const [copied, setCopied] = React.useState<StudioRef[]>([]);
  const preview = React.useRef<PreviewHandle>(null);
  const player = React.useRef<Player | null>(null);
  player.current ??= new Player();
  const block = useBlock('screening', 'screening');
  const shown = state?.shown === 'screening';
  const shownRef = React.useRef(shown);
  shownRef.current = shown;
  const folder = state?.film ?? null;
  const stage = film?.stage ?? STAGE;
  const duration = info?.duration ?? 0;

  /* ── the film, read now and each time film.html changes ── */
  const read = React.useCallback(async () => {
    try {
      const got = await project(projectId).film.read();
      if (!got.value) { setUnread(!got.missing); return; }
      setUnread(false);
      setFilm(got.value as FilmValue);
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
  const rate = React.useCallback((next: number) => { player.current!.setRate(next); setSpeed(next); }, []);
  const cycleSpeed = React.useCallback(() => {
    setSpeed((s) => { const next = SPEEDS[(SPEEDS.indexOf(s as 1) + 1) % SPEEDS.length]!; player.current!.setRate(next); return next; });
  }, []);
  /* the person's volume, as the player keeps it */
  const [sound, setSound] = React.useState({ volume: 1, muted: false });
  const heard = () => setSound({ volume: player.current!.volume, muted: player.current!.muted });
  /* full screen: the room itself, the picture and its bar */
  const room = React.useRef<HTMLDivElement>(null);
  const [full, setFull] = React.useState(false);
  React.useEffect(() => {
    const change = () => setFull(document.fullscreenElement === room.current && room.current != null);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  const toggleFull = React.useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void room.current?.requestFullscreen();
  }, []);
  /* while it plays: the time, and the end */
  React.useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const p = player.current!;
      const t = p.time();
      time.set(t);
      if (!p.playing || t >= p.duration - 1e-3) { pause(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, pause, time]);
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

  const blocks = React.useMemo(() => blocksOf(film, info?.spans ?? []), [film, info]);

  /* ── what the chat's message points at; a link to the film opened here ── */
  /*
   * A reference and its pill point at each other. The chat's pill under the pointer lights its mark here (`lit`); a
   * pill pressed goes to its place here and rings its mark once (`flash`). The pointer over a mark here lights its pill
   * in the chat; a mark's number pressed rings its pill there as well.
   */
  const [lit, setLit] = React.useState<StudioRef | null>(null);
  const [flash, setFlash] = React.useState<{ ref: StudioRef; seq: number } | null>(null);
  const found = React.useCallback((ref: StudioRef) => setFlash((was) => ({ ref, seq: (was?.seq ?? 0) + 1 })), []);
  React.useEffect(() => { if (!flash) return; const timer = setTimeout(() => setFlash(null), FLASH_MS); return () => clearTimeout(timer); }, [flash]);
  const stateOf = React.useCallback((ref: StudioRef): MarkState => (flash && sameRef(flash.ref, ref) ? 'flash' : lit && sameRef(lit, ref) ? 'lit' : null), [flash, lit]);
  const hoverMark = React.useCallback((ref: StudioRef | null) => chat.hover?.(ref), []);
  const goNow = React.useRef<(t: number) => void>(() => {});
  goNow.current = (t) => { pause(); seek(t); };
  React.useEffect(() => onCommand((command) => {
    if (command.type === 'draft-refs') { setDraft(command.refs); return; }
    if (command.type === 'highlight') { setLit(command.ref ?? null); return; }
    if (!shownRef.current) return;
    if (command.type === 'seek' && Number.isFinite(command.time)) { goNow.current(command.time); found({ kind: 'time', time: command.time }); }
    else if (command.type === 'show-range' && Number.isFinite(command.start)) { goNow.current(command.start); found({ kind: 'range', start: command.start, end: command.end, clipIds: [] }); }
    else if (command.type === 'show-box' && Number.isFinite(command.time)) { goNow.current(command.time); found({ kind: 'region', time: command.time, box: command.box, clipIds: [], texts: [] }); }
    else if (command.type === 'select-clip' && command.seek) {
      const block = [...blocksRef.current.picture, ...blocksRef.current.sound].find((b) => b.clip.id === command.id);
      if (block) goNow.current(block.at);
    }
  }), [found]);
  const blocksRef = React.useRef(blocks);
  blocksRef.current = blocks;
  /* a link to the film (a pill pressed in the chat, a link in a reply): its place shown, and the mark there rung */
  useProvide('screening', {
    opens: ['film.html'],
    show: (link) => {
      const fragment = links.parse(link)?.fragment ?? null;
      const time = links.time(fragment), box = links.box(fragment);
      if (time) {
        const at = 'at' in time ? time.at : time.start;
        goNow.current(at);
        found(box ? { kind: 'region', time: at, box, clipIds: [], texts: [] }
          : 'at' in time ? { kind: 'time', time: at } : { kind: 'range', start: time.start, end: time.end, clipIds: [] });
        return;
      }
      const clip = fragment ? [...blocksRef.current.picture, ...blocksRef.current.sound].find((b) => b.clip.id === fragment) : undefined;
      if (clip) goNow.current(clip.at);
    },
  });

  /* ── pointing: a reference in the chat (opened if folded); with no chat, a link copied for the person's agent ── */
  const refer = React.useCallback((ref: StudioRef) => {
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
  /* a moment: the one shown (M), or the one double-clicked on the bar */
  const pointMoment = React.useCallback((at?: number) => {
    pause();
    if (at != null) { seek(at); learn('moment'); }
    refer(momentRef(projectId, (at ?? player.current!.time()) * 1000));
  }, [pause, seek, learn, refer, projectId]);
  const pointBox = (box: StageBox) => {
    pause();
    learn('box');
    const t = now();
    /* a box over the lower part of the picture takes in the caption shown then */
    const lines = box.y + box.h > stage.h * 0.65 ? cues.filter((c) => t >= c.start && t < c.end).map((c) => c.text) : [];
    refer(regionRef(projectId, t * 1000, box, { clipIds: blocks.picture.filter((b) => t >= b.at && t < b.end).map((b) => b.clip.id), texts: lines }, stage));
  };
  const pointRange = (start: number, end: number) => {
    if (end - start < 0.1) return;
    learn('range');
    refer({ kind: 'range', start, end, clipIds: [...blocks.picture, ...blocks.sound].filter((x) => x.end > start && x.at < end).map((x) => x.clip.id) });
  };
  /* a mark's number pressed: its place, and its pill rung in the chat too */
  const goTo = (mark: Mark) => {
    const t = timeOf(mark.ref);
    if (t == null) return;
    pause();
    seek(t);
    found(mark.ref);
    chat.hover?.(mark.ref);
    setTimeout(() => chat.hover?.(null), FLASH_MS);
  };
  const onView = React.useCallback((view: View) => { setShownView(view); if (duration && view.span < duration - 1e-3) learn('zoom'); }, [duration, learn]);
  const closer = duration > 0 && shownView.span > 0 && shownView.span < duration - 1e-3;
  const decimals = closer ? (shownView.span <= 4 ? 2 : 1) : 0;
  /* the film's picture at `t`, for a picture standing for `step` s: the frame of the shot on top then, cut by Studio
     from its file (to the tenth of a second, or the frame when the pictures are closer than that) */
  const frameAt = React.useCallback((t: number, width: number, step: number) => {
    for (let i = blocks.picture.length - 1; i >= 0; i--) {
      const b = blocks.picture[i]!;
      if (t < b.at || t >= b.end) continue;
      const path = b.clip.src.split('#')[0]!;
      const file = state?.files.find((f) => f.path === path);
      const still = file?.kind === 'image';
      const unit = step < 0.1 ? FRAME_S * 1000 : 100;
      const ms = still ? 0 : Math.round(Math.round((((b.clip.time?.[0] ?? 0) + (t - b.at) * (b.clip.speed ?? 1)) * 1000) / unit) * unit);
      return `/api/projects/${encodeURIComponent(projectId)}/media?what=frame&path=${encodeURIComponent(path)}&ms=${ms}&w=${width}${file ? `&v=${file.mtimeMs}` : ''}`;
    }
    return undefined;
  }, [blocks, state?.files, projectId]);

  /* how the room is used and its keys, in the editor's help (the editor menu's "?", the ? key) */
  React.useEffect(() => {
    const steps = (['watch', 'time', 'picture', 'say'] as const).map((art) => ({ art, title: w(`${art}Title`), text: w(`${art}Text`) }));
    const groups = [
      { title: w('gWatch'), items: [
        { keys: ['Space', 'K'], label: w('kPlay') }, { keys: ['←', '→'], label: w('kStep') }, { keys: ['⇧', '←', '→'], label: w('kFrame') },
        { keys: ['+', '−'], label: w('kZoom') }, { keys: ['0'], label: w('kWhole') }, { keys: ['S'], label: w('kSpeed') }, { keys: ['F'], label: w('kFull') },
      ] },
      { title: w('gPoint'), items: [{ keys: ['M'], label: w('kMoment') }, { keys: ['Esc'], label: w('kCancel') }] },
    ];
    help.set('screening', (into) => {
      const root = createRoot(into, { identifierPrefix: 'screening-help-' });
      root.render(<SheetBody steps={steps} keysTitle={w('keysTitle')} groups={groups} />);
      return () => queueMicrotask(() => root.unmount());
    });
    return () => help.set('screening', null);
  }, [w]);

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
      else if (key === 's') { take(); cycleSpeed(); }
      else if (key === 'k') { take(); toggle(); }
      else if (key === 'f') { take(); toggleFull(); }
      else if (key === '=' || key === '+') { take(); scrubber.current?.zoomIn(); }
      else if (key === '-') { take(); scrubber.current?.zoomOut(); }
      else if (key === '0') { take(); scrubber.current?.whole(); }
    };
    window.addEventListener('keydown', press, true);
    return () => window.removeEventListener('keydown', press, true);
  }, [shown, toggle, pause, seek, pointMoment, cycleSpeed, toggleFull]); // eslint-disable-line react-hooks/exhaustive-deps

  /* drawn into its block, which Studio lays out among the page's panels (the chat, the library) as its arrangement has it */
  if (!state || !folder) return createPortal(<div className="h-full bg-[var(--bg-viewer)]" />, block.slot);
  /* a film with nothing in it yet: its picture black, the bar and its controls there but out of use, as the edit's */
  const empty = film != null && !blocks.picture.length && !blocks.sound.length;
  const idle = empty || !duration;
  return createPortal(
    <div ref={room} data-screening="" className={`relative flex h-full min-h-0 w-full flex-col gap-2 px-6 pb-2 pt-4 text-[var(--text)] ${full ? 'bg-black' : 'bg-[var(--bg-viewer)]'}`}>
      <Stage stage={stage} folder={folder} preview={preview} time={() => player.current?.time() ?? 0} onInfo={onInfo}
        marks={marks} clock={time} playing={playing} hint={used.box ? null : w('teachBox')}
        unread={unread ? w('notRead') : null} removeLabel={w('remove')}
        idle={idle}
        onFit={setFit} onToggle={toggle} onDragStart={pause} onBox={pointBox} onRemove={(m) => unrefer(m.ref)} stateOf={stateOf} onHoverMark={hoverMark} />
      {/* under the picture and as wide: the marks and the progress bar, then the player's row of controls; with nothing
          to play, what plays it greyed and out of use (how Screening is used is not: it needs no film) */}
      {(
        <div className="mx-auto flex w-full shrink-0 flex-col" style={{ maxWidth: Math.max(560, fit) }}>
          <Idle idle={idle}><Scrubber ref={scrubber} duration={duration} clock={time} aspect={stage.w / stage.h} frameAt={frameAt} marks={marks}
            words={{
              go: w('go'), remove: w('remove'), lane: used.moment && used.range ? null : w('laneEmpty'),
              laneHints: [...(used.moment ? [] : [w('hintMoment')]), ...(used.range ? [] : [w('hintRange')])],
              barHints: used.zoom ? [] : [w('hintZoom')],
            }}
            onSeek={(t) => { pause(); seek(t); }} onMoment={pointMoment}
            onRange={pointRange} onGo={goTo} onRemove={unrefer} stateOf={stateOf} onHoverMark={hoverMark} onView={onView} /></Idle>
          <div className="-mx-1.5 flex h-10 items-center gap-0.5 text-white">
            <Idle idle={idle}>
              <Tooltip label={playing ? w('pause') : w('play')} shortcut="Space">
                <Btn label={playing ? w('pause') : w('play')} onClick={toggle}><Icon d={playing ? PATH_PAUSE : PATH_PLAY} /></Btn>
              </Tooltip>
              <VolumeControl volume={sound.volume} muted={sound.muted} titles={{ mute: w('mute'), unmute: w('unmute') }}
                onVolumeChange={(v) => { player.current!.setVolume(v); heard(); }}
                onToggleMute={() => { player.current!.setMuted(!player.current!.muted); heard(); }} />
              <TimeNow source={time} decimals={decimals} duration={duration} />
            </Idle>
            <span className="flex-1" />
            <Idle idle={idle}><SpeedMenu rate={speed} label={w('speed')} normal={w('speedNormal')} onRate={rate} /></Idle>
            <Idle idle={idle}>
              <FullscreenButton full={full} label={full ? w('exitFull') : w('kFull')} shortcut="F" size={24} onClick={toggleFull} />
            </Idle>
          </div>
        </div>
      )}
    </div>
  , block.slot);
}

/** What plays the film: greyed and out of use while there is nothing to play. */
function Idle({ idle, children }: { idle: boolean; children: React.ReactNode }) {
  return (
    <div aria-disabled={idle || undefined} inert={idle} className={`contents ${idle ? '[&>*]:pointer-events-none [&>*]:select-none [&>*]:opacity-35' : ''}`}>
      {children}
    </div>
  );
}

/** The time now and the film's length: 0:30 / 1:42. */
function TimeNow({ source, decimals, duration }: { source: Clock; decimals: number; duration: number }) {
  const t = useClock(source);
  return (
    <span className="ml-1.5 shrink-0 whitespace-nowrap text-[12.5px] tabular-nums text-white/90">
      {timeLabel(t, decimals)} <span className="text-white/60">/ {timeLabel(duration)}</span>
    </span>
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
