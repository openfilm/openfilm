/**
 * What floats by a node while it is the one selected: over it, what can be done with what it shows (onto the
 * timeline, into the Assets, saved, seen whole); under it, a node that makes something has its panel (what goes into
 * it, numbered in its wires' order; its words; with which model; its shape, length and how pictures are used; Make),
 * and a cut its own (onto the timeline). Floating, they keep their size however far the board is zoomed.
 */
import React from 'react';
import { NodeToolbar, Position, useStore } from '@xyflow/react';
import {
  ArrowUp, FileText, AudioLines, Brush, Palette, UserRound, Eraser, Film, Grid2x2, LayoutDashboard, Orbit, Check, ChevronDown, Clapperboard, CopyPlus, Download, FolderSearch, Group, Images, LayoutGrid, Maximize2, Mic, Minimize2, Music, Plus, Search, Sparkles, Square, Trash2, Ungroup, Video, X, Type as TypeIcon, MessageSquareQuote, Shapes, ChevronUp, Upload, Image as ImageIcon,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { GIF_FRAMES, GIF_FRAME_MS, IMAGE_RATIOS, MAKE_COUNTS, MAKE_MEDIA, VIDEO_MODES, VIDEO_RATIOS, frameRatio, lengthOf, lengthRange, modeOf, modesFor, ratioOf, type VideoMode } from '@/lib/canvas';
import { PRESETS, PRESET_GROUPS, presetOf, type CanvasPreset, type PresetGroup } from '@/lib/canvas-presets';

/** each preset's picture of what it makes (made for OpenFilm), by its id */
const PRESET_PICTURES: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob<string>('./presets/*.jpg', { eager: true, import: 'default' }))
  .map(([path, url]) => [path.slice('./presets/'.length, -'.jpg'.length), url]));
import type { WorkspaceResource } from '@/lib/workspace-resources';
import { studioHost } from '@/lib/host';
import { Popover } from '../Popover';
import { Tooltip } from '../Tooltip';
import { useBoard, type Choice, type MakeData } from './board';
import { splitGrid } from './pixels';
import { ProviderMark } from '../settings/ProviderMark';
import { useDraft } from './words';
import { DocSheet } from './doc';
import { useLibraryVoices, voiceLook } from '@/lib/library-voices';
import { VoiceId, VoicePicker, defaultVoice, serviceOf, voicesOf } from './voices';
import { WRITING_ATTACHMENT_ACCEPT, WRITING_ATTACHMENT_LIMIT, writingAttachmentKind } from '../../../../../src/canvas-attachments.mjs';

const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
/** the lengths offered for each kind, in seconds */
const MAKE_LENGTHS: Partial<Record<MakeData['make'], number[]>> = { video: [4, 5, 6, 8, 10, 15], sfx: [1, 2, 3, 5, 10], music: [15, 30, 60, 120] };
const CARD = 'cv-pop rounded-[12px] bg-[var(--cv-float)] shadow-[var(--cv-float-shadow)]';
/** a choice in a settings popover: a soft cell, the one in use lit with a hairline round it */
const OPTION = 'rounded-[8px] text-[12px] transition';
const OPTION_ON = 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--cv-ink)_28%,transparent)]';
const OPTION_OFF = 'bg-[var(--cv-chip)] text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]';
const OPTION_TITLE = 'mb-1.5 text-[11.5px] text-[var(--cv-ink-3)]';
const PICK = 'flex h-9 min-w-0 items-center gap-1.5 rounded-[10px] px-2.5 text-[14px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';
/** the panel under a selected node: wider and rounder than the menus, a hairline round it */
const PANEL = 'cv-bar-bottom relative rounded-[20px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] shadow-[var(--cv-float-shadow)]';
const PROMPT = 'mt-3 block max-h-[42vh] w-full resize-none bg-transparent px-1 text-[14px] leading-relaxed text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]';
const COMPOSER_FOOTER = 'mt-2 flex min-w-0 items-center gap-1';
const SEND = 'flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cv-invert)] text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:bg-[var(--cv-chip)] disabled:text-[var(--cv-ink-3)]';

/** A corner button of a composer: its tools, its words larger. */
const CORNER = 'flex h-8 w-8 items-center justify-center rounded-[9px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]';

/**
 * A node's composer, under it: what goes in, its words, how it is made. `above`, when shown, is a row over it (the
 * tools), the rest then set in a box of its own; `corner` sits by the expand button.
 */
