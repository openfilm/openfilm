import React from 'react';
import { Loader2, MessageSquarePlus } from 'lucide-react';
import { useT } from '@/i18n';
import { STUDIO_REF_TYPE, type StudioRef } from '@/lib/host';
import {
  FILM_SUBTITLE_KARAOKE_DEFAULT, FILM_SUBTITLE_LANGUAGES, joinColor, matchSubtitleLook, sameFilmSubtitleLanguage, splitColor,
  SUBTITLE_DEFAULT, SUBTITLE_LOOKS, SUBTITLE_LOOK_IDS, SUBTITLE_SIZE_PCT_MAX, SUBTITLE_SIZE_PCT_MIN, subtitleCss,
  type SubtitleCue, type SubtitleLookId, type SubtitleStyle, type SubtitleTranslateResult,
} from '@/lib/subtitles';
import { SUBTITLE_FONT_SYSTEM, useSubtitleFonts, type SubtitleFontOption } from '@/lib/use-subtitle-font';
import { Tooltip } from './Tooltip';
import { InspectorPanel } from './InspectorPanel';
import { SubtitleRowToggle } from './SubtitleRow';
import styles from './SubtitleInspector.module.css';

/**
 * A line of the panel as the person points at it: the line, its number in the list (from 1), the language it is shown
 * in (null: the voices' own) and its words as shown, and the words selected in them (character offsets; null: none).
 */
export interface SubtitleLineAt {
  cue: SubtitleCue;
  index: number;
  language: string | null;
  text: string;
  pick: { from: number; to: number } | null;
}

/** A line's key in the list, the same across a refresh of the lines (a correction keeps it). */
export const subtitleLineKey = (cue: SubtitleCue) => `${cue.src ?? ''}:${cue.line ?? cue.startMs}:${cue.startMs}`;

/**
 * With an app that has a chat (lib/host.ts `refer`): each line's "Reference in chat" (a button shown on hover), ⌘L in
 * a line, and a line dragged out by its time or that button, or words selected in it dragged out, all reference it
 * (`of` makes the reference, `send` gives it to the app); `pick` tells of the line being worked on (focused, or words
 * selected in it), which comes along with the selection.
 */
export interface SubtitleLineRefer {
  of: (line: SubtitleLineAt) => StudioRef;
  send: (ref: StudioRef) => void;
  pick: (line: SubtitleLineAt) => void;
  shortcut: string;
}

