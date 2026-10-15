/**
 * Adding a skill to the person's own (apps/desktop/src/skills-ipc.mjs): from an address, from a folder (picked, or
 * dropped), or made with the agent (a message put in the composer). What came is looked at before it is kept.
 *
 * Opened from the examples' "Add a skill" (Studio's ExamplesGallery, through the app's bridge) as a small dialog over
 * the window (AddSkillDialog); a folder dropped on it is looked at at once.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowLeft, Blocks, FolderPlus, Loader2, Sparkles } from 'lucide-react';
import { keepFocus } from './Popover';
import { POPOVER_CHROME } from './ComposerCard';
import { useT } from '@/i18n';
import { chatLayer } from '@/lib/chat-layer';
import { app, type SkillInfo, type SkillPreview } from '../app-bridge';

const QUIET_BUTTON = 'h-7 rounded-[7px] px-2.5 text-[12px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40';
const MAIN_BUTTON = 'flex h-7 items-center gap-1.5 rounded-[7px] bg-[var(--text)] px-3 text-[12px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';
const WAY = 'flex w-full items-start gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition hover:bg-[var(--bg-hover)] disabled:opacity-40';

/** A folder dragged from the file manager, by its path (the desktop app's bridge), or ''. */
const droppedPath = (e: React.DragEvent) => {
  const file = e.dataTransfer.files[0];
  return file ? (window as unknown as { openfilmDesktop?: { pathForFile?: (f: File) => string } }).openfilmDesktop?.pathForFile?.(file) ?? '' : '';
};
const dragsFiles = (e: React.DragEvent) => e.dataTransfer.types.includes('Files');

/** A skill named in a message, as its pill. */
export interface PickedSkill { name: string; description: string }

/** a size as people read it */
const sizeOf = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/**
 * "Add a skill" over the window: AddSkill in a card, closed by Esc, by a click outside, or once done. A folder dropped
 * on it is looked at to be added.
 */
export function AddSkillDialog({ onClose, onAdded, onPick, onMake }: {
  onClose: () => void; onAdded: () => Promise<void>;
  /** naming the one added in the message, and making one with the agent: only where there is a message (a project's chat) */
  onPick?: (skill: PickedSkill) => void; onMake?: () => void;
}) {
  const t = useT();
  const [dropped, setDropped] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-[10060] grid place-items-center bg-black/45 p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('skills.addTitle')}
        style={{ ...POPOVER_CHROME, width: 'min(360px, calc(100vw - 24px))' }} className="relative flex flex-col overflow-hidden"
        onDragOver={(e) => { if (!dragsFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(e) => {
          if (!dragsFiles(e)) return;
          e.preventDefault();
          setDragging(false);
          const path = droppedPath(e);
          if (path) setDropped(path);
        }}>
        {dragging ? (
          <div className="pointer-events-none absolute inset-1 z-10 flex flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed border-[var(--border-strong)] bg-[var(--bg-surface)] text-[12.5px] text-[var(--text)]">
            <FolderPlus size={18} strokeWidth={1.75} className="text-[var(--text-dim)]" />{t('skills.dropToAdd')}
          </div>
        ) : null}
        <AddSkill key={dropped ?? ''} dropped={dropped} onBack={onClose} onAdded={onAdded}
          onPick={onPick ? (skill) => { onPick({ name: skill.name, description: skill.description }); onClose(); } : undefined}
          onMake={onMake ? () => { onMake(); onClose(); } : undefined} />
      </div>
    </div>,
    chatLayer(),
  );
}

/**
 * Adding a skill: from an address, from a folder (picked, or `dropped` on the popover), or made with the agent (a message
 * put in the composer). What came is looked at (each skill, its size, the scripts it brings, one of the same name it
 * would replace), then kept, or let go. Leaving before it is kept lets it go.
 */
