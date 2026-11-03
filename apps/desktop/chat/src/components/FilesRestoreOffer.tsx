/**
 * Under the reply of a turn that ended with files of the project gone (lib/files-restore): which, and one click that
 * puts them back as the turn found them. Done, it says so; a file written meanwhile is left as it is.
 */
import React from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { useT } from '@/i18n';
import { ChatProjectContext } from '@/lib/developer';
import { lostNames, restoreFilesBefore, type FilesRestoreState } from '@/lib/files-restore';
import { app } from '../app-bridge';

export function FilesRestoreOffer({ turnId, lost }: { turnId: string; lost: readonly string[] }) {
  const t = useT();
  const project = React.useContext(ChatProjectContext);
  const [state, setState] = React.useState<FilesRestoreState>('offer');
  const restore = app.chat.restoreFiles;
  if (!project || !restore) return null;
  const done = state === 'restored' || state === 'exists' || state === 'gone';
  const said = state === 'offer' || state === 'restoring' ? t('filesRestore.lost').replace('{names}', () => lostNames(lost)) : t(`filesRestore.${state}`);
  return (
    <div role="status" data-files-restore={state} className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-[var(--border)] px-3 py-2.5 text-[12.5px] leading-snug text-[var(--chat-text)]">
      <span className="flex items-start gap-2">
        {state === 'restored' ? null : <TriangleAlert size={14} className="mt-px shrink-0 text-[var(--chat-hint)]" aria-hidden />}
        <span className="min-w-0 break-words" title={lost.join('\n')}>{said}</span>
      </span>
      {done ? null : (
        <button
          type="button"
          disabled={state === 'restoring'}
          onClick={() => {
            setState('restoring');
            void restoreFilesBefore(restore, project, turnId).then(setState);
          }}
          className="flex w-fit items-center gap-1.5 rounded-md bg-[var(--text)] px-2.5 py-1 text-[12.5px] text-[var(--panel)] transition hover:opacity-90 disabled:opacity-60"
        >
          <RotateCcw size={13} aria-hidden />
          {state === 'restoring' ? t('filesRestore.restoring') : t('filesRestore.restore')}
        </button>
      )}
    </div>
  );
}
