/**
 * What floats by a node while it is the one selected: over it, what can be done with what it shows (onto the
 * timeline, into the Assets, saved, seen whole); under it, a node that makes something has its panel (what goes into
 * it, numbered in its wires' order; its words; with which model; its shape, length and how pictures are used; Make),
 * and a cut its own (onto the timeline). Floating, they keep their size however far the board is zoomed.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { NodeToolbar, Position, useStore } from '@xyflow/react';
import {
  ArrowUp, ArrowUpRight, Camera, ChevronLeft, ChevronRight, FileText, AudioLines, Brush, Palette, UserRound, Film, Grid2x2, LayoutDashboard, Orbit, Check, ChevronDown, Clapperboard, CopyPlus, Download, FolderSearch, Group, Images, LayoutGrid, Maximize2, Mic, Minimize2, Music, Plus, Search, Sparkles, Square, Trash2, Ungroup, Video, X, Type as TypeIcon, MessageSquareQuote, Shapes, ChevronUp, AtSign, Scissors, Upload, Image as ImageIcon, SunMedium, Expand, Layers, Repeat, Wand2, Crop, SlidersHorizontal, MessageSquareText, Lightbulb, GalleryHorizontal, Settings2, SkipBack, SkipForward, ScissorsLineDashed, RectangleHorizontal, ChevronsRight, PersonStanding, GripVertical, RotateCcw,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { GIF_FRAMES, GIF_FRAME_MS, IMAGE_RATIOS, MAKE_COUNTS, MAKE_MEDIA, VIDEO_RATIOS, frameRatio, lengthOf, lengthRange, modeOf, modesFor, ratioOf, type VideoMode } from '@/lib/canvas';
import { PRESETS, PRESET_GROUPS, presetOf, type CanvasPreset, type PresetGroup } from '@/lib/canvas-presets';

/** each preset's picture of what it makes (made for OpenFilm), by its id */
const PRESET_PICTURES: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob<string>('./presets/*.webp', { eager: true, import: 'default' }))
  .map(([path, url]) => [path.slice('./presets/'.length, -'.webp'.length), url]));
import type { WorkspaceResource } from '@/lib/workspace-resources';
import { studioHost } from '@/lib/host';
import { frameOf } from './pixels';
import { CLIP_TOOLS, clipModels, type ClipToolKey } from '@/lib/canvas-clip';
import { Popover } from '../Popover';
import { Tooltip } from '../Tooltip';
import { keepLastModel, lastModel, useBoard, type Choice, type MakeData } from './board';
import { ProviderMark } from '../settings/ProviderMark';
import { useDraft } from './words';
import { DocSheet } from './doc';
import { MoveClip, coverOf, stylePicture, useSubjects } from './libraries';
import { GROUP, cameraLook } from './camera';
import { cameraOf, picksAnything } from '@/lib/canvas-camera';
import type { CanvasCharacter } from '@/api';
import { useLibraryVoices, voiceLook } from '@/lib/library-voices';
import { VoiceId, VoicePicker, defaultVoice, serviceOf, voicesOf } from './voices';
import { WRITING_ATTACHMENT_ACCEPT, WRITING_ATTACHMENT_LIMIT, writingAttachmentKind } from '../../../../../src/canvas-attachments.mjs';

const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
/** the lengths offered for each kind, in seconds */
const MAKE_LENGTHS: Partial<Record<MakeData['make'], number[]>> = { video: [4, 5, 6, 8, 10, 15], sfx: [1, 2, 3, 5, 10], music: [15, 30, 60, 120] };
const CARD = 'cv-pop rounded-[16px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] shadow-[var(--cv-float-shadow)]';
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
 * A node's composer, under it: what goes in, its words, how it is made. `above` is a row over it (the tools), opened
 * and closed with a slide (`aboveOpen`), the rest then set in a box of its own; `corner` sits by the expand button.
 */
