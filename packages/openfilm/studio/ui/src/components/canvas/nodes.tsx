/**
 * The canvas's nodes: each a clean card with its name above it (what it is, on the left; its size, on the right), a ⊕
 * on each side (the right one makes something from it, the left one brings something into it; dragged, a wire), and
 * only what it shows inside. What a node is asked and made with is in its panel, under it while it is the one
 * selected (panels.tsx); what can be done with it, in a bar over it.
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
const RESIZE_HANDLE = '!h-2 !w-2 !rounded-sm !border !border-[var(--text)] !bg-[var(--dock-pane)]';

/** A group's frame and its name's chip, by its color. */
export const FRAME_COLOR: Record<GroupColor, { line: string; fill: string; chip: string }> = {
  gray: { line: 'rgba(160,160,160,0.45)', fill: 'rgba(160,160,160,0.06)', chip: 'rgb(110,110,110)' },
  red: { line: 'rgba(239,68,68,0.5)', fill: 'rgba(239,68,68,0.07)', chip: 'rgb(185,48,48)' },
  orange: { line: 'rgba(249,115,22,0.5)', fill: 'rgba(249,115,22,0.07)', chip: 'rgb(194,88,20)' },
  yellow: { line: 'rgba(234,179,8,0.5)', fill: 'rgba(234,179,8,0.07)', chip: 'rgb(161,123,8)' },
  green: { line: 'rgba(34,197,94,0.5)', fill: 'rgba(34,197,94,0.07)', chip: 'rgb(28,140,70)' },
  blue: { line: 'rgba(59,130,246,0.5)', fill: 'rgba(59,130,246,0.07)', chip: 'rgb(45,100,200)' },
  purple: { line: 'rgba(168,85,247,0.5)', fill: 'rgba(168,85,247,0.07)', chip: 'rgb(126,62,190)' },
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

const SIDE = '!flex !h-[26px] !w-[26px] items-center justify-center !rounded-full !border !border-[var(--border-strong)] !bg-[var(--dock-pane)] !text-[var(--text-muted)] shadow-[0_2px_8px_rgba(0,0,0,0.25)] transition-opacity hover:!text-[var(--text)]';

/** A node's two ⊕: the left one brings something into it, the right one makes something from it; dragged, a wire. */
function Sides({ id, selected, ins = true, outs = true }: { id: string; selected: boolean; ins?: boolean; outs?: boolean }) {
  const board = useBoard();
  const t = useT();
  const shown = board.readOnly ? 'pointer-events-none !opacity-0' : selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100';
  const side = (which: 'source' | 'target') => (event: React.MouseEvent) => {
    event.stopPropagation();
    board.sideMenu(id, which, { x: event.clientX, y: event.clientY });
  };
  return (
    <>
      <Handle type="target" position={Position.Left} className={`${SIDE} !-left-[22px] ${ins ? shown : 'pointer-events-none !opacity-0'}`} onClick={side('target')}
        title={t('canvas.side.in')}>
        <Plus size={14} className="pointer-events-none" />
      </Handle>
      <Handle type="source" position={Position.Right} className={`${SIDE} !-right-[22px] ${outs ? shown : 'pointer-events-none !opacity-0'}`} onClick={side('source')}
        title={t('canvas.side.out')}>
        <Plus size={14} className="pointer-events-none" />
      </Handle>
    </>
  );
}

/** What every node is drawn in: its name row above, its card, its two ⊕. */
function Frame({ id, selected, icon: Icon, title, meta, by, note, stack = 0, children, ins, outs }: {
  id: string; selected: boolean; icon: React.ComponentType<{ size?: number; className?: string }>; title: string; meta?: string | null;
  by?: CanvasNode['by']; note?: React.ReactNode; stack?: number; children: React.ReactNode; ins?: boolean; outs?: boolean;
}) {
  const far = useStore(farSelector);
  return (
    <div className="group relative h-full w-full">
      {far ? null : (
        <div className={`pointer-events-none absolute bottom-full left-0 right-0 z-10 flex items-center gap-1.5 text-[12px] text-[var(--text-faint)] ${stack > 1 ? 'mb-3.5' : 'mb-1.5'}`}>
          <Icon size={13} className="shrink-0" />
          <span className="truncate">{title}</span>
          <span className="flex-1" />
          {note}
          {by ? <ByAgent by={by} /> : null}
          {meta ? <span className="shrink-0 tabular-nums">{meta}</span> : null}
        </div>
      )}
      {/* more than one version: the others behind it, as a stack of cards */}
      {stack > 1 ? (
        <>
          <div className="absolute inset-0 translate-x-[10px] -translate-y-[8px] rotate-[3deg] rounded-[12px] bg-[var(--surface-2)] ring-1 ring-[var(--border)]" />
          {stack > 2 ? <div className="absolute inset-0 translate-x-[5px] -translate-y-[4px] rotate-[1.5deg] rounded-[12px] bg-[var(--surface-2)] ring-1 ring-[var(--border)]" /> : null}
        </>
      ) : null}
      <div className={`relative h-full w-full overflow-hidden rounded-[12px] bg-[var(--surface)] ${selected ? 'ring-[1.5px] ring-[var(--text-muted)]' : 'ring-1 ring-[var(--border)]'}`}>
        {children}
      </div>
      <Sides id={id} selected={selected} ins={ins} outs={outs} />
    </div>
  );
}

/** A file shown in a card: a picture as it is, a clip's poster (playing under the pointer or while selected), a sound's player. */
function Shown({ file, play }: { file: WorkspaceResource; play: boolean }) {
  const board = useBoard();
  const src = board.sources.file(file);
  const poster = board.sources.poster?.(file);
  if (file.kind === 'image') return <img src={src} alt="" draggable={false} loading="lazy" className="block h-full w-full bg-black object-contain" />;
  if (file.kind === 'video') {
    return play || !poster
      ? <video src={src} poster={poster} muted loop playsInline autoPlay={play} preload="metadata" className="block h-full w-full bg-black object-contain" />
      : <img src={poster} alt="" draggable={false} className="block h-full w-full bg-black object-contain" />;
  }
  if (file.kind === 'audio') {
    return (
      <div className="flex h-full w-full items-center gap-2 px-3">
        <Music size={16} className="shrink-0 text-[var(--text-faint)]" />
        <audio src={src} controls preload="none" className="nodrag h-8 min-w-0 flex-1" />
      </div>
    );
  }
  const page = file.kind === 'mg' ? board.sources.pagePoster?.(file) : undefined;
  return page
    ? <img src={page} alt="" draggable={false} className="block h-full w-full bg-black object-contain" />
    : <div className="flex h-full w-full items-center justify-center text-[var(--text-faint)]"><Clapperboard size={22} /></div>;
}

/** The box a file is drawn in: its own shape (a picture, a clip), a strip for a sound. */
function aspectOf(file: WorkspaceResource | null, ratio?: string): React.CSSProperties {
  if (file?.kind === 'audio') return { height: 72 };
  if (file?.w && file.h) return { aspectRatio: `${file.w} / ${file.h}` };
  const [w, h] = (ratio ?? '16:9').split(':').map(Number) as [number, number];
  return { aspectRatio: `${w} / ${h}` };
}

/** A quick start in an empty node ("Try:"), as a line with its icon. */
function TryLine({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ size?: number }>; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={(event) => { event.stopPropagation(); onClick(); }}
      className="nodrag flex h-7 items-center gap-2 rounded-md px-1.5 text-[12.5px] text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
      <Icon size={14} />{label}
    </button>
  );
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
          {far ? <div className="flex h-full w-full items-center justify-center bg-[var(--surface-2)] text-[var(--text-faint)]"><Icon size={28} /></div>
            : file ? <Shown file={file} play={over || selected} />
              : <div className="flex h-full w-full items-center justify-center gap-2 px-3 text-center text-[12px] text-[var(--text-faint)]"><FileQuestion size={14} />{t('canvas.missing')}</div>}
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
            placeholder={t('canvas.notePlaceholder')}
            className="nodrag nowheel h-full w-full resize-none bg-transparent p-3.5 text-[13.5px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]"
          />
        ) : far ? null : (
          <div className={`h-full w-full overflow-hidden whitespace-pre-wrap break-words p-3.5 text-[13.5px] leading-relaxed ${data.text ? 'text-[var(--text)]' : 'text-[var(--text-faint)]'}`}>
            {data.text || t('canvas.notePlaceholder')}
          </div>
        )}
      </Frame>
    </div>
  );
}

