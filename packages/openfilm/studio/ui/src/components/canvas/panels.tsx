/**
 * What floats by a node while it is the one selected: over it, what can be done with what it shows (onto the
 * timeline, into the Assets, saved, seen whole); under it, a node that makes something has its panel (what goes into
 * it, numbered in its wires' order; its words; with which model; its shape, length and how pictures are used; Make),
 * and a cut its own (onto the timeline). Floating, they keep their size however far the board is zoomed.
 */
import React from 'react';
import { NodeToolbar, Position } from '@xyflow/react';
import {
  AlignLeft, ArrowUp, AudioLines, Brush, Camera, Palette, UserRound, Eraser, Film, Grid2x2, LayoutDashboard, Orbit, Check, ChevronDown, Clapperboard, Download, FolderSearch, Images, LayoutGrid, Maximize2, Mic, Minimize2, Music, Plus, Search, Sparkles, Square, Video, X,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { GIF_FRAMES, GIF_FRAME_MS, IMAGE_RATIOS, MAKE_COUNTS, MAKE_MEDIA, VIDEO_MODES, VIDEO_RATIOS, frameRatio, lengthOf, lengthRange, modeOf, modesFor, ratioOf, type ModelSpec, type VideoMode } from '@/lib/canvas';
import { PRESETS, PRESET_GROUPS, presetOf, type CanvasPreset } from '@/lib/canvas-presets';
import type { WorkspaceResource } from '@/lib/workspace-resources';
import { Popover } from '../Popover';
import { Tooltip } from '../Tooltip';
import { modelTime, timeLabel, useBoard, type Choice, type MakeData } from './board';
import { frameOf, splitGrid } from './pixels';
import { ProviderMark } from '../settings/ProviderMark';
import { useDraft } from './words';
import { useLibraryVoices, voiceLook } from '@/lib/library-voices';
import { VoiceId, VoicePicker, defaultVoice, serviceOf, voicesOf } from './voices';

const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
/** the lengths offered for each kind, in seconds */
const MAKE_LENGTHS: Partial<Record<MakeData['make'], number[]>> = { video: [4, 5, 6, 8, 10, 15], sfx: [1, 2, 3, 5, 10], music: [15, 30, 60, 120] };
const CARD = 'cv-pop rounded-[12px] bg-[var(--cv-float)] shadow-[var(--cv-float-shadow)]';
const CHIP = 'flex h-6 items-center gap-1 rounded-[8px] bg-[var(--cv-chip)] px-2 text-[12px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]';
/** a choice in a settings popover: a soft cell, the one in use lit with a hairline round it */
const OPTION = 'rounded-[8px] text-[12px] transition';
const OPTION_ON = 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--cv-ink)_28%,transparent)]';
const OPTION_OFF = 'bg-[var(--cv-chip)] text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]';
const OPTION_TITLE = 'mb-1.5 text-[11.5px] text-[var(--cv-ink-3)]';
const PICK = 'flex h-8 min-w-0 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';
/** the panel under a selected node: wider and rounder than the menus, a hairline round it */
const PANEL = 'cv-pop relative rounded-[20px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] shadow-[var(--cv-float-shadow)]';

/** A shape as a little frame of it (16:9 wide, 9:16 tall). */
function RatioIcon({ ratio, size = 16 }: { ratio: string; size?: number }) {
  const [w, h] = ratio.split(':').map(Number) as [number, number];
  const scale = size / Math.max(w, h);
  return (
    <span className="flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <span className="block rounded-[2px] border-[1.5px] border-current" style={{ width: Math.max(5, w * scale), height: Math.max(5, h * scale) }} />
    </span>
  );
}

/** What can be done with what a node shows: onto the timeline, shown in the Assets, saved, seen whole. */
export function ActionBar({ id, file }: { id: string; file: WorkspaceResource | null }) {
  const t = useT();
  const board = useBoard();
  const [grid, setGrid] = React.useState(false);
  if (board.readOnly || !file) return null;
  const btn = 'flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';
  const icon = 'flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';
  const base = file.name.replace(/\.[^.]+$/, '');
  const fail = (e: unknown) => console.warn(e);
  return (
    <NodeToolbar nodeId={id} isVisible={board.single === id} position={Position.Top} offset={36}>
      <div className={`nodrag nopan flex items-center gap-0.5 p-1 ${CARD}`}>
        {file.kind === 'image' ? (
          <>
            <button type="button" className={btn} onClick={() => board.spawn(id, 'image', { preset: 'cameras9', opts: { ratio: '1:1' } })}><Orbit size={14} />{t('canvas.actions.angles')}</button>
            <Popover open={grid} onOpenChange={setGrid} placement="bottom" align="start"
              trigger={<button type="button" className={btn} onClick={() => setGrid((v) => !v)}><Grid2x2 size={14} />{t('canvas.actions.split')}<ChevronDown size={12} /></button>}>
              <div className={`w-[160px] p-1 ${CARD}`}>
                {[2, 3].map((n) => (
                  <button key={n} type="button" className={`${btn} w-full`} onClick={() => { setGrid(false); void splitGrid(board.sources.file(file), n, base).then((files) => board.bring(id, files), fail); }}>
                    {t('canvas.actions.splitInto').replace(/\{n\}/g, String(n))}
                  </button>
                ))}
              </div>
            </Popover>
            <button type="button" className={btn} onClick={() => board.redraw(id, file.path)}><Brush size={14} />{t('canvas.actions.redraw')}</button>
            <button type="button" className={btn} onClick={() => board.cutout(id, file.path)}><Eraser size={14} />{t('canvas.actions.cutout')}</button>
          </>
        ) : null}
        {file.kind === 'video' ? (
          <button type="button" className={btn} onClick={() => {
            const playing = document.querySelector<HTMLVideoElement>(`.react-flow__node[data-id="${CSS.escape(id)}"] video`);
            void frameOf(board.sources.file(file), playing?.currentTime ?? 0, `${base}-frame.png`).then((frame) => board.bring(id, [frame]), fail);
          }}><Camera size={14} />{t('canvas.actions.frame')}</button>
        ) : null}
        {file.kind !== 'other' ? <button type="button" className={btn} onClick={() => board.addToFilm(file)}><Clapperboard size={14} />{t('canvas.addToFilm')}</button> : null}
        <span className="mx-0.5 h-4 w-px bg-[var(--cv-float-line)]" />
        {board.reveal ? (
          <Tooltip label={t('canvas.actions.reveal')}>
            <button type="button" aria-label={t('canvas.actions.reveal')} className={icon} onClick={() => board.reveal!(file.path)}><FolderSearch size={15} /></button>
          </Tooltip>
        ) : null}
        <Tooltip label={t('canvas.actions.download')}>
          <a href={board.sources.file(file)} download={file.name} aria-label={t('canvas.actions.download')} className={icon}><Download size={15} /></a>
        </Tooltip>
        <Tooltip label={t('canvas.actions.view')}>
          <button type="button" aria-label={t('canvas.actions.view')} className={icon} onClick={() => board.view(file.path)}><Maximize2 size={15} /></button>
        </Tooltip>
      </div>
    </NodeToolbar>
  );
}

