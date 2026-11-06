/**
 * The board seen as its storyboard: what is on it as the project's material, by kind — words (scripts and the rest),
 * pictures (characters, places, things and the rest), clips, sounds — each a row of cards; one picked is shown large
 * beside them with what it was asked and with which model, made (again) from there, found on the board or put on
 * the timeline. In the app with a chat, the chat stands beside it: where the agent is asked for a script or shots.
 */
import React from 'react';
import { AlignLeft, AudioLines, Clapperboard, Film, Image as ImageIcon, LocateFixed, Play, RotateCcw, Square } from 'lucide-react';
import { useT } from '@/i18n';
import { presetOf } from '@/lib/canvas-presets';
import type { MediaSources, WorkspaceResource } from '@/lib/workspace-resources';
import { useBoard, type BoardNode } from './board';
import { Words } from './words';
import { Chip } from './libraries';

type Section = 'text' | 'image' | 'video' | 'audio';
/** what a picture is of, as the board says it: its preset, or a character's folder */
const CHARACTER_PRESETS = new Set(['portrait', 'fullBody', 'expressions', 'turnaround16', 'turnaround', 'faces', 'character']);

interface Item {
  id: string;
  section: Section;
  /** its group in the section ('script' | 'other'; 'character' | 'scene' | 'thing' | 'other'; 'clip') */
  kind: string;
  title: string;
  file: WorkspaceResource | null;
  text?: string;
  /** a making node's: what it is asked, and whether it can make one */
  prompt?: string;
  makes: boolean;
}

