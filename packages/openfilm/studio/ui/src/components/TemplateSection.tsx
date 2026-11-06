/**
 * A template of the library put in the film, shown whenever it is picked (lib/template-instance): one compound clip
 * (its film of its own), or, put in before, its clips each of their own. How many of its places still wait for the
 * person's own pictures; each place, numbered in the order it plays, with its length and what is in it now, a click on
 * it choosing what goes there (the project's videos and pictures, or one from this computer) and one dropped on it
 * going there; one click to fill every place still waiting, or the person's own chosen for all of them at once; its
 * words, every one of them in one list; its looks, one control for each its pages offer (a color for all of them that
 * share it); layers to show or hide; pictures inside its pages; its sound.
 */
import * as React from 'react';
import { useT } from '@/i18n';
import { readResourceDragData, RESOURCE_DRAG_TYPE, type ResourceDragItem } from '@/lib/resource-drag';
import { COLOR_SCHEMES, schemeColor, type ColorScheme, type PlaceFrame, type TemplateInstance, type TemplateWord } from '@/lib/template-instance';
import { Music } from 'lucide-react';
import { fieldOf, isFontVar } from '@/lib/template-controls';
import { joinFontFamily, splitFontFamily } from '@/lib/font-styles';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { FontFamilyPicker } from './FontFamilyPicker';
import { ColorField, FIELD, INPUT, NumField, Section, Segmented, SelectField, SliderField } from './inspector-fields';

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
  /** the person's own chosen for every place at once (TemplatePicker) */
  pickMany?: (() => void) | null;
  /** its looks: a CSS variable its pages offer, one control for every page offering it; `page` the first one's address */
  looks?: { key: string; name: string; value: string | null; var: string; page: string | null }[];
  setLook?: (key: string, value: string | null) => void;
  /** layers its pages offer to show or hide */
  switches?: { key: string; name: string; on: boolean }[];
  setSwitch?: (key: string, on: boolean) => void;
  /** pictures inside its pages, each with what may go in its place (the menu) */
  pictures?: { key: string; name: string; thumb: string | null }[];
  pictureEntries?: (key: string) => ContextMenuEntry[];
  /** its sound, each with its menu (another, or none) */
  sounds?: { key: string; name: string }[];
  soundEntries?: (key: string) => ContextMenuEntry[];
  /** a place's framing, and for a video which part plays: from `inSec`, at most `maxIn` (null: a picture) */
  frameOf?: (clip: string) => { frame: PlaceFrame; inSec: number | null; maxIn: number } | null;
  setFrame?: (clip: string, frame: PlaceFrame) => void;
  setIn?: (clip: string, sec: number) => void;
  /** several looks at once, by key (null: its page's own) */
  setLooks?: (values: [string, string | null][]) => void;
  /** how long it runs, s: longer or shorter, its places stretch, its opening and its end keep their time */
  length?: number;
  setLength?: (sec: number) => void;
  /** another template of the library in its place, the person's clips and words kept */
  swapOptions?: { id: string; name: string }[];
  swapTo?: (id: string) => void;
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
  /* the place whose framing shows (a clip of the template's film) */
  const [picked, setPicked] = React.useState<string | null>(null);
  const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
  return (
    <Section id="template" title={host.name}>
      <div className="flex items-center justify-between gap-2">
        <span data-template-waiting={waiting} className={`text-[11px] ${waiting ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
          {waiting ? t('template.waiting').replace('{n}', String(waiting)) : t('template.allIn')}
        </span>
        <span className="flex shrink-0 gap-1">
          {host.pickMany ? (
            <button type="button" data-template-many="" onClick={host.pickMany}
              className="h-6 rounded-[5px] bg-[var(--bg-field)] px-2 text-[11px] font-medium text-[var(--text)] hover:bg-[var(--bg-pressed)]">
              {t('template.pickMany')}
            </button>
          ) : null}
          {waiting && host.fill ? (
            <button type="button" data-template-fill="" onClick={host.fill}
              className="h-6 rounded-[5px] bg-[var(--bg-field)] px-2 text-[11px] font-medium text-[var(--text)] hover:bg-[var(--bg-pressed)]">
              {t('template.fill')}
            </button>
          ) : null}
        </span>
      </div>
      {instance.slots.length ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-1.5">
          {instance.slots.map((slot, i) => {
            const { durMs, thumb } = host.slotOf(slot.clip);
            return (
              <button key={slot.clip} type="button" data-template-slot={i + 1} title={t('template.pick')}
                onClick={(e) => {
                  /* a click picks the place (its framing under the places); one on the place picked chooses what goes there */
                  if (picked !== slot.clip && host.frameOf) { setPicked(slot.clip); return; }
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
                {picked === slot.clip ? <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[6px] ring-2 ring-inset ring-[var(--accent)]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      {picked && host.frameOf ? <PlaceFrameFields key={picked} clip={picked} host={host} onReplace={(r) => setMenu({ x: r.left, y: r.bottom + 4, top: r.top - 4, items: host.pickEntries(picked) })} /> : null}
      {instance.words.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">{t('template.words')}</span>
          {instance.words.map((w) => <WordField key={`${w.clip} ${w.at} ${w.n ?? ''}`} word={w} host={host} />)}
        </div>
      ) : null}
      {host.looks?.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">{t('template.looks')}</span>
          {host.setLooks ? <SchemeField host={host} /> : null}
          {host.looks.map((look) => <LookField key={look.key} look={look} onCommit={(v) => host.setLook?.(look.key, v)} />)}
        </div>
      ) : null}
      {host.switches?.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--text-muted)]">{t('template.switches')}</span>
          {host.switches.map((sw) => (
            <label key={sw.key} data-template-switch={sw.key} className="flex h-7 cursor-pointer items-center justify-between gap-2 text-[11.5px] text-[var(--text)]">
              <span className="truncate">{sw.name}</span>
              <input type="checkbox" checked={sw.on} onChange={(e) => host.setSwitch?.(sw.key, e.target.checked)} className="h-3.5 w-3.5 accent-[var(--accent)]" />
            </label>
          ))}
        </div>
      ) : null}
      {host.pictures?.length ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] text-[var(--text-muted)]">{t('template.pictures')}</span>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(58px,1fr))] gap-1.5">
            {host.pictures.map((pic) => (
              <button key={pic.key} type="button" data-template-picture={pic.key} title={pic.name}
                onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, top: r.top - 4, items: host.pictureEntries?.(pic.key) ?? [] }); }}
                className="relative aspect-square overflow-hidden rounded-[6px] bg-[var(--bg-field)] bg-cover bg-center ring-1 ring-[var(--border)] hover:ring-[var(--text-faint)]"
                style={pic.thumb ? { backgroundImage: `url(${JSON.stringify(pic.thumb)})` } : undefined}>
                <span className="absolute inset-x-1 bottom-1 truncate rounded-[3px] bg-black/60 px-1 text-[10px] leading-[14px] text-white">{pic.name}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {host.sounds?.length ? (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] text-[var(--text-muted)]">{t('template.sound')}</span>
          {host.sounds.map((snd) => (
            <button key={snd.key} type="button" data-template-sound={snd.key}
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu({ x: r.left, y: r.bottom + 4, top: r.top - 4, items: host.soundEntries?.(snd.key) ?? [] }); }}
              className="flex h-7 items-center gap-2 rounded-[5px] bg-[var(--bg-field)] px-2 text-left text-[11.5px] text-[var(--text)] hover:bg-[var(--bg-pressed)]">
              <Music size={12} className="shrink-0 text-[var(--text-muted)]" />
              <span className="truncate">{snd.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {host.setLength && host.length ? (
        <div data-template-length="" className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
          <span className="truncate text-[11px] text-[var(--text-muted)]">{t('template.length')}</span>
          <NumField label={t('template.length')} value={Math.round(host.length * 10) / 10} unit="s" step={0.1} min={0.5} max={600}
            onCommit={(n) => { if (Math.abs(n - host.length!) > 0.01) host.setLength!(n); }} />
        </div>
      ) : null}
      {host.swapOptions?.length && host.swapTo ? (
        <div data-template-swap="" className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
          <span className="truncate text-[11px] text-[var(--text-muted)]">{t('template.swap')}</span>
          <SelectField label={t('template.swap')} value={instance.id} options={host.swapOptions.map((o) => ({ value: o.id, label: o.name }))}
            onCommit={(id) => { if (id !== instance.id) host.swapTo!(id); }} />
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

/** The value a page gives one of its CSS variables itself (its stylesheet's), read once a page. */
async function ownVar(url: string, name: string): Promise<string | null> {
  const doc = await pageDoc(url);
  const css = [...(doc?.querySelectorAll('style') ?? [])].map((s) => s.textContent ?? '').join('\n');
  const m = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')}\\s*:\\s*([^;}]+)`).exec(css);
  return m ? m[1]!.trim() : null;
}

