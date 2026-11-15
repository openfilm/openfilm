/**
 * The stage, as the element its plugin brings (plugins/stage: its package.json's `browser`). Three blocks: the
 * viewfinder (the shot as its camera sees it, played live), the view from above (the set's footprint, every path, who
 * and the camera at this moment) and the shots. The shot itself is drawn by `stage/lib/viewer.html`, served with the
 * project's files on their own origin, where its three.js runs: this element keeps the moment, the playing and what
 * was dragged, and tells both views by message. Nothing here edits a shot: a drag moves the thing at once on screen,
 * and on release puts a reference in the app's chat saying what moved where at which moment, for the agent to change
 * shot.js; once the shot's files change it is drawn again as written. "Make video" renders the white box and lays it
 * out on the canvas with the commands an agent runs (plugins/stage/server.mjs).
 */
import * as React from 'react';
import { StrictMode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { Clapperboard, LoaderCircle, Pause, Play } from 'lucide-react';
import { addPluginWords, useT } from '../../i18n';
import { parseLink } from '../../lib/links';
import { chat, open, pluginApi, toast } from '../../studio';
import { useBlock, useProject, useProvide } from '../../studio/react';

addPluginWords('stage', import.meta.glob('../../../../../plugins/stage/i18n/*.json', { eager: true, import: 'default' }));

const api = pluginApi('stage');
const FRAME = 1 / 24;
const near = (a: number, b: number) => Math.abs(a - b) < FRAME / 2 + 1e-6;

interface Shot { name: string; page: string; changed: number; whitebox: string | null; still: string | null; note: string }

/** A thing dragged at a moment: a figure's place on the floor, or the camera's place (meters). */
interface Moved { kind: 'figure' | 'camera'; name: string; t: number; from: [number, number, number]; to: [number, number, number] }

/** What a view says (viewer.js). */
interface Said { stage: true; ready?: { duration: number }; failed?: string; moving?: Moved | null; moved?: Moved; key?: string }

/** A number of meters as a person reads it. */
const meters = (v: number) => (Math.abs(v) < 0.005 ? '0' : v.toFixed(2).replace(/\.?0+$/, ''));

function Stage({ projectId, owner }: { projectId: string; owner: string }) {
  const t = useT();
  const state = useProject(projectId);
  const viewfinder = useBlock(owner, 'viewfinder');
  const above = useBlock(owner, 'above');
  const strip = useBlock(owner, 'shots');

  const [shots, setShots] = React.useState<Shot[] | null>(null);
  const [picked, setPicked] = React.useState<string | null>(null);
  const [time, setTime] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [duration, setDuration] = React.useState(0);
  const [version, setVersion] = React.useState(0);
  const [moved, setMoved] = React.useState<Moved[]>([]);
  const [live, setLive] = React.useState<Moved | null>(null);
  const [failed, setFailed] = React.useState<string | null>(null);
  const [making, setMaking] = React.useState<string | null>(null);
  const views = React.useRef(new Set<Window>());
  const timeRef = React.useRef(0);
  timeRef.current = time;
  const shown = state?.shown === owner;
  const shot = shots?.find((s) => s.name === picked) ?? null;

  /* the project's shots, asked again while the stage is shown; the picked shot drawn anew once its files change */
  const changedAt = React.useRef(0);
  React.useEffect(() => {
    let stop = false;
    const read = async () => {
      try {
        const { shots: list } = await api.get(`projects/${encodeURIComponent(projectId)}/shots`) as { shots: Shot[] };
        if (stop) return;
        setShots(list);
        setPicked((p) => (p && list.some((s) => s.name === p) ? p : list[0]?.name ?? null));
      } catch { /* Studio starting again: asked again on the next turn */ }
    };
    void read();
    const timer = shown ? setInterval(read, 1500) : null;
    return () => { stop = true; if (timer) clearInterval(timer); };
  }, [projectId, shown]);
  React.useEffect(() => {
    if (!shot) return;
    if (changedAt.current && shot.changed > changedAt.current) { setVersion((v) => v + 1); setMoved([]); }
    changedAt.current = shot.changed;
  }, [shot]);
  React.useEffect(() => { changedAt.current = 0; setMoved([]); setLive(null); setTime(0); setPlaying(false); setDuration(0); setFailed(null); }, [picked]);

  /* playing: the shot runs round and round, from where it was */
  React.useEffect(() => {
    if (!playing || !duration) return;
    let last = performance.now();
    let id = 0;
    const step = (now: number) => {
      timeRef.current = (timeRef.current + (now - last) / 1000) % duration;
      last = now;
      setTime(timeRef.current);
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [playing, duration]);

  /* both views are told the moment, the playing and what was dragged, whenever one of them changes */
  const filmOrigin = state ? new URL(state.film, location.href).origin : '*';
  const tell = React.useCallback(() => {
    for (const w of views.current) w.postMessage({ stage: true, time, playing, moved, live }, filmOrigin);
  }, [time, playing, moved, live, filmOrigin]);
  React.useEffect(tell, [tell]);

  /** Put a reference to what was dragged in the app's chat (in a browser: copied, to paste). */
  const refer = React.useCallback((m: Moved) => {
    if (!shot) return;
    const where = (p: number[]) => (m.kind === 'camera' ? `x ${meters(p[0])} y ${meters(p[1])} z ${meters(p[2])}` : `x ${meters(p[0])} z ${meters(p[2])}`);
    const at = Number(m.t.toFixed(2));
    const who = m.kind === 'camera' ? 'the camera' : m.name;
    const text = `In the stage, at ${at} s, ${who} was dragged from ${where(m.from)} to ${where(m.to)} (meters${m.kind === 'camera' ? ', looking the same way' : ', on the floor'}).`;
    const loc = `${shot.page}#t=${at}`;
    if (chat.refer) chat.refer({ kind: 'layer', label: `${m.kind === 'camera' ? t('plugin.stage.camera') : m.name} · ${at} s`, loc, clipId: null, text, tag: null, time: at, source: 'stage' });
    else { void navigator.clipboard?.writeText(`[${shot.name} ${at} s](${loc}) ${text}`).catch(() => {}); toast(t('plugin.stage.copied')); }
  }, [shot, t]);

  /** A key pressed in the stage, or in one of its views: space plays, ← → a second. */
  const press = React.useCallback((key: string) => {
    if (key === ' ') setPlaying((p) => !p);
    else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      setPlaying(false);
      setTime((v) => Math.min(Math.max(0, duration - FRAME), Math.max(0, v + (key === 'ArrowLeft' ? -1 : 1))));
    }
  }, [duration]);

  /* what the views say */
  React.useEffect(() => {
    const hear = (e: MessageEvent) => {
      if (!views.current.has(e.source as Window) || e.origin !== filmOrigin) return;
      const said = e.data as Said;
      if (!said?.stage) return;
      if (said.ready) { setDuration(said.ready.duration); setFailed(null); (e.source as Window).postMessage({ stage: true, time: timeRef.current, playing, moved, live }, e.origin); }
      if (said.failed) setFailed(said.failed);
      if (said.moving !== undefined) { setPlaying(false); setLive(said.moving); }
      if (said.moved) {
        const m = said.moved;
        setLive(null);
        setMoved((list) => [...list.filter((o) => !(o.kind === m.kind && o.name === m.name && near(o.t, m.t))), m]);
        refer(m);
      }
      if (said.key) press(said.key);
    };
    addEventListener('message', hear);
    return () => removeEventListener('message', hear);
  }, [refer, press, playing, moved, live, filmOrigin]);

  React.useEffect(() => {
    if (!shown) return;
    const key = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(el.tagName))) return;
      if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); press(e.key); }
    };
    addEventListener('keydown', key);
    return () => removeEventListener('keydown', key);
  }, [shown, press]);

  /* a link to a shot, or a moment of it, shows it here */
  useProvide(owner, {
    opens: ['stage/**'],
    show: (link) => {
      const parsed = parseLink(link);
      const name = /^stage\/([^/]+)\//.exec(parsed?.path ?? '')?.[1];
      if (name) setPicked(name);
      const at = /(?:^|&)t=([\d.]+)/.exec(parsed?.fragment ?? '')?.[1];
      if (at) { setPlaying(false); setTimeout(() => setTime(Number(at)), 0); }
    },
  });

  const make = async (s: Shot) => {
    setMaking(s.name);
    try {
      const { link } = await api.post(`projects/${encodeURIComponent(projectId)}/shots/${encodeURIComponent(s.name)}/make`, {
        duration: s.name === picked && duration ? duration : undefined, note: s.note || undefined,
      }) as { link: string };
      toast(t('plugin.stage.made'));
      open(link);
    } catch (e) {
      toast(`${t('plugin.stage.makeFailed')} ${e instanceof Error ? e.message : String(e)}`, { error: true });
    } finally {
      setMaking(null);
    }
  };

  if (!state) return null;
  const viewer = (mode: string) => (shot ? `${state.film}stage/lib/viewer.html?shot=${encodeURIComponent(shot.name)}&mode=${mode}&editor=${encodeURIComponent(location.origin)}&v=${version}-${shot.changed}` : null);
  const here = moved.filter((m) => near(m.t, time)).length;
  return (
    <>
      {viewfinder.shown && createPortal(
        <div className="flex h-full min-h-0 w-full flex-col bg-[var(--bg-viewer)]">
          <Sixteen>
            {shot && <View src={viewer('camera')} title={t('plugin.stage.viewfinder')} views={views} />}
            {shot && here > 0 && !playing && <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-[11.5px] text-white">{t('plugin.stage.waiting')}</div>}
            {shot && failed && <div className="absolute inset-0 flex items-center justify-center bg-black/75 px-6 text-center text-[13px] leading-[19px] text-white">{t('plugin.stage.notStarted')}<br />{failed}</div>}
            {shots !== null && !shots.length && <Empty />}
          </Sixteen>
          <div className="flex h-9 shrink-0 items-center gap-2 px-3 text-[12px] tabular-nums text-[var(--text-muted)]" title={t('plugin.stage.dragHint')}>
            <button type="button" onClick={() => press(' ')} disabled={!duration} aria-label={playing ? t('plugin.stage.pause') : t('plugin.stage.play')}
              className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-40">
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <span className="w-[86px] shrink-0">{time.toFixed(1)} / {duration.toFixed(1)} s</span>
            <Ruler time={time} duration={duration} onTime={(v) => { setPlaying(false); setTime(v); }} />
          </div>
        </div>,
        viewfinder.slot)}
      {above.shown && createPortal(
        <div className="relative h-full w-full overflow-hidden bg-[var(--bg-viewer)]">
          {shot && <View src={viewer('above')} title={t('plugin.stage.above')} views={views} />}
        </div>,
        above.slot)}
      {strip.shown && createPortal(
        <Strip shots={shots} picked={picked} film={state.film} making={making} onPick={setPicked} onMake={make} />,
        strip.slot)}
    </>
  );
}

