/**
 * AI in the cover design, two ways from one panel (the strip's "Generate" and the picture's "AI design"): a picture made
 * with the person's picture service (from the cover's picture or from words alone; the person kept and only the
 * background made again; a style), every one made kept to go back to; or the whole cover handed to the agent in the
 * app's chat, which changes this cover's film as it changes any film.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { Bot, Sparkles, X } from 'lucide-react';
import { useT } from '@/i18n';
import { receiptOf } from '@/lib/canvas';

/** The words a picture made for a cover is asked with: OpenFilm's own, in English (every model reads it), then the person's. */
export const COVER_PICTURE_LEAD = 'A striking video cover picture: a bold clear composition with one focal point, high contrast and rich light, readable at a small size, and no words, letters or logos anywhere in it. ';
export const COVER_REDRAW_LEAD = 'Redraw the reference picture as a striking video cover picture: keep its people and main subject recognizable, a bold clear composition with one focal point, high contrast and rich light, readable at a small size, and no words, letters or logos anywhere in it. ';
export const COVER_BACKGROUND_LEAD = 'A background for a video cover, with empty room in the middle for a person placed over it later: a bold clear scene, rich light, no people, and no words, letters or logos anywhere in it. ';

/** What a service made, by its receipt: the file, as the project names it. */
export function madePath(text: string): string {
  const r = receiptOf<{ src?: string; images?: { src?: string }[] }>(text);
  const made = r.src ?? r.images?.[0]?.src;
  if (!made) throw new Error('no picture');
  return made;
}

/** How a picture is asked for: the words, made from the cover's picture or not, the person kept and only the background new. */
export interface CoverMakeAsk { words: string; fromPicture: boolean; keepSubject: boolean }

const STYLES = ['sharper', 'cinematic', 'anime', 'render3d', 'illustration', 'film'] as const;

