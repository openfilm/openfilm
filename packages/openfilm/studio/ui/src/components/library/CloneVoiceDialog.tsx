import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Mic, Square, Upload } from 'lucide-react';
import { useLanguage, useT } from '@/i18n';
import { startRecording, type Recording } from '@/lib/recorder';
import {
  createPrivateVoice, previewPrivateVoice, recordingBase64, refreshPrivateVoice, renamePrivateVoice,
  type PrivateVoice, type VoiceConnection,
} from '@/lib/private-voices';
import { Card, CardActions, CardButton } from '../Card';
import { MenuSelect } from '../MenuSelect';

type Source = 'upload' | 'record' | 'project';
const PREVIEW_TEXT: Record<string, string> = {
  zh: '你好，这是我的声音。希望接下来的故事，也能用它讲给你听。',
  en: 'Hello, this is my voice. I look forward to sharing our next story with you.',
  ja: 'こんにちは、私の声です。次の物語を一緒に届けましょう。',
  ko: '안녕하세요, 제 목소리입니다. 다음 이야기도 함께 나누고 싶습니다.',
  es: 'Hola, esta es mi voz. Espero compartir nuestra próxima historia contigo.',
  fr: 'Bonjour, voici ma voix. Je suis ravi de partager notre prochaine histoire avec vous.',
  de: 'Hallo, das ist meine Stimme. Ich freue mich auf unsere nächste gemeinsame Geschichte.',
};
/** A voice from a recording, made with OpenFilm's service: its engine (Inworld, recommended, or ElevenLabs) chosen here. */
export function CloneVoiceDialog({ services, projectId, onClose, onSaved }: {
  services: VoiceConnection[]; projectId?: string | null;
  onClose: () => void; onSaved: (voice: PrivateVoice, speak: boolean) => void;
}) {
  const t = useT();
  const language = useLanguage();
  const service = services.find((s) => s.id === 'openfilm');
  const [engine, setEngine] = React.useState(() => service?.engines?.[0]?.id ?? 'inworld');
  const [source, setSource] = React.useState<Source>('upload');
  const [name, setName] = React.useState(t('myVoices.defaultName'));
  const [spokenLanguage, setSpokenLanguage] = React.useState(language.startsWith('zh') ? 'zh' : 'en');
  const [file, setFile] = React.useState<File | null>(null);
  const [projectFiles, setProjectFiles] = React.useState<string[]>([]);
  const [path, setPath] = React.useState('');
  const [start, setStart] = React.useState('0');
  const [end, setEnd] = React.useState('30');
  const [consent, setConsent] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [voice, setVoice] = React.useState<PrivateVoice | null>(null);
  const [previewText, setPreviewText] = React.useState(PREVIEW_TEXT[spokenLanguage] ?? PREVIEW_TEXT.en!);
  const [recording, setRecording] = React.useState(false);
  const recorder = React.useRef<Recording | null>(null);
  const recordingAttempt = React.useRef(0);
  const fileInput = React.useRef<HTMLInputElement>(null);
  const dialog = React.useRef<HTMLDivElement>(null);
  const preview = React.useRef<HTMLAudioElement>(null);
  const autoStop = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousFocus = React.useRef<HTMLElement | null>(null);
  const [localUrl, setLocalUrl] = React.useState('');
  React.useEffect(() => {
    if (!file) { setLocalUrl(''); return; }
    const url = URL.createObjectURL(file); setLocalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  React.useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { recordingAttempt.current++; recorder.current?.cancel(); if (autoStop.current) clearTimeout(autoStop.current); previousFocus.current?.focus?.(); };
  }, []);
  React.useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !document.querySelector('[data-popover-panel]')) { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === 'Tab') {
        const fields = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], audio[controls]') ?? [])].filter((el) => el.getClientRects().length);
        const first = fields[0], last = fields.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [onClose]);
  React.useEffect(() => {
    if (source !== 'project' || !projectId) return;
    let live = true;
    void fetch(`/api/projects/${encodeURIComponent(projectId)}/files`).then((res) => res.ok ? res.json() : null).then((body) => {
      if (live) setProjectFiles((body?.files ?? []).filter((item: { kind: string }) => item.kind === 'audio' || item.kind === 'video').map((item: { path: string }) => item.path));
    }).catch(() => { if (live) setProblem(t('myVoices.projectLoadFailed')); });
    return () => { live = false; };
  }, [source, projectId, t]);
  const stop = async () => {
    recordingAttempt.current++;
    const current = recorder.current;
    if (!current) { setRecording(false); return; }
    recorder.current = null; setRecording(false);
    if (autoStop.current) clearTimeout(autoStop.current);
    try { setFile(await current.stop('voice-reference')); } catch { setProblem(t('myVoices.recordFailed')); }
  };
  const record = async () => {
    const attempt = ++recordingAttempt.current;
    setProblem(null);
    setRecording(true);
    try {
      const current = await startRecording();
      if (attempt !== recordingAttempt.current) { current.cancel(); return; }
      recorder.current = current;
      autoStop.current = setTimeout(() => { void stop(); }, 179_000);
    } catch { if (attempt === recordingAttempt.current) { setRecording(false); setProblem(t('myVoices.recordFailed')); } }
  };
  const takeFile = (next: File | null) => {
    if (next && next.size > 20 * 1024 * 1024) { setProblem(t('myVoices.tooLarge')); return; }
    setFile(next); setProblem(null);
  };
  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setProblem(null);
    try { await operation(); } catch (error) { setProblem(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const create = () => run(async () => {
    if (!name.trim() || !service?.connected) return;
    const result = await createPrivateVoice({ provider: 'openfilm', name: name.trim(), language: spokenLanguage, consent, engine,
        ...(source === 'project' ? { project: { id: projectId!, path }, start: Number(start), end: Number(end) }
          : { audio: { data: await recordingBase64(file!) }, ...(start !== '0' || end !== '30' ? { start: Number(start), end: Number(end) } : {}) }) });
    setVoice(result.voice);
  });
  const save = (speak: boolean) => run(async () => {
    if (!voice) return;
    const saved = name.trim() !== voice.name ? (await renamePrivateVoice(voice.uid, name.trim())).voice : voice;
    onSaved(saved, speak);
  });
  const changeSource = (next: Source) => {
    recordingAttempt.current++;
    if (recorder.current) { recorder.current.cancel(); recorder.current = null; }
    setRecording(false);
    if (autoStop.current) clearTimeout(autoStop.current);
    setSource(next); setProblem(null);
  };
  const field = 'w-full rounded-md border border-[var(--border)] bg-[var(--bg-field)] px-2.5 py-2 text-[12.5px] text-[var(--text)] outline-none focus:ring-1 focus:ring-[var(--accent)]';
  const canCreate = name.trim() && service?.connected && consent && !recording && (source === 'project' ? path && Number(end) > Number(start) : file);
  return createPortal(
    <div className="fixed inset-0 z-[10100] flex items-center justify-center overflow-y-auto bg-black/45 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-label={t('myVoices.clone')} data-clone-voice-dialog="" className="my-auto w-full max-w-[460px]" onClick={(event) => event.stopPropagation()}>
        <Card title={t(voice ? 'myVoices.review' : 'myVoices.clone')} body={t(voice ? `myVoices.status.${voice.status}` : 'myVoices.createNote')} onClose={onClose}>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">{t('myVoices.name')}<input className={field} value={name} maxLength={80} disabled={busy} onChange={(event) => setName(event.target.value)} /></label>
            {!voice ? <>
              {service?.engines?.length ? <label className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">{t('myVoices.engine')}<MenuSelect label={t('myVoices.engine')} value={engine} disabled={busy} onPick={setEngine} size="md" layer={10120}
                groups={[{ choices: service.engines.map((e, i) => ({ value: e.id, label: i === 0 ? `${e.name} · ${t('myVoices.recommended')}` : e.name })) }]} /></label> : null}
              {<>
                <div className="flex gap-1 rounded-lg bg-[var(--bg-field)] p-1" aria-label={t('myVoices.source')}>
                  {(['upload', 'record', ...(projectId ? ['project'] : [])] as Source[]).map((s) => <button key={s} type="button" aria-pressed={source === s} disabled={busy} onClick={() => changeSource(s)} className={`min-w-0 flex-1 rounded-md px-2 py-1.5 text-[12px] ${source === s ? 'bg-[var(--bg-raised)] text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>{t(`myVoices.source_${s}`)}</button>)}
                </div>
                {source === 'project' ? <>
                  <MenuSelect label={t('myVoices.projectAudio')} value={path} disabled={busy} onPick={setPath} size="md" layer={10120}
                    groups={[{ choices: [{ value: '', label: t('myVoices.selectProjectAudio') }, ...projectFiles.map((src) => ({ value: src, label: src }))] }]} />
                  <div className="flex gap-2">{[['start', start, setStart], ['end', end, setEnd]].map(([key, value, change]) => <label key={String(key)} className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] text-[var(--text-muted)]">{t(`myVoices.${key}`)}<input type="number" min="0" step="0.1" className={field} value={String(value)} disabled={busy} onChange={(event) => (change as (v: string) => void)(event.target.value)} /></label>)}</div>
                </> : <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-[var(--border-strong)] px-3 py-4" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!busy) takeFile(event.dataTransfer.files[0] ?? null); }}>
                  {source === 'record' ? <CardButton disabled={busy} onClick={() => { void (recording ? stop() : record()); }}>{recording ? <Square size={14} /> : <Mic size={14} />}{t(recording ? 'myVoices.stopRecording' : 'myVoices.startRecording')}</CardButton>
                    : <><Upload size={20} className="text-[var(--text-muted)]" /><CardButton disabled={busy} onClick={() => fileInput.current?.click()}>{t('myVoices.chooseFile')}</CardButton><input ref={fileInput} hidden type="file" accept="audio/*" onChange={(event) => takeFile(event.target.files?.[0] ?? null)} /></>}
                  {file ? <><span className="max-w-full truncate text-[12px] text-[var(--text)]">{file.name}</span>{localUrl ? <audio controls src={localUrl} className="h-8 w-full" /> : null}</> : <p className="text-center text-[11px] text-[var(--text-faint)]">{t('myVoices.audioHint')}</p>}
                </div>}
                <label className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">{t('myVoices.language')}<MenuSelect label={t('myVoices.language')} value={spokenLanguage} disabled={busy} size="md" layer={10120}
                  onPick={(value) => { setSpokenLanguage(value); setPreviewText(PREVIEW_TEXT[value] ?? PREVIEW_TEXT.en!); }}
                  groups={[{ choices: [['zh', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch']].map(([value, label]) => ({ value: value!, label: label! })) }]} /></label>
                <label className="flex items-start gap-2 text-[11.5px] text-[var(--text-muted)]"><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 accent-[var(--accent)]" /><span>{t('myVoices.consent')}</span></label>
              </>}
              <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">{t(engine === 'elevenlabs' ? 'myVoices.engineNote_elevenlabs' : 'myVoices.engineNote')} {service?.pricingUrl ? <a className="text-[var(--accent)] underline" target="_blank" rel="noreferrer" href={service.pricingUrl}>{t('myVoices.pricing')}</a> : null}</p>
            </> : <>
              {voice.status === 'ready' ? <>
                {voice.previewUrl ? <audio key={`${voice.previewUrl}:${voice.updated}`} ref={preview} controls src={`${voice.previewUrl}?v=${voice.updated}`} className="h-10 w-full" /> : null}
                <label className="flex flex-col gap-1 text-[12px] text-[var(--text-muted)]">{t('myVoices.previewPassage')}<textarea className={field} rows={3} maxLength={300} value={previewText} onChange={(event) => setPreviewText(event.target.value)} disabled={busy} /></label>
                <CardButton disabled={busy || !previewText.trim()} onClick={() => { void run(async () => setVoice((await previewPrivateVoice(voice.uid, previewText)).voice)); }}>{t('myVoices.generatePreview')}</CardButton>
              </> : <><p className="text-[12px] leading-relaxed text-[var(--text-muted)]">{t(voice.status === 'verification' ? 'myVoices.verifyNote' : 'myVoices.pendingNote')}</p><CardButton disabled={busy} onClick={() => { void run(async () => setVoice((await refreshPrivateVoice(voice.uid)).voice)); }}>{t('myVoices.refresh')}</CardButton></>}
            </>}
            {busy ? <p role="status" className="flex items-center gap-2 text-[11.5px] text-[var(--text-muted)]"><Loader2 size={13} className="animate-spin" />{t('myVoices.working')}</p> : null}
            {problem ? <p role="alert" className="break-words text-[11.5px] text-[var(--err)]">{problem}</p> : null}
          </div>
          <CardActions>{voice ? <><CardButton disabled={busy || !name.trim()} onClick={() => { void save(false); }}>{t('myVoices.save')}</CardButton><CardButton weight="primary" disabled={busy || !name.trim() || voice.status !== 'ready'} onClick={() => { void save(true); }}>{t('myVoices.saveSpeak')}</CardButton></>
            : <><CardButton weight="quiet" onClick={onClose}>{t('confirm.cancel')}</CardButton><CardButton weight="primary" disabled={busy || !canCreate} onClick={() => { void create(); }}>{t('myVoices.create')}</CardButton></>}</CardActions>
        </Card>
      </div>
    </div>, document.body,
  );
}
