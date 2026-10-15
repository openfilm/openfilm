/**
 * The examples (films made with OpenFilm) and the skills, to start from or to learn from. One view, two places:
 *
 *   · start      the projects window's "Examples": the examples only; one is started from (copied into a new project)
 *   · reference  the Community, over a film, from the app's chat (lib/host.ts `onCommand` `show-examples`): the skills
 *                first (one is named in the message being written; one added; their folder; feedback), then the
 *                examples (one, or a part of it, a segment or a stretch dragged on its strip, is pointed at in the
 *                message; starting from one is still there)
 *
 * A sidebar beside the cards: posters that play their preview under the pointer, and skills by their own title and
 * summary (a skill's openfilm.json, in the language shown) rather than the words written for the agent. The title row
 * is the projects window's own (its switch, its close), so switching between the projects and the examples moves
 * nothing. Esc goes back from a page, else closes.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Blocks, Check, Clapperboard, Compass, ExternalLink, FolderOpen, Loader2, MessageSquare, Play, Plus, Search,
  Sparkles, X,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { sourcesApi, type Example, type SkillEntry } from '@/lib/project-sources';
import { GitHubDialog } from './ProjectSources';

export type ExamplesMode = 'start' | 'reference';
/** A part of an example picked to point at: none for the whole film. */
export type ExamplePart = { from: number; to: number; segment?: string } | null;

type Section = 'discover' | `kind:${string}` | 'skills' | `skills:${SkillEntry['source']}`;
type Opened = { kind: 'example'; example: Example } | { kind: 'skill'; skill: SkillEntry };

/** the kinds of film the examples are grouped by, in this order; any other comes after, by its own name */
const CATEGORIES = ['launch', 'explainer', 'slides', 'captions', 'ads', 'commerce', 'music'];
const SOURCES: ReadonlyArray<SkillEntry['source']> = ['official', 'mine', 'project'];
/** where people tell us how skills work for them (a GitHub issue form; no account with us) */
const FEEDBACK = 'https://github.com/openfilm/openfilm/issues/new?template=skill_feedback.yml';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
/** words in the language shown, else its family's, else English, else any */
const inLanguage = (words: Record<string, string> | undefined, lang: string) =>
  (words ? words[lang] ?? words[lang.split('-')[0]!] ?? words.en ?? Object.values(words)[0] : undefined);

/** A skill as people see it: its title and summary in the language shown, else its name and the agent's description. */
function useSkillWords() {
  const lang = useLanguage();
  return (skill: SkillEntry) => ({
    title: inLanguage(skill.shown?.title, lang) ?? skill.name,
    summary: inLanguage(skill.shown?.summary, lang) ?? skill.description,
  });
}

