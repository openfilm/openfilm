/**
 * A caption track's inspector (SPEC §1 Captions). Captions: the track at a glance (where its captions come from, how
 * many, its language), every line of it numbered, to find, correct, add after or delete, the one playing lit; lines
 * ticked cut out of the film with their picture and sound; the track translated. Text: Basic (the words of the caption
 * picked, font, size, bold / underline / italic, color, spacing, alignment, edge, box, shadow, where it sits, its words
 * lit as said, and preset looks, the person's own saved too) or Word art; Animation: in, loop and out (TextInspector's).
 *
 * A look is written in the file's STYLE (the caption renderer styles a cue's words by the library text's variables,
 * src/captions.mjs; underline and line height are WebVTT's own `::cue` CSS): with "Apply to all captions" on (as
 * captions are one look) on the track's `::cue`, every cue's own say of it taken away; off, on the picked cues'
 * own `::cue(#c3)`. A track's look from before (plain CSS: `font`, `color`…) is read as the variables and given up
 * for them once changed. The size is a share of the frame's short side, shown as a % of it.
 */
import React from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Languages, Loader2, Plus, RotateCcw, Scissors, Search, Trash2, Underline, X } from 'lucide-react';
import { cuePlain, cueSettings, withSettings } from '../../../../src/captions.mjs';
import { FILM_SUBTITLE_LANGUAGES, FILM_SUBTITLE_LOOKS } from '../../../server/film-subtitle.mjs';
import { studioHost } from '@/lib/host';
import { useLanguage, useT } from '@/i18n';
import { cueRule, removeCues, setCueRule, setCueSettings, setCueText, type Vtt } from '@/lib/caption-edits';
import { setCaptionApplyAll, setCaptionSelection, useCaptionApplyAll, useCaptionSelection, useCaptionTrack } from '@/lib/caption-tracks';
import { LOOK_VARS, TEXT_DEFAULTS, WORDS_AT, textVars, textWords } from '@/lib/text-look';
import { CAPTION_DEFAULTS, PLAIN, captionLookSet, fromInspector, lookDecls, toInspector, varsOf } from '@/lib/caption-look';
import { joinFontFamily, splitFontFamily } from '@/lib/font-styles';
import { CaptionPresets, captionLookVars, useSavedLooks } from './CaptionPresets';
import { InspectorPanel } from './InspectorPanel';
import type { PropsHost } from './PropertiesSection';
import { ColorField, FIELD, NumField, Segmented, SliderField } from './inspector-fields';
import { FontFamilyPicker } from './FontFamilyPicker';
import { Popover } from './Popover';
import { TextInspector } from './TextInspector';
import { Transcript, WordEffects } from './CaptionWords';
import { Tooltip } from './Tooltip';

type Tab = 'lines' | 'text' | 'motion';
/** The tab shown last (and Text's part): the next caption picked opens on it. */
let lastTab: Tab = 'text';
let lastPart: 'basic' | 'wordart' = 'basic';

/** What the inspector says of a caption track beside its captions: its badge, name, language, and where they come from. */
export interface CaptionTrackInfo {
  badge: string | null;
  label: string | null;
  language: string | null;
  /** Made of what clips say: their names (all that speak: null), and whether they still follow the cuts. */
  speech: { clips: string[] | null; auto: boolean } | null;
}