/** The Inspector's subtitle style panel: changes show at once on the picture and are kept with the project. */
export function SubtitleInspector({ subtitles, width, onClose }: {
  subtitles: {
    style: SubtitleStyle;
    onStyle: (next: Partial<SubtitleStyle>) => void;
    /** Translate the film's voices into this language (useFilmSubtitles().translate). Without it, no translating. */
    translate?: (language: string) => Promise<SubtitleTranslateResult>;
    /** The voices' language, as far as the script tells; null = can't tell. */
    sourceLanguage?: string | null;
    /** The film's lines as transcribed (with their translations), to correct; `onEditLine` writes one back (with a
        `language`, its translation into it). */
    lines?: readonly SubtitleCue[];
    onEditLine?: (cue: SubtitleCue, text: string, language?: string) => void;
    /** The playhead (film ms), which the lines follow, and moving it to a line. */
    timeMs?: number;
    onSeek?: (ms: number) => void;
    /** Speech with no transcript yet, and making it (the timeline's CC button does the same with no lines at all). */
    untranscribed?: number;
    onMake?: () => void;
    making?: boolean;
    refer?: SubtitleLineRefer;
  };
  width: number;
  onClose: () => void;
}) {
  const t = useT();
  const fonts = useSubtitleFonts();
  const s = subtitles.style;
  const set = subtitles.onStyle;
  /** One field of the font: it is a nested object, and `onStyle({ font: {...} })` alone would drop the rest. */
  const setFont = (next: Partial<SubtitleStyle['font']>) => set({ font: { ...s.font, ...next } });
  const aligns = [
    { id: 'left' as const, label: t('timeline.subtitleAlignLeft') },
    { id: 'center' as const, label: t('timeline.subtitleAlignCenter') },
    { id: 'right' as const, label: t('timeline.subtitleAlignRight') },
  ];

  return (
    <InspectorPanel title={t('timeline.subtitleStyle')} width={width} onClose={onClose}>
      <div data-subtitle-inspector className="py-2">
          {/* the looks are shown as samples, not names: "heavy outline" and "bold" sound alike and look nothing alike.
              Picked = the style is exactly that look (worked out, not stored: change a color and it is no longer it) */}
          <div className="flex gap-1.5 pb-1.5 pt-0.5">
            {SUBTITLE_LOOK_IDS.map((id) => (
              <LookSwatch
                key={id}
                look={id}
                active={matchSubtitleLook(s) === id}
                label={t(`timeline.subtitleLook.${id}`)}
                onPick={() => set(SUBTITLE_LOOKS[id])}
              />
            ))}
          </div>

          <SubtitleLanguage style={s} set={set} translate={subtitles.translate} sourceLanguage={subtitles.sourceLanguage} />

          {subtitles.lines ? (
            <SubtitleLines lines={subtitles.lines} onEdit={subtitles.onEditLine} untranscribed={subtitles.untranscribed ?? 0}
              onMake={subtitles.onMake} making={!!subtitles.making} timeMs={subtitles.timeMs ?? 0} onSeek={subtitles.onSeek} refer={subtitles.refer}
              language={s.language && !sameFilmSubtitleLanguage(s.language, subtitles.sourceLanguage ?? null) ? s.language : null} />
          ) : null}

          {/* word highlight first: the most visible effect here, and the one short videos ask for most */}
          <StyleGroup label={t('timeline.subtitleEffectGroup')}>
            <StyleLayer
              label={t('timeline.subtitleKaraoke')}
              on={!!s.karaoke}
              onToggle={() => set({ karaoke: s.karaoke ? null : FILM_SUBTITLE_KARAOKE_DEFAULT })}
            >
              {s.karaoke ? (
                <>
                  <Segmented
                    label={t('timeline.subtitleKaraokeMode')}
                    items={[
                      { id: 'box' as const, label: t('timeline.subtitleKaraokeBox') },
                      { id: 'color' as const, label: t('timeline.subtitleKaraokeColor') },
                      { id: 'pop' as const, label: t('timeline.subtitleKaraokePop') },
                    ]}
                    value={s.karaoke.mode}
                    onPick={(mode) => set({ karaoke: { ...s.karaoke!, mode } })}
                  />
                  <StyleColor
                    label={t('timeline.subtitleKaraokeTint')}
                    value={s.karaoke.color}
                    onChange={(color) => set({ karaoke: { ...s.karaoke!, color } })}
                  />
                </>
              ) : null}
            </StyleLayer>
          </StyleGroup>

          <StyleGroup label={t('timeline.subtitleFontGroup')}>
            <StyleFamily
              label={t('timeline.subtitleFamily')}
              value={s.font.family}
              fonts={fonts}
              onPick={(family) => setFont({ family })}
            />
            <StyleSlider
              label={t('timeline.subtitleSize')}
              value={s.font.sizePct}
              min={SUBTITLE_SIZE_PCT_MIN}
              max={SUBTITLE_SIZE_PCT_MAX}
              step={0.1}
              format={(v) => `${v.toFixed(1)}%`}
              onChange={(sizePct) => setFont({ sizePct })}
            />
            <StyleSlider
              label={t('timeline.subtitleWeight')}
              value={s.font.weight}
              min={100}
              max={900}
              step={100}
              format={(v) => String(v)}
              onChange={(weight) => setFont({ weight })}
            />
            <StyleSlider
              label={t('timeline.subtitleTracking')}
              value={s.font.letterSpacingEm}
              min={-0.05}
              max={0.3}
              step={0.005}
              format={(v) => v.toFixed(3)}
              onChange={(letterSpacingEm) => setFont({ letterSpacingEm })}
            />
            <StyleSlider
              label={t('timeline.subtitleLeading')}
              value={s.font.lineHeight}
              min={0.9}
              max={2.2}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(lineHeight) => setFont({ lineHeight })}
            />
            <div className="flex gap-1 px-1 pb-1 pt-0.5">
              <StyleToggle
                label={t('timeline.subtitleItalic')}
                on={s.font.italic}
                onPick={() => setFont({ italic: !s.font.italic })}
              />
              <StyleToggle
                label={t('timeline.subtitleUpper')}
                on={s.font.upper}
                onPick={() => setFont({ upper: !s.font.upper })}
              />
            </div>
          </StyleGroup>

          <StyleGroup label={t('timeline.subtitleInkGroup')}>
            <StyleColor
              label={t('timeline.subtitleFill')}
              value={s.fill}
              onChange={(fill) => set({ fill })}
            />
            {/* stroke, shadow and box switch off as a whole: off is "this film has no stroke", not a width of 0 */}
            <StyleLayer
              label={t('timeline.subtitleStroke')}
              on={!!s.stroke}
              onToggle={() => set({ stroke: s.stroke ? null : SUBTITLE_DEFAULT.stroke })}
            >
              {s.stroke ? (
                <>
                  <StyleSlider
                    label={t('timeline.subtitleStroke')}
                    value={s.stroke.widthEm}
                    min={0.005}
                    max={0.2}
                    step={0.005}
                    format={(v) => v.toFixed(3)}
                    onChange={(widthEm) => set({ stroke: { ...s.stroke!, widthEm } })}
                  />
                  <StyleColor
                    label={t('timeline.subtitleFill')}
                    value={s.stroke.color}
                    onChange={(color) => set({ stroke: { ...s.stroke!, color } })}
                  />
                </>
              ) : null}
            </StyleLayer>
            <StyleLayer
              label={t('timeline.subtitleShadow')}
              on={!!s.shadow}
              onToggle={() => set({ shadow: s.shadow ? null : SUBTITLE_DEFAULT.shadow })}
            >
              {s.shadow ? (
                <>
                  <StyleSlider
                    label={t('timeline.subtitleOffsetY')}
                    value={s.shadow.dyEm}
                    min={-0.2}
                    max={0.3}
                    step={0.005}
                    format={(v) => v.toFixed(3)}
                    onChange={(dyEm) => set({ shadow: { ...s.shadow!, dyEm } })}
                  />
                  <StyleSlider
                    label={t('timeline.subtitleBlur')}
                    value={s.shadow.blurEm}
                    min={0}
                    max={0.4}
                    step={0.005}
                    format={(v) => v.toFixed(3)}
                    onChange={(blurEm) => set({ shadow: { ...s.shadow!, blurEm } })}
                  />
                  <StyleColor
                    label={t('timeline.subtitleFill')}
                    value={s.shadow.color}
                    onChange={(color) => set({ shadow: { ...s.shadow!, color } })}
                  />
                </>
              ) : null}
            </StyleLayer>
            <StyleLayer
              label={t('timeline.subtitleBox')}
              on={!!s.box}
              onToggle={() => set({ box: s.box ? null : SUBTITLE_LOOKS.bar.box })}
            >
              {s.box ? (
                <>
                  <StyleColor
                    label={t('timeline.subtitleFill')}
                    value={s.box.color}
                    withAlpha={false}
                    onChange={(color) => set({ box: { ...s.box!, color } })}
                  />
                  <StyleSlider
                    label={t('timeline.subtitleOpacity')}
                    value={s.box.opacity}
                    min={0}
                    max={1}
                    step={0.02}
                    format={(v) => v.toFixed(2)}
                    onChange={(opacity) => set({ box: { ...s.box!, opacity } })}
                  />
                  <StyleSlider
                    label={t('timeline.subtitleRadius')}
                    value={s.box.radiusEm}
                    min={0}
                    max={0.8}
                    step={0.02}
                    format={(v) => v.toFixed(2)}
                    onChange={(radiusEm) => set({ box: { ...s.box!, radiusEm } })}
                  />
                </>
              ) : null}
            </StyleLayer>
          </StyleGroup>

          <StyleGroup label={t('timeline.subtitleLayoutGroup')}>
            <Segmented
              label={t('timeline.subtitleAlign')}
              items={aligns}
              value={s.align}
              onPick={(align) => set({ align })}
            />
            <StyleSlider
              label={t('timeline.subtitleWidth')}
              value={s.maxWidthPct}
              min={30}
              max={100}
              step={1}
              format={(v) => `${Math.round(v)}%`}
              onChange={(maxWidthPct) => set({ maxWidthPct })}
            />
          </StyleGroup>

          <button
            type="button"
            onClick={() => set(SUBTITLE_DEFAULT)}
            onMouseDown={(e) => e.preventDefault()}
            className="mt-1 w-full rounded-[6px] px-1 py-1 text-left text-[11px] transition hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('timeline.subtitleReset')}
          </button>

          {/* the position is not here: it is dragged on the picture, which nobody would guess without being told */}
          <p className="px-1 pt-1 text-[10px] leading-snug" style={{ color: 'var(--text-muted)' }}>
            {t('timeline.subtitleDrag')}
            <br />
            {t('timeline.subtitleSaved')}
          </p>
      </div>
    </InspectorPanel>
  );
}