/** A view of the shot: viewer.html in a frame, known to the stage while it is there. */
function View({ src, title, views }: { src: string | null; title: string; views: React.RefObject<Set<Window>> }) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  React.useEffect(() => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    views.current.add(w);
    return () => { views.current.delete(w); };
  }, [views, src]);
  return src ? <iframe ref={frame} src={src} title={title} className="absolute inset-0 h-full w-full border-0" /> : null;
}

/** A 16 : 9 box, as large as the block lets it be, centered: the frame of the render. */
function Sixteen({ children }: { children: React.ReactNode }) {
  const box = React.useRef<HTMLDivElement>(null);
  const [size, setSize] = React.useState<[number, number]>([0, 0]);
  React.useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => { const w = el.clientWidth, h = el.clientHeight; setSize(w / h > 16 / 9 ? [h * 16 / 9, h] : [w, w * 9 / 16]); };
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <div ref={box} className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <div className="relative bg-black" style={{ width: size[0], height: size[1] }}>{children}</div>
    </div>
  );
}

/** A thin line of the shot's length: shows where the playhead is, and takes it where it is pressed. */
function Ruler({ time, duration, onTime }: { time: number; duration: number; onTime: (t: number) => void }) {
  const t = useT();
  const at = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onTime(Math.min(Math.max(0, duration - FRAME), Math.max(0, ((e.clientX - r.left) / r.width) * duration)));
  };
  const k = duration ? time / duration : 0;
  return (
    <div role="slider" aria-label={t('plugin.stage.time')} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time} tabIndex={-1}
      className="relative h-5 flex-1 cursor-pointer touch-none"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); at(e); }} onPointerMove={(e) => { if (e.buttons) at(e); }}>
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded bg-[var(--bg-hover)]" />
      <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded bg-[var(--accent)]" style={{ width: `${k * 100}%` }} />
      <div className="absolute top-1/2 h-3 w-[3px] -translate-y-1/2 rounded bg-[var(--text)]" style={{ left: `calc(${k * 100}% - 1px)` }} />
    </div>
  );
}

