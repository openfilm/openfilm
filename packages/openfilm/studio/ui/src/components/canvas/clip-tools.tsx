/**
 * A clip made from a clip by a model: the clip playing on the left, what the tool asks on the right (what to change, how
 * much longer, who or what to put in, a style, a recording), the words and the model below, as the picture tools ask.
 * Sent, the new clip is made at once beside the old, wired from it.
 */
import React from 'react';
import { ArrowUp, Check, ChevronDown, Music } from 'lucide-react';
import { useT } from '@/i18n';
import type { WorkspaceResource } from '@/lib/workspace-resources';
import { lengthOf, lengthRange } from '@/lib/canvas';
import { STYLES } from '@/lib/canvas-library';
import type { ClipChoice, ClipTool } from '@/lib/canvas-clip';
import { isOwn } from '@/lib/canvas-clip';
import { ProviderMark } from '../settings/ProviderMark';
import { CanvasModal, stylePicture } from './libraries';
import { LengthPicker } from './panels';
import { Filmstrip } from './trim';

export interface ClipMade { choice: ClipChoice; words: string; sec?: number; extras: string[]; style?: string; part?: [number, number] }

/** the most of a clip a model takes as a reference (every one connected takes 15 s; Seedance 2.5 more) */
export const CLIP_REFERENCE_MAX = 15;
/** the shortest part sent */
const PART_MIN = 2;
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export function ClipToolEditor({ tool, src, frameAt, length: told, models, first, files, srcOf, onClose, onMake }: {
  tool: ClipTool;
  src: string;
  /** a frame of the clip at a time, for its track */
  frameAt?: (ms: number) => string;
  /** the clip's length, s */
  length: number;
  /** the models that do it, the one made for it first */
  models: readonly ClipChoice[];
  /** the one picked first */
  first?: ClipChoice;
  /** the project's pictures and recordings to pick from */
  files: readonly WorkspaceResource[];
  srcOf: (file: WorkspaceResource) => string | undefined;
  onClose: () => void;
  onMake: (made: ClipMade) => Promise<void>;
}) {
  const t = useT();
  const key = (c: ClipChoice) => `${c.via}/${c.model ?? ''}`;
  const [picked, setPicked] = React.useState(() => (first && models.some((m) => key(m) === key(first)) ? first : models[0]));
  const [modelsOpen, setModelsOpen] = React.useState(false);
  const [words, setWords] = React.useState('');
  const [extras, setExtras] = React.useState<string[]>([]);
  const [style, setStyle] = React.useState<string | null>(null);
  const range = lengthRange('video', picked?.spec, 'omni');
  const [sec, setSec] = React.useState(() => lengthOf('video', 5, picked?.spec, 'omni') ?? 5);
  const [busy, setBusy] = React.useState(false);
  /* the part of a clip longer than a model takes: its end to carry on from, else its start; moved by dragging */
  const [length, setLength] = React.useState(told);
  const long = length > CLIP_REFERENCE_MAX + 0.05;
  const [part, setPart] = React.useState<[number, number]>([0, 0]);
  React.useEffect(() => { setPart(tool.length ? [Math.max(0, length - CLIP_REFERENCE_MAX), length] : [0, Math.min(length, CLIP_REFERENCE_MAX)]); }, [length, tool.length]);
  const strip = React.useRef<HTMLDivElement>(null);
  const grab = React.useRef<{ x: number; part: [number, number]; what: 'move' | 'from' | 'to' } | null>(null);
  const drag = (x: number) => {
    const g = grab.current;
    if (!g || !strip.current) return;
    const by = ((x - g.x) / strip.current.getBoundingClientRect().width) * length;
    const [a, b] = g.part;
    if (g.what === 'move') { const d = Math.min(length - b, Math.max(-a, by)); setPart([a + d, b + d]); }
    else if (g.what === 'from') setPart([Math.min(b - PART_MIN, Math.max(0, b - CLIP_REFERENCE_MAX, a + by)), b]);
    else setPart([a, Math.max(a + PART_MIN, Math.min(length, a + CLIP_REFERENCE_MAX, b + by))]);
  };
  const most = tool.pictures ? Math.max(1, picked?.spec?.refs ?? 4) : 1;
  const wanted = tool.audio ? files.filter((f) => f.kind === 'audio') : tool.pictures ? files.filter((f) => f.kind === 'image') : [];
  const missing = (tool.words === 'required' && !words.trim()) || (tool.pictures === 'required' && !extras.length) || (tool.audio && !extras.length) || (tool.style && !style);
  const make = async () => {
    if (busy || missing || !picked) return;
    setBusy(true);
    try { await onMake({ choice: picked, words: words.trim(), ...(tool.length ? { sec } : {}), extras, ...(style ? { style } : {}), ...(long ? { part } : {}) }); }
    finally { setBusy(false); }
  };
  const toggle = (path: string) => setExtras((list) => (list.includes(path) ? list.filter((p) => p !== path)
    : tool.audio ? [path] : list.length < most ? [...list, path] : list));
  const title = t(`canvas.clipTools.${tool.key}`);
  const section = 'mb-2 text-[12px] text-[var(--cv-ink-3)]';

  return (
    <CanvasModal label={title} onClose={onClose}>
      <div className="flex items-center gap-3 px-5 pr-16 pt-4">
        <span className="text-[14px] font-semibold">{title}</span>
        <span className="truncate text-[12px] text-[var(--cv-ink-3)]">{t(`canvas.clipTools.about.${tool.key}`)}</span>
      </div>
      <div className="flex min-h-0 flex-1 gap-5 p-5">
        <div className="flex min-w-0 flex-1 items-center justify-center rounded-[14px] bg-black/40">
          <video src={src} autoPlay loop muted playsInline controls className="max-h-full max-w-full rounded-[10px]"
            onLoadedMetadata={(event) => { const d = event.currentTarget.duration; if (Number.isFinite(d) && Math.abs(d - length) > 0.05) setLength(d); }} />
        </div>
        {/* what the tool asks */}
        <aside className="flex w-[340px] shrink-0 flex-col gap-5 overflow-y-auto pr-1">
          {long ? (
            /* the part sent: as long as a model takes, moved along the clip */
            <div>
              <div className={section}>{t('canvas.clipTools.partOf').replace('{max}', String(CLIP_REFERENCE_MAX)).replace('{s}', length.toFixed(1))}</div>
              <div ref={strip} className="nodrag relative h-11 touch-none select-none rounded-[9px] bg-[var(--cv-chip)]"
                onPointerMove={(event) => drag(event.clientX)} onPointerUp={() => { grab.current = null; }}>
                <Filmstrip length={length} frameAt={frameAt} />
                <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l-[9px] bg-black/60" style={{ width: `${(part[0] / length) * 100}%` }} />
                <div className="pointer-events-none absolute inset-y-0 right-0 rounded-r-[9px] bg-black/60" style={{ left: `${(part[1] / length) * 100}%` }} />
                <div className="absolute inset-y-0 cursor-grab rounded-[8px] border-2 border-[#4aa3ff] bg-[color-mix(in_srgb,#4aa3ff_10%,transparent)] active:cursor-grabbing"
                  style={{ left: `${(part[0] / length) * 100}%`, width: `${((part[1] - part[0]) / length) * 100}%` }}
                  onPointerDown={(event) => { grab.current = { x: event.clientX, part, what: 'move' }; strip.current?.setPointerCapture(event.pointerId); }}>
                  {(['from', 'to'] as const).map((end) => (
                    <span key={end} className={`absolute inset-y-0 flex w-3 cursor-ew-resize items-center justify-center ${end === 'from' ? '-left-1.5' : '-right-1.5'}`}
                      onPointerDown={(event) => { event.stopPropagation(); grab.current = { x: event.clientX, part, what: end }; strip.current?.setPointerCapture(event.pointerId); }}>
                      <span className="h-5 w-1 rounded-full bg-[#4aa3ff]" />
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-1.5 text-[11.5px] tabular-nums text-[var(--cv-ink-3)]">{clock(part[0])} – {clock(part[1])} · {(part[1] - part[0]).toFixed(1)}s</div>
            </div>
          ) : null}
          {tool.length && range ? (
            <div>
              <div className="px-2"><LengthPicker label={t('canvas.clipTools.extendBy').replace('{s}', length.toFixed(1))} value={sec} range={range} only={picked?.spec?.only} onChange={setSec} /></div>
            </div>
          ) : null}
          {tool.style ? (
            <div>
              <div className={section}>{t('canvas.clipTools.pickStyle')}</div>
              <div className="grid grid-cols-3 gap-2">
                {STYLES.map((s) => (
                  <button key={s.id} type="button" onClick={() => setStyle(style === s.id ? null : s.id)}
                    className={`relative aspect-[4/5] overflow-hidden rounded-[10px] ring-2 transition ${style === s.id ? 'ring-[#4aa3ff]' : 'ring-transparent hover:ring-[var(--cv-line)]'}`}>
                    {stylePicture(s.id) ? <img src={stylePicture(s.id)} alt="" draggable={false} loading="lazy" className="absolute inset-0 h-full w-full object-cover" /> : null}
                    <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3 text-left text-[11px] text-white">{t(`canvas.styles.names.${s.id}`)}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {tool.pictures || tool.audio ? (
            <div>
              <div className={section}>
                {t(tool.audio ? 'canvas.clipTools.pickAudio' : tool.key === 'recast' ? 'canvas.clipTools.pickPeople' : tool.key === 'motion' ? 'canvas.clipTools.pickLook' : 'canvas.clipTools.pickPictures')}
                {tool.pictures ? <span className="ml-1 tabular-nums">{extras.length}/{most}</span> : null}
              </div>
              {wanted.length ? (
                tool.audio ? (
                  <div className="flex flex-col gap-1">
                    {wanted.map((f) => (
                      <button key={f.path} type="button" onClick={() => toggle(f.path)}
                        className={`flex h-10 items-center gap-2.5 rounded-[10px] px-3 text-left text-[13px] transition ${extras.includes(f.path) ? 'bg-[color-mix(in_srgb,#4aa3ff_18%,transparent)] text-[var(--cv-ink)]' : 'bg-[var(--cv-chip)] text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)]'}`}>
                        <Music size={14} /><span className="min-w-0 flex-1 truncate">{f.name}</span>{extras.includes(f.path) ? <Check size={14} /> : null}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {wanted.map((f) => {
                      const at = extras.indexOf(f.path);
                      return (
                        <button key={f.path} type="button" title={f.name} onClick={() => toggle(f.path)}
                          className={`relative aspect-square overflow-hidden rounded-[10px] bg-[var(--cv-chip)] ring-2 transition ${at >= 0 ? 'ring-[#4aa3ff]' : 'ring-transparent hover:ring-[var(--cv-line)]'}`}>
                          {srcOf(f) ? <img src={srcOf(f)} alt="" draggable={false} loading="lazy" className="cv-checker absolute inset-0 h-full w-full object-cover" /> : null}
                          {at >= 0 ? <span className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#4aa3ff] px-1 text-[11px] font-medium text-white">{at + 1}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                )
              ) : <p className="rounded-[10px] bg-[var(--cv-chip)] px-3 py-3 text-[12.5px] leading-relaxed text-[var(--cv-ink-3)]">{t(tool.audio ? 'canvas.clipTools.noAudioFiles' : 'canvas.clipTools.noPictures')}</p>}
            </div>
          ) : null}
          {picked && !isOwn(tool, picked) ? <p className="text-[11.5px] leading-relaxed text-[var(--cv-ink-3)]">{t('canvas.clipTools.byReference').replace('{model}', picked.name)}</p> : null}
        </aside>
      </div>
      <div className="px-4 pb-4">
        <div className="flex items-end gap-3 rounded-[20px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] py-3 pl-4 pr-3 shadow-[var(--cv-float-shadow)] transition focus-within:!border-[var(--cv-ring)]">
          <textarea value={words} rows={2} autoFocus={tool.words === 'required'} onChange={(event) => setWords(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void make(); } }}
            placeholder={t(`canvas.clipTools.hint.${tool.key}`)}
            className="min-h-[44px] min-w-0 flex-1 resize-none bg-transparent py-1 text-[14px] leading-relaxed text-[var(--cv-ink)] outline-none placeholder:text-[var(--cv-ink-3)]" />
          {picked ? (
            <div className="relative shrink-0 self-end">
              <button type="button" onClick={() => setModelsOpen((v) => !v)}
                className="flex h-9 items-center gap-1.5 rounded-[10px] px-2.5 text-[13px] text-[var(--cv-ink-2)] transition hover:bg-[var(--cv-float-hover)] hover:text-[var(--cv-ink)]">
                <ProviderMark id={picked.via} size={15} /><span className="max-w-[200px] truncate">{picked.name}</span><ChevronDown size={13} />
              </button>
              {modelsOpen ? (
                <div className="cv-bar-up absolute bottom-full right-0 z-20 mb-2 max-h-[320px] w-[300px] overflow-y-auto rounded-[16px] border-[0.5px] !border-[var(--cv-float-line)] bg-[var(--cv-float)] p-1.5 shadow-[var(--cv-float-shadow)]">
                  {models.map((m) => (
                    <button key={key(m)} type="button" onClick={() => { setPicked(m); setModelsOpen(false); setSec((s) => lengthOf('video', s, m.spec, 'omni') ?? s); }}
                      className="flex h-10 w-full items-center gap-2 rounded-[9px] px-2 text-left text-[13px] text-[var(--cv-ink)] transition hover:bg-[var(--cv-float-hover)]">
                      <ProviderMark id={m.via} size={15} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate leading-4">{m.name}</span>
                        {isOwn(tool, m) ? <span className="block truncate text-[11px] leading-4 text-[var(--cv-ink-3)]">{t('canvas.clipTools.madeFor')}</span> : null}
                      </span>
                      {key(m) === key(picked) ? <Check size={14} className="text-[var(--cv-ink-2)]" /> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <button type="button" aria-label={t('canvas.clipTools.make')} title={missing ? t(`canvas.clipTools.needs.${tool.key}`) : undefined} disabled={busy || Boolean(missing) || !picked} onClick={() => { void make(); }}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cv-invert)] text-[var(--cv-on-invert)] transition hover:opacity-90 disabled:bg-[var(--cv-chip)] disabled:text-[var(--cv-ink-3)]">
            {busy ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <ArrowUp size={17} />}
          </button>
        </div>
      </div>
    </CanvasModal>
  );
}