/* ── the panel's parts (only this panel uses them) ───────────────────────── */

/**
 * The subtitle language: one menu, "Original" first (named when the script tells which), then the languages it can
 * be translated into (never the voices' own). Picking one has the voices translated (seconds to a minute or two); until
 * then the original shows. Once picked, "Show: translation / original + translation".
 *
 * One status line: translating (a spinner), or could not (a plain sentence and Retry; details on hover). Done says
 * nothing: the subtitles changing on the picture is the answer.
 */
/** How long after the person scrolls the lines themselves they stop following the playhead. */
const FOLLOW_PAUSE_MS = 2500;

const lineTime = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;

/**
 * The film's lines, each corrected in place (Enter or leaving the field keeps it; emptied, the line goes). The line
 * the playhead is in is lit, and the list keeps it in view as the film plays, except while the person types in it or
 * has just scrolled it themselves; a line's time moves the playhead there.
 *
 * With a translation shown (`language`), each line is that language's, to correct, with the original faint above it
 * for reference; a line not translated yet is empty and can be written.
 */
function SubtitleLines({ lines, onEdit, untranscribed, onMake, making, timeMs, onSeek, language, refer }: {
  lines: readonly SubtitleCue[];
  onEdit?: (cue: SubtitleCue, text: string, language?: string) => void;
  untranscribed: number;
  onMake?: () => void;
  making: boolean;
  timeMs: number;
  onSeek?: (ms: number) => void;
  language: string | null;
  refer?: SubtitleLineRefer;
}) {
  const t = useT();
  const list = React.useRef<HTMLUListElement>(null);
  const touched = React.useRef(0);
  /* the rows are drawn once per change of the lines, not per frame: what changes as the film plays is which is lit */
  const calls = React.useRef({ onEdit, onSeek, refer });
  calls.current = { onEdit, onSeek, refer };
  const edit = React.useCallback((cue: SubtitleCue, text: string, lang: string | null) => calls.current.onEdit?.(cue, text, lang ?? undefined), []);
  const go = React.useCallback((ms: number) => calls.current.onSeek?.(ms), []);
  const lineRefer = React.useMemo<LineRefer | null>(() => (refer ? {
    of: (line) => calls.current.refer!.of(line),
    send: (line) => { const r = calls.current.refer; if (r) r.send(r.of(line)); },
    pick: (line) => calls.current.refer?.pick(line),
  } : null), [!!refer]); // eslint-disable-line react-hooks/exhaustive-deps
  const active = lines.findIndex((cue) => timeMs >= cue.startMs && timeMs < cue.startMs + cue.durMs);
  /* between lines, the list follows to the next one */
  const follow = active >= 0 ? active : lines.findIndex((cue) => cue.startMs > timeMs);

  React.useEffect(() => {
    const ul = list.current;
    const row = follow >= 0 ? ul?.children[follow] as HTMLElement | undefined : undefined;
    if (!ul || !row) return;
    if (ul.contains(document.activeElement) || performance.now() - touched.current < FOLLOW_PAUSE_MS) return;
    /* the list alone scrolls (scrollIntoView would move the whole panel too); it is the rows' offset parent */
    const top = row.offsetTop;
    if (top < ul.scrollTop || top + row.offsetHeight > ul.scrollTop + ul.clientHeight) {
      ul.scrollTo({ top: Math.max(0, top - ul.clientHeight / 3), behavior: 'smooth' });
    }
  }, [follow]);

  const nameOf = (code: string) => FILM_SUBTITLE_LANGUAGES.find((item) => item.code === code)?.native ?? code;
  const ask = {
    go: t('timeline.subtitleLineGo'),
    at: language ? t('timeline.subtitleLineInLanguage').replace('{lang}', nameOf(language)) : t('timeline.subtitleLineAt'),
    untranslated: t('timeline.subtitleLineUntranslated'),
    refer: t('host.refer'),
    shortcut: refer?.shortcut ?? '',
  };
  const mark = () => { touched.current = performance.now(); };
  return (
    <StyleGroup label={t('timeline.subtitleLines')} aside={<SubtitleRowToggle />}>
      {untranscribed > 0 && onMake ? (
        <button type="button" onClick={onMake} disabled={making}
          className="mb-1.5 flex h-7 w-full items-center justify-center gap-1.5 rounded-md border text-[11px] disabled:opacity-60"
          style={{ background: 'var(--fill-tsp)', borderColor: 'var(--border)', color: 'var(--text)' }}>
          {making ? <><Loader2 size={12} className="animate-spin" aria-hidden />{t('timeline.subtitlesMaking')}</>
            : t(untranscribed === 1 ? 'timeline.subtitleLinesMakeOne' : 'timeline.subtitleLinesMake').replace('{n}', String(untranscribed))}
        </button>
      ) : null}
      {lines.length ? (
        <ul ref={list} onWheel={mark} onPointerDown={mark} onTouchMove={mark}
          className="relative flex max-h-[260px] flex-col gap-0.5 overflow-y-auto pb-1">
          {lines.map((cue, i) => (
            <SubtitleLine key={subtitleLineKey(cue)} cue={cue} index={i + 1} lit={i === active}
              language={language} editable={!!onEdit && cue.src !== undefined} seekable={!!onSeek} onEdit={edit} onGo={go} ask={ask}
              refer={lineRefer} />
          ))}
        </ul>
      ) : null}
    </StyleGroup>
  );
}

