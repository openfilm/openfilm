/**
 * The inspector of a line of words made with the library's text component (lib/text-look): three categories of its
 * own. Text: its words, font, size, weight, color, edge, box, alignment and spacing. Word art: the library's looks,
 * one click each (the one it has lit). Motion: how it comes in, moves while shown and goes out, each with its time.
 * Every field paints the picture while dragged or picked and writes when let go, as the inspector's fields do.
 */
import * as React from 'react';
import { Ban, Plus } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { joinFontFamily, splitFontFamily } from '@/lib/font-styles';
import { nameOf, posterUrl, useLibraryIndex, type LibraryItem } from '@/lib/library';
import {
  LOOK_VARS, MOTION_VARS, TEXT_DEFAULTS, currentOf, textVars, textWords, withLook, withMotion, withVars, withWords,
  type MotionSlot,
} from '@/lib/text-look';
import { ColorField, FIELD, NumField, Row, Section, Segmented, SelectField } from './inspector-fields';
import { FontFamilyPicker } from './FontFamilyPicker';
import { Tooltip } from './Tooltip';
import { FontScopeContext } from '@/lib/use-fonts';
import { SavedLookTiles, useSavedLooks } from './CaptionPresets';
import { TextStyleSample } from './library/TextStyleSample';
import type { PropsHost } from './PropertiesSection';

type Overrides = Record<string, unknown>[];
const ROOT = { at: ':root' };
const num = (v: string | undefined) => { const n = Number.parseFloat(v ?? ''); return Number.isFinite(n) ? n : undefined; };
const MOTION_SLOTS: MotionSlot[] = ['in', 'loop', 'out'];

