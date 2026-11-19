import React from 'react';
import { ArrowRight, ArrowUp, ChevronDown, Clapperboard, ImageIcon, LoaderCircle, X } from 'lucide-react';
import { GENERATION_PANEL, GENERATION_PROMPT, GENERATION_SEND } from '../canvas/composer-style';
import { ProviderMark } from '../settings/ProviderMark';
import { useT } from '@/i18n';
import { openSettings } from '@/studio';
import { IMAGE_RATIOS, MAKE_SECONDS, VIDEO_RATIOS } from '@/lib/canvas';
import { studioHost, type HostWritingModel } from '@/lib/host';
import { useLibraryVoices } from '@/lib/library-voices';
import { useProviders } from '@/lib/providers';
import { GENERATION_VERBS, generationModels, type GenerationActions, type GenerationCategory, type GenerationKind } from '@/lib/asset-generation';

const field = 'relative flex min-w-0 max-w-full items-center gap-1.5 rounded-[9px] px-2 text-[12px] text-[var(--cv-ink-2)] hover:bg-[var(--cv-float-hover)]';
const selectClass = 'h-8 min-w-0 flex-1 appearance-none truncate rounded-md bg-transparent pr-4 text-[var(--cv-ink)] outline-none focus-visible:ring-1 focus-visible:ring-[var(--cv-ring)]';

function Select({ label, icon, value, children, onChange }: { label: string; icon?: React.ReactNode; value: string; children: React.ReactNode; onChange: (value: string) => void }) {
  return (
    <label className={field}>
      {icon ?? <span className="shrink-0">{label}</span>}
      <select className={selectClass} aria-label={label} title={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2 text-[var(--text-faint)]" aria-hidden />
    </label>
  );
}

const keyOf = (model: { via: string; model?: string }) => `${model.via}/${model.model ?? ''}`;

export function GenerationPane({ category, actions }: { category: GenerationCategory; actions: GenerationActions }) {
  const t = useT();
  const [type, setType] = React.useState<'image' | 'video'>('video');
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-[var(--drawer-foot)] pt-4 sm:px-4">
      {category === 'media' ? (
        <div className="mb-3 inline-flex gap-0.5 rounded-[10px] bg-[var(--cv-chip)] p-0.5" aria-label={t('assetGeneration.type')} role="group">
          {(['video', 'image'] as const).map((value) => {
            const Icon = value === 'video' ? Clapperboard : ImageIcon;
            return (
              <button key={value} type="button" aria-pressed={value === type} onClick={() => setType(value)}
                className={`flex h-6 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] ${value === type ? 'bg-[var(--cv-on)] text-[var(--cv-ink)]' : 'text-[var(--cv-ink-2)] hover:text-[var(--cv-ink)]'}`}>
                <Icon size={13} aria-hidden />{t(`assetGeneration.${value}`)}
              </button>
            );
          })}
        </div>
      ) : null}
      <GenerationForm kind={category === 'media' ? type : category} actions={actions} />
    </div>
  );
}

