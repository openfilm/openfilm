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
import { Handle, NodeResizer, NodeToolbar, Position, useStore, type NodeProps } from '@xyflow/react';
import {
  AlignLeft, AudioLines, BookmarkPlus, Bot, Clapperboard, FileQuestion, Film, Image as ImageIcon, Layers, LayoutGrid, Loader2, Mic, Music, PenLine, Play, Plus, Scissors,
  Square, Type as TypeIcon, Ungroup, Upload, UserRound, Video,
} from 'lucide-react';
import { useT } from '@/i18n';
import { CARD_H, MAKE_MEDIA, NOTE_H, NOTE_W, type CanvasNode, type GroupColor } from '@/lib/canvas';
import type { WorkspaceResource } from '@/lib/workspace-resources';
import { Tooltip } from '../Tooltip';
import { useBoard, type CutNode, type FileNode, type FrameNode, type MakeNode, type NoteNode } from './board';
import { ActionBar, CutPanel, MakePanel, NotePanel } from './panels';
import { Words, WritingBar, useDraft } from './words';
import { SoundCard } from './sound';

/** below this zoom a node is only its outline (its picture, its words are not drawn) */
export const FAR = 0.35;
export const farSelector = (s: { transform: [number, number, number] }) => s.transform[2] < FAR;

export const KIND_ICON = { video: Video, image: ImageIcon, audio: Music, mg: Clapperboard, other: FileQuestion } as const;
export const MAKE_ICON = { image: ImageIcon, video: Video, sfx: AudioLines, music: Music, tts: Mic } as const;
const RESIZE_HANDLE = '!h-2 !w-2 !rounded-[2px] !border-0 !bg-[var(--cv-ring)]';

