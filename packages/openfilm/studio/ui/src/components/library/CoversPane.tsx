/**
 * The library's Covers: the film's covers (each opened to change it), a new one in a platform's shape, and the looks a
 * cover takes. Over the film, a look makes a new cover of the picture at the playhead (or of none); in a cover, it
 * becomes that cover's look. What a cover is, and how it is made, is studio/server/covers.mjs.
 */
import React from 'react';
import { Check, Plus } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { nameOf } from '@/lib/library';
import { COVER_SHAPES, coverThumb, lookPoster, shapeOf, type CoverInfo, type CoverLook, type CoverLooks, type CoverShape } from '@/lib/covers';
import { FOOT_ROOM } from './AudioList';

export interface CoversActions {
  /** The project the covers are of (the film's, also while one of them is open). */
  projectId: string;
  covers: readonly CoverInfo[];
  looks: CoverLooks | null;
  /** The cover open now (its folder), null over the film. */
  current: string | null;
  /** Making or changing one now: what, for its card. */
  busy: string | null;
  open: (cover: CoverInfo) => void;
  /** A new cover in `shape`: of the picture at the playhead (`frame`), or none; `look` over it. In a cover: a copy of it. */
  make: (shape: CoverShape, frame: boolean, look: CoverLook | null) => void;
  /** In a cover: this look in place of its own. */
  apply: (look: CoverLook) => void;
}

/** What of the looks the side bar shows: all, those over the picture, those designed whole. */
export type CoversGroup = '' | 'frame' | 'design';

export function CoversPane({ actions, group }: { actions: CoversActions; group: CoversGroup }) {
  const t = useT();
  const lang = useLanguage();
  const { covers, looks, current, busy } = actions;
  const [shape, setShape] = React.useState<CoverShape['id']>('portrait');
  const [frame, setFrame] = React.useState(true);
  const picked = COVER_SHAPES.find((s) => s.id === shape)!;
  const shown = (looks?.items ?? []).filter((l) => !group || l.group === group);
  const inCover = current != null;
  return (
    <div className={`min-h-0 flex-1 overflow-y-auto px-3 pt-3 ${FOOT_ROOM}`} data-covers-pane="">
      <Section title={t('covers.ofFilm')}>
        {covers.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-2.5">
            {covers.map((c) => {
              const s = shapeOf(c.stage);
              const on = c.folder === current;
              return (
                <button key={c.folder} type="button" data-cover-card={c.folder} onClick={() => actions.open(c)} title={t('covers.openTip')}
                  className={`group flex flex-col items-stretch gap-1 rounded-md p-1 text-left transition hover:bg-[var(--bg-hover)] ${on ? 'bg-[var(--bg-hover)]' : ''}`}>
                  <span className="flex h-[92px] items-center justify-center overflow-hidden rounded-[5px] bg-[var(--bg-field)]">
                    <img src={coverThumb(actions.projectId, c)} alt="" draggable={false}
                      className={`max-h-full max-w-full rounded-[4px] object-contain ${on ? 'ring-2 ring-[var(--accent)]' : ''}`} />
                  </span>
                  <span className="truncate px-0.5 text-[11.5px] text-[var(--text)]">{t(`covers.shape_${s.id}`)}<span className="ml-1 text-[var(--text-faint)]">{s.ratio}</span></span>
                </button>
              );
            })}
          </div>
        ) : <p className="text-[11.5px] leading-relaxed text-[var(--text-faint)]">{t('covers.none')}</p>}
      </Section>

      <Section title={inCover ? t('covers.newSizeTitle') : t('covers.newTitle')}>
        <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label={t('covers.shape')}>
          {COVER_SHAPES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={shape === s.id} data-cover-shape={s.id} onClick={() => setShape(s.id)}
              className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition ${shape === s.id ? 'bg-[var(--bg-hover)] ring-1 ring-[var(--accent)]' : 'bg-[var(--bg-field)] hover:bg-[var(--bg-hover)]'}`}>
              <ShapeMark shape={s} />
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-[var(--text)]">{t(`covers.shape_${s.id}`)} <span className="font-normal text-[var(--text-faint)]">{s.ratio}</span></span>
                <span className="block truncate text-[10.5px] text-[var(--text-faint)]">{t(`covers.where_${s.id}`)}</span>
              </span>
            </button>
          ))}
        </div>
        {inCover ? (
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-faint)]">{t('covers.copyNote')}</p>
        ) : (
          <div className="mt-2 flex overflow-hidden rounded-md bg-[var(--bg-field)]" role="radiogroup" aria-label={t('covers.picture')}>
            {[true, false].map((v) => (
              <button key={String(v)} type="button" role="radio" aria-checked={frame === v} onClick={() => setFrame(v)}
                className={`flex h-7 flex-1 items-center justify-center gap-1 text-[11.5px] transition ${frame === v ? 'bg-[var(--bg-hover)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
                {frame === v ? <Check size={12} /> : null}{t(v ? 'covers.fromPlayhead' : 'covers.blank')}
              </button>
            ))}
          </div>
        )}
        <button type="button" data-cover-new="" disabled={busy != null} onClick={() => actions.make(picked, frame, null)}
          className="mt-2 flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-[var(--primary)] text-[12.5px] font-medium text-[var(--on-primary)] transition hover:bg-[var(--primary-hover)] disabled:opacity-50">
          <Plus size={14} />{busy === 'new' ? t('covers.making') : inCover ? t('covers.copyGo') : t('covers.newGo')}
        </button>
      </Section>

      <Section title={t('covers.looks')} note={inCover ? t('covers.looksApplyNote') : t('covers.looksNewNote')}>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-2.5 gap-y-3">
          {shown.map((look) => (
            <button key={look.id} type="button" data-cover-look={look.id} disabled={busy != null}
              onClick={() => (inCover ? actions.apply(look) : actions.make(picked, frame, look))}
              title={look.about}
              className="group flex flex-col gap-1 text-left disabled:opacity-60">
              <span className="relative block aspect-video overflow-hidden rounded-[6px] bg-[var(--bg-field)] ring-1 ring-[var(--border)] transition group-hover:ring-[var(--accent)]">
                <img src={lookPoster(look)} alt="" draggable={false} className="h-full w-full object-cover" />
                {busy === look.id ? <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-[11px] text-white">{t('covers.making')}</span> : null}
              </span>
              <span className="truncate text-[11.5px] text-[var(--text)]">{nameOf(look.name, lang)}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-1 text-[12px] font-semibold text-[var(--text)]">{title}</h3>
      {note ? <p className="mb-2 text-[11px] leading-relaxed text-[var(--text-faint)]">{note}</p> : <div className="mb-2" />}
      {children}
    </section>
  );
}

/** A shape drawn as a small outline, its ratio at a glance. */
function ShapeMark({ shape }: { shape: CoverShape }) {
  const k = 18 / Math.max(shape.w, shape.h);
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
      <span className="block rounded-[2px] border-[1.5px] border-current text-[var(--text-muted)]" style={{ width: Math.round(shape.w * k), height: Math.round(shape.h * k) }} />
    </span>
  );
}