function Composer({ id, shown, expanded, setExpanded, corner, above, aboveOpen = false, children }: {
  id: string; shown: boolean; expanded: boolean; setExpanded: (expanded: boolean) => void; corner?: React.ReactNode; above?: React.ReactNode; aboveOpen?: boolean; children: React.ReactNode;
}) {
  const t = useT();
  const board = useBoard();
  const label = t(expanded ? 'canvas.panel.collapse' : 'canvas.panel.expand');
  return (
    <NodeToolbar nodeId={id} isVisible={shown} position={Position.Bottom} offset={14}>
      {/* its words keep the panel's color whether the tools are open or not; open, a deeper band above holds the tools */}
      <div data-canvas-composer="" className={`nodrag nopan nowheel w-[min(680px,88vw)] transition-[background-color] duration-200 ease-out ${PANEL} ${aboveOpen ? '!bg-[var(--cv-float-deep)]' : ''}`} onKeyDown={(event) => event.stopPropagation()}>
        {above ? (
          <div aria-hidden={!aboveOpen} className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${aboveOpen ? 'grid-rows-[1fr] opacity-100' : 'pointer-events-none grid-rows-[0fr] opacity-0'}`}>
            <div className="min-h-0 overflow-hidden"><div className="p-2">{above}</div></div>
          </div>
        ) : null}
        <div className={`relative rounded-[20px] bg-[var(--cv-float)] px-4 pb-3 pt-4 transition-shadow duration-200 ease-out ${aboveOpen ? 'shadow-[0_0_0_0.5px_var(--cv-float-line)]' : ''}`}>
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

/** each tool's own picture (tools/tool-<key>.webp), drawn in place of its mark on a colored square when there is one */
const TOOL_PICTURES: Record<string, string> = Object.fromEntries(Object.entries(import.meta.glob<string>('./tools/tool-*.webp', { eager: true, import: 'default' }))
  .map(([path, url]) => [path.split('/').pop()!.replace(/^tool-|\.webp$/g, ''), url]));

/**
 * A tool over a composer: its picture (or its mark on a colored square), its name — or, once something is picked with
 * it, what was picked, lit; pointed at, a picture of it above and a × to take it off.
 */
function ToolTile({ label, tone, icon: Icon, picture, on, value, preview, onClear, onClick }: {
  label: string; tone: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; picture?: string; on?: boolean;
  value?: string; preview?: React.ReactNode; onClear?: () => void; onClick?: () => void;
}) {
  const t = useT();
  /* the preview hangs over the board, above the card the composer belongs to: drawn in the body, where the tile is */
  const [over, setOver] = React.useState<DOMRect | null>(null);
  return (
    <div className="group/tile relative w-full min-w-0" onPointerEnter={(event) => setOver(event.currentTarget.getBoundingClientRect())} onPointerLeave={() => setOver(null)}>
      <button type="button" onClick={() => { setOver(null); onClick?.(); }}
        className={`cv-tool flex h-12 w-full min-w-0 items-center gap-2.5 rounded-[14px] px-2.5 text-[14px] transition ${on ? 'bg-[color-mix(in_srgb,var(--cv-ink)_9%,var(--cv-float))]' : 'bg-[color-mix(in_srgb,var(--cv-ink)_3%,var(--cv-float))] hover:bg-[color-mix(in_srgb,var(--cv-ink)_7%,var(--cv-float))]'} ${value ? 'text-[#4aa3ff]' : 'text-[var(--cv-ink)]'}`}>
        {picture ? <img src={picture} alt="" draggable={false} className="h-7 w-7 shrink-0 object-contain" /> : (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-white shadow-[inset_0_0_0_0.5px_rgba(255,255,255,0.25)]" style={{ background: tone }}>
            <Icon size={15} strokeWidth={2} />
          </span>
        )}
        <span className="truncate">{value ?? label}</span>
      </button>
      {value && preview && over ? createPortal(
        <div className="cv-fade pointer-events-none fixed z-[1900] -translate-y-full overflow-hidden rounded-[10px] shadow-[var(--cv-float-shadow)] ring-1 ring-inset ring-[var(--cv-float-line)]"
          style={{ left: over.left, width: over.width, top: over.top - 12 }}>
          {preview}
        </div>,
        document.body,
      ) : null}
      {value && onClear ? (
        <button type="button" aria-label={t('canvas.panel.clearTool')} onClick={onClear}
          className="absolute -right-1 -top-1 z-10 hidden h-[15px] w-[15px] items-center justify-center rounded-full bg-black text-white shadow-[0_0_0_1px_rgba(255,255,255,0.22)] group-hover/tile:flex"><X size={9} strokeWidth={2.75} /></button>
      ) : null}
    </div>
  );
}
const TONES = {
  camera: 'linear-gradient(140deg, #5d6470, #2c3038)',
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
        {onGroup ? <Tooltip label={t('canvas.groupThem')} shortcut={`${MOD}G`}><button type="button" className={action} onClick={onGroup}><Group size={15} />{t('canvas.groupThem')}</button></Tooltip> : null}
        {onUngroup ? <Tooltip label={t('canvas.ungroup')} shortcut={`${MOD}⇧G`}><button type="button" className={action} onClick={onUngroup}><Ungroup size={15} />{t('canvas.ungroup')}</button></Tooltip> : null}
        <Tooltip label={t('canvas.duplicate')} shortcut={`${MOD}D`}>
          <button type="button" aria-label={t('canvas.duplicate')} className={action} onClick={onDuplicate}><CopyPlus size={15} /></button>
        </Tooltip>
        <Tooltip label={t('canvas.remove')} shortcut="⌫">
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
  const [open, setOpen] = React.useState<string | null>(null);
  const [customizing, setCustomizing] = React.useState(false);
  useBars();
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
  const video = file.kind === 'video';
  const shape = frameRatio(file.w, file.h);
  /* a preset made from this picture: at the picture's own shape when it changes the picture, else at the preset's */
  const from = (p: CanvasPreset, then: 'make' | 'wait' = 'make', prompt?: string) => {
    setOpen(null);
    const made = board.spawn(id, 'image', { preset: p.id, ...(prompt ? { prompt } : {}), opts: { ratio: p.fromPicture && p.id !== 'panoramaFrom' ? shape ?? p.ratio : p.ratio } });
    /* made at once from this picture, as every picture tool makes; one that needs more wired in first waits */
    if (then === 'make') requestAnimationFrame(() => requestAnimationFrame(() => board.make(made)));
    return made;
  };
  /* what the connected models can do: a tool only shows when one of them does it */
  const pictures = board.choices('image');
  const can = { mask: pictures.some((c) => c.spec?.mask), markup: pictures.some((c) => c.spec?.markup), video: board.choices('video').length > 0, agent: Boolean(board.write) };
  /* the model a new picture node makes with (the last picked, else Settings'), for its largest size */
  const last = lastModel('image');
  const maker = pictures.find((c) => last && c.via === last.via && c.model === last.model) ?? board.fallback('image');
  const largest = [...(maker?.spec?.sizes ?? [])].sort((a, b) => parseFloat(b) - parseFloat(a))[0];
  const tools: CardTools = {
    expression: (words) => { from(presetOf('expression')!, 'make', words); },
    sizes: (ratios) => { setOpen(null); board.sizes(id, ratios); },
    set: (parts) => { setOpen(null); board.productSet(id, parts); },
    swap: () => board.pick(from(presetOf('productSwap')!, 'wait')),
    blend: () => board.pick(from(presetOf('blend')!, 'wait')),
    upscale: () => {
      setOpen(null);
      const made = board.spawn(id, 'image', { preset: 'upscale', opts: { ...(shape ? { ratio: shape } : {}), ...(largest ? { size: largest } : {}), ...(maker?.spec?.qualities?.includes('high') ? { quality: 'high' } : {}) } });
      requestAnimationFrame(() => requestAnimationFrame(() => board.make(made)));
    },
  };
  /* a clip made from the picture as its first frame: moving on its own, from words, to a last frame picked, with a camera move */
  const clip = (data: Partial<MakeData>) => { setOpen(null); return board.spawn(id, 'video', { ...data, opts: { mode: 'first', ...(shape ? { ratio: shape } : {}), ...data.opts } }); };
  /* a clip made from this clip by a model: a tool only when a connected model does it, opening what it asks */
  const clipChoices = video ? board.choices('video') : [];
  const clipTools = CLIP_TOOLS.filter((c) => clipModels(c, clipChoices).length).map((c) => ({ key: c.key, icon: CLIP_ICONS[c.key], run: () => { setOpen(null); board.clipAI(id, file.path, c.key); } }));
  /* a frame of the clip as a picture beside it: where it is playing, its first, its last */
  const grabFrame = async (mode: 'current' | 'first' | 'last') => {
    setOpen(null);
    const player = document.querySelector<HTMLVideoElement>(`.react-flow__node[data-id="${CSS.escape(id)}"] video`);
    const length = player && Number.isFinite(player.duration) ? player.duration : (file.durationMs ?? 0) / 1000;
    const at = mode === 'first' ? 0 : mode === 'last' ? Math.max(0, length - 0.04) : player?.currentTime ?? 0;
    try { board.bring(id, [await frameOf(board.sources.file(file), at, `${file.name.replace(/\.[^.]+$/, '')}-${mode}-frame.png`)]); }
    catch { board.reportError?.(t('canvas.video.captureFailed')); }
  };
  /* ── the tools, each a key: those kept on the bar in the person's order (BarSettings), the rest under More ── */
  const tool = (key: string, label: string, icon: BarTool['icon'], run: () => void): BarTool => ({ key, label, icon, run });
  const menu = (key: string, label: string, icon: BarTool['icon'], caption: string, tone: Tone, items: MenuItem[]): BarTool => ({ key, label, icon, menu: { caption, tone, items } });
  const all: BarTool[] = file.kind === 'image' ? [
    ...(can.mask || can.markup ? [tool('redraw', t('canvas.actions.redraw'), Wand2, () => board.redraw(id, file.path))] : []),
    ...(can.mask ? [tool('expand', t('canvas.expand.title'), Expand, () => board.openTool(id, file.path, 'expand'))] : []),
    tool('cutout', t('canvas.actions.cutout'), Scissors, () => board.cutout(id, file.path)),
    tool('light', t('canvas.actions.light'), SunMedium, () => board.openTool(id, file.path, 'light')),
    { key: 'create', label: t('canvas.create.title'), icon: LayoutDashboard, picker: <PresetPicker hasPicture onPick={(p) => from(p)} tools={tools} /> },
    menu('edit', t('canvas.create.edit'), SlidersHorizontal, t('canvas.create.captions.edit'), 'blue', [
      { key: 'crop', icon: Crop, label: t('canvas.tools.crop'), about: t('canvas.create.about.crop'), run: () => board.openTool(id, file.path, 'crop') },
      { key: 'adjust', icon: Palette, label: t('canvas.tools.adjust'), about: t('canvas.create.about.adjust'), run: () => board.openTool(id, file.path, 'adjust') },
      { key: 'split', icon: Grid2x2, label: t('canvas.actions.split'), about: t('canvas.create.about.split'), more: <GridPicker onPick={(rows, cols) => { setOpen(null); board.split(id, file.path, rows, cols); }} /> },
      ...(can.mask ? [{ key: 'layers', icon: Layers, label: t('canvas.marketing.layers'), about: t('canvas.marketing.layersAbout'), run: () => board.layers(id, file.path) }] : []),
    ]),
    ...(can.video ? [menu('video', t('canvas.create.video'), Clapperboard, t('canvas.create.captions.video'), 'violet', [
      { key: 'motion', icon: Sparkles, label: t('canvas.marketing.motion'), about: t('canvas.marketing.motionAbout'), run: () => clip({ prompt: MOTION_WORDS }) },
      { key: 'first', icon: Film, label: t('canvas.create.first'), about: t('canvas.create.about.first'), run: () => clip({}) },
      { key: 'firstLast', icon: Repeat, label: t('canvas.create.firstLast'), about: t('canvas.create.about.firstLast'), run: () => board.pick(clip({ opts: { mode: 'firstLast' } })) },
      { key: 'effect', icon: Orbit, label: t('canvas.create.effect'), about: t('canvas.create.about.effect'), run: () => board.openLibrary('effects', clip({})) },
    ])] : []),
    ...(can.agent ? [menu('agent', t('canvas.assist.title'), MessageSquareText, t('canvas.create.captions.agent'), 'amber', [
      { key: 'shots', icon: Clapperboard, label: t('canvas.assist.shots'), about: t('canvas.assist.shotsAbout'), run: () => board.assist(id, file.path, 'shots') },
      { key: 'prompt', icon: FileText, label: t('canvas.assist.prompt'), about: t('canvas.assist.promptAbout'), run: () => board.assist(id, file.path, 'prompt') },
      { key: 'ideas', icon: Lightbulb, label: t('canvas.assist.ideas'), about: t('canvas.assist.ideasAbout'), run: () => board.assist(id, file.path, 'ideas') },
      { key: 'text', icon: TypeIcon, label: t('canvas.marketing.editText'), about: t('canvas.marketing.editTextAbout'), run: () => board.assist(id, file.path, 'text') },
    ])] : []),
    tool('addToFilm', t('canvas.addToFilm'), Clapperboard, () => board.addToFilm(file)),
  ] : video ? [
    /* made from the clip by a model that does it: its own (Kling, Gemini, Luma, MiniMax, sync), else one that takes a clip as a reference */
    ...clipTools.map((c) => tool(c.key, t(`canvas.clipTools.${c.key}`), c.icon, c.run)),
    menu('frames', t('canvas.clipTools.frames'), Camera, t('canvas.clipTools.framesAbout'), 'green', (['current', 'first', 'last'] as const).map((mode) => (
      { key: mode, icon: mode === 'current' ? Camera : mode === 'first' ? SkipBack : SkipForward, label: t(`canvas.video.${mode}`), about: t(`canvas.clipTools.frameAbout.${mode}`), run: () => { void grabFrame(mode); } }))),
    tool('trim', t('canvas.clipTools.trim'), ScissorsLineDashed, () => board.clipTool(id, file.path, 'trim')),
    menu('crop', t('canvas.clipTools.crop'), Crop, t('canvas.clipTools.cropAbout'), 'blue', ['9:16', '16:9', '1:1', '4:3', '3:4', '21:9'].map((r) => (
      { key: r, icon: RectangleHorizontal, label: r, about: t('canvas.clipTools.cropTo').replace('{r}', r), run: () => board.clipTool(id, file.path, 'crop', r) }))),
    tool('audio', t('canvas.clipTools.audio'), AudioLines, () => board.clipTool(id, file.path, 'audio')),
    tool('shots', t('canvas.clipTools.shots'), LayoutGrid, () => board.shots(id, file.path)),
    ...(can.agent ? [menu('agent', t('canvas.assist.title'), MessageSquareText, t('canvas.create.captions.agent'), 'amber', [
      { key: 'shotList', icon: Clapperboard, label: t('canvas.clipTools.shotList'), about: t('canvas.clipTools.shotListAbout'), run: () => board.clipAssist(id, file.path, 'shots') },
      { key: 'prompt', icon: FileText, label: t('canvas.clipTools.prompt'), about: t('canvas.clipTools.promptAbout'), run: () => board.clipAssist(id, file.path, 'prompt') },
    ])] : []),
    tool('addToFilm', t('canvas.addToFilm'), Clapperboard, () => board.addToFilm(file)),
  ] : file.kind !== 'other' ? [tool('addToFilm', t('canvas.addToFilm'), Clapperboard, () => board.addToFilm(file))] : [];
  const kind: BarKind | null = file.kind === 'image' ? 'image' : video ? 'video' : null;
  const keys = kind ? barLayout(kind) : all.map((x) => x.key);
  const shownTools = keys.map((k) => all.find((x) => x.key === k)).filter((x): x is BarTool => Boolean(x));
  const moreTools = all.filter((x) => !keys.includes(x.key));
  const render = (x: BarTool) => x.menu ? (
    <ToolMenu key={x.key} label={x.label} caption={x.menu.caption} tone={x.menu.tone} icon={x.icon} open={open === x.key} onOpen={(v) => setOpen(v ? x.key : null)} items={x.menu.items} />
  ) : x.picker ? (
    <Popover key={x.key} open={open === x.key} onOpenChange={(v) => setOpen(v ? x.key : null)} placement="bottom" align="start"
      trigger={<button type="button" className={`${btn} ${open === x.key ? 'bg-[var(--cv-float-hover)]' : ''}`} onClick={() => setOpen(open === x.key ? null : x.key)}>{React.createElement(x.icon, { size: 16 })}{x.label}<ChevronDown size={13} className={`transition-transform duration-200 ${open === x.key ? 'rotate-180' : ''}`} /></button>}>
      {x.picker}
    </Popover>
  ) : (
    <button key={x.key} type="button" className={btn} onClick={() => { setOpen(null); x.run?.(); }}>{React.createElement(x.icon, { size: 16 })}{x.label}</button>
  );
  const actions = (
      <div className={`${bar} ${video ? 'cursor-grab active:cursor-grabbing' : 'nodrag'}`}>
        {refer}
        {shownTools.map(render)}
        {moreTools.length ? <MoreTools tools={moreTools} open={open === 'more'} onOpen={(v) => setOpen(v ? 'more' : null)} /> : null}
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
        {kind ? (
          <Tooltip label={t('canvas.bar.customize')}>
            <button type="button" aria-label={t('canvas.bar.customize')} className={icon} onClick={() => { setOpen(null); setCustomizing(true); }}><Settings2 size={17} /></button>
          </Tooltip>
        ) : null}
        {customizing && kind ? <BarSettings kind={kind} tools={all} onClose={() => setCustomizing(false)} /> : null}
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

/** each way a clip is made, as a mark */
const MODE_ICONS: Record<VideoMode, React.ComponentType<{ size?: number }>> = { text: TypeIcon, first: ImageIcon, firstLast: GalleryHorizontal, refs: Images, omni: Images };

/**
 * How long a clip is, on a ruler: a tick each second, every fifth named; the lengths its model makes lit, the rest
 * faint. Dragged, clicked, typed or stepped with the arrows, it keeps to what the model makes (only its own lengths,
 * when it makes only some).
 */
export function LengthPicker({ value, range, only, label, onChange }: { value: number; range: [number, number]; only?: number[]; label?: string; onChange: (n: number) => void }) {
  const t = useT();
  const end = Math.max(5, Math.ceil(range[1] / 5) * 5);
  const fit = (n: number) => (only?.length ? only.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best))
    : Math.min(range[1], Math.max(range[0], Math.round(n))));
  const step = (by: number) => {
    if (!only?.length) return onChange(fit(value + by));
    const list = [...only].sort((x, y) => x - y);
    const i = list.indexOf(fit(value));
    onChange(list[Math.max(0, Math.min(list.length - 1, i + by))]!);
  };
  const track = React.useRef<HTMLDivElement>(null);
  const at = (x: number) => { const box = track.current!.getBoundingClientRect(); return fit(((x - box.left) / box.width) * end); };
  const [typed, setTyped] = React.useState<string | null>(null);
  const commit = () => { if (typed) onChange(fit(Number(typed))); setTyped(null); };
  const pct = (n: number) => `${(n / end) * 100}%`;
  const makes = (n: number) => (only?.length ? only.includes(n) : n >= range[0] && n <= range[1]);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11.5px] text-[var(--cv-ink-3)]">{label ?? t('canvas.make.length')}</span>
        <label className="flex h-8 items-baseline gap-1 rounded-[9px] bg-[var(--cv-chip)] px-2.5 pt-[5px] focus-within:ring-1 focus-within:ring-[var(--cv-ring)]">
          <input value={typed ?? String(value)} inputMode="numeric" aria-label={t('canvas.make.length')}
            onChange={(event) => setTyped(event.target.value.replace(/\D/g, '').slice(0, 3))} onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); commit(); }
              else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); setTyped(null); step(event.key === 'ArrowUp' ? 1 : -1); }
            }}
            className="w-8 bg-transparent text-right text-[15px] font-semibold tabular-nums text-[var(--cv-ink)] outline-none" />
          <span className="text-[12px] text-[var(--cv-ink-3)]">{t('canvas.make.secondsUnit')}</span>
        </label>
      </div>
      <div ref={track} role="slider" tabIndex={0} aria-label={t('canvas.make.length')} aria-valuemin={range[0]} aria-valuemax={range[1]} aria-valuenow={value}
        className="nodrag relative h-12 cursor-pointer touch-none select-none outline-none"
        onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onChange(at(event.clientX)); }}
        onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) onChange(at(event.clientX)); }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); step(1); }
          else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); step(-1); }
        }}>
        {/* the bar: faint, the lengths it makes a step lighter, up to the length picked lit */}
        <div className="absolute inset-x-0 top-2 h-3 rounded-full bg-[var(--cv-chip)]" />
        {only?.length ? null : <div className="absolute top-2 h-3 rounded-full bg-[color-mix(in_srgb,var(--cv-ink)_8%,transparent)]" style={{ left: pct(range[0]), width: pct(range[1] - range[0]) }} />}
        <div className="absolute left-0 top-2 h-3 rounded-full bg-[color-mix(in_srgb,var(--cv-ink)_30%,transparent)] transition-[width] duration-75" style={{ width: pct(value) }} />
        <div className="absolute top-0 h-7 w-[6px] -translate-x-1/2 rounded-full bg-[var(--cv-ink)] shadow-[0_1px_4px_rgba(0,0,0,0.4)] transition-[left] duration-75" style={{ left: pct(value) }} />
        {/* a tick each second (each length it makes, when only some), every fifth named */}
        {Array.from({ length: end + 1 }, (_, n) => n).filter((n) => !only?.length || makes(n) || n % 5 === 0).map((n) => (
          <React.Fragment key={n}>
            <span className={`absolute top-[22px] w-px -translate-x-1/2 ${n % 5 === 0 ? 'h-2' : 'h-1'} ${makes(n) ? 'bg-[var(--cv-ink-3)]' : 'bg-[color-mix(in_srgb,var(--cv-ink)_10%,transparent)]'}`} style={{ left: pct(n) }} />
            {n % 5 === 0 || (only?.length && makes(n)) ? (
              <span className={`absolute top-8 -translate-x-1/2 text-[11px] tabular-nums ${n === value ? 'text-[var(--cv-ink)]' : makes(n) ? 'text-[var(--cv-ink-3)]' : 'text-[color-mix(in_srgb,var(--cv-ink)_18%,transparent)]'}`} style={{ left: pct(n) }}>{n}</span>
            ) : null}
          </React.Fragment>
        ))}
      </div>
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

/** what a picture can be made into beyond the presets, as cards in their kind's tab: each run, or with choices first */
export interface CardTools {
  expression: (words: string) => void;
  sizes: (ratios: string[]) => void;
  set: (presets: string[]) => void;
  swap: () => void;
  blend: () => void;
  upscale: () => void;
}
/** those cards, by tab */
const TOOL_CARDS: Partial<Record<PresetGroup, Array<keyof CardTools>>> = { role: ['expression'], product: ['swap', 'set'], design: ['sizes'], edit: ['upscale', 'blend'] };
/** a tool card's picture and name */
const TOOL_CARD: Record<keyof CardTools, { picture: string; name: string }> = {
  expression: { picture: 'expression', name: 'canvas.presets.names.expression' }, sizes: { picture: 'multiSize', name: 'canvas.marketing.sizes' },
  set: { picture: 'productSet', name: 'canvas.marketing.set' }, swap: { picture: 'productSwap', name: 'canvas.presets.names.productSwap' },
  blend: { picture: 'blend', name: 'canvas.presets.names.blend' }, upscale: { picture: 'upscale', name: 'canvas.presets.names.upscale' },
};
/** the cards that ask something first: their choices open under the cards */
const ASKS_FIRST = new Set<keyof CardTools>(['expression', 'sizes', 'set']);
/** the pictures of a product set, each one of its presets */
const SET_PARTS: Array<[string, string]> = [['whiteShot', 'main'], ['productDetail', 'detail'], ['productLife', 'life'], ['adShot', 'ad'], ['productFeatures', 'features']];

/**
 * The presets as pictures of what each makes, a kind at a time; one that needs a picture is off without one. Opened
 * from a picture (`tools`), each tab also holds what that picture can be made into (expressions, other sizes, a
 * product set, a product swapped, pictures blended, upscaled); one that asks something first shows its choices under
 * the cards, not in a menu beside them.
 */
function PresetPicker({ picked, hasPicture, onPick, tools }: { picked?: string; hasPicture: boolean; onPick: (preset: CanvasPreset) => void; tools?: CardTools }) {
  const t = useT();
  const [tab, setTab] = React.useState<PresetGroup>(() => {
    const group = presetOf(picked)?.group;
    return group && PRESET_GROUPS.includes(group) ? group : PRESET_GROUPS[0]!;
  });
  const [asking, setAsking] = React.useState<keyof CardTools | null>(null);
  const cards: Card[] = [
    ...PRESETS.filter((p) => p.group === tab).map((p) => ({ id: p.id, picture: p.id, name: t(`canvas.presets.names.${p.id}`), needsPicture: p.fromPicture })),
    ...(tools ? TOOL_CARDS[tab] ?? [] : []).map((k) => ({ id: `tool:${k}`, picture: TOOL_CARD[k].picture, name: t(TOOL_CARD[k].name), needsPicture: true })),
  ];
  const pick = (id: string) => {
    if (!id.startsWith('tool:')) { onPick(presetOf(id)!); return; }
    const k = id.slice(5) as keyof CardTools;
    if (ASKS_FIRST.has(k)) setAsking(asking === k ? null : k);
    else if (k === 'swap' || k === 'blend' || k === 'upscale') tools?.[k]();
  };
  return (
    <div className={`w-[588px] p-3 ${CARD}`}>
      {/* its kinds, as one segmented row */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-0.5 rounded-[11px] bg-[var(--cv-chip)] p-[3px]">
          {PRESET_GROUPS.map((group) => (
            <button key={group} type="button" onClick={() => { setTab(group); setAsking(null); }}
              className={`h-7 rounded-[8px] px-2.5 text-[12.5px] transition ${group === tab ? 'bg-[var(--cv-modal)] text-[var(--cv-ink)] shadow-[0_1px_3px_rgba(0,0,0,0.25)]' : 'text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`}>
              {t(`canvas.presets.groups.${group}`)}
            </button>
          ))}
        </div>
        <span className="shrink-0 pr-1 text-[11.5px] tabular-nums text-[var(--cv-ink-3)]">{t('canvas.create.count').replace('{n}', String(cards.length))}</span>
      </div>
      <PictureCards cards={cards} picked={asking ? `tool:${asking}` : picked} hasPicture={hasPicture} onPick={pick} />
      {asking && tools ? <Asking which={asking} tools={tools} onBack={() => setAsking(null)} /> : null}
    </div>
  );
}