/** Where a caption sits: a line of the picture, % from its top. */
const PLACES = [{ id: 'top', at: 12 }, { id: 'middle', at: 55 }, { id: 'bottom', at: 90 }] as const;
const num = (v: string | undefined, or = 0) => { const n = Number.parseFloat(v ?? ''); return Number.isFinite(n) ? n : or; };
const colorIn = (shadow: string | undefined) => /(#[0-9a-f]{3,8}|rgba?\([^)]*\))\s*$/i.exec(shadow ?? '')?.[1] ?? 'transparent';
const clear = (c: string) => !c || c === 'transparent' || c === 'none' || /^#[0-9a-f]{6}00$/i.test(c) || /rgba\([^)]*,\s*0\)$/.test(c);

export function CaptionInspector({ projectId, width, onClose, timeMs, onSeek, onTranslated, infoOf, onCut, onAdd }: {
  projectId: string;
  width: number;
  onClose: () => void;
  /** The playhead (ms): the line playing is lit in the list. */
  timeMs: number;
  onSeek: (ms: number) => void;
  /** A translation of the track written (`src`, in `language`): put it in the film, just above the track. */
  onTranslated: (from: string, src: string, language: string) => Promise<string | null>;
  /** The track's own information (its badge, name…), by its file. */
  infoOf: (src: string) => CaptionTrackInfo;
  /** Stretches of the film (ms) cut out, picture and sound with them, everything after closed up: null, or why not. */
  onCut: (ranges: readonly { startMs: number; endMs: number }[]) => Promise<string | null>;
  /** A caption put on the track at a time (it picked, its words to type): null, or why not. */
  onAdd: (src: string, atMs: number) => Promise<string | null>;
}) {
  const t = useT();
  const sel = useCaptionSelection();
  const { vtt, write } = useCaptionTrack(projectId, sel?.src ?? '');
  const all = useCaptionApplyAll();
  const scope = all ? 'all' : 'selected';
  const [tab, setTabState] = React.useState<Tab>(lastTab);
  const setTab = (next: string) => { lastTab = next as Tab; setTabState(next as Tab); };
  const [part, setPartState] = React.useState<'basic' | 'wordart'>(lastPart);
  const setPart = (next: string) => { lastPart = next as 'basic' | 'wordart'; setPartState(next as 'basic' | 'wordart'); };
  const [saved, saveLook, dropLook] = useSavedLooks();
  const ids = React.useMemo(() => [...(sel?.ids ?? [])], [sel]);
  const tabs = [
    { id: 'lines', label: t('captionTrack.tabLines') },
    { id: 'text', label: t('textInspector.text') },
    { id: 'motion', label: t('captionTrack.tabMotion') },
  ];
  const vttRef = React.useRef(vtt);
  vttRef.current = vtt;
  /* the look now: the track's, under the first picked cue's own when only they change */
  const trackRule = vtt ? cueRule(vtt, '::cue') : {};
  const ownRule = vtt && scope === 'selected' && ids[0] ? cueRule(vtt, `::cue(#${ids[0]})`) : {};
  const look: Record<string, string> = { ...CAPTION_DEFAULTS, ...varsOf(trackRule), ...varsOf(ownRule) };
  const css = (k: string) => ownRule[k] ?? trackRule[k];
  /* the text inspector's parts (Word art, Animation) read the same look */
  const host = React.useMemo(() => {
    if (!vtt || !sel) return null;
    const first = vtt.cues.find((c) => c.id === ids[0]);
    const style = { ...look, '--size': toInspector(look['--size'] ?? '5cqmin') };
    const words = ids.length === 1 && first ? [{ at: WORDS_AT, text: cuePlain(first.text) }] : [];
    return { overrides: () => [{ at: ':root', style }, ...words], preview: () => {}, point: () => {} } as unknown as PropsHost;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vtt, sel, scope, ids]);
  if (!sel || !vtt || !host) return <InspectorPanel title={t('captionTrack.title')} width={width} onClose={onClose}><p className="mt-3 text-[11.5px] text-[var(--text-muted)]">{t('captionTrack.pickHint')}</p></InspectorPanel>;

  /**
   * A look written for the scope: `set` the text's variables (a look from before given up for them), `own` WebVTT's
   * own CSS (null: taken away).
   */
  const apply = (set: Record<string, string>, own: Record<string, string | null> = {}) => {
    let out: Vtt = vttRef.current ?? vtt;
    const vars = Object.keys(set).length > 0;
    if (scope === 'all') {
      out = setCueRule(out, '::cue', { ...(vars ? lookDecls(cueRule(out, '::cue'), set) : {}), ...own });
      /* every cue takes the track's look for these: their own say of them goes */
      const off = Object.fromEntries([...Object.keys(set), ...Object.keys(own), ...(vars ? PLAIN : [])].map((k) => [k, null]));
      for (const c of out.cues) out = setCueRule(out, `::cue(#${c.id})`, off);
    } else {
      for (const id of ids) out = setCueRule(out, `::cue(#${id})`, { ...(vars ? lookDecls(cueRule(out, `::cue(#${id})`), set) : {}), ...own });
    }
    void write(out, 'captionTrack.stepLook');
  };
  const setVar = (k: string, v: string) => apply({ [k]: v });

  /* Word art and Animation (the text inspector's): the variables they changed */
  const commit = (next: Record<string, unknown>[]) => {
    const was = textVars(host.overrides() as never);
    const now = textVars(next);
    const set: Record<string, string> = {};
    for (const k of Object.keys(now)) if (now[k] !== was[k] && k !== '--align') set[k] = k === '--size' ? fromInspector(now[k]!) : now[k]!;
    if (Object.keys(set).length) { apply(set); return; }
    const words = textWords(next);
    if (ids.length === 1 && words?.trim() && words !== cuePlain(vtt.cues.find((c) => c.id === ids[0])?.text ?? '')) void write(setCueText(vtt, ids[0]!, words.trim()), 'captionTrack.stepText');
  };

  /* a preset: its look on every caption (they take it, their own look given up) or on the picked ones; none: no look */
  const preset = (vars: Record<string, string> | null) => {
    if (vars) { apply(captionLookSet(vars)); return; }
    const off = Object.fromEntries([...LOOK_VARS, ...PLAIN].map((k) => [k, null]));
    let out: Vtt = vtt;
    if (scope === 'all') { out = setCueRule(out, '::cue', off); for (const c of out.cues) out = setCueRule(out, `::cue(#${c.id})`, off); }
    else for (const id of ids) out = setCueRule(out, `::cue(#${id})`, off);
    void write(out, 'captionTrack.stepLook');
  };
  const lookNow = captionLookSet(look);
  const same = (vars: Record<string, string>) => { const set = captionLookSet(vars); return LOOK_VARS.every((k) => set[k] === lookNow[k]); };
  const presetOn = !LOOK_VARS.some((k) => k in varsOf(trackRule) || k in varsOf(ownRule)) ? ''
    : saved.find((s) => same(s.vars))?.id ?? Object.keys(FILM_SUBTITLE_LOOKS).find((id) => same(captionLookVars(id))) ?? null;

  const first = vtt.cues.find((c) => ids.includes(c.id));
  const line = first ? Number.parseFloat(cueSettings(first.settings).line ?? '') : Number.NaN;
  const align = first ? cueSettings(first.settings).align : undefined;
  const alignNow = align === 'start' || align === 'left' ? 'left' : align === 'end' || align === 'right' ? 'right' : 'center';
  const targets = () => new Set(scope === 'all' ? vtt.cues.map((c) => c.id) : ids);
  const placeAt = (pct: number) => {
    /* a place of its own: out of its region, its line where it was put, its text kept in the middle */
    void write(setCueSettings(vtt, targets(), (s) => withSettings(s, { region: null, line: `${Math.round(pct)}%`, position: null })), 'captionTrack.stepPlace');
  };
  const alignTo = (a: string) => void write(setCueSettings(vtt, targets(), (s) => withSettings(s, { align: a === 'left' ? 'start' : a === 'right' ? 'end' : 'center' })), 'captionTrack.stepPlace');
  const ownCount = ids.filter((id) => Object.keys(cueRule(vtt, `::cue(#${id})`)).length).length;
  const family = splitFontFamily(look['--font'] ?? '')[0] ?? '';
  const withFont = (f: string) => joinFontFamily(f, splitFontFamily(TEXT_DEFAULTS['--font']!)[1]);
  const bold = num(look['--weight'], 400) >= 600;
  const italic = look['--italic'] === 'italic';
  const underline = /underline/.test(css('text-decoration') ?? '');
  const box = look['--box'] ?? 'transparent';

  /* what captions have that a text has not: one look for all of them, or the picked ones' own */
  const scopeBar = (
    <div className="flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-[var(--text)]">
        <input type="checkbox" data-caption-apply-all="" checked={all} onChange={(e) => setCaptionApplyAll(e.target.checked)} className="accent-[var(--accent)]" />
        {t('captionTrack.scopeAll')}
      </label>
      {ownCount ? (
        <div data-caption-own="" className="flex items-center justify-between gap-2 rounded-[5px] bg-[var(--bg-field)] px-2 py-1 text-[10.5px] text-[var(--text-muted)]">
          <span>{t(ownCount === 1 && ids.length === 1 ? 'captionTrack.ownOne' : 'captionTrack.ownSome').replace('{n}', String(ownCount))}</span>
          <button type="button" className="flex shrink-0 items-center gap-1 text-[var(--text)] hover:underline"
            onClick={() => { let next = vtt; for (const cid of ids) next = setCueRule(next, `::cue(#${cid})`, null); void write(next, 'captionTrack.stepLook'); }}>
            <RotateCcw size={11} />{t('captionTrack.useTrack')}
          </button>
        </div>
      ) : null}
    </div>
  );
  const toggle = (on: boolean, label: string, icon: React.ReactNode, run: () => void) => (
    <Tooltip label={label}>
      <button type="button" aria-label={label} aria-pressed={on} onClick={run}
        className={`grid h-[26px] w-[30px] place-items-center rounded-[5px] ${on ? 'bg-[var(--bg-picked)] text-[var(--accent)]' : 'bg-[var(--bg-field)] text-[var(--text-muted)] hover:text-[var(--text)]'}`}>
        {icon}
      </button>
    </Tooltip>
  );

  const basic = (
    <div data-caption-basic="" className="flex flex-col gap-2.5">
      <Words key={`${sel.src}:${ids.join(',')}`} text={ids.length === 1 && first ? cuePlain(first.text) : ''} many={ids.length > 1 ? ids.length : 0}
        onEdit={(words) => { if (ids.length === 1) void write(setCueText(vtt, ids[0]!, words), 'captionTrack.stepText'); }} />
      <Line label={t('textInspector.font')}>
        <FontFamilyPicker label={t('textInspector.font')} value={family} sample={first ? cuePlain(first.text) : 'Aa'}
          onPreview={() => {}} onRevert={() => {}} onCommit={(f) => setVar('--font', withFont(f))} className={FIELD} />
      </Line>
      <SliderField label={t('textInspector.size')} value={num(look['--size'], 5)} min={1} max={20} step={0.5} unit="%" onCommit={(n) => setVar('--size', `${n}cqmin`)} />
      <Line label={t('captionTrack.style')}>
        <div className="flex gap-1.5">
          {toggle(bold, t('captionTrack.bold'), <Bold size={14} />, () => setVar('--weight', bold ? '400' : '700'))}
          {toggle(underline, t('captionTrack.underline'), <Underline size={14} />, () => apply({}, { 'text-decoration': underline ? null : 'underline' }))}
          {toggle(italic, t('captionTrack.italic'), <Italic size={14} />, () => setVar('--italic', italic ? 'normal' : 'italic'))}
        </div>
      </Line>
      <Line label={t('textInspector.color')}>
        <ColorField label={t('textInspector.color')} value={look['--color'] ?? '#ffffff'} onCommit={(c) => apply({ '--color': c, '--fill': 'none' })} />
      </Line>
      <Line label={t('captionTrack.letterSpacing')}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          <NumField label={t('captionTrack.letterSpacing')} value={look['--spacing'] === 'normal' ? 0 : num(look['--spacing'])} unit="em" step={0.01} min={-0.1} max={1}
            onCommit={(n) => setVar('--spacing', `${n}em`)} />
          <span className="text-[11px] text-[var(--text-muted)]">{t('captionTrack.lineSpacing')}</span>
          <NumField label={t('captionTrack.lineSpacing')} value={num(css('line-height'), 1.25)} step={0.05} min={0.8} max={3}
            onCommit={(n) => apply({}, { 'line-height': String(n) })} />
        </div>
      </Line>
      <Line label={t('textInspector.align')}>
        <Segmented label={t('textInspector.align')} value={alignNow} onChange={alignTo} options={[
          { value: 'left', label: <AlignLeft size={14} />, title: t('textInspector.left') },
          { value: 'center', label: <AlignCenter size={14} />, title: t('textInspector.center') },
          { value: 'right', label: <AlignRight size={14} />, title: t('textInspector.right') },
        ]} />
      </Line>
      <Line label={t('textInspector.edge')}>
        <div className="grid grid-cols-2 gap-2">
          <NumField label={t('textInspector.edge')} value={num(look['--stroke'])} unit="em" step={0.01} min={0} max={0.4} onCommit={(n) => setVar('--stroke', `${n}em`)} />
          <ColorField label={t('textInspector.edgeColor')} value={look['--stroke-color'] ?? '#000000'} onCommit={(c) => setVar('--stroke-color', c)} />
        </div>
      </Line>
      <Line label={t('textInspector.box')}>
        <ColorField label={t('textInspector.box')} value={clear(box) ? 'transparent' : box}
          onCommit={(c) => apply(clear(c) ? { '--box': 'transparent' } : { '--box': c, ...(num(look['--box-pad']) ? {} : { '--box-pad': '0.1em 0.35em', '--box-radius': '0.15em' }) })} />
      </Line>
      <Line label={t('captionTrack.shadow')}>
        <ColorField label={t('captionTrack.shadow')} value={look['--shadow'] && look['--shadow'] !== 'none' ? colorIn(look['--shadow']) : 'transparent'}
          onCommit={(c) => setVar('--shadow', clear(c) ? 'none' : `0 0.05em 0.25em ${c}`)} />
      </Line>
      <Line label={t('captionTrack.place')}>
        <Segmented label={t('captionTrack.place')} value={PLACES.find((p) => Math.abs(p.at - line) < 1)?.id ?? ''} onChange={(v) => placeAt(PLACES.find((p) => p.id === v)!.at)}
          options={PLACES.map((p) => ({ value: p.id, label: t(`captionTrack.place_${p.id}`) }))} />
      </Line>
      <SliderField label={t('captionTrack.height')} value={Number.isFinite(line) ? line : 90} min={0} max={100} unit="%" onCommit={placeAt} />
      <div className="mt-1 border-t border-[var(--border)] pt-2.5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11.5px] font-semibold text-[var(--text)]">{t('captionTrack.presets')}</span>
          <button type="button" data-caption-save-look="" onClick={() => saveLook(captionLookSet(look))}
            className="h-6 rounded-[5px] bg-[var(--bg-field)] px-2 text-[11px] text-[var(--text)] hover:bg-[var(--bg-hover)]">{t('captionTrack.saveLook')}</button>
        </div>
        <CaptionPresets on={presetOn} saved={saved} onDrop={dropLook} onPick={(_, vars) => preset(vars)} />
      </div>
    </div>
  );

  return (
    <InspectorPanel title={t('captionTrack.title')} width={width} onClose={onClose} tabs={tabs} tab={tab} onTab={setTab}>
      {tab === 'lines' ? (
        <Lines key={sel.src} projectId={projectId} vtt={vtt} src={sel.src} ids={ids} timeMs={timeMs} info={infoOf(sel.src)} onSeek={onSeek}
          onEdit={(id, words) => void write(setCueText(vtt, id, words), 'captionTrack.stepText')}
          onRemove={(gone) => { setCaptionSelection(null); void write(removeCues(vtt, gone), 'captionTrack.stepRemove'); }}
          onAdd={onAdd} onCut={onCut} onTranslated={onTranslated} />
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {tab === 'text' ? (
            <Segmented label={t('textInspector.text')} value={part} onChange={setPart}
              options={[{ value: 'basic', label: t('captionTrack.partBasic') }, { value: 'wordart', label: t('textInspector.wordart') }]} />
          ) : null}
          {scopeBar}
          {tab === 'motion' ? <WordEffects vtt={vtt} onWrite={(next, step) => void write(next, step ?? 'captionTrack.stepLook')} /> : null}
          {tab === 'text' && part === 'basic' ? basic : (
            /* a text's inspector, its one part shown */
            <div data-caption-look={tab === 'motion' ? 'motion' : 'wordart'} className="-mx-3">
              <style>{`[data-caption-look] section[data-section] { display: none; } [data-caption-look="${tab === 'motion' ? 'motion' : 'wordart'}"] section[data-section="${tab === 'motion' ? 'motion' : 'wordart'}"] { display: block; border-top: 0; }`}</style>
              <TextInspector key={`${sel.src}:${scope}:${ids.join(',')}`} host={host} commit={commit as never} />
            </div>
          )}
        </div>
      )}
    </InspectorPanel>
  );
}

/** A field with its name before it, in the column the sliders keep theirs. */
function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-[11px] text-[var(--text-muted)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The words of the caption picked, kept on leaving the field (several picked: none to type). */
function Words({ text, many, onEdit }: { text: string; many: number; onEdit: (words: string) => void }) {
  const t = useT();
  const [draft, setDraft] = React.useState(text);
  React.useEffect(() => setDraft(text), [text]);
  return (
    <textarea data-caption-words="" value={draft} disabled={many > 0} rows={3} onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { if (draft.trim() && draft !== text) onEdit(draft.trim()); else setDraft(text); }}
      placeholder={many ? t('captionTrack.manyPicked').replace('{n}', String(many)) : t('textInspector.wordsHint')}
      className="w-full resize-none rounded-[6px] bg-[var(--bg-field)] px-2.5 py-2 text-[12px] leading-[1.5] text-[var(--text)] outline-none ring-1 ring-inset ring-transparent placeholder:text-[var(--text-faint)] focus:ring-[var(--accent)] disabled:opacity-70" />
  );
}

/**
 * The Captions tab: the track at a glance; its lines numbered, found by a search, each corrected in place, a caption
 * added after it or deleted; with Cut by captions on, lines ticked are cut out of the film; the track translated.
 */
function Lines({ projectId, vtt, src, ids, timeMs, info, onSeek, onEdit, onRemove, onAdd, onCut, onTranslated }: {
  projectId: string; vtt: Vtt; src: string; ids: readonly string[]; timeMs: number; info: CaptionTrackInfo;
  onSeek: (ms: number) => void; onEdit: (id: string, words: string) => void; onRemove: (ids: ReadonlySet<string>) => void;
  onAdd: (src: string, atMs: number) => Promise<string | null>;
  onCut: (ranges: readonly { startMs: number; endMs: number }[]) => Promise<string | null>;
  onTranslated: (from: string, src: string, language: string) => Promise<string | null>;
}) {
  const t = useT();
  const [q, setQ] = React.useState('');
  const [cutting, setCutting] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const lastEnd = vtt.cues.reduce((end, c) => Math.max(end, c.end), 0);
  const query = q.trim().toLowerCase();
  const rows = vtt.cues.map((c, i) => ({ c, n: i + 1, text: cuePlain(c.text) })).filter((r) => !query || r.text.toLowerCase().includes(query));
  const language = info.language ? FILM_SUBTITLE_LANGUAGES.find((l) => l.code === info.language)?.native ?? info.language : null;
  const facts = [
    info.badge,
    info.speech ? t(info.speech.auto ? 'captionTrack.infoSpeechAuto' : 'captionTrack.infoSpeechEdited') : t('captionTrack.infoOwn'),
    language,
    t('captionTrack.infoLines').replace('{n}', String(vtt.cues.length)).replace('{t}', `${Math.floor(lastEnd / 60)}:${String(Math.round(lastEnd % 60)).padStart(2, '0')}`),
  ].filter(Boolean).join(' · ');
  const iconBtn = 'grid h-7 w-7 shrink-0 place-items-center rounded-[6px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]';
  return (
    <div className="mt-3 flex min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1.5">
        {cutting ? <span className="min-w-0 flex-1 truncate px-0.5 text-[12px] font-semibold text-[var(--text)]">{t('captionTrack.cutMode')}</span> : null}
        <label className={`${cutting ? 'hidden' : 'flex'} h-7 min-w-0 flex-1 items-center gap-1.5 rounded-[6px] bg-[var(--bg-field)] px-2 text-[var(--text-faint)] focus-within:ring-1 focus-within:ring-[var(--accent)]`}>
          <Search size={13} className="shrink-0" />
          <input data-caption-search="" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('captionTrack.search')}
            className="min-w-0 flex-1 bg-transparent text-[11.5px] text-[var(--text)] outline-none placeholder:text-[var(--text-faint)]" />
          {q ? <button type="button" aria-label={t('project.close')} onClick={() => setQ('')} className="shrink-0 hover:text-[var(--text)]"><X size={12} /></button> : null}
        </label>
        <Tooltip label={t('captionTrack.cutMode')}>
          <button type="button" data-caption-cut-mode="" aria-pressed={cutting} aria-label={t('captionTrack.cutMode')}
            onClick={() => setCutting(!cutting)}
            className={`${iconBtn} ${cutting ? 'bg-[var(--bg-picked)] !text-[var(--accent)]' : ''}`}><Scissors size={14} /></button>
        </Tooltip>
        <Translate projectId={projectId} src={src} onTranslated={onTranslated} className={iconBtn} />
      </div>
      <p data-caption-facts="" title={src} className="truncate text-[10.5px] text-[var(--text-faint)]">{facts}</p>
      {cutting ? <Transcript vtt={vtt} timeMs={timeMs} onSeek={onSeek} onCut={onCut} onDone={() => setCutting(false)} /> : (
      <div className="-mx-1 flex flex-col">
        {rows.map(({ c, n, text }) => (
          <CueLine key={c.id} n={n} text={text} on={c.start * 1000 <= timeMs && timeMs < c.end * 1000} picked={ids.includes(c.id)}
            onGo={() => { onSeek(Math.round(c.start * 1000)); setCaptionSelection({ src, ids: new Set([c.id]) }); }}
            onEdit={(words) => onEdit(c.id, words)}
            onAdd={() => { setProblem(null); void onAdd(src, Math.round(c.end * 1000)).then((why) => setProblem(why)); }}
            onRemove={() => onRemove(new Set([c.id]))} />
        ))}
        {!rows.length ? <p className="px-1 py-3 text-[11.5px] text-[var(--text-faint)]">{t('captionTrack.searchNone')}</p> : null}
      </div>
      )}
      {problem ? <p role="alert" className="text-[11px] text-[var(--err)]">{problem}</p> : null}
    </div>
  );
}