/** A group's tint: its frame's fill and line, its name's chip, by its color (muted, so what is in it leads). */
export const FRAME_COLOR: Record<GroupColor, { line: string; fill: string; dot: string }> = {
  gray: { line: 'rgba(160,160,170,0.18)', fill: 'var(--cv-group)', dot: '#8a8a90' },
  red: { line: 'rgba(214,92,84,0.28)', fill: 'rgba(214,92,84,0.07)', dot: '#d65c54' },
  orange: { line: 'rgba(214,140,80,0.28)', fill: 'rgba(214,140,80,0.07)', dot: '#d68c50' },
  yellow: { line: 'rgba(200,170,80,0.28)', fill: 'rgba(200,170,80,0.07)', dot: '#c8aa50' },
  green: { line: 'rgba(96,180,130,0.28)', fill: 'rgba(96,180,130,0.07)', dot: '#60b482' },
  blue: { line: 'rgba(96,140,230,0.3)', fill: 'rgba(96,140,230,0.07)', dot: '#608ce6' },
  purple: { line: 'rgba(160,120,230,0.3)', fill: 'rgba(160,120,230,0.07)', dot: '#a078e6' },
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
/* the ⊕ off each side, under the pointer or while selected */
/* a ⊕ beside a card: 24 across as drawn; round it, what takes the pointer too, 24 further out and 16 above and below */
const PLUS = "!flex !h-6 !w-6 items-center justify-center !rounded-full before:absolute before:-inset-y-4 before:rounded-full before:content-[''] !border !border-[var(--cv-ring)] !bg-[var(--cv-bg)] !text-[var(--cv-ink)] transition-[opacity,transform] duration-150 hover:!scale-110";

/**
 * A node's sides: the wires' anchors at the middle of each (first, so a wire without a handle named meets them), and
 * the ⊕ beside each, which a press opens the menu of and a drag draws a wire from.
 */
function Sides({ id, selected, ins = true, outs = true }: { id: string; selected: boolean; ins?: boolean; outs?: boolean }) {
  const board = useBoard();
  const t = useT();
  const shown = board.readOnly ? '!pointer-events-none !opacity-0' : selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';
  const side = (which: 'source' | 'target') => (event: React.MouseEvent) => {
    event.stopPropagation();
    board.sideMenu(id, which, { x: event.clientX, y: event.clientY });
  };
  return (
    <>
      <Handle type="target" position={Position.Left} className={ANCHOR} isConnectable={!board.readOnly} />
      <Handle type="source" position={Position.Right} className={ANCHOR} isConnectable={!board.readOnly} />
      {ins ? (
        <Handle id="in" type="target" position={Position.Left} className={`${PLUS} !-left-[31px] before:-left-6 before:-right-1 ${shown}`} onClick={side('target')} title={t('canvas.side.in')}>
          <Plus size={14} strokeWidth={2} className="pointer-events-none" />
        </Handle>
      ) : null}
      {outs ? (
        <Handle id="out" type="source" position={Position.Right} className={`${PLUS} !-right-[31px] before:-right-6 before:-left-1 ${shown}`} onClick={side('source')} title={t('canvas.side.out')}>
          <Plus size={14} strokeWidth={2} className="pointer-events-none" />
        </Handle>
      ) : null}
    </>
  );
}

/** A node's place among the board's nodes (groups aside), from 1, as its name numbers it. */
function useNumber(id: string): number {
  return useStore((s) => {
    let n = 0;
    for (const node of s.nodes) { if (node.type === 'frame') continue; n += 1; if (node.id === id) return n; }
    return n;
  });
}

/** What every node is drawn in: its name row above, its card, its sides. */
function Frame({ id, selected, icon: Icon, title, meta, by, note, stack = 0, children, ins, outs, tone = 'card' }: {
  id: string; selected: boolean; icon: React.ComponentType<{ size?: number; className?: string }>; title: string; meta?: string | null;
  by?: CanvasNode['by']; note?: React.ReactNode; stack?: number; children: React.ReactNode; ins?: boolean; outs?: boolean; tone?: 'card' | 'quiet';
}) {
  const far = useStore(farSelector);
  const card = `relative h-full w-full overflow-hidden rounded-[12px] border transition-[border-color] duration-150 ${tone === 'quiet' ? 'bg-[var(--cv-card-2)]' : 'bg-[var(--cv-card)]'} ${selected ? '!border-[var(--cv-ring)]' : '!border-[var(--cv-line)] group-hover:!border-[var(--cv-line-hover)]'}`;
  return (
    <div className="group relative h-full w-full">
      {far ? null : (
        <div className={`pointer-events-none absolute bottom-full left-0 right-0 z-10 flex h-6 items-center gap-1 text-[13px] leading-5 text-[var(--cv-label)] ${stack > 1 ? 'mb-3' : 'mb-0.5'}`}>
          <Icon size={14} className="shrink-0" />
          <span className="truncate">{title}</span>
          <span className="flex-1" />
          {note}
          {by ? <ByAgent by={by} /> : null}
          {meta ? <span className="shrink-0 tabular-nums">{meta}</span> : null}
        </div>
      )}
      {/* more than one version: the others fanned behind it */}
      {stack > 1 ? (
        <>
          {stack > 2 ? <div className="absolute inset-0 translate-x-[12px] -translate-y-[10px] rotate-[3.5deg] rounded-[12px] border !border-[var(--cv-line)] bg-[var(--cv-card-2)] opacity-60" /> : null}
          <div className="absolute inset-0 translate-x-[6px] -translate-y-[5px] rotate-[1.75deg] rounded-[12px] border !border-[var(--cv-line)] bg-[var(--cv-card-2)]" />
        </>
      ) : null}
      <div className={card}>{children}</div>
      <Sides id={id} selected={selected} ins={ins} outs={outs} />
    </div>
  );
}

/** A file shown in a card: a picture as it is, a clip's poster (playing under the pointer or while selected), a sound's player. */
function Shown({ file, play, words }: { file: WorkspaceResource; play: boolean; words?: string }) {
  const board = useBoard();
  const src = board.sources.file(file);
  const poster = board.sources.poster?.(file);
  if (file.kind === 'image') return <img src={src} alt="" draggable={false} loading="lazy" className="block h-full w-full object-cover" />;
  if (file.kind === 'video') {
    return play || !poster
      ? <video src={src} poster={poster} muted loop playsInline autoPlay={play} preload="metadata" className="block h-full w-full bg-black object-cover" />
      : <img src={poster} alt="" draggable={false} className="block h-full w-full object-cover" />;
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
function boxStyle(sized: boolean, file: WorkspaceResource | null, ratio?: string): React.CSSProperties {
  if (sized) return { width: '100%', height: '100%' };
  if (file?.kind === 'audio') return { width: 320, height: CARD_H };
  if (file?.w && file.h) return { height: CARD_H, aspectRatio: `${file.w} / ${file.h}` };
  const [w, h] = (ratio ?? '16:9').split(':').map(Number) as [number, number];
  return { height: CARD_H, aspectRatio: `${w} / ${h}` };
}

/** A quick start in an empty node ("Try:"), as a line with its icon. */
function TryLine({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ size?: number }>; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={(event) => { event.stopPropagation(); onClick(); }}
      className="nodrag flex h-8 items-center gap-1.5 rounded-full border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-chip)] px-3.5 text-[12.5px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
      <Icon size={13} />{label}
    </button>
  );
}

/**
 * An empty card: one composition in its middle — its kind drawn faint, and under it what to start with, as pills —
 * whatever the card's shape.
 */
function Empty({ icon: Icon, tries }: { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; tries?: React.ReactNode }) {
  const t = useT();
  const board = useBoard();
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-5 overflow-hidden p-6">
      <span className="text-[var(--cv-ghost)]"><Icon size={44} strokeWidth={1.25} /></span>
      {tries && !board.readOnly ? (
        <div className="flex max-w-full flex-col items-center gap-2.5">
          <div className="text-[12px] text-[var(--cv-ink-3)]">{t('canvas.try.title')}</div>
          <div className="flex max-w-[420px] flex-wrap justify-center gap-2">{tries}</div>
        </div>
      ) : null}
    </div>
  );
}


/** A file of the project on the board: as its picture draws it, 350 high, until resized. */
export function FileNodeView({ id, data, selected, width, height }: NodeProps<FileNode>) {
  const t = useT();
  const board = useBoard();
  const [over, setOver] = React.useState(false);
  const file = board.fileOf(data.path);
  const Icon = KIND_ICON[file?.kind ?? 'other'];
  return (
    <div className="h-full w-full" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <ActionBar id={id} file={file} />
      <Frame id={id} selected={selected} icon={Icon} title={file?.name ?? data.path.split('/').pop() ?? data.path} meta={sizeOf(file)} by={data.by}>
        <div className="relative" style={boxStyle(width != null && height != null, file)}>
          {file ? <Shown file={file} play={over || selected} />
              : <div className="flex h-full w-full items-center justify-center gap-2 px-3 text-center text-[12px] text-[var(--cv-label)]"><FileQuestion size={14} />{t('canvas.missing')}</div>}
        </div>
      </Frame>
    </div>
  );
}

/**
 * Words on the board ("Text"). New, it is square and offers what to start with: writing in it, or a picture, a clip,
 * music made from it. Written in, it is a box of words; a double click writes in it, clicking away is done.
 */
export function NoteNodeView({ id, data, selected, height }: NodeProps<NoteNode>) {
  const t = useT();
  const board = useBoard();
  const n = useNumber(id);
  const editing = board.editing === id;
  /* empty, it says what to write for what it is wired into (a picture, a clip, a sound) */
  const feeds = useStore((s) => {
    for (const e of s.edges) {
      if (e.source !== id) continue;
      const to = s.nodeLookup.get(e.target);
      if (to?.type === 'make') return (to.data as MakeNode['data']).make;
    }
    return null;
  });
  const hint = feeds ? t(`canvas.noteFor.${feeds}`) : t('canvas.notePlaceholder');
  /* to write in: a box of words (a new, square one shrinks to it) */
  const write = () => {
    if (board.readOnly) return;
    if (height === CARD_H) board.resize(id, { w: NOTE_W, h: NOTE_H });
    board.edit(id);
  };
  const fresh = !data.text && !editing && !feeds;
  const area = React.useRef<HTMLTextAreaElement>(null);
  /* the bar over it pressed: the words stay open to write in */
  const barPressed = React.useRef(false);
  const words = useDraft(data.text, (text) => board.setData(id, { text }));
  return (
    <div className="h-full w-full" onDoubleClick={write}>
      <NotePanel id={id} />
      {editing && !board.readOnly ? (
        <NodeToolbar nodeId={id} isVisible position={Position.Top} offset={32}>
          <div data-writing-bar onPointerDownCapture={() => { barPressed.current = true; }}>
            <WritingBar area={area} onChange={words.set} onLarger={() => board.resize(id, { w: 720, h: 520 })} />
          </div>
        </NodeToolbar>
      ) : null}
      <NodeResizer isVisible={editing && !board.readOnly} minWidth={160} minHeight={80} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      <Frame id={id} selected={selected || editing} icon={TypeIcon} title={t('canvas.titles.note').replace('{n}', String(n))} by={data.by}
        tone={editing || data.text ? 'quiet' : 'card'}>
        {editing ? (
          <textarea
            ref={area}
            autoFocus
            /* written on where it ends */
            onFocus={(event) => { const end = event.currentTarget.value.length; event.currentTarget.setSelectionRange(end, end); }}
            {...words.props}
            /* done when the focus goes elsewhere: not to the bar over it, which hands it back */
            onBlur={() => { setTimeout(() => { if (document.activeElement !== area.current && !document.activeElement?.closest('[data-writing-bar]') && !barPressed.current) board.edit(null); barPressed.current = false; }, 0); }}
            onKeyDown={(event) => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { barPressed.current = false; board.edit(null); } }}
            placeholder={hint}
            className="nodrag nowheel h-full w-full resize-none bg-transparent px-4 py-3.5 text-[14px] leading-[1.65] text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]"
          />
        ) : fresh ? (
          <Empty icon={AlignLeft} tries={(
            <>
              <TryLine icon={PenLine} label={t('canvas.try.write')} onClick={write} />
              <TryLine icon={ImageIcon} label={t('canvas.try.toImage')} onClick={() => board.spawn(id, 'image')} />
              <TryLine icon={Music} label={t('canvas.try.toMusic')} onClick={() => board.spawn(id, 'music')} />
              <TryLine icon={Film} label={t('canvas.try.toVideo')} onClick={() => board.spawn(id, 'video')} />
            </>
          )} />
        ) : (
          /* its words as they read: the card is held and moved anywhere on them; a double click, Enter or typing writes in it */
          <div className={`h-full w-full overflow-hidden break-words px-4 py-3.5 text-[14px] leading-[1.65] ${data.text ? 'text-[var(--cv-ink)]' : 'text-[var(--cv-ink-3)]'}`}>
            {data.text ? <Words text={data.text} /> : hint}
          </div>
        )}
      </Frame>
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
  const bar = 'flex h-8 items-center gap-1.5 rounded-[8px] px-2 text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)] disabled:opacity-40';
  return (
    <div className="relative h-full w-full rounded-[12px] border transition-[border-color] duration-150"
      style={{ borderColor: selected ? 'var(--cv-ring)' : paint.line, background: paint.fill }}>
      <NodeResizer isVisible={selected && !board.readOnly} minWidth={160} minHeight={120} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      {selected && !board.readOnly && board.single === id ? (
        <NodeToolbar nodeId={id} isVisible position={Position.Top} offset={36}>
          <div className="nodrag nopan flex items-center gap-0.5 rounded-[12px] bg-[var(--cv-float)] p-1 shadow-[var(--cv-float-shadow)]">
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
      <div className="cv-group-head absolute inset-x-0 top-0 flex h-7 cursor-grab items-center rounded-t-[12px] px-3 transition-colors hover:bg-[color-mix(in_srgb,var(--cv-ink)_5%,transparent)] active:cursor-grabbing"
        onPointerDown={(event) => { if (event.button === 0 && !editing && !(selected && !event.shiftKey && !event.metaKey && !event.ctrlKey)) board.select(id, event.shiftKey || event.metaKey || event.ctrlKey); }}
        onDoubleClick={(event) => { event.stopPropagation(); if (!board.readOnly) board.edit(id); }}>
        {editing ? (
          <input
            autoFocus
            defaultValue={data.label}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => { board.setData(id, { label: event.currentTarget.value.trim() || t('canvas.group') }); board.edit(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur(); }}
            className="nodrag h-6 w-[200px] rounded-[6px] border border-[var(--cv-float-line)] bg-[var(--cv-float)] px-1.5 text-[13px] text-[var(--cv-ink)] outline-none"
          />
        ) : (
          <span className="truncate text-[12.5px] font-medium text-[var(--cv-label)]">{data.label || t('canvas.group')}</span>
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
  const far = useStore(farSelector);
  const n = useNumber(id);
  /* something wired in: it is made from that, so nothing to start with is offered */
  const fed = useStore((s) => s.edges.some((e) => e.target === id));
  const [over, setOver] = React.useState(false);
  const [versionsOpen, setVersionsOpen] = React.useState(false);
  const run = board.run(id);
  const Icon = MAKE_ICON[data.make];
  const media = MAKE_MEDIA[data.make];
  const versions = data.versions ?? [];
  const file = data.path ? board.fileOf(data.path) : null;
  const ratio = data.opts?.ratio ?? '16:9';
  React.useEffect(() => { if (!selected) setVersionsOpen(false); }, [selected]);
  const meta = sizeOf(file) ?? (media === 'audio' ? null : ratio);
  return (
    <div className="h-full w-full" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <ActionBar id={id} file={file} />
      <MakePanel id={id} data={data} />
      <Frame id={id} selected={selected} icon={Icon} title={data.preset ? t(`canvas.presets.names.${data.preset}`) : t(`canvas.titles.${data.make}`).replace('{n}', String(n))} meta={meta} by={data.by} stack={versions.length}
        ins={media !== 'audio'}
        note={board.stale.has(id) ? <span className="pointer-events-auto shrink-0 text-amber-500/90" title={t('canvas.make.staleTip')}>{t('canvas.make.stale')}</span> : null}>
        <div className="relative h-full w-full">
          {file ? <Shown file={file} play={over || selected} words={data.make === 'tts' ? data.prompt : undefined} />
              : (
                <Empty icon={Icon} tries={fed || run ? undefined : media === 'image' ? (
                  <>
                    <TryLine icon={ImageIcon} label={t('canvas.try.fromPicture')} onClick={() => board.upload(id, 'input')} />
                    <TryLine icon={Upload} label={t('canvas.try.upload.image')} onClick={() => board.upload(id, 'version')} />
                  </>
                ) : media === 'video' ? (
                  <>
                    <TryLine icon={Layers} label={t('canvas.try.firstLast')} onClick={() => { board.willChange(); board.setData(id, { opts: { ...data.opts, mode: 'firstLast' } }); }} />
                    <TryLine icon={ImageIcon} label={t('canvas.try.firstFrame')} onClick={() => { board.willChange(); board.setData(id, { opts: { ...data.opts, mode: 'first' } }); }} />
                    <TryLine icon={Upload} label={t('canvas.try.upload.video')} onClick={() => board.upload(id, 'version')} />
                  </>
                ) : (
                  <TryLine icon={Upload} label={t('canvas.try.upload.audio')} onClick={() => board.upload(id, 'version')} />
                )} />
              )}
          {versions.length > 1 && !far && !board.readOnly ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); setVersionsOpen((v) => !v); }}
              className="nodrag absolute right-2.5 top-2.5 flex h-7 items-center gap-1 rounded-lg bg-black/45 px-2 text-[12px] text-white/90 backdrop-blur-md transition hover:bg-black/65">
              <Layers size={13} />{t('canvas.versions').replace('{n}', String(versions.length))}
            </button>
          ) : null}
          {versionsOpen ? (
            <div className="nodrag nowheel absolute right-2.5 top-11 z-10 grid max-h-[70%] grid-cols-3 gap-1.5 overflow-y-auto rounded-xl bg-black/60 p-1.5 backdrop-blur-md">
              {versions.map((path, i) => {
                const version = board.fileOf(path);
                const thumb = version ? (version.kind === 'image' ? board.sources.file(version) : board.sources.poster?.(version)) : undefined;
                return (
                  <button key={path} type="button" title={t('canvas.make.version').replace('{n}', String(i + 1)).replace('{total}', String(versions.length))}
                    onClick={() => { board.willChange(); board.setData(id, { path }); setVersionsOpen(false); }}
                    className={`relative h-12 w-16 overflow-hidden rounded-md ring-2 transition ${path === data.path ? 'ring-white/90' : 'ring-transparent hover:ring-white/40'}`}>
                    {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-white/60"><Icon size={14} /></span>}
                    <span className="absolute bottom-0.5 left-1 text-[10px] text-white drop-shadow">{i + 1}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {run ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-black/55 text-[12.5px] text-white/90 backdrop-blur-[2px]">
              <Loader2 size={20} className="animate-spin" />
              <span>{t('canvas.make.making')} <Elapsed since={run.started} /></span>
              <button type="button" onClick={(event) => { event.stopPropagation(); board.stop(id); }}
                className="nodrag flex h-7 items-center gap-1.5 rounded-full border border-white/25 px-3 text-[12px] transition hover:bg-white/10">
                <Square size={9} />{t('canvas.make.stop')}
              </button>
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
