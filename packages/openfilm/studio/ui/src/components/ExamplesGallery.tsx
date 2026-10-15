/**
 * The examples: films made with OpenFilm and the skills that go with them, arranged by what people make (a launch, an
 * explainer, slides…), to start from or to learn from. One view, two places:
 *
 *   · start      the launcher's "Examples" (a new tab, or the Projects window): an example is started from (copied into
 *                a new project); a skill is shown for what it does
 *   · reference  over a film, from the app's chat (lib/host.ts `onCommand` `show-examples`): an example, or a part of
 *                it (a segment, or a stretch dragged on its strip), is pointed at in the message being written; a skill
 *                is named in it; starting from an example is still there
 *
 * Cards are posters that play their preview under the pointer. Esc goes back from an example's page, else closes.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Blocks, Check, Clapperboard, ExternalLink, FolderOpen, Loader2, MessageSquare, Play, Plus, Search, X } from 'lucide-react';
import { useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { sourcesApi, type Example, type SkillEntry } from '@/lib/project-sources';
import { GitHubDialog } from './ProjectSources';

export type ExamplesMode = 'start' | 'reference';
/** A part of an example picked to point at: none for the whole film. */
export type ExamplePart = { from: number; to: number; segment?: string } | null;

type Filter = 'all' | 'examples' | 'skills';
type Opened = { kind: 'example'; example: Example } | { kind: 'skill'; skill: SkillEntry };

/** the kinds of film the examples are grouped by, in this order; any other comes after, by its own name */
const CATEGORIES = ['launch', 'explainer', 'slides', 'captions', 'ads', 'commerce', 'music'];

