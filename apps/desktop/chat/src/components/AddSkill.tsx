/**
 * Adding a skill to the person's own (apps/desktop/src/skills-ipc.mjs), in a dialog over the window, opened from the
 * Community's skills (Studio's ExamplesGallery, through the app's bridge). Three ways, one under the other: an address
 * pasted (fetched on Enter), a folder (dropped anywhere on the dialog, or picked), or one made with the agent (a
 * message put in the composer; only where there is a project's chat). What came is looked at before it is kept: each
 * skill, its size, the scripts it brings, one of the same name it would replace. Closing before it is kept lets it go.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, ArrowRight, Blocks, Check, ChevronRight, FolderPlus, Loader2, Sparkles, X } from 'lucide-react';
import { keepFocus } from './Popover';
import { useT } from '@/i18n';
import { chatLayer } from '@/lib/chat-layer';
import { app, type SkillInfo, type SkillPreview } from '../app-bridge';

const QUIET_BUTTON = 'h-9 rounded-[9px] px-3.5 text-[13px] text-[var(--text-dim)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)] disabled:opacity-40';
const MAIN_BUTTON = 'flex h-9 items-center gap-1.5 rounded-[9px] bg-[var(--text)] px-4 text-[13px] font-medium text-[var(--bg)] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40';
const LABEL = 'mb-2 text-[11.5px] font-medium text-[var(--text-faint)]';

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

export function AddSkillDialog({ onClose, onAdded, onPick, onMake }: {
  onClose: () => void; onAdded: () => Promise<void>;
  /** naming the one added in the message, and making one with the agent: only where there is a message (a project's chat) */
  onPick?: (skill: PickedSkill) => void; onMake?: () => void;
}) {
  const t = useT();
  const [url, setUrl] = React.useState('');
  const [step, setStep] = React.useState<'choose' | 'fetching' | 'look' | 'adding' | 'added'>('choose');
  const [error, setError] = React.useState<string | null>(null);
  const [fetched, setFetched] = React.useState<{ id: string; skills: SkillPreview[] } | null>(null);
  const [added, setAdded] = React.useState<SkillInfo[]>([]);
  const [dragging, setDragging] = React.useState(false);
  const waiting = React.useRef<string | null>(null);

  const letGo = () => {
    if (waiting.current) void app.skills.discard(waiting.current);
    waiting.current = null;
    setFetched(null);
  };
  const close = () => { letGo(); onClose(); };
  /* closed some other way before it was kept: let go */
  React.useEffect(() => () => { if (waiting.current) void app.skills.discard(waiting.current); }, []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const look = async (preview: () => ReturnType<typeof app.skills.previewFolder>) => {
    setStep('fetching');
    setError(null);
    const r = await preview().catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    if (!r.ok) { if (!('cancelled' in r)) setError(r.error); setStep('choose'); return; }
    waiting.current = r.id;
    setFetched({ id: r.id, skills: r.skills });
    setStep('look');
  };
  const fetchIt = () => { if (url.trim() && step === 'choose') void look(() => app.skills.preview(url.trim())); };
  const pickFolder = () => { if (step === 'choose') void look(() => app.skills.previewFolder(null, { title: t('skills.folderDialog'), button: t('skills.add') })); };
  const keep = async () => {
    if (!fetched) return;
    setStep('adding');
    const r = await app.skills.commit(fetched.id).catch((e: unknown) => ({ ok: false as const, error: e instanceof Error ? e.message : String(e) }));
    waiting.current = null;
    if (!r.ok) { setError(r.error); setStep('choose'); setFetched(null); return; }
    setAdded(r.skills);
    setStep('added');
    await onAdded();
  };

  const scripts = (fetched?.skills ?? []).reduce((n, s) => n + s.scripts.length, 0);
  const replaces = (fetched?.skills ?? []).filter((s) => s.replaces).map((s) => s.name);
  const item = (s: { name: string; description: string }, facts?: string) => (
    <div key={s.name} className="flex items-start gap-3 rounded-[10px] bg-[var(--surface-2)] px-3 py-2.5">
      <span className="mt-[1px] flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--bg-surface)] text-[var(--text-dim)]"><Blocks size={15} strokeWidth={1.75} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-[var(--text)]">{s.name}</span>
        {s.description ? <span className="mt-0.5 line-clamp-2 block text-[12px] leading-[17px] text-[var(--text-muted)]">{s.description}</span> : null}
        {facts ? <span className="mt-1 block text-[11.5px] text-[var(--text-faint)]">{facts}</span> : null}
      </span>
    </div>
  );

  let body: React.ReactNode;
  if (step === 'added') {
    body = (
      <>
        <p className="mb-3 flex items-center gap-1.5 text-[13px] text-[var(--text)]"><Check size={15} className="text-[#3ecf8e]" />{t('skills.addedTitle')}</p>
        <div className="flex flex-col gap-2">{added.map((s) => item(s))}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onMouseDown={keepFocus} onClick={onClose} className={QUIET_BUTTON}>{t('skills.done')}</button>
          {added.length === 1 && onPick ? <button type="button" onMouseDown={keepFocus} onClick={() => { onPick({ name: added[0]!.name, description: added[0]!.description }); onClose(); }} className={MAIN_BUTTON}>{t('skills.useIt')}</button> : null}
        </div>
      </>
    );
  } else if ((step === 'look' || step === 'adding') && fetched) {
    body = (
      <>
        <div className="flex max-h-[260px] flex-col gap-2 overflow-y-auto">
          {fetched.skills.map((s) => item(s, [sizeOf(s.size), s.scripts.length ? t('skills.scriptsCount').replace('{n}', String(s.scripts.length)) : null].filter(Boolean).join(' · ')))}
        </div>
        {replaces.length ? <p className="mt-3 text-[12px] leading-[17px] text-[var(--text-muted)]">{t('skills.replaceNote').replace('{names}', replaces.join(', '))}</p> : null}
        {scripts ? (
          <p className="mt-3 flex gap-2 rounded-[10px] bg-[var(--surface-2)] px-3 py-2.5 text-[12px] leading-[17px] text-[var(--text-muted)]">
            <AlertTriangle size={14} className="mt-[1px] shrink-0 text-[var(--warn)]" />
            <span>{t('skills.scriptsWarning').replace('{n}', String(scripts))}</span>
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onMouseDown={keepFocus} onClick={() => { letGo(); setStep('choose'); }} disabled={step === 'adding'} className={QUIET_BUTTON}>{t('skills.cancel')}</button>
          <button type="button" onMouseDown={keepFocus} onClick={() => void keep()} disabled={step === 'adding'} className={MAIN_BUTTON}>
            {step === 'adding' ? <><Loader2 size={13} className="animate-spin" />{t('skills.adding')}</> : t(replaces.length ? 'skills.replaceAndAdd' : 'skills.add')}
          </button>
        </div>
      </>
    );
  } else {
    const busy = step === 'fetching';
    body = (
      <>
        <div className={LABEL}>{t('skills.fromLink')}</div>
        <form onSubmit={(e) => { e.preventDefault(); fetchIt(); }}
          className="flex h-10 items-center gap-1 rounded-[10px] border border-[var(--border)] bg-[var(--surface-2)] pl-3 pr-1 transition focus-within:border-[var(--border-strong)]">
          <input autoFocus value={url} onChange={(e) => { setUrl(e.target.value); setError(null); }} placeholder="https://github.com/…" disabled={busy} spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
          <button type="submit" disabled={!url.trim() || busy} aria-label={t('skills.next')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--text)] text-[var(--bg)] transition hover:opacity-90 disabled:bg-transparent disabled:text-[var(--text-faint)]">
            {busy && url.trim() ? <Loader2 size={14} className="animate-spin text-[var(--text-dim)]" /> : <ArrowRight size={15} />}
          </button>
        </form>
        <p className={`mt-1.5 text-[11.5px] leading-[16px] ${error ? 'text-[var(--err)]' : 'text-[var(--text-faint)]'}`}>{error ?? t('skills.addHint')}</p>

        <div className={`${LABEL} mt-5`}>{t('skills.fromFolderTitle')}</div>
        <button type="button" onMouseDown={keepFocus} onClick={pickFolder} disabled={busy}
          className={`flex h-[92px] w-full flex-col items-center justify-center gap-1.5 rounded-[10px] border border-dashed text-center transition disabled:opacity-50
            ${dragging ? 'border-[var(--text-muted)] bg-[var(--bg-hover)]' : 'border-[var(--border-strong)] hover:bg-[var(--bg-hover)]'}`}>
          <FolderPlus size={18} strokeWidth={1.6} className="text-[var(--text-dim)]" />
          <span className="text-[12.5px] text-[var(--text)]">{t('skills.dropHere')}</span>
          <span className="text-[11.5px] text-[var(--text-faint)]">{t('skills.orPick')}</span>
        </button>

        {onMake ? (
          <>
            <div className={`${LABEL} mt-5`}>{t('skills.makeTitle')}</div>
            <button type="button" onMouseDown={keepFocus} onClick={() => { onMake(); onClose(); }} disabled={busy}
              className="flex w-full items-center gap-3 rounded-[10px] border border-[var(--border)] px-3 py-2.5 text-left transition hover:bg-[var(--bg-hover)] disabled:opacity-50">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-2)] text-[var(--text-dim)]"><Sparkles size={15} strokeWidth={1.75} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] text-[var(--text)]">{t('skills.make')}</span>
                <span className="block text-[11.5px] leading-[16px] text-[var(--text-muted)]">{t('skills.makeHint')}</span>
              </span>
              <ChevronRight size={15} className="shrink-0 text-[var(--text-faint)]" />
            </button>
          </>
        ) : null}
      </>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[10060] grid place-items-center bg-black/45 p-6" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('skills.addTitle')}
        className="relative w-[min(440px,calc(100vw-24px))] rounded-[14px] border border-[var(--border-strong)] bg-[var(--bg-surface)] p-5 shadow-[0_24px_64px_rgba(0,0,0,0.4)]"
        onDragOver={(e) => { if (!dragsFiles(e) || step !== 'choose') return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={(e) => {
          if (!dragsFiles(e)) return;
          e.preventDefault();
          setDragging(false);
          const path = droppedPath(e);
          if (path && step === 'choose') void look(() => app.skills.previewFolder(path));
        }}>
        <div className="mb-4 flex items-center gap-2">
          <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-[var(--text)]">{t('skills.addTitle')}</h2>
          <button type="button" onMouseDown={keepFocus} onClick={close} aria-label={t('skills.cancel')}
            className="flex h-7 w-7 items-center justify-center rounded-[7px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><X size={15} /></button>
        </div>
        {body}
      </div>
    </div>,
    chatLayer(),
  );
}
