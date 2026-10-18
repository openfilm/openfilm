/**
 * Settings → Developer's Diagnostics, for when something does not work and a person wants to say why: the report to
 * copy (short: `openfilm doctor` with the last week's problems, this browser, the desktop app's agents; lib/diagnostics),
 * the diagnostic file to export (the rest: the logs and the failed turns, zipped; server/diagnostics.mjs), and the
 * problems of the last two weeks, newest first.
 */
import React from 'react';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { studioHost } from '@/lib/host';
import { fullReport, pageFacts } from '@/lib/diagnostics';
import { api, type StudioProblem } from '@/api';
import { SettingsButton, SettingsGroup, SettingsInset, SettingsItem, SettingsSwitch } from './ui';

/** The report as text, made now: the computer's (with its problems), this browser's, and the app's agents. */
async function makeReport(): Promise<string> {
  const [computer, app] = await Promise.all([api.doctor(), studioHost?.agents?.report?.().catch(() => null) ?? null]);
  return fullReport(computer.text, pageFacts(), app);
}

/**
 * Copying the report: its state, and the report itself when the browser does not let the page copy (an agent's
 * preview pane may not), to select by hand.
 */
export function useReportCopy() {
  const [state, setState] = React.useState<'idle' | 'making' | 'copied' | 'failed'>('idle');
  const [shown, setShown] = React.useState<string | null>(null);
  const copy = () => {
    setState('making');
    void makeReport()
      .then((text) => navigator.clipboard.writeText(text).then(() => { setShown(null); setState('copied'); }, () => { setShown(text); setState('idle'); }))
      .catch(() => setState('failed'));
  };
  return { state, shown, copy };
}