export function Storyboard({ nodes, fileOf, sources, chat, onShowOnBoard }: {
  nodes: readonly BoardNode[];
  fileOf: (path: string) => WorkspaceResource | null;
  sources: MediaSources;
  /** in the app with a chat: whether it is open beside the board */
  chat?: { open: boolean; toggle: () => void };
  onShowOnBoard: (id: string) => void;
}) {
  const t = useT();
  const board = useBoard();
  const [picked, setPicked] = React.useState<string | null>(null);
  const [kinds, setKinds] = React.useState<Record<Section, string>>({ text: 'all', image: 'all', video: 'all', audio: 'all' });
  /* the chat beside it, as the storyboard is worked with the agent */
  React.useEffect(() => { if (chat && !chat.open) chat.toggle(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  let n = 0;
  const items: Item[] = nodes.flatMap((node): Item[] => {
    if (node.type === 'frame') return [];
    n += 1;
    if (node.type === 'note') {
      if (!node.data.text.trim()) return [];
      const script = /^#{1,3}\s/m.test(node.data.text) || node.data.text.split('\n').filter((l) => l.trim()).length >= 4;
      return [{ id: node.id, section: 'text', kind: script ? 'script' : 'other', title: t('canvas.titles.note').replace('{n}', String(n)), file: null, text: node.data.text, makes: false }];
    }
    if (node.type === 'make') {
      const file = node.data.path ? fileOf(node.data.path) : null;
      const section: Section = node.data.make === 'image' ? 'image' : node.data.make === 'video' ? 'video' : 'audio';
      const preset = node.data.preset;
      const kind = section !== 'image' ? (section === 'video' ? 'clip' : 'other')
        : preset && CHARACTER_PRESETS.has(preset) ? 'character' : preset === 'scene' || preset === 'panorama' ? 'scene' : preset === 'product' ? 'thing' : 'other';
      const title = preset ? t(`canvas.presets.names.${preset}`) : t(`canvas.titles.${node.data.make}`).replace('{n}', String(n));
      return [{ id: node.id, section, kind, title, file, prompt: node.data.prompt, makes: true }];
    }
    if (node.type === 'file') {
      const file = fileOf(node.data.path);
      if (!file || (file.kind !== 'image' && file.kind !== 'video' && file.kind !== 'audio')) return [];
      const kind = file.kind === 'image' ? (file.path.startsWith('assets/characters/') ? 'character' : 'other') : file.kind === 'video' ? 'clip' : 'other';
      return [{ id: node.id, section: file.kind, kind, title: file.name, file, makes: false }];
    }
    return [];
  });
  const sections: Array<{ key: Section; icon: React.ReactNode; kinds: string[] }> = [
    { key: 'text', icon: <AlignLeft size={15} />, kinds: ['script', 'other'] },
    { key: 'image', icon: <ImageIcon size={15} />, kinds: ['character', 'scene', 'thing', 'other'] },
    { key: 'video', icon: <Film size={15} />, kinds: [] },
    { key: 'audio', icon: <AudioLines size={15} />, kinds: [] },
  ];
  const current = items.find((i) => i.id === picked) ?? null;
  const thumb = (file: WorkspaceResource | null) => (!file ? undefined : file.kind === 'image' ? sources.file(file) : file.kind === 'video' ? sources.poster?.(file) : undefined);
  const run = current ? board.run(current.id) : undefined;
  const error = current ? board.error(current.id) : undefined;
  return (
    <div className="absolute inset-0 z-10 flex bg-[var(--cv-bg)] pt-14">
      <div className="min-w-0 flex-1 overflow-y-auto px-6 pb-24">
        <div className="mb-4 text-[15px] font-semibold text-[var(--cv-ink)]">{t('canvas.storyboard.title')}</div>
        {items.length ? sections.map((section) => {
          const all = items.filter((i) => i.section === section.key);
          if (!all.length) return null;
          const on = kinds[section.key];
          const shown = all.filter((i) => on === 'all' || i.kind === on);
          return (
            <div key={section.key} className="mb-6">
              <div className="mb-2 flex items-center gap-2">
                <span className="flex items-center gap-1.5 text-[13px] font-medium text-[var(--cv-ink)]">{section.icon}{t(`canvas.storyboard.sections.${section.key}`)}</span>
                <span className="text-[12px] text-[var(--cv-ink-3)]">{all.length}</span>
                {section.kinds.length ? (
                  <span className="ml-2 flex items-center gap-0.5">
                    <Chip label={t('canvas.history.kinds.all')} count={all.length} on={on === 'all'} onClick={() => setKinds((k) => ({ ...k, [section.key]: 'all' }))} />
                    {section.kinds.map((kind) => (
                      <Chip key={kind} label={t(`canvas.storyboard.kinds.${kind}`)} count={all.filter((i) => i.kind === kind).length} on={on === kind}
                        onClick={() => setKinds((k) => ({ ...k, [section.key]: kind }))} />
                    ))}
                  </span>
                ) : null}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {shown.map((item) => {
                  const src = thumb(item.file);
                  return (
                    <button key={item.id} type="button" onClick={() => setPicked(item.id)} onDoubleClick={() => onShowOnBoard(item.id)}
                      className="group/sb flex w-[176px] shrink-0 flex-col gap-1.5 text-left">
                      <span className={`relative block h-[132px] w-full overflow-hidden rounded-[12px] bg-[var(--cv-card)] ring-2 transition ${picked === item.id ? 'ring-[var(--cv-edge-lit)]' : 'ring-transparent group-hover/sb:ring-[var(--cv-ring)]'}`}>
                        {item.text != null ? <span className="block h-full overflow-hidden p-2.5 text-[11.5px] leading-snug text-[var(--cv-ink-2)]"><Words text={item.text} /></span>
                          : src ? <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                            : <span className="flex h-full w-full items-center justify-center text-[var(--cv-ghost)]">{section.icon}</span>}
                        {board.run(item.id) ? <span className="absolute bottom-1.5 right-1.5 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : null}
                      </span>
                      <span className="truncate px-0.5 text-[12px] text-[var(--cv-ink-2)]">{item.title}</span>
                    </button>
                  );
                })}
                {!shown.length ? <span className="py-6 text-[12.5px] text-[var(--cv-ink-3)]">{t('canvas.nothing')}</span> : null}
              </div>
            </div>
          );
        }) : (
          <div className="flex h-[60%] flex-col items-center justify-center gap-3 text-center text-[13px] text-[var(--cv-ink-2)]">
            <Clapperboard size={28} className="text-[var(--cv-ink-3)]" />
            <span className="max-w-[380px] leading-relaxed">{t(chat ? 'canvas.storyboard.emptyChat' : 'canvas.storyboard.empty')}</span>
          </div>
        )}
      </div>
      {/* the one picked, large, with what it was asked */}
      <aside className="flex w-[min(420px,40%)] shrink-0 flex-col border-l !border-[var(--cv-float-line)] bg-[var(--cv-card-2)]">
        {current ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <div className="text-[13px] font-medium text-[var(--cv-ink)]">{current.title}</div>
            <div className="overflow-hidden rounded-[12px] bg-[var(--cv-card)]">
              {current.text != null ? <div className="max-h-[50vh] overflow-y-auto p-4 text-[13px] leading-relaxed text-[var(--cv-ink)]"><Words text={current.text} /></div>
                : current.file?.kind === 'image' ? <img src={sources.file(current.file)} alt="" className="max-h-[50vh] w-full object-contain" />
                  : current.file?.kind === 'video' ? <video src={sources.file(current.file)} controls className="max-h-[50vh] w-full" />
                    : current.file?.kind === 'audio' ? <audio src={sources.file(current.file)} controls className="w-full p-3" />
                      : <div className="flex h-40 items-center justify-center text-[12.5px] text-[var(--cv-ink-3)]">{t('canvas.storyboard.notMade')}</div>}
            </div>
            {current.makes ? (
              <>
                <div className="text-[12px] text-[var(--cv-label)]">{t('canvas.storyboard.asked')}</div>
                <textarea value={current.prompt ?? ''} rows={4} onFocus={board.willChange} onChange={(event) => board.setData(current.id, { prompt: event.target.value })}
                  placeholder={presetOf((nodes.find((x) => x.id === current.id)?.data as { preset?: string } | undefined)?.preset) ? t('canvas.presets.hint') : t('canvas.storyboard.askHint')}
                  className="w-full resize-none rounded-[10px] bg-[var(--cv-chip)] px-3 py-2 text-[13px] leading-relaxed text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]" />
                {error ? <div className="select-text text-[12px] text-red-500">{error}</div> : null}
              </>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {current.makes ? (run ? (
                <button type="button" onClick={() => board.stop(current.id)} className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)]"><Square size={11} fill="currentColor" />{t('canvas.make.stop')}</button>
              ) : (
                <button type="button" onClick={() => board.make(current.id)} className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-invert)] px-4 text-[13px] font-medium text-[var(--cv-on-invert)] transition hover:opacity-90">
                  {current.file ? <RotateCcw size={13} /> : <Play size={12} />}{t(current.file ? 'canvas.make.again' : 'canvas.make.run')}
                </button>
              )) : null}
              <button type="button" onClick={() => onShowOnBoard(current.id)} className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-chip)] px-4 text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
                <LocateFixed size={13} />{t('canvas.storyboard.showOnBoard')}
              </button>
              {current.file && (current.file.kind === 'video' || current.file.kind === 'image' || current.file.kind === 'audio') ? (
                <button type="button" onClick={() => board.addToFilm(current.file!)} className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--cv-chip)] px-4 text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
                  <Clapperboard size={13} />{t('canvas.storyboard.toTimeline')}
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-[12.5px] leading-relaxed text-[var(--cv-ink-3)]">{t('canvas.storyboard.pick')}</div>
        )}
      </aside>
    </div>
  );
}
