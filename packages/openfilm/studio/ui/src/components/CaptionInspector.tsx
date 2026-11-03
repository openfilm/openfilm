/**
 * A caption track's inspector (SPEC §1 Captions): a caption is a line of words as a text is, so its look is edited as
 * a text's (TextInspector, the same tabs: Text, Word art, Motion, with the library's word art and motions), and what
 * only captions have is in a tab of its own: every line of the track to read and correct, where they sit, translation.
 *
 * What a text's inspector changes is the library text's variables (lib/text-look); here they are the file's STYLE
 * (the caption renderer styles a cue's words by them, src/captions.mjs): with "Apply to all captions" (on, as captions
 * are one look) the track's `::cue`, every cue's own say of them taken away; off, the picked cues' own `::cue(#c3)`.
 * A track's look from before (plain CSS: `font`, `color`…) is read as the variables and given up for them once changed.
 * The size is a share of the frame's short side: the inspector's % is a tenth of a percent of it here (40 = 4cqmin).
 */
import React from 'react';
import { Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { cuePlain, cueSettings, withSettings } from '../../../../src/captions.mjs';
import { FILM_SUBTITLE_LANGUAGES } from '../../../server/film-subtitle.mjs';
import { studioHost } from '@/lib/host';
import { useT } from '@/i18n';
import { cueRule, removeCues, setCueRule, setCueSettings, setCueText, type Vtt } from '@/lib/caption-edits';
import { setCaptionApplyAll, setCaptionSelection, useCaptionApplyAll, useCaptionSelection, useCaptionTrack } from '@/lib/caption-tracks';
import { WORDS_AT, textVars, textWords } from '@/lib/text-look';
import { CAPTION_DEFAULTS, PLAIN, fromInspector, lookDecls, toInspector, varsOf } from '@/lib/caption-look';
import { InspectorPanel } from './InspectorPanel';
import type { PropsHost } from './PropertiesSection';
import { ColorField, Section, Segmented, SliderField } from './inspector-fields';
import { MenuSelect } from './MenuSelect';
import { TextInspector } from './TextInspector';

type Tab = 'text' | 'wordart' | 'motion' | 'captions';
/** The tab shown last: the next caption picked opens on it. */
let lastTab: Tab = 'text';

/** Where a caption sits: a line of the picture, % from its top. */
const PLACES = [{ id: 'top', at: 12 }, { id: 'middle', at: 55 }, { id: 'bottom', at: 90 }] as const;

export function CaptionInspector({ projectId, width, onClose, timeMs, onSeek, onTranslated }: {
  projectId: string;
  width: number;
  onClose: () => void;
  /** The playhead (ms): the line playing is lit in the list. */
  timeMs: number;
  onSeek: (ms: number) => void;
  /** A translation of the track written (`src`, in `language`): put it in the film, just above the track. */
  onTranslated: (from: string, src: string, language: string) => Promise<string | null>;
}) {
  const t = useT();
  const sel = useCaptionSelection();
  const { vtt, write } = useCaptionTrack(projectId, sel?.src ?? '');
  const all = useCaptionApplyAll();
  const scope = all ? 'all' : 'selected';
  const [tab, setTabState] = React.useState<Tab>(lastTab);
  const setTab = (next: string) => { lastTab = next as Tab; setTabState(next as Tab); };
  const ids = React.useMemo(() => [...(sel?.ids ?? [])], [sel]);
  const tabs = [
    { id: 'text', label: t('textInspector.text') },
    { id: 'wordart', label: t('textInspector.wordart') },
    { id: 'motion', label: t('textInspector.motion') },
    { id: 'captions', label: t('captionTrack.tabLines') },
  ];
  /* the look as the text inspector reads it: the track's, under the first picked cue's own when only they change */
  const vttRef = React.useRef(vtt);
  vttRef.current = vtt;
  const host = React.useMemo(() => {
    if (!vtt || !sel) return null;
    const look = { ...CAPTION_DEFAULTS, ...varsOf(cueRule(vtt, '::cue')), ...(scope === 'selected' && ids[0] ? varsOf(cueRule(vtt, `::cue(#${ids[0]})`)) : {}) };
    const first = vtt.cues.find((c) => c.id === ids[0]);
    const align = first ? cueSettings(first.settings).align : undefined;
    const style = { ...look, '--size': toInspector(look['--size'] ?? '5cqmin'), ...(align ? { '--align': align === 'start' ? 'left' : align === 'end' ? 'right' : align } : {}) };
    const words = ids.length === 1 && first ? [{ at: WORDS_AT, text: cuePlain(first.text) }] : [];
    return { overrides: () => [{ at: ':root', style }, ...words], preview: () => {}, point: () => {} } as unknown as PropsHost;
  }, [vtt, sel, scope, ids]);
  if (!sel || !vtt || !host) return <InspectorPanel title={t('captionTrack.title')} width={width} onClose={onClose}><p className="mt-3 text-[11.5px] text-[var(--text-muted)]">{t('captionTrack.pickHint')}</p></InspectorPanel>;

  /* the text inspector's change: the variables it changed written for the scope, the words for the one caption */
  const commit = (next: Record<string, unknown>[]) => {
    const was = textVars(host.overrides() as never);
    const now = textVars(next);
    const changed = Object.keys(now).filter((k) => now[k] !== was[k]);
    let out: Vtt = vttRef.current ?? vtt;
    const set: Record<string, string> = {};
    for (const k of changed) if (k !== '--align') set[k] = k === '--size' ? fromInspector(now[k]!) : now[k]!;
    if (Object.keys(set).length) {
      if (scope === 'all') {
        out = setCueRule(out, '::cue', lookDecls(cueRule(out, '::cue'), set));
        /* every cue takes the track's look for these: their own say of them goes */
        const off = Object.fromEntries([...Object.keys(set), ...PLAIN].map((k) => [k, null]));
        for (const c of out.cues) out = setCueRule(out, `::cue(#${c.id})`, off);
      } else {
        for (const id of ids) out = setCueRule(out, `::cue(#${id})`, lookDecls(cueRule(out, `::cue(#${id})`), set));
      }
    }
    if (changed.includes('--align')) {
      const a = now['--align'] === 'left' ? 'start' : now['--align'] === 'right' ? 'end' : 'center';
      out = setCueSettings(out, new Set(scope === 'all' ? out.cues.map((c) => c.id) : ids), (s) => withSettings(s, { align: a }));
    }
    const words = textWords(next);
    if (ids.length === 1 && words != null && words.trim() && words !== cuePlain(out.cues.find((c) => c.id === ids[0])?.text ?? '')) out = setCueText(out, ids[0]!, words.trim());
    void write(out, changed.length ? 'captionTrack.stepLook' : 'captionTrack.stepText');
  };

  const timed = vtt.cues.some((c) => /<\d+:\d/.test(c.text));
  const lit = cueRule(vtt, '::cue(:past)').color;
  const reveal = cueRule(vtt, '::cue(:future)').opacity === '0';
  const ownCount = ids.filter((id) => Object.keys(cueRule(vtt, `::cue(#${id})`)).length).length;
  const first = vtt.cues.find((c) => ids.includes(c.id));
  const line = first ? Number.parseFloat(cueSettings(first.settings).line ?? '') : Number.NaN;
  const placeAt = (pct: number) => {
    const targets = new Set(scope === 'all' ? vtt.cues.map((c) => c.id) : ids);
    /* a place of its own: out of its region, its line where it was put, its text kept in the middle */
    void write(setCueSettings(vtt, targets, (s) => withSettings(s, { region: null, line: `${Math.round(pct)}%`, position: null })), 'captionTrack.stepPlace');
  };

  /* what captions have that a text has not: one look for all of them, or the picked ones' own */
  const scopeBar = (
    <div className="mt-3 flex flex-col gap-1.5">
      <label className="flex cursor-pointer items-center gap-2 text-[11.5px] text-[var(--text)]">
        <input type="checkbox" data-caption-apply-all="" checked={all} onChange={(e) => setCaptionApplyAll(e.target.checked)} className="accent-[var(--accent)]" />
        {t('captionTrack.scopeAll')}
      </label>
      {ownCount ? (
        <div data-caption-own="" className="flex items-center justify-between gap-2 rounded-[5px] bg-[var(--fill-tsp)] px-2 py-1 text-[10.5px] text-[var(--text-muted)]">
          <span>{t(ownCount === 1 && ids.length === 1 ? 'captionTrack.ownOne' : 'captionTrack.ownSome').replace('{n}', String(ownCount))}</span>
          <button type="button" className="flex shrink-0 items-center gap-1 text-[var(--text)] hover:underline"
            onClick={() => { let next = vtt; for (const cid of ids) next = setCueRule(next, `::cue(#${cid})`, null); void write(next, 'captionTrack.stepLook'); }}>
            <RotateCcw size={11} />{t('captionTrack.useTrack')}
          </button>
        </div>
      ) : null}
    </div>
  );

  return (
    <InspectorPanel title={t('captionTrack.title')} width={width} onClose={onClose} tabs={tabs} tab={tab} onTab={setTab}>
      {tab !== 'captions' ? (
        <>
          {scopeBar}
          {/* a text's inspector, its one tab shown */}
          <div data-caption-look={tab}>
            <style>{`[data-caption-look] section[data-section] { display: none; } [data-caption-look="${tab}"] section[data-section="${tab}"] { display: block; }`}</style>
            <TextInspector key={`${sel.src}:${scope}:${ids.join(',')}`} host={host} commit={commit as never} />
          </div>
        </>
      ) : (
        <>
          <Section id="caption-lines" title={t('captionTrack.lines')}>
            <div className="flex flex-col gap-1">
              {vtt.cues.map((c) => (
                <CueLine key={c.id} at={c.start} text={cuePlain(c.text)} on={c.start * 1000 <= timeMs && timeMs < c.end * 1000} picked={ids.includes(c.id)}
                  onGo={() => { onSeek(Math.round(c.start * 1000)); setCaptionSelection({ src: sel.src, ids: new Set([c.id]) }); }}
                  onEdit={(words) => void write(setCueText(vtt, c.id, words), 'captionTrack.stepText')} />
              ))}
            </div>
          </Section>
          <Section id="caption-place" title={t('captionTrack.place')}>
            <div className="flex flex-col gap-2">
              <Segmented label={t('captionTrack.place')} value={PLACES.find((p) => Math.abs(p.at - line) < 1)?.id ?? ''} onChange={(v) => placeAt(PLACES.find((p) => p.id === v)!.at)}
                options={PLACES.map((p) => ({ value: p.id, label: t(`captionTrack.place_${p.id}`) }))} />
              <SliderField label={t('captionTrack.height')} value={Number.isFinite(line) ? line : 90} min={0} max={100} unit="%" onCommit={placeAt} />
            </div>
          </Section>
          {/* where a caption times its words: how they are said, lit as they come or shown one by one */}
          <Section id="caption-words" title={t('captionTrack.wordLight')}>
            {timed ? (
              <div className="flex flex-col gap-2">
                <Segmented label={t('captionTrack.wordLight')} value={reveal ? 'reveal' : lit ? 'lit' : 'off'} onChange={(v) => {
                  let next = setCueRule(vtt, '::cue(:past)', v === 'lit' ? { color: lit ?? '#ffd400' } : null);
                  next = setCueRule(next, '::cue(:future)', v === 'reveal' ? { opacity: '0' } : null);
                  void write(next, 'captionTrack.stepLook');
                }} options={[
                  { value: 'off', label: t('captionTrack.wordLightOff') },
                  { value: 'lit', label: t('captionTrack.wordLightOn') },
                  { value: 'reveal', label: t('captionTrack.wordReveal') },
                ]} />
                {lit && !reveal ? <ColorField label={t('captionTrack.wordLightColor')} value={lit} onCommit={(c) => void write(setCueRule(vtt, '::cue(:past)', { color: c }), 'captionTrack.stepLook')} /> : null}
              </div>
            ) : <p className="text-[10.5px] leading-snug text-[var(--text-faint)]">{t('captionTrack.wordsUntimed')}</p>}
          </Section>
          <Translate projectId={projectId} src={sel.src} onTranslated={onTranslated} />
          <div className="mt-3">
            <button type="button" data-caption-delete="" onClick={() => { setCaptionSelection(null); void write(removeCues(vtt, new Set(ids)), 'captionTrack.stepRemove'); }}
              className="flex h-7 w-full items-center justify-center gap-1.5 rounded-[5px] bg-[var(--fill-tsp)] text-[11.5px] text-[var(--danger,#e5484d)] hover:bg-[var(--bg-hover)]">
              <Trash2 size={13} />{ids.length > 1 ? t('captionTrack.deleteN').replace('{n}', String(ids.length)) : t('subtitleRow.delete')}
            </button>
          </div>
        </>
      )}
    </InspectorPanel>
  );
}

/** One line of the track: its start, its words to correct (kept on leaving the field), lit while it plays. */
function CueLine({ at, text, on, picked, onGo, onEdit }: { at: number; text: string; on: boolean; picked: boolean; onGo: () => void; onEdit: (words: string) => void }) {
  const [draft, setDraft] = React.useState(text);
  React.useEffect(() => setDraft(text), [text]);
  const line = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => { if (on) line.current?.scrollIntoView({ block: 'nearest' }); }, [on]);
  const mm = Math.floor(at / 60), ss = Math.floor(at % 60);
  return (
    <div ref={line} data-caption-line="" className={`flex items-start gap-2 rounded-[5px] px-1 py-0.5 ${on ? 'bg-[var(--fill-tsp)]' : ''}`}>
      <button type="button" onClick={onGo} className={`mt-[5px] w-8 shrink-0 text-left text-[10.5px] tabular-nums ${on || picked ? 'text-[var(--accent)]' : 'text-[var(--text-faint)]'}`}>
        {mm}:{String(ss).padStart(2, '0')}
      </button>
      <textarea value={draft} rows={1} onChange={(e) => setDraft(e.target.value)} onFocus={onGo}
        onBlur={() => { if (draft.trim() && draft !== text) onEdit(draft.trim()); else setDraft(text); }}
        className="min-w-0 flex-1 resize-none rounded-[5px] bg-transparent px-1.5 py-1 text-[11.5px] leading-snug text-[var(--text)] outline-none [field-sizing:content] focus:bg-[var(--bg)] focus:ring-1 focus:ring-[var(--accent)]" />
    </div>
  );
}