/** where people tell us how skills work for them (a GitHub issue form; no account with us) */
const FEEDBACK = 'https://github.com/openfilm/openfilm/issues/new?template=skill_feedback.yml';
const SMALL = 'flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function ExamplesGallery({ mode, projectId = null, heading, onClose, onStart, onReference, onUseSkill }: {
  mode: ExamplesMode;
  /** the project shown, for its own skills */
  projectId?: string | null;
  /** the title row's left (the launcher's switch); none: "Examples" */
  heading?: React.ReactNode;
  onClose?: () => void;
  onStart: (example: Example) => void;
  onReference?: (example: Example, part: ExamplePart) => void;
  onUseSkill?: (skill: SkillEntry) => void;
}) {
  const t = useT();
  const [examples, setExamples] = React.useState<Example[] | null>(null);
  const [skills, setSkills] = React.useState<SkillEntry[]>([]);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [query, setQuery] = React.useState('');
  const [opened, setOpened] = React.useState<Opened | null>(null);

  React.useEffect(() => {
    let alive = true;
    void sourcesApi.examples().then((list) => { if (alive) setExamples(list); });
    void sourcesApi.skills(projectId).then((list) => { if (alive) setSkills(list); });
    return () => { alive = false; };
  }, [projectId]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (opened) { e.preventDefault(); e.stopPropagation(); setOpened(null); } else if (onClose) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [opened, onClose]);

  const needle = query.trim().toLowerCase();
  const match = (...words: Array<string | null | undefined>) => !needle || words.some((w) => w?.toLowerCase().includes(needle));
  const shownExamples = (examples ?? []).filter((e) => filter !== 'skills' && match(e.title, e.description, e.category));
  const shownSkills = skills.filter((s) => filter !== 'examples' && match(s.name, s.description));
  const categoryLabel = (c: string) => { const key = `gallery.cat.${c}`; const label = t(key); return label === key ? c : label; };

  let body: React.ReactNode;
  if (opened?.kind === 'example') {
    body = <ExampleDetail example={opened.example} mode={mode} onBack={() => setOpened(null)} onStart={onStart} onReference={onReference} categoryLabel={categoryLabel} />;
  } else if (opened?.kind === 'skill') {
    body = <SkillDetail skill={opened.skill} mode={mode} onBack={() => setOpened(null)} onUse={onUseSkill} />;
  } else if (examples == null) {
    body = <p className="px-6 py-16 text-center text-[13px] text-[var(--text-muted)]">{t('gallery.loading')}</p>;
  } else if (!shownExamples.length && !shownSkills.length) {
    body = <p className="px-6 py-16 text-center text-[13px] text-[var(--text-muted)]">{needle ? t('gallery.noResults') : t('gallery.empty')}</p>;
  } else {
    /* searching or filtered: one grid; else the first example wide, then a row per kind of film, then the skills */
    const plain = Boolean(needle) || filter !== 'all';
    const [hero, ...rest] = shownExamples;
    const kinds = [...new Set(rest.map((e) => e.category ?? 'other'))].sort((a, b) => (CATEGORIES.indexOf(a) + 1 || 99) - (CATEGORIES.indexOf(b) + 1 || 99));
    body = (
      <div className="px-6 pb-8 pt-1">
        {plain ? (
          <Grid>
            {shownExamples.map((e) => <ExampleCard key={e.id} example={e} label={e.category ? categoryLabel(e.category) : null} onOpen={() => setOpened({ kind: 'example', example: e })} />)}
          </Grid>
        ) : (
          <>
            {hero ? <Hero example={hero} mode={mode} onOpen={() => setOpened({ kind: 'example', example: hero })} onStart={() => onStart(hero)} /> : null}
            {kinds.map((k) => (
              <section key={k} className="mt-8">
                <h3 className="mb-3 text-[14px] font-semibold text-[var(--text)]">{k === 'other' ? t('gallery.more') : categoryLabel(k)}</h3>
                <Grid>
                  {rest.filter((e) => (e.category ?? 'other') === k).map((e) => <ExampleCard key={e.id} example={e} label={null} onOpen={() => setOpened({ kind: 'example', example: e })} />)}
                </Grid>
              </section>
            ))}
          </>
        )}
        {shownSkills.length || filter === 'skills' ? (
          <section className={plain && !shownExamples.length ? '' : 'mt-8'}>
            <div className="mb-3 flex items-end gap-2">
              <div className="min-w-0 flex-1">
                {plain && !shownExamples.length ? null : <h3 className="mb-1 text-[14px] font-semibold text-[var(--text)]">{t('gallery.skills')}</h3>}
                <p className="text-[12px] text-[var(--text-faint)]">{t('gallery.skillsNote')}</p>
              </div>
              {/* the person's own skills, where the app keeps them; and where to tell us how skills work for them */}
              {studioHost?.skills ? <button type="button" onClick={() => studioHost?.skills?.add()} className={SMALL}><Plus size={13} />{t('gallery.addSkill')}</button> : null}
              {studioHost?.skills ? <button type="button" onClick={() => studioHost?.skills?.reveal()} className={SMALL} title={t('gallery.openFolder')} aria-label={t('gallery.openFolder')}><FolderOpen size={13} /></button> : null}
              <a href={FEEDBACK} target="_blank" rel="noreferrer" className={SMALL} title={t('gallery.feedback')} aria-label={t('gallery.feedback')}><MessageSquare size={13} /></a>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              {shownSkills.map((s) => <SkillCard key={`${s.source}:${s.name}`} skill={s} onOpen={() => setOpened({ kind: 'skill', skill: s })} />)}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  const chip = (id: Filter, label: string) => (
    <button type="button" onClick={() => { setFilter(id); setOpened(null); }}
      className={`h-7 rounded-full px-3 text-[12.5px] transition ${filter === id ? 'bg-[var(--text)] text-[var(--bg)]' : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>{label}</button>
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-[1180px] shrink-0 flex-col gap-3 px-6 pb-3 pt-5">
        <div className="flex items-center gap-2">
          {heading ?? <h2 className="mr-auto text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">{t('gallery.title')}</h2>}
          <label className="relative w-[240px] shrink-0">
            <span className="sr-only">{t('gallery.search')}</span>
            <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setOpened(null); }} placeholder={t('gallery.search')}
              className="h-8 w-full rounded-lg bg-[var(--surface-2)] pl-8 pr-3 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--border-strong)]" />
          </label>
          {onClose ? (
            <button type="button" onClick={onClose} aria-label={t('project.close')}
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <X size={16} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        {opened ? null : (
          <div className="flex items-center gap-1">
            {chip('all', t('gallery.all'))}
            {chip('examples', t('gallery.examples'))}
            {chip('skills', t('gallery.skills'))}
            {mode === 'reference' ? <span className="ml-auto text-[12px] text-[var(--text-faint)]">{t('gallery.referenceNote')}</span> : null}
          </div>
        )}
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]"><div className="mx-auto w-full max-w-[1180px]">{body}</div></div>
    </div>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-5 gap-y-6">{children}</div>;
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
      className="relative block aspect-[21/9] max-h-[420px] w-full cursor-pointer overflow-hidden rounded-[14px] bg-black outline-none ring-1 ring-[var(--border)] transition hover:ring-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--text-muted)]">
      <Picture example={example} playing={hover} />
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.78)_0%,rgba(0,0,0,0.3)_45%,rgba(0,0,0,0)_75%)]" />
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-6 p-6">
        <div className="min-w-0 flex-1">
          <div className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-white">{example.title}</div>
          {example.description ? <div className="mt-1.5 line-clamp-2 max-w-[560px] text-[13.5px] leading-[20px] text-white/80">{example.description}</div> : null}
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

const SOURCE_KEY = { official: 'gallery.official', mine: 'gallery.mine', project: 'gallery.project' } as const;

function SkillCard({ skill, onOpen }: { skill: SkillEntry; onOpen: () => void }) {
  const t = useT();
  return (
    <button type="button" onClick={onOpen}
      className="flex min-w-0 items-start gap-3 rounded-[10px] border border-[var(--border)] px-3.5 py-3 text-left transition hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]">
      <span className="mt-[1px] flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-2)] text-[var(--text-dim)]"><Blocks size={15} strokeWidth={1.75} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--text)]">{skill.name}</span>
          <span className="shrink-0 text-[11px] text-[var(--text-faint)]">{t(SOURCE_KEY[skill.source])}</span>
        </span>
        {skill.description ? <span className="mt-0.5 line-clamp-2 block text-[12px] leading-[17px] text-[var(--text-muted)]">{skill.description}</span> : null}
      </span>
    </button>
  );
}

/**
 * An example on its own: its preview with sound, its parts on a strip (one picked by a click, a stretch by dragging
 * across them; none: the whole film), and what to do with it.
 */
function ExampleDetail({ example, mode, onBack, onStart, onReference, categoryLabel }: {
  example: Example; mode: ExamplesMode; onBack: () => void; onStart: (example: Example) => void;
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
    <div className="px-6 pb-8">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-[12.5px] text-[var(--text-dim)] hover:text-[var(--text)]"><ArrowLeft size={14} />{t('gallery.back')}</button>
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

function SkillDetail({ skill, mode, onBack, onUse }: { skill: SkillEntry; mode: ExamplesMode; onBack: () => void; onUse?: (skill: SkillEntry) => void }) {
  const t = useT();
  return (
    <div className="px-6 pb-8">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-[12.5px] text-[var(--text-dim)] hover:text-[var(--text)]"><ArrowLeft size={14} />{t('gallery.back')}</button>
      <div className="max-w-[640px]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-[var(--surface-2)] text-[var(--text-dim)]"><Blocks size={20} strokeWidth={1.75} /></span>
          <div className="min-w-0">
            <h2 className="truncate text-[20px] font-semibold tracking-[-0.01em] text-[var(--text)]">{skill.name}</h2>
            <div className="text-[12px] text-[var(--text-faint)]">{t(SOURCE_KEY[skill.source])}{skill.scripts ? ` · ${t('gallery.scripts').replace('{n}', String(skill.scripts))}` : ''}</div>
          </div>
        </div>
        {skill.description ? <p className="mt-4 text-[13.5px] leading-[21px] text-[var(--text-muted)]">{skill.description}</p> : null}
        {mode === 'reference' && onUse ? (
          <button type="button" onClick={() => onUse(skill)}
            className="mt-5 flex h-10 items-center gap-1.5 rounded-[10px] bg-[var(--text)] px-5 text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90"><Check size={14} />{t('gallery.useSkill')}</button>
        ) : (
          <p className="mt-5 text-[12.5px] leading-[18px] text-[var(--text-faint)]">{t('gallery.skillHow')}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The examples over a film, opened from the app's chat (`show-examples`): an example or a part of it becomes a
 * reference in the message being written (its folder fetched first, for the agent to read), a skill is named in it
 * (lib/host.ts `useSkill`), and an example can still be started from, as a new project (`onStarted`).
 */
export function ExamplesDialog({ projectId, onClose, onStarted }: { projectId: string; onClose: () => void; onStarted: (projectId: string) => void }) {
  const t = useT();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [starting, setStarting] = React.useState<Example | null>(null);
  const reference = async (example: Example, part: ExamplePart) => {
    setBusy(true);
    setError(null);
    try {
      const folder = await sourcesApi.exampleFolder(example.id);
      studioHost?.refer?.({
        kind: 'example', id: example.id, title: example.title, url: example.url, folder,
        ...(part ? { start: part.from, end: part.to, ...(part.segment ? { segment: part.segment } : {}) } : {}),
      });
      onClose();
    } catch (e) {
      setError(t('gallery.fetchFailed').replace('{error}', e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <>
      <div className="fixed inset-0 z-[10040] bg-black/60" onMouseDown={onClose} />
      <div role="dialog" aria-modal="true" aria-label={t('gallery.title')}
        className="fixed left-1/2 top-1/2 z-[10050] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--app-content-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
        style={{ width: 'min(1080px, calc(100vw - 64px))', height: 'min(760px, calc(100vh - 96px))' }}>
        <ExamplesGallery
          mode="reference"
          projectId={projectId}
          onClose={onClose}
          onStart={setStarting}
          onReference={(example, part) => void reference(example, part)}
          onUseSkill={(skill) => { studioHost?.useSkill?.({ name: skill.name, description: skill.description }); onClose(); }}
        />
        {busy ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-[var(--app-content-bg)]/70">
            <div className="flex items-center gap-2 rounded-lg bg-[var(--surface)] px-4 py-3 text-sm shadow-lg"><Loader2 size={16} className="animate-spin" />{t('gallery.fetching')}</div>
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="absolute bottom-4 left-1/2 z-30 -translate-x-1/2 rounded-full border border-[var(--err)]/40 bg-[var(--surface)] px-4 py-2 text-[12.5px] font-medium text-[var(--err)] shadow-[var(--shadow-lg)]">{error}</div>
        ) : null}
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
