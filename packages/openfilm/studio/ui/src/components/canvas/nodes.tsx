/**
 * The canvas's nodes, drawn as the node canvases people know draw theirs: a card one step lighter than the board with
 * a grey line (a light one when selected), its name above it in grey, numbered as it was added ("Picture node 2"), its
 * size on the right. A picture's or a clip's card is its shape, 350 high; empty, a card shows its kind large and what
 * to start with ("Try:"). Wires meet a card at the middle of its sides; under the pointer, or selected, a ⊕ stands off
 * each side (the right one makes something from it, the left one brings something into it; dragged, a wire). What a
 * node is asked and made with is in its panel, under it while it is the one selected (panels.tsx); what can be done
 * with it, in a bar over it.
 */
import React from 'react';
import { Handle, NodeResizeControl, NodeResizer, NodeToolbar, Position, useStore, useUpdateNodeInternals, type NodeProps } from '@xyflow/react';
import {
  AudioLines, BookmarkPlus, CircleAlert, Bot, Clapperboard, Download, FileQuestion, Image as ImageIcon, Layers, LayoutGrid, Loader2, Maximize2, Mic, Music, Play, Plus, Scissors,
  MessageSquareQuote, Square, Trash2, Type as TypeIcon, Ungroup, UserRound, Video,
} from 'lucide-react';
import { useT } from '@/i18n';
import { CARD_H, MAKE_MEDIA, type CanvasNode, type GroupColor } from '@/lib/canvas';
import type { WorkspaceResource } from '@/lib/workspace-resources';
import { Tooltip } from '../Tooltip';
import { fileCardWidth, modelTime, numberOf, useBoard, type BoardNode, type CutNode, type FileNode, type FrameNode, type MakeNode, type NoteNode, type UploadStatus } from './board';
import { ActionBar, CutPanel, MakePanel, NotePanel } from './panels';
import { DocSheet, DocView, FormatBar, saveText, useDoc } from './doc';
import { MENU } from './menu-style';
import { SoundCard } from './sound';
import { CanvasVideo } from './video';

/** below this zoom a node is only its outline (its picture, its words are not drawn) */
export const FAR = 0.35;
const MOD = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform) ? '⌘' : 'Ctrl+';
export const farSelector = (s: { transform: [number, number, number] }) => s.transform[2] < FAR;

export const KIND_ICON = { video: Video, image: ImageIcon, audio: Music, mg: Clapperboard, other: FileQuestion } as const;
export const MAKE_ICON = { image: ImageIcon, video: Video, sfx: AudioLines, music: Music, tts: Mic } as const;
const RESIZE_HANDLE = '!h-2 !w-2 !rounded-[2px] !border-0 !bg-[var(--cv-ring)]';
const CARD_TITLE = 'absolute bottom-full left-0 right-0 z-10 flex h-6 items-center gap-1 text-[13px] leading-5 text-[var(--cv-label)]';

/** A group's tint: its frame's fill and line, its name's chip, by its color (muted, so what is in it leads). */
export const FRAME_COLOR: Record<GroupColor, { line: string; fill: string; dot: string }> = {
  gray: { line: 'rgba(160,160,170,0.18)', fill: 'var(--cv-group)', dot: '#8a8a90' },
  red: { line: 'rgba(214,92,84,0.28)', fill: 'rgba(214,92,84,0.14)', dot: '#d65c54' },
  orange: { line: 'rgba(214,140,80,0.28)', fill: 'rgba(214,140,80,0.14)', dot: '#d68c50' },
  yellow: { line: 'rgba(200,170,80,0.28)', fill: 'rgba(200,170,80,0.14)', dot: '#c8aa50' },
  green: { line: 'rgba(96,180,130,0.28)', fill: 'rgba(96,180,130,0.14)', dot: '#60b482' },
  blue: { line: 'rgba(96,140,230,0.3)', fill: 'rgba(96,140,230,0.14)', dot: '#608ce6' },
  purple: { line: 'rgba(160,120,230,0.3)', fill: 'rgba(160,120,230,0.14)', dot: '#a078e6' },
};