function GenerationForm({ kind, actions }: { kind: GenerationKind; actions: GenerationActions }) {
  const t = useT();
  const { state } = useProviders();
  const voices = useLibraryVoices();
  const [prompt, setPrompt] = React.useState<Partial<Record<GenerationKind, string>>>({});
  const [chosen, setChosen] = React.useState<Partial<Record<GenerationKind, string>>>({});
  const [ratio, setRatio] = React.useState('');
  const [duration, setDuration] = React.useState('');
  const [voice, setVoice] = React.useState('');
  const [writing, setWriting] = React.useState<HostWritingModel | null>(null);
  const verb = GENERATION_VERBS[kind];
  const models = generationModels(state, kind);
  const selected = models.find((model) => keyOf(model) === chosen[kind])
    ?? models.find((model) => verb && model.via === state?.use[verb] && model.model === state?.model[verb])
    ?? models[0];
  const provider = selected?.via === 'openfilm' ? selected.model?.split('/')[0] : selected?.via;
  const voiceOptions = kind === 'voice' ? (voices?.voices ?? []).filter((v) => v.provider === provider && !v.pair) : [];
  const voiceId = voiceOptions.find((v) => v.id === voice)?.id ?? voiceOptions[0]?.id ?? (voice.trim() || undefined);
  const ratios: readonly string[] = selected?.spec?.ratios?.filter((r) => /^\d+:\d+$/.test(r)) ?? (kind === 'video' ? VIDEO_RATIOS : IMAGE_RATIOS);
  const shape = ratios.includes(ratio) ? ratio : ratios[0];
  const limits = kind === 'video' || kind === 'music' || kind === 'sound' ? MAKE_SECONDS[kind === 'sound' ? 'sfx' : kind] : undefined;
  const lengths = limits ? selected?.spec?.only?.length ? selected.spec.only
    : [...new Set([selected?.spec?.seconds?.[0] ?? limits.min, limits.default, 5, 10, 15, 30, 60, selected?.spec?.seconds?.[1] ?? limits.max])]
      .filter((n) => n >= (selected?.spec?.seconds?.[0] ?? limits.min) && n <= (selected?.spec?.seconds?.[1] ?? limits.max)).sort((a, b) => a - b)
    : [];
  const seconds = lengths.includes(Number(duration)) ? Number(duration)
    : lengths.includes(limits?.default ?? 0) ? limits!.default : lengths[0] ?? 4;
  const text = prompt[kind] ?? '';
  const ready = verb ? Boolean(selected) : Boolean(writing);
  const targetNeeded = kind === 'transition' ? !actions.cut : kind === 'captions' ? !actions.speech : false;
  const busy = Boolean(actions.status && !actions.status.error);
  const Picker = studioHost?.canvasWriting?.Picker;
  const wantsRatio = kind === 'image' || kind === 'video' || kind === 'sticker';
  const target = kind === 'transition' ? t('assetGeneration.cut') : kind === 'captions' ? t('assetGeneration.captionTrack')
    : actions.target ?? t('assetGeneration.timeline');
  const label = kind === 'voice' ? t('assetGeneration.script') : t('assetGeneration.description');

  return (
    <div className="flex flex-col gap-2.5" data-asset-generation={kind}>
      <form className={`flex flex-col px-3 pb-2.5 pt-3 ${GENERATION_PANEL}`}
        onSubmit={(event) => {
          event.preventDefault();
          if (!ready || busy || targetNeeded || (kind !== 'captions' && !text.trim()) || (kind === 'voice' && !voiceId)) return;
          actions.start({ kind, prompt: text.trim(), seconds,
            ...(wantsRatio && shape ? { ratio: shape } : {}),
            ...(selected ? { model: selected } : {}),
            ...(!verb && writing ? { writing } : {}),
            ...(kind === 'voice' && voiceId ? { voice: voiceId } : {}) });
        }}>
        {kind === 'captions' ? (
          <p className="px-1 py-2 text-[12px] text-[var(--text-muted)]">{t('assetGeneration.speechHint')}</p>
        ) : (
          <textarea rows={3} maxLength={3000} value={text} onChange={(event) => setPrompt((was) => ({ ...was, [kind]: event.target.value }))}
            aria-label={label} placeholder={t(`assetGeneration.example.${kind}`)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            className={GENERATION_PROMPT} />
        )}
        <div className="mt-2 flex min-w-0 items-end gap-1">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
            {verb ? (
              models.length ? (
                <Select label={t('assetGeneration.model')} icon={selected ? <ProviderMark id={selected.via} size={15} /> : undefined} value={selected ? keyOf(selected) : ''} onChange={(key) => setChosen((was) => ({ ...was, [kind]: key }))}>
                  {models.map((model) => <option key={keyOf(model)} value={keyOf(model)}>{model.name}</option>)}
                </Select>
              ) : (
                <button type="button" onClick={() => openSettings('models')}
                  className={`${field} min-h-8 justify-between text-left hover:bg-[var(--bg-hover)] hover:text-[var(--text)]`}>
                  {t('assetGeneration.connectModel')}<ArrowRight size={13} aria-hidden />
                </button>
              )
            ) : Picker ? (
              <Picker isolated onSelection={setWriting} triggerClassName="!h-8 !max-w-full !justify-start !rounded-[9px] !bg-transparent !px-2 hover:!bg-[var(--cv-float-hover)]" />
            ) : (
              <span className="px-1 py-1 text-[12px] text-[var(--text-muted)]">{t('assetGeneration.desktopModel')}</span>
            )}
            {kind === 'voice' && selected ? (
              voiceOptions.length ? (
                <Select label={t('assetGeneration.voice')} value={voiceId ?? ''} onChange={setVoice}>
                  {voiceOptions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </Select>
              ) : (
                <label className={field}>
                  <span>{t('assetGeneration.voice')}</span>
                  <input className="h-8 min-w-0 flex-1 bg-transparent text-[var(--text)] outline-none" aria-label={t('assetGeneration.voice')}
                    value={voice} onChange={(event) => setVoice(event.target.value)} placeholder={t('assetGeneration.voiceId')} />
                </label>
              )
            ) : null}
            {((wantsRatio && ratios.length > 0) || lengths.length > 0) ? (
              <>
                {wantsRatio && ratios.length ? (
                  <Select label={t('assetGeneration.ratio')} value={shape ?? ''} onChange={setRatio}>
                    {ratios.map((r) => <option key={r} value={r}>{r}</option>)}
                  </Select>
                ) : null}
                {lengths.length ? (
                  <Select label={t('assetGeneration.duration')} value={String(seconds)} onChange={setDuration}>
                    {lengths.map((n) => <option key={n} value={n}>{n}{t('assetGeneration.seconds')}</option>)}
                  </Select>
                ) : null}
              </>
            ) : null}
          </div>
          <button type="submit" aria-label={t('assetGeneration.generate')} title={verb ? t('assetGeneration.credits') : undefined}
            disabled={!ready || busy || targetNeeded || (kind !== 'captions' && !text.trim()) || (kind === 'voice' && !voiceId)}
            className={GENERATION_SEND}>
            <ArrowUp size={17} aria-hidden />
          </button>
        </div>
      </form>
      {kind !== 'captions' || !targetNeeded ? (
        <span className="min-w-0 truncate px-1 text-[11px] text-[var(--cv-ink-2)]" title={target}>
          {targetNeeded ? t('assetDrawer.noCut') : target}
        </span>
      ) : null}
      {actions.status ? (
        <div role="status" className="flex min-w-0 flex-col gap-1 rounded-[12px] bg-[var(--cv-chip)] px-2.5 py-2 text-[12px]">
          <div className="flex min-w-0 items-center gap-2">
            {!actions.status.error ? <LoaderCircle size={14} className="shrink-0 animate-spin text-[var(--accent)]" aria-hidden /> : null}
            <span className="min-w-0 flex-1 truncate text-[var(--text)]" title={actions.status.label}>{actions.status.label}</span>
            {actions.status.error ? (
              <>
                <button type="button" onClick={actions.retry} className="shrink-0 text-[var(--accent)] hover:underline">
                  {t(actions.status.canRetryPlacement ? 'assetGeneration.retryPlacement' : 'assetGeneration.retry')}
                </button>
                <button type="button" onClick={actions.dismiss} className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text)]" aria-label={t('assetGeneration.dismiss')}><X size={14} /></button>
              </>
            ) : <span className="shrink-0 text-[var(--text-muted)]">{t('assetGeneration.running')}</span>}
          </div>
          {actions.status.error ? <p className="break-words text-[var(--text-muted)]">{actions.status.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