/** The button that copies the report, as Settings → Developer and an agent with a problem (Settings → Agents) show it. */
export function CopyReportButton({ copying, variant = 'default' }: { copying: ReturnType<typeof useReportCopy>; variant?: 'default' | 'quiet' }) {
  const t = useT();
  const { state, copy } = copying;
  return (
    <SettingsButton variant={variant} disabled={state === 'making'} onClick={copy}>
      {state === 'making' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : state === 'copied' ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
      {state === 'making' ? t('settings.report.making') : state === 'copied' ? t('settings.report.copied') : t('settings.report.copy')}
    </SettingsButton>
  );
}

/** The report to select, where the page could not copy it. */
export function ReportText({ text }: { text: string }) {
  const t = useT();
  return (
    <textarea readOnly value={text} rows={12} aria-label={t('settings.report.title')} onFocus={(e) => e.currentTarget.select()}
      className="mb-2 w-full resize-y rounded-md border border-[var(--border)] bg-[var(--surface-2)] p-2 font-mono text-[11.5px] leading-snug text-[var(--text)]" />
  );
}

/** The report as a link to copy it, under an agent's problem (Settings → Agents). */
export function ReportLink() {
  const t = useT();
  const copying = useReportCopy();
  return (
    <>
      <p className="text-[13.5px] leading-relaxed text-[var(--text-muted)]">
        <button type="button" onClick={copying.copy} disabled={copying.state === 'making'} title={t('settings.report.hint')}
          className="underline underline-offset-2 hover:text-[var(--text)] disabled:opacity-60">
          {copying.state === 'making' ? t('settings.report.making') : copying.state === 'copied' ? t('settings.report.copied') : t('settings.report.copy')}
        </button>
        {copying.state === 'failed' ? ` ${t('settings.report.failed')}` : null}
      </p>
      {copying.shown ? <ReportText text={copying.shown} /> : null}
    </>
  );
}

/**
 * What an exported file holds, in words, from the names of what went in (server/diagnostics.mjs): each part once, the
 * logs and the turns counted.
 */
function fileParts(files: string[], conversations: boolean, t: (key: string) => string): string[] {
  const count = (prefix: string) => files.filter((f) => f.startsWith(prefix)).length;
  const logs = count('logs/');
  const turns = count('turns/');
  return [
    ...(files.includes('report.txt') ? [t('settings.report.partReport')] : []),
    ...(files.includes('problems.jsonl') ? [t('settings.report.partProblems')] : []),
    ...(logs ? [t('settings.report.partLogs').replace('{count}', String(logs))] : []),
    ...(turns ? [t(conversations ? 'settings.report.partTurnsWords' : 'settings.report.partTurns').replace('{count}', String(turns))] : []),
    ...(files.includes('agents/codex.txt') ? [t('settings.report.partCodex')] : []),
  ];
}

/* what turning on "Include what was said" adds, said in full before it is on */
const ADDS = ['settings.report.adds1', 'settings.report.adds2', 'settings.report.adds3', 'settings.report.adds4', 'settings.report.adds5'];

/** How many problems show before "Show all". */
const PROBLEMS_SHOWN = 5;

export function DiagnosticsGroup() {
  const t = useT();
  const locale = useLanguage();
  const copying = useReportCopy();
  /* what was said in failed turns: off unless the person turns it on, and only after reading what it adds (`asking`) */
  const [conversations, setConversations] = React.useState(false);
  const [asking, setAsking] = React.useState(false);
  const [exporting, setExporting] = React.useState<{ state: 'idle' | 'making' | 'failed' } | { state: 'done'; name: string; parts: string[] }>({ state: 'idle' });
  const [problems, setProblems] = React.useState<StudioProblem[] | null>(null);
  const [all, setAll] = React.useState(false);
  React.useEffect(() => { void api.problems().then(setProblems, () => setProblems([])); }, []);

  const exportFile = () => {
    setExporting({ state: 'making' });
    void makeReport()
      .then((report) => api.exportDiagnostics(report, conversations))
      .then((made) => setExporting({ state: 'done', name: made.path.split(/[\\/]/).pop() ?? made.path, parts: fileParts(made.files, made.conversations, t) }))
      .catch(() => setExporting({ state: 'failed' }));
  };

  const when = (iso: string) => {
    const at = new Date(iso);
    return Number.isNaN(at.getTime()) ? iso : at.toLocaleString(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  const shown = problems ? (all ? problems : problems.slice(0, PROBLEMS_SHOWN)) : [];

  return (
    <SettingsGroup title={t('settings.report.group')}>
      <SettingsItem
        title={t('settings.report.title')}
        description={copying.state === 'failed' ? t('settings.report.failed') : copying.shown ? t('settings.report.select') : t('settings.report.hint')}
        control={<CopyReportButton copying={copying} />}
      >
        {copying.shown ? <ReportText text={copying.shown} /> : null}
      </SettingsItem>
      <SettingsItem
        title={t('settings.report.conversations')}
        description={conversations ? t('settings.report.conversationsOn') : t('settings.report.conversationsHint')}
        control={(
          <SettingsSwitch checked={conversations || asking} label={t('settings.report.conversations')}
            onChange={(on) => { if (on) setAsking(true); else { setAsking(false); setConversations(false); } }} />
        )}
      >
        {asking ? (
          <SettingsInset>
            <p className="text-[14px] font-medium text-[var(--text)]">{t('settings.report.addsTitle')}</p>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-[13.5px] leading-relaxed text-[var(--text)]">
              {ADDS.map((key) => <li key={key}>{t(key)}</li>)}
            </ul>
            <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">{t('settings.report.addsKept')}</p>
            <p className="text-[13px] leading-relaxed text-[var(--warn)]">{t('settings.report.addsWho')}</p>
            <div className="flex justify-end gap-1.5">
              <SettingsButton variant="quiet" onClick={() => setAsking(false)}>{t('settings.report.addsNo')}</SettingsButton>
              <SettingsButton onClick={() => { setAsking(false); setConversations(true); }}>{t('settings.report.addsYes')}</SettingsButton>
            </div>
          </SettingsInset>
        ) : null}
      </SettingsItem>
      <SettingsItem
        title={t('settings.report.export')}
        description={exporting.state === 'failed' ? t('settings.report.exportFailed')
          : exporting.state === 'done' ? t('settings.report.exported').replace('{name}', exporting.name)
            : t('settings.report.exportHint')}
        control={(
          <SettingsButton disabled={exporting.state === 'making' || asking} onClick={exportFile}>
            {exporting.state === 'making' ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Download size={15} aria-hidden />}
            {exporting.state === 'making' ? t('settings.report.exporting') : t('settings.report.exportButton')}
          </SettingsButton>
        )}
      >
        {exporting.state === 'done' ? (
          <div className="mb-2 text-[13px] leading-relaxed text-[var(--text-muted)]">
            <p>{t('settings.report.exportedHas')}</p>
            <ul className="list-disc pl-5">{exporting.parts.map((part) => <li key={part}>{part}</li>)}</ul>
          </div>
        ) : null}
      </SettingsItem>
      <SettingsItem
        title={t('settings.report.problems')}
        description={problems && !problems.length ? t('settings.report.noProblems') : t('settings.report.problemsHint')}
      >
        {shown.length ? (
          <ul className="mb-2 flex flex-col gap-1.5">
            {shown.map((p, i) => (
              <li key={`${p.t}:${i}`} className="min-w-0 rounded-md bg-[var(--surface-2)] px-2.5 py-1.5 text-[12.5px] leading-snug">
                <div className="flex gap-2 text-[var(--text-muted)]">
                  <span className="shrink-0 tabular-nums">{when(p.t)}</span>
                  <span className="truncate">{[p.agent ?? p.area, p.step].filter(Boolean).join(' · ')}</span>
                </div>
                <div className="break-words text-[var(--text)]">{p.what}</div>
              </li>
            ))}
          </ul>
        ) : null}
        {problems && problems.length > PROBLEMS_SHOWN && !all ? (
          <button type="button" onClick={() => setAll(true)}
            className="mb-2 text-[13px] text-[var(--text-muted)] underline underline-offset-2 transition hover:text-[var(--text)]">
            {t('settings.report.more').replace('{count}', String(problems.length))}
          </button>
        ) : null}
      </SettingsItem>
    </SettingsGroup>
  );
}