/** A file's size as its node's name row says it: its pixels, or how long it is. */
export function sizeOf(file: WorkspaceResource | null | undefined): string | null {
  if (!file) return null;
  if (file.w && file.h) return `${file.w} × ${file.h}`;
  if (file.durationMs) { const s = Math.round(file.durationMs / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  return null;
}

/** How long it has been at it, counted each second. */
export function Elapsed({ since }: { since: number }) {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => { const tick = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(tick); }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return <span className="tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>;
}

/** Who put a node on the board, when an agent did. */
function ByAgent({ by }: { by: NonNullable<CanvasNode['by']> }) {
  const t = useT();
  return (
    <span className="pointer-events-auto flex shrink-0 items-center gap-1" title={t('canvas.make.by').replace('{agent}', by.agent)}>
      <Bot size={12} />{by.agent}
    </span>
  );
}

/* where wires meet a card: the middle of its sides, unseen */
const ANCHOR = '!h-px !w-px !min-h-0 !min-w-0 !border-0 !bg-transparent';
const SIDE_BUTTON_SIZE = 28;
const PLUS = "group/side z-10 !size-7 !border-0 !bg-transparent before:absolute before:-inset-y-10 before:content-[''] transition-opacity duration-150 [&.connectingfrom]:!opacity-0 [&.connectingfrom]:!transition-none";

function SideHandle({ id, side, selected }: { id: string; side: 'source' | 'target'; selected: boolean }) {
  const board = useBoard();
  const t = useT();
  const out = side === 'source';
  const direction = out ? 1 : -1;
  const follow = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || event.buttons) return;
    const handle = event.currentTarget;
    const rect = handle.getBoundingClientRect();
    if (!rect.width) return;
    // Keep the connection's hit area in place and move just the visible plus, in canvas pixels.
    const zoom = rect.width / SIDE_BUTTON_SIZE;
    const x = (event.clientX - rect.left - rect.width / 2) / zoom;
    const y = (event.clientY - rect.top - rect.height / 2) / zoom;
    handle.style.setProperty('--cv-side-x', `${direction * Math.max(-14, Math.min(26, direction * x))}px`);
    handle.style.setProperty('--cv-side-y', `${Math.max(-36, Math.min(36, y))}px`);
  };
  return (
    <Handle id={out ? 'out' : 'in'} type={side} position={out ? Position.Right : Position.Left}
      className={`${PLUS} ${out ? '!-right-7 before:-left-3.5 before:-right-9' : '!-left-7 before:-left-9 before:-right-3.5'} ${selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 hover:opacity-100'}`}
      onPointerMove={follow}
      onPointerLeave={(event) => {
        event.currentTarget.style.removeProperty('--cv-side-x');
        event.currentTarget.style.removeProperty('--cv-side-y');
      }}
      onClick={(event) => {
        event.stopPropagation();
        board.sideMenu(id, side, { x: event.clientX, y: event.clientY });
      }}
      title={t(out ? 'canvas.side.out' : 'canvas.side.in')}>
      <span data-canvas-side-plus="" className="pointer-events-none absolute inset-0 m-auto grid size-6 place-items-center rounded-full border !border-[var(--cv-line-hover)] bg-[var(--cv-bg)] text-[var(--cv-ink)] transition-[scale] duration-150 group-hover/side:scale-110"
        style={{ translate: 'var(--cv-side-x, 0px) var(--cv-side-y, 0px)' }}>
        <Plus size={14} strokeWidth={2} className="opacity-85 transition-opacity duration-150 group-hover/side:opacity-100" />
      </span>
    </Handle>
  );
}

/**
 * A node's sides: the wires' anchors at the middle of each (first, so a wire without a handle named meets them), and
 * the ⊕ beside each, which a press opens the menu of and a drag draws a wire from.
 */
function Sides({ id, selected, ins = true, outs = true }: { id: string; selected: boolean; ins?: boolean; outs?: boolean }) {
  const board = useBoard();
  return (
    <>
      <Handle type="target" position={Position.Left} className={ANCHOR} isConnectable={!board.readOnly} />
      <Handle type="source" position={Position.Right} className={ANCHOR} isConnectable={!board.readOnly} />
      {!board.readOnly && ins ? <SideHandle id={id} side="target" selected={selected} /> : null}
      {!board.readOnly && outs ? <SideHandle id={id} side="source" selected={selected} /> : null}
    </>
  );
}

/** A node's number among the board's nodes of its kind, from 1, as its name numbers it. */
function useNumber(id: string): number {
  return useStore((s) => numberOf(s.nodes as BoardNode[], id));
}

/** A picture's or a clip's shape, width over height, when it is known; a sound or a page has none. */
const aspectOf = (file: WorkspaceResource | null | undefined) =>
  file && (file.kind === 'image' || file.kind === 'video') && file.w && file.h ? file.w / file.h : undefined;
/** A shape asked for ("16:9") as width over height. */
const ratioAspect = (ratio: string) => { const [w, h] = ratio.split(':').map(Number); return w && h ? w / h : undefined; };