/** Translate the track: another caption track in that language, made by the agent or a service that translates. */
function Translate({ projectId, src, onTranslated }: { projectId: string; src: string; onTranslated: (from: string, src: string, language: string) => Promise<string | null> }) {
  const t = useT();
  const [state, setState] = React.useState<{ busy: string | null; error: string | null; connect: boolean }>({ busy: null, error: null, connect: false });
  const nameOf = (code: string) => FILM_SUBTITLE_LANGUAGES.find((item) => item.code === code)?.native ?? code;
  const run = async (language: string) => {
    setState({ busy: language, error: null, connect: false });
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/caption-tracks/translate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ src, language }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({})) as { src?: string; error?: string; code?: string } | undefined;
    if (!res?.ok || !body?.src) { setState({ busy: null, error: body?.error ?? 'network', connect: body?.code === 'no-translator' }); return; }
    const why = await onTranslated(src, body.src, language);
    setState({ busy: null, error: why, connect: false });
  };
  const failure = state.connect ? (studioHost?.agents ? 'timeline.subtitleTranslateAgent' : 'timeline.subtitleTranslateConnect') : 'timeline.subtitleTranslateFailed';
  return (
    <Section id="caption-translate" title={t('captionTrack.translate')}>
      <MenuSelect label={t('timeline.subtitleLanguageTranslate')} value="" disabled={!!state.busy} onPick={(code) => { if (code) void run(code); }}
        groups={[{ choices: [{ value: '', label: t('timeline.subtitleLanguageTranslate') }, ...FILM_SUBTITLE_LANGUAGES.map((item) => ({ value: item.code, label: item.native }))] }]} />
      {state.busy ? (
        <p role="status" className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
          <Loader2 size={12} className="animate-spin" aria-hidden />{t('timeline.subtitleTranslating').replace('{lang}', nameOf(state.busy))}
        </p>
      ) : state.error ? (
        <p role="alert" title={state.error} className="mt-1.5 text-[11px] text-[var(--danger,#c2410c)]">{t(failure)}</p>
      ) : (
        <p className="mt-1.5 text-[10.5px] leading-snug text-[var(--text-faint)]">{t('captionTrack.translateWhy')}</p>
      )}
    </Section>
  );
}