/** A list in a popover: rows with an icon, a name and a word under it, the one in use checked. */
function Listing<T>({ rows, picked, onPick, empty }: {
  rows: Array<{ key: string; value: T; label: string; note?: string; icon?: React.ReactNode }>; picked?: string; onPick: (value: T) => void; empty?: string;
}) {
  return (
    <div className={`max-h-[320px] w-[280px] overflow-y-auto p-1 ${CARD}`}>
      {rows.length ? rows.map((row) => (
        <button key={row.key} type="button" onClick={() => onPick(row.value)}
          className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]">
          {row.icon ? <span className="shrink-0 text-[var(--cv-label)]">{row.icon}</span> : null}
          <span className="min-w-0 flex-1">
            <span className="block truncate">{row.label}</span>
            {row.note ? <span className="block truncate text-[11.5px] text-[var(--cv-label)]">{row.note}</span> : null}
          </span>
          {picked === row.key ? <Check size={14} className="shrink-0 text-[var(--cv-label)]" /> : null}
        </button>
      )) : <div className="px-2 py-2 text-[12.5px] text-[var(--cv-label)]">{empty}</div>}
    </div>
  );
}

/** A small picture of a file, for lists and the inputs row. */
function useThumb() {
  const board = useBoard();
  return (file: WorkspaceResource | null | undefined) => (!file ? undefined
    : file.kind === 'image' ? board.sources.file(file) : file.kind === 'video' ? board.sources.poster?.(file) : file.kind === 'mg' ? board.sources.pagePoster?.(file) : undefined);
}

/** A titled slider of a node's settings (a clip's length, a GIF's frames), what it is set to at its right. */
function Slider({ label, value, min, max, step, shown, onChange }: { label: string; value: number; min: number; max: number; step: number; shown: string; onChange: (n: number) => void }) {
  return (
    <div>
      <div className={`flex items-center justify-between ${OPTION_TITLE}`}><span>{label}</span><span className="tabular-nums text-[var(--cv-ink-2)]">{shown}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))}
        className="nodrag h-1 w-full cursor-pointer accent-[var(--cv-ink)]" />
    </div>
  );
}