/** What every node is drawn in: its name row above, its card, its sides. */
function Frame({ id, selected, icon: Icon, title, meta, by, note, end, aspect, children, ins, outs, tone = 'card', fill, onRename, pending }: {
  id: string; selected: boolean; icon: React.ComponentType<{ size?: number; className?: string }>; title: string; meta?: string | null;
  by?: CanvasNode['by']; note?: React.ReactNode;
  /** what ends its name row, right of `meta` (a making node's versions) */
  end?: React.ReactNode;
  /** a picture's or a clip's shape (width over height): the card is sized only as it, never stretched */
  aspect?: number; children: React.ReactNode; ins?: boolean; outs?: boolean; tone?: 'card' | 'quiet';
  /** a tint over the card (a note's color) */
  fill?: string;
  onRename?: (title: string) => void; pending?: boolean;
}) {
  const board = useBoard();
  const far = useStore(farSelector);
  const resizing = useStore((state) => Boolean(state.nodeLookup.get(id)?.resizing));
  /* a card off its picture's shape (stretched before it was kept to it): put back in it, as wide as it is */
  const shapeOff = useStore((state) => {
    const node = state.nodeLookup.get(id);
    const w = node?.width ?? node?.measured?.width; const h = node?.height ?? node?.measured?.height;
    return aspect && w && h && !node?.resizing && Math.abs(w / h - aspect) / aspect > 0.02 ? Math.round(w) : 0;
  });
  React.useEffect(() => {
    if (shapeOff && aspect && !board.readOnly) board.resize(id, { w: shapeOff, h: Math.round(shapeOff / aspect) });
  }, [shapeOff, aspect]); // eslint-disable-line react-hooks/exhaustive-deps
  const updateNodeInternals = useUpdateNodeInternals();
  const handleLayout = pending ? 'pending' : board.readOnly ? 'anchors' : `${ins !== false}/${outs !== false}`;
  const previousHandleLayout = React.useRef(handleLayout);
  React.useLayoutEffect(() => {
    // Finishing an upload can add handles without resizing the card, so its size observer will not discover them.
    if (previousHandleLayout.current === handleLayout) return;
    previousHandleLayout.current = handleLayout;
    updateNodeInternals(id);
  }, [handleLayout, id, updateNodeInternals]);
  const t = useT();
  const [draft, setDraft] = React.useState<string | null>(null);
  const cancel = React.useRef(false);
  const rename = () => { cancel.current = false; setDraft(title); };
  const card = `relative h-full w-full overflow-hidden rounded-[var(--cv-card-radius)] border transition-[border-color] duration-150 ${tone === 'quiet' ? 'bg-[var(--cv-card-2)]' : 'bg-[var(--cv-card)]'} ${selected ? '!border-[var(--cv-ring)]' : '!border-[var(--cv-card-line)]'}`;
  return (
    <div className="group relative h-full w-full">
      {far && draft === null ? null : (
        <div data-canvas-node-header={onRename ? '' : undefined}
          className={`${CARD_TITLE} ${onRename ? 'nopan cursor-grab active:cursor-grabbing' : 'pointer-events-none'} mb-0.5`}>
          <Icon size={14} className="shrink-0" />
          {onRename && draft !== null ? (
            <input data-canvas-title="" aria-label={t('canvas.video.rename')} autoFocus maxLength={120}
              value={draft} onChange={(event) => setDraft(event.currentTarget.value)}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.stopPropagation()}
              onBlur={() => {
                if (!cancel.current && draft.trim() !== title) onRename(draft.trim());
                setDraft(null);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Escape') cancel.current = true;
                if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
              }}
              /* as wide as its words, to a limit */
              size={Math.max(2, draft.length)}
              className="nodrag min-w-[3ch] max-w-[240px] rounded bg-[var(--cv-float)] px-1 text-[var(--cv-ink)] outline outline-[var(--cv-ring)] [field-sizing:content]" />
          ) : onRename ? (
            <span data-canvas-title="" role="button" tabIndex={0} title={t('canvas.video.renameHint')} className="max-w-[240px] truncate rounded-sm focus-visible:outline"
              onDoubleClick={(event) => { event.stopPropagation(); rename(); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); event.stopPropagation(); rename(); }
              }}>{title}</span>
          ) : <span className="max-w-[240px] truncate">{title}</span>}
          <span className="flex-1" />
          {note}
          {by ? <ByAgent by={by} /> : null}
          {meta ? <span className="shrink-0 tabular-nums">{meta}</span> : null}
          {end}
        </div>
      )}
      <div data-canvas-card="" className={card} style={fill ? { backgroundImage: `linear-gradient(${fill}, ${fill})` } : undefined}>{children}</div>
      {!pending ? <Sides id={id} selected={selected} ins={ins} outs={outs} /> : null}
      {!pending && !board.readOnly && (board.single === id || board.editing === id) ? (
        <NodeResizeControl position="bottom-right" minWidth={160} minHeight={100} maxWidth={1600} maxHeight={1200} keepAspectRatio={Boolean(aspect)}
          onResizeStart={board.willChange}
          /* a card already off its picture's shape (sized before, or a version of another shape) comes back to it */
          onResizeEnd={(_, size) => { if (aspect) board.resize(id, { w: size.width, h: Math.round(size.width / aspect) }); }} className={`cv-card-resize nopan z-20 !size-5 touch-none !border-0 !bg-transparent ${resizing ? 'is-resizing' : ''}`}>
          <span title={t('canvas.resizeCard')} className="grid size-full place-items-center">
            <span aria-hidden="true" className="size-2.5 rounded-br-[2px] border-b-2 border-r-2 !border-[var(--cv-ring)]" />
          </span>
        </NodeResizeControl>
      ) : null}
    </div>
  );
}

/**
 * A card while it is made: veiled whole by a field of dots with a wave of light running through them, and in its top
 * left corner how far it is (measured against how long its model usually takes here; until that is known, a turning
 * ring and the time so far) and a stop.
 */
function Making({ since, typical, onStop }: { since: number; typical: number | null; onStop: () => void }) {
  const t = useT();
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer); }, []);
  const seconds = Math.max(0, (now - since) / 1000);
  /* eases toward the end and never reaches it before it is done: 80% at the usual time */
  const done = typical ? Math.min(0.97, 1 - Math.exp(-1.6 * seconds / Math.max(1, typical))) : null;
  const r = 6.5;
  const round = 2 * Math.PI * r;
  return (
    <>
      <div className="cv-veil-making cv-fade absolute inset-0 z-10"><div className="cv-dots" /></div>
      <div className="cv-fade absolute left-2.5 top-2.5 z-20 flex h-8 items-center gap-2 rounded-full border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] pl-2 pr-1 text-[12.5px] text-[var(--cv-ink)] shadow-[var(--cv-float-shadow)]">
        <svg width="16" height="16" viewBox="0 0 16 16" className={done === null ? 'animate-spin' : ''} aria-hidden>
          <circle cx="8" cy="8" r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
          <circle cx="8" cy="8" r={r} fill="none" stroke="var(--cv-edge-lit)" strokeWidth="2" strokeLinecap="round" transform="rotate(-90 8 8)"
            strokeDasharray={round} strokeDashoffset={round * (1 - (done ?? 0.28))} style={{ transition: 'stroke-dashoffset 250ms linear' }} />
        </svg>
        <span className="tabular-nums">{t('canvas.make.making')}{done !== null ? ` ${Math.round(done * 100)}%` : ''}</span>
        <span className="tabular-nums text-[var(--cv-ink-3)]">{Math.floor(seconds / 60)}:{String(Math.floor(seconds % 60)).padStart(2, '0')}</span>
        <Tooltip label={t('canvas.make.stopTip')} wrap>
          <button type="button" aria-label={t('canvas.make.stop')} onClick={(event) => { event.stopPropagation(); onStop(); }}
            className="nodrag flex h-6 w-6 items-center justify-center rounded-full text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]"><Square size={9} fill="currentColor" /></button>
        </Tooltip>
      </div>
    </>
  );
}

