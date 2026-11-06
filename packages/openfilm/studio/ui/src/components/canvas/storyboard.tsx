/**
 * The board as its storyboard: the film's shots in order, a row each — what it is (the words wired in), its picture,
 * its clip, how long — so the whole film is read at a glance, each shot made where it stands (its picture, then its
 * clip from it), all of them made in order, and their clips put on the timeline in that order at once.
 *
 * A shot is a node that makes a clip (or a clip on the board), or a picture that no clip is made from yet; its order
 * is a cut's, when the board has one (what is wired into it, in order), else where it stands (top to bottom, then
 * left to right).
 */
import React from 'react';
import type { Edge } from '@xyflow/react';
import { Clapperboard, Film, Image as ImageIcon, LayoutTemplate, LocateFixed, MessageSquare, Play, Square } from 'lucide-react';
import { useT } from '@/i18n';
import { lengthOf } from '@/lib/canvas';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import { useBoard, type BoardNode } from './board';
import { Words } from './words';

interface Shot {
  key: string;
  /** the node that makes (or is) its picture, and its clip */
  picture: BoardNode | null;
  clip: BoardNode | null;
  words: string[];
  seconds: number | null;
}

/** a character's pictures (lib/canvas-presets): sheets to make shots with, not shots */
const CHARACTER_SHEETS = new Set(['portrait', 'fullBody', 'expressions', 'turnaround16', 'turnaround', 'faces', 'character']);
const pathOf = (n: BoardNode | null) => (!n ? undefined : n.type === 'file' ? n.data.path : n.type === 'make' ? n.data.path : undefined);
const isClip = (n: BoardNode, fileOf: (p: string) => WorkspaceResource | null) => (n.type === 'make' && n.data.make === 'video') || (n.type === 'file' && fileOf(n.data.path)?.kind === 'video');
const isPicture = (n: BoardNode, fileOf: (p: string) => WorkspaceResource | null) => (n.type === 'make' && n.data.make === 'image') || (n.type === 'file' && fileOf(n.data.path)?.kind === 'image');

/** the board's shots, in the film's order */
export function shotsOf(nodes: readonly BoardNode[], edges: readonly Edge[], fileOf: (p: string) => WorkspaceResource | null): Shot[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const into = (id: string) => edges.filter((e) => e.target === id).map((e) => byId.get(e.source)).filter((n): n is BoardNode => Boolean(n));
  const out = (id: string) => edges.filter((e) => e.source === id).map((e) => byId.get(e.target)).filter((n): n is BoardNode => Boolean(n));
  /* where a node is on the board: a group's own corner added */
  const at = (n: BoardNode) => { const g = n.parentId ? byId.get(n.parentId) : undefined; return { x: n.position.x + (g?.position.x ?? 0), y: n.position.y + (g?.position.y ?? 0) }; };
  const wordsOf = (n: BoardNode | null) => (n ? into(n.id).flatMap((i) => (i.type === 'note' && i.data.text.trim() ? [i.data.text.trim()] : [])) : []);
  /* a cut on the board says what the film's shots are, in its order; else each clip, and each picture made for a shot
     that no clip is made from yet (not a character's sheets, not pictures brought in), where they stand */
  const cut = nodes.find((n) => n.type === 'cut' && edges.some((e) => e.target === n.id));
  const cutOrder = cut ? edges.filter((e) => e.target === cut.id).sort((a, b) => ((a.data?.order as number) ?? 0) - ((b.data?.order as number) ?? 0)).map((e) => e.source) : [];
  const heads = cut ? cutOrder.map((id) => byId.get(id)).filter((n): n is BoardNode => Boolean(n) && (isClip(n!, fileOf) || isPicture(n!, fileOf)))
    : nodes.filter((n) => isClip(n, fileOf)
      || (n.type === 'make' && n.data.make === 'image' && !CHARACTER_SHEETS.has(n.data.preset ?? '') && !out(n.id).some((o) => isClip(o, fileOf))));
  const sorted = cut ? heads : [...heads].sort((a, b) => (Math.abs(at(a).y - at(b).y) > 120 ? at(a).y - at(b).y : at(a).x - at(b).x));
  return sorted.map((head) => {
    const clip = isClip(head, fileOf) ? head : null;
    const picture = clip ? into(clip.id).find((i) => isPicture(i, fileOf)) ?? null : head;
    const words = [...new Set([...wordsOf(picture), ...wordsOf(clip)])];
    const own = (n: BoardNode | null) => (n?.type === 'make' && n.data.prompt?.trim() ? [n.data.prompt.trim()] : []);
    const seconds = clip?.type === 'make' ? lengthOf('video', clip.data.opts?.sec, undefined) : clip?.type === 'file' ? (fileOf(clip.data.path)?.durationMs ?? 0) / 1000 || null : null;
    return { key: head.id, picture, clip, words: words.length ? words : [...own(picture), ...own(clip)], seconds };
  });
}