function Composer({ id, shown, expanded, setExpanded, corner, above, children }: {
  id: string; shown: boolean; expanded: boolean; setExpanded: (expanded: boolean) => void; corner?: React.ReactNode; above?: React.ReactNode; children: React.ReactNode;
}) {
  const t = useT();
  const board = useBoard();
  const label = t(expanded ? 'canvas.panel.collapse' : 'canvas.panel.expand');
  return (
    <NodeToolbar nodeId={id} isVisible={shown} position={Position.Bottom} offset={14}>
      <div data-canvas-composer="" className={`nodrag nopan nowheel w-[min(680px,88vw)] ${above ? 'p-2' : ''} ${PANEL}`} onKeyDown={(event) => event.stopPropagation()}>
        {above}
        <div className={`relative px-4 pb-3 pt-4 ${above ? 'mt-2 rounded-[16px] bg-[color-mix(in_srgb,var(--cv-ink)_4%,transparent)]' : ''}`}>
          <div className="absolute right-3 top-3 flex items-center gap-0.5">
            {corner}
            <Tooltip label={label}>
              <button type="button" aria-label={label} aria-expanded={expanded} onClick={() => {
                setExpanded(!expanded);
                if (!expanded) board.showComposer?.(id);
              }} className={CORNER}>
                {expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
              </button>
            </Tooltip>
          </div>
          {children}
        </div>
      </div>
    </NodeToolbar>
  );
}

/** A tool over a composer: its mark on a colored square, its name. */
function ToolTile({ label, tone, icon: Icon, on, onClick }: { label: string; tone: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; on?: boolean; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`cv-tool flex h-12 w-full min-w-0 items-center gap-2.5 rounded-[14px] px-2.5 text-[14px] text-[var(--cv-ink)] transition ${on ? 'bg-[var(--cv-float-hover)]' : 'bg-[color-mix(in_srgb,var(--cv-ink)_4%,transparent)] hover:bg-[var(--cv-float-hover)]'}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-white shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.25)]" style={{ background: tone }}>
        <Icon size={17} strokeWidth={2} />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}
const TONES = {
  characters: 'linear-gradient(140deg, #f7a65e, #e0544c)',
  styles: 'linear-gradient(140deg, #b69cff, #6c5cf5)',
  presets: 'linear-gradient(140deg, #63c7ff, #3176f0)',
  effects: 'linear-gradient(140deg, #4fdcaa, #10a39b)',
};
/* the tools row stays as it was left, for every node, while the app is open */
let toolsShown = false;

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

export function SelectionToolbar({ ids, onGroup, onUngroup, onDuplicate, onRemove }: {
  ids: string[];
  onGroup?: () => void;
  onUngroup?: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const top = useStore((state) => {
    if (state.userSelectionActive) return null;
    const y = Math.min(...ids.map((id) => state.nodeLookup.get(id)?.internals.positionAbsolute.y ?? Infinity));
    return y * state.transform[2] + state.transform[1];
  });
  if (top === null) return null;
  const action = 'flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]';
  return (
    <NodeToolbar nodeId={ids} isVisible position={Position.Top} offset={Math.min(32, top - 48)} style={{ zIndex: 4 }}>
      <div data-canvas-selection-toolbar="" role="group" className={`nodrag nopan flex w-max items-center gap-0.5 p-1 ${CARD} cv-bar-top`}>
        {onGroup ? <button type="button" className={action} onClick={onGroup}><Group size={15} />{t('canvas.groupThem')}</button> : null}
        {onUngroup ? <button type="button" className={action} onClick={onUngroup}><Ungroup size={15} />{t('canvas.ungroup')}</button> : null}
        <Tooltip label={t('canvas.duplicate')}>
          <button type="button" aria-label={t('canvas.duplicate')} className={action} onClick={onDuplicate}><CopyPlus size={15} /></button>
        </Tooltip>
        <Tooltip label={t('canvas.remove')}>
          <button type="button" aria-label={t('canvas.remove')} className={action} onClick={onRemove}><Trash2 size={15} /></button>
        </Tooltip>
      </div>
    </NodeToolbar>
  );
}

/** What can be done with what a node shows: onto the timeline, shown in the Assets, saved, seen whole. */
export function ActionBar({ id, file, empty }: { id: string; file: WorkspaceResource | null; empty?: 'image' | 'video' }) {
  const t = useT();
  const board = useBoard();
  const [grid, setGrid] = React.useState(false);
  if (board.readOnly || board.single !== id || (!file && !empty)) return null;
  const btn = 'cv-tool nodrag flex h-9 items-center gap-2 rounded-[8px] px-2.5 text-[14px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';
  const icon = 'cv-tool nodrag flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';
  const line = <span className="mx-1 h-4 w-px bg-[var(--cv-float-line)]" />;
  const bar = 'cv-bar-top nopan flex w-max items-center gap-0.5 rounded-[14px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]';
  /* first, the agent: what it shows (or is to make) made a reference in the chat, to change or make from */
  const refer = board.refer ? (
    <>
      <Tooltip label={`${t('canvas.noteBar.toChat')} · ${MOD}L`}>
        <button type="button" aria-label={t('canvas.noteBar.toChat')} className={icon} onClick={() => board.refer?.(id)}><MessageSquareQuote size={17} /></button>
      </Tooltip>
      {line}
    </>
  ) : null;
  if (!file) {
    /* nothing made yet: the agent, or one of the person's own brought in as it */
    return (
      <NodeToolbar nodeId={id} isVisible position={Position.Top} offset={32}>
        <div className={`${bar} nodrag`}>
          {refer}
          <button type="button" className={btn} onClick={() => board.upload(id, 'version')}><Upload size={16} />{t('canvas.panel.upload')}</button>
        </div>
      </NodeToolbar>
    );
  }
  const base = file.name.replace(/\.[^.]+$/, '');
  const fail = (e: unknown) => console.warn(e);
  const video = file.kind === 'video';
  const actions = (
      <div className={`${bar} ${video ? 'cursor-grab active:cursor-grabbing' : 'nodrag'}`}>
        {refer}
        {file.kind === 'image' ? (
          <>
            <button type="button" className={btn} onClick={() => board.spawn(id, 'image', { preset: 'cameras9', opts: { ratio: '1:1' } })}><Orbit size={16} />{t('canvas.actions.angles')}</button>
            <Popover open={grid} onOpenChange={setGrid} placement="bottom" align="start"
              trigger={<button type="button" className={btn} onClick={() => setGrid((v) => !v)}><Grid2x2 size={16} />{t('canvas.actions.split')}<ChevronDown size={13} /></button>}>
              <div className={`w-[160px] p-1 ${CARD}`}>
                {[2, 3].map((n) => (
                  <button key={n} type="button" className={`${btn} w-full`} onClick={() => { setGrid(false); void splitGrid(board.sources.file(file), n, base).then((files) => board.bring(id, files), fail); }}>
                    {t('canvas.actions.splitInto').replace(/\{n\}/g, String(n))}
                  </button>
                ))}
              </div>
            </Popover>
            <button type="button" className={btn} onClick={() => board.redraw(id, file.path)}><Brush size={16} />{t('canvas.actions.redraw')}</button>
            <button type="button" className={btn} onClick={() => board.cutout(id, file.path)}><Eraser size={16} />{t('canvas.actions.cutout')}</button>
          </>
        ) : null}
        {file.kind !== 'other' ? <button type="button" className={btn} onClick={() => board.addToFilm(file)}><Clapperboard size={16} />{t('canvas.addToFilm')}</button> : null}
        {line}
        {board.reveal ? (
          <Tooltip label={t('canvas.actions.reveal')}>
            <button type="button" aria-label={t('canvas.actions.reveal')} className={icon} onClick={() => board.reveal!(file.path)}><FolderSearch size={17} /></button>
          </Tooltip>
        ) : null}
        <Tooltip label={t('canvas.actions.download')}>
          <a href={board.sources.file(file)} download={file.name} aria-label={t('canvas.actions.download')} className={icon}><Download size={17} /></a>
        </Tooltip>
        <Tooltip label={t('canvas.actions.view')}>
          <button type="button" aria-label={t('canvas.actions.view')} className={icon} onClick={() => board.view(file.path)}><Maximize2 size={17} /></button>
        </Tooltip>
      </div>
  );
  return video ? <VideoActionBar>{actions}</VideoActionBar> : (
    <NodeToolbar nodeId={id} isVisible position={Position.Top} offset={32}>{actions}</NodeToolbar>
  );
}

/** Keep the video tools inside the draggable node while matching the other floating tools' screen size. */
function VideoActionBar({ children }: { children: React.ReactNode }) {
  const zoom = useStore((state) => state.transform[2]);
  return (
    <div data-canvas-node-header="" data-canvas-video-controls="" data-canvas-video-toolbar="" className="absolute bottom-full left-1/2 z-20 origin-bottom -translate-x-1/2"
      style={{ scale: 1 / zoom, marginBottom: Math.max(36, 30 * zoom) / zoom }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => { if ((event.target as Element).closest('button, a')) event.stopPropagation(); }}>
      {children}
    </div>
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
    const on = picked?.via === c.via && picked?.model === c.model;
    return (
      <button key={`${c.via}|${c.model ?? ''}`} type="button" onClick={() => (c.connected ? onPick(c) : onConnect())}
        className={`flex w-full min-w-0 items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[13px] hover:bg-[var(--cv-float-hover)] ${on ? 'bg-[var(--cv-float-hover)]' : ''} ${c.connected ? 'text-[var(--cv-ink)]' : 'text-[var(--cv-ink-3)]'}`}>
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] bg-[var(--cv-chip)]"><ProviderMark id={c.via} size={13} /></span>
        <span className="min-w-0 flex-1 truncate leading-5">{c.name}</span>
        {on ? <Check size={14} className="shrink-0 text-[var(--cv-label)]" />
          : !c.connected ? <span className="shrink-0 rounded-md border !border-[var(--cv-float-line)] px-1.5 text-[11px] leading-[18px] text-[var(--cv-label)]">{t('canvas.panel.models.connect')}</span> : null}
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
  const [presetTab, setPresetTab] = React.useState<PresetGroup>(() => {
    const group = presetOf(data.preset)?.group;
    return group && PRESET_GROUPS.includes(group) ? group : PRESET_GROUPS[0]!;
  });
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
  const pictureCount = inputs.filter((i) => i.media === 'image').length;
  const modes = data.make === 'video' ? modesFor(model) : [];
  const mode = data.make === 'video' ? modeOf(data.opts, model, pictureCount, inputs.some((i) => i.media === 'video'), inputs.some((i) => i.media === 'audio')) : null;
  const omniInputs = ([
    ['image', model?.refs], ['video', model?.clip], ['audio', model?.voice],
  ] as const).filter(([, max]) => Boolean(max)).map(([kind, max]) => `${t(`canvas.history.kinds.${kind}`)} ×${Number(max)}`).join(' · ');
  const range = lengthRange(data.make, model, mode ?? undefined);
  const lengths = model?.only?.length ? model.only
    : range ? [...new Set([range[0], ...(MAKE_LENGTHS[data.make] ?? []).filter((n) => n > range[0] && n < range[1]), range[1]])] : null;
  /* a clip from a first frame is its shape, unless one is picked (computed below, once the frames are known) */
  let ratio = ratioOf(data.opts?.ratio, model);
  const sec = lengthOf(data.make, data.opts?.sec, model, mode ?? undefined);
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
  const acceptsAudio = data.make === 'video' && (model?.voice || model?.needs === 'audio');
  const assetRows = board.files.filter((f) => (f.kind === 'image' || (data.make === 'video' && f.kind === 'video') || (acceptsAudio && f.kind === 'audio'))
    && !inputs.some((i) => i.path === f.path))
    .map((f) => { const src = thumb(f); return { key: f.path, value: f.path, label: f.name, note: f.dir || undefined, icon: src ? <img src={src} alt="" className="h-8 w-11 rounded object-cover" /> : <Images size={15} /> }; });
  /* the tools over the composer, by kind: a picture takes a character, a style, a preset; a clip a character, an effect */
  const [showTools, setShowTools] = React.useState(toolsShown);
  const toggleTools = (on: boolean) => { toolsShown = on; setShowTools(on); if (!on && open === 'presets') setOpen(null); };
  const tools: Array<{ key: keyof typeof TONES; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; pick?: () => void }> = data.make === 'image' ? [
    { key: 'characters', label: t('canvas.panel.tools.characters'), icon: UserRound, pick: () => board.openLibrary('characters', id) },
    { key: 'styles', label: t('canvas.library.styleChip'), icon: Palette, pick: () => board.openLibrary('styles', id) },
    { key: 'presets', label: t('canvas.presets.title'), icon: LayoutDashboard },
  ] : data.make === 'video' ? [
    { key: 'characters', label: t('canvas.panel.tools.characters'), icon: UserRound, pick: () => board.openLibrary('characters', id) },
    { key: 'effects', label: t('canvas.library.effectChip'), icon: Clapperboard, pick: () => board.openLibrary('effects', id) },
  ] : [];
  const addMenu = (
    <div className={`w-[176px] p-1 ${CARD}`}>
      <button type="button" className={`${PICK} w-full`} onClick={() => { setOpen(null); board.upload(id, 'input'); }}><Plus size={15} />{t('canvas.panel.upload')}</button>
      <button type="button" className={`${PICK} w-full`} onClick={() => { setOpen(null); board.pick(id); }}><LayoutGrid size={15} />{t('canvas.panel.fromBoard')}</button>
      <button type="button" className={`${PICK} w-full`} onClick={() => setOpen('assets')}><Images size={15} />{t('canvas.panel.fromAssets')}</button>
    </div>
  );
  /* the presets as pictures of what each makes, a kind at a time */
  const presetMenu = (
    <div className={`w-[560px] p-3 ${CARD}`}>
      <div className="mb-3 flex flex-wrap gap-1">
        {PRESET_GROUPS.map((group) => (
          <button key={group} type="button" onClick={() => setPresetTab(group)}
            className={`h-7 rounded-[8px] px-2.5 text-[13px] transition ${group === presetTab ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`}>
            {t(`canvas.presets.groups.${group}`)}
          </button>
        ))}
      </div>
      <div className="grid max-h-[400px] grid-cols-3 gap-x-2.5 gap-y-3 overflow-y-auto">
        {PRESETS.filter((p) => p.group === presetTab).map((p) => {
          const off = p.fromPicture && !hasPicture;
          return (
            <button key={p.id} type="button" disabled={off} onClick={() => usePreset(p)} title={off ? t('canvas.presets.needsPicture') : undefined}
              className="group/preset min-w-0 text-left disabled:cursor-not-allowed">
              <span className={`relative block aspect-[3/2] overflow-hidden rounded-[10px] bg-[var(--cv-chip)] ${preset?.id === p.id ? 'ring-2 ring-[var(--cv-ring)]' : 'ring-1 ring-inset ring-[var(--cv-float-line)]'}`}>
                {PRESET_PICTURES[p.id] ? <img src={PRESET_PICTURES[p.id]} alt="" draggable={false} loading="lazy"
                  className={`h-full w-full object-cover transition duration-300 ${off ? 'opacity-40' : 'group-hover/preset:scale-[1.04]'}`} /> : null}
                {p.fromPicture ? (
                  <span className="absolute left-1.5 top-1.5 flex h-5 items-center gap-1 rounded-[6px] bg-black/60 px-1.5 text-[10.5px] text-white backdrop-blur-sm">
                    <ImageIcon size={11} />{t('canvas.presets.fromPicture')}
                  </span>
                ) : null}
              </span>
              <span className={`mt-1.5 block truncate px-0.5 text-[13px] ${off ? 'text-[var(--cv-ink-3)]' : 'text-[var(--cv-ink)]'}`}>{t(`canvas.presets.names.${p.id}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
  return (
    <Composer id={id} shown={shown} expanded={expanded} setExpanded={setExpanded}
      corner={tools.length ? (
        <Tooltip label={t('canvas.panel.tools.title')}>
          <button type="button" aria-label={t('canvas.panel.tools.title')} aria-pressed={showTools} onClick={() => toggleTools(!showTools)}
            className={`${CORNER} ${showTools ? 'bg-[var(--cv-float-hover)] !text-[var(--cv-ink)]' : ''}`}><Shapes size={16} /></button>
        </Tooltip>
      ) : null}
      above={showTools && tools.length ? (
        /* the tools: a character, a style or an effect from the libraries, a preset */
        <div className="cv-bar-bottom flex items-center gap-2">
          {tools.map((tool) => (
            <div key={tool.key} className="min-w-0 flex-1">
              {tool.key === 'presets' ? (
                <Popover open={open === 'presets'} onOpenChange={(v) => setOpen(v ? 'presets' : null)} placement="top" align="center" block
                  trigger={<ToolTile label={tool.label} tone={TONES.presets} icon={LayoutDashboard} on={open === 'presets' || Boolean(preset)} onClick={() => setOpen(open === 'presets' ? null : 'presets')} />}>
                  {presetMenu}
                </Popover>
              ) : <ToolTile label={tool.label} tone={TONES[tool.key]} icon={tool.icon} onClick={tool.pick} />}
            </div>
          ))}
          <Tooltip label={t('canvas.panel.collapse')}>
            <button type="button" aria-label={t('canvas.panel.collapse')} onClick={() => toggleTools(false)}
              className="flex h-12 w-10 shrink-0 items-center justify-center rounded-[14px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><ChevronUp size={16} /></button>
          </Tooltip>
        </div>
      ) : null}>
        {!takesPictures ? (
          /* a sound is a voice-over, music or a sound effect: each made by its own models */
          <div className="flex items-center gap-1 pr-20">
            <div className="flex items-center gap-0.5 rounded-[10px] bg-[var(--cv-chip)] p-0.5">
              {(['tts', 'music', 'sfx'] as const).map((k) => (
                <button key={k} type="button" onClick={() => { if (k !== data.make) set({ make: k, via: undefined, model: undefined }); }}
                  className={`flex h-6 items-center gap-1 rounded-[8px] px-2.5 text-[12px] transition ${k === data.make ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)] shadow-sm' : 'text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`}>
                  {k === 'tts' ? <Mic size={12} /> : k === 'music' ? <Music size={12} /> : <AudioLines size={12} />}{t(`canvas.make.${k}`)}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* what it is made from, each a tile left of the +: the frames' slots, then what is wired in, numbered */
          <div className="flex min-h-12 flex-wrap items-center gap-2 pr-20">
            {slots.map((slot, i) => {
              const input = slot.input;
              const file = input?.path ? board.fileOf(input.path) : null;
              const src = thumb(file);
              return input ? (
                <Tile key={input.edge} label={`${t(`canvas.slots.${slot.label}`)} · ${file?.name ?? input.path ?? ''}`} onOpen={input.path ? () => board.view(input.path!) : undefined}
                  onRemove={() => board.unwire(input.edge)} removeLabel={t('canvas.removeWire')}>
                  {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center bg-[var(--cv-chip)] text-[var(--cv-label)]"><Images size={17} /></span>}
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-px text-center text-[10px] font-medium text-white">{t(`canvas.slots.${slot.label}`)}</span>
                </Tile>
              ) : (
                <Popover key={`slot-${i}`} open={open === `slot-${i}`} onOpenChange={(v) => setOpen(v ? `slot-${i}` : null)} placement="auto"
                  trigger={(
                    <button type="button" onClick={() => setOpen(open === `slot-${i}` ? null : `slot-${i}`)}
                      className="flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-[10px] border border-dashed !border-[var(--cv-line)] text-[var(--cv-ink-2)] transition hover:!border-[var(--cv-ring)] hover:text-[var(--cv-ink)]">
                      <Plus size={14} /><span className="text-[10px] leading-none">{t(`canvas.slots.${slot.label}`)}</span>
                    </button>
                  )}>
                  {addMenu}
                </Popover>
              );
            })}
            {inputs.filter((input) => !slots.some((s) => s.input?.edge === input.edge)).map((input) => {
              const i = inputs.indexOf(input);
              const file = input.path ? board.fileOf(input.path) : null;
              const src = thumb(file);
              const name = input.text != null ? (input.text || t('canvas.kinds.note')).slice(0, 80) : file?.name ?? input.path ?? '';
              return (
                <Tile key={input.edge} label={input.text != null ? `${t('canvas.write.locate')} · ${name}` : `${t('canvas.write.preview')} · ${name}`}
                  onOpen={input.text != null ? (board.locate ? () => board.locate?.(input.from) : undefined) : input.path ? () => board.view(input.path!) : undefined}
                  onRemove={() => board.unwire(input.edge)} removeLabel={t('canvas.removeWire')}>
                  {src ? <img src={src} alt="" className="h-full w-full object-cover" />
                    : <span className="flex h-full w-full items-center justify-center bg-[var(--cv-chip)] text-[var(--cv-ink)]">
                      {input.text != null ? <TypeIcon size={20} strokeWidth={1.75} /> : file?.kind === 'audio' ? <Music size={18} /> : <Video size={18} />}
                    </span>}
                  <span className="absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-black/70 px-1 text-[10px] font-medium text-white">{i + 1}</span>
                </Tile>
              );
            })}
            {/* + : a picture from the computer, a node on the board, one from the Assets */}
            <Popover open={open === 'add' || open === 'assets'} onOpenChange={(v) => setOpen(v ? 'add' : null)} placement="auto"
              trigger={(
                <Tooltip label={t('canvas.panel.add')}>
                  <button type="button" aria-label={t('canvas.panel.add')} onClick={() => setOpen(open === 'add' || open === 'assets' ? null : 'add')}
                    className="cv-tool flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-chip)] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
                    <Plus size={20} strokeWidth={1.75} />
                  </button>
                </Tooltip>
              )}>
              {open === 'assets' ? <Listing rows={assetRows} empty={t('canvas.panel.nothingInAssets')} onPick={(path) => { board.wireIn(id, { path }); setOpen(null); }} /> : addMenu}
            </Popover>
          </div>
        )}
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
          className={PROMPT}
        />
        <div className={COMPOSER_FOOTER}>
          {every.length ? (
            <Popover open={open === 'model'} onOpenChange={(v) => setOpen(v ? 'model' : null)} placement="auto"
              trigger={(
                <button type="button" className={`${PICK} ${choices.length ? '' : 'text-amber-500 hover:text-amber-400'}`} onClick={() => setOpen(open === 'model' ? null : 'model')}>
                  {picked ?? fallback ? <ProviderMark id={(picked ?? fallback)!.via} size={16} /> : <Sparkles size={15} />}
                  <span className="max-w-[200px] truncate">{(picked ?? fallback)?.name ?? t('canvas.panel.connect')}</span><ChevronDown size={14} className="shrink-0 text-[var(--cv-ink-2)]" />
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
                        <span className="block text-[11.5px] leading-snug text-[var(--cv-ink-3)]">
                          {off ? t('canvas.modes.notThisModel') : m === 'omni' ? omniInputs : t(`canvas.modes.about.${m}`)}
                        </span>
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
              <Popover open={open === 'spec'} onOpenChange={(v) => setOpen(v ? 'spec' : null)} placement="top" align="center"
                trigger={(
                  <button type="button" className={PICK} onClick={() => setOpen(open === 'spec' ? null : 'spec')}>
                    {ratios ? <RatioIcon ratio={ratio} /> : null}
                    <span className="truncate">{spec.split(' · ').map((part, i) => <React.Fragment key={i}>{i ? <span className="px-1 text-[var(--cv-ink-3)]">·</span> : null}{part}</React.Fragment>)}</span>
                    <ChevronDown size={14} className="shrink-0 text-[var(--cv-ink-2)]" />
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
                className={SEND}><ArrowUp size={17} /></button>
            </Tooltip>
          )}
        </div>
        {error ? <div className="mt-2 select-text text-[12px] leading-snug text-red-500">{error}</div> : null}
    </Composer>
  );
}

/**
 * What a note is written from, in its panel: a rounded square of it, its name on hover; pressed, what it does (the
 * note it comes from found on the board, a file shown); a × off its corner takes it out.
 */
function Tile({ label, children, onOpen, onRemove, removeLabel, disabled }: {
  label: string; children: React.ReactNode; onOpen?: () => void; onRemove: () => void; removeLabel: string; disabled?: boolean;
}) {
  return (
    <div className="group/tile relative h-12 w-12 shrink-0">
      <button type="button" title={label} aria-label={label} onClick={onOpen} disabled={!onOpen}
        className="cv-tool block h-full w-full overflow-hidden rounded-[10px] ring-1 ring-inset ring-[var(--cv-float-line)] transition enabled:hover:ring-[var(--cv-ring)] disabled:cursor-default">
        {children}
      </button>
      <button type="button" aria-label={removeLabel} disabled={disabled} onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 z-10 hidden h-[18px] w-[18px] items-center justify-center rounded-full bg-[var(--cv-invert)] text-[var(--cv-on-invert)] shadow-[0_0_0_2px_var(--cv-float)] group-hover/tile:flex disabled:!hidden"><X size={11} strokeWidth={2.5} /></button>
    </div>
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
  const [sending, setSending] = React.useState(false);
  /* written now: sent from here, or still going after the panel was closed and opened again */
  const busy = sending || Boolean(board.writing?.(id));
  const [uploading, setUploading] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [attachments, setAttachments] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const write = board.write;
  const upload = board.uploadWritingFiles;
  const Picker = studioHost?.canvasWriting?.Picker;
  const thumb = useThumb();
  /* what it says now goes with the ask, to rework: its panel says so */
  const said = useStore((s) => Boolean((s.nodeLookup.get(id)?.data as { text?: string } | undefined)?.text?.trim()));
  if (!write) return null;
  const shown = board.single === id && !board.readOnly;
  const texts = shown ? board.inputs(id).filter((i) => i.text != null) : [];
  const wired = texts.length;
  const canSend = !busy && !uploading && Boolean(ask.trim() || wired || attachments.length);
  /* a Markdown or text file added, read and shown as the note's own words are */
  const [reading, setReading] = React.useState<{ name: string; text: string } | null>(null);
  const readWords = async (path: string, name: string) => {
    try {
      const res = await fetch(board.sources.file(board.fileOf(path) ?? { path, mtimeMs: 0 } as WorkspaceResource));
      if (!res.ok) throw new Error(String(res.status));
      setReading({ name, text: await res.text() });
    } catch { setError(t('canvas.write.unreadable')); }
  };
  const attach = async (files: File[]) => {
    if (!upload || !files.length || uploading || busy) return;
    if (files.length + attachments.length > WRITING_ATTACHMENT_LIMIT || files.some((file) => !writingAttachmentKind(file.name))) {
      setError(t('canvas.write.attachTypes').replace('{n}', String(WRITING_ATTACHMENT_LIMIT)));
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const kept = await upload(files, (_index, _progress, path) => {
        if (path) setAttachments((current) => [...new Set([...current, path])]);
      });
      setAttachments((current) => [...new Set([...current, ...kept])]);
    } catch (error) {
      setError(error instanceof Error ? error.message : t('assets.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };
  const send = () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    /* written: the ask is done; refused: it stays, to send again */
    void write(id, ask.trim(), attachments).then((why) => {
      setSending(false);
      setError(why);
    });
  };
  return (
    <Composer id={id} shown={shown} expanded={expanded} setExpanded={setExpanded}>
        {/* what it is written from, each a tile left of the +: the words wired in, then the files added here */}
        <div className="flex min-h-12 flex-wrap items-center gap-2 pr-9">
          {/* a note wired in: its kind's mark; pressed, the note found on the board */}
          {texts.map((input) => (
            <Tile key={input.edge} label={`${t('canvas.write.locate')} · ${(input.text || t('canvas.kinds.note')).slice(0, 80)}`} onOpen={board.locate ? () => board.locate?.(input.from) : undefined}
              onRemove={() => board.unwire(input.edge)} removeLabel={t('canvas.removeWire')}>
              <span className="flex h-full w-full items-center justify-center bg-[var(--cv-chip)] text-[var(--cv-ink)]"><TypeIcon size={20} strokeWidth={1.75} /></span>
            </Tile>
          ))}
          {attachments.map((path) => {
            const name = path.split('/').pop() ?? path;
            const file = board.fileOf(path);
            const src = thumb(file);
            /* shown large when it can be: a picture, a clip, a sound, words (a Markdown or text file) */
            const viewable = file && (file.kind === 'image' || file.kind === 'video' || file.kind === 'audio');
            const words = writingAttachmentKind(name) === 'text';
            const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toUpperCase().slice(0, 4) : '';
            return (
              <Tile key={path} label={viewable || words ? `${t('canvas.write.preview')} · ${name}` : name} onOpen={viewable ? () => board.view(path) : words ? () => void readWords(path, name) : undefined}
                disabled={busy || uploading} removeLabel={`${t('canvas.remove')} ${name}`}
                onRemove={() => setAttachments((current) => current.filter((item) => item !== path))}>
                {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : (
                  <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-[var(--cv-chip)] text-[var(--cv-ink-2)]">
                    <FileText size={17} strokeWidth={1.75} />{ext ? <span className="text-[9.5px] font-medium leading-none tracking-wide">{ext}</span> : null}
                  </span>
                )}
              </Tile>
            );
          })}
          {upload ? <label className={`cv-tool relative flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-chip)] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)] focus-within:outline ${busy || uploading ? 'opacity-60' : 'cursor-pointer'}`} title={t('canvas.write.add')}>
            <input type="file" multiple accept={WRITING_ATTACHMENT_ACCEPT} disabled={busy || uploading} aria-label={t('canvas.write.attach')}
              className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-default" onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                void attach(files);
              }} />
            {uploading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Plus size={20} strokeWidth={1.75} />}
          </label> : null}
        </div>
        <textarea
          value={ask}
          rows={expanded ? 14 : 3}
          disabled={busy}
          onChange={(event) => { setAsk(event.target.value); setError(null); }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Escape') event.currentTarget.blur();
            else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); send(); }
          }}
          placeholder={t(said ? 'canvas.write.rework' : 'canvas.write.placeholder')}
          className={`${PROMPT} disabled:opacity-60`}
        />
        <div className={COMPOSER_FOOTER}>
          {Picker ? <Picker triggerClassName={PICK} /> : <span className={PICK}>
            <Sparkles size={14} className="shrink-0" /><span className="truncate">{t('canvas.write.by')}</span>
          </span>}
          <span className="flex-1" />
          <Tooltip label={`${t('canvas.write.run')} · ${MOD}↵`}>
            <button type="button" aria-label={t('canvas.write.run')} disabled={!canSend} onClick={send}
              className={SEND}>
              {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ArrowUp size={17} />}
            </button>
          </Tooltip>
        </div>
        {error ? <div className="mt-2 select-text text-[12px] leading-snug text-red-500">{error}</div> : null}
        {reading ? <DocSheet name={reading.name} text={reading.text} onClose={() => setReading(null)} /> : null}
    </Composer>
  );
}

/** A cut's panel: what it puts on the timeline, and the button that does. */
export function CutPanel({ id, count }: { id: string; count: number }) {
  const t = useT();
  const board = useBoard();
  return (
    <NodeToolbar nodeId={id} isVisible={board.single === id && !board.readOnly} position={Position.Bottom} offset={14}>
      <div className={`nodrag nopan flex w-[min(420px,80vw)] items-center gap-3 p-3 ${CARD} cv-bar-bottom`}>
        <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-[var(--cv-label)]">{count ? t('canvas.cut.how') : t('canvas.cut.waiting')}</span>
        <button type="button" disabled={!count} onClick={() => board.sendToFilm(id)}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[var(--primary)] px-4 text-[13px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-30">
          <Clapperboard size={14} />{t('canvas.cut.send')}
        </button>
      </div>
    </NodeToolbar>
  );
}