export function CoverAiPanel({ ratio, hasPicture, busy, made, thumbOf, agent, onMake, onUse, onAgent, onClose }: {
  /** the cover's shape, said: what is made is made in it */
  ratio: string;
  /** the cover has a picture to make one from (not a color) */
  hasPicture: boolean;
  busy: boolean;
  /** pictures made for covers before, the newest first (as the project names them) */
  made: readonly string[];
  thumbOf: (path: string) => string;
  /** the app's chat can be asked (none in a browser) */
  agent: boolean;
  onMake: (ask: CoverMakeAsk) => void;
  onUse: (path: string) => void;
  onAgent: (words: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [tab, setTab] = React.useState<'make' | 'agent'>('make');
  const [words, setWords] = React.useState('');
  const [fromPicture, setFromPicture] = React.useState(hasPicture);
  const [keepSubject, setKeepSubject] = React.useState(false);
  const [styles, setStyles] = React.useState<readonly string[]>([]);
  React.useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  const styled = [words.trim(), ...styles.map((s) => t(`covers.style_${s}`))].filter(Boolean).join(t('covers.listJoin'));
  const chip = (on: boolean, label: string, onClick: () => void, disabled = false) => (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick}
      className={`h-7 rounded-md px-2.5 text-[12px] transition disabled:opacity-45 ${on ? 'bg-[var(--bg-selected)] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--accent)]' : 'bg-[var(--bg-field)] text-[var(--text-muted)] hover:text-[var(--text)]'}`}>{label}</button>
  );
  return createPortal(
    <div className="fixed inset-0 z-[10060] flex items-center justify-center bg-black/40 p-6" data-cover-ai="" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={t('covers.aiTitle')} className="flex max-h-full w-[580px] max-w-full flex-col overflow-hidden rounded-[14px] bg-[var(--bg-raised)] text-[13px] text-[var(--text)] shadow-[0_24px_80px_rgba(0,0,0,.55),0_0_0_1px_var(--border)]">
        <div className="flex h-12 shrink-0 items-center gap-1 px-4">
          {(['make', 'agent'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}
              className={`flex h-8 items-center gap-1.5 rounded-md px-3 transition ${tab === k ? 'bg-[var(--bg-pressed)] font-medium text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
              {k === 'make' ? <Sparkles size={14} /> : <Bot size={14} />}{t(k === 'make' ? 'covers.aiMake' : 'covers.aiAgent')}
            </button>
          ))}
          <button type="button" onClick={onClose} aria-label={t('covers.close')} className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><X size={15} /></button>
        </div>
        {tab === 'make' ? (
          <form className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 pb-4" onSubmit={(e) => { e.preventDefault(); if (styled) onMake({ words: styled, fromPicture: fromPicture && hasPicture && !keepSubject, keepSubject: keepSubject && hasPicture }); }}>
            <textarea autoFocus value={words} onChange={(e) => setWords(e.target.value)} rows={3}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit(); }}
              placeholder={t('covers.aiMakePlaceholder')}
              className="resize-none rounded-lg bg-[var(--bg-field)] px-3 py-2.5 leading-relaxed outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--accent)]" />
            <div className="flex flex-wrap gap-1.5">
              {chip(fromPicture && hasPicture && !keepSubject, t('covers.aiFromPicture'), () => { setFromPicture(!fromPicture); setKeepSubject(false); }, !hasPicture)}
              {chip(keepSubject && hasPicture, t('covers.aiKeepSubject'), () => setKeepSubject(!keepSubject), !hasPicture)}
              <span className="mx-1 w-px self-stretch bg-[var(--border)]" aria-hidden />
              {STYLES.map((s) => chip(styles.includes(s), t(`covers.style_${s}`), () => setStyles((was) => (was.includes(s) ? was.filter((x) => x !== s) : [...was, s]))))}
            </div>
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-[var(--text-faint)]">{t('covers.aiMakeNote').replace('{ratio}', ratio)}</span>
              <button type="submit" disabled={busy || !styled}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 font-medium text-[var(--on-primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50">
                <Sparkles size={14} />{busy ? t('covers.makingPicture') : t('covers.makeGo')}
              </button>
            </div>
            {made.length ? (
              <div className="border-t border-[var(--border)] pt-3">
                <p className="mb-2 text-[11.5px] text-[var(--text-faint)]">{t('covers.aiMade')}</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {made.map((p) => (
                    <button key={p} type="button" disabled={busy} onClick={() => onUse(p)} title={p.split('/').pop()}
                      className="h-[96px] shrink-0 overflow-hidden rounded-md ring-1 ring-[var(--border)] transition hover:ring-[var(--accent)] disabled:opacity-50">
                      <img src={thumbOf(p)} alt="" draggable={false} className="h-full w-auto object-cover" />
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </form>
        ) : (
          <form className="flex flex-col gap-3 px-4 pb-4" onSubmit={(e) => { e.preventDefault(); if (words.trim() && agent) onAgent(words.trim()); }}>
            <textarea autoFocus value={words} onChange={(e) => setWords(e.target.value)} rows={4}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit(); }}
              placeholder={t('covers.aiAgentPlaceholder')}
              className="resize-none rounded-lg bg-[var(--bg-field)] px-3 py-2.5 leading-relaxed outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--accent)]" />
            <div className="flex items-center gap-3">
              <span className="min-w-0 flex-1 text-[11.5px] leading-snug text-[var(--text-faint)]">{agent ? t('covers.aiAgentNote') : t('covers.aiAgentNone')}</span>
              <button type="submit" disabled={!agent || !words.trim()}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-[var(--primary)] px-4 font-medium text-[var(--on-primary)] hover:bg-[var(--primary-hover)] disabled:opacity-50">
                <Bot size={14} />{t('covers.aiAgentGo')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

/** The looks' pages already read, by their address. */
const LOOK_PAGES = new Map<string, string>();
/** The looks' pages read ahead (the design opened), so the first one the pointer rests on shows at once. */
export function readLooksAhead(pages: readonly string[]) {
  for (const page of pages) {
    if (LOOK_PAGES.has(page)) continue;
    void fetch(page).then((r) => (r.ok ? r.text() : null), () => null).then((text) => { if (text) LOOK_PAGES.set(page, text); });
  }
}

/**
 * A look tried on the cover while the pointer rests on it in the library: the cover's picture and the look over it,
 * drawn over the stage at its size; nothing is written.
 */
export function CoverLookPreview({ stage, picture, look }: {
  stage: { w: number; h: number };
  /** the cover's picture: a page (a color) or a picture, where it is and how it fills the cover */
  picture: { url: string; page: boolean; box?: { x: number; y: number; w: number; h: number } } | null;
  /** the look's page */
  look: string;
}) {
  const box = React.useRef<HTMLDivElement>(null);
  const [k, setK] = React.useState(0);
  /* the look's page as words, put in a frame of its own (the library hands its files out as bytes, not as pages) */
  const [doc, setDoc] = React.useState<string | null>(LOOK_PAGES.get(look) ?? null);
  React.useEffect(() => {
    let live = true;
    const known = LOOK_PAGES.get(look);
    if (known) { setDoc(known); return; }
    setDoc(null);
    void fetch(look).then((r) => (r.ok ? r.text() : null), () => null).then((text) => { if (text) LOOK_PAGES.set(look, text); if (live) setDoc(text); });
    return () => { live = false; };
  }, [look]);
  React.useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new ResizeObserver(() => setK(el.clientWidth / stage.w));
    seen.observe(el);
    return () => seen.disconnect();
  }, [stage.w]);
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const page = (src: string | { doc: string }) => (
    <iframe {...(typeof src === 'string' ? { src } : { srcDoc: src.doc })} title="" tabIndex={-1} sandbox={typeof src === 'string' ? undefined : ''}
      className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-transparent"
      /* the page's own scheme on the frame too: a frame whose scheme differs from the page around it is drawn opaque */
      style={{ width: stage.w, height: stage.h, transform: `scale(${k})`, colorScheme: 'light' }} />
  );
  return (
    <div ref={box} data-cover-look-preview="" className="pointer-events-none absolute inset-0 z-[6] overflow-hidden bg-black">
      {picture ? (picture.page ? page(picture.url)
        : picture.box ? <img src={picture.url} alt="" className="absolute max-w-none" style={{ left: pct(picture.box.x, stage.w), top: pct(picture.box.y, stage.h), width: pct(picture.box.w, stage.w), height: pct(picture.box.h, stage.h) }} />
        : <img src={picture.url} alt="" className="absolute inset-0 h-full w-full object-cover" />) : null}
      {k && doc ? page({ doc }) : null}
    </div>
  );
}