/** One of the template's looks: a color with the picker, anything else as written; its page's own until changed. */
function LookField({ look, onCommit }: { look: NonNullable<TemplateHost['looks']>[number]; onCommit: (value: string | null) => void }) {
  const [own, setOwn] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (look.value != null || !look.page) return undefined;
    let alive = true;
    void ownVar(look.page, look.var).then((v) => { if (alive) setOwn(v); });
    return () => { alive = false; };
  }, [look.value, look.page, look.var]);
  const now = look.value ?? own ?? '';
  const color = now ? fieldOf(now, (v) => CSS.supports('color', v)).kind === 'color' : false;
  if (now && isFontVar(look.var, now)) {
    const [family, rest] = splitFontFamily(now);
    return (
      <div data-template-look={look.key} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
        <span className="truncate text-[11px] text-[var(--text-muted)]" title={look.name}>{look.name}</span>
        {/* written when picked: the template's film is another page's, not one this panel can preview */}
        <FontFamilyPicker label={look.name} value={family} sample="Aa" onPreview={() => {}} onRevert={() => {}} onCommit={(f) => onCommit(joinFontFamily(f, rest))} className={FIELD} />
      </div>
    );
  }
  if (color) {
    return (
      <div data-template-look={look.key} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
        <span className="truncate text-[11px] text-[var(--text-muted)]" title={look.name}>{look.name}</span>
        <ColorField label={look.name} value={now} onCommit={(v) => onCommit(v)} />
      </div>
    );
  }
  return (
    <label data-template-look={look.key} className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-[11px] text-[var(--text-muted)]" title={look.name}>{look.name}</span>
      <input key={now} defaultValue={now} className={INPUT}
        onBlur={(e) => { if (e.target.value !== now) onCommit(e.target.value.trim() || null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = now; e.currentTarget.blur(); } }} />
    </label>
  );
}