/** A file shown in a card: a picture as it is, or a clip or sound with a player. */
function Shown({ id, file, selected, words }: { id: string; file: WorkspaceResource; selected: boolean; words?: string }) {
  const board = useBoard();
  const src = board.sources.file(file);
  if (file.kind === 'image') return <img src={src} alt="" draggable={false} loading="lazy" className="cv-checker block h-full w-full object-cover" />;
  if (file.kind === 'video') {
    return <CanvasVideo key={src} id={id} file={file} selected={selected} />;
  }
  if (file.kind === 'audio') return <SoundCard file={file} words={words} />;
  const page = file.kind === 'mg' ? board.sources.pagePoster?.(file) : undefined;
  return page
    ? <img src={page} alt="" draggable={false} className="block h-full w-full object-cover" />
    : <div className="flex h-full w-full items-center justify-center bg-[var(--cv-card-2)] text-[var(--cv-ghost)]"><Clapperboard size={30} /></div>;
}

/**
 * The box a file or what is made is drawn in: the card itself once it is sized (made, laid down, resized), else its
 * own shape at the cards' height (a picture, a clip), a sound's box.
 */
function boxStyle(sized: boolean, file: WorkspaceResource | null): React.CSSProperties {
  if (sized) return { width: '100%', height: '100%' };
  return { width: fileCardWidth(file), height: CARD_H };
}

function UploadPanel({ upload }: { upload: UploadStatus }) {
  const t = useT();
  const known = upload.progress >= 0 && upload.progress < 1;
  const label = t(upload.progress === 1 ? 'canvas.importPreparing' : 'canvas.importUploading');
  return (
    <div role="status" className="cv-veil-making absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 px-4 text-center text-[var(--cv-ink)]">
      <Loader2 size={22} className="animate-spin text-[var(--cv-label)]" />
      <div className="w-full truncate text-[13px]">{upload.name}</div>
      <div className="text-xs text-[var(--cv-label)]">{label}{known ? ` ${Math.floor(upload.progress * 100)}%` : ''}</div>
      {known ? <progress aria-label={label} max={1} value={upload.progress} className="h-1 w-full max-w-[140px] accent-[var(--cv-edge-lit)]" /> : null}
    </div>
  );
}

/** A file of the project on the board: as its picture draws it, 350 high, until resized. */
export function FileNodeView({ id, data, selected }: NodeProps<FileNode>) {
  const t = useT();
  const board = useBoard();
  const sized = useStore((state) => {
    const node = state.nodeLookup.get(id);
    return node?.width != null && node.height != null;
  });
  const file = board.fileOf(data.path);
  const Icon = KIND_ICON[data.upload?.kind ?? file?.kind ?? 'other'];
  const title = data.upload?.name ?? data.title ?? file?.name ?? data.path.split('/').pop() ?? data.path;
  const rename = file?.kind === 'video' && !board.readOnly ? (name: string) => {
    board.willChange();
    board.setData(id, { title: name || undefined });
  } : undefined;
  return (
    <div className="h-full w-full">
      <ActionBar id={id} file={file} />
      <Frame id={id} selected={selected} icon={Icon} title={title} meta={sizeOf(file)} by={data.by} onRename={rename} pending={Boolean(data.upload)} aspect={aspectOf(file)}>
        <div className="relative" style={boxStyle(sized, file)}>
          {data.upload ? <UploadPanel upload={data.upload} /> : file ? <Shown id={id} file={file} selected={selected} />
              : <div className="flex h-full w-full items-center justify-center gap-2 px-3 text-center text-[12px] text-[var(--cv-label)]"><FileQuestion size={14} />{t('canvas.missing')}</div>}
        </div>
      </Frame>
    </div>
  );
}

/**
 * Words on the board ("Text"): a document, empty until written in. A double click writes in it, with the bar over it
 * that sets the words; clicking away or Escape is done. Selected, a bar over it: its color, the note opened large, its
 * words saved as a file.
 */
