/**
 * The control bar laid over the bottom of the picture in full screen (YouTube's classic layout): bare buttons over a
 * gradient — play, volume and time on the left; subtitles, settings and exit full screen on the right. The volume
 * slider slides out on hover; its clip box is padded 7px each side so the knob is whole at 0 and 100%.
 *
 * Settings holds one row, playback speed. (A quality row was tried and dropped: films are drawn as vectors, so it
 * changed nothing in most of them.)
 */
import * as React from 'react';
import { useT } from '@/i18n';
import {
  TransportIconBtn,
  TransportSeekBar,
  transportTimeText,
} from './transport';

/* YouTube-style icons, 24×24, currentColor */
function Icon({ d, size = 24 }: { d: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false" style={{ display: 'block' }}>
      <path d={d} />
    </svg>
  );
}

const PATH_PLAY = 'M8 5v14l11-7z';
const PATH_PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z';
const PATH_VOL_HIGH = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z';
const PATH_VOL_LOW = 'M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z';
const PATH_VOL_MUTE = 'M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z';
const PATH_SETTINGS = 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z';
const PATH_FULLSCREEN_EXIT = 'M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z';
/* the speed row's icon (material "speed") */
const PATH_SPEED = 'M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z';
const PATH_CHEVRON = 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z';
const PATH_CHEVRON_BACK = 'M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z';
const PATH_CHECK = 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';

/** The subtitles mark (YouTube's), also the timeline's subtitles toggle. */
export function CaptionsIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden focusable="false" style={{ display: 'block' }}>
      <path d="M19 4H5c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z" />
    </svg>
  );
}

const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export interface PlayerControlsBarProps {
  timeMs: number;
  totalMs: number;
  onPreview(ms: number): void;
  onCommit(ms: number): void;

  playing: boolean;
  onToggle(): void;

  volume: number;
  muted: boolean;
  onVolumeChange(v: number): void;
  onToggleMute(): void;

  /** Absent: no subtitles button (nothing to show). */
  captions?: { on: boolean; onToggle(): void };

  rate: number;
  onRateChange(rate: number): void;

  onExitFullscreen(): void;

  /** Shown or not (the host runs the idle timer); while the settings panel is open it shows regardless. */
  visible: boolean;
  /** The pointer touched the bar: the host restarts its idle timer. */
  onShow?(): void;
}

export function PlayerControlsBar({
  timeMs,
  totalMs,
  onPreview,
  onCommit,
  playing,
  onToggle,
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
  captions,
  rate,
  onRateChange,
  onExitFullscreen,
  visible,
  onShow,
}: PlayerControlsBarProps) {
  const t = useT();
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const shown = visible || settingsOpen;

  return (
    <div
      data-vp-controls
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        padding: '28px 16px 8px',
        /* only as dark as white text and buttons need to stand */
        background: 'linear-gradient(transparent, rgba(0,0,0,.45))',
        opacity: shown ? 1 : 0,
        transition: 'opacity .25s',
        pointerEvents: shown ? 'auto' : 'none',
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={onShow}
      onMouseMove={onShow}
      onPointerDown={(e) => { e.stopPropagation(); onShow?.(); }}
    >
      <TransportSeekBar
        timeMs={timeMs}
        totalMs={totalMs}
        onPreview={onPreview}
        onCommit={onCommit}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, color: '#fff', fontSize: 12 }}>
        <TransportIconBtn onClick={onToggle} title={playing ? t('player.pauseTitle') : t('player.playTitle')}>
          <Icon d={playing ? PATH_PAUSE : PATH_PLAY} />
        </TransportIconBtn>
        <VolumeControl
          volume={volume}
          muted={muted}
          onVolumeChange={onVolumeChange}
          onToggleMute={onToggleMute}
        />
        <span style={{ opacity: 0.9, fontVariantNumeric: 'tabular-nums', fontSize: 12, marginLeft: 6, whiteSpace: 'nowrap' }}>
          {transportTimeText(timeMs)} / {transportTimeText(totalMs)}
        </span>
        <span style={{ flex: 1 }} />
        {captions ? (
          <TransportIconBtn onClick={captions.onToggle} title={t('player.captionsTitle')}>
            <span style={{ position: 'relative', display: 'block' }}>
              <CaptionsIcon />
              {captions.on && (
                <span style={{ position: 'absolute', left: 3, right: 3, bottom: -3, height: 3, borderRadius: 1, background: '#f03' }} />
              )}
            </span>
          </TransportIconBtn>
        ) : null}
        <SettingsMenu
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          rate={rate}
          onRateChange={onRateChange}
        />
        <TransportIconBtn onClick={onExitFullscreen} title={t('player.exitFullscreenTitle')}>
          <Icon d={PATH_FULLSCREEN_EXIT} />
        </TransportIconBtn>
      </div>
    </div>
  );
}

/** The slider's track length, and the padding at each end for the knob (radius 6 + 1). */
const VOL_TRACK_W = 52;
const VOL_PAD = 7;