/** A line's references, made by the panel's owner (SubtitleLineRefer) from what the row knows. */
type LineRefer = { of: (line: SubtitleLineAt) => StudioRef; send: (line: SubtitleLineAt) => void; pick: (line: SubtitleLineAt) => void };

const SubtitleLine = React.memo(function SubtitleLine({ cue, index, lit, language, editable, seekable, onEdit, onGo, ask, refer }: {
  cue: SubtitleCue;
  index: number;
  lit: boolean;
  language: string | null;
  editable: boolean;
  seekable: boolean;
  onEdit: (cue: SubtitleCue, text: string, language: string | null) => void;
  onGo: (ms: number) => void;
  ask: { go: string; at: string; untranslated: string; refer: string; shortcut: string };
  refer: LineRefer | null;
}) {
  const time = lineTime(cue.startMs);
  const text = language ? cue.alt?.[language] ?? '' : cue.text;
  const field = React.useRef<HTMLInputElement>(null);
  /* the line as the field has it now: its words as typed (the reference says what the person sees), and the words
     selected in it while it has the focus (a field keeps its last selection after it loses it, unseen) */
  const lineAt = (withPick = true): SubtitleLineAt => {
    const input = field.current;
    const focused = !!input && input === document.activeElement;
    const from = input?.selectionStart ?? 0;
    const to = input?.selectionEnd ?? 0;
    return { cue, index, language, text: input?.value ?? text, pick: withPick && focused && to > from ? { from, to } : null };
  };
  const drag = (e: React.DragEvent, withPick: boolean) => {
    if (!refer) return;
    const ref = refer.of(lineAt(withPick));
    e.dataTransfer.setData(STUDIO_REF_TYPE, JSON.stringify([ref]));
    if (!withPick) e.dataTransfer.setData('text/plain', ref.kind === 'subtitle' ? ref.text : text);
    e.dataTransfer.effectAllowed = 'copy';
  };
  return (
    <li className="group flex items-start gap-1.5 rounded-md py-0.5 pr-0.5"
      style={lit ? { background: 'var(--bg-active)', boxShadow: 'inset 2px 0 0 var(--accent)' } : undefined}
      aria-current={lit ? 'true' : undefined}>
      <button type="button" disabled={!seekable} onClick={() => onGo(cue.startMs)}
        draggable={!!refer} onDragStart={(e) => drag(e, false)}
        aria-label={ask.go.replace('{time}', time)}
        className="w-9 shrink-0 rounded pt-1.5 text-right text-[10.5px] tabular-nums hover:underline disabled:hover:no-underline"
        style={{ color: lit ? 'var(--accent)' : 'var(--text-faint)', fontWeight: lit ? 600 : undefined }}>
        {time}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {language ? (
          <span className="truncate px-2 pt-1 text-[10.5px]" title={cue.text} style={{ color: 'var(--text-faint)' }}>{cue.text}</span>
        ) : null}
        <input
          ref={field}
          defaultValue={text}
          key={`${language ?? ''}:${text}`}
          placeholder={language ? ask.untranslated : undefined}
          aria-label={ask.at.replace('{time}', time)}
          disabled={!editable}
          onFocus={() => { if (seekable && !lit) onGo(cue.startMs); refer?.pick(lineAt(false)); }}
          /* words selected in the line: they are what ⌘L, a drag and the selection carry (with their own times) */
          onSelect={() => refer?.pick(lineAt())}
          onChange={() => refer?.pick(lineAt())}
          onMouseUp={() => refer?.pick(lineAt())}
          onKeyUp={(e) => { if (e.shiftKey || e.key.startsWith('Arrow')) refer?.pick(lineAt()); }}
          onDragStart={(e) => drag(e, true)}
          onKeyDown={(e) => {
            if (refer && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
              e.preventDefault();
              refer.send(lineAt());
              return;
            }
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { e.currentTarget.value = text; e.currentTarget.blur(); }
          }}
          onBlur={(e) => { const next = e.currentTarget.value; if (next.trim() !== text) onEdit(cue, next, language); }}
          className="h-7 min-w-0 rounded-md border px-2 text-[11.5px]"
          style={{ background: 'var(--fill-tsp)', borderColor: lit ? 'var(--accent)' : 'var(--border)', color: 'var(--text)' }}
        />
      </div>
      {refer ? (
        <Tooltip label={ask.refer} shortcut={ask.shortcut || undefined}>
          <button type="button" aria-label={ask.refer} draggable onDragStart={(e) => drag(e, false)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => refer.send(lineAt())}
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded opacity-0 transition hover:bg-[var(--bg-hover)] focus-visible:opacity-100 group-hover:opacity-100"
            style={{ color: 'var(--text-muted)' }}>
            <MessageSquarePlus size={13} aria-hidden />
          </button>
        </Tooltip>
      ) : null}
    </li>
  );
});