export function NoteNodeView({ id, data, selected }: NodeProps<NoteNode>) {
  const t = useT();
  const board = useBoard();
  const n = useNumber(id);
  const editing = board.editing === id && !board.readOnly;
  const [sheet, setSheet] = React.useState(false);
  /* empty, it says what to write for what it is wired into (a picture, a clip, a sound) */
  const feeds = useStore((s) => {
    for (const e of s.edges) {
      if (e.source !== id) continue;
      const to = s.nodeLookup.get(e.target);
      if (to?.type === 'make') return (to.data as MakeNode['data']).make;
    }
    return null;
  });
  const placeholder = feeds ? t(`canvas.noteFor.${feeds}`) : editing ? t('canvas.words.placeholder') : t('canvas.noteEmpty');
  const write = (text: string) => board.setData(id, { text });
  const editor = useDoc({ text: data.text, editable: editing, placeholder, onChange: write });
  /* written in: the caret where the words end; done when the focus goes anywhere but the bar over it */
  const stop = React.useRef(() => board.edit(null));
  stop.current = () => board.edit(null);
  React.useEffect(() => {
    if (!editor || !editing) return undefined;
    editor.commands.focus('end');
    const blur = ({ event }: { event: FocusEvent }) => {
      if ((event.relatedTarget as HTMLElement | null)?.closest?.('[data-writing-bar]')) return;
      stop.current();
    };
    editor.on('blur', blur);
    return () => { editor.off('blur', blur); };
  }, [editor, editing]);
  const title = data.title ?? t('canvas.titles.note').replace('{n}', String(n));
  /* written by the agent: veiled until its first words come, which then fill in, a caret at their end */
  const since = board.writing?.(id);
  const busy = since != null;
  const start = React.useRef<string | null>(null);
  if (!busy) start.current = null;
  else if (start.current === null) start.current = data.text;
  const veiled = busy && data.text === start.current;
  const [versionsOpen, setVersionsOpen] = React.useState(false);
  React.useEffect(() => { if (!selected) setVersionsOpen(false); }, [selected]);
  const earlier = data.versions ?? [];
  /* named as the person calls it; an empty name goes back to its number */
  const rename = board.readOnly ? undefined : (name: string) => { board.willChange(); board.setData(id, { title: name || undefined }); };
  const open = () => { board.edit(null); setSheet(true); };
  return (
    <div className="h-full w-full" onDoubleClick={(event) => {
      /* only a double-click on the card itself: its bars are portals whose events still bubble here */
      if (!board.readOnly && !editing && event.currentTarget.contains(event.target as Node)) board.edit(id);
    }}
      onKeyDown={(event) => { if (editing && event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); editor?.commands.blur(); board.edit(null); } }}>
      <NotePanel id={id} />
      {editing && editor ? (
        <NodeToolbar nodeId={id} isVisible position={Position.Top} offset={32}>
          <div className="cv-bar-top nodrag nopan rounded-[14px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]">
            <FormatBar editor={editor} onExpand={open} />
          </div>
        </NodeToolbar>
      ) : selected && !board.readOnly && board.single === id ? (
        <NodeToolbar nodeId={id} isVisible position={Position.Top} offset={32}>
          <NoteBar id={id} color={data.color} text={data.text} name={title} onExpand={open} />
        </NodeToolbar>
      ) : null}
      <Frame id={id} selected={selected} icon={TypeIcon} title={title} by={data.by} onRename={rename}
        note={earlier.length && !busy ? <NoteVersions id={id} text={data.text} earlier={earlier} open={versionsOpen} onOpen={setVersionsOpen} readOnly={board.readOnly} /> : null}
        tone={editing || data.text ? 'quiet' : 'card'} fill={data.color ? FRAME_COLOR[data.color].fill : undefined}>
        {/* being written: on the surface every card being made has, off the board, its color over it, until it is done */}
        {busy ? (
          <div className="cv-veil-making cv-fade pointer-events-none absolute inset-0">
            {data.color ? <div className="absolute inset-0" style={{ background: FRAME_COLOR[data.color].fill }} /> : null}
          </div>
        ) : null}
        {/* its words as they read: held and moved anywhere on them, scrolled once it is selected; written in, they take the pointer */}
        <DocView editor={editor} className={`relative h-full w-full px-5 py-4 ${busy ? 'cv-streaming' : ''} ${editing ? 'nodrag nopan nowheel cursor-text overflow-y-auto' : selected ? 'nowheel overflow-y-auto' : 'overflow-hidden'}`} />
        {/* veiled whole: what it said before is gone from sight, as a new one comes */}
        {veiled ? (
          <div className="cv-veil-making cv-fade absolute inset-0 z-10">
            {data.color ? <div className="absolute inset-0" style={{ background: FRAME_COLOR[data.color].fill }} /> : null}
            <div className="cv-dots" />
          </div>
        ) : null}
        {busy ? (
          /* at it: since when, and stopped here */
          <div role="status" className="absolute left-2.5 top-2.5 z-20 flex h-7 items-center gap-2 rounded-[8px] bg-[var(--cv-float)] pl-2.5 pr-1 text-[12.5px] text-[var(--cv-ink)] shadow-[var(--cv-float-shadow)]">
            <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--cv-edge-lit)]" />{t('canvas.write.writing')} <span className="tabular-nums text-[var(--cv-ink-2)]"><Elapsed since={since} /></span></span>
            {board.stopWriting ? (
              <button type="button" onClick={(event) => { event.stopPropagation(); board.stopWriting?.(id); }}
                className="nodrag flex h-5 items-center rounded-[6px] px-1.5 text-[12px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">{t('canvas.write.stop')}</button>
            ) : null}
          </div>
        ) : null}
      </Frame>
      {sheet ? <DocSheet name={title} text={data.text} onChange={write} onRename={rename} onClose={() => setSheet(false)} /> : null}
    </div>
  );
}

/**
 * A note's versions: what it says now and the words its agent's writing took the place of, newest first. One picked
 * takes the place of what it says now, which is kept among them; an earlier one can be removed.
 */
