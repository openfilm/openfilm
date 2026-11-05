/**
 * The canvas's nodes: each a quiet card with its name above it (what it is, on the left; its size, on the right) and
 * only what it shows inside. Wires meet a card at the middle of its sides; under the pointer, or selected, a ⊕ stands
 * off each side (the right one makes something from it, the left one brings something into it; dragged, a wire).
 * What a node is asked and made with is in its panel, under it while it is the one selected (panels.tsx); what can be
 * done with it, in a bar over it.
 */
import React from 'react';
import { Handle, NodeResizer, Position, useStore, type NodeProps } from '@xyflow/react';
import {
  AudioLines, Bot, Clapperboard, FileQuestion, Image as ImageIcon, Layers, Loader2, Music, Play, Plus, Scissors, Square,
  Type as TypeIcon, Upload, Video,
} from 'lucide-react';
import { useT } from '@/i18n';
import { MAKE_MEDIA, type CanvasNode, type GroupColor } from '@/lib/canvas';
import type { WorkspaceResource } from '@/lib/workspace-resources';
import { Tooltip } from '../Tooltip';
import { useBoard, type CutNode, type FileNode, type FrameNode, type MakeNode, type NoteNode } from './board';
import { ActionBar, CutPanel, MakePanel } from './panels';

/** below this zoom a node is only its outline (its picture, its words are not drawn) */
export const FAR = 0.35;
export const farSelector = (s: { transform: [number, number, number] }) => s.transform[2] < FAR;

export const KIND_ICON = { video: Video, image: ImageIcon, audio: Music, mg: Clapperboard, other: FileQuestion } as const;
export const MAKE_ICON = { image: ImageIcon, video: Video, sfx: AudioLines, music: Music } as const;
const RESIZE_HANDLE = '!h-2.5 !w-2.5 !rounded-full !border-[1.5px] !border-[var(--cv-ring)] !bg-[var(--cv-card)]';

/** A group's tint: its frame's fill and line, its name's chip, by its color (muted, so what is in it leads). */
export const FRAME_COLOR: Record<GroupColor, { line: string; fill: string; chip: string }> = {
  gray: { line: 'rgba(160,160,170,0.22)', fill: 'rgba(160,160,170,0.05)', chip: '#4a4a50' },
  red: { line: 'rgba(214,92,84,0.28)', fill: 'rgba(214,92,84,0.06)', chip: '#7a3430' },
  orange: { line: 'rgba(214,140,80,0.28)', fill: 'rgba(214,140,80,0.06)', chip: '#7a4a28' },
  yellow: { line: 'rgba(200,170,80,0.28)', fill: 'rgba(200,170,80,0.06)', chip: '#6e5a24' },
  green: { line: 'rgba(96,180,130,0.28)', fill: 'rgba(96,180,130,0.06)', chip: '#2e5e44' },
  blue: { line: 'rgba(96,140,230,0.3)', fill: 'rgba(96,140,230,0.06)', chip: '#2f4a80' },
  purple: { line: 'rgba(160,120,230,0.3)', fill: 'rgba(160,120,230,0.06)', chip: '#523a80' },
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
const PLUS = '!flex !h-7 !w-7 items-center justify-center !rounded-full !border !border-[var(--cv-float-line)] !bg-[var(--cv-float)] !text-[var(--cv-label)] shadow-[var(--cv-float-shadow)] transition-[opacity,color,transform] duration-150 hover:!scale-110 hover:!text-[var(--cv-ink)]';

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
        <Handle id="in" type="target" position={Position.Left} className={`${PLUS} !-left-6 ${shown}`} onClick={side('target')} title={t('canvas.side.in')}>
          <Plus size={15} strokeWidth={2} className="pointer-events-none" />
        </Handle>
      ) : null}
      {outs ? (
        <Handle id="out" type="source" position={Position.Right} className={`${PLUS} !-right-6 ${shown}`} onClick={side('source')} title={t('canvas.side.out')}>
          <Plus size={15} strokeWidth={2} className="pointer-events-none" />
        </Handle>
      ) : null}
    </>
  );
}