export function AddSkill({ dropped, onBack, onAdded, onPick, onMake }: {
  dropped: string | null; onBack: () => void; onAdded: () => Promise<void>; onPick?: (skill: SkillInfo) => void; onMake?: () => void;
}) {
  const t = useT();
  const [url, setUrl] = React.useState('');
  const [step, setStep] = React.useState<'address' | 'fetching' | 'look' | 'adding' | 'added'>('address');
  const [error, setError] = React.useState<string | null>(null);
  const [fetched, setFetched] = React.useState<{ id: string; skills: SkillPreview[] } | null>(null);
  const [added, setAdded] = React.useState<SkillInfo[]>([]);
  const waiting = React.useRef<string | null>(null);
  /* left before it is kept: let go */
  React.useEffect(() => () => { if (waiting.current) void app.skills.discard(waiting.current); }, []);

  const look = async (preview: () => ReturnType<typeof app.skills.previewFolder>) => {
    setStep('fetching');
    setError(null);
    const r = await preview().catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) { if (!('cancelled' in r)) setError(r.error); setStep('address'); return; }
    waiting.current = r.id;
    setFetched({ id: r.id, skills: r.skills });
    setStep('look');
  };
  const fetchIt = () => { if (url.trim() && step !== 'fetching') void look(() => app.skills.preview(url.trim())); };
  const words = { title: t('skills.folderDialog'), button: t('skills.add') };
  const pickFolder = () => { if (step !== 'fetching') void look(() => app.skills.previewFolder(null, words)); };
  React.useEffect(() => { if (dropped) void look(() => app.skills.previewFolder(dropped)); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once, for the folder it opened with
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
            {added.length === 1 && onPick ? <button type="button" onMouseDown={keepFocus} onClick={() => onPick?.(added[0]!)} className={MAIN_BUTTON}>{t('skills.useIt')}</button> : null}
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
        <form className="px-3 pt-3 pb-2" onSubmit={(e) => { e.preventDefault(); fetchIt(); }}>
          <div className="pb-1.5 text-[11px] font-medium text-[var(--text-faint)]">{t('skills.fromLink')}</div>
          <input autoFocus={!dropped} value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} placeholder="https://github.com/…" disabled={step === 'fetching'} spellCheck={false}
            className="h-8 w-full rounded-[8px] border border-[var(--border)] bg-transparent px-2.5 text-[12.5px] text-[var(--text)] outline-none transition placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)]" />
          <p className={`mt-1.5 text-[11.5px] leading-[16px] ${error ? 'text-[var(--err)]' : 'text-[var(--text-muted)]'}`}>{error ?? t('skills.addHint')}</p>
          <div className="mt-3 flex justify-end">
            <button type="submit" disabled={!url.trim() || step === 'fetching'} onMouseDown={keepFocus} className={MAIN_BUTTON}>
              {step === 'fetching' ? <><Loader2 size={12} className="animate-spin" />{t('skills.fetching')}</> : t('skills.next')}
            </button>
          </div>
          <div className="mt-2.5 border-t border-[var(--border)] pt-1.5 -mx-1.5">
            <button type="button" onMouseDown={keepFocus} onClick={pickFolder} disabled={step === 'fetching'} className={WAY}>
              <FolderPlus size={14} strokeWidth={1.75} className="mt-[2px] shrink-0 text-[var(--text-dim)]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] leading-[18px] text-[var(--text)]">{t('skills.fromFolder')}</span>
                <span className="block text-[11.5px] leading-[16px] text-[var(--text-muted)]">{t('skills.fromFolderHint')}</span>
              </span>
            </button>
            {onMake ? (
              <button type="button" onMouseDown={keepFocus} onClick={onMake} disabled={step === 'fetching'} className={WAY}>
                <Sparkles size={14} strokeWidth={1.75} className="mt-[2px] shrink-0 text-[var(--text-dim)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-[18px] text-[var(--text)]">{t('skills.make')}</span>
                  <span className="block text-[11.5px] leading-[16px] text-[var(--text-muted)]">{t('skills.makeHint')}</span>
                </span>
              </button>
            ) : null}
          </div>
        </form>
      )}
    </div>
  );
}
