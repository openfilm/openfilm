/**
 * The library while a cover is designed: its Templates (none, or a look of words and shapes laid over the cover's
 * picture, by category; the pointer resting on one tries it on the cover, a click puts it on, the words already written
 * kept), and its Picture, what lies under the look: a shot of the film, a picture of this computer, a color, or one made
 * with AI (those made before kept to go back to). What a cover is, and how it is made, is studio/server/covers.mjs.
 */
import React from 'react';
import { Ban, ImagePlus, Sparkles } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { nameOf } from '@/lib/library';
import { COVER_COLORS, filmThumb, lookPoster, type CoverLook, type CoverLooks } from '@/lib/covers';

const HOVER_MS = 260;
import { FOOT_ROOM } from './AudioList';

export interface CoversActions {
  /** The project the covers are of (the film's). */
  projectId: string;
  looks: CoverLooks | null;
  /** The look the cover has now (its id), lit among them. */
  lookNow: string | null;
  /** The film's shots, a moment of each (seconds). */
  shots: readonly number[];
  /** What is being made now: a look's id, `picture`, or null. */
  busy: string | null;
  apply: (look: CoverLook) => void;
  /** No look: only the picture. */
  none: () => void;
  /** A look tried on the cover while the pointer rests on it (null: no longer). */
  preview: (look: CoverLook | null) => void;
  /** Pictures made for the covers before, the newest first, and how each is drawn small. */
  made: readonly string[];
  thumbOf: (path: string) => string;
  /** A made picture as the picture. */
  use: (path: string) => void;
  /** The AI panel. */
  openAi: () => void;
  /** A moment of the film as the picture. */
  moment: (seconds: number) => void;
  /** A picture of this computer as the picture. */
  local: (file: File) => void;
  /** A color or a gradient as the picture. */
  color: (css: string) => void;
}

/** The drawer's two categories while a cover is open, and what each one's side bar picks. */
export type CoversCategory = 'cover' | 'coverPicture';
export type CoversLine = string;

