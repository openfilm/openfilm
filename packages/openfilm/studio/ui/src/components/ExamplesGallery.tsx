/**
 * The examples (films made with OpenFilm) and the skills, to start from or to learn from. One view, two places:
 *
 *   · start      the projects window's "Examples": the examples only; one is started from (copied into a new project)
 *   · reference  the Community, over a film, from the app's chat (lib/host.ts `onCommand` `show-examples`): two views
 *                switched in its title row, Skills first (SkillsLibrary: those installed, and OpenFilm's to install),
 *                then Examples (one, or a part of it, a segment or a stretch dragged on its strip, is pointed at in the
 *                message; starting from one is still there)
 *
 * Examples: the first wide, the others in a grid; cards are posters that play their preview under the pointer. One
 * opened, an example or a skill, is a page of two columns in place of the list: its preview on the left, what it is
 * and what to do with it on the right; Back (or Esc) returns to the list as it was. The title row is the projects
 * window's own, so switching views moves nothing.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Clapperboard, ExternalLink, Play, X } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost, type CommunityItem } from '@/lib/host';
import { seenExamples, seenSkills, sourcesApi, watchSkills, type Example, type SkillEntry } from '@/lib/project-sources';
import { GitHubDialog } from './ProjectSources';
import { SkillsLibrary, useSkillWords } from './SkillsLibrary';

export type ExamplesMode = 'start' | 'reference';
/** A part of an example picked to point at: none for the whole film. */
export type ExamplePart = { from: number; to: number; segment?: string } | null;

type Opened = { kind: 'example'; example: Example } | { kind: 'skill'; skill: SkillEntry };

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

export function ExamplesGallery({ mode, projectId = null, heading, initial, onClose, onStart, onReference, onTrySkill }: {
  mode: ExamplesMode;
  /** open on this skill's or example's page (a pill of one clicked in the chat) */
  initial?: CommunityItem;
  /** the project shown, for its own skills */
  projectId?: string | null;
  /** the title row's left (the projects window's switch); none: the Community's own (Skill, Examples) */
  heading?: React.ReactNode;
  onClose?: () => void;
  onStart: (example: Example) => void;
  onReference?: (example: Example, part: ExamplePart) => void;
  /** Try now on a skill: a new conversation in the app's chat with it named */
  onTrySkill?: (skill: SkillEntry) => void;
}) {
  const t = useT();
  /* the Community (over a film) opens on its skills; the projects window shows the examples only */
  const community = mode === 'reference';
  const [view, setView] = React.useState<'skills' | 'examples'>(community ? 'skills' : 'examples');
  /* what was read before shows at once; what is read now replaces it */
  const [examples, setExamples] = React.useState<Example[] | null>(() => seenExamples());
  const [skills, setSkills] = React.useState<SkillEntry[]>(() => seenSkills(projectId) ?? []);
  const [opened, setOpened] = React.useState<Opened | null>(null);
  /* opening on one item: once what it is in has been read */
  const pending = React.useRef(initial);
  React.useEffect(() => {
    const want = pending.current;
    if (!want) return;
    /* the skills' Discover: the view the gallery opens on (SkillsLibrary `initialView`) */
    if (want.kind === 'discover') { pending.current = undefined; return; }
    if (want.kind === 'skill') {
      const skill = skills.find((k) => k.name === want.name);
      if (skill) { pending.current = undefined; setView('skills'); setOpened({ kind: 'skill', skill }); }
    } else if (examples) {
      pending.current = undefined;
      const example = examples.find((e) => e.id === want.id);
      setView('examples');
      if (example) setOpened({ kind: 'example', example });
    }
  }, [skills, examples]);

  React.useEffect(() => {
    let alive = true;
    void sourcesApi.examples().then((list) => { if (alive) setExamples(list); });
    const stop = community ? watchSkills(projectId, setSkills) : undefined;
    return () => { alive = false; stop?.(); };
  }, [projectId, community]);

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
  const show = (next: 'skills' | 'examples') => { setView(next); setOpened(null); };

  let body: React.ReactNode;
  if (view === 'skills') {
    body = <SkillsLibrary skills={skills} setSkills={setSkills} projectId={projectId} opened={opened?.kind === 'skill' ? opened.skill : null}
      {...(initial?.kind === 'discover' ? { initialView: 'discover' as const } : {})}
      onOpen={(skill) => setOpened({ kind: 'skill', skill })} onBack={() => setOpened(null)} {...(onTrySkill ? { onTry: onTrySkill } : {})} />;
  } else if (examples == null) {
    body = <Empty text={t('gallery.loading')} />;
  } else if (!examples.length) {
    body = <Empty text={t('gallery.empty')} />;
  } else {
    /* the first wide, the others in a grid */
    const [hero, ...rest] = examples;
    body = (
      <Body note={community ? t('gallery.referenceNote') : t('gallery.discoverNote')}>
        <Hero example={hero!} mode={mode} onOpen={() => setOpened({ kind: 'example', example: hero! })} onStart={() => onStart(hero!)} />
        {rest.length ? (
          <div className="mt-8">
            <Grid>{rest.map((e) => <ExampleCard key={e.id} example={e} label={e.category ? kindLabel(e.category) : null} onOpen={() => setOpened({ kind: 'example', example: e })} />)}</Grid>
          </div>
        ) : null}
      </Body>
    );
  }
  /* an example opened: its page in place of the list, the list kept (hidden) so Back finds it where it was */
  if (opened?.kind === 'example') {
    body = (
      <>
        <ExampleDetail example={opened.example} mode={mode} onStart={onStart} onReference={onReference} categoryLabel={kindLabel} />
        <div hidden>{body}</div>
      </>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* the same row as the projects' (ProjectsView): switching between them moves nothing */}
      <header className="flex shrink-0 flex-col px-6 pb-4 pt-5">
        <div className="flex min-h-8 items-center gap-1">
          {/* an example or a skill opened has its way back here, where the switch was */}
          {opened ? (
            <button type="button" onClick={() => setOpened(null)} className="mr-auto flex h-8 items-center gap-1.5 rounded-lg pl-1 pr-2.5 text-[13.5px] font-medium text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <ArrowLeft size={16} strokeWidth={1.75} />{t('gallery.back')}
            </button>
          ) : heading ?? <TitleSwitch items={[{ id: 'skills' as const, label: t('gallery.skills') }, { id: 'examples' as const, label: t('gallery.title') }]} value={view} onChange={show} />}
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
        : <span className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(135deg,var(--surface-2),var(--surface-3))] text-[var(--text-faint)]"><Clapperboard size={24} strokeWidth={1.5} /></span>}
      {playing && example.video ? <video src={example.video} autoPlay muted loop playsInline className={`absolute inset-0 h-full w-full ${fitClass}`} /> : null}
    </>
  );
}

