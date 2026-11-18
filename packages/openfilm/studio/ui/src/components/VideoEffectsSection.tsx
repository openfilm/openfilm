import * as React from 'react';
import { Eye, RotateCcw } from 'lucide-react';
import {
  BEAUTY_KEYS,
  VISION_PROPERTIES,
  hasBeauty,
  hasVideoEffects,
  videoEffects,
  type BeautyKey,
  type VideoEffects,
} from '../../../../src/vision-config.mjs';
import { usePreviewPrefs, writeEffectPreviewMode, type EffectPreviewMode } from '@/lib/preview-prefs';
import type { PreviewRenderControl } from '@/editor/use-preview-renders';
import { PreviewRenderControls } from './PreviewRenderControls';
import { useT } from '@/i18n';
import type { Look } from '@/lib/look';
import { MIXED, Section, SectionAction, ColorField, SelectField, SliderField } from './inspector-fields';
import { ColorSwatch } from './ColorPicker';
export type VisionStatus = {
  phase: 'idle' | 'loading' | 'processing' | 'ready' | 'error';
  preview?: 'draft' | 'quality' | 'original' | 'cached' | 'export' | null;
  refining?: boolean; backend?: string | null; processingMs?: number | null; fps?: number | null; cache?: string | null;
  error?: string;
  download?: { received: number; bytes: number };
};
export type VisionStatusReader = (id: string, retry?: boolean) => Promise<VisionStatus | null | undefined>;
type SliderKey = BeautyKey | 'texture' | 'edge' | 'shrink' | 'despill' | 'keyTolerance' | 'keySoftness';
const groups: { name: string; keys: BeautyKey[] }[] = [
  { name: 'skin', keys: ['smooth', 'blemish', 'even', 'highlights', 'light', 'warm', 'rosy', 'detail'] },
  { name: 'features', keys: ['darkCircles', 'eyeBright', 'teeth'] },
  { name: 'reshape', keys: ['slim', 'jaw', 'chin', 'eyes', 'nose'] },
  { name: 'makeup', keys: ['lip', 'blush', 'shadow'] },
];
const presets: Record<string, Partial<Record<BeautyKey, number>>> = {
  natural: { smooth: 0.28, blemish: .15, highlights: .15, light: 0.1, even: 0.2, darkCircles: 0.25, detail: 0.12 },
  portrait: {
    smooth: 0.4,
    light: 0.16,
    rosy: 0.1,
    even: 0.25,
    darkCircles: 0.35,
    eyeBright: 0.15,
    teeth: 0.2,
    slim: 0.12,
  },
  makeup: { smooth: 0.25, light: 0.1, lip: 0.45, blush: 0.3, shadow: 0.25 },
};
export function VideoEffectsSection({
  look,
  clipId,
  readStatus,
  previewControl,
}: {
  look: Look;
  clipId: string;
  readStatus?: VisionStatusReader;
  previewControl?: PreviewRenderControl;
}) {
  const t = useT();
  const previewPrefs = usePreviewPrefs();
  const value = look.common(videoEffects);
  const settings: VideoEffects = value === MIXED ? videoEffects(() => undefined) : value;
  const [status, setStatus] = React.useState<VisionStatus>({ phase: 'idle' });
  const latest = React.useRef({ readStatus, look });
  latest.current = { readStatus, look };
  const comparing = React.useRef(false),
    enabled = hasVideoEffects({ ...settings, bypass: false });
  React.useEffect(() => {
    if (!enabled) {
      setStatus({ phase: 'idle' });
      return;
    }
    let gone = false,
      asking = false;
    const ask = async () => {
      if (asking) return;
      asking = true;
      try {
        const next = await latest.current.readStatus?.(clipId);
        if (!gone && next) setStatus(next);
      } catch {
        if (!gone) setStatus({ phase: 'error' });
      } finally {
        asking = false;
      }
    };
    void ask();
    const timer = window.setInterval(() => void ask(), 400);
    return () => {
      gone = true;
      window.clearInterval(timer);
    };
  }, [clipId, enabled]);
  React.useEffect(
    () => () => {
      if (comparing.current) latest.current.look.revert();
    },
    [],
  );
  const toggle = (label: string, on: boolean, run: () => void) => (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={on}
      onClick={run}
      className="flex h-7 items-center justify-between text-[11.5px] text-[var(--text)]"
    >
      {label}
      <span
        aria-hidden
        className={`relative h-4 w-7 rounded-full ${on ? 'bg-[var(--switch-on)]' : 'bg-[var(--bg-field)] ring-1 ring-inset ring-[var(--border)]'}`}
      >
        <span
          className={`absolute top-[3px] h-2.5 w-2.5 rounded-full ${on ? 'left-[15px] bg-white' : 'left-[3px] bg-[var(--text-faint)]'}`}
        />
      </span>
    </button>
  );
  const slider = (key: SliderKey) => (
    <SliderField
      key={key}
      label={t(`videoEffects.${key}`)}
      value={Math.round(settings[key] * 100)}
      min={['warm', 'shrink', 'chin'].includes(key) ? -100 : 0}
      max={100}
      unit="%"
      onPreview={(n) => look.preview(() => ({ [VISION_PROPERTIES[key]]: String(n / 100) }))}
      onCommit={(n) => look.commit(() => ({ [VISION_PROPERTIES[key]]: String(n / 100) }))}
      onRevert={() => look.revert()}
    />
  );
  const applyBeauty = (values: Partial<Record<BeautyKey, number>>, reset = false) =>
    look.commit(() => ({
      ...Object.fromEntries(
        BEAUTY_KEYS.map((key) => [VISION_PROPERTIES[key], values[key] ? String(values[key]) : null]),
      ),
      ...(reset ? Object.fromEntries(['quality', 'texture', 'protectGlasses'].map((key) => [VISION_PROPERTIES[key as keyof typeof VISION_PROPERTIES], null])) : {}),
      '--of-beauty-lip-color': null,
      '--of-beauty-blush-color': null,
      '--of-beauty-shadow-color': null,
    }));
  const compare = (on: boolean) => {
    if (comparing.current === on) return;
    comparing.current = on;
    if (on) look.preview(() => ({ [VISION_PROPERTIES.bypass]: '1' }));
    else look.revert();
  };
  return (
    <>
      {enabled ? (
        <Section id="vision-status" title={t('videoEffects.status')}>
          <SelectField label={t('videoEffects.previewPolicy')} value={previewPrefs.effects}
            options={(['auto', 'smooth', 'quality'] as const).map((value) => ({ value, label: t(`videoEffects.policy_${value}`) }))}
            onCommit={(value) => writeEffectPreviewMode(value as EffectPreviewMode)} />
          <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">{t(previewPrefs.effects === 'quality' ? 'videoEffects.qualityPlaybackHint' : 'videoEffects.previewPolicyHint')}</p>
          {previewControl ? <PreviewRenderControls control={previewControl} clipId={clipId} /> : null}
          {status.preview ? <p data-vision-profile={status.preview} className="text-[11px] text-[var(--text-muted)]">{t(`videoEffects.profile_${status.preview}`)}{status.refining ? ` · ${t('videoEffects.refining')}` : ''}</p> : null}
          {status.processingMs != null ? <details className="text-[10.5px] text-[var(--text-faint)]">
            <summary className="cursor-pointer">{t('videoEffects.performance')}</summary>
            <p className="pt-1">{status.backend} · {status.processingMs} ms{status.fps ? ` · ${status.fps.toFixed(1)} fps` : ''}{status.cache ? ` · ${t('videoEffects.cacheHit')}` : ''}</p>
          </details> : null}
          <p
            role="status"
            data-vision-status={status.phase}
            className={`text-[11px] leading-relaxed ${status.phase === 'error' ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}
          >
            {t(`videoEffects.${status.phase}`)}
          </p>
          {status.download ? (
            <div className="flex flex-col gap-1 text-[10.5px] text-[var(--text-muted)]">
              <progress
                aria-label={t('videoEffects.downloading')}
                value={status.download.received}
                max={status.download.bytes}
                className="h-1 w-full accent-[var(--accent)]"
              />
              {Math.round(status.download.received / 1e6)} / {Math.ceil(status.download.bytes / 1e6)} MB
            </div>
          ) : null}
          {status.phase === 'error' ? (
            <>
              <p className="break-words text-[10.5px] text-[var(--text-faint)]">{status.error}</p>
              <button
                type="button"
                onClick={() => {
                  setStatus({ phase: 'loading' });
                  void readStatus?.(clipId, true).catch(() => setStatus({ phase: 'error' }));
                }}
                className="self-start text-[11px] text-[var(--accent)] hover:underline"
              >
                {t('videoEffects.retry')}
              </button>
            </>
          ) : null}
          <button
            type="button"
            aria-label={t('videoEffects.compare')}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              compare(true);
            }}
            onPointerUp={() => compare(false)}
            onPointerCancel={() => compare(false)}
            onBlur={() => compare(false)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault();
                compare(true);
              }
            }}
            onKeyUp={() => compare(false)}
            className="flex h-7 items-center justify-center gap-1.5 rounded bg-[var(--bg-field)] text-[11px] text-[var(--text)] hover:bg-[var(--bg-hover)]"
          >
            <Eye size={12} />
            {t('videoEffects.compare')}
          </button>
          <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">{t('videoEffects.previewHint')}</p>
          <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">{t('videoEffects.downloadHint')}</p>
        </Section>
      ) : null}
      <Section id="cutout" title={t('videoEffects.cutout')}>
        {toggle(t('videoEffects.removeBackground'), settings.cutout, () =>
          look.commit(() => ({ [VISION_PROPERTIES.cutout]: settings.cutout ? null : '1' })),
        )}
        {settings.cutout ? (
          <>
            <SelectField
              label={t('videoEffects.mode')}
              value={String(settings.mode)}
              options={[1, 4, 2, 0, 3].map((mode) => ({ value: String(mode), label: t(`videoEffects.mode${mode}`) }))}
              onCommit={(mode) => look.commit(() => ({ [VISION_PROPERTIES.mode]: mode }))}
            />
            <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">
              {t(`videoEffects.modeHint${settings.mode}`)}
            </p>
            {settings.mode === 0 ? (
              <button type="button" className="self-start text-[11px] text-[var(--accent)] hover:underline"
                onClick={() => look.commit(() => ({ [VISION_PROPERTIES.mode]: '1', [VISION_PROPERTIES.edge]: '.15' }))}>
                {t('videoEffects.upgradePortrait')}
              </button>
            ) : null}
            {settings.edge > .5 && settings.mode !== 3 ? (
              <p className="text-[10.5px] leading-relaxed text-[var(--text-muted)]">{t('videoEffects.softWarning')}</p>
            ) : null}
            {settings.mode === 3 ? (
              <>
                <div className="flex h-7 items-center justify-between text-[11px] text-[var(--text-muted)]">
                  {t('videoEffects.keyColor')}
                  <ColorSwatch
                    label={t('videoEffects.keyColor')}
                    value={settings.keyColor}
                    onCommit={(value) => look.commit(() => ({ '--of-cutout-color': value }))}
                    className="h-6 w-12 rounded border border-[var(--border)]"
                  />
                </div>
                {slider('keyTolerance')}
                {slider('keySoftness')}
              </>
            ) : null}
            {slider('edge')}
            {slider('shrink')}
            {slider('despill')}
          </>
        ) : null}
        <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">{t('videoEffects.cutoutHint')}</p>
      </Section>
      <Section
        id="beauty"
        title={t('videoEffects.beauty')}
        aside={
          <SectionAction label={t('videoEffects.reset')} onClick={() => applyBeauty({}, true)}>
            <RotateCcw size={12} />
          </SectionAction>
        }
      >
        {toggle(t('videoEffects.enableBeauty'), hasBeauty(settings), () =>
          applyBeauty(hasBeauty(settings) ? {} : { smooth: 0.35, light: 0.15, warm: 0.1 }),
        )}
        {hasBeauty(settings) ? <>
          <SelectField label={t('videoEffects.quality')} value={String(settings.quality)}
            options={[0, 1].map((quality) => ({ value: String(quality), label: t(`videoEffects.quality${quality}`) }))}
            onCommit={(quality) => look.commit(() => ({ [VISION_PROPERTIES.quality]: quality }))} />
          <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">{t('videoEffects.qualityHint')}</p>
          {slider('texture')}
          {toggle(t('videoEffects.protectGlasses'), settings.protectGlasses >= .5, () =>
            look.commit(() => ({ [VISION_PROPERTIES.protectGlasses]: settings.protectGlasses >= .5 ? '0' : '1' })),
          )}
        </> : null}
        <div className="flex gap-1">
          {Object.keys(presets).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => applyBeauty(presets[key]!)}
              className="flex-1 rounded bg-[var(--bg-field)] px-1 py-1.5 text-[10.5px] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              {t(`videoEffects.preset_${key}`)}
            </button>
          ))}
        </div>
        {hasBeauty(settings)
          ? groups.map((group) => (
              <fieldset key={group.name} className="flex min-w-0 flex-col gap-2 border-t border-[var(--border)] pt-2">
                <legend className="px-1 text-[11px] font-medium text-[var(--text-muted)]">
                  {t(`videoEffects.group_${group.name}`)}
                </legend>
                {group.keys.map(slider)}
                {group.name === 'makeup'
                  ? (['lip', 'blush', 'shadow'] as const).map((key) => (
                      <ColorField
                        key={key}
                        label={t(`videoEffects.${key}Color`)}
                        value={settings[`${key}Color`]}
                        onCommit={(value) => look.commit(() => ({ [`--of-beauty-${key}-color`]: value }))}
                        onPreview={(value) => look.preview(() => ({ [`--of-beauty-${key}-color`]: value }))}
                      />
                    ))
                  : null}
              </fieldset>
            ))
          : null}
        <p className="text-[10.5px] leading-relaxed text-[var(--text-faint)]">{t('videoEffects.beautyHint')}</p>
      </Section>

    </>
  );
}
