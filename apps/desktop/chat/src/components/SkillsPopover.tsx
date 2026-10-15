/**
 * The composer's Skills button: the ways of making a kind of film this message can name (apps/desktop/src/skills-ipc.mjs).
 *
 * One list, searched as typed: this project's skills, the person's own, the official ones, and the skills of the
 * agent in use the person let into OpenFilm (Settings → Agents is where they are let in). Picking one puts it into the
 * message as a pill where the cursor is. Below, adding one from an address (looked at before it is kept) and the
 * folder the person's own are kept in.
 *
 * Arrow keys move through the skills, Enter names the one lit, Esc closes.
 */
import React from 'react';
import { AlertTriangle, ArrowLeft, Blocks, FolderOpen, Link2, Loader2, Search } from 'lucide-react';
import { keepFocus, Popover } from './Popover';
import { POPOVER_CHROME } from './ComposerCard';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';
import { app, type OwnSkill, type SkillInfo, type SkillListing, type SkillPreview } from '../app-bridge';

const CARD_W = 340;
const LIST_MAX_H = 360;
const ROW = 'flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-[7px] text-left outline-none transition';
const QUIET_BUTTON = 'h-7 rounded-[7px] px-2.5 text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40';
const MAIN_BUTTON = 'flex h-7 items-center gap-1.5 rounded-[7px] bg-[var(--text)] px-3 text-[12px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';
const FOOT_BUTTON = 'flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';

/** A skill named in a message, as its pill. */
export interface PickedSkill { name: string; description: string }

