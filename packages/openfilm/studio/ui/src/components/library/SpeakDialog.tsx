/**
 * Words spoken in a voice of the library (VoicesPane's "Generate"): typed here, made by the voice's service and put on
 * the film at the playhead (ProjectView, as `openfilm get tts` makes an agent's: its words timed beside it, so its
 * captions come by themselves). The "?" shows how that service reads marks in the words (a pause, a tone, a laugh), as
 * its own documentation says; a mark clicked goes in where the cursor is.
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp, Loader2 } from 'lucide-react';
import { useT } from '@/i18n';
import type { LibraryVoice } from '@/lib/library-voices';
import { Card, CardActions, CardButton } from '../Card';

/** Each service's marks: what a kind of mark does (its words in the app's language) and a few to put in. */
const MARKS: Record<string, { rule: string; marks: string[] }[]> = {
  elevenlabs: [
    { rule: 'elevenlabsTone', marks: ['[whispers]', '[laughs]', '[sighs]', '[excited]', '[sarcastic]'] },
    { rule: 'elevenlabsPause', marks: ['…', ' — '] },
    { rule: 'elevenlabsStress', marks: [] },
  ],
  inworld: [
    { rule: 'inworldTone', marks: ['[happy]', '[whispering]', '[shouting]', '[reset]'] },
    { rule: 'inworldSound', marks: ['[laugh]', '[sigh]', '[breathe]', '[clear throat]'] },
    { rule: 'inworldPause', marks: ['<break time="1s" />', '<break time="500ms" />'] },
  ],
  cartesia: [
    { rule: 'cartesiaPause', marks: ['<break time="1s"/>', '<break time="500ms"/>'] },
    { rule: 'cartesiaSpeed', marks: ['<speed ratio="1.2"/>', '<volume ratio="1.5"/>'] },
    { rule: 'cartesiaEmotion', marks: ['<emotion value="excited"/>', '<emotion value="calm"/>', '<emotion value="sad"/>'] },
    { rule: 'cartesiaLaugh', marks: ['[laughter]'] },
  ],
};

export function SpeakDialog({ voice, service, onSpeak, onClose }: {
  voice: LibraryVoice;
  service: string;
  /** The words made into sound and put at the playhead: null, or why not. */
  onSpeak: (text: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const t = useT();
  const [text, setText] = React.useState('');
  const [help, setHelp] = React.useState(false);
  const [making, setMaking] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const field = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => { field.current?.focus(); }, []);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !making) { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [making, onClose]);
  const marks = MARKS[voice.provider] ?? [];
  /* a mark in where the cursor is (or over what is selected) */
  const put = (mark: string) => {
    const el = field.current;
    const at = el?.selectionStart ?? text.length;
    const to = el?.selectionEnd ?? at;
    const before = text.slice(0, at);
    const gap = before && !/\s$/.test(before) && mark.startsWith('[') ? ' ' : '';
    setText(`${before}${gap}${mark}${text.slice(to)}`);
    requestAnimationFrame(() => { el?.focus(); const end = at + gap.length + mark.length; el?.setSelectionRange(end, end); });
  };
  const go = async () => {
    if (!text.trim() || making) return;
    setMaking(true);
    setProblem(null);
    const why = await onSpeak(text.trim());
    setMaking(false);
    if (why) setProblem(why); else onClose();
  };
  return createPortal(
    <div className="fixed inset-0 z-[10100] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]" onClick={() => { if (!making) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={t('voiceSpeak.title')} data-speak-dialog="" className="w-full max-w-[460px]" onClick={(e) => e.stopPropagation()}>
        <Card title={t('voiceSpeak.title').replace('{voice}', voice.name)} body={`${service}${voice.language ? ` · ${voice.language}` : ''}`} onClose={making ? undefined : onClose}>
          <div className="relative mt-3">
            <textarea ref={field} value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={5000}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void go(); } }}
              placeholder={t('voiceSpeak.text')}
              className="block w-full resize-y rounded-md bg-[var(--bg-field)] px-2.5 py-2 pr-8 text-[12.5px] leading-relaxed text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:ring-1 focus:ring-[var(--accent)]" />
            <button type="button" data-speak-help="" aria-label={t('voiceSpeak.help')} title={t('voiceSpeak.help')} aria-expanded={help} onClick={() => setHelp(!help)}
              className={`absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-md ${help ? 'text-[var(--accent)]' : 'text-[var(--text-faint)] hover:text-[var(--text)]'}`}>
              <CircleHelp size={15} />
            </button>
          </div>
          {help ? (
            <div data-speak-marks="" className="mt-2 flex flex-col gap-2 rounded-md bg-[var(--bg-field)] px-2.5 py-2">
              <p className="text-[11.5px] font-medium text-[var(--text)]">{t('voiceSpeak.helpTitle').replace('{service}', service)}</p>
              {marks.length ? marks.map((m) => (
                <div key={m.rule} className="flex flex-col gap-1">
                  <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">{t(`voiceSpeak.${m.rule}`)}</p>
                  {m.marks.length ? (
                    <div className="flex flex-wrap gap-1">
                      {m.marks.map((mark) => (
                        <button key={mark} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => put(mark)}
                          className="rounded bg-[var(--bg-raised)] px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--text)] shadow-[inset_0_0_0_1px_var(--border)] hover:text-[var(--accent)]">
                          {mark.trim()}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              )) : <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">{t('voiceSpeak.otherService')}</p>}
              {marks.length ? <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">{t('voiceSpeak.helpNote')}</p> : null}
            </div>
          ) : null}
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-faint)]">{t('voiceSpeak.note')}</p>
          {problem ? <p role="alert" className="mt-1.5 break-words text-[11.5px] text-[var(--err)]">{problem}</p> : null}
          <CardActions>
            <span className="mr-auto text-[10.5px] tabular-nums text-[var(--text-faint)]">{t('voiceSpeak.count').replace('{n}', String(text.length))}</span>
            <CardButton weight="quiet" disabled={making} onClick={onClose}>{t('confirm.cancel')}</CardButton>
            <CardButton weight="primary" data-speak-go="" disabled={!text.trim() || making} onClick={() => void go()}>
              {making ? <Loader2 size={13} className="animate-spin" /> : null}{t(making ? 'voiceSpeak.making' : 'voiceSpeak.go')}
            </CardButton>
          </CardActions>
        </Card>
      </div>
    </div>,
    document.body,
  );
}
