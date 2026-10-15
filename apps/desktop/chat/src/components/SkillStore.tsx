/**
 * The skill store: a large window over the app, to browse the skills on offer and one's own (internal design §7.3).
 *
 *   Discover    Featured: the featured skills, then each category's first few
 *   Categories  Formats, Styles, Capabilities, Brands: all of one category
 *   Mine        Added (the person's own and the official ones that come with OpenFilm), This project
 *   Add from link (SkillsPopover's AddSkill)
 *
 * A card is its poster, playing its demo silently under the pointer; its title, summary, author and badge. A skill opens
 * on its own page: the demo with sound, what it needs, what it brings (its scripts), where it was tested, and the two
 * ways to use it: start a new film with it, or use it in this one.
 *
 * The store's skills come from its index (apps/desktop/src/store-index.mjs); the person's from the Skills button's
 * listing. Esc goes back from a skill's page, else closes.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle, ArrowLeft, BadgeCheck, Blocks, Check, Clapperboard, FileAudio, Flag, FolderOpen, KeyRound, Link2, Palette,
  Puzzle, RefreshCw, Search, Sparkles, Type, WifiOff, X,
} from 'lucide-react';
import { useT, useUiLocale } from '@/i18n';
import { chatLayer } from '@/lib/chat-layer';
import { AddSkill } from './SkillsPopover';
import { app, type Localized, type SkillInfo, type SkillListing, type StoreIndex, type StoreSkill } from '../app-bridge';

type Section = 'featured' | StoreSkill['category'] | 'added' | 'project' | 'add';
type T = (key: string) => string;

/** A skill as a card shows it: one of the store's, or one of the person's (no poster, nothing to add). */
interface Shown {
  key: string;
  name: string;
  title: string;
  summary: string;
  author: string;
  badge: StoreSkill['badge'] | null;
  poster?: string;
  video?: string;
  added: boolean;
  store?: StoreSkill;
  local?: SkillInfo;
}

const CATEGORIES: ReadonlyArray<StoreSkill['category']> = ['format', 'style', 'capability', 'brand'];
const CATEGORY_ICON = { format: Clapperboard, style: Palette, capability: Puzzle, brand: BadgeCheck } as const;
const NEED_ICON = { file: FileAudio, text: Type, service: KeyRound } as const;
const AGENT_NAMES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex', byok: 'Pi', gemini: 'Gemini CLI', opencode: 'OpenCode' };