const matches = (needle: string, ...words: string[]) => !needle || words.some((w) => w.toLowerCase().includes(needle));
/** a size as people read it */
const sizeOf = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export function SkillsPopover({ agentName, onPick, listing, reload }: {
  agentName: string;
  onPick: (skill: PickedSkill) => void;
  /** what the button lists, loaded by the chat (it names skills in `/` too) */
  listing: SkillListing | null;
  reload: () => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState<'list' | 'add'>('list');
  const [query, setQuery] = React.useState('');
  const [lit, setLit] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement>(null);

  /* read again each time it opens; left as new each time it closes (so what is typed as it opens is kept) */
  React.useEffect(() => {
    if (open) { void reload(); return; }
    setView('list');
    setQuery('');
    setLit(0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps -- each time it opens or closes

  const needle = query.trim().toLowerCase();
  const groups = React.useMemo(() => {
    const openfilm = listing?.openfilm ?? [];
    const of = (source: SkillInfo['source']) => openfilm.filter((s) => s.source === source && matches(needle, s.name, s.description));
    /* of the agent's own, those let in: the others are off in OpenFilm (an agent that cannot be told uses them itself) */
    const own = listing?.own.filtered ? listing.own.skills.filter((s) => s.allowed) : [];
    return { project: of('project'), mine: of('mine'), official: of('official'), own: own.filter((s) => matches(needle, s.name, s.description)) };
  }, [listing, needle]);
  const pickable: Array<SkillInfo | OwnSkill> = [...groups.project, ...groups.mine, ...groups.official, ...groups.own];
  React.useEffect(() => { setLit((i) => Math.min(i, Math.max(0, pickable.length - 1))); }, [pickable.length]);
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-skill-index="${lit}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [lit]);

  const pick = (skill: { name: string; description: string }) => {
    setOpen(false);
    onPick({ name: skill.name, description: skill.description });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setLit((i) => Math.min(pickable.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setLit((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && pickable[lit]) { e.preventDefault(); pick(pickable[lit]!); }
  };

  const nothing = listing && !listing.openfilm.length && !groups.own.length && !needle;
  let index = -1;
  const row = (skill: SkillInfo | OwnSkill, key: string) => {
    const i = ++index;
    return (
      <div key={key} data-skill-index={i} role="option" aria-selected={i === lit}
        onMouseDown={keepFocus} onMouseEnter={() => setLit(i)} onClick={() => pick(skill)} title={skill.folder}
        className={`${ROW} cursor-pointer ${i === lit ? 'bg-[var(--bg-hover)]' : ''}`}>
        <Blocks size={14} strokeWidth={1.75} className="mt-[2px] shrink-0 text-[var(--text-dim)]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] leading-[18px] text-[var(--text)]">{skill.name}</span>
          {skill.description ? <span className="mt-[1px] line-clamp-2 text-[11.5px] leading-[16px] text-[var(--text-muted)]">{skill.description}</span> : null}
        </span>
      </div>
    );
  };
  const section = (title: string, rows: React.ReactNode[]) => (rows.length ? (
    <div className="pb-1">
      <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-[var(--text-faint)]">{title}</div>
      {rows}
    </div>
  ) : null);

  return (
    <Popover open={open} onOpenChange={setOpen} placement="top" align="end" bare
      trigger={
        <Tooltip label={t('skills.button')}>
          <button type="button" onMouseDown={keepFocus} aria-pressed={open} className="openfilm-composer-tool" aria-label={t('skills.button')}>
            <Blocks size={16} strokeWidth={1.75} />
          </button>
        </Tooltip>
      }>
      <div style={{ ...POPOVER_CHROME, width: `min(${CARD_W}px, calc(100vw - 24px))` }} className="flex flex-col overflow-hidden" onKeyDown={view === 'list' ? onKey : undefined}>
        {view === 'add' ? <AddSkill onBack={() => setView('list')} onAdded={reload} onPick={pick} /> : (
          <>
            <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
              <Search size={14} className="shrink-0 text-[var(--text-faint)]" />
              <input autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setLit(0); }} placeholder={t('skills.search')}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
            </div>
            <div ref={listRef} role="listbox" aria-label={t('skills.button')} className="overflow-y-auto px-1 py-1" style={{ maxHeight: LIST_MAX_H }}>
              {!listing ? (
                <div className="flex items-center gap-2 px-2.5 py-3 text-[12.5px] text-[var(--text-muted)]"><Loader2 size={13} className="animate-spin" />{t('skills.loading')}</div>
              ) : nothing ? (
                <div className="px-3 py-3">
                  <div className="text-[13px] font-medium text-[var(--text)]">{t('skills.emptyTitle')}</div>
                  <p className="mt-1 text-[12px] leading-[17px] text-[var(--text-muted)]">{t('skills.emptyBody')}</p>
                </div>
              ) : pickable.length === 0 ? (
                <div className="px-2.5 py-3 text-[12.5px] text-[var(--text-muted)]">{t('skills.noMatch')}</div>
              ) : (
                <>
                  {section(t('skills.project'), groups.project.map((s) => row(s, `project:${s.name}`)))}
                  {section(t('skills.mine'), groups.mine.map((s) => row(s, `mine:${s.name}`)))}
                  {section(t('skills.official'), groups.official.map((s) => row(s, `official:${s.name}`)))}
                  {section(t('skills.own').replace('{agent}', agentName), groups.own.map((s) => row(s, `own:${s.name}`)))}
                </>
              )}
            </div>
            <div className="flex items-center gap-1 border-t border-[var(--border)] px-1.5 py-1.5">
              <button type="button" onMouseDown={keepFocus} onClick={() => setView('add')} className={FOOT_BUTTON}><Link2 size={13} />{t('skills.addFromLink')}</button>
              <button type="button" onMouseDown={keepFocus} onClick={() => { void app.skills.reveal(); }} className={FOOT_BUTTON}><FolderOpen size={13} />{t('skills.openFolder')}</button>
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}

/**
 * Adding a skill from an address: the address; what came, looked at (each skill, its size, the scripts it brings, one of
 * the same name it would replace); then kept, or let go. Leaving before it is kept lets it go.
 */
function AddSkill({ onBack, onAdded, onPick }: { onBack: () => void; onAdded: () => Promise<void>; onPick: (skill: SkillInfo) => void }) {
  const t = useT();
  const [url, setUrl] = React.useState('');
  const [step, setStep] = React.useState<'address' | 'fetching' | 'look' | 'adding' | 'added'>('address');
  const [error, setError] = React.useState<string | null>(null);
  const [fetched, setFetched] = React.useState<{ id: string; skills: SkillPreview[] } | null>(null);
  const [added, setAdded] = React.useState<SkillInfo[]>([]);
  const waiting = React.useRef<string | null>(null);
  /* left before it is kept: let go */
  React.useEffect(() => () => { if (waiting.current) void app.skills.discard(waiting.current); }, []);

  const fetchIt = async () => {
    if (!url.trim() || step === 'fetching') return;
    setStep('fetching');
    setError(null);
    const r = await app.skills.preview(url.trim()).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) { setError(r.error); setStep('address'); return; }
    waiting.current = r.id;
    setFetched({ id: r.id, skills: r.skills });
    setStep('look');
  };
  const keep = async () => {
    if (!fetched) return;
    setStep('adding');
    const r = await app.skills.commit(fetched.id).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    waiting.current = null;
    if (!r.ok) { setError(r.error); setStep('address'); setFetched(null); return; }
    setAdded(r.skills);
    setStep('added');
    await onAdded();
  };
  const letGo = () => {
    if (waiting.current) void app.skills.discard(waiting.current);
    waiting.current = null;
    setFetched(null);
    setStep('address');
  };
  const back = () => { letGo(); onBack(); };

  const scripts = (fetched?.skills ?? []).reduce((n, s) => n + s.scripts.length, 0);
  const replaces = (fetched?.skills ?? []).filter((s) => s.replaces).map((s) => s.name);
  const card = (s: { name: string; description: string }, facts?: string) => (
    <div key={s.name} className="flex items-start gap-2.5 py-1.5">
      <Blocks size={14} strokeWidth={1.75} className="mt-[2px] shrink-0 text-[var(--text-dim)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-[var(--text)]">{s.name}</span>
        {s.description ? <span className="line-clamp-2 text-[11.5px] leading-[16px] text-[var(--text-muted)]">{s.description}</span> : null}
        {facts ? <span className="mt-0.5 block text-[11px] text-[var(--text-faint)]">{facts}</span> : null}
      </span>
    </div>
  );

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-1.5 py-1.5">
        <button type="button" onMouseDown={keepFocus} onClick={back} aria-label={t('skills.back')}
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><ArrowLeft size={14} /></button>
        <span className="text-[13px] font-medium text-[var(--text)]">{t('skills.addTitle')}</span>
      </div>
      {step === 'added' ? (
        <div className="px-3 py-3">
          {added.map((s) => card(s))}
          <div className="mt-3 flex justify-end gap-1.5">
            <button type="button" onMouseDown={keepFocus} onClick={onBack} className={QUIET_BUTTON}>{t('skills.done')}</button>
            {added.length === 1 ? <button type="button" onMouseDown={keepFocus} onClick={() => onPick(added[0]!)} className={MAIN_BUTTON}>{t('skills.useIt')}</button> : null}
          </div>
        </div>
      ) : (step === 'look' || step === 'adding') && fetched ? (
        <div className="px-3 py-3">
          <div className="max-h-[220px] overflow-y-auto">
            {fetched.skills.map((s) => card(s, [sizeOf(s.size), s.scripts.length ? t('skills.scriptsCount').replace('{n}', String(s.scripts.length)) : null].filter(Boolean).join(' · ')))}
          </div>
          {replaces.length ? <p className="mt-2 text-[11.5px] leading-[16px] text-[var(--text-muted)]">{t('skills.replaceNote').replace('{names}', replaces.join(', '))}</p> : null}
          {scripts ? (
            <p className="mt-2 flex gap-1.5 rounded-[8px] bg-[var(--surface-2)] px-2.5 py-2 text-[11.5px] leading-[16px] text-[var(--text-muted)]">
              <AlertTriangle size={13} className="mt-[1px] shrink-0 text-[var(--warn)]" />
              <span>{t('skills.scriptsWarning').replace('{n}', String(scripts))}</span>
            </p>
          ) : null}
          <div className="mt-3 flex justify-end gap-1.5">
            <button type="button" onMouseDown={keepFocus} onClick={letGo} disabled={step === 'adding'} className={QUIET_BUTTON}>{t('skills.cancel')}</button>
            <button type="button" onMouseDown={keepFocus} onClick={() => void keep()} disabled={step === 'adding'} className={MAIN_BUTTON}>
              {step === 'adding' ? <><Loader2 size={12} className="animate-spin" />{t('skills.adding')}</> : t(replaces.length ? 'skills.replaceAndAdd' : 'skills.add')}
            </button>
          </div>
        </div>
      ) : (
        <form className="px-3 py-3" onSubmit={(e) => { e.preventDefault(); void fetchIt(); }}>
          <input autoFocus value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} placeholder="https://github.com/…" disabled={step === 'fetching'} spellCheck={false}
            className="h-8 w-full rounded-[8px] border border-[var(--border)] bg-transparent px-2.5 text-[12.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]" />
          <p className={`mt-1.5 text-[11.5px] leading-[16px] ${error ? 'text-[var(--err)]' : 'text-[var(--text-muted)]'}`}>{error ?? t('skills.addHint')}</p>
          <div className="mt-3 flex justify-end">
            <button type="submit" disabled={!url.trim() || step === 'fetching'} onMouseDown={keepFocus} className={MAIN_BUTTON}>
              {step === 'fetching' ? <><Loader2 size={12} className="animate-spin" />{t('skills.fetching')}</> : t('skills.next')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
