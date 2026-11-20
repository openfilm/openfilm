import { assetClipKindOf, pendingDropOf, type AssetDropTarget, type PendingDrop } from './asset-timeline.ts';
import type { ModelSpec } from './canvas';
import type { HostWritingModel } from './host';
import type { ProviderVerb, ProvidersState } from './providers';
import type { ResourceDragItem } from './resource-drag';
import type { TimelineTrack } from './timeline-layout';

export const GENERATABLE = ['media', 'voice', 'captions', 'template', 'sound', 'music', 'text', 'sticker', 'filter', 'effect', 'transition'] as const;
export type GenerationCategory = typeof GENERATABLE[number];
export type GenerationKind = Exclude<GenerationCategory, 'media'> | 'image' | 'video';

export const GENERATION_VERBS: Partial<Record<GenerationKind, ProviderVerb>> = {
  image: 'image', video: 'video', sticker: 'image', voice: 'tts', music: 'music', sound: 'sfx', captions: 'asr',
};

export interface GenerationModel {
  via: string;
  model?: string;
  name: string;
  spec?: ModelSpec;
}

export function generationModels(state: ProvidersState | null, kind: GenerationKind): GenerationModel[] {
  const verb = GENERATION_VERBS[kind];
  if (!verb) return [];
  return (state?.providers ?? []).filter((p) => p.source && p.verbs.includes(verb)).flatMap((p) => {
    const models = p.models[verb] ?? [];
    if (!models.length) return kind === 'sticker' ? [] : [{ via: p.id, name: p.name }];
    return models.filter((m) => {
      if (kind === 'sticker') return Boolean(m.spec?.transparent);
      if (kind === 'video') return !m.spec?.needs && m.spec?.frames !== 'first-required';
      return true;
    }).map((m) => ({ via: p.id, model: m.id, name: p.name === m.name ? m.name : `${m.name} · ${p.name}`, ...(m.spec ? { spec: m.spec } : {}) }));
  });
}

export type GenerationInput = {
  kind: GenerationKind;
  prompt: string;
  seconds: number;
  ratio?: string;
  model?: GenerationModel;
  writing?: HostWritingModel;
  voice?: string;
};

export interface GenerationStatus {
  kind: GenerationKind;
  label: string;
  error?: string;
  canRetryPlacement?: boolean;
}

export interface GenerationActions {
  start: (input: GenerationInput) => void;
  status: GenerationStatus | null;
  retry: () => void;
  dismiss: () => void;
  target: string | null;
  cut: boolean;
  speech: boolean;
}

export function generationFile(kind: GenerationKind, id: string, name: string, seconds: number): ResourceDragItem {
  const [path, media] = kind === 'video' ? [`assets/video/${id}.mp4`, 'video']
    : kind === 'image' || kind === 'sticker' ? [`assets/image/${id}.png`, 'image']
    : kind === 'voice' ? [`assets/audio/vo/${id}.wav`, 'audio']
    : kind === 'sound' || kind === 'music' ? [`assets/audio/${kind === 'sound' ? 'sfx' : 'music'}/${id}.wav`, 'audio']
    : [`assets/generative/${id}.html`, 'mg'];
  return { path: path!, kind: media as ResourceDragItem['kind'], name, durationMs: Math.round(seconds * 1000) };
}

/** Reserve the first interval on the target track large enough to hold the requested clip. */
export function generationSlot(tracks: readonly TimelineTrack[], file: ResourceDragItem, target: number | null, atMs: number): {
  atMs: number;
  target: AssetDropTarget;
  anchors: string[];
  count: number;
} | null {
  const current = target == null ? null : tracks.find((row) => row.docIndex === target);
  if (current?.locked) return null;
  const sound = assetClipKindOf(file) === 'audio';
  const all = tracks.filter((row) => row.docIndex != null);
  const compatible = (row: TimelineTrack) => !row.captions && !row.hidden && !row.locked && (row.role === 'audio') === sound;
  const into = current && compatible(current) ? current : current ? null
    : [...all].reverse().find((row) => compatible(row)) ?? null;
  const rows = all.filter((row) => row.docIndex === (into ?? current)?.docIndex);
  const anchors = rows.flatMap((row) => row.blocks.flatMap((block) => block.clipId && !block.cue ? [block.clipId] : []));
  const count = all.reduce((end, row) => Math.max(end, row.docIndex! + 1), 0);
  if (!into) {
    // An incompatible target gets an adjacent track, on the side where that media plays.
    const at = current?.docIndex != null ? current.docIndex + (sound ? 1 : 0) : sound ? count : 0;
    return { atMs, anchors, count, target: { lane: null, insertTrackAt: at } };
  }
  const ordered = rows.flatMap((row) => row.blocks).sort((a, b) => a.startMs - b.startMs);
  for (const block of ordered) {
    if (block.endMs > atMs && block.startMs < atMs + (file.durationMs ?? 4000) - 0.5) atMs = block.endMs;
  }
  return { atMs, anchors, count, target: { lane: into.lane, insertTrackAt: null } };
}

export type GenerationSlot = NonNullable<ReturnType<typeof generationSlot>>;