/** words in the language shown, else English, else any */
const pick = (words: Localized | undefined, locale: string) => (words ? words[locale] ?? words.en ?? Object.values(words)[0] ?? '' : '');
const sizeOf = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export function SkillStore({ listing, onClose, onUse, onStart, reload }: {
  listing: SkillListing | null;
  onClose: () => void;
  /** name a skill of the person's in the message being written */
  onUse: (skill: { name: string; description: string }) => void;
  /** start a new film with a skill (the store's or the person's) */
  onStart: (skill: { name: string; title: string }) => void;
  reload: () => Promise<void>;
}) {
  const t = useT();
  const locale = useUiLocale();
  const [section, setSection] = React.useState<Section>('featured');
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState<Shown | null>(null);
  const [store, setStore] = React.useState<{ index: StoreIndex; offline: boolean } | { error: string } | null>(null);
  const load = React.useCallback(() => {
    setStore(null);
    void app.skills.store().then((r) => setStore(r.ok ? { index: r.index, offline: r.offline } : { error: r.error }))
      .catch((e: unknown) => setStore({ error: e instanceof Error ? e.message : String(e) }));
  }, []);
  React.useEffect(load, [load]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (open) setOpen(null); else onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const index = store && 'index' in store ? store.index : null;
  const localNames = new Set((listing?.openfilm ?? []).map((s) => s.name));
  const fromStore = (s: StoreSkill): Shown => ({
    key: `store:${s.id}`, name: s.id, title: pick(s.title, locale) || s.id, summary: pick(s.summary, locale), author: s.author.name, badge: s.badge,
    poster: s.preview?.poster, video: s.preview?.video, added: localNames.has(s.id), store: s,
  });
  const fromLocal = (s: SkillInfo): Shown => {
    const listed = index?.skills.find((x) => x.id === s.name);
    return listed ? { ...fromStore(listed), key: `local:${s.name}`, added: true, local: s }
      : { key: `local:${s.name}`, name: s.name, title: s.name, summary: s.description, author: '', badge: s.source === 'official' ? 'official' : null, added: true, local: s };
  };
  const storeSkills = (index?.skills ?? []).map(fromStore);
  const added = (listing?.openfilm ?? []).filter((s) => s.source !== 'project').map(fromLocal);
  const projectSkills = (listing?.openfilm ?? []).filter((s) => s.source === 'project').map(fromLocal);
  const needle = query.trim().toLowerCase();
  const found = needle
    ? [...storeSkills, ...[...added, ...projectSkills].filter((l) => !storeSkills.some((s) => s.name === l.name))]
      .filter((s) => [s.title, s.summary, s.author, s.name, ...(s.store?.tags ?? [])].some((w) => w.toLowerCase().includes(needle)))
    : null;
  const go = (next: Section) => { setSection(next); setOpen(null); setQuery(''); };

  const nav = (id: Section, label: string, Icon: React.ComponentType<{ size?: number; className?: string }>, count?: number) => (
    <button type="button" onClick={() => go(id)}
      className={`flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-left text-[13px] transition ${section === id && !open && !found ? 'bg-[var(--bg-hover)] text-[var(--text)]' : 'text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'}`}>
      <Icon size={15} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count ? <span className="text-[11.5px] tabular-nums text-[var(--text-faint)]">{count}</span> : null}
    </button>
  );
  const group = (label: string) => <div className="px-2.5 pb-1 pt-4 text-[11px] font-medium text-[var(--text-faint)] first:pt-1">{label}</div>;

  let body: React.ReactNode;
  if (open) body = <Detail shown={open} t={t} locale={locale} onBack={() => setOpen(null)} onUse={onUse} onStart={onStart} />;
  else if (found) body = <Page title={fill(t('store.resultsFor'), { q: query.trim() })}>{found.length ? <Grid items={found} onOpen={setOpen} t={t} /> : <Empty text={t('store.noResults')} />}</Page>;
  else if (section === 'add') body = <div className="mx-auto mt-6 w-[360px] overflow-hidden rounded-[12px] border border-[var(--border)]"><AddSkill onBack={() => go('added')} onAdded={reload} onPick={(s) => { onUse(s); }} /></div>;
  else if (section === 'added') body = <Page title={t('store.added')} note={t('store.addedNote')}>{added.length ? <Grid items={added} onOpen={setOpen} t={t} mine /> : <Empty text={t('store.addedEmpty')} />}</Page>;
  else if (section === 'project') body = <Page title={t('store.project')} note={t('store.projectNote')}>{projectSkills.length ? <Grid items={projectSkills} onOpen={setOpen} t={t} mine /> : <Empty text={t('store.projectEmpty')} />}</Page>;
  else if (!index) body = store && 'error' in store ? <Unreachable t={t} onRetry={load} /> : <Empty text={t('store.loading')} />;
  else if (section === 'featured') {
    const ranked = storeSkills.filter((s) => s.store?.featured).sort((a, b) => (a.store!.featured! - b.store!.featured!));
    const [hero, ...rest] = ranked.length ? ranked : storeSkills;
    body = (
      <Page title={t('store.featured')} note={t('store.featuredNote')}>
        {hero ? <Hero shown={hero} onOpen={() => setOpen(hero)} onStart={() => setOpen(hero)} t={t} /> : null}
        {rest.length ? <div className="mt-6"><Grid items={rest.slice(0, 3)} onOpen={setOpen} t={t} /></div> : null}
        {CATEGORIES.map((c) => {
          const items = storeSkills.filter((s) => s.store?.category === c);
          if (!items.length) return null;
          return (
            <section key={c} className="mt-8">
              <div className="mb-3 flex items-baseline gap-3">
                <h3 className="text-[14px] font-semibold text-[var(--text)]">{t(`store.cat.${c}`)}</h3>
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text-faint)]">{t(`store.catNote.${c}`)}</span>
                {items.length > 3 ? <button type="button" onClick={() => go(c)} className="shrink-0 text-[12px] text-[var(--text-dim)] hover:text-[var(--text)]">{t('store.seeAll')} ›</button> : null}
              </div>
              <Grid items={items.slice(0, 3)} onOpen={setOpen} t={t} />
            </section>
          );
        })}
      </Page>
    );
  } else {
    const items = storeSkills.filter((s) => s.store?.category === section);
    body = <Page title={t(`store.cat.${section}`)} note={t(`store.catNote.${section}`)}>{items.length ? <Grid items={items} onOpen={setOpen} t={t} /> : <Empty text={t('store.empty')} />}</Page>;
  }

  return createPortal(
    <div className="fixed inset-0 z-[10040] grid place-items-center bg-black/45 p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('store.title')}
        className="flex h-[min(700px,92vh)] w-[min(1000px,96vw)] flex-col overflow-hidden rounded-[16px] border border-[var(--border)] bg-[var(--dock-pane)] shadow-[0_28px_80px_-16px_rgba(0,0,0,0.55)]">
        <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-5 py-3">
          <div className="text-[15px] font-semibold text-[var(--text)]">{t('store.title')}</div>
          <div className="mx-auto flex h-9 w-[min(420px,50%)] items-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] px-3 focus-within:border-[var(--border-strong)]">
            <Search size={14} className="shrink-0 text-[var(--text-faint)]" />
            <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setOpen(null); }} placeholder={t('store.search')}
              className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
          </div>
          <button type="button" onClick={onClose} aria-label={t('project.close')}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><X size={16} /></button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="flex w-[208px] shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] px-2.5 py-3">
            {group(t('store.discover'))}
            {nav('featured', t('store.featured'), Sparkles)}
            {group(t('store.categories'))}
            {CATEGORIES.map((c) => <React.Fragment key={c}>{nav(c, t(`store.cat.${c}`), CATEGORY_ICON[c], storeSkills.filter((s) => s.store?.category === c).length)}</React.Fragment>)}
            {group(t('store.mine'))}
            {nav('added', t('store.added'), Blocks, added.length)}
            {nav('project', t('store.project'), FolderOpen, projectSkills.length)}
            <div className="mt-auto pt-3">{nav('add', t('store.addFromLink'), Link2)}</div>
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto">
            {store && 'offline' in store && store.offline ? (
              <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface-2)] px-6 py-2 text-[12px] text-[var(--text-muted)]"><WifiOff size={13} />{t('store.offline')}</div>
            ) : null}
            {body}
          </div>
        </div>
      </div>
    </div>,
    chatLayer(),
  );
}

