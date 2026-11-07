/**
 * On the notice of a turn that failed: the diagnostic report on the clipboard, to paste into an issue (the app's main.mjs makes it:
 * what OpenFilm finds on this computer, the last week's problems, the agents). Not shown by a shell that lacks it.
 */
import React from 'react';
import { useT } from '@/i18n';
import { desktopBridge } from '@/lib/desktop-bridge';
import { CardButton } from './ComposerCard';

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
    <CardButton weight="quiet" onClick={run} disabled={state === 'making'} title={t('composer.copyDiagnosticsHint')}>
      {state === 'copied' ? t('composer.diagnosticsCopied') : t('composer.copyDiagnostics')}
    </CardButton>
  );
}
