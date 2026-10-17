/**
 * The examples (films made with OpenFilm) and the skills, to start from or to learn from. One view, two places:
 *
 *   · start      the projects window's "Examples": the examples only; one is started from (copied into a new project)
 *   · reference  the Community, over a film, from the app's chat (lib/host.ts `onCommand` `show-examples`): two views
 *                switched in its title row, Skills first (one is named in the message being written; one of the
 *                person's own added), then Examples (one, or a part of it, a segment or a stretch dragged on its strip,
 *                is pointed at in the message; starting from one is still there)
 *
 * Examples: the first wide, the others in a grid. Skills: the person's own first, then this project's, then OpenFilm's
 * by kind (ways of working, then looks, each in its openfilm.json `order`), narrowed by a row of filters that stays at
 * the top, beside adding one. Example cards are posters that play their preview under the pointer; skills show their
 * own title and summary (openfilm.json, in the language shown) rather than the words written for the agent. One opened
 * is a page of two columns: its picture or preview on the left, what it is and what to do with it on the right. The
 * title row is the projects window's own, so switching views moves nothing. Esc goes back from a page, else closes.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft, Check, Clapperboard, Copy, ExternalLink, Film, Folder, GitBranch, Info, Layers, MonitorPlay, Music, PenLine,
  PictureInPicture2, Play, Plus, Presentation, Scissors, Search, Shapes, Sparkles, Wand2, X, Github, type LucideIcon,
} from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost, type CommunityItem } from '@/lib/host';
import { seenExamples, seenSkills, sourcesApi, type Example, type SkillEntry } from '@/lib/project-sources';
import { GitHubDialog } from './ProjectSources';

export type ExamplesMode = 'start' | 'reference';
/** A part of an example picked to point at: none for the whole film. */
export type ExamplePart = { from: number; to: number; segment?: string } | null;

type Opened = { kind: 'example'; example: Example } | { kind: 'skill'; skill: SkillEntry };

/** The skills' filters: all of them, or one group. */
type SkillGroup = 'mine' | 'project' | 'workflow' | 'style';
type SkillFilter = 'all' | SkillGroup;

const byOrder = (a: SkillEntry, b: SkillEntry) => (a.order ?? 999) - (b.order ?? 999) || a.name.localeCompare(b.name);

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