const fill = (template: string, values: Record<string, string>) => template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

function Page({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="px-6 pb-8 pt-5">
      <h2 className="text-[18px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</h2>
      {note ? <p className="mt-1 text-[12.5px] text-[var(--text-muted)]">{note}</p> : null}
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="px-6 py-10 text-center text-[13px] text-[var(--text-muted)]">{text}</p>;
}

function Unreachable({ t, onRetry }: { t: T; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <WifiOff size={20} className="text-[var(--text-faint)]" />
      <p className="text-[13px] text-[var(--text-muted)]">{t('store.unreachable')}</p>
      <button type="button" onClick={onRetry} className="flex h-8 items-center gap-1.5 rounded-[8px] border border-[var(--border)] px-3 text-[12.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]"><RefreshCw size={13} />{t('store.retry')}</button>
    </div>
  );
}

/** Cards in rows of three (two in a narrow window). `mine`: the person's own, where "Added" goes without saying. */
function Grid({ items, onOpen, t, mine = false }: { items: Shown[]; onOpen: (s: Shown) => void; t: T; mine?: boolean }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-5 gap-y-6">{items.map((s) => <Card key={s.key} shown={s} onOpen={() => onOpen(s)} t={t} mine={mine} />)}</div>;
}

/** The first featured skill, wide: its demo playing under the pointer, its title and summary over it, and how to start. */
function Hero({ shown, onOpen, onStart, t }: { shown: Shown; onOpen: () => void; onStart: () => void; t: T }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className="group relative block aspect-[21/9] w-full cursor-pointer overflow-hidden rounded-[14px] bg-black text-left outline-none ring-1 ring-[var(--border)] transition hover:ring-[var(--border-strong)] focus-visible:ring-2 focus-visible:ring-[var(--text-muted)]">
      {shown.poster ? <img src={shown.poster} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <NoPoster name={shown.name} />}
      {hover && shown.video ? <video src={shown.video} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
      <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(0,0,0,0.78)_0%,rgba(0,0,0,0.35)_45%,rgba(0,0,0,0)_75%)]" />
      <div className="absolute left-4 top-4"><Badge badge={shown.badge} t={t} /></div>
      <div className="absolute inset-x-0 bottom-0 flex items-end gap-6 p-6">
        <div className="min-w-0 flex-1">
          <div className="text-[24px] font-semibold leading-tight tracking-[-0.015em] text-white">{shown.title}</div>
          {shown.summary ? <div className="mt-1.5 line-clamp-2 max-w-[560px] text-[13.5px] leading-[20px] text-white/80">{shown.summary}</div> : null}
          {shown.author ? <div className="mt-1.5 text-[12px] text-white/55">@{shown.author}</div> : null}
        </div>
        <button type="button" onClick={(e) => { e.stopPropagation(); onStart(); }}
          className="shrink-0 rounded-[10px] bg-white px-4 py-2.5 text-[13px] font-medium text-black transition hover:bg-white/90">{t('store.startNew')}</button>
      </div>
    </div>
  );
}