/** `boxH`: how tall its box is drawn on the picture, so its words' size reads in the film's pixels. */
export function TextInspector({ host, boxH, commit }: { host: PropsHost; boxH?: number | undefined; commit: (next: Overrides) => void | Promise<unknown> }) {
  const t = useT();
  const lang = useLanguage();
  const index = useLibraryIndex();
  /* what the clip has now: read again after each write and whenever they change from elsewhere (a side of its box
     pulled on the picture, an undo); the host's overrides are the film's */
  const [, setRev] = React.useState(0);
  const now = JSON.stringify(host.overrides() ?? []);
  const overrides = React.useMemo(() => JSON.parse(now) as Overrides, [now]);
  const vars = textVars(overrides);
  const words = textWords(overrides) ?? '';
  /* a line of words refits its box with each preview: the write shows the new look itself (taken back first, the old
     look would show for a moment) */
  const write = (next: Overrides) => {
    if (host.fits) host.settle?.(); else host.preview(ROOT, null);
    const done = commit(next);
    setRev((r) => r + 1);
    return Promise.resolve(done);
  };
  /* a motion changed, or its time: played on the picture, so it is seen */
  const writeMotion = (next: Overrides, slot: MotionSlot) => { void write(next).then(() => host.playMotion?.(slot)); };
  const setVar = (key: string, value: string) => write(withVars(overrides, { [key]: value }));
  const paint = (key: string, value: string) => host.preview(ROOT, { style: { [key]: value } });
  const revert = () => host.preview(ROOT, null);

  const looks = (index?.items ?? []).filter((i) => i.kind === 'textstyle' && i.group === 'wordart');
  const motions = (slot: MotionSlot) => (index?.items ?? []).filter((i) => i.kind === 'textmotion' && i.group === slot);
  const look = currentOf(vars, looks, LOOK_VARS);
  /* the person's own looks, saved here or with the captions (the same ones): its look, never its size */
  const [saved, saveLook, dropLook] = useSavedLooks();
  const ownLook = Object.fromEntries(LOOK_VARS.flatMap((k) => (vars[k] != null ? [[k, vars[k]!]] : [])));
  const savedOn = currentOf(vars, saved.map((s) => ({ ...s, vars: Object.fromEntries(LOOK_VARS.flatMap((k) => (s.vars[k] != null ? [[k, s.vars[k]!]] : []))) })), LOOK_VARS)?.id ?? null;
  const family = splitFontFamily(vars['--font'] ?? '')[0];
  /* a font picked keeps the page's fallbacks after it */
  const withFont = (f: string) => joinFontFamily(f, splitFontFamily(TEXT_DEFAULTS['--font']!)[1]);
  /* a font file of the person's own: put in the project for its lines of words (POST fonts), then on this line */
  const scope = React.useContext(FontScopeContext);
  const fontFile = React.useRef<HTMLInputElement>(null);
  const [fontProblem, setFontProblem] = React.useState<string | null>(null);
  const addFont = async (file: File) => {
    if (!scope) return;
    setFontProblem(null);
    const answer = await fetch(`/api/projects/${encodeURIComponent(scope.projectId)}/fonts?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
      .catch((e: unknown) => e as Error);
    const body = answer instanceof Response ? await answer.json().catch(() => ({})) as { family?: string; error?: string } : {};
    if (!(answer instanceof Response) || !answer.ok || !body.family) {
      setFontProblem(t('textInspector.addFontFailed').replace('{why}', body.error ?? (answer instanceof Error ? answer.message : String(answer.status))));
      return;
    }
    await setVar('--font', withFont(body.family));
  };

  return (
    <>
      {/* each its own category, which names it: no title of its own (Section bare) */}
      <Section id="text" title={t('textInspector.text')} bare>
        <textarea
          key={words}
          defaultValue={words}
          placeholder={t('textInspector.wordsHint')}
          rows={2}
          onBlur={(e) => { if (e.target.value !== words) write(withWords(overrides, e.target.value)); }}
          className="w-full resize-none rounded-[5px] bg-[var(--bg-field)] px-2 py-1.5 text-[12px] leading-[1.5] text-[var(--text)] outline-none ring-1 ring-inset ring-transparent focus:ring-[var(--accent)]"
        />
        <Line label={t('textInspector.font')}>
          <div className="flex gap-1">
            <div className="min-w-0 flex-1">
              <FontFamilyPicker
                label={t('textInspector.font')}
                value={family}
                sample={words || 'Aa'}
                onPreview={(f) => paint('--font', withFont(f))}
                onRevert={revert}
                onCommit={(f) => setVar('--font', withFont(f))}
                className={FIELD}
              />
            </div>
            {scope ? (
              <Tooltip label={t('textInspector.addFont')}>
                <button type="button" aria-label={t('textInspector.addFont')} data-text-add-font="" onClick={() => fontFile.current?.click()}
                  className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[5px] bg-[var(--bg-field)] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]">
                  <Plus size={13} />
                </button>
              </Tooltip>
            ) : null}
            <input ref={fontFile} type="file" accept=".ttf,.otf,.woff,.woff2" hidden
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void addFont(file); }} />
          </div>
        </Line>
        {fontProblem ? <div role="alert" className="text-[11px] leading-[1.4] text-[var(--danger,#e5484d)]">{fontProblem}</div> : null}
        <Line label={t('textInspector.size')}>
          <Row>
            {/* the words' size in the film's pixels (the page keeps it as a share of its box's height, `--size` in vh,
                and the box follows the words); a share where the box is not known */}
            {boxH ? (
              <NumField label={t('textInspector.size')} value={Math.round(((num(vars['--size']) ?? 62) * boxH) / 100)} unit="px" step={1} min={4} max={2000}
                onPreview={(n) => paint('--size', `${(n * 100) / boxH}vh`)} onRevert={revert} onCommit={(n) => setVar('--size', `${Math.round(((n * 100) / boxH) * 100) / 100}vh`)} />
            ) : (
              <NumField label={t('textInspector.size')} value={num(vars['--size'])} unit="%" step={1} min={5} max={100}
                onPreview={(n) => paint('--size', `${n}vh`)} onRevert={revert} onCommit={(n) => setVar('--size', `${n}vh`)} />
            )}
            <SelectField label={t('textInspector.weight')} value={vars['--weight'] ?? '800'}
              options={['200', '300', '400', '500', '600', '700', '800', '900'].map((w) => ({ value: w, label: w }))}
              onPreview={(w) => paint('--weight', w)} onRevert={revert} onCommit={(w) => setVar('--weight', w)} />
          </Row>
        </Line>
        <Line label={t('textInspector.color')}>
          <ColorField label={t('textInspector.color')} value={vars['--fill'] && vars['--fill'] !== 'none' ? 'transparent' : vars['--color']!}
            onPreview={(c) => paint('--color', c)} onCommit={(c) => write(withVars(overrides, { '--color': c }, ['--fill']))} />
        </Line>
        <Line label={t('textInspector.edge')}>
          <Row>
            <NumField label={t('textInspector.edge')} value={num(vars['--stroke'])} unit="em" step={0.01} min={0} max={0.4}
              onPreview={(n) => paint('--stroke', `${n}em`)} onRevert={revert} onCommit={(n) => setVar('--stroke', `${n}em`)} />
            <ColorField label={t('textInspector.edgeColor')} value={vars['--stroke-color']!}
              onPreview={(c) => paint('--stroke-color', c)} onCommit={(c) => setVar('--stroke-color', c)} />
          </Row>
        </Line>
        <Line label={t('textInspector.box')}>
          <ColorField label={t('textInspector.box')} value={vars['--box']!}
            onPreview={(c) => paint('--box', c)}
            onCommit={(c) => write(withVars(overrides, { '--box': c, ...(num(vars['--box-pad']) ? {} : { '--box-pad': '0.25em 0.55em', '--box-radius': '0.18em' }) }))} />
        </Line>
        <Line label={t('textInspector.align')}>
          <Segmented label={t('textInspector.align')} value={vars['--align']!} small
            options={[{ value: 'left', label: t('textInspector.left') }, { value: 'center', label: t('textInspector.center') }, { value: 'right', label: t('textInspector.right') }]}
            onChange={(a) => setVar('--align', a)} />
        </Line>
        <Line label={t('textInspector.spacing')}>
          <NumField label={t('textInspector.spacing')} value={num(vars['--spacing'])} unit="em" step={0.01} min={-0.1} max={1}
            onPreview={(n) => paint('--spacing', `${n}em`)} onRevert={revert} onCommit={(n) => setVar('--spacing', `${n}em`)} />
        </Line>
      </Section>

      <Section id="wordart" title={t('textInspector.wordart')} bare>
        {/* the person's own first (and saving its look as one), then the library's */}
        <div className="flex h-6 items-center justify-between gap-2">
          <span className="truncate text-[11px] text-[var(--text-muted)]">{t('captionTrack.savedLook')}</span>
          <button type="button" data-text-save-look="" onClick={() => saveLook(ownLook)}
            className="h-6 shrink-0 rounded-[5px] bg-[var(--bg-field)] px-2 text-[11px] text-[var(--text)] hover:bg-[var(--bg-hover)]">{t('captionTrack.saveLook')}</button>
        </div>
        {saved.length ? (
          <div data-text-presets="" className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(38px,1fr))] gap-1.5">
            <SavedLookTiles saved={saved} on={savedOn} onDrop={dropLook}
              onPick={(_, v) => write(withLook(overrides, Object.fromEntries(LOOK_VARS.flatMap((k) => (v[k] != null ? [[k, v[k]!]] : [])))))} />
          </div>
        ) : null}
        <Tiles
          drawn
          items={looks}
          on={look?.id ?? (LOOK_VARS.every((k) => vars[k] === TEXT_DEFAULTS[k]) ? '' : null)}
          none={t('textInspector.none')}
          lang={lang}
          onPick={(item) => write(withLook(overrides, item?.vars ?? {}))}
        />
      </Section>

      <Section id="motion" title={t('textInspector.motion')} bare>
        {MOTION_SLOTS.map((slot) => {
          const [nameKey, timeKey] = MOTION_VARS[slot];
          const items = motions(slot).filter((i) => i.vars?.[nameKey] !== 'none');
          const now = vars[nameKey];
          return (
            <div key={slot} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-medium text-[var(--text-muted)]">{t(`textInspector.${slot}`)}</span>
                {now !== 'none' ? (
                  <div className="w-[96px]">
                    {/* how long it takes (a loop: one round of it) */}
                    <NumField label={t('textInspector.time')} value={num(vars[timeKey])} unit="s" step={0.1} min={0.1} max={5}
                      onCommit={(n) => writeMotion(withVars(overrides, { [timeKey]: `${n}s` }), slot)} />
                  </div>
                ) : null}
              </div>
              <Tiles
                moving
                items={items}
                on={now === 'none' ? '' : items.find((i) => i.vars?.[nameKey] === now)?.id ?? null}
                none={t('textInspector.none')}
                lang={lang}
                onPick={(item) => (item ? writeMotion(withMotion(overrides, slot, item.vars ?? {}), slot) : void write(withMotion(overrides, slot, { [nameKey]: 'none' })))}
              />
            </div>
          );
        })}
      </Section>
    </>
  );
}

/** A field with its name before it, as the inspector's other rows are. */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-[11px] text-[var(--text-muted)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/**
 * A grid of the library's looks or motions, each drawn as it is, its words filling its card (lib TextStyleSample): the
 * one on lit, "none" first. A look's cards as large as two a row leave (`drawn`); a motion's three a row, played under
 * the pointer (`moving`).
 */
function Tiles({ items, on, none, lang, drawn, moving, onPick }: {
  items: LibraryItem[]; on: string | null; none: string; lang: ReturnType<typeof useLanguage>; drawn?: boolean; moving?: boolean;
  onPick: (item: LibraryItem | null) => void;
}) {
  const [hover, setHover] = React.useState<string | null>(null);
  const ring = (lit: boolean) => (lit ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-[var(--border)] hover:ring-[var(--text-faint)]');
  const label = (lit: boolean) => `mt-1 truncate text-center text-[10.5px] ${lit ? 'font-medium text-[var(--accent)]' : 'text-[var(--text-muted)]'}`;
  return (
    <div className={`grid ${drawn ? 'grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-x-2 gap-y-2.5' : 'grid-cols-3 gap-1.5'}`}>
      <button type="button" onClick={() => onPick(null)} className="min-w-0 text-left">
        <span className={`grid aspect-video place-items-center rounded-[5px] bg-[var(--bg-field)] text-[var(--text-faint)] ${ring(on === '')}`}><Ban size={14} /></span>
        <span className={`block ${label(on === '')}`}>{none}</span>
      </button>
      {items.map((item) => (
        <button key={item.id} type="button" onClick={() => onPick(item)} title={nameOf(item.name, lang)} className="min-w-0 text-left"
          onMouseEnter={() => setHover(item.id)} onMouseLeave={() => setHover(null)}>
          <span className={`relative block aspect-video overflow-hidden rounded-[5px] ${ring(on === item.id)}`}>
            {drawn ? <TextStyleSample vars={item.vars} lang={lang} />
              : moving ? <TextStyleSample lang={lang} moving={item.vars} playing={hover === item.id} />
              : <img src={posterUrl(item)} alt="" draggable={false} className="absolute inset-0 h-full w-full object-cover" />}
          </span>
          <span className={`block ${label(on === item.id)}`}>{nameOf(item.name, lang)}</span>
        </button>
      ))}
    </div>
  );
}