/* a template's films as last read or written, by folder: shown at once, then read again (it may have been changed
   inside, its clip opened to edit) */
const films = new Map<string, unknown>();

/** A template put in as one compound clip: its film (as last known, then as read now), then its section as `hostOf` makes it. */
export function TemplateFilmSection<F>({ folder, load, hostOf }: { folder: string; load: (folder: string) => Promise<F>; hostOf: (film: F) => TemplateHost }) {
  const [film, setFilm] = React.useState<F | null>(() => (films.get(folder) as F | undefined) ?? null);
  React.useEffect(() => {
    let alive = true;
    void load(folder).then((f) => { films.set(folder, f); if (alive) setFilm(f); }, () => {});
    return () => { alive = false; };
  }, [folder, load]);
  return film ? <TemplateSection host={hostOf(film)} /> : null;
}

/** A template's film just written: kept, so its section shows at once. */
export function keepTemplateFilm(folder: string, film: unknown): void {
  films.set(folder, film);
}

/** A place's framing: what goes there, filling the picture or whole in it, how near, the point looked at; a video, from where. */
function PlaceFrameFields({ clip, host, onReplace }: { clip: string; host: TemplateHost; onReplace: (r: DOMRect) => void }) {
  const t = useT();
  const at = host.frameOf?.(clip);
  if (!at) return null;
  const { frame } = at;
  const set = (patch: Partial<PlaceFrame>) => host.setFrame?.(clip, { ...frame, ...patch });
  return (
    <div data-template-frame={clip} className="flex flex-col gap-1.5 rounded-[6px] bg-[var(--bg-field)]/40 p-2">
      <div className="flex items-center gap-1.5">
        <button type="button" data-template-replace="" onClick={(e) => onReplace(e.currentTarget.getBoundingClientRect())}
          className="h-[26px] shrink-0 rounded-[5px] bg-[var(--bg-field)] px-2.5 text-[11px] font-medium text-[var(--text)] hover:bg-[var(--bg-pressed)]">{t('template.replace')}</button>
        <Segmented label={t('template.frame')} value={frame.fit} small
          options={[{ value: 'cover', label: t('template.cover') }, { value: 'contain', label: t('template.contain') }]}
          onChange={(v) => set({ fit: v as PlaceFrame['fit'] })} />
      </div>
      <SliderField label={t('template.zoom')} value={Math.round(frame.zoom * 100)} min={100} max={300} neutral={100} unit="%" onCommit={(n) => set({ zoom: n / 100 })} />
      <SliderField label={t('template.posX')} value={Math.round(frame.x * 100)} min={0} max={100} neutral={50} unit="%" onCommit={(n) => set({ x: n / 100 })} />
      <SliderField label={t('template.posY')} value={Math.round(frame.y * 100)} min={0} max={100} neutral={50} unit="%" onCommit={(n) => set({ y: n / 100 })} />
      {at.inSec != null && at.maxIn > 0.05 ? (
        <SliderField label={t('template.inPoint')} value={Math.round(at.inSec * 10) / 10} min={0} max={Math.round(at.maxIn * 10) / 10} step={0.1} unit="s"
          onCommit={(n) => host.setIn?.(clip, n)} />
      ) : null}
    </div>
  );
}

/** Every color of the template at once in a scheme, from the colors its pages have of their own (never one on another). */
function SchemeField({ host }: { host: TemplateHost }) {
  const t = useT();
  const apply = async (scheme: ColorScheme | 'original') => {
    const values: [string, string | null][] = [];
    for (const look of host.looks ?? []) {
      const own = look.page ? await ownVar(look.page, look.var) : null;
      const base = own ?? look.value;
      if (!base || fieldOf(base, (v) => CSS.supports('color', v)).kind !== 'color') continue;
      values.push([look.key, scheme === 'original' ? null : schemeColor(scheme, base)]);
    }
    if (values.length) host.setLooks?.(values);
  };
  return (
    <div data-template-scheme="" className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-[11px] text-[var(--text-muted)]">{t('template.scheme')}</span>
      <SelectField label={t('template.scheme')} value=""
        options={[{ value: 'original', label: t('template.schemeOriginal') }, ...COLOR_SCHEMES.map((c) => ({ value: c, label: t(`template.schemes.${c}`) }))]}
        onCommit={(v) => { void apply(v as ColorScheme | 'original'); }} />
    </div>
  );
}