/** A titled row of choices, the one in use lit (a node's spec: its quality, size, background, length, count). */
function Choices({ title, items, columns }: { title: string; columns: number; items: Array<{ key: string; label: string; on: boolean; pick: () => void }> }) {
  return (
    <div>
      <div className={OPTION_TITLE}>{title}</div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {items.map((item) => (
          <button key={item.key} type="button" onClick={item.pick}
            className={`h-8 truncate px-2 ${OPTION} ${item.on ? OPTION_ON : OPTION_OFF}`}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** What a model makes, in a few words: its lengths, the pictures it takes, what it is made from. */
function specLine(spec: ModelSpec | undefined, t: (key: string) => string): string {
  if (!spec) return '';
  const range = spec.only?.length ? [Math.min(...spec.only), Math.max(...spec.only)] : spec.seconds;
  return [
    spec.needs === 'clip' ? t('canvas.spec.fromClip') : spec.needs === 'audio' ? t('canvas.spec.fromAudio') : '',
    range ? t('canvas.spec.seconds').replace('{a}', String(range[0])).replace('{b}', String(range[1])) : '',
    spec.refs ? t('canvas.spec.refs').replace('{n}', String(spec.refs)) : '',
    spec.refs === 0 && spec.frames ? t('canvas.spec.frames') : '',
    spec.sizes?.length ? (spec.sizes.length > 1 ? t('canvas.spec.sizes').replace('{a}', spec.sizes[0]!.toUpperCase()).replace('{b}', spec.sizes[spec.sizes.length - 1]!.toUpperCase()) : spec.sizes[0]!.toUpperCase()) : '',
    spec.voice ? t('canvas.spec.voice') : '',
    spec.clip ? t('canvas.spec.clip') : '',
    spec.transparent ? t('canvas.spec.transparent') : '',
    spec.formats?.some((f) => f !== 'png') ? spec.formats.filter((f) => f !== 'png').map((f) => f.toUpperCase()).join(' / ') : '',
    spec.mask || spec.markup ? t('canvas.spec.redraw') : '',
  ].filter(Boolean).join(' · ');
}

/**
 * Which model a node makes with: as Settings say, or one of every service's, the person's own first; a service not
 * connected yet is there too, a click away from connecting it.
 */
function ModelPicker({ choices, picked, fallback, onPick, onConnect }: {
  choices: Choice[]; picked: Choice | null; fallback: Choice | null; onPick: (choice: Choice | null) => void; onConnect: () => void;
}) {
  const t = useT();
  const [query, setQuery] = React.useState('');
  const q = query.trim().toLowerCase();
  const shown = q ? choices.filter((c) => `${c.name} ${c.provider}`.toLowerCase().includes(q)) : choices;
  const row = (c: Choice) => {
    const line = specLine(c.spec, t);
    const on = picked?.via === c.via && picked?.model === c.model;
    /* how long it takes, as this person's runs with it took */
    const took = modelTime(c.via, c.model);
    return (
      <button key={`${c.via}|${c.model ?? ''}`} type="button" onClick={() => (c.connected ? onPick(c) : onConnect())}
        className={`group/model flex w-full min-w-0 items-start gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[13px] hover:bg-[var(--cv-float-hover)] ${on ? 'bg-[var(--cv-float-hover)]' : ''} ${c.connected ? 'text-[var(--cv-ink)]' : 'text-[var(--cv-ink-3)]'}`}>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[var(--cv-chip)]"><ProviderMark id={c.via} size={13} /></span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate leading-5">{c.name}</span>
            {took !== null ? <span className="shrink-0 rounded-[6px] bg-[var(--cv-chip)] px-1.5 text-[11px] leading-[18px] text-[var(--cv-ink-2)]" title={t('canvas.panel.models.took')}>{timeLabel(took)}</span> : null}
            {on ? <Check size={14} className="shrink-0 text-[var(--cv-label)]" />
              : !c.connected ? <span className="shrink-0 rounded-md border !border-[var(--cv-float-line)] px-1.5 text-[11px] leading-[18px] text-[var(--cv-label)]">{t('canvas.panel.models.connect')}</span> : null}
          </span>
          {/* what it is and what it takes, said when pointed at (or picked) */}
          <span className={`text-[11.5px] leading-snug text-[var(--cv-label)] ${on ? 'block' : 'hidden group-hover/model:block'}`}>
            {[c.provider, c.kind === 'sfx' || c.kind === 'music' || c.kind === 'tts' ? t(`canvas.make.${c.kind}`) : '', line].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>
    );
  };
  const mine = shown.filter((c) => c.connected);
  const others = shown.filter((c) => !c.connected);
  return (
    <div className={`flex max-h-[420px] w-[320px] flex-col ${CARD}`}>
      <label className="flex shrink-0 items-center gap-2 border-b !border-[var(--cv-float-line)] px-3 py-2 text-[var(--cv-label)]">
        <Search size={14} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('canvas.panel.models.search')}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-label)]" />
      </label>
      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {!q ? (
          <button type="button" onClick={() => onPick(null)}
            className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[13px] text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]">
            <span className="min-w-0 flex-1">
              <span className="block truncate">{t('canvas.panel.followSettings')}</span>
              {fallback ? <span className="block truncate text-[11.5px] text-[var(--cv-label)]">{fallback.name} · {fallback.provider}</span> : null}
            </span>
            {!picked ? <Check size={14} className="shrink-0 text-[var(--cv-label)]" /> : null}
          </button>
        ) : null}
        {mine.length ? <div className="px-2 pb-1 pt-2.5 text-[11px] font-medium text-[var(--cv-label)]">{t('canvas.panel.models.mine')}</div> : null}
        {mine.map(row)}
        {others.length ? <div className="px-2 pb-1 pt-2.5 text-[11px] font-medium text-[var(--cv-label)]">{t('canvas.panel.models.others')}</div> : null}
        {others.map(row)}
        {!shown.length ? <div className="px-2 py-2 text-[12.5px] text-[var(--cv-label)]">{t('canvas.panel.models.none')}</div> : null}
      </div>
    </div>
  );
}

/**
 * A node that makes something: its panel, under it while it is the one selected. What goes into it first (brought in
 * from the computer, from the board, from the Assets), numbered in its wires' order; its words; with which model and
 * how; Make (⌘↵), or Stop while it is at it.
 */
export function MakePanel({ id, data }: { id: string; data: MakeData }) {
  const t = useT();
  const board = useBoard();
  const thumb = useThumb();
  const [open, setOpen] = React.useState<string | null>(null);
  /* the words written in a taller box (the panel's ↗) */
  const [expanded, setExpanded] = React.useState(false);
  const shown = board.single === id && !board.readOnly;
  const media = MAKE_MEDIA[data.make];
  const takesPictures = media !== 'audio';
  const inputs = shown ? board.inputs(id) : [];
  const choices = board.choices(data.make);
  const every = board.allChoices(data.make);
  const fallback = board.fallback(data.make);
  const picked = choices.find((c) => c.via === data.via && c.model === data.model) ?? null;
  /* what the model it makes with makes: only that is offered */
  const model = (picked ?? fallback)?.spec;
  /* a voice-over's voice: the library's voices of the service its model is at, or one named by its id */
  const library = useLibraryVoices();
  const language = useLanguage();
  const voices = data.make === 'tts' ? voicesOf(library, serviceOf(picked ?? fallback)) : [];
  const voice = data.make === 'tts' ? (data.opts?.voice ? voices.find((v) => v.id === data.opts?.voice) ?? null : defaultVoice(voices, language)) : null;
  const run = board.run(id);
  const error = board.error(id);
  const unused = board.unused.get(id) ?? 0;
  const set = (patch: Partial<MakeData>) => { board.willChange(); board.setData(id, patch); };
  const prompt = useDraft(data.prompt ?? '', (text) => board.setData(id, { prompt: text }));
  const setOpts = (patch: Partial<NonNullable<MakeData['opts']>>) => set({ opts: { ...data.opts, ...patch } });
  const ratios = data.make === 'image' || data.make === 'video' ? model?.ratios ?? (data.make === 'image' ? IMAGE_RATIOS : VIDEO_RATIOS) : null;
  const range = lengthRange(data.make, model);
  const lengths = model?.only?.length ? model.only
    : range ? [...new Set([range[0], ...(MAKE_LENGTHS[data.make] ?? []).filter((n) => n > range[0] && n < range[1]), range[1]])] : null;
  /* a clip from a first frame is its shape, unless one is picked (computed below, once the frames are known) */
  let ratio = ratioOf(data.opts?.ratio, model);
  const sec = lengthOf(data.make, data.opts?.sec, model);
  /* how a clip is made from what is wired in (its mode), of the ways its model makes them */
  const pictureCount = inputs.filter((i) => i.media === 'image').length;
  const modes = data.make === 'video' ? modesFor(model) : [];
  const mode = data.make === 'video' ? modeOf(data.opts, model, pictureCount) : null;
  /* a clip made from frames: its first (and last) frame as slots, the pictures wired in filling them in order */
  const pictureInputs = inputs.filter((i) => i.media === 'image');
  const slots: Array<{ label: 'first' | 'last'; input: (typeof inputs)[number] | undefined }> = mode === 'first' ? [{ label: 'first', input: pictureInputs[0] }]
    : mode === 'firstLast' ? [{ label: 'first', input: pictureInputs[0] }, { label: 'last', input: pictureInputs[1] }] : [];
  const firstFrame = slots[0]?.input?.path ? board.fileOf(slots[0].input.path) : null;
  if (!data.opts?.ratio && firstFrame) ratio = frameRatio(firstFrame.w, firstFrame.h, model) ?? ratio;
  const qualities = data.make === 'image' ? model?.qualities ?? null : null;
  const preset = presetOf(data.preset);
  const hasPicture = inputs.some((i) => i.media === 'image');
  /* a preset picked: its words go first, and the node is made at its shape and quality */
  const usePreset = (p: CanvasPreset) => {
    set({ preset: p.id, opts: { ...data.opts, ratio: p.ratio, ...(p.quality && qualities?.includes(p.quality) ? { quality: p.quality } : {}) } });
    setOpen(null);
  };
  const quality = qualities ? (data.opts?.quality && qualities.includes(data.opts.quality) ? data.opts.quality : qualities[0]) : null;
  const sizes = model?.sizes?.length ? model.sizes : null;
  const size = sizes ? (data.opts?.size && sizes.includes(data.opts.size) ? data.opts.size : sizes.find((z) => z === '1k' || z === '720p') ?? sizes.find((z) => z === '768p') ?? sizes[0]!) : null;
  const count = data.opts?.count ?? 1;
  const spec = [data.opts?.format && model?.formats?.includes(data.opts.format) ? data.opts.format.toUpperCase() : null, ratios ? ratio : null, quality ? t(`canvas.make.qualities.${quality}`) : null, size ? size.toUpperCase() : null,
    lengths && sec !== null ? t('canvas.make.seconds').replace('{n}', String(sec)) : null,
    t(data.make === 'image' ? 'canvas.make.countPictures' : 'canvas.make.countOthers').replace('{n}', String(count))].filter(Boolean).join(' · ');
  const assetRows = board.files.filter((f) => (f.kind === 'image' || (data.make === 'video' && f.kind === 'video')) && !inputs.some((i) => i.path === f.path))
    .map((f) => { const src = thumb(f); return { key: f.path, value: f.path, label: f.name, note: f.dir || undefined, icon: src ? <img src={src} alt="" className="h-8 w-11 rounded object-cover" /> : <Images size={15} /> }; });
  return (
    <NodeToolbar nodeId={id} isVisible={shown} position={Position.Bottom} offset={14}>
      <div className={`nodrag nopan nowheel w-[min(660px,86vw)] px-3 pb-2 pt-3 ${PANEL}`} onKeyDown={(event) => event.stopPropagation()}>
        <Tooltip label={t(expanded ? 'canvas.panel.collapse' : 'canvas.panel.expand')}>
          <button type="button" aria-label={t(expanded ? 'canvas.panel.collapse' : 'canvas.panel.expand')} onClick={() => setExpanded((v) => !v)}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-[8px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
            {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
        </Tooltip>
        {!takesPictures ? (
          /* a sound is a voice-over, music or a sound effect: each made by its own models */
          <div className="flex items-center gap-1 pr-9">
            <div className="flex items-center gap-0.5 rounded-[10px] bg-[var(--cv-chip)] p-0.5">
              {(['tts', 'music', 'sfx'] as const).map((k) => (
                <button key={k} type="button" onClick={() => { if (k !== data.make) set({ make: k, via: undefined, model: undefined }); }}
                  className={`flex h-6 items-center gap-1 rounded-[8px] px-2.5 text-[12px] transition ${k === data.make ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)] shadow-sm' : 'text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`}>
                  {k === 'tts' ? <Mic size={12} /> : k === 'music' ? <Music size={12} /> : <AudioLines size={12} />}{t(`canvas.make.${k}`)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {takesPictures ? (
          <div className="flex items-center gap-1 pr-9">
            <button type="button" className={CHIP} onClick={() => board.upload(id, 'input')}><Plus size={13} />{t('canvas.panel.upload')}</button>
            <button type="button" className={CHIP} onClick={() => board.pick(id)}><LayoutGrid size={13} />{t('canvas.panel.fromBoard')}</button>
            <Popover open={open === 'assets'} onOpenChange={(v) => setOpen(v ? 'assets' : null)} placement="auto"
              trigger={<button type="button" className={CHIP} onClick={() => setOpen(open === 'assets' ? null : 'assets')}><Images size={13} />{t('canvas.panel.fromAssets')}</button>}>
              <Listing rows={assetRows} empty={t('canvas.panel.nothingInAssets')} onPick={(path) => { board.wireIn(id, { path }); setOpen(null); }} />
            </Popover>
            {/* the libraries, for this node: a character's portrait, a style (a picture), an effect (a clip) */}
            <button type="button" className={CHIP} onClick={() => board.openLibrary('characters', id)}><UserRound size={13} />{t('canvas.characters.chip')}</button>
            {data.make === 'image' ? <button type="button" className={CHIP} onClick={() => board.openLibrary('styles', id)}><Palette size={13} />{t('canvas.library.styleChip')}</button> : null}
            {data.make === 'video' ? <button type="button" className={CHIP} onClick={() => board.openLibrary('effects', id)}><Clapperboard size={13} />{t('canvas.library.effectChip')}</button> : null}
          </div>
        ) : null}
        {inputs.length || slots.length ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {/* the frames a clip is made between, each a slot: filled by what is wired in, in order, or empty to fill */}
            {slots.map((slot, i) => {
              const input = slot.input;
              const file = input?.path ? board.fileOf(input.path) : null;
              const src = thumb(file);
              return input ? (
                <div key={input.edge} className="group/input relative h-12 w-12 overflow-hidden rounded-[8px] bg-[var(--cv-chip)] ring-1 ring-[var(--cv-float-line)]" title={file?.name ?? input.path}>
                  {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-[var(--cv-label)]"><Images size={16} /></span>}
                  <span className="absolute inset-x-0 top-0 bg-black/60 py-px text-center text-[10px] font-medium text-white">{t(`canvas.slots.${slot.label}`)}</span>
                  <button type="button" aria-label={t('canvas.removeWire')} onClick={() => board.unwire(input.edge)}
                    className="absolute bottom-0.5 right-0.5 hidden h-4 w-4 items-center justify-center rounded bg-black/70 text-white group-hover/input:flex"><X size={10} /></button>
                </div>
              ) : (
                <Popover key={`slot-${i}`} open={open === `slot-${i}`} onOpenChange={(v) => setOpen(v ? `slot-${i}` : null)} placement="auto"
                  trigger={(
                    <button type="button" onClick={() => setOpen(open === `slot-${i}` ? null : `slot-${i}`)}
                      className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-[8px] border border-dashed !border-[var(--cv-line)] text-[var(--cv-ink-2)] transition hover:!border-[var(--cv-ring)] hover:text-[var(--cv-ink)]">
                      <Plus size={14} /><span className="text-[10px] leading-none">{t(`canvas.slots.${slot.label}`)}</span>
                    </button>
                  )}>
                  <div className={`w-[176px] p-1 ${CARD}`}>
                    <button type="button" className={`${PICK} w-full`} onClick={() => { setOpen(null); board.upload(id, 'input'); }}><Plus size={14} />{t('canvas.panel.upload')}</button>
                    <button type="button" className={`${PICK} w-full`} onClick={() => { setOpen(null); board.pick(id); }}><LayoutGrid size={14} />{t('canvas.panel.fromBoard')}</button>
                    <button type="button" className={`${PICK} w-full`} onClick={() => setOpen('assets')}><Images size={14} />{t('canvas.panel.fromAssets')}</button>
                  </div>
                </Popover>
              );
            })}
            {inputs.filter((input) => !slots.some((s) => s.input?.edge === input.edge)).map((input) => {
              const i = inputs.indexOf(input);
              const file = input.path ? board.fileOf(input.path) : null;
              const src = thumb(file);
              return (
                <div key={input.edge} className="group/input relative h-10 w-10 overflow-hidden rounded-[8px] bg-[var(--cv-chip)] ring-1 ring-[var(--cv-float-line)]"
                  title={input.text ?? file?.name ?? input.path}>
                  {src ? <img src={src} alt="" className="h-full w-full object-cover" />
                    : input.text != null ? <span className="flex h-full w-full items-center justify-center text-[var(--cv-ink-2)]"><AlignLeft size={16} /></span>
                      : <span className="flex h-full w-full items-center justify-center text-[var(--cv-label)]">{file?.kind === 'audio' ? <Music size={16} /> : <Video size={16} />}</span>}
                  <span className="absolute left-0.5 top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-black/75 px-1 text-[9.5px] font-medium text-white">{i + 1}</span>
                  <button type="button" aria-label={t('canvas.removeWire')} onClick={() => board.unwire(input.edge)}
                    className="absolute right-0.5 top-0.5 hidden h-4 w-4 items-center justify-center rounded bg-black/70 text-white group-hover/input:flex"><X size={10} /></button>
                </div>
              );
            })}
          </div>
        ) : null}
        {data.make === 'image' && (data.opts?.mask || data.opts?.markup) ? (
          <div className="mt-2.5 flex items-center gap-1">
            {/* what of the first picture is redrawn: a mask or the changes drawn on it, kept with the node */}
            <span className="group/redraw flex h-6 items-center gap-1 rounded-[8px] bg-[color-mix(in_srgb,var(--cv-edge-lit)_18%,transparent)] px-2 text-[12.5px] text-[var(--cv-ink)]">
              <button type="button" aria-label={t('canvas.redraw.remove')} onClick={() => setOpts({ mask: undefined, markup: undefined })}
                className="-ml-0.5 hidden h-4 w-4 items-center justify-center rounded text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)] group-hover/redraw:flex"><X size={12} /></button>
              <Brush size={13} className="group-hover/redraw:hidden" />{t(data.opts?.mask ? 'canvas.redraw.withMask' : 'canvas.redraw.withMarkup')}
            </span>
          </div>
        ) : null}
        {preset ? (
          <div className="mt-2.5 flex items-center gap-1">
            <span className="group/preset flex h-6 items-center gap-1 rounded-[8px] bg-[color-mix(in_srgb,var(--cv-edge-lit)_18%,transparent)] px-2 text-[12.5px] text-[var(--cv-ink)]">
              <button type="button" aria-label={t('canvas.presets.remove')} onClick={() => set({ preset: undefined })}
                className="-ml-0.5 hidden h-4 w-4 items-center justify-center rounded text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)] group-hover/preset:flex"><X size={12} /></button>
              <LayoutDashboard size={13} className="group-hover/preset:hidden" />{t(`canvas.presets.names.${preset.id}`)}
            </span>
          </div>
        ) : null}
        <textarea
          {...prompt.props}
          rows={expanded ? 14 : 3}
          onFocus={board.willChange}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') event.currentTarget.blur();
            else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); board.make(id); }
          }}
          placeholder={preset ? t('canvas.presets.hint') : t(`canvas.panel.placeholder.${data.make}`)}
          className="mt-2.5 w-full resize-none bg-transparent px-1 text-[14px] leading-relaxed text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]"
        />
        <div className="mt-1 flex min-w-0 items-center gap-0.5">
          {every.length ? (
            <Popover open={open === 'model'} onOpenChange={(v) => setOpen(v ? 'model' : null)} placement="auto"
              trigger={(
                <button type="button" className={`${PICK} ${choices.length ? '' : 'text-amber-500 hover:text-amber-400'}`} onClick={() => setOpen(open === 'model' ? null : 'model')}>
                  <Sparkles size={14} /><span className="max-w-[180px] truncate">{(picked ?? fallback)?.name ?? t('canvas.panel.connect')}</span><ChevronDown size={13} />
                </button>
              )}>
              <ModelPicker choices={every} picked={picked} fallback={fallback}
                onPick={(choice) => { set({ via: choice?.via, model: choice?.model, ...(choice?.kind && choice.kind !== data.make ? { make: choice.kind } : {}) }); setOpen(null); }}
                onConnect={() => { setOpen(null); board.openSettings(); }} />
            </Popover>
          ) : (
            <Tooltip label={t('canvas.make.noService')}>
              <button type="button" onClick={board.openSettings} className={`${PICK} whitespace-nowrap text-amber-500 hover:text-amber-400`}>{t('canvas.panel.connect')}</button>
            </Tooltip>
          )}
          {data.make === 'tts' && every.length ? (
            <Popover open={open === 'voice'} onOpenChange={(v) => setOpen(v ? 'voice' : null)} placement="auto"
              trigger={(
                <button type="button" className={PICK} onClick={() => setOpen(open === 'voice' ? null : 'voice')}>
                  {voice ? <span className="h-4 w-4 shrink-0 rounded-full" style={voiceLook(voice)} /> : <Mic size={14} />}
                  <span className="max-w-[160px] truncate">{voice?.name ?? data.opts?.voice ?? t('canvas.voice.pick')}</span><ChevronDown size={13} />
                </button>
              )}>
              {voices.length ? <VoicePicker voices={voices} picked={voice?.id} onPick={(v) => { setOpts({ voice: v }); setOpen(null); }} />
                : <VoiceId value={data.opts?.voice} onPick={(v) => { setOpts({ voice: v }); setOpen(null); }} />}
            </Popover>
          ) : null}
          {mode ? (
            <Popover open={open === 'mode'} onOpenChange={(v) => setOpen(v ? 'mode' : null)} placement="auto"
              trigger={(
                <button type="button" className={PICK} onClick={() => setOpen(open === 'mode' ? null : 'mode')}>
                  <Film size={14} /><span className="truncate">{t(`canvas.modes.${mode}`)}</span><ChevronDown size={13} />
                </button>
              )}>
              <div className={`w-[248px] p-1 ${CARD}`}>
                <div className="flex h-7 items-center px-2 text-[12px] font-medium text-[var(--cv-ink-3)]">{t('canvas.modes.title')}</div>
                {/* every way its model makes a clip: one that needs pictures shows where they go once picked */}
                {VIDEO_MODES.map((m: VideoMode) => {
                  const off = !modes.includes(m);
                  return (
                    <button key={m} type="button" disabled={off} onClick={() => { setOpts({ mode: m, frames: undefined }); setOpen(null); }}
                      title={off ? t('canvas.modes.notThisModel') : undefined}
                      className={`flex w-full items-start gap-2 rounded-[8px] px-2 py-1.5 text-left ${off ? 'text-[var(--cv-ink-3)]' : 'text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]'} ${m === mode ? 'bg-[var(--cv-float-hover)]' : ''}`}>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-5">{t(`canvas.modes.${m}`)}</span>
                        <span className="block text-[11.5px] leading-snug text-[var(--cv-ink-3)]">{t(off ? 'canvas.modes.notThisModel' : `canvas.modes.about.${m}`)}</span>
                      </span>
                      {m === mode ? <Check size={14} className="mt-0.5 shrink-0 text-[var(--cv-ink-2)]" /> : null}
                    </button>
                  );
                })}
              </div>
            </Popover>
          ) : null}
          {spec ? (
            <>
              <span className="mx-0.5 h-4 w-px bg-[var(--cv-float-line)]" />
              <Popover open={open === 'spec'} onOpenChange={(v) => setOpen(v ? 'spec' : null)} placement="top" align="center"
                trigger={(
                  <button type="button" className={PICK} onClick={() => setOpen(open === 'spec' ? null : 'spec')}>
                    {ratios ? <RatioIcon ratio={ratio} /> : null}<span className="truncate">{spec}</span><ChevronDown size={13} />
                  </button>
                )}>
                {/* as the node canvases people know lay it out: each part titled, its choices in a row */}
                <div className={`w-[340px] space-y-3.5 p-3.5 ${CARD}`}>
                  {ratios && data.make === 'video' ? (
                    <div>
                      <div className={OPTION_TITLE}>{t('canvas.make.ratio')}</div>
                      <div className="grid grid-cols-5 gap-1">
                        {ratios.map((r) => (
                          <button key={r} type="button" onClick={() => setOpts({ ratio: r })}
                            className={`flex h-[50px] flex-col items-center justify-center gap-1 ${OPTION} ${r === ratio ? OPTION_ON : OPTION_OFF}`}>
                            <RatioIcon ratio={r} size={16} />{r}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {qualities ? (
                    <Choices title={t('canvas.make.quality')} columns={3} items={qualities.map((q) => ({ key: q, label: t(`canvas.make.qualities.${q}`), on: q === quality, pick: () => setOpts({ quality: q }) }))} />
                  ) : null}
                  {sizes ? (
                    <Choices title={t('canvas.make.size')} columns={Math.min(4, sizes.length)} items={sizes.map((z) => ({ key: z, label: z.toUpperCase(), on: z === size, pick: () => setOpts({ size: z }) }))} />
                  ) : null}
                  {model?.transparent ? (
                    <Choices title={t('canvas.make.background')} columns={2} items={[
                      { key: 'auto', label: t('canvas.make.backgroundAuto'), on: !data.opts?.transparent, pick: () => setOpts({ transparent: undefined }) },
                      { key: 'none', label: t('canvas.make.backgroundNone'), on: Boolean(data.opts?.transparent), pick: () => setOpts({ transparent: true }) },
                    ]} />
                  ) : null}
                  {data.make === 'image' && model?.formats?.length ? (
                    <>
                      <Choices title={t('canvas.make.format')} columns={3} items={(['png', 'gif', 'svg'] as const).filter((f) => f === 'png' || model.formats!.includes(f)).map((f) => ({
                        key: f, label: t(`canvas.make.formats.${f}`), on: (data.opts?.format ?? 'png') === f, pick: () => setOpts({ format: f === 'png' ? undefined : f }),
                      }))} />
                      {data.opts?.format === 'gif' ? (
                        <div className="space-y-2.5">
                          <Slider label={t('canvas.make.gifFrames')} value={data.opts.gifFrames ?? GIF_FRAMES} min={2} max={16} step={1}
                            shown={t('canvas.make.gifFramesN').replace('{n}', String(data.opts.gifFrames ?? GIF_FRAMES))} onChange={(n) => setOpts({ gifFrames: n })} />
                          <Slider label={t('canvas.make.frameMs')} value={data.opts.frameMs ?? GIF_FRAME_MS} min={60} max={1000} step={20}
                            shown={t('canvas.make.gifLoop').replace('{ms}', String(data.opts.frameMs ?? GIF_FRAME_MS)).replace('{s}', (((data.opts.gifFrames ?? GIF_FRAMES) * (data.opts.frameMs ?? GIF_FRAME_MS)) / 1000).toFixed(1))}
                            onChange={(n) => setOpts({ frameMs: n })} />
                        </div>
                      ) : null}
                    </>
                  ) : null}
                  {ratios && data.make !== 'video' ? (
                    <div>
                      <div className={OPTION_TITLE}>{t('canvas.make.ratio')}</div>
                      <div className="grid grid-cols-5 gap-1">
                        {ratios.map((r) => (
                          <button key={r} type="button" onClick={() => setOpts({ ratio: r })}
                            className={`flex h-[50px] flex-col items-center justify-center gap-1 ${OPTION} ${r === ratio ? OPTION_ON : OPTION_OFF}`}>
                            <RatioIcon ratio={r} size={16} />{r}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {lengths && range && sec !== null ? (
                    model?.only?.length || data.make !== 'video' ? (
                      <Choices title={t('canvas.make.length')} columns={Math.min(6, lengths.length)} items={lengths.map((n) => ({ key: String(n), label: t('canvas.make.seconds').replace('{n}', String(n)), on: n === sec, pick: () => setOpts({ sec: n }) }))} />
                    ) : (
                      <Slider label={t('canvas.make.length')} value={sec} min={range[0]} max={range[1]} step={1}
                        shown={t('canvas.make.seconds').replace('{n}', String(sec))} onChange={(n) => setOpts({ sec: n })} />
                    )
                  ) : null}
                  <Choices title={t('canvas.make.count')} columns={3} items={MAKE_COUNTS.map((c) => ({ key: String(c), label: t(data.make === 'image' ? 'canvas.make.countPictures' : 'canvas.make.countOthers').replace('{n}', String(c)), on: c === count, pick: () => setOpts({ count: c > 1 ? c : undefined }) }))} />
                </div>
              </Popover>
            </>
          ) : null}
          {data.make === 'image' ? (
            <Popover open={open === 'presets'} onOpenChange={(v) => setOpen(v ? 'presets' : null)} placement="top" align="center"
              trigger={(
                <Tooltip label={t('canvas.presets.title')}>
                  <button type="button" aria-label={t('canvas.presets.title')} onClick={() => setOpen(open === 'presets' ? null : 'presets')}
                    className={`flex h-8 w-8 items-center justify-center rounded-[8px] transition hover:bg-[var(--cv-float-hover)] ${preset ? 'text-[var(--cv-edge-lit)]' : 'text-[var(--cv-ink)]'}`}><LayoutDashboard size={16} /></button>
                </Tooltip>
              )}>
              <div className={`grid w-[520px] grid-cols-2 gap-x-3 p-3 ${CARD}`}>
                {[PRESET_GROUPS.slice(0, 2), PRESET_GROUPS.slice(2)].map((column, ci) => (
                  <div key={ci}>
                    {column.map((group) => (
                      <div key={group} className="mb-2">
                        <div className="flex h-7 items-center px-2 text-[12px] font-medium text-[var(--cv-ink-2)]">{t(`canvas.presets.groups.${group}`)}</div>
                        {PRESETS.filter((p) => p.group === group).map((p) => {
                          const off = p.fromPicture && !hasPicture;
                          return (
                            <button key={p.id} type="button" disabled={off} onClick={() => usePreset(p)} title={off ? t('canvas.presets.needsPicture') : undefined}
                              className={`flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-left text-[13px] transition ${off ? 'text-[var(--cv-ink-3)]' : 'text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]'} ${preset?.id === p.id ? 'bg-[var(--cv-float-hover)]' : ''}`}>
                                <LayoutDashboard size={14} className="shrink-0 opacity-70" />{t(`canvas.presets.names.${p.id}`)}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Popover>
          ) : null}
          <span className="flex-1" />
          {unused ? <span className="mr-1 truncate text-[11.5px] text-[var(--cv-label)]">{t('canvas.make.unused').replace('{n}', String(unused))}</span> : null}
          {run ? (
            <Tooltip label={t('canvas.make.stop')}>
              <button type="button" aria-label={t('canvas.make.stop')} onClick={() => board.stop(id)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-[var(--cv-invert)] text-[var(--cv-on-invert)]"><Square size={11} fill="currentColor" /></button>
            </Tooltip>
          ) : (
            <Tooltip label={`${(data.versions?.length ? t('canvas.make.again') : t('canvas.make.run'))} · ${MOD}↵`}>
              <button type="button" aria-label={t('canvas.make.run')} disabled={!choices.length} onClick={() => board.make(id)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-[var(--cv-invert)] text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:bg-[var(--cv-chip)] disabled:text-[var(--cv-ink-3)]"><ArrowUp size={17} /></button>
            </Tooltip>
          )}
        </div>
        {error ? <div className="mt-2 select-text text-[12px] leading-snug text-red-500">{error}</div> : null}
      </div>
    </NodeToolbar>
  );
}

/**
 * A text node's panel (in the app with a chat): what to write, written into it by the person's own agent from that and
 * the words wired in. Its words are theirs to change after.
 */
export function NotePanel({ id }: { id: string }) {
  const t = useT();
  const board = useBoard();
  const [ask, setAsk] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const write = board.write;
  if (!write) return null;
  const wired = board.single === id ? board.inputs(id).filter((i) => i.text != null).length : 0;
  const send = () => {
    if (busy || (!ask.trim() && !wired)) return;
    setBusy(true);
    setError(null);
    /* written: the ask is done; refused: it stays, to send again */
    void write(id, ask.trim()).then((why) => { setBusy(false); setError(why); if (!why) setAsk(''); });
  };
  return (
    <NodeToolbar nodeId={id} isVisible={board.single === id && !board.readOnly} position={Position.Bottom} offset={14}>
      <div className={`nodrag nopan nowheel w-[min(560px,86vw)] px-3 pb-2 pt-3 ${PANEL}`} onKeyDown={(event) => event.stopPropagation()}>
        <textarea
          value={ask}
          rows={2}
          disabled={busy}
          onChange={(event) => { setAsk(event.target.value); setError(null); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') event.currentTarget.blur();
            else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); }
          }}
          placeholder={t('canvas.write.placeholder')}
          className="w-full resize-none bg-transparent px-1 text-[14px] leading-relaxed text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)] disabled:opacity-60"
        />
        <div className="mt-1 flex min-w-0 items-center gap-1">
          <span className="flex h-8 min-w-0 items-center gap-1.5 px-1 text-[12.5px] text-[var(--cv-label)]">
            <Sparkles size={14} className="shrink-0" /><span className="truncate">{busy ? t('canvas.write.busy') : t('canvas.write.by')}</span>
          </span>
          <span className="flex-1" />
          {wired ? <span className="mr-1 truncate text-[11.5px] text-[var(--cv-label)]">{t('canvas.write.wired').replace('{n}', String(wired))}</span> : null}
          <Tooltip label={`${t('canvas.write.run')} · ${MOD}↵`}>
            <button type="button" aria-label={t('canvas.write.run')} disabled={busy || (!ask.trim() && !wired)} onClick={send}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-[var(--cv-invert)] text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:bg-[var(--cv-chip)] disabled:text-[var(--cv-ink-3)]">
              {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ArrowUp size={17} />}
            </button>
          </Tooltip>
        </div>
        {error ? <div className="mt-2 select-text text-[12px] leading-snug text-red-500">{error}</div> : null}
      </div>
    </NodeToolbar>
  );
}

/** A cut's panel: what it puts on the timeline, and the button that does. */
export function CutPanel({ id, count }: { id: string; count: number }) {
  const t = useT();
  const board = useBoard();
  return (
    <NodeToolbar nodeId={id} isVisible={board.single === id && !board.readOnly} position={Position.Bottom} offset={14}>
      <div className={`nodrag nopan flex w-[min(420px,80vw)] items-center gap-3 p-3 ${CARD}`}>
        <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--cv-label)]">{count ? t('canvas.cut.how') : t('canvas.cut.waiting')}</span>
        <button type="button" disabled={!count} onClick={() => board.sendToFilm(id)}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--primary)] px-4 text-[13px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-30">
          <Clapperboard size={14} />{t('canvas.cut.send')}
        </button>
      </div>
    </NodeToolbar>
  );
}
