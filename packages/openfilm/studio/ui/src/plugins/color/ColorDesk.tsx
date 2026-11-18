/**
 * The color workbench: the edit graded, laid out as a grading page is (the edit's own viewer, with its timeline and
 * undo, among three blocks of the plugin's):
 *
 *   scopes   right of the picture: a waveform (or a parade, a histogram), a vectorscope, and what they measure
 *   shots    under it: each video clip of the film as it plays graded, numbered, the one in hand lit; a click takes it
 *   tools    under the shots, in three columns:
 *              the grade's files, top to bottom as they apply: the footage's input, the layers it shares (groups),
 *              its own, a filter or LUT for the screen, the output. The one picked is what the controls change.
 *              the controls: basic sliders, color wheels, RGB curves, hue curves, styles (the library's filters)
 *              what is done to a shot whole: balance, match, copy, reset, export as a LUT
 *
 * Everything is the project's files (src/color: chain, adjust; lib/clip-color says what a change writes): what the
 * person does here, an agent does by writing the same files or running the plugin's commands, and each sees the other's
 * at once. Dragging shows the grade on the picture and in the scopes as it goes; letting go writes it, one step of the
 * edit's undo.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { Download, Link2, MessageSquarePlus, Minus, Palette, Pipette, Plus, RotateCcw, Sparkles, Unlink, Upload, Wand2 } from 'lucide-react';
import { addPluginWords, useLanguage, useT } from '@/i18n';
import { chat, pluginApi, project as projectOf, toast } from '@/studio';
import { useBlock } from '@/studio/react';
import { MenuSelect } from '@/components/MenuSelect';
import { Tooltip } from '@/components/Tooltip';
import { nameOf, useLibraryIndex, type LibraryItem } from '@/lib/library';
import { MIXED, type Mixed } from '@/lib/mixed';
import {
  ADJUST_KEYS, ADJUST_RANGE, adjustWrite, clipAdjust, copyWrite, detachWrite, draftOf, filterWrite, inputWrite, isFilter, layerWrite,
  ownPath, removeWrite, shareWrite, type AdjustKey, type ColorClip, type ColorText, type ColorWrite,
} from '@/lib/clip-color';
import { STANDARD, useColorFiles, readColorTexts, writtenHere, type ColorHost } from '@/lib/color-files';
import { chainOf, partsOf, roleOf, withChain, OUTPUT, SDR_INPUT } from '../../../../../src/color/chain.mjs';
import {
  adjustOf, curvesOf, filterOfUrl, hueCurvesOf, isEmptyLayer, wheelsOf, withAdjust, withCurves, withHueCurves, withWheels, PLAIN_CURVE,
  type HueCurve, type Points, type RgbCurve, type Wheel, type Zone,
} from '../../../../../src/color/adjust.mjs';
import { parseColorTransform } from '../../../../../src/color/ctf.mjs';
import { leftOut } from '../../../../../src/color/page-grade.mjs';
import { elementsOf, newCtf, setOp } from '../../../../../src/color/edit.mjs';
import { bake, cubeText } from '../../../../../src/color/ops.mjs';
import { CurveEditor } from './CurveEditor';
import { ScopeView, usePictures, useScopes, useThumbs, type Chain, type Scope } from './Scope';
import type { FromWorker, Picked } from './scope-worker';
import { ColorWheel } from './Wheels';

addPluginWords('color', import.meta.glob('../../../../../plugins/color/i18n/*.json', { eager: true, import: 'default' }));

const server = pluginApi('color');

/**
 * A clip of the film with a picture to grade, as the desk reads it: its id, style, file, where it plays and for how
 * long (seconds on the film; null: as its `time` says). A video's picture is its footage, graded through its input
 * and output; a page's or a still's is drawn by the browser, graded on it as shown (src/color/page-grade.mjs).
 */
export interface GradedClip extends ColorClip {
  src: string; at: number; time?: readonly number[] | null; speed?: number;
  kind: 'video' | 'page' | 'still';
  length?: number | null;
}

type Words = (key: string, values?: Record<string, string | number>) => string;
/** The plugin's words: `w('clips', { n: 2 })`. */
function useWords(): Words {
  const t = useT();
  return React.useCallback((key: string, values: Record<string, string | number> = {}) => (
    Object.entries(values).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), t(`plugin.color.${key}`))
  ), [t]);
}
const kept = <T,>(key: string, fallback: T): T => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const keep = (key: string, value: unknown) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* this time only */ } };
/** A piece of state remembered across visits (which scope, which tab). */
function useKept<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [v, set] = React.useState<T>(() => kept(key, fallback));
  return [v, React.useCallback((next: T) => { set(next); keep(key, next); }, [key])];
}

const INPUTS = ['rec709', 'hlg', 'pq', 'apple-log', 'apple-log-2', 'sony-slog3', 'sony-slog3-sgamut3', 'arri-logc3', 'arri-logc4', 'canon-clog3',
  'panasonic-vlog', 'fujifilm-flog', 'fujifilm-flog2', 'nikon-nlog', 'dji-dlog', 'bmd-film5'] as const;