/** A tool card's choices, under the cards: the expression to make, the sizes to make it at, the pictures of a set. */
function Asking({ which, tools, onBack }: { which: keyof CardTools; tools: CardTools; onBack: () => void }) {
  const t = useT();
  const [sizes, setSizes] = React.useState<string[]>(['1:1', '3:4', '9:16', '16:9']);
  const [parts, setParts] = React.useState<string[]>(SET_PARTS.map(([id]) => id));
  const chip = (on: boolean) => `flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] transition ${on ? 'bg-[color-mix(in_srgb,var(--cv-edge-lit)_20%,transparent)] text-[var(--cv-ink)] ring-1 ring-inset ring-[var(--cv-edge-lit)]' : 'bg-[var(--cv-chip)] text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`;
  const go = 'ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-[var(--cv-invert)] px-3 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:opacity-40';
  return (
    <div className="cv-fade mt-3 rounded-[12px] bg-[color-mix(in_srgb,var(--cv-ink)_3.5%,transparent)] p-3 ring-1 ring-inset ring-[var(--cv-float-line)]">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-[13px] font-medium text-[var(--cv-ink)]">{t(TOOL_CARD[which].name)}</span>
        <span className="text-[12px] text-[var(--cv-ink-3)]">{t(`canvas.create.ask.${which}`)}</span>
        <button type="button" aria-label={t('canvas.panel.collapse')} onClick={onBack} className="ml-auto flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--cv-ink-3)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><X size={13} /></button>
      </div>
      {which === 'expression' ? (
        <div className="grid grid-cols-5 gap-1.5">
          {EXPRESSIONS.map(([key, mark, words]) => (
            <button key={key} type="button" onClick={() => tools.expression(words)} className={`${chip(false)} justify-center`}><span className="text-[15px] leading-none">{mark}</span>{t(`canvas.expressions.${key}`)}</button>
          ))}
        </div>
      ) : which === 'sizes' ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {SIZES.map(([ratio, use]) => {
            const on = sizes.includes(ratio);
            return (
              <button key={ratio} type="button" title={t(`canvas.marketing.shapes.${use}`)} onClick={() => setSizes((list) => (on ? list.filter((r) => r !== ratio) : [...list, ratio]))} className={chip(on)}>
                <RatioIcon ratio={ratio} size={14} /><span className="tabular-nums">{ratio}</span><span className="text-[11.5px] text-[var(--cv-ink-3)]">{t(`canvas.marketing.shapes.${use}`)}</span>
              </button>
            );
          })}
          <button type="button" disabled={!sizes.length} onClick={() => tools.sizes(SIZES.map(([r]) => r).filter((r) => sizes.includes(r)))} className={go}>
            <Sparkles size={14} />{t('canvas.marketing.makeSizes').replace('{n}', String(sizes.length))}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {SET_PARTS.map(([id, part]) => {
            const on = parts.includes(id);
            return <button key={id} type="button" onClick={() => setParts((list) => (on ? list.filter((x) => x !== id) : [...list, id]))} className={chip(on)}>{on ? <Check size={13} /> : null}{t(`canvas.create.set.${part}`)}</button>;
          })}
          <button type="button" disabled={!parts.length} onClick={() => tools.set(SET_PARTS.map(([id]) => id).filter((id) => parts.includes(id)))} className={go}>
            <Sparkles size={14} />{t('canvas.create.makeN').replace('{n}', String(parts.length))}
          </button>
        </div>
      )}
    </div>
  );
}