function SubtitleLanguage({ style, set, translate, sourceLanguage }: {
  style: SubtitleStyle;
  set: (next: Partial<SubtitleStyle>) => void;
  translate?: (language: string) => Promise<SubtitleTranslateResult>;
  sourceLanguage?: string | null;
}) {
  const t = useT();
  const [state, setState] = React.useState<{ busy: boolean; error: string | null; needsTranslator: boolean }>({ busy: false, error: null, needsTranslator: false });
  const nameOf = (code: string) => FILM_SUBTITLE_LANGUAGES.find((item) => item.code === code)?.native ?? code;
  const run = async (code: string) => {
    if (!translate) return;
    setState({ busy: true, error: null, needsTranslator: false });
    const result = await translate(code);
    setState({ busy: false, error: result.ok ? null : result.error ?? '', needsTranslator: !!result.needsTranslator });
  };
  const pick = (code: string) => {
    if (!code || sameFilmSubtitleLanguage(code, sourceLanguage ?? null)) {
      set({ language: null });
      setState({ busy: false, error: null, needsTranslator: false });
      return;
    }
    set({ language: code });
    void run(code);
  };
  const targets = FILM_SUBTITLE_LANGUAGES.filter((item) => !sameFilmSubtitleLanguage(item.code, sourceLanguage ?? null));
  /* a saved language that is the voices' own is just the original */
  const chosen = style.language && !sameFilmSubtitleLanguage(style.language, sourceLanguage ?? null) ? style.language : null;
  const network = state.error !== null && /fetch failed|network|socket|TLS|ECONN|timed? ?out|HTTP 5\d\d/i.test(state.error);
  const failure = state.needsTranslator ? 'timeline.subtitleTranslateConnect' : network ? 'timeline.subtitleTranslateNetwork' : 'timeline.subtitleTranslateFailed';
  return (
    <StyleGroup label={t('timeline.subtitleLanguageGroup')}>
      <div className="flex min-h-8 items-center gap-2 py-1">
        <select
          value={chosen ?? ''}
          aria-label={t('timeline.subtitleLanguageGroup')}
          disabled={state.busy}
          onChange={(e) => pick(e.target.value)}
          className="h-7 min-w-0 flex-1 rounded-md border px-2 text-[11px]"
          style={{ background: 'var(--fill-tsp)', borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          <option value="">
            {sourceLanguage ? t('timeline.subtitleLanguageOriginalNamed').replace('{lang}', nameOf(sourceLanguage)) : t('timeline.subtitleLanguageOriginal')}
          </option>
          <optgroup label={t('timeline.subtitleLanguageTranslate')}>
            {targets.map((item) => <option key={item.code} value={item.code}>{item.native}</option>)}
          </optgroup>
        </select>
      </div>
      {state.busy ? (
        <p className="flex items-center gap-1.5 pb-1 text-[11px]" role="status" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={12} className="animate-spin" aria-hidden />
          {t('timeline.subtitleTranslating').replace('{lang}', nameOf(chosen ?? ''))}
        </p>
      ) : state.error !== null && chosen ? (
        <p className="flex items-center gap-2 pb-1 text-[11px]" role="alert" title={state.error || undefined} style={{ color: 'var(--danger, #c2410c)' }}>
          <span className="min-w-0 flex-1">{t(failure)}</span>
          <button type="button" className="shrink-0 underline underline-offset-2" onClick={() => void run(chosen)}>
            {t('timeline.subtitleTranslateRetry')}
          </button>
        </p>
      ) : null}
      {chosen ? (
        <Segmented
          label={t('timeline.subtitleLanguageShow')}
          items={[
            { id: 'translation' as const, label: t('timeline.subtitleShowTranslation') },
            { id: 'both' as const, label: t('timeline.subtitleShowBoth') },
          ]}
          value={style.bilingual ? 'both' : 'translation'}
          onPick={(id) => set({ bilingual: id === 'both' })}
        />
      ) : null}
    </StyleGroup>
  );
}

/** A group: a faint rule and a small heading. A dozen controls in one run would be impossible to find. */
function StyleGroup({ label, aside, children }: { label: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-2 pb-2">
        <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
          {label}
        </p>
        {aside}
      </div>
      {children}
    </div>
  );
}

/** A slider with its name on the left and its value on the right (a number is easier to match in the next film). */
function StyleSlider({
  label, value, min, max, step, format, onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex min-h-8 items-center gap-2 py-1">
      <span className="w-[58px] shrink-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.range}
      />
      <span
        className="w-[40px] shrink-0 rounded bg-[var(--fill-tsp)] py-1 text-center text-[10px] tabular-nums"
        style={{ color: 'var(--text-muted)' }}
      >
        {format(value)}
      </span>
    </div>
  );
}

/**
 * A color swatch and an alpha slider. A checkerboard under the swatch: strokes and shadows are often translucent,
 * which a plain background would hide.
 */
function StyleColor({
  label, value, onChange, withAlpha = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** The box has its own opacity slider (box.opacity): no second one here. */
  withAlpha?: boolean;
}) {
  const { hex, alpha } = splitColor(value);
  return (
    <div className="flex min-h-8 items-center gap-2 py-1">
      <span className="w-[58px] shrink-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <label
        className={`relative h-6 overflow-hidden rounded border ${
          withAlpha ? 'w-6 shrink-0' : 'w-10 shrink-0'
        }`}
        style={{
          borderColor: 'var(--border)',
          backgroundImage:
            'linear-gradient(45deg,#888 25%,transparent 25%,transparent 75%,#888 75%),'
            + 'linear-gradient(45deg,#888 25%,transparent 25%,transparent 75%,#888 75%)',
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0, 4px 4px',
        }}
      >
        <span className="absolute inset-0" style={{ background: value }} />
        <input
          type="color"
          value={hex}
          aria-label={label}
          onChange={(e) => onChange(joinColor(e.target.value, alpha))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      {withAlpha ? (
        <>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={alpha}
          aria-label={`${label} alpha`}
          onChange={(e) => onChange(joinColor(hex, Number(e.target.value)))}
          className={styles.range}
        />
        <span className="w-[40px] shrink-0 rounded bg-[var(--fill-tsp)] py-1 text-center text-[10px] tabular-nums text-[var(--text-muted)]">{Math.round(alpha * 100)}%</span>
        </>
      ) : <span className="text-[10px] uppercase tabular-nums text-[var(--text-muted)]">{hex}</span>}
    </div>
  );
}

/** A switch, and what shows only while it is on. Off clears the whole layer. */
function StyleLayer({
  label, on, onToggle, children,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-0.5">
      <button
        type="button"
        onClick={onToggle}
        onMouseDown={(e) => e.preventDefault()}
        aria-pressed={on}
        className="flex min-h-8 w-full flex-row-reverse items-center justify-between gap-2 rounded py-1.5 text-left transition hover:bg-[var(--bg-hover)]"
      >
        <span
          className="flex h-[14px] w-[24px] shrink-0 items-center rounded-full px-[2px] transition"
          style={{ background: on ? 'var(--text-dim)' : 'var(--border)' }}
        >
          <span
            className="h-[10px] w-[10px] rounded-full transition-transform"
            style={{ transform: on ? 'translateX(10px)' : 'none', background: on ? 'var(--panel)' : 'var(--text-muted)' }}
          />
        </span>
        <span className="text-[11px]" style={{ color: on ? 'var(--text)' : 'var(--text-muted)' }}>
          {label}
        </span>
      </button>
      {on ? children : null}
    </div>
  );
}

/**
 * The typeface, grouped by script (someone subtitling in Chinese need not search eighty families for the seven
 * Chinese ones). First, "Default" (the system stack): not a font but "follow the system", so not in the alphabet.
 */
function StyleFamily({
  label, value, fonts, onPick,
}: {
  label: string;
  value: string;
  fonts: SubtitleFontOption[];
  onPick: (family: string) => void;
}) {
  const t = useT();
  const groups = React.useMemo(() => {
    const by = new Map<string, SubtitleFontOption[]>();
    for (const f of fonts) {
      const list = by.get(f.locale) ?? [];
      list.push(f);
      by.set(f.locale, list);
    }
    return [...by.entries()];
  }, [fonts]);

  return (
    <div className="flex min-h-8 items-center gap-2 py-1">
      <span className="w-[58px] shrink-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onPick(e.target.value)}
        className="h-7 min-w-0 flex-1 rounded-md border px-2 text-[11px]"
        style={{
          background: 'var(--fill-tsp)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      >
        <option value={SUBTITLE_FONT_SYSTEM}>{t('timeline.subtitleFamilyDefault')}</option>
        {groups.map(([locale, list]) => (
          <optgroup key={locale} label={locale}>
            {list.map((f) => <option key={f.family} value={f.family}>{f.family}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

/** A small button that stays lit while on (italic, uppercase). */
function StyleToggle({ label, on, onPick }: { label: string; on: boolean; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      onMouseDown={(e) => e.preventDefault()}
      aria-pressed={on}
      className="flex-1 rounded-[6px] px-1 py-1 text-[11px] transition"
      style={{
        background: on ? 'var(--surface-3)' : 'var(--fill-tsp)',
        color: on ? 'var(--text)' : 'var(--text-muted)',
        outline: on ? '1px solid var(--text-muted)' : 'none',
        outlineOffset: -1,
      }}
    >
      {label}
    </button>
  );
}

/**
 * A look's sample: "Aa" drawn in that look, through the same function as the subtitles on the picture, so a sample
 * and the real thing never part. Fixed at 16px here (a frame-relative size would overflow the tile), on near black:
 * these looks are made to sit on pictures.
 */
function LookSwatch({
  look, active, label, onPick,
}: {
  look: SubtitleLookId;
  active: boolean;
  label: string;
  onPick: () => void;
}) {
  const s = subtitleCss({ ...SUBTITLE_DEFAULT, ...SUBTITLE_LOOKS[look] }).text;
  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onPick}
        onMouseDown={(e) => e.preventDefault()}
        aria-label={label}
        aria-pressed={active}
        className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-md transition hover:brightness-125"
        style={{
          background: '#2a2a2a',
          outline: active ? '1px solid var(--text)' : '1px solid var(--border)',
          outlineOffset: -1,
        }}
      >
        <span
          style={{
            ...(s as React.CSSProperties),
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          Aa
        </span>
      </button>
    </Tooltip>
  );
}

/** A row: a name on the left, two or three small buttons on the right. */
function Segmented<T extends string>({
  label, items, value, onPick,
}: {
  label: string;
  items: readonly { id: T; label: string }[];
  value: T;
  onPick: (id: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
      <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>{label}</span>
      <div className="ml-auto flex min-w-0 gap-0.5 rounded-md bg-[var(--fill-tsp)] p-0.5">
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item.id)}
            onMouseDown={(e) => e.preventDefault()}
            className="rounded-[6px] px-1.5 py-0.5 text-[11px] transition"
            style={item.id === value
              ? { color: 'var(--text)', background: 'var(--surface-3)', boxShadow: '0 1px 3px #0002' }
              : { color: 'var(--text-muted)', background: 'transparent' }}
            aria-pressed={item.id === value}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