/** A group: a tinted frame round what is in it, its name in a chip above (a double click renames it). */
export function FrameNodeView({ id, data, selected }: NodeProps<FrameNode>) {
  const t = useT();
  const board = useBoard();
  const editing = board.editing === id;
  const paint = FRAME_COLOR[data.color];
  return (
    <div className="relative h-full w-full rounded-[16px] border-2" style={{ borderColor: selected ? 'var(--text)' : paint.line, background: paint.fill }}>
      <NodeResizer isVisible={selected && !board.readOnly} minWidth={160} minHeight={120} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      <div className="absolute left-0 -top-10 flex h-8 max-w-full items-center" onDoubleClick={(event) => { event.stopPropagation(); if (!board.readOnly) board.edit(id); }}>
        {editing ? (
          <input
            autoFocus
            defaultValue={data.label}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={(event) => { board.setData(id, { label: event.currentTarget.value.trim() || t('canvas.group') }); board.edit(null); }}
            onKeyDown={(event) => { if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur(); }}
            className="nodrag h-8 w-[220px] rounded-lg bg-[var(--surface)] px-2.5 text-[14px] font-medium text-[var(--text)] outline-none"
          />
        ) : (
          <span className="truncate rounded-lg px-3 py-1 text-[14px] font-medium text-white" style={{ background: paint.chip }}>{data.label || t('canvas.group')}</span>
        )}
        {board.makesIn(id) && !editing && !board.readOnly ? (
          <Tooltip label={t('canvas.makeAllTip')}>
            <button type="button" disabled={board.busyIn(id)} onClick={() => board.makeAll(id)}
              className="nodrag ml-1.5 flex h-8 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12.5px] font-medium text-white disabled:opacity-60" style={{ background: paint.chip }}>
              {board.busyIn(id) ? <Loader2 size={12} className="animate-spin" /> : <Play size={11} />}{t('canvas.makeAll')}
            </button>
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A node that makes something: what it made (its versions stacked, the one shown on top), or, empty, a placeholder
 * and what to start with. Being made, it says how long it has been at it.
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
  const box = file ? aspectOf(file) : media === 'audio' ? { height: 120 } : aspectOf(null, ratio);
  React.useEffect(() => { if (!selected) setVersionsOpen(false); }, [selected]);
  const meta = sizeOf(file) ?? (media === 'audio' ? null : ratio);
  return (
    <div className="h-full w-full" onMouseEnter={() => setOver(true)} onMouseLeave={() => setOver(false)}>
      <ActionBar id={id} file={file} />
      <MakePanel id={id} data={data} />
      <NodeResizer isVisible={selected && !board.readOnly} minWidth={200} keepAspectRatio={media !== 'audio'} lineClassName="!border-transparent"
        handleClassName={RESIZE_HANDLE} onResizeStart={board.willChange} />
      <Frame id={id} selected={selected} icon={Icon} title={t(`canvas.make.${data.make}`)} meta={meta} by={data.by} stack={versions.length}
        ins={media !== 'audio'}
        note={board.stale.has(id) ? <span className="pointer-events-auto shrink-0 text-amber-500" title={t('canvas.make.staleTip')}>{t('canvas.make.stale')}</span> : null}>
        <div className="relative w-full" style={box}>
          {far ? (
            <div className="flex h-full w-full items-center justify-center bg-[var(--surface-2)] text-[var(--text-faint)]"><Icon size={28} /></div>
          ) : file ? (
            <Shown file={file} play={over || selected} />
          ) : (
            <div className="flex h-full w-full flex-col">
              <div className="flex flex-1 items-center justify-center text-[var(--border-strong)]"><Icon size={media === 'audio' ? 30 : 44} /></div>
              {board.readOnly ? null : (
                <div className="flex flex-col items-start px-3 pb-3">
                  <span className="mb-0.5 px-1.5 text-[11.5px] text-[var(--text-faint)]">{t('canvas.try.title')}</span>
                  {media === 'image' ? <TryLine icon={Upload} label={t('canvas.try.fromPicture')} onClick={() => board.upload(id, 'input')} /> : null}
                  {media === 'video' ? <TryLine icon={ImageIcon} label={t('canvas.try.fromPicture')} onClick={() => board.upload(id, 'input')} /> : null}
                  <TryLine icon={Upload} label={t(`canvas.try.upload.${media}`)} onClick={() => board.upload(id, 'version')} />
                </div>
              )}
            </div>
          )}
          {file && !far ? <span className="pointer-events-none absolute left-2.5 top-2.5 rounded border border-white/40 bg-black/30 px-1.5 py-px text-[10.5px] text-white/85">{t('canvas.make.ai')}</span> : null}
          {versions.length > 1 && !far && !board.readOnly ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); setVersionsOpen((v) => !v); }}
              className="nodrag absolute right-2.5 top-2.5 flex h-7 items-center gap-1 rounded-lg bg-black/60 px-2 text-[12px] text-white backdrop-blur-sm hover:bg-black/75">
              <Layers size={13} />{t('canvas.versions').replace('{n}', String(versions.length))}
            </button>
          ) : null}
          {versionsOpen ? (
            <div className="nodrag nowheel absolute right-2.5 top-11 z-10 grid max-h-[70%] grid-cols-3 gap-1.5 overflow-y-auto rounded-xl bg-black/75 p-1.5 backdrop-blur-sm">
              {versions.map((path, i) => {
                const version = board.fileOf(path);
                const thumb = version ? (version.kind === 'image' ? board.sources.file(version) : board.sources.poster?.(version)) : undefined;
                return (
                  <button key={path} type="button" title={t('canvas.make.version').replace('{n}', String(i + 1)).replace('{total}', String(versions.length))}
                    onClick={() => { board.willChange(); board.setData(id, { path }); setVersionsOpen(false); }}
                    className={`relative h-12 w-16 overflow-hidden rounded-md ring-2 ${path === data.path ? 'ring-white' : 'ring-transparent hover:ring-white/40'}`}>
                    {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full w-full items-center justify-center text-white/60"><Icon size={14} /></span>}
                    <span className="absolute bottom-0.5 left-1 text-[10px] text-white drop-shadow">{i + 1}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
          {run ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 text-[12.5px] text-white">
              <Loader2 size={18} className="animate-spin" />
              <span>{t('canvas.make.making')} <Elapsed since={run.started} /></span>
              <button type="button" onClick={(event) => { event.stopPropagation(); board.stop(id); }}
                className="nodrag flex h-7 items-center gap-1 rounded-md border border-white/30 px-2.5 text-[12px] hover:bg-white/10">
                <Square size={10} />{t('canvas.make.stop')}
              </button>
            </div>
          ) : null}
        </div>
      </Frame>
    </div>
  );
}

/** A cut: what is wired into it, numbered in its order, to go onto the timeline in that order. */
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
      <Frame id={id} selected={selected} icon={Scissors} title={t('canvas.kinds.cut')} meta={meta} by={data.by} outs={false}>
        {far ? <div className="flex aspect-video w-full items-center justify-center bg-[var(--surface-2)] text-[var(--text-faint)]"><Scissors size={28} /></div>
          : shots.length ? (
            <div className="grid grid-cols-3 gap-1.5 p-2">
              {shots.slice(0, 9).map((shot, i) => {
                const file = board.fileOf(shot.path!);
                const thumb = file ? (file.kind === 'image' ? board.sources.file(file) : board.sources.poster?.(file)) : undefined;
                return (
                  <div key={shot.edge} className="relative aspect-video overflow-hidden rounded-md bg-black">
                    {thumb ? <img src={thumb} alt="" draggable={false} className="h-full w-full object-cover" />
                      : <span className="flex h-full w-full items-center justify-center text-white/50">{file?.kind === 'audio' ? <Music size={14} /> : <Video size={14} />}</span>}
                    <span className="absolute left-1 top-0.5 text-[10.5px] font-medium text-white drop-shadow">{i + 1}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 px-6 text-center text-[12.5px] text-[var(--text-faint)]">
              <Scissors size={30} className="text-[var(--border-strong)]" />
              {t('canvas.cut.empty')}
            </div>
          )}
      </Frame>
    </div>
  );
}

export const NODE_TYPES = { file: FileNodeView, note: NoteNodeView, frame: FrameNodeView, make: MakeNodeView, cut: CutNodeView };