/** Volume: the button, and a slider that slides out on hover. */
function VolumeControl({
  volume,
  muted,
  onVolumeChange,
  onToggleMute,
}: {
  volume: number;
  muted: boolean;
  onVolumeChange(v: number): void;
  onToggleMute(): void;
}) {
  const t = useT();
  const [hover, setHover] = React.useState(false);
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const draggingRef = React.useRef(false);
  const effective = muted || volume === 0 ? 0 : volume;
  const iconPath = effective === 0 ? PATH_VOL_MUTE : effective < 0.5 ? PATH_VOL_LOW : PATH_VOL_HIGH;
  const open = hover || draggingRef.current;
  const fullW = VOL_TRACK_W + VOL_PAD * 2;

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0)) return;
    onVolumeChange(Math.max(0, Math.min(1, (clientX - r.left) / r.width)));
  };

  return (
    <div
      style={{ display: 'flex', alignItems: 'center' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <TransportIconBtn onClick={onToggleMute} title={effective === 0 ? t('player.unmuteTitle') : t('player.muteTitle')}>
        <Icon d={iconPath} />
      </TransportIconBtn>
      <div
        style={{
          width: open ? fullW : 0,
          opacity: open ? 1 : 0,
          overflow: 'hidden',
          transition: 'width .2s ease, opacity .2s ease',
          display: 'flex',
          alignItems: 'center',
          height: 24,
        }}
      >
        <div
          role="slider"
          aria-label={t('player.volume')}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={effective}
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            width: fullW,
            height: 24,
            padding: `0 ${VOL_PAD}px`,
            boxSizing: 'border-box',
            cursor: 'pointer',
            touchAction: 'none',
          }}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            draggingRef.current = true;
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
            setFromClientX(e.clientX);
          }}
          onPointerMove={(e) => { if (draggingRef.current) setFromClientX(e.clientX); }}
          onPointerUp={() => { draggingRef.current = false; }}
          onPointerCancel={() => { draggingRef.current = false; }}
        >
          <div ref={trackRef} style={{ position: 'relative', width: VOL_TRACK_W, height: 3, borderRadius: 1.5, background: 'rgba(255,255,255,.3)', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${effective * 100}%`, borderRadius: 1.5, background: '#fff', pointerEvents: 'none' }} />
            <div
              style={{
                position: 'absolute',
                left: `${effective * 100}%`,
                top: '50%',
                width: 12,
                height: 12,
                marginLeft: -6,
                marginTop: -6,
                borderRadius: '50%',
                background: '#fff',
                pointerEvents: 'none',
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The settings panel: a root row (playback speed) that opens a list. As YouTube: icon left, current value and a chevron
 * right; the list starts with a "‹ title" row back to the root.
 */
function SettingsMenu({
  open,
  onOpenChange,
  rate,
  onRateChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  rate: number;
  onRateChange(rate: number): void;
}) {
  const t = useT();
  const [view, setView] = React.useState<'root' | 'speed'>('root');
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!open) { setView('root'); return; }
    const onDocDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onDocDown, true);
    return () => document.removeEventListener('pointerdown', onDocDown, true);
  }, [open, onOpenChange]);

  const row: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
    width: '100%',
    padding: '10px 16px',
    border: 0,
    background: 'transparent',
    color: '#eee',
    fontSize: 13,
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
  };
  const value: React.CSSProperties = { marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 2, opacity: 0.75 };
  const rateText = (r: number) => (r === 1 ? t('player.speedNormal') : `${r}×`);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <TransportIconBtn onClick={() => onOpenChange(!open)} title={t('player.settings')} active={open}>
        <span style={{ display: 'block', transform: open ? 'rotate(30deg)' : 'none', transition: 'transform .15s' }}>
          <Icon d={PATH_SETTINGS} />
        </span>
      </TransportIconBtn>
      {open && (
        <div
          style={{
            position: 'absolute',
            right: 0,
            bottom: 46,
            minWidth: 232,
            borderRadius: 12,
            background: 'rgba(28,28,28,.94)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            padding: '6px 0',
            zIndex: 30,
            boxShadow: '0 8px 28px rgba(0,0,0,.45)',
          }}
        >
          {view === 'root' ? (
            <button type="button" style={row} onClick={() => setView('speed')}>
              <Icon d={PATH_SPEED} size={20} />
              <span>{t('player.speed')}</span>
              <span style={value}>{rateText(rate)}<Icon d={PATH_CHEVRON} size={18} /></span>
            </button>
          ) : (
            <>
              <button
                type="button"
                style={{ ...row, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.12)', marginBottom: 4 }}
                onClick={() => setView('root')}
              >
                <Icon d={PATH_CHEVRON_BACK} size={20} />
                <span>{t('player.speed')}</span>
              </button>
              {SPEED_OPTIONS.map((s) => (
                <MenuOption
                  key={s}
                  style={row}
                  checked={s === rate}
                  onClick={() => { onRateChange(s); onOpenChange(false); }}
                >
                  {rateText(s)}
                </MenuOption>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MenuOption({
  checked,
  onClick,
  style,
  children,
}: {
  checked: boolean;
  onClick(): void;
  style: React.CSSProperties;
  children: React.ReactNode;
}) {
  const [hover, setHover] = React.useState(false);
  return (
    <button
      type="button"
      style={{ ...style, gap: 10, background: hover ? 'rgba(255,255,255,.1)' : 'transparent' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
    >
      <span style={{ width: 20, display: 'inline-flex', justifyContent: 'center' }}>
        {checked ? <Icon d={PATH_CHECK} size={18} /> : null}
      </span>
      <span>{children}</span>
    </button>
  );
}
