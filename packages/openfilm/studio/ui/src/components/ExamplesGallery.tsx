/**
 * The examples (films made with OpenFilm), to start from or to learn from: the projects window's "Examples" (also
 * opened by the app's chat, lib/host.ts `show-examples`). One is copied into a new project to change, or, over a film,
 * it or a part of it (a segment, or a stretch dragged on its strip) is pointed at in its chat for the agent to follow
 * (`onReference`), its canvas laid down on the film's, or how it was made asked.
 *
 * The first is wide, the others in a grid; cards are posters that play their preview under the pointer. One
 * opened is a page of two columns in place of the list: its preview on the left, what it is
 * and what to do with it on the right; Back (or Esc) returns to the list as it was. The title row is the projects
 * window's own, so switching views moves nothing.
 */
import React from 'react';
import { ArrowLeft, Clapperboard, ExternalLink, MessageCircleQuestion, Play, Workflow, X } from 'lucide-react';
import { useT } from '@/i18n';
import { seenExamples, sourcesApi, type Example } from '@/lib/project-sources';
import { readCanvasDoc, type CanvasDoc } from '@/lib/canvas';
import { Tooltip } from './Tooltip';

/* an example's canvas, only looked at: the board's code is loaded when one is shown */
const CanvasPreview = React.lazy(() => import('./canvas/CanvasView').then((m) => ({ default: m.CanvasPreview })));