export function Storyboard({ nodes, edges, fileOf, sources, onShowOnBoard, onMake, onToTimeline, onTemplate, onAskAgent }: {
  nodes: readonly BoardNode[];
  edges: readonly Edge[];
  fileOf: (path: string) => WorkspaceResource | null;
  sources: MediaSources;
  onShowOnBoard: (id: string) => void;
  /** the nodes made one after another (a shot's picture, then its clip) */
  onMake: (ids: string[]) => Promise<void>;
  onToTimeline: (files: WorkspaceResource[]) => void;
  /** a storyboard laid down to start from; the agent asked to write one (in the app with a chat) */
  onTemplate: () => void;
  onAskAgent?: () => void;
}) {
  const t = useT();
  const board = useBoard();
  const [busy, setBusy] = React.useState(false);
  const shots = shotsOf(nodes, edges, fileOf);
  const thumb = (n: BoardNode | null) => {
    const path = pathOf(n);
    const file = path ? fileOf(path) : null;
    return !file ? undefined : file.kind === 'image' ? sources.file(file) : file.kind === 'video' ? sources.poster?.(file) : undefined;
  };
  /* what a shot still has to make: its picture when it has none, then its clip */
  const toMake = (shot: Shot) => [shot.picture, shot.clip].filter((n): n is BoardNode => n?.type === 'make' && (!n.data.path || board.stale.has(n.id))).map((n) => n.id);
  const clips = shots.flatMap((s) => { const path = pathOf(s.clip); const file = path ? fileOf(path) : null; return file ? [file] : []; });
  const running = shots.some((s) => [s.picture, s.clip].some((n) => n && board.run(n.id)));
  const total = shots.reduce((sum, s) => sum + (s.seconds ?? 0), 0);
  const makeAll = async () => { setBusy(true); try { await onMake(shots.flatMap(toMake)); } finally { setBusy(false); } };

  const cell = 'relative block aspect-video w-full overflow-hidden rounded-[10px] bg-[var(--cv-card)] ring-1 ring-[var(--cv-float-line)]';
  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-[var(--cv-bg)] pt-14">
      <div className="flex items-center gap-3 px-6 pb-3">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-[var(--cv-ink)]">{t('canvas.storyboard.title')}</div>
          <div className="text-[12px] text-[var(--cv-ink-3)]">
            {shots.length ? t('canvas.storyboard.count').replace('{n}', String(shots.length)).replace('{s}', String(Math.round(total))) : t('canvas.storyboard.what')}
          </div>
        </div>
        <span className="flex-1" />
        {shots.length ? (
          <>
            <button type="button" disabled={busy || running || !shots.some((s) => toMake(s).length)} onClick={() => { void makeAll(); }}
              className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-chip)] px-4 text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)] disabled:opacity-40">
              <Play size={12} />{t('canvas.storyboard.makeAll')}
            </button>
            <button type="button" disabled={!clips.length} onClick={() => onToTimeline(clips)}
              className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:opacity-40">
              <Clapperboard size={13} />{t('canvas.storyboard.toTimeline').replace('{n}', String(clips.length))}
            </button>
          </>
        ) : null}
      </div>
      {shots.length ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-24">
          <div className="grid grid-cols-[56px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_120px] gap-x-4 border-b !border-[var(--cv-float-line)] pb-2 text-[11.5px] text-[var(--cv-ink-3)]">
            <span>{t('canvas.storyboard.cols.shot')}</span><span>{t('canvas.storyboard.cols.words')}</span><span>{t('canvas.storyboard.cols.picture')}</span><span>{t('canvas.storyboard.cols.clip')}</span><span />
          </div>
          {shots.map((shot, i) => {
            const left = toMake(shot);
            const run = [shot.picture, shot.clip].find((n) => n && board.run(n.id));
            /* what failed last, until it is made again */
            const error = run ? undefined : [shot.picture, shot.clip].map((n) => (n ? board.error(n.id) : undefined)).find(Boolean);
            const clipPath = pathOf(shot.clip);
            const clipFile = clipPath ? fileOf(clipPath) : null;
            return (
              <div key={shot.key} className="grid grid-cols-[56px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_120px] items-start gap-x-4 border-b !border-[var(--cv-float-line)] py-4">
                <div className="pt-1">
                  <div className="text-[20px] font-semibold leading-none text-[var(--cv-ink)]">{String(i + 1).padStart(2, '0')}</div>
                  {shot.seconds ? <div className="mt-1.5 text-[11.5px] text-[var(--cv-ink-3)]">{t('canvas.make.seconds').replace('{n}', String(Math.round(shot.seconds)))}</div> : null}
                </div>
                <div className="max-h-[132px] overflow-hidden text-[12.5px] leading-relaxed text-[var(--cv-ink-2)]">
                  {shot.words.length ? <Words text={shot.words.join('\n\n')} /> : <span className="text-[var(--cv-ink-3)]">{t('canvas.storyboard.noWords')}</span>}
                </div>
                <button type="button" onClick={() => shot.picture && onShowOnBoard(shot.picture.id)} className={cell} title={t('canvas.storyboard.showOnBoard')}>
                  {thumb(shot.picture) ? <img src={thumb(shot.picture)} alt="" className="h-full w-full object-cover" />
                    : <span className="flex h-full w-full items-center justify-center text-[var(--cv-ghost)]"><ImageIcon size={20} /></span>}
                  {shot.picture && board.run(shot.picture.id) ? <span className="absolute inset-0 flex items-center justify-center bg-black/40"><span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /></span> : null}
                </button>
                <div className={cell}>
                  {clipFile ? <video src={sources.file(clipFile)} poster={sources.poster?.(clipFile)} controls preload="metadata" className="h-full w-full object-cover" />
                    : <span className="flex h-full w-full items-center justify-center text-[var(--cv-ghost)]"><Film size={20} /></span>}
                  {shot.clip && board.run(shot.clip.id) ? <span className="absolute inset-0 flex items-center justify-center bg-black/40"><span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /></span> : null}
                </div>
                <div className="flex flex-col items-stretch gap-1.5">
                  {run ? (
                    <button type="button" onClick={() => board.stop(run.id)} className="flex h-8 items-center justify-center gap-1.5 rounded-full bg-[var(--cv-chip)] text-[12.5px] text-[var(--cv-ink)]"><Square size={10} fill="currentColor" />{t('canvas.make.stop')}</button>
                  ) : (
                    <button type="button" disabled={!left.length || busy} onClick={() => { void onMake(left); }}
                      className="flex h-8 items-center justify-center gap-1.5 rounded-full bg-[var(--cv-chip)] text-[12.5px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)] disabled:opacity-35">
                      <Play size={11} />{t(left.length ? 'canvas.storyboard.make' : 'canvas.storyboard.made')}
                    </button>
                  )}
                  <button type="button" onClick={() => onShowOnBoard((shot.clip ?? shot.picture)!.id)}
                    className="flex h-8 items-center justify-center gap-1.5 rounded-full text-[12.5px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
                    <LocateFixed size={12} />{t('canvas.storyboard.showOnBoard')}
                  </button>
                  {error ? <div className="select-text text-[11.5px] leading-snug text-red-500">{error}</div> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-24 text-center">
          <Clapperboard size={30} className="text-[var(--cv-ink-3)]" />
          <div className="max-w-[440px] text-[13px] leading-relaxed text-[var(--cv-ink-2)]">{t('canvas.storyboard.empty')}</div>
          <div className="flex items-center gap-2">
            {onAskAgent ? (
              <button type="button" onClick={onAskAgent} className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90">
                <MessageSquare size={13} />{t('canvas.storyboard.askAgent')}
              </button>
            ) : null}
            <button type="button" onClick={onTemplate} className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-chip)] px-4 text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
              <LayoutTemplate size={13} />{t('canvas.storyboard.fromTemplate')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