/** One line of the track: its number, its words to correct (kept on leaving the field), lit while it plays. */
function CueLine({ n, text, on, picked, onGo, onEdit, onAdd, onRemove }: {
  n: number; text: string; on: boolean; picked: boolean; onGo: () => void;
  onEdit: (words: string) => void; onAdd: () => void; onRemove: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = React.useState(text);
  React.useEffect(() => setDraft(text), [text]);
  const line = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => { if (on) line.current?.scrollIntoView({ block: 'nearest' }); }, [on]);
  const lit = on || picked;
  return (
    <div ref={line} data-caption-line="" className="group flex items-start gap-1.5 border-b border-[var(--border)] px-1 py-1.5">
      <button type="button" onClick={onGo} className={`mt-[4px] w-6 shrink-0 text-right text-[11px] tabular-nums ${lit ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`}>{n}</button>
      <textarea value={draft} rows={1} onChange={(e) => setDraft(e.target.value)} onFocus={onGo}
        onBlur={() => { if (draft.trim() && draft !== text) onEdit(draft.trim()); else setDraft(text); }}
        className={`min-w-0 flex-1 resize-none rounded-[5px] bg-transparent px-1.5 py-0.5 text-[12px] leading-snug outline-none [field-sizing:content] focus:bg-[var(--bg-field)] focus:ring-1 focus:ring-[var(--accent)] ${lit ? 'text-[var(--accent)]' : 'text-[var(--text)]'}`} />
      <span className="mt-px flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100">
        <button type="button" data-caption-add-after="" aria-label={t('captionTrack.addAfter')} title={t('captionTrack.addAfter')} onClick={onAdd}
          className="grid h-6 w-6 place-items-center rounded-[5px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"><Plus size={13} /></button>
        <button type="button" data-caption-remove="" aria-label={t('subtitleRow.delete')} title={t('subtitleRow.delete')} onClick={onRemove}
          className="grid h-6 w-6 place-items-center rounded-[5px] text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--err)]"><Trash2 size={13} /></button>
      </span>
    </div>
  );
}