/** A part of an example picked to point at: none for the whole film. */
export type ExamplePart = { from: number; to: number; segment?: string } | null;

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Two titles in the title row, the one shown bright (the projects window's switch is the same). */
export function TitleSwitch<T extends string>({ items, value, onChange }: { items: Array<{ id: T; label: string }>; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="mr-auto flex items-baseline gap-5">
      {items.map((item) => (
        <button key={item.id} type="button" role="tab" aria-selected={value === item.id} onClick={() => onChange(item.id)}
          className={`text-[17px] font-semibold tracking-[-0.01em] transition ${value === item.id ? 'text-[var(--text)]' : 'text-[var(--text-faint)] hover:text-[var(--text-muted)]'}`}>
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function ExamplesGallery({ heading, initial, onClose, onStart, onReference, onUseCanvas, onExplain }: {
  /** the title row's left (the projects window's switch) */
  heading: React.ReactNode;
  /** open on this example's page (its id: a pill of one clicked in the chat) */
  initial?: string;
  onClose?: () => void;
  onStart: (example: Example) => void;
  /** over a film: the example, or a part of it, pointed at in its chat */
  onReference?: (example: Example, part: ExamplePart) => void;
  /** an example's canvas laid down on the project's */
  onUseCanvas?: (example: Example) => void;
  /** "Explain how it's made": a question for the chat, with the example (`canvas`: it has one) */
  onExplain?: (example: Example, canvas: boolean) => void;
}) {
  const t = useT();
  /* what was read before shows at once; what is read now replaces it */
  const [examples, setExamples] = React.useState<Example[] | null>(() => seenExamples());
  const [opened, setOpened] = React.useState<Example | null>(null);
  /* opening on one example: once the examples have been read */
  const pending = React.useRef(initial);
  React.useEffect(() => {
    if (!pending.current || !examples) return;
    const want = pending.current;
    pending.current = undefined;
    setOpened(examples.find((e) => e.id === want) ?? null);
  }, [examples]);

  React.useEffect(() => {
    let alive = true;
    void sourcesApi.examples().then((list) => { if (alive) setExamples(list); });
    return () => { alive = false; };
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (opened) { e.preventDefault(); e.stopPropagation(); setOpened(null); } else if (onClose) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [opened, onClose]);

  /* a page opened starts at its top; Back returns to the list where it was left */
  const scroller = React.useRef<HTMLDivElement>(null);
  const listTop = React.useRef(0);
  const wasOpen = React.useRef(false);
  React.useLayoutEffect(() => {
    const el = scroller.current;
    const open = opened != null;
    if (!el || open === wasOpen.current) return;
    if (open) { listTop.current = el.scrollTop; el.scrollTop = 0; } else el.scrollTop = listTop.current;
    wasOpen.current = open;
  }, [opened]);

  const kindLabel = (c: string) => { const key = `gallery.cat.${c}`; const label = t(key); return label === key ? c : label; };

  let body: React.ReactNode;
  if (examples == null) {
    body = <Empty text={t('gallery.loading')} />;
  } else if (!examples.length) {
    body = <Empty text={t('gallery.empty')} />;
  } else {
    /* the first wide, the others in a grid */
    const [hero, ...rest] = examples;
    body = (
      <Body note={t('gallery.discoverNote')}>
        <Hero example={hero!} onOpen={() => setOpened(hero!)} onStart={() => onStart(hero!)}
          {...(onReference ? { onReference: () => onReference(hero!, null) } : {})} />
        {rest.length ? (
          <div className="mt-8">
            <Grid>{rest.map((e) => <ExampleCard key={e.id} example={e} label={e.category ? kindLabel(e.category) : null} onOpen={() => setOpened(e)} />)}</Grid>
          </div>
        ) : null}
      </Body>
    );
  }
  /* an example opened: its page in place of the list, the list kept (hidden) so Back finds it where it was */
  if (opened) {
    body = (
      <>
        <ExampleDetail example={opened} onStart={onStart} onReference={onReference} onUseCanvas={onUseCanvas} onExplain={onExplain} categoryLabel={kindLabel} />
        <div hidden>{body}</div>
      </>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* the same row as the projects' (ProjectsView): switching between them moves nothing */}
      <header className="flex shrink-0 flex-col px-6 pb-4 pt-5">
        <div className="flex min-h-8 items-center gap-1">
          {/* an example opened has its way back here, where the switch was */}
          {opened ? (
            <button type="button" onClick={() => setOpened(null)} className="mr-auto flex h-8 items-center gap-1.5 rounded-lg pl-1 pr-2.5 text-[13.5px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <ArrowLeft size={16} strokeWidth={1.75} />{t('gallery.back')}
            </button>
          ) : heading}
          {onClose ? (
            <button type="button" onClick={onClose} aria-label={t('project.close')}
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <X size={16} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </header>
      <div ref={scroller} className="min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">{body}</div>
    </div>
  );
}

/** A view's content: a line saying what it is, then its sections. */
function Body({ note, children }: { note?: string; children: React.ReactNode }) {
  return (
    <div className="px-6 pb-10">
      {note ? <p className="mb-5 text-[12.5px] text-[var(--text-muted)]">{note}</p> : null}
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-14 text-center text-[13px] text-[var(--text-muted)]">{text}</p>;
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-8">{children}</div>;
}

/** A poster that plays the preview while the pointer is on it; a clapperboard when there is neither. */
function Picture({ example, playing, fit = 'cover' }: { example: Example; playing: boolean; fit?: 'cover' | 'contain' }) {
  const [failed, setFailed] = React.useState(false);
  const fitClass = fit === 'contain' ? 'object-contain' : 'object-cover';
  return (
    <>
      {example.poster && !failed ? <img src={example.poster} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className={`absolute inset-0 h-full w-full ${fitClass}`} />
        : <span className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(135deg,var(--bg-field),var(--bg-pressed))] text-[var(--text-faint)]"><Clapperboard size={24} strokeWidth={1.5} /></span>}
      {playing && example.video ? <video src={example.video} autoPlay muted loop playsInline className={`absolute inset-0 h-full w-full ${fitClass}`} /> : null}
    </>
  );
}

/**
 * The first example, wide: its preview under the pointer, its title over it, and what to do with it: copy it to change
 * it, and (over a film) point the agent at it, each with a line saying what follows.
 */
function Hero({ example, onOpen, onStart, onReference }: { example: Example; onOpen: () => void; onStart: () => void; onReference?: () => void }) {
  const t = useT();
  const [hover, setHover] = React.useState(false);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className="relative block aspect-[2.2/1] w-full cursor-pointer overflow-hidden rounded-[14px] bg-black outline-none ring-1 ring-[var(--border)] transition hover:ring-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--text-muted)]">
      <Picture example={example} playing={hover} />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.8)_0%,rgba(0,0,0,0.3)_45%,rgba(0,0,0,0)_75%)]" />
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-6 p-6">
        <div className="min-w-0 flex-1">
          <div className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-white">{example.title}</div>
          {example.description ? <div className="mt-1.5 line-clamp-2 max-w-[520px] text-[13px] leading-[19px] text-white/80">{example.description}</div> : null}
          {example.duration ? <div className="mt-1.5 text-[12px] text-white/55">{clock(example.duration)}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onReference ? <HeroAction label={t('gallery.reference')} hint={t('gallery.referenceHint')} onClick={onReference} /> : null}
          <HeroAction primary label={t('gallery.start')} hint={t('gallery.startHint')} onClick={onStart} />
        </div>
      </div>
    </div>
  );
}

/** One of the hero's buttons; what follows from it is said under the pointer. */
function HeroAction({ label, hint, onClick, primary = false }: { label: string; hint: string; onClick: () => void; primary?: boolean }) {
  return (
    <Tooltip label={hint} side="bottom" wrap>
      <button type="button" onClick={(e) => { e.stopPropagation(); onClick(); }}
        className={`rounded-[10px] px-4 py-2.5 text-[13px] font-medium transition ${primary ? 'bg-white text-black hover:bg-white/90' : 'border border-white/25 bg-white/10 text-white hover:bg-white/20'}`}>
        {label}
      </button>
    </Tooltip>
  );
}

function ExampleCard({ example, label, onOpen }: { example: Example; label: string | null; onOpen: () => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="group flex min-w-0 flex-col text-left outline-none">
      <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-[var(--bg-field)] ring-1 ring-[var(--border)] transition group-hover:ring-[var(--border-strong)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--text-muted)]">
        <Picture example={example} playing={hover} />
        {example.duration ? <span className="absolute bottom-2 right-2 rounded bg-black/60 px-1.5 py-[1px] font-mono text-[10.5px] text-white">{clock(example.duration)}</span> : null}
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--text)]">{example.title}</span>
        {label ? <span className="shrink-0 text-[11.5px] text-[var(--text-faint)]">{label}</span> : null}
      </div>
      {example.description ? <div className="mt-0.5 line-clamp-2 text-[12px] leading-[17px] text-[var(--text-muted)]">{example.description}</div> : null}
    </button>
  );
}

/**
 * An example on its own: its preview with sound, its parts on a strip (one picked by a click, a stretch by dragging
 * across them; none: the whole film), and what to do with it.
 */
function ExampleDetail({ example, onStart, onReference, onUseCanvas, onExplain, categoryLabel }: {
  example: Example; onStart: (example: Example) => void;
  onReference?: (example: Example, part: ExamplePart) => void; categoryLabel: (c: string) => string;
  onUseCanvas?: (example: Example) => void; onExplain?: (example: Example, canvas: boolean) => void;
}) {
  const t = useT();
  /* its canvas, the steps it was made with: read with its folder (undefined: not yet; null: it has none) */
  const [board, setBoard] = React.useState<CanvasDoc | null | undefined>(undefined);
  const [view, setView] = React.useState<'film' | 'canvas'>('film');
  React.useEffect(() => {
    let live = true;
    setBoard(undefined);
    setView('film');
    sourcesApi.exampleCanvas(example.id).then((raw) => { if (live) setBoard(raw ? readCanvasDoc(raw) : null); }, () => { if (live) setBoard(null); });
    return () => { live = false; };
  }, [example.id]);
  const fileUrl = React.useCallback((path: string) => `/api/examples/${encodeURIComponent(example.id)}/files/${path.split('/').map(encodeURIComponent).join('/')}`, [example.id]);
  const showCanvas = view === 'canvas' && board;
  const video = React.useRef<HTMLVideoElement>(null);
  const [part, setPart] = React.useState<ExamplePart>(null);
  const duration = example.duration ?? example.segments.at(-1)?.to ?? 0;
  const [drag, setDrag] = React.useState<number | null>(null);
  const strip = React.useRef<HTMLDivElement>(null);
  const timeAt = (clientX: number) => {
    const box = strip.current?.getBoundingClientRect();
    return box && duration ? Math.max(0, Math.min(duration, ((clientX - box.left) / box.width) * duration)) : 0;
  };
  const seek = (s: number) => { if (video.current) { video.current.currentTime = s; void video.current.play().catch(() => {}); } };
  const pick = (next: ExamplePart) => { setPart(next); if (next) seek(next.from); };
  const refer = onReference ? { label: part ? t('gallery.referencePart') : t('gallery.reference'), run: () => onReference(example, part) } : null;
  const copy = { label: t('gallery.start'), run: () => onStart(example) };

  return (
    <div className="px-6 pb-10">
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-7">
        <div>
          {board ? (
            <div className="mb-2 flex gap-1" role="tablist">
              {(['film', 'canvas'] as const).map((which) => (
                <button key={which} type="button" role="tab" aria-selected={view === which} onClick={() => setView(which)}
                  className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition ${view === which ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                  {which === 'film' ? <Clapperboard size={13} /> : <Workflow size={13} />}{t(`gallery.${which}`)}
                </button>
              ))}
            </div>
          ) : null}
          {showCanvas ? (
            <div className="relative aspect-video overflow-hidden rounded-[12px] bg-[var(--bg-panel)] ring-1 ring-[var(--border)]">
              <React.Suspense fallback={null}><CanvasPreview doc={board} fileUrl={fileUrl} /></React.Suspense>
            </div>
          ) : (
            <div className="relative aspect-video overflow-hidden rounded-[12px] bg-black ring-1 ring-[var(--border)]">
              {example.video ? <video ref={video} src={example.video} poster={example.poster ?? undefined} controls playsInline className="absolute inset-0 h-full w-full object-contain" />
                : <Picture example={example} playing={false} fit="contain" />}
            </div>
          )}
          {showCanvas ? <p className="mt-1.5 text-[11.5px] text-[var(--text-faint)]">{t('gallery.canvasHint')}</p> : null}
          {duration && !showCanvas ? (
            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between text-[11.5px] text-[var(--text-faint)]">
                <span>{t('gallery.parts')}</span>
                <span>{part ? `${clock(part.from)}–${clock(part.to)}` : t('gallery.whole')}</span>
              </div>
              <div ref={strip}
                onMouseDown={(e) => { if (e.button === 0) { setDrag(timeAt(e.clientX)); setPart(null); } }}
                onMouseMove={(e) => { if (drag != null) { const at = timeAt(e.clientX); if (Math.abs(at - drag) > duration / 200) setPart({ from: Math.min(drag, at), to: Math.max(drag, at) }); } }}
                onMouseUp={() => { if (drag != null && part) seek(part.from); setDrag(null); }}
                onMouseLeave={() => setDrag(null)}
                className="relative flex h-9 cursor-crosshair select-none overflow-hidden rounded-[8px] bg-[var(--bg-field)] ring-1 ring-[var(--border)]">
                {(example.segments.length ? example.segments : [{ title: example.title, from: 0, to: duration }]).map((g) => (
                  <button key={`${g.from}-${g.title}`} type="button" title={g.title}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => pick(example.segments.length ? { from: g.from, to: g.to, segment: g.title } : null)}
                    style={{ left: `${(g.from / duration) * 100}%`, width: `${((g.to - g.from) / duration) * 100}%` }}
                    className={`absolute inset-y-1 truncate rounded-[5px] border-l-2 border-[var(--bg-panel)] px-1.5 text-left text-[11px] transition ${part?.segment === g.title ? 'bg-[var(--accent)] text-[var(--on-accent)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}>
                    {g.title}
                  </button>
                ))}
                {part && !part.segment ? (
                  <div className="pointer-events-none absolute inset-y-0 rounded-[4px] ring-2 ring-inset ring-[var(--text)]"
                    style={{ left: `${(part.from / duration) * 100}%`, width: `${((part.to - part.from) / duration) * 100}%`, background: 'color-mix(in srgb, var(--text) 18%, transparent)' }} />
                ) : null}
              </div>
              <p className="mt-1.5 text-[11.5px] text-[var(--text-faint)]">{t('gallery.partsHint')}</p>
            </div>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col">
          {example.category ? <div className="mb-1 text-[11.5px] font-medium text-[var(--text-muted)]">{categoryLabel(example.category)}</div> : null}
          <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{example.title}</h2>
          {example.description ? <p className="mt-2 text-[13.5px] leading-[20px] text-[var(--text-muted)]">{example.description}</p> : null}
          {example.duration ? <p className="mt-2 text-[12px] text-[var(--text-faint)]">{clock(example.duration)}</p> : null}
          <div className="mt-5 flex flex-col gap-2">
            <button type="button" onClick={copy.run}
              className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--primary)] text-[13.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)]">
              <Play size={13} />{copy.label}
            </button>
            {refer ? (
              <button type="button" onClick={refer.run}
                className="h-10 rounded-[10px] border border-[var(--border)] text-[13.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]">{refer.label}</button>
            ) : null}
            {board && onUseCanvas ? (
              <button type="button" onClick={() => onUseCanvas(example)}
                className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border)] text-[13.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]">
                <Workflow size={14} />{t('gallery.useCanvas')}
              </button>
            ) : null}
            {onExplain ? (
              <button type="button" disabled={board === undefined} onClick={() => onExplain(example, Boolean(board))}
                className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-[var(--border)] text-[13.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)] disabled:opacity-50">
                <MessageCircleQuestion size={14} />{t('gallery.explain')}
              </button>
            ) : null}
          </div>
          <p className="mt-3 text-[12px] leading-[17px] text-[var(--text-faint)]">{t('gallery.startHow')}</p>
          {refer ? <p className="mt-1.5 text-[12px] leading-[17px] text-[var(--text-faint)]">{t('gallery.referenceHow')}</p> : null}
          <a href={example.url} target="_blank" rel="noreferrer" className="mt-auto flex items-center gap-1.5 pt-6 text-[12px] text-[var(--text-muted)] hover:text-[var(--text)]"><ExternalLink size={13} />{t('gallery.viewSource')}</a>
        </div>
      </div>
    </div>
  );
}