export function ExamplesGallery({ mode, projectId = null, heading, initial, onClose, onStart, onReference, onUseSkill }: {
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
  onUseSkill?: (skill: SkillEntry) => void;
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
  const [filter, setFilter] = React.useState<SkillFilter>('all');

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
  const show = (next: 'skills' | 'examples') => { setView(next); setOpened(null); };

  let body: React.ReactNode;
  if (opened?.kind === 'example') {
    body = <ExampleDetail example={opened.example} mode={mode} onStart={onStart} onReference={onReference} categoryLabel={kindLabel} />;
  } else if (opened?.kind === 'skill') {
    body = <SkillDetail skill={opened.skill} mode={mode} onUse={onUseSkill} />;
  } else if (view === 'skills') {
    const official = skills.filter((k) => k.source === 'official').sort(byOrder);
    const groups: Array<{ id: SkillGroup; items: SkillEntry[] }> = [
      { id: 'workflow', items: official.filter((k) => k.kind !== 'style') },
      { id: 'style', items: official.filter((k) => k.kind === 'style') },
      { id: 'project', items: skills.filter((k) => k.source === 'project').sort(byOrder) },
      { id: 'mine', items: skills.filter((k) => k.source === 'mine').sort(byOrder) },
    ].filter((g) => g.id !== 'project' || g.items.length) as Array<{ id: SkillGroup; items: SkillEntry[] }>;
    body = <SkillsView groups={groups} filter={filter === 'all' || groups.some((g) => g.id === filter) ? filter : 'all'} onFilter={setFilter} onOpen={(k) => setOpened({ kind: 'skill', skill: k })} />;
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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* the same row as the projects' (ProjectsView): switching between them moves nothing */}
      <header className="flex shrink-0 flex-col px-6 pb-4 pt-5">
        <div className="flex min-h-8 items-center gap-1">
          {/* an opened one has its way back here, where the switch was */}
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
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">{body}</div>
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

const GROUP_LABEL: Record<SkillGroup, string> = { mine: 'gallery.mine', project: 'gallery.project', workflow: 'gallery.workflow', style: 'gallery.style' };

/**
 * The skills: filters on the left (all of OpenFilm's, its workflows, its looks; this project's; the person's own),
 * adding one and a search on the right, all in a row that stays at the top; then the cards. "All" shows OpenFilm's
 * under their kinds; the person's own are their own filter. What skills are for is a note behind the (i).
 */
function SkillsView({ groups, filter, onFilter, onOpen }: {
  groups: Array<{ id: SkillGroup; items: SkillEntry[] }>; filter: SkillFilter; onFilter: (f: SkillFilter) => void; onOpen: (k: SkillEntry) => void;
}) {
  const t = useT();
  const words = useSkillWords();
  const [query, setQuery] = React.useState('');
  const q = query.trim().toLowerCase();
  const matches = (k: SkillEntry) => !q || [words(k).title, words(k).summary, k.name].some((w) => w?.toLowerCase().includes(q));
  const shown = (filter === 'all' ? groups.filter((g) => g.id === 'workflow' || g.id === 'style') : groups.filter((g) => g.id === filter))
    .map((g) => ({ ...g, items: g.items.filter(matches) }));
  const chip = (id: SkillFilter, label: string, count?: number) => (
    <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => onFilter(id)}
      className={`flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-3 text-[13px] transition ${filter === id ? 'bg-[var(--bg-hover)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
      {label}{count ? <span className="text-[var(--text-faint)]">{count}</span> : null}
    </button>
  );
  const own = groups.filter((g) => g.id === 'project' || g.id === 'mine');
  return (
    <div className="pb-10">
      <div className="sticky top-0 z-[1] flex items-center gap-1 bg-[var(--app-content-bg)] px-6 pb-4">
        <div role="tablist" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
          {chip('all', t('gallery.all'))}
          {chip('workflow', t('gallery.workflow'))}
          {chip('style', t('gallery.style'))}
          <span className="mx-2 h-4 w-px shrink-0 bg-[var(--border-strong)]" />
          {own.map((g) => chip(g.id, t(GROUP_LABEL[g.id]), g.items.length))}
          <AboutSkills />
        </div>
        {studioHost?.skills ? (
          <button type="button" onClick={() => studioHost?.skills?.add()}
            className="flex h-9 shrink-0 items-center gap-1.5 rounded-[9px] border border-[var(--border)] px-3 text-[13px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"><Plus size={14} />{t('gallery.addSkill')}</button>
        ) : null}
        <label className="ml-2 flex h-9 w-[260px] shrink-0 items-center gap-2 rounded-[9px] bg-[var(--surface-2)] px-3 text-[var(--text-faint)] ring-1 ring-[var(--border)] focus-within:ring-[var(--border-strong)]">
          <Search size={14} strokeWidth={1.75} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('gallery.search')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
          {query ? <button type="button" aria-label={t('project.close')} onClick={() => setQuery('')} className="hover:text-[var(--text)]"><X size={13} /></button> : null}
        </label>
      </div>
      <div className="px-6">
        {shown.map((g, i) => (
          <section key={g.id} className={i ? 'mt-10' : ''}>
            {filter === 'all' && g.items.length ? <h3 className="mb-4 text-[15px] font-semibold text-[var(--text)]">{t(GROUP_LABEL[g.id])}</h3> : null}
            {g.items.length ? <Grid>{g.items.map((k) => <SkillCard key={`${k.source}:${k.name}`} skill={k} onOpen={() => onOpen(k)} />)}</Grid>
              : q ? <Empty text={t('gallery.noMatch')} /> : g.id === 'mine' ? <NoSkills /> : null}
          </section>
        ))}
      </div>
    </div>
  );
}

/** What skills are for, behind an (i) at the end of the filters: shown while the pointer or focus is on it. */
function AboutSkills() {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <span className="relative ml-1 flex shrink-0" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={t('gallery.aboutSkills')} aria-expanded={open} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
        className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--text-faint)] transition hover:text-[var(--text)]">
        <Info size={15} strokeWidth={1.75} />
      </button>
      {open ? (
        <span role="tooltip" className="fixed z-[10060] mt-9 w-[400px] whitespace-pre-line rounded-[10px] border border-[var(--border-strong)] bg-[var(--dock-pane)] px-4 py-3.5 text-[12.5px] leading-[20px] text-[var(--text-muted)] shadow-[0_12px_32px_rgba(0,0,0,0.35)]">
          {t('gallery.skillKinds')}
        </span>
      ) : null}
    </span>
  );
}

/** None of the person's skills yet: what theirs are for, and how to get one. */
function NoSkills() {
  const t = useT();
  return (
    <div className="flex flex-col items-center rounded-[12px] border border-dashed border-[var(--border-strong)] px-6 py-12 text-center">
      <Sparkles size={22} strokeWidth={1.5} className="text-[var(--text-faint)]" />
      <p className="mt-3 max-w-[520px] text-[13px] leading-[20px] text-[var(--text-muted)]">{t('gallery.noSkills')}</p>
      {studioHost?.skills ? (
        <button type="button" onClick={() => studioHost?.skills?.add()}
          className="mt-4 flex h-9 items-center gap-1.5 rounded-[9px] border border-[var(--border)] px-3.5 text-[13px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"><Plus size={14} />{t('gallery.addSkill')}</button>
      ) : null}
    </div>
  );
}

/** Where one of the person's skills came from, as a short line: GitHub · owner/repo, a folder's name, or made here. */
function Origin({ skill }: { skill: SkillEntry }) {
  const t = useT();
  const o = skill.origin;
  if (!o) return null;
  let icon = <Wand2 size={12} />, text = t('gallery.made');
  if (o.from === 'link') {
    icon = <GitBranch size={12} />;
    try { const u = new URL(o.address); text = `${u.hostname.replace(/^www\./, '').replace(/\.com$/, '').replace(/^github$/, 'GitHub').replace(/^gitlab$/, 'GitLab')} · ${u.pathname.split('/').filter(Boolean).slice(0, 2).join('/')}`; } catch { text = o.address; }
  } else if (o.from === 'folder') {
    icon = <Folder size={12} />;
    text = `${t('gallery.fromFolder')} · ${o.address.split(/[\\/]/).filter(Boolean).pop() ?? o.address}`;
  }
  return <div title={o.from === 'made' ? undefined : o.address} className="mt-2 flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--text-faint)]">{icon}<span className="truncate">{text}</span></div>;
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

const ICONS: Record<string, LucideIcon> = {
  copy: Copy, scissors: Scissors, monitor: MonitorPlay, shapes: Shapes, pip: PictureInPicture2, pen: PenLine, film: Film,
  music: Music, presentation: Presentation, layers: Layers,
};
/** each mark its own color, so the covers tell apart at a glance */
const HUES: Record<string, number> = { copy: 212, scissors: 18, monitor: 188, shapes: 262, pip: 328, pen: 42, film: 28, music: 286, presentation: 228, layers: 6 };

/** A skill's picture: its cover, else its preview's first frame, else a tile of its mark and title in its own color. */
function SkillCover({ skill, title, big = false, playing = false }: { skill: SkillEntry; title: string; big?: boolean; playing?: boolean }) {
  const [failed, setFailed] = React.useState(false);
  if (skill.cover && !failed) {
    return (
      <>
        <img src={skill.cover} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        {playing && skill.preview ? <video src={skill.preview} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
      </>
    );
  }
  const Mark = ICONS[skill.icon ?? ''] ?? Sparkles;
  const hue = HUES[skill.icon ?? ''] ?? 220;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center"
      style={{ background: `radial-gradient(110% 90% at 25% 0%, hsl(${hue} 70% 55% / 0.22), transparent 62%), radial-gradient(90% 80% at 100% 100%, hsl(${hue} 70% 50% / 0.12), transparent 60%), var(--surface-2)` }}>
      <span className={`flex items-center justify-center rounded-[14px] ${big ? 'h-16 w-16' : 'h-14 w-14'}`}
        style={{ background: `hsl(${hue} 70% 55% / 0.16)`, color: `hsl(${hue} 80% 72%)`, boxShadow: `0 0 0 1px hsl(${hue} 70% 60% / 0.28)` }}>
        <Mark size={big ? 28 : 24} strokeWidth={1.6} />
      </span>
      {/* a card has its title under it; the page's big picture carries it */}
      {big ? <span className="line-clamp-2 text-[22px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</span> : null}
    </div>
  );
}

function SkillCard({ skill, onOpen }: { skill: SkillEntry; onOpen: () => void }) {
  const words = useSkillWords()(skill);
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="group flex min-w-0 flex-col text-left outline-none">
      <div className="relative aspect-video w-full overflow-hidden rounded-[12px] ring-1 ring-[var(--border)] transition group-hover:ring-[var(--border-strong)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--text-muted)]">
        <SkillCover skill={skill} title={words.title} playing={hover} />
      </div>
      <div className="mt-3 truncate text-[14.5px] font-semibold tracking-[-0.005em] text-[var(--text)]">{words.title}</div>
      {words.summary ? <div className="mt-1 line-clamp-2 text-[12.5px] leading-[18px] text-[var(--text-muted)]">{words.summary}</div> : null}
      <Origin skill={skill} />
    </button>
  );
}

/**
 * A skill on its own: its preview (or picture) large on the left; on the right its title, kind and version, who it is
 * for and what it does, what the agent reads, and using it, at the bottom.
 */
function SkillDetail({ skill, mode, onUse }: { skill: SkillEntry; mode: ExamplesMode; onUse?: (skill: SkillEntry) => void }) {
  const t = useT();
  const lang = useLanguage();
  const words = useSkillWords()(skill);
  const details = inLanguage(skill.shown?.details, lang);
  const group: SkillGroup = skill.source === 'official' ? (skill.kind === 'style' ? 'style' : 'workflow') : skill.source;
  const source = skill.repository ?? (skill.origin?.from === 'link' ? skill.origin.address : undefined);
  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1.65fr)_minmax(320px,1fr)] border-t border-[var(--border)]">
      <div className="flex min-h-0 items-center justify-center bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] p-8">
        <div className="relative aspect-video w-full overflow-hidden rounded-[12px] bg-black ring-1 ring-[var(--border)]">
          {skill.preview ? <video src={skill.preview} poster={skill.cover} autoPlay muted loop controls playsInline className="absolute inset-0 h-full w-full object-contain" />
            : <SkillCover skill={skill} title={words.title} big />}
        </div>
      </div>
      <div className="flex min-h-0 flex-col border-l border-[var(--border)]">
        <div className="min-h-0 flex-1 overflow-y-auto px-7 pt-7">
          <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.015em] text-[var(--text)]">{words.title}</h2>
          <div className="mt-2.5 flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <span>{t(GROUP_LABEL[group])}</span>
            {skill.version ? <span className="rounded-[5px] border border-[var(--border)] px-1.5 py-[1px] font-mono text-[10.5px] text-[var(--text-dim)]">v{skill.version}</span> : null}
            {/* its source: OpenFilm's repository, or the address one of the person's came from */}
            {source ? (
              <a href={source} target="_blank" rel="noreferrer" title={source} aria-label={t('gallery.viewSource')}
                className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><Github size={14} strokeWidth={1.75} /></a>
            ) : null}
          </div>
          <Origin skill={skill} />
          {words.summary ? <p className="mt-5 text-[14px] leading-[22px] text-[var(--text)]">{words.summary}</p> : null}
          {details ? details.split('\n').map((line) => <p key={line} className="mt-3 text-[13.5px] leading-[22px] text-[var(--text-muted)]">{line}</p>) : null}
        </div>
        <div className="shrink-0 px-7 pb-7 pt-4">
          {mode === 'reference' && onUse ? (
            <button type="button" onClick={() => onUse(skill)}
              className="flex h-11 w-full items-center justify-center gap-1.5 rounded-[10px] bg-[var(--text)] text-[14px] font-medium text-[var(--bg)] transition hover:opacity-90"><Check size={15} />{t('gallery.useSkill')}</button>
          ) : null}
        </div>
      </div>
    </div>
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
          onUseSkill={(skill) => { studioHost?.useSkill?.({ name: skill.name, description: skill.description }); onClose(); }}
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