function Badge({ badge, t }: { badge: StoreSkill['badge'] | null; t: T }) {
  if (!badge || badge === 'community') return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-[3px] text-[10.5px] font-medium text-white backdrop-blur-sm">
      <BadgeCheck size={11} />{t(badge === 'official' ? 'store.badgeOfficial' : 'store.badgeReviewed')}
    </span>
  );
}

/** A skill with no poster: its name on a quiet tile. */
function NoPoster({ name }: { name: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[linear-gradient(135deg,var(--surface-2),var(--surface-3))]">
      <Blocks size={22} strokeWidth={1.5} className="text-[var(--text-faint)]" />
      <span className="max-w-[80%] truncate font-mono text-[12px] text-[var(--text-muted)]">{name}</span>
    </div>
  );
}

function Card({ shown, onOpen, t, mine }: { shown: Shown; onOpen: () => void; t: T; mine: boolean }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} className="group flex min-w-0 flex-col text-left outline-none">
      <div className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-[var(--surface-2)] ring-1 ring-[var(--border)] transition group-hover:ring-[var(--border-strong)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--text-muted)]">
        {shown.poster ? <img src={shown.poster} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" /> : <NoPoster name={shown.name} />}
        {hover && shown.video ? <video src={shown.video} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-cover" /> : null}
        <div className="absolute left-2 top-2"><Badge badge={shown.badge} t={t} /></div>
        {shown.added && !mine ? (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-[3px] text-[10.5px] font-medium text-white backdrop-blur-sm"><Check size={11} />{t('store.installed')}</span>
        ) : null}
      </div>
      <div className="mt-2.5 truncate text-[13.5px] font-medium text-[var(--text)]">{shown.title}</div>
      {shown.summary ? <div className="mt-0.5 line-clamp-2 text-[12px] leading-[17px] text-[var(--text-muted)]">{shown.summary}</div> : null}
      {shown.author ? <div className="mt-1 truncate text-[11.5px] text-[var(--text-faint)]">@{shown.author}</div> : null}
    </button>
  );
}