function NoteVersions({ id, text, earlier, open, onOpen, readOnly }: { id: string; text: string; earlier: string[]; open: boolean; onOpen: (open: boolean) => void; readOnly?: boolean }) {
  const t = useT();
  const board = useBoard();
  const firstLine = (words: string) => words.replace(/[#>*_`~-]/g, ' ').split('\n').map((l) => l.trim()).find(Boolean) ?? t('canvas.noteVersions.empty');
  const pick = (i: number) => {
    board.willChange();
    const rest = earlier.filter((_, k) => k !== i);
    board.setData(id, { text: earlier[i], versions: text.trim() ? [...rest, text] : rest.length ? rest : undefined });
    onOpen(false);
  };
  const remove = (i: number) => {
    board.willChange();
    const rest = earlier.filter((_, k) => k !== i);
    board.setData(id, { versions: rest.length ? rest : undefined });
    if (!rest.length) onOpen(false);
  };
  const row = 'flex h-9 w-full min-w-0 items-center gap-2 rounded-[10px] px-2.5 text-left text-[13px]';
  return (
    /* in the name row over the card, at its right */
    <div className="nodrag nopan nowheel pointer-events-auto relative shrink-0">
      <button type="button" aria-expanded={open} disabled={readOnly} onClick={(event) => { event.stopPropagation(); onOpen(!open); }}
        className={`flex h-5 items-center gap-1 rounded-[6px] px-1.5 text-[12px] transition ${open ? 'bg-[var(--cv-on)] text-[var(--cv-ink)]' : 'text-[var(--cv-label)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]'}`}>
        <Layers size={12} />{t('canvas.noteVersions.count').replace('{n}', String(earlier.length + 1))}
      </button>
      {open ? (
        <div className={`${MENU} absolute right-0 top-full z-30 mt-1.5 max-h-[260px] w-[240px] overflow-y-auto`} onPointerDown={(event) => event.stopPropagation()}>
          <div className={`${row} bg-[var(--cv-float-hover)] text-[var(--cv-ink)]`}>
            <span className="shrink-0 text-[11.5px] text-[var(--cv-edge-lit)]">{t('canvas.noteVersions.current')}</span>
            <span className="min-w-0 flex-1 truncate">{firstLine(text)}</span>
          </div>
          {earlier.map((words, i) => ({ words, i })).reverse().map(({ words, i }) => (
            <div key={`${i}:${words.length}`} className={`group/version ${row} text-[var(--cv-ink)] hover:bg-[var(--cv-float-hover)]`}>
              <button type="button" onClick={() => pick(i)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--cv-ink-3)]">{t('canvas.noteVersions.version').replace('{n}', String(i + 1))}</span>
                <span className="min-w-0 flex-1 truncate">{firstLine(words)}</span>
              </button>
              <button type="button" aria-label={t('canvas.noteVersions.remove')} title={t('canvas.noteVersions.remove')} onClick={() => remove(i)}
                className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-[6px] text-[var(--cv-ink-3)] hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)] group-hover/version:flex"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const SWATCH = 'h-7 w-7 rounded-[7px] transition hover:scale-105';
const SWATCH_ON = 'ring-2 ring-white ring-offset-2 ring-offset-[var(--cv-float)]';

/** The bar over a selected note: its color (none: the card's own), the note opened large, its words saved as a Markdown file. */
function NoteBar({ id, color, text, name, onExpand }: { id: string; color?: GroupColor; text: string; name: string; onExpand: () => void }) {
  const t = useT();
  const board = useBoard();
  const [colors, setColors] = React.useState(false);
  const icon = 'cv-tool flex h-9 w-9 items-center justify-center rounded-[8px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)] disabled:opacity-40';
  const paint = (c: GroupColor | undefined) => { board.willChange(); board.setData(id, { color: c }); setColors(false); };
  return (
    <div className="cv-bar-top nodrag nopan relative flex items-center gap-0.5 rounded-[14px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]">
      {/* first, the agent: the note made a reference in the chat, to change or write from */}
      {board.refer ? (
        <>
          <Tooltip label={`${t('canvas.noteBar.toChat')} · ${MOD}L`}>
            <button type="button" aria-label={t('canvas.noteBar.toChat')} onClick={() => board.refer?.(id)} className={icon}><MessageSquareQuote size={17} /></button>
          </Tooltip>
          <span className="mx-1 h-4 w-px bg-[var(--cv-float-line)]" />
        </>
      ) : null}
      <span>
        <button type="button" aria-expanded={colors} onClick={() => setColors((v) => !v)}
          className="cv-tool flex h-9 items-center gap-2 rounded-[8px] px-2.5 text-[14px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
          <span className="h-[18px] w-[18px] rounded-[5px] border border-white/20" style={{ background: color ? FRAME_COLOR[color].dot : 'var(--cv-card)' }} />
          {t('canvas.noteBar.fill')}
        </button>
        {colors ? (
          /* centered under the whole bar */
          <span className={`${MENU} absolute left-1/2 top-full z-10 mt-2 flex -translate-x-1/2 gap-2 !p-2.5`}>
            <button type="button" aria-label={t('canvas.noteBar.none')} title={t('canvas.noteBar.none')} onClick={() => paint(undefined)}
              className={`${SWATCH} bg-[var(--cv-card)] ${color ? 'border border-white/20' : SWATCH_ON}`} />
            {(Object.keys(FRAME_COLOR) as GroupColor[]).filter((c) => c !== 'gray').map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => paint(c)}
                className={`${SWATCH} ${c === color ? SWATCH_ON : ''}`} style={{ background: FRAME_COLOR[c].dot }} />
            ))}
          </span>
        ) : null}
      </span>
      <span className="mx-1 h-4 w-px bg-[var(--cv-float-line)]" />
      <Tooltip label={t('canvas.words.expand')}>
        <button type="button" aria-label={t('canvas.words.expand')} onClick={onExpand} className={icon}><Maximize2 size={17} /></button>
      </Tooltip>
      <Tooltip label={t('canvas.actions.download')}>
        <button type="button" aria-label={t('canvas.actions.download')} disabled={!text} onClick={() => saveText(name, text)} className={icon}><Download size={17} /></button>
      </Tooltip>
    </div>
  );
}

/**
 * A group: a faint tint round what is in it, its name small above its corner (a double click renames it); selected,
 * a bar over it: its color, all it makes made in order, kept as a template, taken apart.
 */
export function FrameNodeView({ id, data, selected }: NodeProps<FrameNode>) {
  const t = useT();
  const board = useBoard();
  const editing = board.editing === id;
  const paint = FRAME_COLOR[data.color];
  const [colors, setColors] = React.useState(false);
  const cancelRename = React.useRef(false);
  const rename = () => {
    if (board.readOnly) return;
    cancelRename.current = false;
    board.edit(id);
  };
  const bar = 'flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)] disabled:opacity-40';
  return (
    <div className="relative h-full w-full rounded-[var(--cv-card-radius)] border transition-[border-color] duration-150"
      style={{ borderColor: selected ? 'var(--cv-ring)' : paint.line, background: paint.fill }}>
      <NodeResizer isVisible={selected && !board.readOnly} minWidth={160} minHeight={120} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      {selected && !board.readOnly && board.single === id ? (
        <NodeToolbar nodeId={id} isVisible position={Position.Top} offset={36} style={{ zIndex: 4 }}>
          <div className="cv-bar-top nodrag nopan flex items-center gap-0.5 rounded-[12px] bg-[var(--cv-float)] p-1 shadow-[var(--cv-float-shadow)]">
            <span className="relative">
              <button type="button" aria-label={t('canvas.color')} onClick={() => setColors((v) => !v)} className={`${bar} !px-1.5`}>
                <span className="h-4 w-4 rounded-full border border-white/20" style={{ background: paint.dot }} />
              </button>
              {colors ? (
                <span className="absolute left-0 top-10 flex gap-1 rounded-[10px] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]">
                  {(Object.keys(FRAME_COLOR) as GroupColor[]).map((c) => (
                    <button key={c} type="button" aria-label={c} onClick={() => { board.willChange(); board.setData(id, { color: c }); setColors(false); }}
                      className={`h-5 w-5 rounded-full border ${c === data.color ? 'border-white' : 'border-white/20'}`} style={{ background: FRAME_COLOR[c].dot }} />
                  ))}
                </span>
              ) : null}
            </span>
            {board.makesIn(id) ? (
              <Tooltip label={t('canvas.makeAllTip')}>
                <button type="button" disabled={board.busyIn(id)} onClick={() => board.makeAll(id)} className={bar}>
                  {board.busyIn(id) ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} />}{t('canvas.makeAll')}
                </button>
              </Tooltip>
            ) : null}
            <button type="button" onClick={() => board.tidy(id)} className={bar}><LayoutGrid size={14} />{t('canvas.tidy')}</button>
            <button type="button" onClick={() => board.keepTemplate(id)} className={bar}><BookmarkPlus size={14} />{t('canvas.keepTemplate')}</button>
            <button type="button" onClick={() => board.keepCharacter(id)} className={bar}><UserRound size={14} />{t('canvas.characters.keep')}</button>
            <button type="button" onClick={() => board.ungroup(id)} className={bar}><Ungroup size={14} />{t('canvas.ungroup')}</button>
          </div>
        </NodeToolbar>
      ) : null}
      {/* its title bar, what holds it: a drag moves it with what is in it, a click picks it (⇧ adds it), a double click
          names it. Inside it the board is the board (globals.css): a drag there draws a selection box. */}
      <div className={`cv-group-head nopan mb-0.5 cursor-grab active:cursor-grabbing ${CARD_TITLE}`}
        onPointerDown={(event) => { if (event.button === 0 && !editing && !(selected && !event.shiftKey && !event.metaKey && !event.ctrlKey)) board.select(id, event.shiftKey || event.metaKey || event.ctrlKey); }}
        onDoubleClick={(event) => { event.stopPropagation(); rename(); }}>
        {editing ? (
          <input data-canvas-title="" aria-label={t('canvas.group')} maxLength={80}
            autoFocus
            defaultValue={data.label}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => {
              const label = event.currentTarget.value.trim() || t('canvas.group');
              if (!cancelRename.current && label !== data.label) board.setData(id, { label });
              board.edit(null);
            }}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') cancelRename.current = true;
              if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur();
            }}
            className="nodrag h-6 w-[min(200px,100%)] rounded bg-[var(--cv-float)] px-1 text-[var(--cv-ink)] outline outline-[var(--cv-ring)]"
          />
        ) : board.readOnly ? (
          <span className="truncate">{data.label || t('canvas.group')}</span>
        ) : (
          <span data-canvas-title="" role="button" tabIndex={0} title={t('canvas.video.renameHint')} className="truncate rounded-sm focus-visible:outline"
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === 'F2') { event.preventDefault(); event.stopPropagation(); rename(); }
            }}>{data.label || t('canvas.group')}</span>
        )}
      </div>
    </div>
  );
}