/** The kind of footage an input file is for, by its name (`looks/in-sony-slog3-full.ctf` → `sony-slog3`). */
const kindOf = (input: string | null) => (input ? input.split('/').pop()!.replace(/^in-/, '').replace(/(-full)?\.ctf$/, '') : 'rec709');
const fileName = (path: string) => path.split('/').pop()!.replace(/#.*$/, '').replace(/\.[^.]+$/, '');
const layerName = (path: string) => path.split('/').pop()!.replace(/\.(ctf|clf|cube)$/i, '');

/** How long a clip is on the film, seconds (null: not known). */
const lengthOf = (clip: GradedClip) => clip.length ?? (clip.time?.length === 2 ? (clip.time[1]! - clip.time[0]!) / (clip.speed || 1) : null);
/** Whether a clip's picture is drawn by the browser (a page, a still): graded as shown, without an input or output. */
const drawnOf = (clip: GradedClip | null) => Boolean(clip && clip.kind !== 'video');
/** What a frame of a clip is asked by: a page by its clip (drawn with the changes made in it), else its file alone. */
const pageOf = (clip: GradedClip | null) => (clip?.kind === 'page' ? clip.id : null);

/** The second of its file a clip shows at film time `t` (seconds), or its middle when the playhead is not on it. */
function secondOf(clip: GradedClip, t: number | null): number {
  const from = clip.time?.[0] ?? 0, speed = clip.speed || 1;
  const length = lengthOf(clip);
  if (t != null && t >= clip.at && (length == null || t < clip.at + length)) return from + (t - clip.at) * speed;
  return length == null ? from : from + (length * speed) / 2;
}
/** Where the playhead is along a clip, 0–1, or null when not on it. */
function alongOf(clip: GradedClip, t: number): number | null {
  const length = lengthOf(clip);
  if (t < clip.at || length == null || t >= clip.at + length) return null;
  return (t - clip.at) / length;
}

/** Shared layers each have a color of their own, as clips are tagged by color in a grading page: muted, for the strip and the stack. */
const GROUP_COLORS = ['#c99a4b', '#6f9fd6', '#79b48a', '#c47a9a', '#9a8fd0', '#c9b25a', '#5fb3b3', '#d08565'];
const groupColor = (path: string, all: readonly string[]) => GROUP_COLORS[Math.max(0, all.indexOf(path)) % GROUP_COLORS.length]!;

/** What a slider's track shows: the color it pushes toward at each end. */
const TRACK: Partial<Record<AdjustKey, string>> = {
  temperature: 'linear-gradient(90deg, #4f7fd9, #7d8796 50%, #e0a040)',
  tint: 'linear-gradient(90deg, #4fbf6a, #8a8a8a 50%, #cf5fc9)',
  exposure: 'linear-gradient(90deg, #1c1c1e, #8c8c8c 50%, #f2f2f2)',
  saturation: 'linear-gradient(90deg, #8a8a8a, #8a8a8a 50%, #e0603c 70%, #3cbf7a 85%, #4f7fd9)',
};
const UNIT: Partial<Record<AdjustKey, string>> = { exposure: ' EV' };

/* the overall wheel: its puck is the white balance (temperature, tint), its line the exposure */
const WARM = 0.0015;
const overallWheel = (temperature: number, tint: number, exposure: number): Wheel => ({
  r: 1 + WARM * temperature, g: 1 - WARM * tint, b: 1 - WARM * temperature, m: Math.min(1.99, Math.max(0.01, 1 + exposure / ADJUST_RANGE.exposure.max)),
});
const overallOf = (w: Wheel) => {
  const clamp = (v: number, k: AdjustKey) => Math.min(ADJUST_RANGE[k].max, Math.max(ADJUST_RANGE[k].min, Math.round(v / ADJUST_RANGE[k].step) * ADJUST_RANGE[k].step));
  return {
    temperature: clamp((w.r - w.b) / (2 * WARM), 'temperature'),
    tint: clamp(((w.r + w.b) / 2 - w.g) / WARM, 'tint'),
    exposure: clamp((w.m - 1) * ADJUST_RANGE.exposure.max, 'exposure'),
  };
};

type Tab = 'basic' | 'wheels' | 'curves' | 'hue' | 'styles';
const TABS: readonly Tab[] = ['basic', 'wheels', 'curves', 'hue', 'styles'];
const RGB: readonly RgbCurve[] = ['master', 'red', 'green', 'blue'];
const HUES: readonly HueCurve[] = ['hueHue', 'hueSat', 'hueLum', 'lumSat', 'satSat'];
const CHANNEL: Record<RgbCurve, string> = { master: '#e8e8e8', red: '#ff6b5e', green: '#4fd47a', blue: '#5b8cff' };
/** The operations a person's controls write, by name; what else a layer holds is listed as it is. */
const KNOWN: Record<string, Tab> = { adjust: 'basic', 'adjust-tone': 'wheels', curves: 'curves', 'hue-curves': 'hue' };

/** The styles' first card: no filter. */
const NONE = '\0none';
/** What a color transform file says of itself, not an operation. */
const ABOUT = /^(Description|InputDescriptor|OutputDescriptor|Info)$/;
const operations = (text: string | null | undefined) => {
  if (!text) return [];
  try { return elementsOf(text).filter((el) => !ABOUT.test(el.tag)); } catch { return []; }
};
/** A change seen: by the agent (or anyone but this page) or the person here, to which shots, and what. */
interface Change { at: number; agent: boolean; shots: string[]; what: string[] }
/** How a thing changed by someone else is lit for a moment. */
const GLOW = '0 0 0 2px var(--accent), 0 0 14px 2px color-mix(in srgb, var(--accent) 45%, transparent)';
/** The operations (by name, else tag) a file's change put in, took out or changed. */
function opsChanged(was: string | null, now: string | null): string[] {
  const of = (t: string | null) => new Map(operations(t).map((el) => [el.name ?? el.tag, t!.slice(el.from, el.to)] as const));
  const a = of(was), b = of(now);
  return [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
}
/** A box that knows its size: its contents drawn for it. */
function Measured({ className, children }: { className: string; children: (box: { w: number; h: number }) => React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [box, setBox] = React.useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return <div ref={ref} className={className}>{box.w ? children(box) : null}</div>;
}
/** The film's frame aspect for shots and styles. */
const THUMB_ASPECT = 16 / 9;

export function ColorDesk({ projectId, host, clips, current, timeMs, onShot, onSeek, onPickPoint, onRefer, onLeave }: {
  projectId: string;
  host: ColorHost;
  /** every video clip of the film, in its order */
  clips: readonly GradedClip[];
  /** the clips being graded: those picked, else the one at the playhead */
  current: readonly string[];
  timeMs: number;
  /** A shot taken in the strip: picked (with others when `more`), the playhead on it. */
  onShot: (id: string, more: boolean) => void;
  /** The playhead put at film second `t` (a shot scrubbed in the strip). */
  onSeek?: (t: number) => void;
  /** Ask for a point clicked on the picture (0–1 across and down the frame; null: let go without one). */
  onPickPoint?: (done: (point: { x: number; y: number } | null) => void) => void;
  /** The shots `ids` given to the chat as references (with an app that has one). */
  onRefer?: (ids: readonly string[]) => void;
  /** Back to the edit, where footage is put in the film (said when the film has none). */
  onLeave?: () => void;
}) {
  const w = useWords();
  const lang = useLanguage();
  const index = useLibraryIndex();
  const pictures = usePictures(projectId);
  const chosen = React.useMemo(() => current.flatMap((id) => clips.filter((c) => c.id === id)), [clips, current]);
  const first = chosen[0] ?? null;
  const ids = React.useMemo(() => chosen.map((c) => c.id), [chosen]);
  const chain = React.useMemo(() => chainOf(first?.style), [first?.style]);
  const parts = partsOf(chain);

  /* the layer the controls change: the shot's own, or one of its chain */
  const [layer, setLayer] = React.useState<'own' | string>('own');
  React.useEffect(() => { if (layer !== 'own' && !chain.includes(layer)) setLayer('own'); }, [chain, layer]);
  const [tab, setTab] = useKept<Tab>('openfilm.color.tab', 'wheels');
  const [draft, setDraft] = React.useState<ColorWrite | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  /* a shot to be picked in the strip: the one to match to, or those to copy to */
  const [picking, setPicking] = React.useState<'match' | 'copy' | null>(null);
  React.useEffect(() => {
    if (!picking) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setPicking(null); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [picking]);
  React.useEffect(() => { setPicking(null); }, [first?.id]);
  /* a page's or a still's picture has no hue curves (src/color/page-grade.mjs): its curves are shown instead */
  const huelessShots = chosen.length > 0 && chosen.every(drawnOf);
  React.useEffect(() => { if (huelessShots && tab === 'hue') setTab('curves'); }, [huelessShots, tab, setTab]);

  /* the files read: every shot's chain (the strip shows each graded) and the chosen ones' own layers */
  const paths = React.useMemo(() => [...new Set([...chosen.map(ownPath), ...clips.flatMap((c) => chainOf(c.style))])], [chosen, clips]);
  const { text, ready } = useColorFiles(projectId, paths);

  /* ── who changed what: each file and each shot's chain as last seen; a change this page did not write is someone
     else's (the agent's), told in the feed and lit for a moment where it shows ── */
  const [feed, setFeed] = React.useState<Change[]>([]);
  const [lit, setLit] = React.useState<ReadonlySet<string>>(() => new Set());
  const seenText = React.useRef(new Map<string, string | null>());
  const seenChain = React.useRef(new Map<string, string>());
  const ownStyles = React.useRef(new Map<string, number>());
  const undoAt = React.useRef(0);
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') undoAt.current = Date.now(); };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  const opWord = React.useCallback((n: string) => (KNOWN[n] ? w(KNOWN[n]) : w(`op.${n}`) !== `plugin.color.op.${n}` ? w(`op.${n}`) : n), [w]);
  const tell = React.useCallback((agent: boolean, shots: string[], what: string[], also: string[] = []) => {
    const at = Date.now();
    setFeed((was) => {
      const top = was[0];
      if (top && top.agent === agent && at - top.at < 2500) return [{ at, agent, shots: [...new Set([...top.shots, ...shots])], what: [...new Set([...top.what, ...what])] }, ...was.slice(1)];
      return [{ at, agent, shots, what }, ...was].slice(0, 6);
    });
    if (!agent) return;
    setLit(new Set([...shots, ...also]));
    window.setTimeout(() => setLit((now) => (now.size ? new Set() : now)), 1800);
  }, []);
  React.useEffect(() => {
    for (const p of paths) {
      /* an input or an output is OpenFilm's own, copied in as a chain first needs it: not a change of the grade */
      if (roleOf(p) === 'input' || roleOf(p) === 'output') continue;
      const now = text(p);
      if (now === undefined) continue;
      if (!seenText.current.has(p)) { seenText.current.set(p, now); continue; }
      const was = seenText.current.get(p)!;
      if (was === now) continue;
      seenText.current.set(p, now);
      const shots = clips.filter((c) => chainOf(c.style).includes(p)).map((c) => c.id);
      tell(!writtenHere(projectId, p, now), shots, opsChanged(was, now).map(opWord), [p]);
    }
  }, [text, paths]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    for (const c of clips) {
      const after = chainOf(c.style);
      const had = seenChain.current.get(c.id);
      seenChain.current.set(c.id, after.join('|'));
      if (had === undefined || had === after.join('|')) continue;
      const mine = Date.now() - (ownStyles.current.get(c.id) ?? 0) < 6000 || Date.now() - undoAt.current < 3000;
      const before = had ? had.split('|') : [];
      const word = (f: string) => {
        const fl = filterOfUrl(f);
        if (fl) { const item = index?.items.find((i) => i.grade && isFilter(fl.slug, i.id)); return item ? nameOf(item.name, lang) : w('filter'); }
        return /(^|\/)in-/.test(f) ? w('footage') : /(^|\/)out-/.test(f) ? w('output').split(' ')[0]! : /(^|\/)shot-/.test(f) ? w('own') : layerName(f);
      };
      const what = [...after.filter((f) => !before.includes(f)).map((f) => `+ ${word(f)}`), ...before.filter((f) => !after.includes(f)).map((f) => `− ${word(f)}`)];
      if (what.length) tell(!mine, [c.id], what);
    }
  }, [clips]); // eslint-disable-line react-hooks/exhaustive-deps
  /* the feed's times, kept current while it shows any */
  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!feed.length) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, [feed.length]);
  const layerPath = layer === 'own' ? (first ? ownPath(first) : '') : layer;
  const layerText = draft?.files.find((f) => f.path === layerPath)?.text ?? text(layerPath);
  const isCube = layer !== 'own' && !/\.(ctf|clf)$/i.test(layer);
  const filterHere = parts.after.map(filterOfUrl).find(Boolean) ?? null;
  const layerIsFilter = layer !== 'own' && filterOfUrl(layer) != null;

  /** A clip's chain as texts, a write's changes (not written yet) included; null until all are read. */
  const textsOf = React.useCallback((clip: GradedClip, write: ColorWrite | null): Chain | null => {
    const d = write ? draftOf(write, clip.id) : null;
    const files = d ? d.files : chainOf(clip.style);
    const out: { name: string; text: string }[] = [];
    for (const f of files) {
      /* a page's or a still's input and output are not applied: not needed */
      if (drawnOf(clip) && leftOut(f)) continue;
      const t = d?.texts[f] ?? write?.files.find((x) => x.path === f)?.text ?? text(f) ?? STANDARD[f] ?? null;
      if (t == null) return null;
      out.push({ name: f, text: t });
    }
    return out;
  }, [text]);

  /* ── changes: shown as dragged, written when let go ── */
  const show = React.useCallback((write: ColorWrite) => { setDraft(write); host.preview(write, ids); }, [host, ids]);
  const revert = React.useCallback(() => { setDraft(null); host.preview(null, ids); }, [host, ids]);
  const write = React.useCallback(async (next: ColorWrite, label = 'history.stepColor') => {
    setDraft(null);
    for (const st of next.styles) ownStyles.current.set(st.id, Date.now());
    const failedWhy = await host.commit(next, label);
    if (failedWhy) { host.preview(null, ids); toast(failedWhy, { error: true }); }
  }, [host, ids]);
  const onLayer = (edit: (old: string | null) => string) => layerWrite(chosen, text, layer, edit, STANDARD);

  const run = async (what: string, job: () => Promise<void>) => {
    setBusy(what);
    try { await job(); } catch (e) { toast(e instanceof Error ? e.message : String(e), { error: true }); } finally { setBusy(null); }
  };
  const base = `projects/${encodeURIComponent(projectId)}`;
  const planned = async (route: string, body: object = {}) => {
    if (!first) return;
    const done = await server.post<{ path: string; text: string; chain: string[] }>(`${base}/clips/${encodeURIComponent(first.id)}/${route}`, body);
    await write({ files: [{ path: done.path, text: done.text }], styles: [{ id: first.id, style: withChain(first.style, done.chain) }] });
  };
  const setInput = (kind: string) => first && run('input', async () => {
    const got = await server.get<{ path: string; text: string }>(`${base}/input?src=${encodeURIComponent(first.src)}&kind=${encodeURIComponent(kind)}`);
    await write(inputWrite(chosen, text, got.path, got.text, STANDARD));
  });
  /* the grade off: the chain gone (log footage keeps its input and output), and each shot's own layer emptied, so
     nothing of it comes back with the next change */
  const reset = () => write({ files: chosen.flatMap((c) => (isEmptyLayer(text(ownPath(c))) ? [] : [{ path: ownPath(c), text: newCtf(ownPath(c).split('/').pop()!.replace(/\.ctf$/, '')) }])), styles: chosen.map((c) => {
    const p = partsOf(chainOf(c.style));
    return { id: c.id, style: withChain(c.style, p.input && p.input !== SDR_INPUT ? [p.input, p.output ?? OUTPUT] : []) };
  }) });
  const exportLut = () => first && run('export', async () => {
    const texts = await readColorTexts(projectId, chain);
    const ops = chain.flatMap((f) => parseColorTransform(texts(f) ?? '', f));
    const cube = cubeText(bake(ops, { size: 65 }), `OpenFilm grade of ${first.id}`);
    const a = document.createElement('a');
    const name = `${first.id}.cube`;
    a.href = URL.createObjectURL(new Blob([cube], { type: 'text/plain' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast(w('exported', { file: name }));
  });
  const fileInput = React.useRef<HTMLInputElement | null>(null);
  const importLut = async (files: FileList | null) => {
    if (!files?.length || !chosen.length) return;
    await run('import', async () => {
      const [path] = await projectOf(projectId).importFiles([...files], { into: 'looks' });
      if (!path) return;
      /* a .cube is most often a look made for the screen: last; a color transform file is a layer */
      const screen = /\.cube$/i.test(path);
      await write({ files: [], styles: chosen.map((c) => {
        const p = partsOf(chainOf(c.style));
        const next = screen ? [...(p.layers.length || p.input && p.input !== SDR_INPUT ? [p.input ?? SDR_INPUT, ...p.layers, p.output ?? OUTPUT] : []), ...p.after, path]
          : [p.input ?? SDR_INPUT, ...p.layers, path, p.output ?? OUTPUT, ...p.after];
        return { id: c.id, style: withChain(c.style, next) };
      }) });
      setLayer(path);
    });
  };
  const groups = React.useMemo(() => [...new Set(clips.flatMap((c) => partsOf(chainOf(c.style)).layers.filter((l) => /(^|\/)group-[^/]*\.(ctf|clf)$/i.test(l) || clips.filter((x) => chainOf(x.style).includes(l)).length > 1)))], [clips]);
  const addShared = () => {
    const used = new Set(clips.flatMap((c) => chainOf(c.style)));
    let n = 1;
    while (used.has(`looks/group-${n}.ctf`)) n++;
    const path = `looks/group-${n}.ctf`;
    void write(shareWrite(chosen, text, path, `group-${n}`, STANDARD)).then(() => setLayer(path));
  };

  /* a shot taken in the strip: picked, or (matching, copying) the one to match to or copy to */
  const takeShot = (clip: GradedClip, more: boolean) => {
    if (picking === 'match' && first && clip.id !== first.id) { setPicking(null); void run('match', () => planned('match', { to: clip.id })); return; }
    if (picking === 'copy' && first) {
      if (clip.id !== first.id) void write(copyWrite(first, [clip], text, STANDARD));
      return;
    }
    onShot(clip.id, more);
  };
  /* a shot's picture pressed and dragged across: the shot taken, the playhead along it where the pointer is (its line
     on the picture follows), as a viewer's scrub bar does; a press without a drag is a click (takeShot) */
  const scrub = React.useRef<{ id: string; x: number; moved: boolean } | null>(null);
  const scrubbed = React.useRef(0);
  const scrubTo = (clip: GradedClip, e: React.PointerEvent<HTMLElement>) => {
    const length = lengthOf(clip);
    if (!onSeek || length == null || !Number.isFinite(length)) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width));
    onSeek(clip.at + f * length);
  };
  /* the strip's keys: ← → the shot before or after, ⌘C the grade of the one in hand, ⌘V it on those in hand */
  const [copied, setCopied] = React.useState<string | null>(null);
  const stripKey = (e: React.KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const i = clips.findIndex((c) => c.id === first?.id);
    const take = () => { e.preventDefault(); e.stopPropagation(); };
    if (!mod && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      const next = clips[Math.max(0, Math.min(clips.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))];
      take();
      if (next) { takeShot(next, false); document.querySelector<HTMLElement>(`[data-shot="${CSS.escape(next.id)}"]`)?.focus(); }
    } else if (mod && e.key.toLowerCase() === 'c' && first) {
      take();
      setCopied(first.id);
      toast(w('copiedGrade', { name: fileName(first.src) }));
    } else if (mod && e.key.toLowerCase() === 'v' && copied) {
      const from = clips.find((c) => c.id === copied);
      const to = chosen.filter((c) => c.id !== copied);
      take();
      if (from && to.length) void write(copyWrite(from, to, text, STANDARD));
    }
  };
  React.useEffect(() => {
    if (first) document.querySelector(`[data-shot="${CSS.escape(first.id)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [first?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── what the scopes and the strip show ── */
  const second = first ? Math.round(secondOf(first, timeMs / 1000) * 24) / 24 : null;
  const [waveKind, setWaveKind] = useKept<Scope>('openfilm.color.scope', 'waveform');
  const scopeChain = React.useMemo(() => (first ? textsOf(first, draft) : null), [first, draft, textsOf]);
  const shotIs = React.useMemo(() => ({ drawn: drawnOf(first), page: pageOf(first) }), [first]);
  const scopes = useScopes(pictures, first?.src ?? null, second, scopeChain, waveKind === 'histogram' ? ['vectorscope'] : [waveKind, 'vectorscope'], shotIs);
  const latest = React.useRef({ scopes, first, chosen, text, layer, textsOf });
  latest.current = { scopes, first, chosen, text, layer, textsOf };
  /* the white balance picked off the picture: a spot that should be white or grey, made so through the whole grade */
  const [eyedrop, setEyedrop] = React.useState(false);
  const pickWhite = () => {
    if (!onPickPoint || !pictures) return;
    if (eyedrop) return;
    setEyedrop(true);
    onPickPoint((point) => {
      setEyedrop(false);
      const now = latest.current;
      if (!point || !now.first || !now.scopes?.frame) return;
      const lay = now.layer === 'own' ? ownPath(now.first) : now.layer;
      /* the picture as the grade leaves it, before a filter or LUT for the screen: a look's own color stays */
      const whole = now.textsOf(now.first, adjustWrite([now.first], now.text, () => ({}), STANDARD, now.layer));
      if (!whole) return;
      const screen = partsOf(whole.map((f) => f.name)).after;
      const chainNow = whole.filter((f) => !screen.includes(f.name));
      const n = pictures.seq();
      void new Promise<Picked | null>((done) => {
        const off = pictures.listen((m: FromWorker) => { if ((m.type === 'picked' || m.type === 'failed') && m.seq === n) { off(); done(m.type === 'picked' ? m : null); } });
        pictures.worker.postMessage({ type: 'pick', seq: n, key: now.scopes!.frame!, chain: chainNow.map((f) => ({ ...f })), layer: lay, x: point.x, y: point.y, drawn: drawnOf(now.first) });
      }).then((got) => {
        if (got) void write(adjustWrite(now.chosen, now.text, () => ({ temperature: got.temperature, tint: got.tint }), STANDARD, now.layer));
      });
    });
  };
  const shotThumbs = useThumbs(pictures, React.useMemo(() => clips.map((c) => ({ id: c.id, src: c.src, second: Math.round(secondOf(c, null) * 4) / 4, chain: textsOf(c, null), drawn: drawnOf(c), page: pageOf(c) })), [clips, textsOf]), 200);

  const blockScopes = useBlock('color', 'scopes');
  const blockShots = useBlock('color', 'shots');
  const blockTools = useBlock('color', 'tools');

  const t = timeMs / 1000;
  const strip = (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--bg-panel)]">
      {/* picking a shot to match to or copy to: said over the strip, the shots where they are */}
      {picking ? (
        <div role="status" className="absolute right-3 top-1.5 z-10 flex items-center gap-0.5 rounded-full bg-[var(--accent)] py-[3px] pl-3 pr-1 text-[11px] text-[var(--accent-text,#fff)] shadow-[0_4px_14px_rgba(0,0,0,0.45)]">
          <span className="mr-1.5 truncate">{w(picking === 'match' ? 'pickMatch' : 'pickCopy')}</span>
          {picking === 'copy' && first ? (
            <button type="button" className="rounded-full px-2 py-px hover:bg-white/15"
              onClick={() => { void write(copyWrite(first, clips.filter((c) => c.id !== first.id), text, STANDARD)); setPicking(null); }}>{w('allClips')}</button>
          ) : null}
          <button type="button" className="rounded-full px-2 py-px hover:bg-white/15" onClick={() => setPicking(null)}>{w(picking === 'copy' ? 'done' : 'cancel')}<span className="ml-1 opacity-70">Esc</span></button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 px-3 py-2">
      {/* a shot's width from the strip's height: its picture in the film's frame, its name under it */}
      <div role="listbox" aria-label={w('shots')} aria-multiselectable className="flex h-full gap-2 overflow-x-auto overflow-y-hidden" style={{ containerType: 'size' }} onKeyDown={stripKey}>
        {clips.length ? clips.map((c, i) => {
          const p = partsOf(chainOf(c.style));
          const shared = p.layers.filter((l) => groups.includes(l));
          const graded = p.after.length > 0 || p.layers.some((l) => !isEmptyLayer(text(l)));
          const kind = kindOf(p.input);
          const note = shared.length ? w('groupNote', { name: layerName(shared[0]!) }) : drawnOf(c) ? w(c.kind === 'page' ? 'kindPage' : 'kindStill')
            : kind !== 'rec709' ? w(`input.${kind}`) : graded ? '' : w('notGraded');
          const on = current.includes(c.id);
          const along = alongOf(c, t);
          const thumb = shotThumbs[c.id];
          return (
            <div key={c.id} data-shot={c.id} role="option" aria-selected={on} tabIndex={0} title={`${c.src}\n${w('scrubTip')}`}
              onClick={(e) => { if (Date.now() - scrubbed.current < 250) return; takeShot(c, e.shiftKey || e.metaKey || e.ctrlKey); }} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); takeShot(c, e.shiftKey); } }}
              className={`group flex h-full shrink-0 cursor-default flex-col gap-1 outline-none ${picking && first?.id !== c.id ? 'cursor-crosshair' : ''}`}
              style={{ width: `calc((100cqh - 19px) * ${THUMB_ASPECT})` }}>
              <div style={{ boxShadow: lit.has(c.id) ? GLOW : undefined }}
                onPointerDown={(e) => { if (e.button !== 0 || picking || e.shiftKey || e.metaKey || e.ctrlKey) return; e.currentTarget.setPointerCapture(e.pointerId); scrub.current = { id: c.id, x: e.clientX, moved: false }; }}
                onPointerMove={(e) => {
                  const d = scrub.current;
                  if (!d || d.id !== c.id || (!d.moved && Math.abs(e.clientX - d.x) < 3)) return;
                  if (!d.moved) { d.moved = true; if (!current.includes(c.id) || current.length > 1) onShot(c.id, false); }
                  scrubTo(c, e);
                }}
                onPointerUp={(e) => { const d = scrub.current; scrub.current = null; if (d?.moved) { e.stopPropagation(); scrubbed.current = Date.now(); } }}
                onPointerCancel={() => { scrub.current = null; }}
                className={`relative min-h-0 flex-1 cursor-ew-resize overflow-hidden rounded-[6px] bg-black ring-offset-0 transition-[box-shadow] duration-500 ${on ? 'ring-2 ring-[var(--accent)]' : picking && first?.id !== c.id ? 'ring-1 ring-white/30 group-hover:ring-2 group-hover:ring-white/70' : 'ring-1 ring-white/[0.06] group-hover:ring-white/25'}`}>
                {thumb ? <img src={thumb} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" /> : null}
                <span className="absolute left-1 top-1 rounded-[4px] bg-black/70 px-1 font-mono text-[10px] leading-[14px] text-white/90">{String(i + 1).padStart(2, '0')}</span>
                {graded ? <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow-[0_0_0_1px_rgba(0,0,0,0.6)]" aria-label={w('graded')} /> : null}
                {shared.length ? <span className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: groupColor(shared[0]!, groups) }} /> : null}
                {along != null ? <span className="absolute inset-y-0 w-px bg-white/90 shadow-[0_0_0_0.5px_rgba(0,0,0,0.6)]" style={{ left: `${along * 100}%` }} /> : null}
              </div>
              <div className="flex h-[15px] shrink-0 items-baseline justify-between gap-2 text-[11px] leading-[15px]">
                <span className={`min-w-0 truncate ${on ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{fileName(c.src)}</span>
                {note ? <span className="shrink-0 truncate text-[10.5px] text-[var(--text-faint)]">{note}</span> : null}
              </div>
            </div>
          );
        }) : <p className="m-auto text-[11.5px] text-[var(--text-faint)]">{w('noShots')}</p>}
      </div>
      </div>
    </div>
  );

  const scopesPane = (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-y-auto bg-[var(--bg-panel)] px-3 pb-3 pt-2">
      <Segmented value={waveKind} onChange={(s) => setWaveKind(s as Scope)} items={(['waveform', 'parade', 'histogram'] as const).map((s) => ({ value: s, label: w(`scope.${s}`) }))} label={w('scope.waveform')} />
      <div className="relative min-h-[64px] flex-[1.1] overflow-hidden rounded-[6px] bg-[#0b0b0c]">
        <ScopeView drawn={waveKind === 'histogram' ? null : scopes?.scopes[waveKind]} scope={waveKind} bins={scopes?.bins ?? null} />
      </div>
      <span className="text-[11px] text-[var(--text-faint)]">{w('scope.vectorscope')}</span>
      <div className="relative min-h-[84px] flex-[1.4] overflow-hidden rounded-[6px]">
        <ScopeView drawn={scopes?.scopes.vectorscope} scope="vectorscope" />
      </div>
      <div className="grid shrink-0 grid-cols-3 gap-1.5">
        <Reading label={w('read.middle')} value={scopes ? `${Math.round(scopes.read.middle * 100)} IRE` : '—'} />
        <Reading label={w('read.white')} value={scopes ? `${Math.round(scopes.read.kelvin / 10) * 10} K` : '—'} />
        <Reading label={w('read.clipped')} value={scopes ? `${(scopes.read.clipped * 100).toFixed(1)} %` : '—'} warn={(scopes?.read.clipped ?? 0) > 0.01} />
      </div>
      <p className="shrink-0 text-[10.5px] leading-[15px] text-[var(--text-faint)]">{w('scopeNote')}</p>
    </div>
  );

  let tools: React.ReactNode;
  if (!clips.length) {
    /* nothing to grade: what this workbench grades, why there is none here, and where it is put in */
    tools = (
      <Start icon={<Palette size={20} />} title={w('startNone')} body={w('startNoneBody')}
        steps={[w('startNoneStep1'), w('startNoneStep2')]}
        action={onLeave ? <button type="button" onClick={onLeave} className={START_BTN}>{w('toEdit')}</button> : null} />
    );
  } else if (!first) {
    /* shots, none taken: how a grade starts, and the first shot a click away */
    tools = (
      <Start icon={<Palette size={20} />} title={w('startPick')} body={w('startPickBody')}
        steps={[w('startStep1'), w('startStep2'), w('startStep3')]}
        action={<button type="button" onClick={() => onShot(clips[0]!.id, false)} className={START_BTN}>{w('startFirst')}</button>} />
    );
  } else {
    /* ── the stack: the grade's files in the order they apply ── */
    const sharedBy = (path: string) => clips.filter((c) => chainOf(c.style).includes(path)).length;
    const opsIn = (t2: string | null | undefined) => operations(t2).map((el) => el.name ?? el.tag);
    const summary = (path: string) => [...new Set(opsIn(draft?.files.find((f) => f.path === path)?.text ?? text(path)).map((n) => (KNOWN[n] ? w(KNOWN[n]) : w(`op.${n}`) !== `plugin.color.op.${n}` ? w(`op.${n}`) : n)))].join(' · ');
    const filterItemOf = (url: string) => { const f = filterOfUrl(url); return f ? index?.items.find((i) => i.grade && isFilter(f.slug, i.id)) : undefined; };
    const kindsHere = new Set(chosen.map((c) => kindOf(partsOf(chainOf(c.style)).input)));
    /* every shot taken is drawn by the browser (a page, a still): graded as shown, without hue curves or an input */
    const allDrawn = chosen.every(drawnOf);
    /* a file of the grade given to the chat, for the agent to read and change */
    const pointAt = (path: string) => (chat.refer ? (
      <RowAction label={w('pointAgent')} onClick={() => chat.refer?.({ kind: 'file', path, fileKind: 'color' })}><MessageSquarePlus size={11} /></RowAction>
    ) : null);

    const stack = (
      <div className="flex h-full min-h-0 flex-col border-r border-[var(--border)]">
        <div className="flex h-9 shrink-0 items-center justify-between px-3">
          <span className="text-[12px] font-medium text-[var(--text)]">{chosen.length > 1 ? w('stackMany', { n: chosen.length }) : w('stack')}</span>
          <span className="text-[10.5px] text-[var(--text-faint)]">{w('stackHint')}</span>
        </div>
        <div role="listbox" aria-label={w('layers')} className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2">
          {allDrawn ? (
            /* a page's or a still's picture is what the screen shows already: no footage to bring in */
            <div className="flex h-8 items-center gap-2 px-2 text-[11.5px] text-[var(--text-muted)]" title={w('drawnInTip')}>
              <Swatch fill="#3a3a3c" />{w('drawnIn', { kind: w(first.kind === 'page' ? 'kindPage' : 'kindStill') })}
            </div>
          ) : (
            <div className="flex items-center gap-2 px-1">
              <Swatch fill="#3a3a3c" />
              <div className="min-w-0 flex-1">
                <MenuSelect label={w('footage')} prefix={w('footage')} value={kindsHere.size === 1 ? [...kindsHere][0]! : ''} disabled={busy !== null} menuWidth="content" size="xs"
                  groups={[{ choices: INPUTS.map((k) => ({ value: k, label: w(`input.${k}`) })) }]} onPick={(k) => { void setInput(k); }} />
              </div>
            </div>
          )}
          <Joint />
          {parts.layers.filter((l) => l !== ownPath(first)).map((l) => (
            <StackRow key={l} on={layer === l} lit={lit.has(l)} onPick={() => setLayer(l)} swatch={<Swatch fill={groupColor(l, groups)} />} name={layerName(l)} note={w('shared', { n: sharedBy(l) })}
              actions={<>
                {pointAt(l)}
                {roleOf(l) === 'layer' && /\.(ctf|clf)$/i.test(l) && chosen.length === 1 ? <RowAction label={w('detach')} onClick={() => { void write(detachWrite(first, text, l, STANDARD)).then(() => setLayer('own')); }}><Unlink size={11} /></RowAction> : null}
                <RowAction label={w('remove')} onClick={() => { void write(removeWrite(chosen, l)); }}><Minus size={11} /></RowAction>
              </>} />
          ))}
          <StackRow on={layer === 'own'} lit={chosen.some((c) => lit.has(ownPath(c)))} onPick={() => setLayer('own')} swatch={<Swatch fill="var(--accent)" />} name={chosen.length > 1 ? w('ownMany') : w('own')}
            note={chosen.length > 1 ? w('clips', { n: chosen.length }) : summary(ownPath(first)) || w('empty')}
            actions={chosen.length === 1 && text(ownPath(first)) ? pointAt(ownPath(first)) : undefined} />
          {parts.after.map((l) => {
            const f = filterOfUrl(l);
            const item = filterItemOf(l);
            return (
              <StackRow key={l} on={layer === l} lit={lit.has(l)} onPick={() => { setLayer(l); if (f) setTab('styles'); }} swatch={<Swatch fill={f ? 'linear-gradient(135deg,#e2b07a,#7a8fb0)' : '#555'} />}
                name={item ? nameOf(item.name, lang) : layerName(l)} note={f ? `${Math.round(f.amount * 100)}%` : w('lut')}
                actions={<RowAction label={w('remove')} onClick={() => { void write(removeWrite(chosen, l)); }}><Minus size={11} /></RowAction>} />
            );
          })}
          <Joint />
          <div className="flex h-8 items-center gap-2 px-2 text-[11.5px] text-[var(--text-faint)]"><Swatch fill="#2a2a2c" />{allDrawn ? w('drawnOut') : w('output')}</div>
        </div>
        <div className="flex shrink-0 gap-1.5 px-3 pb-3 pt-2">
          <Tooltip label={w('addSharedTip')}><button type="button" className={SMALL_BTN} onClick={addShared}><Plus size={12} />{w('addShared')}</button></Tooltip>
          <button type="button" className={SMALL_BTN} onClick={() => setTab('styles')}><Plus size={12} />{w('filter')}</button>
          <button type="button" className={SMALL_BTN} onClick={() => fileInput.current?.click()}><Upload size={12} />{w('importLut')}</button>
        </div>
      </div>
    );

    /* ── the controls of the picked layer ── */
    const adjust = adjustOf(layerText ?? null);
    const adjustAt = (key: AdjustKey, v: number) => adjustWrite(chosen, text, () => ({ [key]: v }), STANDARD, layer);
    const valueOf = (key: AdjustKey): number | Mixed => {
      const values = layer === 'own' ? chosen.map((c) => (draft ? adjustOf(draft.files.find((f) => f.path === ownPath(c))?.text ?? text(ownPath(c))) : clipAdjust(c, text))[key]) : [adjust[key]];
      return values.every((x) => x === values[0]) ? values[0]! : MIXED;
    };
    const slider = (key: AdjustKey) => {
      const r = ADJUST_RANGE[key];
      return (
        <DeskSlider key={key} label={w(`key.${key}`)} value={ready ? valueOf(key) : undefined} min={r.min} max={r.max} step={r.step} unit={UNIT[key] ?? ''} track={TRACK[key]}
          onPreview={(v) => show(adjustAt(key, v))} onCommit={(v) => { void write(adjustAt(key, v)); }} onRevert={revert} />
      );
    };
    const wheels = wheelsOf(layerText ?? null);
    const wheelWrite = (zone: Zone, wheel: Wheel) => onLayer((old) => withWheels(old, { [zone]: wheel }));
    const overall = overallWheel(adjust.temperature, adjust.tint, adjust.exposure);
    const overallWrite = (wh: Wheel) => adjustWrite(chosen, text, () => overallOf(wh), STANDARD, layer);
    const rgb = curvesOf(layerText ?? null), hue = hueCurvesOf(layerText ?? null);
    const histogram = scopes?.bins ? Array.from(scopes.bins.subarray(768, 1024)) : null;
    const more = operations(layerText).filter((el) => !el.name || !KNOWN[el.name]);

    /* what puts the tab shown back as it was, when there is anything to (null: nothing) */
    const PLAIN: Wheel = { r: 1, g: 1, b: 1, m: 1 };
    const curvesChanged = (pts: Record<string, Points>) => Object.entries(pts).some(([k, v]) => JSON.stringify(v) !== JSON.stringify(PLAIN_CURVE[k as RgbCurve | HueCurve]));
    const tabReset: ColorWrite | null = isCube || layerIsFilter ? (tab === 'styles' && filterHere ? filterWrite(chosen, text, null, 0, STANDARD) : null)
      : tab === 'basic' ? (ADJUST_KEYS.some((k) => adjust[k]) ? adjustWrite(chosen, text, () => Object.fromEntries(ADJUST_KEYS.map((k) => [k, 0])), STANDARD, layer) : null)
      : tab === 'wheels' ? ((['shadows', 'midtones', 'highlights'] as const).some((z) => JSON.stringify(wheels[z]) !== JSON.stringify(PLAIN)) || adjust.temperature || adjust.tint || adjust.exposure
        ? onLayer((old) => withAdjust(withWheels(old, { shadows: PLAIN, midtones: PLAIN, highlights: PLAIN }), { temperature: 0, tint: 0, exposure: 0 })) : null)
      : tab === 'curves' ? (curvesChanged(rgb) ? onLayer((old) => withCurves(old, Object.fromEntries(RGB.map((k) => [k, PLAIN_CURVE[k]])))) : null)
      : tab === 'hue' ? (curvesChanged(hue) ? onLayer((old) => withHueCurves(old, Object.fromEntries(HUES.map((k) => [k, PLAIN_CURVE[k]])))) : null)
      : filterHere ? filterWrite(chosen, text, null, 0, STANDARD) : null;

    const controls = (() => {
      if (tab === 'styles') return <Styles key={first.id} w={w} items={index?.items ?? []} first={first} chosen={chosen} text={text} textsOf={textsOf} pictures={pictures} second={second}
        current={filterHere} onShow={show} onRevert={revert} onWrite={(wr) => { void write(wr); }} />;
      if (layerIsFilter) return <Note>{w('filterLayer')}</Note>;
      if (isCube) return <Note>{w('fileLayer')}</Note>;
      if (tab === 'basic') return (
        <div className="flex h-full flex-col gap-4 overflow-y-auto px-5 py-3">
          <div className="grid grid-cols-4 gap-x-6 gap-y-4">{(['temperature', 'tint', 'exposure', 'contrast', 'highlights', 'shadows', 'saturation'] as const).map(slider)}</div>
          {more.length ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] text-[var(--text-faint)]">{w('more')}</span>
              {more.map((el) => (
                <span key={`${el.tag}-${el.name}-${el.from}`} className="group flex h-6 items-center gap-1 rounded-full bg-[var(--bg-field)] pl-2.5 pr-1 text-[11px] text-[var(--text-muted)]" title={el.tag}>
                  {el.name ? (w(`op.${el.name}`) !== `plugin.color.op.${el.name}` ? w(`op.${el.name}`) : el.name) : el.tag}
                  {el.name ? <RowAction label={w('removeOp')} onClick={() => { void write(onLayer((old) => setOp(old ?? '', el.name!, null))); }}><Minus size={10} /></RowAction> : <span className="w-1.5" />}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      );
      if (tab === 'wheels') return (
        <Measured className="flex h-full min-h-0 flex-col justify-center gap-4 overflow-y-auto px-5 py-3">
          {(box) => {
            const size = Math.round(Math.max(84, Math.min(176, box.h - 156, (box.w - 40 - 3 * 24) / 4)));
            return (
              <>
                <div className="flex items-start justify-around gap-6">
                  {(['shadows', 'midtones', 'highlights'] as const).map((z) => (
                    <ColorWheel key={`${layerPath}-${z}`} wheel={wheels[z]} label={w(z)} size={size}
                      onPreview={(wh) => show(wheelWrite(z, wh))} onCommit={(wh) => { void write(wheelWrite(z, wh)); }}
                      onReset={() => { void write(wheelWrite(z, { r: 1, g: 1, b: 1, m: 1 })); }} />
                  ))}
                  <ColorWheel key={`${layerPath}-overall`} wheel={overall} label={w('overall')} size={size}
                    readout={(wh) => { const e = overallOf(wh).exposure; return `${e > 0 ? '+' : ''}${e.toFixed(2)} EV`; }}
                    detail={(wh) => {
                      const o = overallOf(wh);
                      const n = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`;
                      return (
                        <span className="flex gap-2" title={`${w('key.temperature')} ${n(o.temperature)} · ${w('key.tint')} ${n(o.tint)}`}>
                          <span className="text-[#e0a85a]">{n(o.temperature)}</span><span className="text-[#d77fd0]">{n(o.tint)}</span>
                        </span>
                      );
                    }}
                    onPreview={(wh) => show(overallWrite(wh))} onCommit={(wh) => { void write(overallWrite(wh)); }}
                    onReset={() => { void write(adjustWrite(chosen, text, () => ({ temperature: 0, tint: 0, exposure: 0 }), STANDARD, layer)); }} />
                </div>
                <div className="grid grid-cols-4 gap-x-6">{(['temperature', 'tint', 'contrast', 'saturation'] as const).map(slider)}</div>
              </>
            );
          }}
        </Measured>
      );
      if (tab === 'curves') return (
        <CurvesPane w={w} kinds={RGB} key={`rgb-${layerPath}`} points={rgb} histogram={histogram} prefKey="openfilm.color.curve"
          onPreview={(k, p) => show(onLayer((old) => withCurves(old, { [k]: p })))} onCommit={(k, p) => { void write(onLayer((old) => withCurves(old, { [k]: p }))); }} />
      );
      return (
        <CurvesPane w={w} kinds={HUES} key={`hue-${layerPath}`} points={hue} histogram={null} prefKey="openfilm.color.hue"
          onPreview={(k, p) => show(onLayer((old) => withHueCurves(old, { [k]: p })))} onCommit={(k, p) => { void write(onLayer((old) => withHueCurves(old, { [k]: p }))); }} />
      );
    })();

    const actions = (
      <div className="flex h-full min-h-0 flex-col gap-1.5 overflow-y-auto border-l border-[var(--border)] px-3 pb-3">
        <span className="flex h-9 shrink-0 items-center text-[12px] font-medium text-[var(--text)]">{w('oneClick')}</span>
        <ActionRow icon={<Wand2 size={13} />} label={busy === 'auto' ? w('working') : w('auto')} note={w('autoNote')} tip={w('autoTip')} disabled={busy !== null || chosen.length > 1}
          onClick={() => { void run('auto', () => planned('balance')); }} />
        <ActionRow label={busy === 'match' ? w('working') : w('matchTo')} note={w('matchNote')} tip={w('matchTip')} on={picking === 'match'} disabled={busy !== null || chosen.length > 1 || clips.length < 2}
          onClick={() => setPicking((p) => (p === 'match' ? null : 'match'))} />
        <ActionRow label={w('copyTo')} note={w('copyNote')} tip={w('copyTip')} on={picking === 'copy'} disabled={busy !== null || chosen.length > 1 || clips.length < 2}
          onClick={() => setPicking((p) => (p === 'copy' ? null : 'copy'))} />
        <ActionRow icon={<RotateCcw size={12} />} label={w('reset')} tip={w('resetTip')} disabled={busy !== null} onClick={() => { void reset(); }} />
        <ActionRow icon={<Download size={12} />} label={w('exportLut')} note=".cube" tip={allDrawn ? w('exportLutDrawn') : undefined} disabled={busy !== null || !chain.length || allDrawn} onClick={() => { void exportLut(); }} />
        {onRefer ? <ActionRow icon={<Sparkles size={12} />} label={w('toAgent')} note="⌘L" tip={w('toAgentTip')} onClick={() => onRefer(ids)} /> : null}
        {/* what the person and the agent changed, newest first: a click takes that shot */}
        <div className="mt-2 flex shrink-0 flex-col">
          <span className="flex h-6 shrink-0 items-center text-[11px] text-[var(--text-faint)]">{w('together')}</span>
          {feed.length ? (
            <div className="flex flex-col gap-px">
              {feed.map((f) => {
                const shot = f.shots.length === 1 ? clips.findIndex((c) => c.id === f.shots[0]) : -1;
                const where = shot >= 0 ? `${String(shot + 1).padStart(2, '0')} ${fileName(clips[shot]!.src)}` : f.shots.length ? w('clips', { n: f.shots.length }) : '';
                const ago = Math.round((Date.now() - f.at) / 60_000);
                return (
                  <button key={f.at} type="button" onClick={() => { if (f.shots[0]) onShot(f.shots[0], false); }}
                    className="flex w-full items-start gap-2 rounded-[6px] px-1.5 py-1 text-left transition hover:bg-[var(--bg-hover)]">
                    <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${f.agent ? 'bg-[var(--accent)]' : 'bg-white/25'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className={`truncate ${f.agent ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{f.agent ? w('byAgent') : w('byYou')}{where ? ` · ${where}` : ''}</span>
                        <span className="shrink-0 text-[10px] text-[var(--text-faint)]">{ago < 1 ? w('justNow') : w('minutesAgo', { n: ago })}</span>
                      </span>
                      <span className="block truncate text-[10.5px] text-[var(--text-faint)]">{f.what.join(' · ') || w('changed')}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="rounded-[8px] border border-dashed border-[var(--border-strong,var(--border))] px-2.5 py-2 text-[10.5px] leading-[15px] text-[var(--text-faint)]">{w('agentNote')}</p>
          )}
        </div>
      </div>
    );

    tools = (
      <div className="grid h-full min-h-0 grid-cols-[minmax(220px,264px)_minmax(0,1fr)_minmax(196px,232px)] bg-[var(--bg-panel)] text-[var(--text)]">
        {stack}
        <div className="flex min-h-0 min-w-0 flex-col">
          <div role="tablist" aria-label={w('controls')} className="flex h-9 shrink-0 items-center gap-0.5 px-3">
            {TABS.map((k) => {
              const off = (k !== 'styles' && (isCube || layerIsFilter)) || (k === 'hue' && allDrawn);
              return (
                <Tooltip key={k} label={k === 'hue' && allDrawn ? w('hueDrawn') : w(`tabTip.${k}`)} side="top">
                  <button type="button" role="tab" aria-selected={tab === k} disabled={off} onClick={() => setTab(k)}
                    className={`rounded-[6px] px-2.5 py-1 text-[12px] transition disabled:opacity-35 ${tab === k ? 'bg-[var(--bg-selected)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>{w(k)}</button>
                </Tooltip>
              );
            })}
            <span className="flex-1" />
            {layer !== 'own' && !layerIsFilter ? <span className="mr-2 flex items-center gap-1 text-[10.5px] text-[var(--text-faint)]"><Link2 size={11} />{w('editingShared', { name: layerName(layer), n: sharedBy(layer) })}</span> : null}
            {(tab === 'basic' || tab === 'wheels') && onPickPoint && !isCube && !layerIsFilter ? (
              <Tooltip label={w('pickWhiteTip')}>
                <button type="button" aria-pressed={eyedrop} onClick={pickWhite}
                  className={`flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[11.5px] transition ${eyedrop ? 'bg-[var(--accent)] text-[var(--accent-text,#fff)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
                  <Pipette size={13} />{w('pickWhite')}
                </button>
              </Tooltip>
            ) : null}
            {tabReset ? (
              <Tooltip label={w('resetTab')}>
                <button type="button" aria-label={w('resetTab')} onClick={() => { void write(tabReset); }}
                  className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><RotateCcw size={13} /></button>
              </Tooltip>
            ) : null}
          </div>
          <div className="min-h-0 flex-1">{controls}</div>
        </div>
        {actions}
        <input ref={fileInput} type="file" accept=".cube,.ctf,.clf" hidden onChange={(e) => { void importLut(e.target.files); e.target.value = ''; }} />
      </div>
    );
  }

  return (
    <>
      {blockScopes.shown ? createPortal(scopesPane, blockScopes.slot) : null}
      {blockShots.shown ? createPortal(strip, blockShots.slot) : null}
      {blockTools.shown ? createPortal(tools, blockTools.slot) : null}
    </>
  );
}

const SMALL_BTN = 'flex h-7 items-center gap-1 rounded-[6px] bg-[var(--bg-field)] px-2 text-[11.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';

function Swatch({ fill }: { fill: string }) {
  return <span className="h-3 w-3 shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" style={{ background: fill }} />;
}
/** The line between the stack's rows: the grade goes on down. */
function Joint() {
  return <span aria-hidden className="ml-[13px] h-2 w-px bg-[var(--border)]" />;
}
function StackRow({ on, lit = false, onPick, swatch, name, note, actions }: { on: boolean; lit?: boolean; onPick: () => void; swatch: React.ReactNode; name: string; note: string; actions?: React.ReactNode }) {
  return (
    <div role="option" aria-selected={on} tabIndex={0} onClick={onPick} onKeyDown={(e) => { if (e.key === 'Enter') onPick(); }}
      style={{ boxShadow: lit ? GLOW : undefined }}
      className={`group flex h-8 shrink-0 cursor-default items-center gap-2 rounded-[6px] px-2 text-[12px] outline-none transition-[background-color,box-shadow] duration-500 ${on ? 'bg-[var(--bg-selected)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}>
      {swatch}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      <span className="shrink-0 truncate text-[10.5px] text-[var(--text-faint)] group-hover:hidden">{note}</span>
      {actions ? <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">{actions}</span> : null}
    </div>
  );
}
function RowAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip label={label}>
      <button type="button" aria-label={label} className="rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--bg-pressed)] hover:text-[var(--text)]"
        onClick={(e) => { e.stopPropagation(); onClick(); }}>{children}</button>
    </Tooltip>
  );
}
function ActionRow({ icon, label, note, tip, on = false, disabled, onClick }: { icon?: React.ReactNode; label: string; note?: string; tip?: string; on?: boolean; disabled?: boolean; onClick: () => void }) {
  const b = (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick}
      className={`flex h-8 w-full shrink-0 items-center gap-2 rounded-[7px] px-2.5 text-left text-[12px] transition disabled:pointer-events-none disabled:opacity-40 ${on ? 'bg-[var(--accent)] text-[var(--accent-text,#fff)]' : 'bg-[var(--bg-field)] text-[var(--text)] hover:bg-[var(--bg-hover)]'}`}>
      {icon ? <span className={on ? '' : 'text-[var(--text-muted)]'}>{icon}</span> : null}
      <span className="shrink-0">{label}</span>
      {note ? <span className={`min-w-0 flex-1 truncate text-right text-[10.5px] ${on ? 'opacity-80' : 'text-[var(--text-faint)]'}`}>{note}</span> : null}
    </button>
  );
  return tip ? <Tooltip label={tip}>{b}</Tooltip> : b;
}
function Reading({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col rounded-[6px] bg-[var(--bg-field)] px-2 py-1.5">
      <span className="truncate text-[10px] text-[var(--text-faint)]">{label}</span>
      <span className={`truncate font-mono text-[12px] tabular-nums ${warn ? 'text-[var(--warn)]' : 'text-[var(--text)]'}`}>{value}</span>
    </div>
  );
}
const START_BTN = 'mt-1 flex h-8 items-center rounded-[7px] bg-[var(--bg-selected)] px-3.5 text-[12px] font-medium text-[var(--text)] transition hover:bg-[var(--bg-pressed)]';

/** Where the controls are while there is nothing to grade yet: what to do, in steps, and the first of them a click. */
function Start({ icon, title, body, steps, action }: { icon: React.ReactNode; title: string; body: string; steps: readonly string[]; action: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-[var(--bg-panel)] px-8 py-6">
      <div className="flex max-w-[460px] flex-col items-start gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[var(--bg-hover)] text-[var(--text-muted)]">{icon}</span>
        <div className="flex flex-col gap-1">
          <h3 className="text-[14px] font-medium text-[var(--text)]">{title}</h3>
          <p className="text-[12.5px] leading-[19px] text-[var(--text-muted)]">{body}</p>
        </div>
        <ol className="flex flex-col gap-1.5">
          {steps.map((step, i) => (
            <li key={step} className="flex gap-2.5 text-[12.5px] leading-[19px] text-[var(--text-muted)]">
              <span className="mt-[1px] grid h-[17px] w-[17px] shrink-0 place-items-center rounded-full bg-[var(--bg-hover)] font-mono text-[10px] text-[var(--text)]">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {action}
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="flex h-full items-center justify-center px-10 text-center text-[11.5px] leading-[17px] text-[var(--text-faint)]">{children}</p>;
}
function Segmented({ value, onChange, items, label }: { value: string; onChange: (v: string) => void; items: { value: string; label: string }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex shrink-0 gap-0.5">
      {items.map((it) => (
        <button key={it.value} type="button" role="tab" aria-selected={value === it.value} onClick={() => onChange(it.value)}
          className={`rounded-[5px] px-2 py-[3px] text-[11.5px] transition ${value === it.value ? 'bg-[var(--bg-selected)] text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'}`}>{it.label}</button>
      ))}
    </div>
  );
}

/**
 * A slider of the desk: its name and value over a track that shows what it pushes toward. Dragged, it shows; let go,
 * it writes. Shift drags finely, a double-click puts it back at 0, the arrow keys step it, and its number can be typed.
 */
function DeskSlider({ label, value, min, max, step, unit = '', track, onPreview, onCommit, onRevert }: {
  label: string; value: number | Mixed | undefined; min: number; max: number; step: number; unit?: string; track?: string;
  onPreview: (v: number) => void; onCommit: (v: number) => void; onRevert: () => void;
}) {
  const [live, setLive] = React.useState<number | null>(null);
  const [typing, setTyping] = React.useState<string | null>(null);
  const bar = React.useRef<HTMLDivElement | null>(null);
  const drag = React.useRef<{ x: number; v: number } | null>(null);
  const num = typeof value === 'number' ? value : 0;
  const shown = live ?? num;
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const at = (clientX: number) => { const r = bar.current!.getBoundingClientRect(); return snap(min + ((clientX - r.left) / r.width) * (max - min)); };
  const decimals = step < 1 ? Math.max(0, -Math.floor(Math.log10(step))) : 0;
  const text = value === MIXED && live == null ? '—' : value === undefined ? '' : `${shown > 0 ? '+' : ''}${shown.toFixed(decimals)}${unit}`;
  const frac = (shown - min) / (max - min), zero = (0 - min) / (max - min);
  const set = (v: number) => { setLive(v); onPreview(v); };
  const done = (v: number | null) => { setLive(null); if (v == null) onRevert(); else onCommit(v); };
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[11.5px]">
        <span className="truncate text-[var(--text-muted)]">{label}</span>
        {typing != null ? (
          <input autoFocus value={typing} onChange={(e) => setTyping(e.target.value)} aria-label={label}
            onBlur={() => { const v = Number.parseFloat(typing); setTyping(null); if (Number.isFinite(v)) onCommit(snap(v)); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { e.stopPropagation(); setTyping(null); } }}
            className="w-14 rounded-[4px] bg-[var(--bg-field)] px-1 text-right font-mono text-[11.5px] tabular-nums text-[var(--text)] outline-none ring-1 ring-[var(--accent)]" />
        ) : (
          <button type="button" className="font-mono text-[11.5px] tabular-nums text-[var(--text)] hover:text-[var(--accent)]" onClick={() => setTyping(typeof value === 'number' ? String(value) : '')}>{text}</button>
        )}
      </div>
      <div ref={bar} role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={typeof value === 'number' ? value : undefined}
        className="relative h-4 cursor-pointer touch-none select-none outline-none"
        onPointerDown={(e) => { if (e.button !== 0 || value === undefined) return; e.currentTarget.setPointerCapture(e.pointerId); const v = e.shiftKey ? shown : at(e.clientX); drag.current = { x: e.clientX, v }; set(v); }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          if (e.shiftKey) { const r = bar.current!.getBoundingClientRect(); set(snap(d.v + ((e.clientX - d.x) / r.width) * (max - min) * 0.2)); } else { d.x = e.clientX; d.v = at(e.clientX); set(d.v); }
        }}
        onPointerUp={(e) => { if (!drag.current) return; drag.current = null; e.currentTarget.releasePointerCapture(e.pointerId); done(live); }}
        onPointerCancel={() => { drag.current = null; done(null); }}
        onDoubleClick={() => { setLive(null); onCommit(snap(0)); }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          onCommit(snap(num + (e.key === 'ArrowRight' ? 1 : -1) * step * (e.shiftKey ? 10 : 1)));
        }}>
        <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full" style={{ background: track ?? 'var(--bg-field)', opacity: track ? 0.7 : 1 }} />
        {!track ? <span className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--accent)]" style={{ left: `${Math.min(frac, zero) * 100}%`, width: `${Math.abs(frac - zero) * 100}%` }} /> : null}
        <span className="absolute top-1/2 h-1.5 w-px -translate-y-1/2 bg-white/30" style={{ left: `${zero * 100}%` }} />
        <span className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_1px_3px_rgba(0,0,0,0.5)] ${value === MIXED && live == null ? 'opacity-40' : ''}`} style={{ left: `${frac * 100}%` }} />
      </div>
    </div>
  );
}

/** The curves tab (RGB) or the hue tab: which curve on the left, the curve big, drawn as it plays. */
function CurvesPane<K extends RgbCurve | HueCurve>({ w, kinds, points, histogram, prefKey, onPreview, onCommit }: {
  w: Words; kinds: readonly K[]; points: Record<K, Points>; histogram: readonly number[] | null; prefKey: string;
  onPreview: (k: K, p: Points) => void; onCommit: (k: K, p: Points) => void;
}) {
  const [kind, setKind] = useKept<K>(prefKey, kinds[0]!);
  const k = kinds.includes(kind) ? kind : kinds[0]!;
  const flat = !RGB.includes(k as RgbCurve) && k !== 'satSat';
  return (
    <div className="flex h-full min-h-0 gap-4 px-5 pb-3 pt-1">
      <div className="flex w-[104px] shrink-0 flex-col gap-0.5">
        {kinds.map((c) => (
          <button key={c} type="button" aria-pressed={k === c} onClick={() => setKind(c)}
            className={`flex h-7 items-center gap-2 rounded-[6px] px-2 text-left text-[11.5px] transition ${k === c ? 'bg-[var(--bg-selected)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
            {c in CHANNEL ? <span className="h-2 w-2 rounded-full" style={{ background: CHANNEL[c as RgbCurve] }} /> : null}
            {w(`curve.${c}`)}
          </button>
        ))}
        <p className="mt-auto text-[10px] leading-[14px] text-[var(--text-faint)]">{w('curveHint')}</p>
      </div>
      <div className="flex min-h-0 min-w-0 flex-1 items-start justify-center">
        <div className="h-full" style={{ aspectRatio: flat ? '1 / 0.66' : '1 / 1.04', maxWidth: '100%' }}>
          <CurveEditor kind={k} points={points[k]} histogram={RGB.includes(k as RgbCurve) ? histogram : null}
            onPreview={(p) => onPreview(k, p)} onCommit={(p) => onCommit(k, p)} />
        </div>
      </div>
    </div>
  );
}

/**
 * Styles: the library's filters, each shown on the shot in hand as it would grade it; one taken goes last in the chain
 * (for the screen), at the strength set. Hovering one shows it on the picture.
 */
function Styles({ w, items, first, chosen, text, textsOf, pictures, second, current, onShow, onRevert, onWrite }: {
  w: Words; items: readonly LibraryItem[]; first: GradedClip; chosen: readonly GradedClip[];
  text: ColorText; textsOf: (c: GradedClip, write: ColorWrite | null) => Chain | null;
  pictures: ReturnType<typeof usePictures>; second: number | null;
  current: { slug: string; amount: number } | null;
  onShow: (w: ColorWrite) => void; onRevert: () => void; onWrite: (w: ColorWrite) => void;
}) {
  const lang = useLanguage();
  const filters = React.useMemo(() => items.filter((i) => i.grade), [items]);
  const writeOf = React.useCallback((item: LibraryItem | null, amount: number, clips: readonly GradedClip[] = chosen) => filterWrite(clips, text,
    item ? { id: item.id, title: nameOf(item.name, 'en'), grade: item.grade! } : null, amount, STANDARD), [chosen, text]);
  const amount = current?.amount ?? 1;
  const thumbs = useThumbs(pictures, React.useMemo(() => (second == null ? [] : [
    { id: NONE, src: first.src, second, chain: textsOf(first, writeOf(null, 0, [first])), drawn: drawnOf(first), page: pageOf(first) },
    ...filters.map((f) => ({ id: f.id, src: first.src, second, chain: textsOf(first, writeOf(f, 1, [first])), drawn: drawnOf(first), page: pageOf(first) })),
  ]), [filters, first, second, textsOf, writeOf]), 200);
  const on = current ? filters.find((f) => isFilter(current.slug, f.id)) ?? null : null;
  if (!filters.length) return <Note>{w('noFilters')}</Note>;
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 px-5 pb-3 pt-1">
      <div className="flex h-7 shrink-0 items-center gap-3">
        <span className="min-w-0 truncate text-[12px] text-[var(--text)]">{on ? nameOf(on.name, lang) : w('noFilter')}</span>
        {on ? (
          <div className="w-[220px]">
            <DeskSlider label={w('strength')} value={Math.round(amount * 100)} min={0} max={100} step={1} unit="%"
              onPreview={(v) => onShow(writeOf(on, v / 100))} onCommit={(v) => onWrite(writeOf(on, v / 100))} onRevert={onRevert} />
          </div>
        ) : null}
      </div>
      <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2.5 overflow-y-auto pr-1" onPointerLeave={onRevert}>
        {[null, ...filters].map((f) => {
          const id = f?.id ?? NONE;
          const picked = f ? on?.id === f.id : !on;
          return (
            <button key={id} type="button" aria-pressed={picked} onPointerEnter={() => { if (!picked) onShow(writeOf(f, f ? amount : 0)); }}
              onClick={() => onWrite(writeOf(f, f ? amount : 0))} className="group flex flex-col gap-1 text-left">
              <span className={`relative w-full overflow-hidden rounded-[6px] bg-black transition ${picked ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-white/[0.06] group-hover:ring-white/30'}`} style={{ aspectRatio: String(THUMB_ASPECT) }}>
                {thumbs[id] ? <img src={thumbs[id]} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" /> : null}
              </span>
              <span className={`truncate text-[11px] ${picked ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{f ? nameOf(f.name, lang) : w('noFilter')}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