/** What every node is drawn in: its name row above, its card, its sides. */
function Frame({ id, selected, icon: Icon, title, meta, by, note, stack = 0, children, ins, outs, tone = 'card' }: {
  id: string; selected: boolean; icon: React.ComponentType<{ size?: number; className?: string }>; title: string; meta?: string | null;
  by?: CanvasNode['by']; note?: React.ReactNode; stack?: number; children: React.ReactNode; ins?: boolean; outs?: boolean; tone?: 'card' | 'quiet';
}) {
  const far = useStore(farSelector);
  const card = `relative h-full w-full overflow-hidden rounded-[14px] border transition-[border-color,box-shadow] duration-150 ${tone === 'quiet' ? 'bg-[var(--cv-card-2)]' : 'bg-[var(--cv-card)]'} ${selected ? 'border-transparent shadow-[0_0_0_1.5px_var(--cv-ring),var(--cv-shadow)]' : 'border-[var(--cv-line)] shadow-[var(--cv-shadow)] group-hover:border-[var(--cv-line-hover)]'}`;
  return (
    <div className="group relative h-full w-full">
      {far ? null : (
        <div className={`pointer-events-none absolute bottom-full left-0.5 right-0.5 z-10 flex items-center gap-1.5 text-[12px] leading-none text-[var(--cv-label)] ${stack > 1 ? 'mb-4' : 'mb-2'}`}>
          <Icon size={13} className="shrink-0" />
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
          {stack > 2 ? <div className="absolute inset-0 translate-x-[12px] -translate-y-[10px] rotate-[3.5deg] rounded-[14px] border border-[var(--cv-line)] bg-[var(--cv-card-2)] opacity-60" /> : null}
          <div className="absolute inset-0 translate-x-[6px] -translate-y-[5px] rotate-[1.75deg] rounded-[14px] border border-[var(--cv-line)] bg-[var(--cv-card-2)]" />
        </>
      ) : null}
      <div className={card}>{children}</div>
      <Sides id={id} selected={selected} ins={ins} outs={outs} />
    </div>
  );
}

/** A file shown in a card: a picture as it is, a clip's poster (playing under the pointer or while selected), a sound's player. */
function Shown({ file, play }: { file: WorkspaceResource; play: boolean }) {
  const board = useBoard();
  const src = board.sources.file(file);
  const poster = board.sources.poster?.(file);
  if (file.kind === 'image') return <img src={src} alt="" draggable={false} loading="lazy" className="block h-full w-full object-cover" />;
  if (file.kind === 'video') {
    return play || !poster
      ? <video src={src} poster={poster} muted loop playsInline autoPlay={play} preload="metadata" className="block h-full w-full bg-black object-cover" />
      : <img src={poster} alt="" draggable={false} className="block h-full w-full object-cover" />;
  }
  if (file.kind === 'audio') {
    return (
      <div className="flex h-full w-full items-center gap-2.5 px-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cv-card-2)] text-[var(--cv-label)]"><Music size={16} /></span>
        <audio src={src} controls preload="none" className="nodrag h-8 min-w-0 flex-1" />
      </div>
    );
  }
  const page = file.kind === 'mg' ? board.sources.pagePoster?.(file) : undefined;
  return page
    ? <img src={page} alt="" draggable={false} className="block h-full w-full object-cover" />
    : <div className="flex h-full w-full items-center justify-center bg-[var(--cv-card-2)] text-[var(--cv-ghost)]"><Clapperboard size={30} /></div>;
}

/** The box a file is drawn in: its own shape (a picture, a clip), a strip for a sound. */
function aspectOf(file: WorkspaceResource | null, ratio?: string): React.CSSProperties {
  if (file?.kind === 'audio') return { height: 76 };
  if (file?.w && file.h) return { aspectRatio: `${file.w} / ${file.h}` };
  const [w, h] = (ratio ?? '16:9').split(':').map(Number) as [number, number];
  return { aspectRatio: `${w} / ${h}` };
}

/** A quick start in an empty node ("Try:"), as a line with its icon. */
function TryLine({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ size?: number }>; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={(event) => { event.stopPropagation(); onClick(); }}
      className="nodrag flex h-7 items-center gap-2 rounded-lg px-2 text-[12.5px] text-[var(--cv-label)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
      <Icon size={14} />{label}
    </button>
  );
}

/** Far out: a card's outline, its kind's icon in it. */
function Outline({ icon: Icon, style }: { icon: React.ComponentType<{ size?: number }>; style?: React.CSSProperties }) {
  return <div className="flex h-full w-full items-center justify-center bg-[var(--cv-card-2)] text-[var(--cv-ghost)]" style={style}><Icon size={32} /></div>;
}