/** Translate the track: another caption track in that language, made by the agent or a service that translates. */
function Translate({ projectId, src, onTranslated, className }: {
  projectId: string; src: string; className: string;
  onTranslated: (from: string, src: string, language: string) => Promise<string | null>;
}) {
  const t = useT();
  const ui = useLanguage();
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<{ busy: string | null; error: string | null; connect: boolean }>({ busy: null, error: null, connect: false });
  const named = React.useMemo(() => { try { return new Intl.DisplayNames([ui], { type: 'language' }); } catch { return null; } }, [ui]);
  const nameOf = (code: string) => named?.of(code) ?? FILM_SUBTITLE_LANGUAGES.find((item) => item.code === code)?.native ?? code;
  const run = async (language: string) => {
    setState({ busy: language, error: null, connect: false });
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/translate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src, language }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({})) as { src?: string; error?: string; code?: string } | undefined;
    if (!res?.ok || !body?.src) { setState({ busy: null, error: body?.error ?? 'network', connect: body?.code === 'no-translator' }); return; }
    const why = await onTranslated(src, body.src, language);
    setState({ busy: null, error: why, connect: false });
    if (!why) setOpen(false);
  };
  const failure = state.connect ? (studioHost?.agents ? 'timeline.subtitleTranslateAgent' : 'timeline.subtitleTranslateConnect') : 'timeline.subtitleTranslateFailed';
  return (
    <Popover open={open} onOpenChange={setOpen} align="end" trigger={(
      <Tooltip label={t('captionTrack.translate')}>
        <button type="button" data-caption-translate="" aria-label={t('captionTrack.translate')} aria-expanded={open} onClick={() => setOpen(!open)}
          className={`${className} ${open ? 'bg-[var(--bg-picked)] !text-[var(--accent)]' : ''}`}>
          {state.busy ? <Loader2 size={14} className="animate-spin" /> : <Languages size={14} />}
        </button>
      </Tooltip>
    )}>
      <div className="flex w-[220px] flex-col gap-1 rounded-lg bg-[var(--bg-raised)] p-2 shadow-[var(--shadow-lg)] ring-1 ring-[var(--border)]">
        <p className="px-1 pb-1 text-[10.5px] leading-snug text-[var(--text-faint)]">{t('captionTrack.translateWhy')}</p>
        <div className="flex max-h-[240px] flex-col overflow-y-auto">
          {FILM_SUBTITLE_LANGUAGES.map((l) => (
            <button key={l.code} type="button" disabled={!!state.busy} onClick={() => void run(l.code)}
              className="flex h-7 items-center justify-between rounded-[5px] px-2 text-left text-[12px] text-[var(--text)] hover:bg-[var(--bg-hover)]">
              <span>{nameOf(l.code)}</span>
              {state.busy === l.code ? <Loader2 size={12} className="animate-spin text-[var(--text-muted)]" /> : null}
            </button>
          ))}
        </div>
        {state.error ? <p role="alert" title={state.error} className="px-1 pt-1 text-[11px] text-[var(--err)]">{t(failure)}</p> : null}
      </div>
    </Popover>
  );
}