/** The first example, wide: its preview under the pointer, its title over it, and how to start from it. */
function Hero({ example, mode, onOpen, onStart }: { example: Example; mode: ExamplesMode; onOpen: () => void; onStart: () => void }) {
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
        <button type="button" onClick={(e) => { e.stopPropagation(); if (mode === 'reference') onOpen(); else onStart(); }}
          className="shrink-0 rounded-[10px] bg-white px-4 py-2.5 text-[13px] font-medium text-black transition hover:bg-white/90">
          {mode === 'reference' ? t('gallery.reference') : t('gallery.start')}
        </button>
      </div>
    </div>
  );
}

function ExampleCard({ example, label, onOpen }: { example: Example; label: string | null; onOpen: () => void }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="group flex min-w-0 flex-col text-left outline-none">
      <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-[var(--surface-2)] ring-1 ring-[var(--border)] transition group-hover:ring-[var(--border-strong)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--text-muted)]">
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
function ExampleDetail({ example, mode, onStart, onReference, categoryLabel }: {
  example: Example; mode: ExamplesMode; onStart: (example: Example) => void;
  onReference?: (example: Example, part: ExamplePart) => void; categoryLabel: (c: string) => string;
}) {
  const t = useT();
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
  const primary = mode === 'reference' && onReference
    ? { label: part ? t('gallery.referencePart') : t('gallery.reference'), run: () => onReference(example, part) }
    : { label: t('gallery.start'), run: () => onStart(example) };
  const secondary = mode === 'reference' ? { label: t('gallery.startNew'), run: () => onStart(example) } : null;

  return (
    <div className="px-6 pb-10">
      <div className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-7">
        <div>
          <div className="relative aspect-video overflow-hidden rounded-[12px] bg-black ring-1 ring-[var(--border)]">
            {example.video ? <video ref={video} src={example.video} poster={example.poster ?? undefined} controls playsInline className="absolute inset-0 h-full w-full object-contain" />
              : <Picture example={example} playing={false} fit="contain" />}
          </div>
          {duration ? (
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
                className="relative flex h-9 cursor-crosshair select-none overflow-hidden rounded-[8px] bg-[var(--surface-2)] ring-1 ring-[var(--border)]">
                {(example.segments.length ? example.segments : [{ title: example.title, from: 0, to: duration }]).map((g) => (
                  <button key={`${g.from}-${g.title}`} type="button" title={g.title}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={() => pick(example.segments.length ? { from: g.from, to: g.to, segment: g.title } : null)}
                    style={{ left: `${(g.from / duration) * 100}%`, width: `${((g.to - g.from) / duration) * 100}%` }}
                    className={`absolute inset-y-1 truncate rounded-[5px] border-l-2 border-[var(--bg)] px-1.5 text-left text-[11px] transition ${part?.segment === g.title ? 'bg-[var(--text)] text-[var(--bg)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)]'}`}>
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
            <button type="button" onClick={primary.run}
              className="flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--text)] text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90">
              {mode === 'reference' ? null : <Play size={13} />}{primary.label}
            </button>
            {secondary ? (
              <button type="button" onClick={secondary.run}
                className="h-10 rounded-[10px] border border-[var(--border)] text-[13.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]">{secondary.label}</button>
            ) : null}
          </div>
          <p className="mt-3 text-[12px] leading-[17px] text-[var(--text-faint)]">{mode === 'reference' ? t('gallery.referenceHow') : t('gallery.startHow')}</p>
          <a href={example.url} target="_blank" rel="noreferrer" className="mt-auto flex items-center gap-1.5 pt-6 text-[12px] text-[var(--text-dim)] hover:text-[var(--text)]"><ExternalLink size={13} />{t('gallery.viewSource')}</a>
        </div>
      </div>
    </div>
  );
}

/**
 * The examples over a film, opened from the app's chat (`show-examples`): an example or a part of it becomes a
 * reference in the message being written at once (its folder, for the agent to read, fetched meanwhile and by the app
 * when the message is sent), a skill is named in it (lib/host.ts `useSkill`), and an example can still be started
 * from, as a new project (`onStarted`).
 */
export function ExamplesDialog({ projectId, open, onClose, onStarted }: { projectId: string; open?: CommunityItem; onClose: () => void; onStarted: (projectId: string) => void }) {
  const t = useT();
  const skillWords = useSkillWords();
  const [starting, setStarting] = React.useState<Example | null>(null);
  const reference = (example: Example, part: ExamplePart) => {
    /* fetched meanwhile, so the message goes as soon as it is sent */
    void sourcesApi.exampleFolder(example.id).catch(() => {});
    studioHost?.refer?.({
      kind: 'example', id: example.id, title: example.title, url: example.url, ...(example.description ? { description: example.description } : {}),
      ...(part ? { start: part.from, end: part.to, ...(part.segment ? { segment: part.segment } : {}) } : {}),
    });
    onClose();
  };
  return createPortal(
    <>
      <div className="fixed inset-0 z-[10040] bg-black/60" onMouseDown={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t('gallery.community')}
        className="fixed left-1/2 top-1/2 z-[10050] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--app-content-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
        style={{ width: 'min(1200px, calc(100vw - 64px))', height: 'min(800px, calc(100vh - 80px))' }}>
        <ExamplesGallery
          mode="reference"
          projectId={projectId}
          {...(open ? { initial: open } : {})}
          onClose={onClose}
          onStart={setStarting}
          onReference={reference}
          onTrySkill={(skill) => { studioHost?.useSkill?.({ name: skill.name, description: skill.description, title: skillWords(skill).title, newConversation: true }); onClose(); }}
        />
      </div>
      {starting ? (
        <GitHubDialog url={starting.url} start title={starting.title}
          onDone={(id) => { setStarting(null); onStarted(id); onClose(); }}
          onClose={() => setStarting(null)} />
      ) : null}
    </>,
    document.body,
  );
}