function Empty() {
  const t = useT();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[var(--bg-viewer)] px-6 text-center">
      <Clapperboard size={22} className="text-[var(--text-faint)]" />
      <div className="text-[13px] text-[var(--text)]">{t('plugin.stage.emptyTitle')}</div>
      <div className="max-w-[420px] text-[12px] leading-[18px] text-[var(--text-muted)]">{t('plugin.stage.emptyHint')}</div>
    </div>
  );
}

/** The shots, a card each: its first frame when there is one, its name, and making it into video. */
function Strip({ shots, picked, film, making, onPick, onMake }: {
  shots: Shot[] | null; picked: string | null; film: string; making: string | null; onPick: (name: string) => void; onMake: (shot: Shot) => void;
}) {
  const t = useT();
  if (!shots) return <div className="flex h-full items-center justify-center"><LoaderCircle size={15} className="animate-spin text-[var(--text-faint)]" /></div>;
  return (
    <div className="flex h-full min-h-0 items-stretch gap-2.5 overflow-x-auto px-3 py-2.5">
      {shots.map((s) => (
        <div key={s.name} className={`flex w-[170px] shrink-0 flex-col gap-1.5 rounded-[8px] p-1.5 ${s.name === picked ? 'bg-[var(--bg-selected)]' : 'hover:bg-[var(--bg-hover)]'}`}>
          <button type="button" onClick={() => onPick(s.name)} className="flex min-h-0 flex-1 flex-col gap-1 text-left">
            <div className="aspect-video w-full overflow-hidden rounded-[6px] bg-black">
              {s.still
                ? <img src={`${film}${s.still}?c=${s.changed}`} alt="" className="h-full w-full object-cover" />
                : <div className="flex h-full items-center justify-center text-[var(--text-faint)]"><Clapperboard size={16} /></div>}
            </div>
            <div className="truncate text-[12px] font-medium text-[var(--text)]">{s.name}</div>
          </button>
          <button type="button" disabled={making !== null} onClick={() => onMake(s)}
            className="inline-flex h-6 items-center justify-center gap-1 rounded bg-[var(--bg-hover)] px-2 text-[11.5px] text-[var(--text)] hover:bg-[var(--bg-pressed)] disabled:opacity-50">
            {making === s.name ? <><LoaderCircle size={12} className="animate-spin" />{t('plugin.stage.making')}</> : t('plugin.stage.makeVideo')}
          </button>
        </div>
      ))}
      {!shots.length && <div className="flex items-center px-2 text-[12px] text-[var(--text-muted)]">{t('plugin.stage.noShots')}</div>}
    </div>
  );
}

export default class StageWorkbench extends HTMLElement {
  #root: Root | null = null;

  connectedCallback(): void {
    const projectId = this.getAttribute('project-id');
    if (!projectId || this.#root) return;
    /* the element draws into its blocks: it takes no room itself */
    this.style.display = 'contents';
    this.#root = createRoot(this, { identifierPrefix: 'stage-' });
    this.#root.render(<StrictMode><Stage projectId={projectId} owner={this.getAttribute('plugin') ?? 'stage'} /></StrictMode>);
  }

  disconnectedCallback(): void {
    /* an element moved keeps what it holds: let go only if it was not put back */
    queueMicrotask(() => {
      if (this.isConnected || !this.#root) return;
      const root = this.#root;
      this.#root = null;
      root.unmount();
    });
  }
}
