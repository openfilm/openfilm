/**
 * "What's new" after an update (lib/whats-new.ts): once Studio runs a newer version than the one whose notes were last
 * shown, the notes since then, in the language shown, grouped as new, improved and fixed; under them, scrolling on,
 * every earlier release's, so the whole history reads in the person's language (the changelog on GitHub, a click
 * away, is in English). Closing it marks this version seen. A new install shows nothing (it only remembers the
 * version). Settings › About shows this release's notes again, and Developer previews the newest (WHATS_NEW_EVENT).
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Sparkles, Wrench, Zap, X } from 'lucide-react';
import { api } from '@/api';
import { useLanguage, useT } from '@/i18n';
import { RELEASES, WHATS_NEW_EVENT, compareVersions, notesToShow, releaseNotes, type NoteKind, type ReleaseNotes } from '@/lib/whats-new';

const CHANGELOG = 'https://github.com/openfilm/openfilm/releases';
const KINDS: readonly NoteKind[] = ['new', 'improved', 'fixed'];
const KIND_ICON: Record<NoteKind, React.ReactNode> = {
  new: <Sparkles size={14} aria-hidden />,
  improved: <Zap size={14} aria-hidden />,
  fixed: <Wrench size={14} aria-hidden />,
};

export function WhatsNew() {
  const t = useT();
  const [shown, setShown] = React.useState<ReleaseNotes[] | null>(null);
  /** the version to mark seen when closed (after an update), null when opened on asking */
  const [marking, setMarking] = React.useState<string | null>(null);

  /* after an update: the notes since the version last shown; a new install only remembers its version */
  React.useEffect(() => {
    let live = true;
    void Promise.all([api.version(), api.prefs()]).then(([v, prefs]) => {
      if (!live) return;
      const current = v.version;
      if (!prefs.seenVersion) { void api.setPrefs({ seenVersion: current }).catch(() => {}); return; }
      if (compareVersions(prefs.seenVersion, current) >= 0) return;
      const list = notesToShow(prefs.seenVersion, current);
      if (list.length) { setShown(list); setMarking(current); } else void api.setPrefs({ seenVersion: current }).catch(() => {});
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  /* asked for (Settings › About, Developer): those versions' notes */
  React.useEffect(() => {
    const onAsk = (event: Event) => {
      const versions = (event as CustomEvent<string[]>).detail ?? [];
      const list = versions.map((v) => releaseNotes(v)).filter((r): r is ReleaseNotes => r !== null);
      if (list.length) setShown(list);
    };
    window.addEventListener(WHATS_NEW_EVENT, onAsk);
    return () => window.removeEventListener(WHATS_NEW_EVENT, onAsk);
  }, []);

  const close = React.useCallback(() => {
    if (marking) void api.setPrefs({ seenVersion: marking }).catch(() => {});
    setMarking(null);
    setShown(null);
  }, [marking]);

  React.useEffect(() => {
    if (!shown) return undefined;
    /* Escape closes this alone: Settings, under it, leaves a key already handled */
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [shown, close]);

  if (!shown || typeof document === 'undefined') return null;
  const newest = shown[0];
  /* the releases before those shown, the newest first */
  const oldest = shown[shown.length - 1];
  const earlier = RELEASES.filter((r) => compareVersions(r.version, oldest.version) < 0);

  return createPortal(
    /* over Settings (z 10050), where About and Developer open it */
    <div className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(760px,88vh)] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)]"
      >
        <div className="flex items-start gap-3 px-6 pb-2 pt-6">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-medium uppercase tracking-[0.08em] text-[var(--text-faint)]">{t('whatsNew.eyebrow')}</p>
            <h2 id="whats-new-title" className="mt-1 text-[20px] font-semibold text-[var(--text)]">
              {t('whatsNew.title').replace('{version}', newest.version)}
            </h2>
          </div>
          <button type="button" onClick={close} aria-label={t('whatsNew.close')}
            className="-mr-2 -mt-1 rounded-lg p-1.5 text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
          {shown.map((release) => <Release key={release.version} release={release} heading={shown.length > 1} />)}
          {earlier.length > 0 && (
            <>
              <p className="mt-2 border-t border-[var(--border)] pt-4 text-[11.5px] font-medium uppercase tracking-[0.08em] text-[var(--text-faint)]">
                {t('whatsNew.earlier')}
              </p>
              {earlier.map((release) => <Release key={release.version} release={release} heading />)}
            </>
          )}
        </div>
        <div className="flex items-center gap-3 border-t border-[var(--border)] px-6 py-4">
          <a href={CHANGELOG} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-[13px] text-[var(--text-muted)] transition hover:text-[var(--text)]">
            {t('whatsNew.changelog')}<ArrowUpRight size={14} aria-hidden />
          </a>
          <button type="button" onClick={close} autoFocus
            className="ml-auto inline-flex h-9 items-center justify-center rounded-[8px] bg-[var(--text)] px-5 text-[14px] font-medium text-[var(--bg)] transition hover:opacity-90">
            {t('whatsNew.ok')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** One release's notes in the language shown, grouped as new, improved and fixed; `heading`: its version beside its date. */
function Release({ release, heading }: { release: ReleaseNotes; heading: boolean }) {
  const t = useT();
  const language = useLanguage();
  const notes = release.notes[language] ?? release.notes.en;
  const d = new Date(`${release.date}T12:00:00`);
  const date = Number.isNaN(d.getTime()) ? release.date : d.toLocaleDateString(language, { year: 'numeric', month: 'long', day: 'numeric' });
  return (
    <section className="py-3">
      <p className="mb-2.5 text-[12.5px] text-[var(--text-muted)]">
        {heading ? <span className="font-medium text-[var(--text)]">{`OpenFilm ${release.version} · `}</span> : null}{date}
      </p>
      <div className="flex flex-col gap-3.5">
        {KINDS.map((kind) => {
          const items = notes.filter((n) => n.kind === kind);
          if (!items.length) return null;
          return (
            <div key={kind}>
              <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--text)]">
                <span className="text-[var(--text-muted)]">{KIND_ICON[kind]}</span>
                {t(`whatsNew.kind.${kind}`)}
              </p>
              <ul className="flex flex-col gap-1.5 pl-5">
                {items.map((n, i) => (
                  <li key={i} className="list-disc text-[13.5px] leading-[1.6] text-[var(--text-muted)] marker:text-[var(--text-faint)]">{n.text}</li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Whether this release has notes to show again (Settings › About). */
export const hasNotes = (version: string | undefined) => Boolean(version && releaseNotes(version));
/** The newest release's notes, for a preview before it ships (Developer). */
export const newestVersion = () => RELEASES[0]?.version ?? null;