/**
 * A node that makes something: what it made (its versions fanned behind, the one shown on top), or, empty, a ghost of
 * its kind and what to start with. Being made, it says how long it has been at it.
 */
export function MakeNodeView({ id, data, selected }: NodeProps<MakeNode>) {
  const t = useT();
  const board = useBoard();
  const n = useNumber(id);
  /* something wired in: it is made from that, so nothing to start with is offered */
  const [versionsOpen, setVersionsOpen] = React.useState(false);
  const run = board.run(id);
  const failed = board.error(id);
  const Icon = MAKE_ICON[data.make];
  const media = MAKE_MEDIA[data.make];
  const versions = data.versions ?? [];
  const file = data.path ? board.fileOf(data.path) : null;
  const uploading = board.uploading?.(id);
  const rename = media !== 'audio' && !board.readOnly ? (name: string) => {
    board.willChange();
    board.setData(id, { title: name || undefined });
  } : undefined;
  const ratio = data.opts?.ratio ?? '16:9';
  React.useEffect(() => { if (!selected) setVersionsOpen(false); }, [selected]);
  const meta = sizeOf(file) ?? (media === 'audio' ? null : ratio);
  /* how long its model usually takes here: what its progress is measured against */
  const making = data.via ? { via: data.via, model: data.model } : board.fallback(data.make);
  const typical = making ? modelTime(making.via, making.model) : null;
  return (
    <div className="h-full w-full">
      <ActionBar id={id} file={file} empty={media === 'audio' ? undefined : media} />
      <MakePanel id={id} data={data} />
      <Frame id={id} selected={selected} icon={Icon} title={data.title ?? (data.preset ? t(`canvas.presets.names.${data.preset}`) : t(`canvas.titles.${data.make}`).replace('{n}', String(n)))} meta={meta} by={data.by} onRename={rename}
        aspect={file ? aspectOf(file) : media === 'audio' ? undefined : ratioAspect(ratio)}
        ins={media !== 'audio'}
        note={board.stale.has(id) ? <span className="pointer-events-auto shrink-0 text-amber-500/90" title={t('canvas.make.staleTip')}>{t('canvas.make.stale')}</span> : null}
        end={<>
          {/* more than one version: how many, in its name row, opening them to pick the one shown */}
          {versions.length > 1 && !board.readOnly ? (
            <span className="relative -mr-1.5 shrink-0">
              <button type="button" aria-expanded={versionsOpen}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); setVersionsOpen((v) => !v); }}
                className={`nodrag flex h-6 items-center gap-1 rounded-md px-1.5 tabular-nums transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)] ${versionsOpen ? 'bg-[var(--cv-float-hover)] text-[var(--cv-ink)]' : ''}`}>
                <Layers size={12} />{t('canvas.versions').replace('{n}', String(versions.length))}
              </button>
              {versionsOpen ? (
                <div onPointerDown={(event) => event.stopPropagation()}
                  className="nodrag nowheel cv-bar-bottom absolute right-0 top-full z-30 mt-1.5 grid max-h-[260px] w-max grid-cols-3 gap-1.5 overflow-y-auto rounded-xl border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]">
                  {versions.map((path, i) => {
                    const version = board.fileOf(path);
                    const thumb = version ? (version.kind === 'image' ? board.sources.file(version) : board.sources.poster?.(version)) : undefined;
                    return (
                      <button key={path} type="button" title={t('canvas.make.version').replace('{n}', String(i + 1)).replace('{total}', String(versions.length))}
                        onClick={() => { board.willChange(); board.setData(id, { path }); setVersionsOpen(false); }}
                        className={`relative h-14 w-14 overflow-hidden rounded-lg ring-2 transition ${path === data.path ? 'ring-[var(--cv-ring)]' : 'ring-transparent hover:ring-[var(--cv-line)]'}`}>
                        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center bg-[var(--cv-card-2)] text-[var(--cv-ink-3)]"><Icon size={14} /></span>}
                        <span className="absolute bottom-0.5 left-1 text-[10px] text-white drop-shadow">{i + 1}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </span>
          ) : null}
        </>}>
        <div className="relative h-full w-full">
          {file ? <Shown id={id} file={file} selected={selected} words={data.make === 'tts' ? data.prompt : undefined} />
              : (
                /* empty: its mark on a soft light, the same for a picture, a clip and a sound; everything to start with is in its composer and the bar above */
                <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(135deg,color-mix(in_srgb,var(--cv-ink)_7%,var(--cv-card)),var(--cv-card)_70%)] text-[var(--cv-ghost)]">
                  <Icon size={40} strokeWidth={1.4} />
                </div>
              )}
          {uploading ? <UploadPanel upload={uploading} /> : run ? (
            <Making since={run.started} typical={typical} onStop={() => board.stop(id)} />
          ) : failed && !file ? (
            /* it failed: said on the card itself (the whole reason in its composer) */
            <div title={failed} className="absolute inset-x-3 bottom-3 flex items-start gap-2 rounded-[10px] border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] leading-snug text-red-300 backdrop-blur-sm">
              <CircleAlert size={14} className="mt-px shrink-0" />
              <span className="min-w-0"><span className="font-medium">{t('canvas.make.failedTitle')}</span><span className="line-clamp-2 text-red-300/80">{failed}</span></span>
            </div>
          ) : null}
        </div>
      </Frame>
    </div>
  );
}

/** A cut: what is wired into it, its shots numbered in their order, to go onto the timeline in that order. */
export function CutNodeView({ id, data, selected }: NodeProps<CutNode>) {
  const t = useT();
  const board = useBoard();
  const n = useNumber(id);
  const shots = board.inputs(id).filter((i) => i.path);
  const seconds = Math.round(shots.reduce((sum, i) => sum + (board.fileOf(i.path!)?.durationMs ?? 0), 0) / 1000);
  const meta = shots.length ? t('canvas.cut.count').replace('{n}', String(shots.length)) + (seconds ? ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '') : null;
  return (
    <div className="h-full w-full">
      <CutPanel id={id} count={shots.length} />
      <Frame id={id} selected={selected} icon={Scissors} title={t('canvas.titles.cut').replace('{n}', String(n))} meta={meta} by={data.by} outs={false}>
        {shots.length ? (
            <div className="nowheel grid h-full grid-cols-2 content-start gap-2 overflow-y-auto p-3">
              {shots.map((shot, i) => {
                const file = board.fileOf(shot.path!);
                const thumb = file ? (file.kind === 'image' ? board.sources.file(file) : board.sources.poster?.(file)) : undefined;
                return (
                  <div key={shot.edge} className="relative aspect-video overflow-hidden rounded-lg bg-[var(--cv-card-2)]">
                    {thumb ? <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover" />
                      : <span className="flex h-full w-full items-center justify-center text-[var(--cv-ghost)]">{file?.kind === 'audio' ? <Music size={16} /> : <Video size={16} />}</span>}
                    <span className="absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center rounded bg-black/55 px-1 text-[10px] font-medium text-white backdrop-blur-sm">{i + 1}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-8 text-center text-[13px] leading-relaxed text-[var(--cv-label)]">
              <Scissors size={44} strokeWidth={1.4} className="text-[var(--cv-ghost)]" />
              {t('canvas.cut.empty')}
            </div>
          )}
      </Frame>
    </div>
  );
}

export const NODE_TYPES = { file: FileNodeView, note: NoteNodeView, frame: FrameNodeView, make: MakeNodeView, cut: CutNodeView };