type Card = { id: string; picture: string; name: string; needsPicture?: boolean };
/** Cards: each its picture, its name under it, "needs a picture" on one made from a picture when there is none. */
function PictureCards({ cards, picked, hasPicture, onPick }: { cards: Card[]; picked?: string; hasPicture: boolean; onPick: (id: string) => void }) {
  const t = useT();
  return (
    <div className="-m-1 grid max-h-[400px] grid-cols-3 gap-x-1 gap-y-1.5 overflow-y-auto">
      {cards.map((c) => {
        const off = c.needsPicture && !hasPicture;
        return (
          <button key={c.id} type="button" disabled={off} onClick={() => onPick(c.id)} title={off ? t('canvas.presets.needsPicture') : undefined}
            className="group/preset min-w-0 rounded-[13px] p-1 text-left transition duration-150 hover:bg-[var(--cv-float-hover)] disabled:cursor-not-allowed disabled:hover:bg-transparent">
            <span className={`relative block aspect-[3/2] overflow-hidden rounded-[10px] bg-[var(--cv-chip)] transition duration-200 ${picked === c.id ? 'ring-2 ring-[var(--cv-ring)]' : 'ring-1 ring-inset ring-[var(--cv-float-line)] group-hover/preset:shadow-[0_6px_18px_rgba(0,0,0,0.28)]'}`}>
              {PRESET_PICTURES[c.picture] ? <img src={PRESET_PICTURES[c.picture]} alt="" draggable={false} loading="lazy"
                className={`h-full w-full object-cover transition duration-500 ease-out ${off ? 'opacity-40 grayscale' : 'group-hover/preset:scale-[1.05]'}`} /> : null}
              {/* a soft shade at its foot, lighter on the one pointed at */}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/25 to-transparent opacity-60 transition group-hover/preset:opacity-0" />
              {off ? (
                <span className="absolute left-1.5 top-1.5 flex h-5 items-center gap-1 rounded-[6px] bg-black/60 px-1.5 text-[10.5px] text-white backdrop-blur-sm">
                  <ImageIcon size={11} />{t('canvas.presets.fromPicture')}
                </span>
              ) : null}
            </span>
            <span className={`mt-1.5 block truncate px-1 text-[12.5px] ${off ? 'text-[var(--cv-ink-3)]' : 'text-[var(--cv-ink)]'}`}>{c.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** what makes a picture move, in words for a clip model: its layout and words kept still */
const MOTION_WORDS = 'Bring this picture to life with subtle, elegant motion: gentle movement in the background, light and particles drifting, a slow camera push-in; keep the layout, every word and the product perfectly still, sharp and legible.';
/** the expressions offered: each its mark and its words for the model */
const EXPRESSIONS: Array<[string, string, string]> = [
  ['smile', '🙂', 'a gentle, natural smile'], ['laugh', '😄', 'a big, open laugh'], ['surprised', '😮', 'surprised: eyebrows raised, mouth slightly open'],
  ['sad', '😢', 'sad: eyes and the corners of the mouth turned down'], ['angry', '😠', 'angry: brows drawn together, a hard look'],
  ['shy', '☺️', 'shy: a small smile, a slight blush, eyes looking down'], ['wink', '😉', 'a playful wink with one eye'],
  ['eyesClosed', '😌', 'calm, both eyes gently closed'], ['thinking', '🤔', 'thoughtful: a slight frown, looking off to the side'], ['confident', '😎', 'cool and confident: a slight smirk'],
];
/** the shapes a picture is made again at, each with where it is used */
const SIZES: Array<[string, string]> = [['1:1', 'square'], ['3:4', 'portrait'], ['9:16', 'story'], ['16:9', 'wide'], ['4:3', 'landscape'], ['2:3', 'poster'], ['21:9', 'banner']];

type MenuItem = { key: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string; about: string; run?: () => void; more?: React.ReactNode };
/** a menu's own color: its marks tinted with it, so each menu reads as its own kind of work */
const MENU_TONES = { blue: '#5b8cff', violet: '#a07bff', amber: '#f3a43b', green: '#34c48b' } as const;
type Tone = keyof typeof MENU_TONES;
/** a mark on a soft square of its menu's color */
function ToneMark({ icon: Icon, tone, size = 34 }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; tone: Tone; size?: number }) {
  const c = MENU_TONES[tone];
  return (
    <span className="flex shrink-0 items-center justify-center rounded-[10px]"
      style={{ width: size, height: size, color: `color-mix(in srgb, ${c} 75%, var(--cv-ink))`, background: `linear-gradient(140deg, color-mix(in srgb, ${c} 26%, transparent), color-mix(in srgb, ${c} 8%, transparent))`, boxShadow: `inset 0 0 0 0.5px color-mix(in srgb, ${c} 35%, transparent)` }}>
      <Icon size={Math.round(size * 0.48)} strokeWidth={1.8} />
    </span>
  );
}
/**
 * A menu of a picture's bar: its name and what its tools have in common at the top, then its tools as tiles two by
 * two, each its mark on its menu's color, its name and what it does; one that asks something first opens its choices
 * in place, under the tiles (never a menu beside the menu).
 */
function ToolMenu({ label, caption, tone, icon: Icon, open, onOpen, items }: {
  label: string; caption: string; tone: Tone; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; open: boolean; onOpen: (open: boolean) => void;
  items: MenuItem[];
}) {
  const btn = 'cv-tool nodrag flex h-9 items-center gap-2 rounded-[8px] px-2.5 text-[14px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';
  if (!items.length) return null;
  return (
    <Popover open={open} onOpenChange={onOpen} placement="bottom" align="start"
      trigger={<button type="button" className={`${btn} ${open ? 'bg-[var(--cv-float-hover)]' : ''}`} onClick={() => onOpen(!open)}><Icon size={16} />{label}<ChevronDown size={13} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} /></button>}>
      <div className={`w-[372px] p-2 ${CARD}`}><ToolTiles label={label} caption={caption} tone={tone} icon={Icon} items={items} open={open} onDone={() => onOpen(false)} /></div>
    </Popover>
  );
}

/** A tool menu's own: its mark, name and caption, its tools as tiles (one that asks first opening under them). */
function ToolTiles({ label, caption, tone, icon: Icon, items, open = true, onDone }: {
  label: string; caption: string; tone: Tone; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; items: MenuItem[]; open?: boolean; onDone: () => void;
}) {
  const [more, setMore] = React.useState<string | null>(null);
  React.useEffect(() => { if (!open) setMore(null); }, [open]);
  const opened = items.find((item) => item.key === more);
  return (
    <>
      <div className="flex items-center gap-2.5 px-2 pb-2.5 pt-1.5">
        <ToneMark icon={Icon} tone={tone} size={28} />
        <span className="min-w-0">
          <span className="block text-[13.5px] font-semibold leading-5 text-[var(--cv-ink)]">{label}</span>
          <span className="block truncate text-[11.5px] leading-4 text-[var(--cv-ink-3)]">{caption}</span>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {items.map((item) => {
          const on = more === item.key;
          return (
            <button key={item.key} type="button" onClick={() => { if (item.more) setMore(on ? null : item.key); else { onDone(); item.run?.(); } }}
              className={`group/tool flex min-w-0 flex-col items-start gap-2 rounded-[12px] p-2.5 text-left transition duration-150 ${on ? 'bg-[var(--cv-float-hover)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--cv-ink)_22%,transparent)]' : 'bg-[color-mix(in_srgb,var(--cv-ink)_3.5%,transparent)] hover:bg-[var(--cv-float-hover)]'}`}>
              <span className="flex w-full items-center justify-between">
                <ToneMark icon={item.icon} tone={tone} size={30} />
                {item.more ? <ChevronDown size={14} className={`text-[var(--cv-ink-3)] transition-transform duration-200 ${on ? 'rotate-180' : ''}`} />
                  : <ArrowUpRight size={14} className="text-[var(--cv-ink-3)] opacity-0 transition duration-150 group-hover/tool:translate-x-0.5 group-hover/tool:-translate-y-0.5 group-hover/tool:opacity-100" />}
              </span>
              <span className="w-full min-w-0">
                <span className="block truncate text-[13px] font-medium leading-5 text-[var(--cv-ink)]">{item.label}</span>
                <span className="line-clamp-2 block text-[11.5px] leading-[15px] text-[var(--cv-ink-3)]">{item.about}</span>
              </span>
            </button>
          );
        })}
      </div>
      {/* what a tile that asks first asks, under the tiles */}
      <div className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none ${opened ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="min-h-0 overflow-hidden">{opened?.more ? <div className="mt-2 rounded-[12px] bg-[color-mix(in_srgb,var(--cv-ink)_3.5%,transparent)] p-3">{opened.more}</div> : null}</div>
      </div>
    </>
  );
}

/** each clip tool done by a model, as a mark */
const CLIP_ICONS: Record<ClipToolKey, React.ComponentType<{ size?: number; strokeWidth?: number }>> = { edit: Wand2, extend: ChevronsRight, motion: PersonStanding, restyle: Brush, recast: UserRound, lipsync: Mic };

/* ── a card's toolbar as the person lays it out ── */

/** a tool on a card's bar: run at once, a menu of tools, or a picker */
type BarTool = { key: string; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; run?: () => void;
  menu?: { caption: string; tone: Tone; items: MenuItem[] }; picker?: React.ReactNode };
type BarKind = 'image' | 'video';
/** what each bar shows out of the box, in order; the rest are under More */
const BAR_DEFAULT: Record<BarKind, string[]> = {
  image: ['redraw', 'expand', 'cutout', 'light', 'create', 'edit', 'video', 'agent', 'addToFilm'],
  video: ['edit', 'extend', 'motion', 'frames', 'trim', 'audio', 'shots', 'agent', 'addToFilm'],
};
const BAR_KEY = 'openfilm.canvas.toolbar';
const barListeners = new Set<() => void>();
function readBars(): Partial<Record<BarKind, string[]>> {
  try { const kept = JSON.parse(localStorage.getItem(BAR_KEY) ?? '{}') as Partial<Record<BarKind, unknown>>; return Object.fromEntries(Object.entries(kept).filter(([, v]) => Array.isArray(v))) as Partial<Record<BarKind, string[]>>; } catch { return {}; }
}
/** the tools on a bar, in order: the person's, else the default */
function barLayout(kind: BarKind): string[] { return readBars()[kind] ?? BAR_DEFAULT[kind]; }
function keepBar(kind: BarKind, keys: string[] | null) {
  const bars = readBars();
  if (keys) bars[kind] = keys; else delete bars[kind];
  try { localStorage.setItem(BAR_KEY, JSON.stringify(bars)); } catch { /* not kept */ }
  for (const listen of barListeners) listen();
}
function useBars() {
  const [, setTick] = React.useState(0);
  React.useEffect(() => { const listen = () => setTick((n) => n + 1); barListeners.add(listen); return () => { barListeners.delete(listen); }; }, []);
}

/** the tools not on the bar: a list, a menu's or picker's own opened in its place */
function MoreTools({ tools, open, onOpen }: { tools: BarTool[]; open: boolean; onOpen: (open: boolean) => void }) {
  const t = useT();
  const [inside, setInside] = React.useState<string | null>(null);
  React.useEffect(() => { if (!open) setInside(null); }, [open]);
  const opened = tools.find((x) => x.key === inside);
  const btn = 'cv-tool nodrag flex h-9 items-center gap-1.5 rounded-[8px] px-2.5 text-[14px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]';
  return (
    <Popover open={open} onOpenChange={onOpen} placement="bottom" align="end"
      trigger={<button type="button" className={`${btn} ${open ? 'bg-[var(--cv-float-hover)]' : ''}`} onClick={() => onOpen(!open)}>{t('canvas.bar.more')}<ChevronDown size={13} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} /></button>}>
      {opened?.picker ? opened.picker : (
        <div className={`${opened?.menu ? 'w-[372px]' : 'w-[220px]'} p-1.5 ${CARD}`}>
          {opened?.menu ? (
            <>
              <button type="button" onClick={() => setInside(null)} className="mb-1 flex h-7 items-center gap-1 rounded-[7px] px-1.5 text-[12px] text-[var(--cv-ink-3)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><ChevronLeft size={13} />{t('canvas.bar.more')}</button>
              <ToolTiles label={opened.label} caption={opened.menu.caption} tone={opened.menu.tone} icon={opened.icon} items={opened.menu.items} onDone={() => onOpen(false)} />
            </>
          ) : tools.map((x) => (
            <button key={x.key} type="button" onClick={() => { if (x.menu || x.picker) setInside(x.key); else { onOpen(false); x.run?.(); } }}
              className="flex h-9 w-full items-center gap-2.5 rounded-[9px] px-2.5 text-left text-[13.5px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
              {React.createElement(x.icon, { size: 16 })}<span className="min-w-0 flex-1 truncate">{x.label}</span>
              {x.menu || x.picker ? <ChevronRight size={14} className="text-[var(--cv-ink-3)]" /> : null}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}

/**
 * The bar laid out by the person: the tools on it in their order (dragged; × takes one off), the rest below (+ puts one
 * on); kept for every card of the kind, back to the default with a press.
 */
function BarSettings({ kind, tools, onClose }: { kind: BarKind; tools: BarTool[]; onClose: () => void }) {
  const t = useT();
  const known = (keys: string[]) => keys.filter((k) => tools.some((x) => x.key === k));
  const [on, setOn] = React.useState(() => known(barLayout(kind)));
  const [dragged, setDragged] = React.useState<string | null>(null);
  const off = tools.filter((x) => !on.includes(x.key));
  const of = (key: string) => tools.find((x) => x.key === key)!;
  const chip = 'flex h-10 shrink-0 items-center gap-2 rounded-[10px] px-3 text-[13.5px] text-[var(--cv-ink)]';
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  return createPortal(
    <div className="cv-fade nodrag nopan nowheel fixed inset-0 z-[2000] flex items-center justify-center bg-black/70 p-6" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={t('canvas.bar.customize')}
        className="cv-grow relative w-[min(760px,100%)] rounded-[22px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-modal)] p-6 text-[var(--cv-ink)] shadow-[var(--cv-float-shadow)]">
        <button type="button" aria-label={t('canvas.outline.close')} onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><X size={16} /></button>
        <h2 className="text-[17px] font-semibold">{t('canvas.bar.customize')} · {t(`canvas.bar.kinds.${kind}`)}</h2>
        <p className="mt-1.5 text-[13px] text-[var(--cv-ink-3)]">{t('canvas.bar.customizeAbout')}</p>
        {/* the bar as it will be, on a backdrop like the board's */}
        <div className="mt-5 rounded-[16px] bg-[radial-gradient(circle,color-mix(in_srgb,var(--cv-ink)_14%,transparent)_1px,transparent_1.5px)] bg-[length:16px_16px] p-6">
          <div className="flex min-h-[56px] flex-wrap items-center gap-1 rounded-[14px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]"
            onDragOver={(event) => event.preventDefault()}>
            {on.map((key) => {
              const x = of(key);
              return (
                <div key={key} draggable onDragStart={() => setDragged(key)} onDragEnd={() => setDragged(null)}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (!dragged || dragged === key) return;
                    setOn((list) => { const rest = list.filter((k) => k !== dragged); rest.splice(rest.indexOf(key), 0, dragged); return rest; });
                  }}
                  className={`group/chip ${chip} cursor-grab bg-[color-mix(in_srgb,var(--cv-ink)_5%,transparent)] transition hover:bg-[var(--cv-float-hover)] ${dragged === key ? 'opacity-40' : ''}`}>
                  <GripVertical size={13} className="-ml-1 text-[var(--cv-ink-3)]" />
                  {React.createElement(x.icon, { size: 15 })}{x.label}
                  <button type="button" aria-label={t('canvas.bar.takeOff')} onClick={() => setOn((list) => list.filter((k) => k !== key))}
                    className="-mr-1 flex h-5 w-5 items-center justify-center rounded-full text-[var(--cv-ink-3)] opacity-0 transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)] group-hover/chip:opacity-100"><X size={12} /></button>
                </div>
              );
            })}
            {!on.length ? <span className="px-3 text-[12.5px] text-[var(--cv-ink-3)]">{t('canvas.bar.empty')}</span> : null}
          </div>
        </div>
        <div className="mt-5 text-[12px] text-[var(--cv-ink-3)]">{t('canvas.bar.inMore')}</div>
        <div className="mt-2 flex min-h-[44px] flex-wrap gap-1.5">
          {off.map((x) => (
            <button key={x.key} type="button" onClick={() => setOn((list) => [...list, x.key])}
              className={`${chip} border border-dashed !border-[var(--cv-float-line)] text-[var(--cv-ink-2)] transition hover:!border-[var(--cv-ink-3)] hover:text-[var(--cv-ink)]`}>
              <Plus size={14} />{React.createElement(x.icon, { size: 15 })}{x.label}
            </button>
          ))}
          {!off.length ? <span className="py-3 text-[12.5px] text-[var(--cv-ink-3)]">{t('canvas.bar.allOn')}</span> : null}
        </div>
        <div className="mt-6 flex items-center gap-2">
          <button type="button" onClick={() => setOn(known(BAR_DEFAULT[kind]))}
            className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><RotateCcw size={14} />{t('canvas.bar.restore')}</button>
          <span className="flex-1" />
          <button type="button" onClick={onClose} className="h-9 rounded-full bg-[var(--cv-chip)] px-4 text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">{t('canvas.bar.cancel')}</button>
          <button type="button" onClick={() => { keepBar(kind, on); onClose(); }}
            className="h-9 rounded-full bg-[var(--cv-invert)] px-5 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90">{t('canvas.bar.save')}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** a grid's look, `cols` × `rows` small squares */
function GridGlyph({ rows, cols, size = 22 }: { rows: number; cols: number; size?: number }) {
  const gap = 1.5;
  const w = (size - gap * (cols - 1)) / cols; const h = (size - gap * (rows - 1)) / rows;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      {Array.from({ length: rows * cols }, (_, i) => (
        <rect key={i} x={(i % cols) * (w + gap)} y={Math.floor(i / cols) * (h + gap)} width={w} height={h} rx={1.2} fill="currentColor" opacity={0.85} />
      ))}
    </svg>
  );
}

/**
 * A grid to cut a picture into: found from its gutters, one of the usual ones, or any up to 8×8 (columns × rows)
 * marked by pointing.
 */
function GridPicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const t = useT();
  const [over, setOver] = React.useState<{ r: number; c: number } | null>(null);
  const tile = 'flex flex-col items-center justify-center gap-1.5 rounded-[10px] bg-[var(--cv-chip)] text-[12px] tabular-nums text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]';
  return (
    <div>
      <button type="button" onClick={() => onPick(0, 0)}
        className="flex w-full items-center gap-2.5 rounded-[10px] bg-[linear-gradient(120deg,color-mix(in_srgb,#5b8cff_20%,transparent),color-mix(in_srgb,#5b8cff_6%,transparent))] px-3 py-2.5 text-left transition hover:brightness-110">
        <Sparkles size={15} className="shrink-0 text-[color-mix(in_srgb,#5b8cff_75%,var(--cv-ink))]" />
        <span className="min-w-0">
          <span className="block text-[13px] font-medium text-[var(--cv-ink)]">{t('canvas.actions.splitAuto')}</span>
          <span className="block truncate text-[11.5px] text-[var(--cv-ink-3)]">{t('canvas.actions.splitAutoAbout')}</span>
        </span>
      </button>
      <div className="mt-2 grid grid-cols-4 gap-1.5">
        {[2, 3, 4, 5].map((n) => (
          <button key={n} type="button" onClick={() => onPick(n, n)} className={`h-[62px] ${tile}`}><GridGlyph rows={n} cols={n} />{n} × {n}</button>
        ))}
      </div>
      <div className="mb-2 mt-3 flex items-center justify-between px-0.5 text-[11.5px] text-[var(--cv-ink-3)]">
        <span>{t('canvas.actions.splitCustom')}</span>
        <span className="tabular-nums text-[var(--cv-ink)]">{over ? `${over.c} × ${over.r} · ${t('canvas.actions.splitPieces').replace('{n}', String(over.r * over.c))}` : ''}</span>
      </div>
      <div className="flex justify-center" onMouseLeave={() => setOver(null)}>
        <div className="grid w-max grid-cols-8 gap-[3px] rounded-[10px] bg-[var(--cv-chip)] p-[6px]">
          {Array.from({ length: 64 }, (_, i) => {
            const r = Math.floor(i / 8) + 1;
            const c = (i % 8) + 1;
            const lit = over && r <= over.r && c <= over.c;
            return (
              <button key={i} type="button" aria-label={`${c}×${r}`} onMouseEnter={() => setOver({ r, c })} onFocus={() => setOver({ r, c })} onClick={() => onPick(r, c)}
                className={`h-[22px] w-[22px] rounded-[5px] transition-colors duration-75 ${lit ? 'bg-[color-mix(in_srgb,#5b8cff_70%,transparent)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,#5b8cff_90%,white)]' : 'bg-[color-mix(in_srgb,var(--cv-ink)_7%,transparent)] hover:bg-[color-mix(in_srgb,var(--cv-ink)_14%,transparent)]'}`} />
            );
          })}
        </div>
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
  const area = React.useRef<HTMLTextAreaElement>(null);
  const [mention, setMention] = React.useState<{ at: number; query: string; index: number; view?: 'subjects' | 'pictures' } | null>(null);
  /* an input being dragged to another place among them */
  const [dragging, setDragging] = React.useState<string | null>(null);
  const subjectList = useSubjects();
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
  /* the ways shown: what the model makes, its references once (everything it takes, when it takes more than pictures) */
  const references = modes.includes('omni') ? 'omni' : modes.includes('refs') ? 'refs' : null;
  /* words alone is a way of its own only for a model that takes nothing else: with references, it is references with none */
  const ways = (['text', 'first', 'firstLast', 'omni', 'refs'] as const).filter((m) => modes.includes(m) && !(m === 'refs' && references === 'omni') && !(m === 'text' && references));
  const shownMode = mode === 'text' && references ? references : mode;
  const takes = ([
    ['image', model?.refs], ['video', modes.includes('omni') ? model?.clip : 0], ['audio', modes.includes('omni') ? model?.voice : 0],
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
  /* the tools over the composer, by kind: a picture takes a camera, a style, a preset; a clip a style and a camera move */
  const [showTools, setShowTools] = React.useState(toolsShown);
  const toggleTools = (on: boolean) => { toolsShown = on; setShowTools(on); if (!on && open === 'presets') setOpen(null); };
  /* the camera first (a subject is named with @ in the words) */
  /* what is picked with each tool: its name, a picture of it, how it is taken off */
  const camera = data.opts?.camera ? cameraOf(data.opts.camera) : null;
  const picks: Partial<Record<keyof typeof TONES, { value: string; preview?: React.ReactNode; clear: () => void }>> = {
    ...(camera && picksAnything(camera) ? { camera: {
      value: ([['body', camera.body], ['lens', camera.lens], ['focal', camera.focal], ['aperture', camera.aperture]] as const).filter(([, v]) => v !== 'auto')
        .map(([k, v]) => (k === 'focal' ? `${v}mm` : t(`canvas.camera.${GROUP[k]}.${v}`))).join(', '),
      preview: <img src={cameraLook(camera)} alt="" className="block aspect-[16/9] w-full object-cover" />,
      clear: () => setOpts({ camera: undefined }),
    } } : {}),
    ...(data.opts?.style ? { styles: { value: t(`canvas.styles.names.${data.opts.style}`), preview: stylePicture(data.opts.style) ? <img src={stylePicture(data.opts.style)} alt="" className="block aspect-[4/5] w-full object-cover" /> : undefined, clear: () => setOpts({ style: undefined }) } } : {}),
    ...(data.opts?.effect ? { effects: { value: t(`canvas.effects.names.${data.opts.effect}`), preview: <span className="block aspect-[4/5] w-full"><MoveClip id={data.opts.effect} playing /></span>, clear: () => setOpts({ effect: undefined }) } } : {}),
    ...(preset ? { presets: { value: t(`canvas.presets.names.${preset.id}`), preview: PRESET_PICTURES[preset.id] ? <img src={PRESET_PICTURES[preset.id]} alt="" className="block aspect-[3/2] w-full object-cover" /> : undefined, clear: () => set({ preset: undefined }) } } : {}),
  };
  const tools: Array<{ key: keyof typeof TONES; label: string; icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; pick?: () => void }> = data.make === 'image' ? [
    { key: 'camera', label: t('canvas.camera.title'), icon: Camera, pick: () => board.openCamera(id) },
    { key: 'styles', label: t('canvas.library.styleChip'), icon: Palette, pick: () => board.openLibrary('styles', id) },
    { key: 'presets', label: t('canvas.presets.title'), icon: LayoutDashboard },
  ] : data.make === 'video' ? [
    { key: 'styles', label: t('canvas.library.styleChip'), icon: Palette, pick: () => board.openLibrary('styles', id) },
    { key: 'effects', label: t('canvas.library.effectChip'), icon: Clapperboard, pick: () => board.openLibrary('effects', id) },
  ] : [];
  const addMenu = (
    <div className={`w-[176px] p-1 ${CARD}`}>
      <button type="button" className={`${PICK} w-full`} onClick={() => { setOpen(null); board.upload(id, 'input'); }}><Plus size={15} />{t('canvas.panel.upload')}</button>
      <button type="button" className={`${PICK} w-full`} onClick={() => { setOpen(null); board.pick(id); }}><LayoutGrid size={15} />{t('canvas.panel.fromBoard')}</button>
      <button type="button" className={`${PICK} w-full`} onClick={() => setOpen('assets')}><Images size={15} />{t('canvas.panel.fromAssets')}</button>
    </div>
  );
  const presetMenu = <PresetPicker picked={preset?.id} hasPicture={hasPicture} onPick={usePreset} />;
  /* @ a subject: the list opens on an @ typed at a word's start, narrowed by what follows it */
  const takesSubjects = data.make === 'image' || data.make === 'video';
  const q = mention?.query.toLowerCase() ?? '';
  const matches = (subjectList ?? []).filter((c) => !q || `${c.name} ${c.about ?? ''}`.toLowerCase().includes(q)).slice(0, 8);
  const findMention = (box: HTMLTextAreaElement) => {
    const before = box.value.slice(0, box.selectionStart ?? box.value.length);
    const found = /(^|\s)@([^\s@]{0,24})$/.exec(before);
    setMention(found ? { at: before.length - found[2]!.length - 1, query: found[2]!, index: 0, ...(mention?.view ? { view: mention.view } : {}) } : null);
  };
  /* a name put in for the @ being typed */
  const putName = (name: string) => {
    const box = area.current;
    if (!box || !mention) return;
    const end = mention.at + 1 + mention.query.length;
    prompt.set(`${box.value.slice(0, mention.at)}@${name} ${box.value.slice(end)}`);
    const caret = mention.at + name.length + 2;
    setMention(null);
    requestAnimationFrame(() => { box.focus(); box.setSelectionRange(caret, caret); });
  };
  const pickSubject = (c: CanvasCharacter) => { putName(c.name); board.useSubject(id, c); };
  /* what @ offers: what is in it already (a picture, a clip, a sound wired in), then more to bring: a subject, a picture */
  type Offer = { key: string; label: string; thumb?: string; icon?: React.ReactNode; note?: string; more?: boolean; run: () => void };
  const offers: Offer[] = mention?.view === 'subjects'
    ? matches.map((c) => ({ key: c.id, label: c.name, thumb: coverOf(c) ?? undefined, note: t(`canvas.subjects.kinds.${c.kind}`), run: () => pickSubject(c) }))
    : mention?.view === 'pictures'
      ? assetRows.filter((r) => !q || r.label.toLowerCase().includes(q)).slice(0, 30).map((r) => ({ key: r.key, label: r.label, icon: r.icon, run: () => {
        board.wireIn(id, { path: r.value });
        putName(r.label.replace(/\.[^.]+$/, ''));
      } }))
      : [
        ...inputs.filter((i) => i.path).map((i) => ({ key: i.edge, name: board.nameOf(i.from), file: board.fileOf(i.path!) }))
          .filter((x) => x.name && (!q || x.name.toLowerCase().includes(q)))
          .map((x) => ({ key: x.key, label: x.name, thumb: thumb(x.file), run: () => putName(x.name) })),
        { key: '+subjects', label: t('canvas.subjects.title'), icon: <UserRound size={16} />, more: true, run: () => setMention(mention ? { ...mention, view: 'subjects', index: 0 } : null) },
        { key: '+pictures', label: t('canvas.panel.mentionPictures'), icon: <ImageIcon size={16} />, more: true, run: () => setMention(mention ? { ...mention, view: 'pictures', index: 0 } : null) },
      ];
  /* an input dropped on another: put before it, the order of what goes in as the references are numbered */
  const dropOn = (target: string) => {
    if (!dragging || dragging === target) return;
    const order = inputs.map((i) => i.edge).filter((e) => e !== dragging);
    order.splice(order.indexOf(target), 0, dragging);
    board.reorderInputs(id, order);
    setDragging(null);
  };
  const dragProps = (edge: string) => ({
    draggable: true,
    onDragStart: (event: React.DragEvent) => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/x-openfilm-input', edge); setDragging(edge); },
    onDragOver: (event: React.DragEvent) => { if (dragging) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } },
    onDrop: (event: React.DragEvent) => { event.preventDefault(); dropOn(edge); },
    onDragEnd: () => setDragging(null),
    className: `nodrag transition ${dragging === edge ? 'opacity-40' : ''}`,
  });
  /* the @ button: an @ put where the caret is, the list opened */
  const startMention = () => {
    const box = area.current;
    if (!box) return;
    const at = box.selectionStart ?? box.value.length;
    const gap = at > 0 && !/\s/.test(box.value[at - 1]!) ? ' ' : '';
    prompt.set(`${box.value.slice(0, at)}${gap}@${box.value.slice(at)}`);
    setMention({ at: at + gap.length, query: '', index: 0 });
    requestAnimationFrame(() => { box.focus(); box.setSelectionRange(at + gap.length + 1, at + gap.length + 1); });
  };
  return (
    <Composer id={id} shown={shown} expanded={expanded} setExpanded={setExpanded}
      corner={tools.length ? (
        <Tooltip label={t('canvas.panel.tools.title')}>
          <button type="button" aria-label={t('canvas.panel.tools.title')} aria-pressed={showTools} onClick={() => toggleTools(!showTools)}
            className={`${CORNER} ${showTools ? 'bg-[var(--cv-float-hover)] !text-[var(--cv-ink)]' : ''}`}><Shapes size={16} /></button>
        </Tooltip>
      ) : null}
      aboveOpen={showTools && tools.length > 0}
      above={tools.length ? (
        /* the tools: a character, a style or an effect from the libraries, a preset */
        <div className="flex items-center gap-2">
          {tools.map((tool) => (
            <div key={tool.key} className="min-w-0 flex-1">
              {tool.key === 'presets' ? (
                <Popover open={open === 'presets'} onOpenChange={(v) => setOpen(v ? 'presets' : null)} placement="top" align="center" block
                  trigger={<ToolTile label={tool.label} tone={TONES.presets} icon={LayoutDashboard} picture={TOOL_PICTURES.preset} on={open === 'presets'}
                    value={picks.presets?.value} preview={picks.presets?.preview} onClear={picks.presets?.clear} onClick={() => setOpen(open === 'presets' ? null : 'presets')} />}>
                  {presetMenu}
                </Popover>
              ) : <ToolTile label={tool.label} tone={TONES[tool.key]} icon={tool.icon} picture={TOOL_PICTURES[{ camera: 'camera', styles: 'style', effects: 'effects', characters: '', presets: 'preset' }[tool.key]]}
                value={picks[tool.key]?.value} preview={picks[tool.key]?.preview} onClear={picks[tool.key]?.clear} onClick={tool.pick} />}
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
                <span key={input.edge} {...dragProps(input.edge)}><Tile label={`${t(`canvas.slots.${slot.label}`)} · ${file?.name ?? input.path ?? ''}`} onOpen={input.path ? () => board.view(input.path!) : undefined}
                  onRemove={() => board.unwire(input.edge)} removeLabel={t('canvas.removeWire')}>
                  {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center bg-[var(--cv-chip)] text-[var(--cv-label)]"><Images size={17} /></span>}
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-px text-center text-[10px] font-medium text-white">{t(`canvas.slots.${slot.label}`)}</span>
                </Tile></span>
              ) : (
                <Popover key={`slot-${i}`} open={open === `slot-${i}`} onOpenChange={(v) => setOpen(v ? `slot-${i}` : null)} placement="top"
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
              const file = input.path ? board.fileOf(input.path) : null;
              const src = thumb(file);
              const name = input.text != null ? (input.text || t('canvas.kinds.note')).slice(0, 80) : file?.name ?? input.path ?? '';
              return (
                <span key={input.edge} {...dragProps(input.edge)}><Tile label={input.text != null ? `${t('canvas.write.locate')} · ${name}` : `${t('canvas.write.preview')} · ${name}`}
                  onOpen={input.text != null ? (board.locate ? () => board.locate?.(input.from) : undefined) : input.path ? () => board.view(input.path!) : undefined}
                  onRemove={() => board.unwire(input.edge)} removeLabel={t('canvas.removeWire')}>
                  {src ? <img src={src} alt="" className="h-full w-full object-cover" />
                    : <span className="flex h-full w-full items-center justify-center bg-[var(--cv-chip)] text-[var(--cv-ink)]">
                      {input.text != null ? <TypeIcon size={20} strokeWidth={1.75} /> : file?.kind === 'audio' ? <Music size={18} /> : <Video size={18} />}
                    </span>}
                </Tile></span>
              );
            })}
            {/* + : a picture from the computer, a node on the board, one from the Assets */}
            <Popover open={open === 'add' || open === 'assets'} onOpenChange={(v) => setOpen(v ? 'add' : null)} placement="top"
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
        <div className="relative">
          <textarea
            {...prompt.props}
            ref={area}
            rows={expanded ? 14 : 3}
            onFocus={board.willChange}
            onChange={(event) => { prompt.props.onChange(event); findMention(event.currentTarget); }}
            onClick={(event) => findMention(event.currentTarget)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              /* the @ list open: its keys */
              if (mention && takesSubjects) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  const n = offers.length || 1;
                  setMention({ ...mention, index: (mention.index + (event.key === 'ArrowDown' ? 1 : n - 1)) % n });
                  return;
                }
                if ((event.key === 'Enter' || event.key === 'Tab') && offers[mention.index]) { event.preventDefault(); offers[mention.index]!.run(); return; }
                if (event.key === 'Escape') { event.preventDefault(); if (mention.view) setMention({ ...mention, view: undefined, index: 0 }); else setMention(null); return; }
                if (event.key === 'ArrowLeft' && mention.view && !mention.query) { event.preventDefault(); setMention({ ...mention, view: undefined, index: 0 }); return; }
              }
              if (event.key === 'Escape') event.currentTarget.blur();
              else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); board.make(id); }
            }}
            onBlur={() => window.setTimeout(() => setMention(null), 150)}
            placeholder={preset ? t('canvas.presets.hint') : t(`canvas.panel.placeholder.${data.make}`)}
            className={PROMPT}
          />
          {mention && takesSubjects ? (
            /* what @ names: what is in it already, then a subject or a picture to bring in */
            <div className={`absolute bottom-full left-0 z-30 mb-1 w-[320px] p-1.5 ${CARD}`} onMouseDown={(event) => event.preventDefault()}>
              <div className="flex h-7 items-center gap-1 px-2 text-[12px] text-[var(--cv-ink-3)]">
                {mention.view ? (
                  <button type="button" onClick={() => setMention({ ...mention, view: undefined, index: 0 })} className="-ml-1 flex h-6 w-6 items-center justify-center rounded-[6px] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><ChevronLeft size={14} /></button>
                ) : null}
                {mention.view === 'subjects' ? t('canvas.subjects.title') : mention.view === 'pictures' ? t('canvas.panel.mentionPictures') : t('canvas.panel.mentionTitle')}
              </div>
              <div className="max-h-[300px] overflow-y-auto">
                {offers.map((o, i) => (
                  <React.Fragment key={o.key}>
                    {!mention.view && o.key === '+subjects' ? (
                      <>{i > 0 ? <div className="mx-2 my-1 h-px bg-[var(--cv-float-line)]" /> : null}<div className="flex h-7 items-center px-2 text-[12px] text-[var(--cv-ink-3)]">{t('canvas.panel.mentionAdd')}</div></>
                    ) : null}
                    <button type="button" onMouseEnter={() => setMention({ ...mention, index: i })} onClick={o.run}
                      className={`flex h-11 w-full items-center gap-2.5 rounded-[10px] px-2 text-left text-[13.5px] text-[var(--cv-ink)] ${i === mention.index ? 'bg-[var(--cv-float-hover)]' : ''}`}>
                      {o.thumb ? <span className="h-8 w-8 shrink-0 overflow-hidden rounded-[8px] bg-[var(--cv-chip)]"><img src={o.thumb} alt="" className="h-full w-full object-cover" /></span>
                        : <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[8px] text-[var(--cv-ink-2)]">{o.icon}</span>}
                      <span className="min-w-0 flex-1 truncate">{o.label}</span>
                      {o.note ? <span className="shrink-0 text-[11.5px] text-[var(--cv-ink-3)]">{o.note}</span> : null}
                      {o.more ? <ChevronRight size={15} className="shrink-0 text-[var(--cv-ink-3)]" /> : null}
                    </button>
                  </React.Fragment>
                ))}
                {!offers.length ? <div className="px-2 py-2 text-[12.5px] leading-snug text-[var(--cv-ink-3)]">{t(mention.view === 'subjects' ? (subjectList?.length ? 'canvas.subjects.noMatch' : 'canvas.subjects.empty') : 'canvas.panel.nothingInAssets')}</div> : null}
              </div>
              {mention.view === 'subjects' ? (
                <>
                  <div className="my-1 h-px bg-[var(--cv-float-line)]" />
                  <button type="button" onClick={() => { setMention(null); board.openLibrary('characters', id); }}
                    className="flex h-8 w-full items-center gap-2 rounded-[8px] px-2 text-[13px] text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><Plus size={14} />{t('canvas.subjects.manage')}</button>
                </>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className={COMPOSER_FOOTER}>
          {every.length ? (
            <Popover open={open === 'model'} onOpenChange={(v) => setOpen(v ? 'model' : null)} placement="top"
              trigger={(
                <button type="button" className={`${PICK} ${choices.length ? '' : 'text-amber-500 hover:text-amber-400'}`} onClick={() => setOpen(open === 'model' ? null : 'model')}>
                  {picked ?? fallback ? <ProviderMark id={(picked ?? fallback)!.via} size={16} /> : <Sparkles size={15} />}
                  <span className="max-w-[200px] truncate">{(picked ?? fallback)?.name ?? t('canvas.panel.connect')}</span><ChevronDown size={14} className="shrink-0 text-[var(--cv-ink-2)]" />
                </button>
              )}>
              <ModelPicker choices={every} picked={picked} fallback={fallback}
                onPick={(choice) => { keepLastModel(choice?.kind ?? data.make, choice); set({ via: choice?.via, model: choice?.model, ...(choice?.kind && choice.kind !== data.make ? { make: choice.kind } : {}) }); setOpen(null); }}
                onConnect={() => { setOpen(null); board.openSettings(); }} />
            </Popover>
          ) : (
            <Tooltip label={t('canvas.make.noService')}>
              <button type="button" onClick={board.openSettings} className={`${PICK} whitespace-nowrap text-amber-500 hover:text-amber-400`}>{t('canvas.panel.connect')}</button>
            </Tooltip>
          )}
          {data.make === 'tts' && every.length ? (
            <Popover open={open === 'voice'} onOpenChange={(v) => setOpen(v ? 'voice' : null)} placement="top"
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
          {mode && ways.length > 1 ? (
            <Popover open={open === 'mode'} onOpenChange={(v) => setOpen(v ? 'mode' : null)} placement="top"
              trigger={(
                <button type="button" className={PICK} onClick={() => setOpen(open === 'mode' ? null : 'mode')}>
                  {React.createElement(MODE_ICONS[shownMode!], { size: 14 })}<span className="truncate">{t(`canvas.modes.${shownMode}`)}</span><ChevronDown size={13} />
                </button>
              )}>
              <div className={`w-[232px] p-1 ${CARD}`}>
                <div className="flex h-7 items-center px-2 text-[12px] text-[var(--cv-ink-3)]">{t('canvas.modes.title')}</div>
                {/* only the ways this model makes a clip; its references as one, saying what it takes */}
                {ways.map((m) => {
                  const on = m === shownMode || (m === 'omni' && shownMode === 'refs') || (m === 'refs' && shownMode === 'omni');
                  return (
                    <button key={m} type="button" onClick={() => { setOpts({ mode: m, frames: undefined }); setOpen(null); }}
                      className={`flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)] ${on ? 'bg-[var(--cv-float-hover)]' : ''}`}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--cv-chip)] text-[var(--cv-ink-2)]">{React.createElement(MODE_ICONS[m], { size: 15 })}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-5">{t(`canvas.modes.${m}`)}</span>
                        <span className="block truncate text-[11.5px] leading-4 text-[var(--cv-ink-3)]">{m === 'omni' || m === 'refs' ? takes : t(`canvas.modes.about.${m}`)}</span>
                      </span>
                      {on ? <Check size={14} className="shrink-0 text-[var(--cv-ink-2)]" /> : null}
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
                  /* named as it reads, its parts apart (each part is a span of its own, which a name runs together) */
                  <button type="button" aria-label={spec} className={PICK} onClick={() => setOpen(open === 'spec' ? null : 'spec')}>
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
                  {lengths && sec !== null && data.make !== 'video' ? (
                    <Choices title={t('canvas.make.length')} columns={Math.min(6, lengths.length)} items={lengths.map((n) => ({ key: String(n), label: t('canvas.make.seconds').replace('{n}', String(n)), on: n === sec, pick: () => setOpts({ sec: n }) }))} />
                  ) : null}
                  {data.make === 'video' && range && sec !== null ? <LengthPicker value={sec} range={range} only={model?.only} onChange={(n) => setOpts({ sec: n })} /> : null}
                  <Choices title={t('canvas.make.count')} columns={3} items={MAKE_COUNTS.map((c) => ({ key: String(c), label: t(data.make === 'image' ? 'canvas.make.countPictures' : 'canvas.make.countOthers').replace('{n}', String(c)), on: c === count, pick: () => setOpts({ count: c > 1 ? c : undefined }) }))} />
                </div>
              </Popover>
            </>
          ) : null}
          {takesSubjects ? (
            <Tooltip label={t('canvas.subjects.mention')}>
              <button type="button" aria-label={t('canvas.subjects.mention')} onClick={startMention}
                className="flex h-9 w-9 items-center justify-center rounded-[10px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]"><AtSign size={17} /></button>
            </Tooltip>
          ) : null}
          <span className="flex-1" />
          {unused ? <span className="mr-1 truncate text-[11.5px] text-[var(--cv-label)]">{t('canvas.make.unused').replace('{n}', String(unused))}</span> : null}
          {run ? (
            <Tooltip label={t('canvas.make.stopTip')} wrap>
              <button type="button" aria-label={t('canvas.make.stop')} onClick={() => board.stop(id)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[12px] bg-[var(--cv-invert)] text-[var(--cv-on-invert)]"><Square size={11} fill="currentColor" /></button>
            </Tooltip>
          ) : (
            <Tooltip label={data.versions?.length ? t('canvas.make.again') : t('canvas.make.run')} shortcut={`${MOD}↵`}>
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
        className="absolute -right-1 -top-1 z-10 hidden h-[15px] w-[15px] items-center justify-center rounded-full bg-black text-white shadow-[0_0_0_1px_rgba(255,255,255,0.22)] group-hover/tile:flex disabled:!hidden"><X size={9} strokeWidth={2.75} /></button>
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
          {wired ? <span className="mr-1 truncate text-[11.5px] text-[var(--cv-label)]">{t('canvas.write.wired').replace('{n}', String(wired))}</span> : null}
          <Tooltip label={t('canvas.write.run')} shortcut={`${MOD}↵`}>
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