export function generationPlaceholder(file: ResourceDragItem, id: string, slot: GenerationSlot, failed = false): PendingDrop | null {
  const drop = pendingDropOf(file, slot.target, slot.atMs);
  return drop ? { ...drop, title: file.name, id, generation: failed ? 'failed' : 'running', ...(slot.target.lane ? { trackClips: slot.anchors } : {}) } : null;
}

const transitions = ['dissolve', 'dip-black', 'dip-white', 'push-left', 'push-right', 'push-up', 'push-down', 'zoom-in', 'zoom-out', 'spin'] as const;

const rules: Partial<Record<GenerationKind, string>> = {
  text: 'Return JSON with a single field "title" containing the finished, editable on-screen words.',
  template: 'Design a reusable title card. Return JSON {title, subtitle, background, foreground, accent, layout}. Colors are six-digit hex with #. Layout is "center" or "left".',
  filter: 'Return JSON {brightness, contrast, saturation, sepia}. The first three are percentages from 25 to 200 (100 = unchanged); sepia is a percentage from 0 to 100 (0 = unchanged).',
  effect: 'Design a transparent animated overlay. Return JSON {color, strength, pattern}. Color is a six-digit hex with #; strength is a percentage from 10 to 100; pattern is "glow", "flash", "vignette", or "scanlines".',
  transition: `Design a transition between the two named shots. Return JSON {style, seconds} where style is one of ${transitions.join(', ')} and seconds is a number from 0.15 to 2.`,
};

export function generationPrompt(kind: GenerationKind, text: string) {
  return `${rules[kind] ?? ''} Respond with only the specified JSON object. Keep all on-screen wording in the language requested.\n\n${text}`;
}

const hex = (value: unknown, fallback: string) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
const percentage = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
const escape = (text: string) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const words = (value: unknown, limit: number) => typeof value === 'string' ? value.trim().slice(0, limit) : '';

export type GenerationDesign =
  | { kind: 'page'; html: string }
  | { kind: 'filter'; css: string }
  | { kind: 'transition'; style: typeof transitions[number]; seconds: number };

/** Convert bounded model data into trusted OpenFilm assets. All text is escaped, all script is authored here. */
export function generationDesign(kind: GenerationKind, answer: string, seconds: number): GenerationDesign {
  const json = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const data = JSON.parse(json) as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('The model did not return an asset.');
  if (kind === 'transition') {
    const style = transitions.find((transition) => transition === data.style);
    if (!style) throw new Error('The model did not return a supported transition.');
    return { kind, style, seconds: percentage(data.seconds, 0.15, 2, 0.5) };
  }
  if (kind === 'filter') {
    const { brightness, contrast, saturation, sepia } = data;
    if (![brightness, contrast, saturation, sepia].some((n) => typeof n === 'number')) throw new Error('The model did not return a filter.');
    return { kind, css: `brightness(${percentage(brightness, 25, 200, 100)}%) contrast(${percentage(contrast, 25, 200, 100)}%) saturate(${percentage(saturation, 25, 200, 100)}%) sepia(${percentage(sepia, 0, 100, 0)}%)` };
  }

  const base = '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}';
  if (kind === 'effect') {
    const color = hex(data.color, '#ffffff');
    const strength = percentage(data.strength, 10, 100, 55) / 100;
    const patterns = {
      glow: `radial-gradient(ellipse at 22% 30%, ${color}, transparent 65%)`,
      flash: color,
      vignette: `radial-gradient(ellipse, transparent 45%, ${color})`,
      scanlines: `repeating-linear-gradient(0deg, transparent 0 5px, ${color} 6px 7px)`,
    };
    const pattern = data.pattern;
    if (pattern !== 'glow' && pattern !== 'flash' && pattern !== 'vignette' && pattern !== 'scanlines') throw new Error('The model did not return a supported effect.');
    return { kind: 'page', html: `${base}#effect{position:absolute;inset:0;opacity:0;background:${patterns[pattern]}}</style></head>
<body><div id="effect"></div><script>const el=document.getElementById('effect');window.film={duration:${seconds},frame(t){el.style.opacity=${strength}*Math.sin(Math.PI*Math.min(1,Math.max(0,t/${seconds})))}}</script></body></html>` };
  }

  const title = words(data.title, 300);
  if (!title) throw new Error('The model did not return any text.');
  const subtitle = words(data.subtitle, 500);
  const background = kind === 'template' ? hex(data.background, '#171719') : 'transparent';
  const foreground = hex(data.foreground, '#eeeeee');
  const accent = hex(data.accent, '#00bec8');
  const align = data.layout === 'left' ? 'left' : 'center';
  return { kind: 'page', html: `${base}body{display:grid;place-items:center;background:${background};color:${foreground};font:600 6vw system-ui;white-space:pre-line}main{width:80%;text-align:${align};overflow-wrap:anywhere}h1{font:inherit;margin:0}p{font-size:.45em;margin:1em 0 0;color:${accent}}</style></head>
<body><main><h1 id="title">${escape(title)}</h1>${subtitle ? `<p id="subtitle">${escape(subtitle)}</p>` : ''}</main>
<script>window.film={duration:${seconds},frame(){}}</script></body></html>` };
}