export function CoversPane({ actions, category, line }: { actions: CoversActions; category: CoversCategory; line: CoversLine }) {
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto px-3 pt-3 ${FOOT_ROOM}`} data-covers-pane={category}>
      {category === 'cover' ? <Looks actions={actions} category={line} />
        : <Picture actions={actions} line={line === 'local' || line === 'color' || line === 'ai' ? line : 'film'} />}
    </div>
  );
}

function Looks({ actions, category }: { actions: CoversActions; category: string }) {
  const t = useT();
  const lang = useLanguage();
  const hover = React.useRef<number | null>(null);
  const items = actions.looks?.items ?? [];
  const shown = category ? items.filter((l) => l.categories?.includes(category)) : items;
  const stop = () => { if (hover.current) window.clearTimeout(hover.current); hover.current = null; actions.preview(null); };
  React.useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps
  const card = (on: boolean, body: React.ReactNode) => (
    <span className={`relative block aspect-video overflow-hidden rounded-[6px] bg-[var(--bg-field)] ring-1 transition ${on ? 'ring-2 ring-[var(--accent)]' : 'ring-[var(--border)] group-hover:ring-[var(--text-faint)]'}`}>{body}</span>
  );
  return (
    <>
      <p className="mb-2 text-[11.5px] font-medium text-[var(--text-muted)]">{t('covers.lookDefault')}</p>
      <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-x-2.5">
        <button type="button" data-cover-look="" disabled={actions.busy != null} onClick={() => { stop(); actions.none(); }} aria-pressed={actions.lookNow == null}
          className="group flex flex-col gap-1 text-left disabled:opacity-60" title={t('covers.lookNoneTip')}>
          {card(actions.lookNow == null, <span className="absolute inset-0 flex items-center justify-center text-[var(--text-faint)]"><Ban size={22} strokeWidth={1.5} /></span>)}
          <span className="truncate text-[11.5px] text-[var(--text)]">{t('covers.lookNone')}</span>
        </button>
      </div>
      <p className="mb-2 text-[11.5px] font-medium text-[var(--text-muted)]">{t('covers.lookTry')}</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-x-2.5 gap-y-3" onPointerLeave={stop}>
        {shown.map((look) => {
          const on = actions.lookNow === look.id;
          return (
            <button key={look.id} type="button" data-cover-look={look.id} disabled={actions.busy != null}
              onClick={() => { stop(); actions.apply(look); }}
              onPointerEnter={() => { if (hover.current) window.clearTimeout(hover.current); hover.current = window.setTimeout(() => actions.preview(look), HOVER_MS); }}
              title={look.about} aria-pressed={on} className="group flex flex-col gap-1 text-left disabled:opacity-60">
              {card(on, <>
                <img src={lookPoster(look)} alt="" draggable={false} className="h-full w-full object-cover" />
                {actions.busy === look.id ? <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] text-white">{t('covers.working')}</span> : null}
              </>)}
              <span className="truncate text-[11.5px] text-[var(--text)]">{nameOf(look.name, lang)}</span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function Picture({ actions, line }: { actions: CoversActions; line: 'film' | 'local' | 'color' | 'ai' }) {
  const t = useT();
  const input = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const busy = actions.busy != null;
  const pictureOf = (files: FileList | null) => [...(files ?? [])].find((f) => f.type.startsWith('image/')) ?? null;
  if (line === 'film') {
    return (
      <>
        <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-faint)]">{t('covers.shotsNote')}</p>
        {actions.shots.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(124px,1fr))] gap-x-2.5 gap-y-3">
            {actions.shots.map((s, i) => (
              <button key={s} type="button" data-cover-shot={s} disabled={busy} onClick={() => actions.moment(s)} className="group flex flex-col gap-1 text-left disabled:opacity-60">
                <img src={filmThumb(actions.projectId, s * 1000, 240)} alt="" draggable={false}
                  className="aspect-video w-full rounded-[6px] bg-[var(--bg-field)] object-cover ring-1 ring-[var(--border)] transition group-hover:ring-[var(--text-faint)]" />
                <span className="text-[11.5px] tabular-nums text-[var(--text-muted)]">{t('covers.shot').replace('{n}', String(i + 1))} · {clock(s)}</span>
              </button>
            ))}
          </div>
        ) : <p className="text-[12px] text-[var(--text-faint)]">{t('covers.noShots')}</p>}
      </>
    );
  }
  if (line === 'local') {
    return (
      <div
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); const f = pictureOf(e.dataTransfer.files); if (f) actions.local(f); }}
        className={`flex flex-col items-center gap-2 rounded-md border border-dashed px-3 py-8 ${over ? 'border-[var(--accent)] bg-[var(--accent-soft)]' : 'border-[var(--border-strong)]'}`}>
        <ImagePlus size={22} strokeWidth={1.6} className="text-[var(--text-muted)]" />
        <button type="button" disabled={busy} onClick={() => input.current?.click()}
          className="h-8 rounded-md bg-[var(--bg-field)] px-3 text-[12px] font-medium text-[var(--text)] hover:bg-[var(--bg-hover)] disabled:opacity-50">
          {busy ? t('covers.working') : t('covers.localGo')}
        </button>
        <span className="text-[11px] text-[var(--text-faint)]">{t('covers.localDrop')}</span>
        <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = pictureOf(e.target.files); e.target.value = ''; if (f) actions.local(f); }} />
      </div>
    );
  }
  if (line === 'color') {
    return (
      <>
        <p className="mb-3 text-[11px] leading-relaxed text-[var(--text-faint)]">{t('covers.colorsNote')}</p>
        <div className="grid grid-cols-4 gap-2">
          {COVER_COLORS.map((css) => (
            <button key={css} type="button" data-cover-color={css} disabled={busy} onClick={() => actions.color(css)} title={css}
              className="aspect-square rounded-md ring-1 ring-[var(--border)] transition hover:ring-[var(--text-faint)] disabled:opacity-50" style={{ background: css }} />
          ))}
        </div>
      </>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <button type="button" onClick={actions.openAi} disabled={actions.busy === 'picture'}
        className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] text-[12.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-50">
        <Sparkles size={14} />{actions.busy === 'picture' ? t('covers.makingPicture') : t('covers.aiOpen')}
      </button>
      <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">{t('covers.makeNote')}</p>
      {actions.made.length ? (
        <>
          <p className="text-[11.5px] font-medium text-[var(--text-muted)]">{t('covers.aiMade')}</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-2">
            {actions.made.map((p) => (
              <button key={p} type="button" disabled={busy} onClick={() => actions.use(p)} title={p.split('/').pop()}
                className="aspect-[3/4] overflow-hidden rounded-md ring-1 ring-[var(--border)] transition hover:ring-[var(--accent)] disabled:opacity-50">
                <img src={actions.thumbOf(p)} alt="" draggable={false} className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
