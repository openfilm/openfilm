/**
 * By a turn that failed: the diagnostic report on the clipboard, to paste into an issue (the app's main.mjs makes it:
 * what OpenFilm finds on this computer, the last week's problems, the agents). Not shown by a shell that lacks it.
 */
import React from 'react';
import { useT } from '@/i18n';
import { desktopBridge } from '@/lib/desktop-bridge';

export function CopyDiagnostics() {
  const t = useT();
  const copy = desktopBridge()?.agents?.copyReport;
  const [state, setState] = React.useState<'idle' | 'making' | 'copied'>('idle');
  if (!copy) return null;
  const run = () => {
    setState('making');
    void copy().then((r) => setState(r.ok ? 'copied' : 'idle'), () => setState('idle'));
  };
  return (
    <button type="button" onClick={run} disabled={state === 'making'} title={t('composer.copyDiagnosticsHint')}
      className="underline underline-offset-2 hover:text-[var(--text)] disabled:opacity-60">
      {state === 'copied' ? t('composer.diagnosticsCopied') : t('composer.copyDiagnostics')}
    </button>
  );
}
