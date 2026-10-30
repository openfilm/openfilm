/**
 * Under the reply of a turn that ended with film.html gone (lib/film-restore): what happened, and one click that puts
 * film.html back as the turn found it. Done, it says so; a film written meanwhile is left as it is.
 */
import React from 'react';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { useT } from '@/i18n';
import { ChatProjectContext } from '@/lib/developer';
import { restoreFilmBefore, type FilmRestoreState } from '@/lib/film-restore';
import { app } from '../app-bridge';

export function FilmRestoreOffer({ turnId }: { turnId: string }) {
  const t = useT();
  const project = React.useContext(ChatProjectContext);
  const [state, setState] = React.useState<FilmRestoreState>('offer');
  const restore = app.chat.restoreFilm;
  if (!project || !restore) return null;
  const done = state === 'restored' || state === 'exists' || state === 'gone';
  const said = state === 'offer' || state === 'restoring' ? t('filmRestore.lost') : t(`filmRestore.${state}`);
  return (
    <div role="status" data-film-restore={state} className="flex min-w-0 flex-col gap-2 rounded-[10px] border border-[var(--border)] px-3 py-2.5 text-[12.5px] leading-snug text-[var(--chat-text)]">
      <span className="flex items-start gap-2">
        {state === 'restored' ? null : <TriangleAlert size={14} className="mt-px shrink-0 text-[var(--chat-hint)]" aria-hidden />}
        <span className="min-w-0 break-words">{said}</span>
      </span>
      {done ? null : (
        <button
          type="button"
          disabled={state === 'restoring'}
          onClick={() => {
            setState('restoring');
            void restoreFilmBefore(restore, project, turnId).then(setState);
          }}
          className="flex w-fit items-center gap-1.5 rounded-md bg-[var(--text)] px-2.5 py-1 text-[12.5px] text-[var(--panel)] transition hover:opacity-90 disabled:opacity-60"
        >
          <RotateCcw size={13} aria-hidden />
          {state === 'restoring' ? t('filmRestore.restoring') : t('filmRestore.restore')}
        </button>
      )}
    </div>
  );
}
