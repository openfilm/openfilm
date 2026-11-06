/**
 * A template of the library put in the film, shown whenever one of its clips is picked (lib/template-instance): how
 * many of its places still wait for the person's own pictures; each place, numbered in the order it plays, with its
 * length and what is in it now, a click on it choosing what goes there (the project's videos and pictures, or one from
 * this computer) and one dropped on it going there; one click to fill every place still waiting; its words, every one
 * of them in one list; and the whole template picked at once, to be moved as one. Each clip stays a clip of its own.
 */
import * as React from 'react';
import { useT } from '@/i18n';
import { readResourceDragData, RESOURCE_DRAG_TYPE, type ResourceDragItem } from '@/lib/resource-drag';
import type { TemplateInstance, TemplateWord } from '@/lib/template-instance';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { INPUT, Section } from './inspector-fields';

export interface TemplateHost {
  instance: TemplateInstance;
  /** the template's name, in the app's language */
  name: string;
  /** a place's length (ms) and a picture of what is in it (null: still waiting) */
  slotOf: (clip: string) => { durMs: number; thumb: string | null };
  /** what may go in a place (the Replace menu's) */
  pickEntries: (clip: string) => ContextMenuEntry[];
  /** a file dropped on a place: put there */
  put: (clip: string, file: ResourceDragItem) => void;
  /** every place still waiting filled with the project's pictures; null when it has none */
  fill: (() => void) | null;
  setWord: (word: TemplateWord, text: string) => void;
  /** the address of a clip's page, to read the words it says of its own */
  pageUrl: (clip: string) => string | null;
  /** every clip of the template picked at once; null when they are */
  pickAll: (() => void) | null;
}

/* the words a page says of its own, read once a page */
const ownWords = new Map<string, Promise<Document | null>>();
function pageDoc(url: string): Promise<Document | null> {
  let doc = ownWords.get(url);
  if (!doc) {
    doc = fetch(url).then((r) => (r.ok ? r.text() : null)).then((html) => (html ? new DOMParser().parseFromString(html, 'text/html') : null)).catch(() => null);
    ownWords.set(url, doc);
  }
  return doc;
}

export function TemplateSection({ host }: { host: TemplateHost }) {
  const t = useT();
  const { instance } = host;
  const waiting = instance.slots.filter((s) => s.empty).length;
  const [menu, setMenu] = React.useState<{ x: number; y: number; top: number; items: ContextMenuEntry[] } | null>(null);
  const [over, setOver] = React.useState<string | null>(null);
  const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return (
    <Section id="template" title={host.name}>
      <div className="flex items-center justify-between gap-2">
        <span data-template-waiting={waiting} className={`text-[11px] ${waiting ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
          {waiting ? t('template.waiting').replace('{n}', String(waiting)) : t('template.allIn')}
        </span>
        {waiting && host.fill ? (
          <button type="button" data-template-fill="" onClick={host.fill}
            className="h-6 shrink-0 rounded-[5px] bg-[var(--bg-field)] px-2 text-[11px] font-medium text-[var(--text)] hover:bg-[var(--bg-pressed)]">
            {t('template.fill')}
          </button>
        ) : null}
      </div>
      {instance.slots.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-1.5">
          {instance.slots.map((slot, i) => {
            const { durMs, thumb } = host.slotOf(slot.clip);
            return (
              <button key={slot.clip} type="button" data-template-slot={i + 1} title={t('template.pick')}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ x: r.left, y: r.bottom + 4, top: r.top - 4, items: host.pickEntries(slot.clip) });
                }}
                onDragOver={(e) => { if (e.dataTransfer.types.includes(RESOURCE_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(slot.clip); } }}
                onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); const file = readResourceDragData(e.dataTransfer); if (file) host.put(slot.clip, file); }}
                className={`relative aspect-square overflow-hidden rounded-[6px] bg-[var(--bg-field)] bg-cover bg-center text-left ${over === slot.clip ? 'ring-2 ring-[var(--accent)]' : slot.empty ? 'border border-dashed border-[var(--border-strong)] hover:border-[var(--text-faint)]' : 'hover:ring-1 hover:ring-[var(--text-faint)]'}`}
                style={thumb ? { backgroundImage: `url(${JSON.stringify(thumb)})` } : undefined}>
                {slot.empty ? <span className="absolute inset-0 grid place-items-center text-[18px] font-semibold text-[var(--text-muted)]">{i + 1}</span>
                  : <span className="absolute left-1 top-1 rounded-[3px] bg-black/60 px-1 text-[10px] font-semibold leading-[14px] text-white">{i + 1}</span>}
                <span className="absolute bottom-1 right-1 rounded-[3px] bg-black/60 px-1 text-[10px] tabular-nums leading-[14px] text-white">{secs(durMs)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
      {instance.words.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">{t('template.words')}</span>
          {instance.words.map((w) => <WordField key={`${w.clip} ${w.at} ${w.n ?? ''}`} word={w} host={host} />)}
        </div>
      ) : null}
      {host.pickAll ? (
        <button type="button" data-template-all="" onClick={host.pickAll}
          className="h-7 rounded-[5px] bg-[var(--bg-field)] text-[11.5px] font-medium text-[var(--text)] hover:bg-[var(--bg-pressed)]">
          {t('template.pickAll')}
        </button>
      ) : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} flipTo={menu.top} dense items={menu.items} onClose={() => setMenu(null)} /> : null}
    </Section>
  );
}

/** One of the template's words: what it says now (the page's own until changed), written when let go. */
function WordField({ word, host }: { word: TemplateWord; host: TemplateHost }) {
  const [own, setOwn] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (word.text != null) return undefined;
    const url = host.pageUrl(word.clip);
    if (!url) return undefined;
    let alive = true;
    void pageDoc(url).then((doc) => {
      const el = doc ? [...doc.querySelectorAll(word.at)][(word.n ?? 1) - 1] : null;
      if (alive) setOwn(el?.textContent?.trim() ?? '');
    });
    return () => { alive = false; };
  }, [word.clip, word.at, word.n, word.text, host]);
  const now = word.text ?? own ?? '';
  const commit = (value: string) => { if (value !== now) host.setWord(word, value); };
  return (
    <label className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-[11px] text-[var(--text-muted)]" title={word.name}>{word.name}</span>
      <input key={now} defaultValue={now} data-template-word={word.at} className={INPUT}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = now; e.currentTarget.blur(); } }} />
    </label>
  );
}
