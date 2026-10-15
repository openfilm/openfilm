/**
 * The composer's Skills button: the ways of making a kind of film this message can name (apps/desktop/src/skills-ipc.mjs).
 *
 * One list, searched as typed: this project's skills, the person's own, the official ones, then the skills the person
 * installed in the agent in use. A skill of the first three goes into the message as a pill where the cursor is; one of
 * the agent's own is let into OpenFilm with its switch (an agent that cannot be told has them all, and says so). Below,
 * adding one from an address, and the folder the person's own are kept in.
 *
 * Arrow keys move through the skills, Enter names the one lit, Esc closes.
 */
import React from 'react';
import { ArrowLeft, Blocks, FolderOpen, Link2, Loader2, Search } from 'lucide-react';
import { keepFocus, Popover } from './Popover';
import { POPOVER_CHROME } from './ComposerCard';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';
import { app, type OwnSkill, type SkillInfo, type SkillListing } from '../app-bridge';

const CARD_W = 340;
const LIST_MAX_H = 360;
const ROW = 'flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-[7px] text-left outline-none transition';

/** A skill named in a message, as its pill. */
export interface PickedSkill { name: string; description: string }

/** A small on/off switch, drawn as Studio's settings draw theirs. */
function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} title={label} onMouseDown={keepFocus}
      onClick={(e) => { e.stopPropagation(); onChange(!on); }}
      className={`relative mt-[1px] h-[18px] w-[30px] shrink-0 rounded-full transition-colors duration-150 ${on ? 'bg-[var(--text)]' : 'bg-[var(--surface-3)]'}`}>
      <span className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-[var(--bg)] shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-all duration-150 ${on ? 'left-[14px]' : 'left-[2px]'}`} />
    </button>
  );
}

const matches = (needle: string, ...words: string[]) => !needle || words.some((w) => w.toLowerCase().includes(needle));

export function SkillsPopover({ project, agent, agentName, onPick, listing, reload }: {
  project: string;
  agent: string;
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
  const [allowing, setAllowing] = React.useState<Record<string, boolean>>({});
  const searchRef = React.useRef<HTMLInputElement>(null);
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
    return {
      project: of('project'),
      mine: of('mine'),
      official: of('official'),
      own: (listing?.own.skills ?? []).filter((s) => matches(needle, s.name, s.description)),
    };
  }, [listing, needle]);
  /* what Enter can name, in the order shown: the agent's own only once let in (or when it cannot be told) */
  const filtered = listing?.own.filtered ?? true;
  const pickable: Array<SkillInfo | OwnSkill> = [...groups.project, ...groups.mine, ...groups.official, ...groups.own.filter((s) => !filtered || s.allowed)];
  React.useEffect(() => { setLit((i) => Math.min(i, Math.max(0, pickable.length - 1))); }, [pickable.length]);
  React.useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-skill-index="${lit}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [lit]);

  const pick = (skill: SkillInfo | OwnSkill) => {
    setOpen(false);
    onPick({ name: skill.name, description: skill.description });
  };
  const allow = async (skill: OwnSkill, on: boolean) => {
    setAllowing((a) => ({ ...a, [skill.name]: on }));
    await app.skills.allow(agent, skill.name, on).catch(() => null);
    await reload();
    setAllowing((a) => { const { [skill.name]: _, ...rest } = a; return rest; });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setLit((i) => Math.min(pickable.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setLit((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter' && pickable[lit]) { e.preventDefault(); pick(pickable[lit]!); }
  };

  const empty = listing && !listing.openfilm.length && !listing.own.skills.length;
  let index = -1;
  const row = (skill: SkillInfo | OwnSkill, own?: OwnSkill) => {
    const usable = !own || !filtered || own.allowed;
    const i = usable ? ++index : -1;
    const on = own ? allowing[own.name] ?? own.allowed : false;
    return (
      <div key={`${own ? 'own' : (skill as SkillInfo).source}:${skill.name}`} data-skill-index={usable ? i : undefined}
        role={usable ? 'option' : undefined} aria-selected={usable ? i === lit : undefined}
        onMouseDown={keepFocus} onMouseEnter={() => { if (usable) setLit(i); }} onClick={() => { if (usable) pick(skill); }}
        title={skill.folder}
        className={`${ROW} ${usable ? 'cursor-pointer' : 'cursor-default'} ${usable && i === lit ? 'bg-[var(--bg-hover)]' : ''}`}>
        <Blocks size={14} strokeWidth={1.75} className={`mt-[2px] shrink-0 ${usable ? 'text-[var(--text-dim)]' : 'text-[var(--text-faint)]'}`} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-[13px] leading-[18px] ${usable ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{skill.name}</span>
          {skill.description ? <span className="mt-[1px] line-clamp-2 text-[11.5px] leading-[16px] text-[var(--text-muted)]">{skill.description}</span> : null}
        </span>
        {own && filtered ? <Switch on={on} label={t('skills.allow').replace('{name}', own.name)} onChange={(next) => void allow(own, next)} /> : null}
      </div>
    );
  };
  const section = (title: string, rows: React.ReactNode[], note?: string) => (rows.length ? (
    <div className="pb-1">
      <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium text-[var(--text-faint)]">{title}</div>
      {note ? <div className="px-2.5 pb-1.5 text-[11px] leading-[15px] text-[var(--text-faint)]">{note}</div> : null}
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
              <input ref={searchRef} autoFocus value={query} onChange={(e) => { setQuery(e.target.value); setLit(0); }} placeholder={t('skills.search')}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
            </div>
            <div ref={listRef} role="listbox" aria-label={t('skills.button')} className="overflow-y-auto px-1 py-1" style={{ maxHeight: LIST_MAX_H }}>
              {!listing ? (
                <div className="flex items-center gap-2 px-2.5 py-3 text-[12.5px] text-[var(--text-muted)]"><Loader2 size={13} className="animate-spin" />{t('skills.loading')}</div>
              ) : empty ? (
                <div className="px-3 py-3">
                  <div className="text-[13px] font-medium text-[var(--text)]">{t('skills.emptyTitle')}</div>
                  <p className="mt-1 text-[12px] leading-[17px] text-[var(--text-muted)]">{t('skills.emptyBody')}</p>
                </div>
              ) : pickable.length === 0 && !groups.own.length ? (
                <div className="px-2.5 py-3 text-[12.5px] text-[var(--text-muted)]">{t('skills.noMatch')}</div>
              ) : (
                <>
                  {section(t('skills.project'), groups.project.map((s) => row(s)))}
                  {section(t('skills.mine'), groups.mine.map((s) => row(s)))}
                  {section(t('skills.official'), groups.official.map((s) => row(s)))}
                  {section(t('skills.own').replace('{agent}', agentName), groups.own.map((s) => row(s, s)),
                    filtered ? t('skills.ownNote') : t('skills.ownUnfiltered').replace('{agent}', agentName))}
                </>
              )}
            </div>
            <div className="flex items-center gap-1 border-t border-[var(--border)] px-1.5 py-1.5">
              <button type="button" onMouseDown={keepFocus} onClick={() => setView('add')}
                className="flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
                <Link2 size={13} />{t('skills.addFromLink')}
              </button>
              <button type="button" onMouseDown={keepFocus} onClick={() => { void app.skills.reveal(); }}
                className="flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
                <FolderOpen size={13} />{t('skills.openFolder')}
              </button>
            </div>
          </>
        )}
      </div>
    </Popover>
  );
}

/** Adding a skill from an address: the address, then what came, with what it can run. */
function AddSkill({ onBack, onAdded, onPick }: { onBack: () => void; onAdded: () => Promise<void>; onPick: (skill: SkillInfo) => void }) {
  const t = useT();
  const [url, setUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [added, setAdded] = React.useState<SkillInfo[] | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => { requestAnimationFrame(() => inputRef.current?.focus()); }, []);
  const submit = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    const r = await app.skills.add(url.trim()).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setAdded(r.skills);
    await onAdded();
  };
  const scripts = (added ?? []).reduce((n, s) => n + s.scripts.length, 0);
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-1.5 py-1.5">
        <button type="button" onMouseDown={keepFocus} onClick={onBack} aria-label={t('skills.back')}
          className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><ArrowLeft size={14} /></button>
        <span className="text-[13px] font-medium text-[var(--text)]">{t('skills.addTitle')}</span>
      </div>
      {added ? (
        <div className="px-3 py-3">
          {added.map((s) => (
            <div key={s.name} className="flex items-start gap-2.5 py-1">
              <Blocks size={14} strokeWidth={1.75} className="mt-[2px] shrink-0 text-[var(--text-dim)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] text-[var(--text)]">{s.name}</span>
                {s.description ? <span className="line-clamp-2 text-[11.5px] leading-[16px] text-[var(--text-muted)]">{s.description}</span> : null}
              </span>
            </div>
          ))}
          {scripts ? <p className="mt-2 rounded-[8px] bg-[var(--surface-2)] px-2.5 py-2 text-[11.5px] leading-[16px] text-[var(--text-muted)]">{t('skills.scriptsWarning').replace('{n}', String(scripts))}</p> : null}
          <div className="mt-3 flex justify-end gap-1.5">
            <button type="button" onMouseDown={keepFocus} onClick={onBack} className="h-7 rounded-[7px] px-2.5 text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">{t('skills.done')}</button>
            {added.length === 1 ? (
              <button type="button" onMouseDown={keepFocus} onClick={() => onPick(added[0]!)} className="h-7 rounded-[7px] bg-[var(--text)] px-2.5 text-[12px] font-medium text-[var(--bg)] transition hover:opacity-90">{t('skills.useIt')}</button>
            ) : null}
          </div>
        </div>
      ) : (
        <form className="px-3 py-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          <input ref={inputRef} value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} placeholder="https://github.com/…" disabled={busy} spellCheck={false}
            className="h-8 w-full rounded-[8px] border border-[var(--border)] bg-transparent px-2.5 text-[12.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]" />
          <p className={`mt-1.5 text-[11.5px] leading-[16px] ${error ? 'text-[var(--err)]' : 'text-[var(--text-muted)]'}`}>{error ?? t('skills.addHint')}</p>
          <div className="mt-3 flex justify-end">
            <button type="submit" disabled={!url.trim() || busy} onMouseDown={keepFocus}
              className="flex h-7 items-center gap-1.5 rounded-[7px] bg-[var(--text)] px-3 text-[12px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? <><Loader2 size={12} className="animate-spin" />{t('skills.adding')}</> : t('skills.add')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