/** A file of the project on the board. */
export function FileNodeView({ id, data, selected }: NodeProps<FileNode>) {
  const t = useT();
  const board = useBoard();
  const far = useStore(farSelector);
  const [over, setOver] = React.useState(false);
  const file = board.fileOf(data.path);
  const Icon = KIND_ICON[file?.kind ?? 'other'];
  return (
    <div className="h-full w-full" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <ActionBar id={id} file={file} />
      <NodeResizer isVisible={selected && !board.readOnly} minWidth={160} keepAspectRatio={file?.kind !== 'audio'} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      <Frame id={id} selected={selected} icon={Icon} title={file?.name ?? data.path.split('/').pop() ?? data.path} meta={sizeOf(file)} by={data.by}>
        <div className="relative w-full" style={aspectOf(file)}>
          {far ? <Outline icon={Icon} />
            : file ? <Shown file={file} play={over || selected} />
              : <div className="flex h-full w-full items-center justify-center gap-2 px-3 text-center text-[12px] text-[var(--cv-label)]"><FileQuestion size={14} />{t('canvas.missing')}</div>}
        </div>
      </Frame>
    </div>
  );
}

/** Words on the board ("Text"): a double click writes in it (a new one is written at once); clicking away is done. */
export function NoteNodeView({ id, data, selected }: NodeProps<NoteNode>) {
  const t = useT();
  const board = useBoard();
  const far = useStore(farSelector);
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
  return (
    <div className="h-full w-full" onDoubleClick={() => { if (!board.readOnly) board.edit(id); }}>
      <NodeResizer isVisible={selected && !board.readOnly} minWidth={160} minHeight={80} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      <Frame id={id} selected={selected || editing} icon={TypeIcon} title={t('canvas.kinds.note')} by={data.by}>
        {editing ? (
          <textarea
            autoFocus
            /* written on where it ends */
            onFocus={(event) => { const end = event.currentTarget.value.length; event.currentTarget.setSelectionRange(end, end); }}
            value={data.text}
            onChange={(event) => board.setData(id, { text: event.target.value })}
            onBlur={() => board.edit(null)}
            onKeyDown={(event) => { if (event.key === 'Escape') event.currentTarget.blur(); }}
            placeholder={hint}
            className="nodrag nowheel h-full w-full resize-none bg-transparent px-4 py-3.5 text-[13.5px] leading-[1.65] text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-label)]"
          />
        ) : far ? <Outline icon={TypeIcon} /> : (
          <div className={`h-full w-full overflow-hidden whitespace-pre-wrap break-words px-4 py-3.5 text-[13.5px] leading-[1.65] ${data.text ? 'text-[var(--cv-ink)]' : 'text-[var(--cv-label)]'}`}>
            {data.text || hint}
          </div>
        )}
      </Frame>
    </div>
  );
}