function Detail({ shown, t, locale, onBack, onUse, onStart }: {
  shown: Shown; t: T; locale: string; onBack: () => void;
  onUse: (skill: { name: string; description: string }) => void;
  onStart: (skill: { name: string; title: string }) => void;
}) {
  const s = shown.store;
  const scripts = s?.scripts ?? shown.local?.scripts.length ?? 0;
  const needs = s?.needs ?? [];
  const tested = (s?.testedWith ?? []).map((a) => AGENT_NAMES[a] ?? a);
  /* a skill not added yet is fetched first: the next step (the store's backend) */
  const [note, setNote] = React.useState<string | null>(null);
  const use = () => { if (shown.added) onUse({ name: shown.name, description: shown.summary }); else setNote(t('store.comingSoon')); };
  const start = () => { if (shown.added) onStart({ name: shown.name, title: shown.title }); else setNote(t('store.comingSoon')); };
  const heading = 'mb-2 text-[12.5px] font-semibold text-[var(--text)]';
  return (
    <div className="px-6 pb-8 pt-4">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1 text-[12.5px] text-[var(--text-dim)] hover:text-[var(--text)]"><ArrowLeft size={14} />{t('store.back')}</button>
      <div className="grid grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-7">
        <div className="relative aspect-video overflow-hidden rounded-[12px] bg-black ring-1 ring-[var(--border)]">
          {shown.video ? <video src={shown.video} poster={shown.poster} controls autoPlay muted loop playsInline className="absolute inset-0 h-full w-full object-contain" />
            : shown.poster ? <img src={shown.poster} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <NoPoster name={shown.name} />}
        </div>
        <div className="flex min-w-0 flex-col">
          {shown.badge && shown.badge !== 'community' ? (
            <div className="mb-1.5 flex items-center gap-1 text-[11.5px] font-medium text-[var(--text-muted)]"><BadgeCheck size={13} />{t(shown.badge === 'official' ? 'store.badgeOfficial' : 'store.badgeReviewed')}</div>
          ) : null}
          <h2 className="text-[20px] font-semibold leading-tight tracking-[-0.01em] text-[var(--text)]">{shown.title}</h2>
          {shown.summary ? <p className="mt-2 text-[13.5px] leading-[20px] text-[var(--text-muted)]">{shown.summary}</p> : null}
          <p className="mt-2 text-[12px] text-[var(--text-faint)]">
            {[shown.author ? `@${shown.author}` : null, s?.version ? `v${s.version}` : null, s?.updated ? fill(t('store.updated'), { date: s.updated }) : null].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-5 flex flex-col gap-2">
            <button type="button" onClick={start}
              className="h-10 rounded-[10px] bg-[var(--text)] text-[13.5px] font-medium text-[var(--bg)] transition hover:opacity-90">{t('store.startNew')}</button>
            <button type="button" onClick={use}
              className="h-10 rounded-[10px] border border-[var(--border)] text-[13.5px] text-[var(--text)] transition hover:bg-[var(--bg-hover)]">{t('store.useHere')}</button>
          </div>
          {note ? <p className="mt-2 text-[12px] text-[var(--text-muted)]">{note}</p>
            : shown.added ? <p className="mt-2 flex items-center gap-1 text-[12px] text-[var(--text-faint)]"><Check size={12} />{t('store.installedNote')}</p> : null}
        </div>
      </div>
      <div className="mt-8 grid grid-cols-2 gap-x-10 gap-y-7">
        {needs.length ? (
          <section>
            <div className={heading}>{t('store.needs')}</div>
            <ul className="space-y-1.5">
              {needs.map((n, i) => {
                const Icon = NEED_ICON[n.kind];
                return (
                  <li key={i} className="flex items-start gap-2 text-[13px] text-[var(--text-muted)]">
                    <Icon size={14} className="mt-[2px] shrink-0 text-[var(--text-faint)]" />
                    <span>{pick(n.label, locale) || n.what}{n.optional ? <span className="text-[var(--text-faint)]"> · {t('store.optional')}</span> : null}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        <section>
          <div className={heading}>{t('store.brings')}</div>
          <p className="flex items-start gap-2 text-[13px] text-[var(--text-muted)]">
            {scripts ? <AlertTriangle size={14} className="mt-[2px] shrink-0 text-[var(--warn)]" /> : <Check size={14} className="mt-[2px] shrink-0 text-[var(--text-faint)]" />}
            <span>{scripts ? fill(t('store.scripts'), { n: String(scripts) }) : t('store.noScripts')}{s?.size ? ` · ${sizeOf(s.size)}` : ''}</span>
          </p>
          {tested.length ? <p className="mt-1.5 text-[12.5px] text-[var(--text-faint)]">{fill(t('store.tested'), { agents: tested.join(', ') })}</p> : null}
        </section>
      </div>
      <div className="mt-8 flex items-center gap-4 border-t border-[var(--border)] pt-4 text-[12px] text-[var(--text-dim)]">
        {shown.local ? <button type="button" onClick={() => { void app.skills.reveal(); }} className="flex items-center gap-1.5 hover:text-[var(--text)]"><FolderOpen size={13} />{t('store.reveal')}</button> : null}
        {s ? <a href={`${s.source.repo}/issues/new?title=${encodeURIComponent(`Report: ${s.id}`)}`} target="_blank" rel="noreferrer" className="ml-auto flex items-center gap-1.5 hover:text-[var(--text)]"><Flag size={13} />{t('store.report')}</a> : null}
      </div>
    </div>
  );
}