export function ExamplesGallery({ mode, projectId = null, heading, onClose, onStart, onReference, onUseSkill }: {
  mode: ExamplesMode;
  /** the project shown, for its own skills */
  projectId?: string | null;
  /** the title row's left (the projects window's switch); none: "Examples" */
  heading?: React.ReactNode;
  onClose?: () => void;
  onStart: (example: Example) => void;
  onReference?: (example: Example, part: ExamplePart) => void;
  onUseSkill?: (skill: SkillEntry) => void;
}) {
  const t = useT();
  const words = useSkillWords();
  const [examples, setExamples] = React.useState<Example[] | null>(null);
  const [skills, setSkills] = React.useState<SkillEntry[]>([]);
  /* the Community (over a film) opens on its skills; the projects window shows the examples only */
  const community = mode === 'reference';
  const [section, setSection] = React.useState<Section>(community ? 'skills' : 'discover');
  const [query, setQuery] = React.useState('');
  const [opened, setOpened] = React.useState<Opened | null>(null);

  React.useEffect(() => {
    let alive = true;
    void sourcesApi.examples().then((list) => { if (alive) setExamples(list); });
    if (community) void sourcesApi.skills(projectId).then((list) => { if (alive) setSkills(list); });
    return () => { alive = false; };
  }, [projectId, community]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (opened) { e.preventDefault(); e.stopPropagation(); setOpened(null); } else if (onClose) { e.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [opened, onClose]);

  const kindLabel = (c: string) => { const key = `gallery.cat.${c}`; const label = t(key); return label === key ? c : label; };
  const all = examples ?? [];
  const kinds = [...new Set(all.map((e) => e.category ?? 'other'))].sort((a, b) => (CATEGORIES.indexOf(a) + 1 || 99) - (CATEGORIES.indexOf(b) + 1 || 99));
  const needle = query.trim().toLowerCase();
  const match = (...w: Array<string | null | undefined>) => w.some((x) => x?.toLowerCase().includes(needle));
  const go = (next: Section) => { setSection(next); setOpened(null); setQuery(''); };
  const openExample = (example: Example) => setOpened({ kind: 'example', example });
  const openSkill = (skill: SkillEntry) => setOpened({ kind: 'skill', skill });

  let body: React.ReactNode;
  if (opened?.kind === 'example') {
    body = <ExampleDetail example={opened.example} mode={mode} onBack={() => setOpened(null)} onStart={onStart} onReference={onReference} categoryLabel={kindLabel} />;
  } else if (opened?.kind === 'skill') {
    body = <SkillDetail skill={opened.skill} mode={mode} onBack={() => setOpened(null)} onUse={onUseSkill} />;
  } else if (needle) {
    const foundExamples = all.filter((e) => match(e.title, e.description, e.category ? kindLabel(e.category) : null));
    const foundSkills = community ? skills.filter((s) => { const w = words(s); return match(s.name, w.title, w.summary); }) : [];
    body = (
      <Page title={t('gallery.resultsFor').replace('{q}', query.trim())}>
        {foundExamples.length || foundSkills.length ? (
          <>
            {foundExamples.length ? <Grid>{foundExamples.map((e) => <ExampleCard key={e.id} example={e} label={e.category ? kindLabel(e.category) : null} onOpen={() => openExample(e)} />)}</Grid> : null}
            {foundSkills.length ? <div className={foundExamples.length ? 'mt-8' : ''}><Grid>{foundSkills.map((s) => <SkillCard key={`${s.source}:${s.name}`} skill={s} onOpen={() => openSkill(s)} />)}</Grid></div> : null}
          </>
        ) : <Empty text={t('gallery.noResults')} />}
      </Page>
    );
  } else if (section === 'skills') {
    /* every skill, by where it comes from: OpenFilm's, the person's, this project's */
    const sources = SOURCES.filter((source) => source !== 'project' || projectId);
    body = (
      <Page title={t('gallery.allSkills')} note={t('gallery.skillsNote')}>
        {sources.map((source, i) => {
          const items = skills.filter((k) => k.source === source);
          if (!items.length && source === 'project') return null;
          return (
            <div key={source} className={i ? 'mt-9' : ''}>
              <div className="mb-3 flex items-baseline gap-3">
                <h3 className="text-[14px] font-semibold text-[var(--text)]">{t(`gallery.${source}Skills`)}</h3>
                <span className="flex-1" />
                {items.length > 3 ? <button type="button" onClick={() => go(`skills:${source}`)} className="shrink-0 text-[12px] text-[var(--text-dim)] hover:text-[var(--text)]">{t('gallery.seeAll')} ›</button> : null}
              </div>
              {items.length ? <Grid>{items.slice(0, 3).map((k) => <SkillCard key={`${k.source}:${k.name}`} skill={k} onOpen={() => openSkill(k)} />)}</Grid>
                : <NoSkills />}
            </div>
          );
        })}
      </Page>
    );
  } else if (examples == null) {
    body = <Empty text={t('gallery.loading')} />;
  } else if (section === 'discover') {
    const [hero] = all;
    body = (
      <Page title={t('gallery.discover')} note={t('gallery.discoverNote')}>
        {hero ? <Hero example={hero} mode={mode} onOpen={() => openExample(hero)} onStart={() => onStart(hero)} /> : <Empty text={t('gallery.empty')} />}
        {kinds.map((k) => {
          const items = all.filter((e) => (e.category ?? 'other') === k && e !== hero);
          if (!items.length) return null;
          return (
            <Row key={k} title={k === 'other' ? t('gallery.more') : kindLabel(k)} onAll={items.length > 3 ? () => go(`kind:${k}`) : undefined}>
              <Grid>{items.slice(0, 3).map((e) => <ExampleCard key={e.id} example={e} label={null} onOpen={() => openExample(e)} />)}</Grid>
            </Row>
          );
        })}
      </Page>
    );
  } else if (section.startsWith('kind:')) {
    const k = section.slice(5);
    const items = all.filter((e) => (e.category ?? 'other') === k);
    body = <Page title={k === 'other' ? t('gallery.more') : kindLabel(k)}>{items.length ? <Grid>{items.map((e) => <ExampleCard key={e.id} example={e} label={null} onOpen={() => openExample(e)} />)}</Grid> : <Empty text={t('gallery.empty')} />}</Page>;
  } else {
    const source = section.slice(7) as SkillEntry['source'];
    const items = skills.filter((s) => s.source === source);
    body = (
      <Page title={t(`gallery.${source}Skills`)} note={t('gallery.skillsNote')}>
        {items.length ? <Grid>{items.map((s) => <SkillCard key={`${s.source}:${s.name}`} skill={s} onOpen={() => openSkill(s)} />)}</Grid>
          : source === 'project' ? <Empty text={t('gallery.noProjectSkills')} /> : <NoSkills />}
      </Page>
    );
  }

  const nav = (id: Section, label: string, icon: React.ReactNode, count?: number) => {
    const on = section === id && !opened && !needle;
    return (
      <button key={id} type="button" onClick={() => go(id)}
        className={`flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] transition ${on ? 'bg-[var(--bg-hover)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
        <span className="flex w-4 shrink-0 justify-center text-[var(--text-dim)]">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {count ? <span className="text-[11.5px] tabular-nums text-[var(--text-faint)]">{count}</span> : null}
      </button>
    );
  };
  const group = (label: string) => <div className="px-2.5 pb-1 pt-5 text-[11px] font-medium text-[var(--text-faint)]">{label}</div>;
  const foot = 'flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[12.5px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* the same row as the projects' (ProjectsView): switching between them moves nothing */}
      <header className="flex shrink-0 flex-col px-6 pb-4 pt-5">
        <div className="flex min-h-8 items-center gap-2">
          {heading ?? <h2 className="mr-auto text-[17px] font-semibold tracking-[-0.01em] text-[var(--text)]">{t(community ? 'gallery.community' : 'gallery.title')}</h2>}
          {community ? <span className="hidden text-[12px] text-[var(--text-faint)] md:block">{t('gallery.referenceNote')}</span> : null}
          {onClose ? (
            <button type="button" onClick={onClose} aria-label={t('project.close')}
              className="ml-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
              <X size={16} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[214px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] px-3 pb-3">
          <label className="relative mb-2 block">
            <span className="sr-only">{t(community ? 'gallery.search' : 'gallery.searchExamples')}</span>
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
            <input type="search" value={query} onChange={(e) => { setQuery(e.target.value); setOpened(null); }} placeholder={t(community ? 'gallery.search' : 'gallery.searchExamples')}
              className="h-8 w-full rounded-[8px] bg-[var(--surface-2)] pl-8 pr-2 text-[12.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--border-strong)]" />
          </label>
          {community ? (
            <>
              {nav('skills', t('gallery.allSkills'), <Sparkles size={14} />, skills.length)}
              {/* a project's own skills: only over a project */}
              {SOURCES.filter((s) => s !== 'project' || projectId).map((s) => nav(`skills:${s}`, t(`gallery.${s}Skills`), <Blocks size={14} />, skills.filter((k) => k.source === s).length))}
              {group(t('gallery.title'))}
            </>
          ) : null}
          {nav('discover', t('gallery.discover'), <Compass size={14} />)}
          {kinds.length > 1 || (kinds.length === 1 && kinds[0] !== 'other') ? (
            <>
              {community ? null : group(t('gallery.kinds'))}
              {kinds.map((k) => nav(`kind:${k}`, k === 'other' ? t('gallery.more') : kindLabel(k), <Clapperboard size={14} />, all.filter((e) => (e.category ?? 'other') === k).length))}
            </>
          ) : null}
          {community ? (
            <div className="mt-auto flex flex-col pt-4">
              {studioHost?.skills ? <button type="button" onClick={() => studioHost?.skills?.add()} className={foot}><Plus size={14} />{t('gallery.addSkill')}</button> : null}
              {studioHost?.skills ? <button type="button" onClick={() => studioHost?.skills?.reveal()} className={foot}><FolderOpen size={14} />{t('gallery.openFolder')}</button> : null}
              <a href={FEEDBACK} target="_blank" rel="noreferrer" className={foot}><MessageSquare size={14} />{t('gallery.feedback')}</a>
            </div>
          ) : null}
        </nav>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">{body}</div>
      </div>
    </div>
  );
}

function Page({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[980px] px-7 pb-10 pt-6">
      <h2 className="text-[19px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</h2>
      {note ? <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{note}</p> : null}
      <div className="mt-5">{children}</div>
    </div>
  );
}

function Row({ title, note, onAll, children }: { title: string; note?: string; onAll?: () => void; children: React.ReactNode }) {
  const t = useT();
  return (
    <section className="mt-9">
      <div className="mb-3 flex items-baseline gap-3">
        <h3 className="text-[14px] font-semibold text-[var(--text)]">{title}</h3>
        {note ? <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-faint)]">{note}</span> : <span className="flex-1" />}
        {onAll ? <button type="button" onClick={onAll} className="shrink-0 text-[12px] text-[var(--text-dim)] hover:text-[var(--text)]">{t('gallery.seeAll')} ›</button> : null}
      </div>
      {children}
    </section>
  );
}

/** None of the person's skills yet: how to get one. */
function NoSkills() {
  const t = useT();
  return (
    <div className="flex items-center gap-3 rounded-[10px] border border-dashed border-[var(--border-strong)] px-4 py-4">
      <p className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-[var(--text-muted)]">{t('gallery.noSkills')}</p>
      {studioHost?.skills ? (
        <button type="button" onClick={() => studioHost?.skills?.add()}
          className="flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] border border-[var(--border)] px-3 text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"><Plus size={13} />{t('gallery.addSkill')}</button>
      ) : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-14 text-center text-[13px] text-[var(--text-muted)]">{text}</p>;
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-x-5 gap-y-7">{children}</div>;
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

const SOURCE_KEY = { official: 'gallery.official', mine: 'gallery.mine', project: 'gallery.project' } as const;

/** A skill's cover: a quiet tile with its mark and its title, so a skill card sits beside an example's. */
function SkillCover({ title, big = false }: { title: string; big?: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 bg-[radial-gradient(120%_90%_at_20%_0%,var(--surface-3),var(--surface-2)_60%)] px-6 text-center">
      <span className={`flex items-center justify-center rounded-[10px] bg-[var(--dock-pane)] text-[var(--text-dim)] shadow-[0_0_0_1px_var(--border)] ${big ? 'h-14 w-14' : 'h-10 w-10'}`}>
        <Sparkles size={big ? 24 : 18} strokeWidth={1.6} />
      </span>
      <span className={`line-clamp-2 font-semibold tracking-[-0.01em] text-[var(--text)] ${big ? 'text-[20px]' : 'text-[14px]'}`}>{title}</span>
    </div>
  );
}

function SkillCard({ skill, onOpen }: { skill: SkillEntry; onOpen: () => void }) {
  const t = useT();
  const words = useSkillWords()(skill);
  return (
    <button type="button" onClick={onOpen} className="group flex min-w-0 flex-col text-left outline-none">
      <div className="relative aspect-video w-full overflow-hidden rounded-[10px] ring-1 ring-[var(--border)] transition group-hover:ring-[var(--border-strong)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--text-muted)]">
        <SkillCover title={words.title} />
      </div>
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--text)]">{words.title}</span>
        <span className="shrink-0 text-[11.5px] text-[var(--text-faint)]">{t(SOURCE_KEY[skill.source])}</span>
      </div>
      {words.summary ? <div className="mt-0.5 line-clamp-2 text-[12px] leading-[17px] text-[var(--text-muted)]">{words.summary}</div> : null}
    </button>
  );
}

function SkillDetail({ skill, mode, onBack, onUse }: { skill: SkillEntry; mode: ExamplesMode; onBack: () => void; onUse?: (skill: SkillEntry) => void }) {
  const t = useT();
  const words = useSkillWords()(skill);
  return (
    <div className="mx-auto w-full max-w-[980px] px-7 pb-10 pt-5">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-[12.5px] text-[var(--text-dim)] hover:text-[var(--text)]"><ArrowLeft size={14} />{t('gallery.back')}</button>
      <div className="grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-7">
        <div className="relative aspect-video overflow-hidden rounded-[12px] ring-1 ring-[var(--border)]"><SkillCover title={words.title} big /></div>
        <div className="flex min-w-0 flex-col">
          <div className="mb-1 text-[11.5px] font-medium text-[var(--text-muted)]">{t(SOURCE_KEY[skill.source])} · Skill</div>
          <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{words.title}</h2>
          {words.summary ? <p className="mt-2 text-[13.5px] leading-[20px] text-[var(--text-muted)]">{words.summary}</p> : null}
          <p className="mt-2 text-[12px] text-[var(--text-faint)]">{[skill.name, skill.scripts ? t('gallery.scripts').replace('{n}', String(skill.scripts)) : null].filter(Boolean).join(' · ')}</p>
          {mode === 'reference' && onUse ? (
            <button type="button" onClick={() => onUse(skill)}
              className="mt-5 flex h-10 items-center justify-center gap-1.5 rounded-[10px] bg-[var(--text)] text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90"><Check size={14} />{t('gallery.useSkill')}</button>
          ) : null}
          <p className="mt-3 text-[12px] leading-[17px] text-[var(--text-faint)]">{t('gallery.skillHow')}</p>
        </div>
      </div>
      {skill.description ? (
        <section className="mt-8 border-t border-[var(--border)] pt-5">
          <div className="mb-1.5 text-[12.5px] font-semibold text-[var(--text)]">{t('gallery.forTheAgent')}</div>
          <p className="max-w-[720px] text-[12.5px] leading-[19px] text-[var(--text-muted)]">{skill.description}</p>
        </section>
      ) : null}
    </div>
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
    <div className="mx-auto w-full max-w-[980px] px-7 pb-10 pt-5">
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
      <div role="dialog" aria-modal="true" aria-label={t('gallery.community')}
        className="fixed left-1/2 top-1/2 z-[10050] flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-[var(--border-strong)] bg-[var(--app-content-bg)] shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
        style={{ width: 'min(1200px, calc(100vw - 64px))', height: 'min(800px, calc(100vh - 80px))' }}>
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