/** A group: a faint tint round what is in it, its name in a chip above (a double click renames it). */
export function FrameNodeView({ id, data, selected }: NodeProps<FrameNode>) {
  const t = useT();
  const board = useBoard();
  const editing = board.editing === id;
  const paint = FRAME_COLOR[data.color];
  return (
    <div className="relative h-full w-full rounded-[22px] border transition-[border-color] duration-150"
      style={{ borderColor: selected ? 'var(--cv-ring)' : paint.line, background: paint.fill }}>
      <NodeResizer isVisible={selected && !board.readOnly} minWidth={160} minHeight={120} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      <div className="absolute -top-11 left-0 flex h-8 max-w-full items-center gap-1.5" onDoubleClick={(event) => { event.stopPropagation(); if (!board.readOnly) board.edit(id); }}>
        {editing ? (
          <input
            autoFocus
            defaultValue={data.label}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => { board.setData(id, { label: event.currentTarget.value.trim() || t('canvas.group') }); board.edit(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur(); }}
            className="nodrag h-8 w-[220px] rounded-lg border border-[var(--cv-float-line)] bg-[var(--cv-float)] px-2.5 text-[14px] font-medium text-[var(--cv-ink)] outline-none"
          />
        ) : (
          <span className="truncate rounded-lg px-3 py-[5px] text-[14px] font-medium leading-tight text-white/90" style={{ background: paint.chip }}>{data.label || t('canvas.group')}</span>
        )}
        {board.makesIn(id) && !editing && !board.readOnly ? (
          <Tooltip label={t('canvas.makeAllTip')}>
            <button type="button" disabled={board.busyIn(id)} onClick={() => board.makeAll(id)}
              className="nodrag flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--cv-float-line)] bg-[var(--cv-float)] px-2.5 text-[12.5px] font-medium text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)] disabled:opacity-60">
              {board.busyIn(id) ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} />}{t('canvas.makeAll')}
            </button>
          </Tooltip>
        ) : null}
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
  const [over, setOver] = React.useState(false);
  const [versionsOpen, setVersionsOpen] = React.useState(false);
  const run = board.run(id);
  const Icon = MAKE_ICON[data.make];
  const media = MAKE_MEDIA[data.make];
  const versions = data.versions ?? [];
  const file = data.path ? board.fileOf(data.path) : null;
  const ratio = data.opts?.ratio ?? '16:9';
  const box = file ? aspectOf(file) : media === 'audio' ? { height: 132 } : aspectOf(null, ratio);
  React.useEffect(() => { if (!selected) setVersionsOpen(false); }, [selected]);
  const meta = sizeOf(file) ?? (media === 'audio' ? null : ratio);
  return (
    <div className="h-full w-full" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <ActionBar id={id} file={file} />
      <MakePanel id={id} data={data} />
      <NodeResizer isVisible={selected && !board.readOnly} minWidth={200} keepAspectRatio={media !== 'audio'} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      <Frame id={id} selected={selected} icon={Icon} title={t(`canvas.make.${data.make}`)} meta={meta} by={data.by} stack={versions.length}
        ins={media !== 'audio'} tone={file ? 'card' : 'quiet'}
        note={board.stale.has(id) ? <span className="pointer-events-auto shrink-0 text-amber-500/90" title={t('canvas.make.staleTip')}>{t('canvas.make.stale')}</span> : null}>
        <div className="relative w-full" style={box}>
          {far ? <Outline icon={Icon} />
            : file ? <Shown file={file} play={over || selected} />
              : (
                <div className="flex h-full w-full flex-col">
                  <div className="flex flex-1 items-center justify-center text-[var(--cv-ghost)]"><Icon size={media === 'audio' ? 30 : 46} /></div>
                  {board.readOnly ? null : (
                    <div className="flex flex-col items-start px-2.5 pb-2.5">
                      <span className="mb-0.5 px-2 text-[11.5px] text-[var(--cv-label)] opacity-80">{t('canvas.try.title')}</span>
                      {media !== 'audio' ? <TryLine icon={ImageIcon} label={t('canvas.try.fromPicture')} onClick={() => board.upload(id, 'input')} /> : null}
                      <TryLine icon={Upload} label={t(`canvas.try.upload.${media}`)} onClick={() => board.upload(id, 'version')} />
                    </div>
                  )}
                </div>
              )}
          {file && !far ? <span className="pointer-events-none absolute left-2.5 top-2.5 rounded-md border border-white/35 bg-black/25 px-1.5 py-[2px] text-[10.5px] leading-none text-white/85 backdrop-blur-sm">{t('canvas.make.ai')}</span> : null}
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

/** A cut: what is wired into it, as a strip of its shots numbered in their order, to go onto the timeline in that order. */
export function CutNodeView({ id, data, selected }: NodeProps<CutNode>) {
  const t = useT();
  const board = useBoard();
  const far = useStore(farSelector);
  const shots = board.inputs(id).filter((i) => i.path);
  const seconds = Math.round(shots.reduce((sum, i) => sum + (board.fileOf(i.path!)?.durationMs ?? 0), 0) / 1000);
  const meta = shots.length ? t('canvas.cut.count').replace('{n}', String(shots.length)) + (seconds ? ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '') : null;
  return (
    <div className="h-full w-full">
      <CutPanel id={id} count={shots.length} />
      <Frame id={id} selected={selected} icon={Scissors} title={t('canvas.kinds.cut')} meta={meta} by={data.by} outs={false} tone={shots.length ? 'card' : 'quiet'}>
        {far ? <Outline icon={Scissors} style={{ aspectRatio: '16 / 7' }} />
          : shots.length ? (
            <div className="nowheel flex gap-1.5 overflow-x-auto p-2.5">
              {shots.map((shot, i) => {
                const file = board.fileOf(shot.path!);
                const thumb = file ? (file.kind === 'image' ? board.sources.file(file) : board.sources.poster?.(file)) : undefined;
                return (
                  <div key={shot.edge} className="relative aspect-video w-[88px] shrink-0 overflow-hidden rounded-lg bg-[var(--cv-card-2)]">
                    {thumb ? <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover" />
                      : <span className="flex h-full w-full items-center justify-center text-[var(--cv-ghost)]">{file?.kind === 'audio' ? <Music size={16} /> : <Video size={16} />}</span>}
                    <span className="absolute left-1 top-1 flex h-4 min-w-4 items-center justify-center rounded bg-black/55 px-1 text-[10px] font-medium text-white backdrop-blur-sm">{i + 1}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex w-full flex-col items-center justify-center gap-2.5 px-8 py-7 text-center text-[12.5px] leading-relaxed text-[var(--cv-label)]">
              <Scissors size={30} className="text-[var(--cv-ghost)]" />
              {t('canvas.cut.empty')}
            </div>
          )}
      </Frame>
    </div>
  );
}

export const NODE_TYPES = { file: FileNodeView, note: NoteNodeView, frame: FrameNodeView, make: MakeNodeView, cut: CutNodeView };
