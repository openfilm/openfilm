import React from 'react';
import { Camera, Loader2, Pause, Play, VideoOff, Volume2, VolumeX } from 'lucide-react';
import { useT } from '@/i18n';
import type { WorkspaceResource } from '@/lib/workspace-resources';
import { useBoard } from './board';
import { frameOf } from './pixels';
import styles from './video.module.css';

const time = (value: number) => {
  const seconds = Math.floor(value);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const clock = `${hours ? String(minutes % 60).padStart(2, '0') : minutes}:${String(seconds % 60).padStart(2, '0')}`;
  return hours ? `${hours}:${clock}` : clock;
};

const button = 'grid size-7 shrink-0 place-items-center rounded-md text-white hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50';
const frameModes = ['current', 'first', 'last'] as const;
const MUTE_KEY = 'openfilm.canvas.videoMuted';
const VOLUME_KEY = 'openfilm.canvas.videoVolume';
let mutedInMemory = false;
let volumeInMemory = 1;

function readMute() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; }
  catch { return mutedInMemory; }
}

function writeMute(value: boolean) {
  mutedInMemory = value;
  try { localStorage.setItem(MUTE_KEY, value ? '1' : '0'); } catch { /* kept in memory */ }
  window.dispatchEvent(new Event(MUTE_KEY));
}

function readVolume() {
  try {
    const saved = localStorage.getItem(VOLUME_KEY);
    const volume = Number(saved);
    return saved !== null && Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : volumeInMemory;
  } catch { return volumeInMemory; }
}

function writeVolume(value: number) {
  volumeInMemory = value;
  try { localStorage.setItem(VOLUME_KEY, String(value)); } catch { /* kept in memory */ }
  window.dispatchEvent(new Event(MUTE_KEY));
}

function watchSound(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === MUTE_KEY || event.key === VOLUME_KEY || event.key === null) notify(); };
  window.addEventListener(MUTE_KEY, notify);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(MUTE_KEY, notify);
    window.removeEventListener('storage', onStorage);
  };
}

/** Keep one media element in the card and return it to the beginning after each hover. */
export function CanvasVideo({ id, file, selected }: { id: string; file: WorkspaceResource; selected: boolean }) {
  const board = useBoard();
  const t = useT();
  const src = board.sources.file(file);
  const player = React.useRef<HTMLVideoElement>(null);
  const firstFrame = React.useRef<HTMLCanvasElement>(null);
  const captureButton = React.useRef<HTMLButtonElement>(null);
  const volumeButton = React.useRef<HTMLButtonElement>(null);
  const volumeSlider = React.useRef<HTMLInputElement>(null);
  const pointerInside = React.useRef(false);
  const rewindFrame = React.useRef(0);
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [firstFrameReady, setFirstFrameReady] = React.useState(false);
  const [atStart, setAtStart] = React.useState(true);
  const showFirstFrame = firstFrameReady && atStart && !failed;
  const sharedMuted = React.useSyncExternalStore(watchSound, readMute, () => false);
  const volume = React.useSyncExternalStore(watchSound, readVolume, () => 1);
  const [autoplayMuted, setAutoplayMuted] = React.useState(false);
  const muted = sharedMuted || autoplayMuted;
  const [seconds, setSeconds] = React.useState(0);
  const [length, setLength] = React.useState((file.durationMs ?? 0) / 1000);
  const [popup, setPopup] = React.useState<'volume' | 'frames' | null>(null);
  const [capturing, setCapturing] = React.useState(false);
  const menuId = React.useId();
  const volumeId = React.useId();
  React.useEffect(() => { if (player.current) player.current.volume = volume; }, [volume]);
  const popupEvents = (kind: 'volume' | 'frames', enabled = true): React.HTMLAttributes<HTMLDivElement> => ({
    onPointerEnter: (event) => { if (enabled && event.pointerType === 'mouse' && !event.buttons) setPopup(kind); },
    onPointerLeave: (event) => {
      if (event.pointerType === 'mouse') setPopup((open) => open === kind ? null : open);
    },
    onBlur: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setPopup((open) => open === kind ? null : open);
    },
  });
  const updateLength = (video: HTMLVideoElement) => { if (Number.isFinite(video.duration)) setLength(video.duration); };
  const toggle = () => {
    const video = player.current;
    if (!video) return;
    if (!video.paused) {
      video.pause();
      return;
    }
    setAtStart(false);
    void video.play().catch(() => {
      if (video.paused && video.currentTime === 0) setAtStart(true);
    });
  };
  const reset = React.useCallback(() => {
    pointerInside.current = false;
    const video = player.current;
    if (video) {
      video.pause();
      cancelAnimationFrame(rewindFrame.current);
      if (video.currentTime !== 0) {
        // A second seek in the same rendered frame can leave Chromium showing the previous frame.
        rewindFrame.current = requestAnimationFrame(() => {
          rewindFrame.current = 0;
          if (player.current === video) video.currentTime = 0;
        });
      }
    }
    setSeconds(0);
    setAtStart(true);
    setAutoplayMuted(false);
  }, []);
  React.useEffect(() => () => cancelAnimationFrame(rewindFrame.current), []);
  const capture = async (mode: typeof frameModes[number]) => {
    const video = player.current;
    if (!video || capturing) return;
    video.pause();
    const at = mode === 'first' ? 0 : mode === 'last' ? video.duration : video.currentTime;
    const base = file.name.replace(/\.[^.]+$/, '');
    setPopup(null);
    captureButton.current?.focus();
    setCapturing(true);
    try { board.bring(id, [await frameOf(src, at, `${base}-${mode}-frame.png`)]); }
    catch { board.reportError?.(t('canvas.video.captureFailed')); }
    finally { setCapturing(false); }
  };
  React.useEffect(() => {
    if (board.shown === false) {
      reset();
      setPopup(null);
    }
  }, [board.shown, reset]);
  return (
    <div className="absolute inset-0 overflow-hidden bg-black @container"
      onPointerEnter={(event) => {
        const video = player.current;
        if (event.pointerType !== 'mouse' || event.buttons || pointerInside.current || board.shown === false) return;
        pointerInside.current = true;
        if (!video?.paused) return;
        if (rewindFrame.current) {
          cancelAnimationFrame(rewindFrame.current);
          rewindFrame.current = 0;
          video.currentTime = 0;
        }
        setAtStart(false);
        void video.play().catch((error: unknown) => {
          // Browser Studio may require a click before it can autoplay with sound.
          if (!(error instanceof DOMException) || error.name !== 'NotAllowedError' || !pointerInside.current || player.current !== video || video.muted) return;
          video.muted = true;
          setAutoplayMuted(true);
          void video.play().catch(() => {});
        });
      }}
      onPointerLeave={(event) => {
        // Changing a control's icon can send a leave event while the pointer is still over the card.
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX >= bounds.left && event.clientX < bounds.right && event.clientY >= bounds.top && event.clientY < bounds.bottom) return;
        setPopup(null);
        reset();
      }}>
      <video ref={player} src={src} muted={muted} playsInline preload={board.shown === false ? 'metadata' : 'auto'} draggable={false}
        onLoadedMetadata={(event) => updateLength(event.currentTarget)} onDurationChange={(event) => updateLength(event.currentTarget)}
        onLoadedData={(event) => {
          const video = event.currentTarget;
          const still = firstFrame.current;
          if (still && !firstFrameReady && video.videoWidth && video.videoHeight) {
            // A paused seek can finish decoding before Chromium replaces its previous compositor frame.
            const scale = Math.min(1, 960 / Math.max(video.videoWidth, video.videoHeight));
            still.width = Math.max(1, Math.round(video.videoWidth * scale));
            still.height = Math.max(1, Math.round(video.videoHeight * scale));
            const context = still.getContext('2d');
            if (context) {
              context.drawImage(video, 0, 0, still.width, still.height);
              setFirstFrameReady(true);
            }
          }
          setReady(true);
        }} onError={() => setFailed(true)}
        onTimeUpdate={(event) => setSeconds(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        className={`pointer-events-none absolute inset-0 size-full object-contain ${showFirstFrame ? 'invisible' : ''}`} />
      <canvas ref={firstFrame} width={1} height={1} aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full object-contain"
        hidden={!showFirstFrame} />
      {failed ? (
        <div role="status" className="pointer-events-none absolute inset-0 grid place-content-center justify-items-center gap-2 bg-black/50 px-3 text-center text-xs text-white">
          <VideoOff size={20} />{t('canvas.video.unavailable')}
        </div>
      ) : !ready ? (
        <div role="status" className="pointer-events-none absolute inset-0 grid place-content-center justify-items-center gap-2 text-xs text-white/80">
          <Loader2 size={20} className="animate-spin" />{t('canvas.video.loading')}
        </div>
      ) : null}
      {!failed ? (
        <div data-canvas-video-controls="" className={`nodrag nopan absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-1.5 pb-1.5 pt-4 text-white transition-opacity @[260px]:px-3 @[260px]:pb-2 ${selected || popup ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100'}`}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape' && popup) {
              setPopup(null);
              (popup === 'frames' ? captureButton : volumeButton).current?.focus();
            }
          }}>
          <div className="flex items-center gap-1 @[260px]:gap-2">
            <button type="button" className={button} onClick={toggle} aria-label={t(playing ? 'versions.pause' : 'versions.play')}>
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            </button>
            <span className="hidden shrink-0 text-xs tabular-nums @[260px]:inline">{time(seconds)}</span>
            <input type="range" min={0} max={length || 1} step={0.01} value={Math.min(seconds, length)} disabled={!length}
              aria-label={t('versions.seek')} aria-valuetext={time(seconds)} className={`${styles.seek} m-0 h-5 min-w-0 flex-1 cursor-pointer p-0`}
              style={{ '--played': `${length ? Math.min(seconds / length, 1) * 100 : 0}%` } as React.CSSProperties}
              onChange={(event) => {
                const video = player.current;
                if (video) {
                  video.currentTime = event.currentTarget.valueAsNumber;
                  setSeconds(video.currentTime);
                  setAtStart(video.currentTime === 0);
                }
              }} />
            <span className="hidden shrink-0 text-xs tabular-nums @[260px]:inline">{time(length)}</span>
            <div className="relative shrink-0" {...popupEvents('volume')}>
              <button ref={volumeButton} type="button" className={button} aria-label={t(muted || !volume ? 'versions.unmute' : 'versions.mute')}
                aria-expanded={popup === 'volume'} aria-controls={popup === 'volume' ? volumeId : undefined}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                  event.preventDefault();
                  setPopup('volume');
                  requestAnimationFrame(() => volumeSlider.current?.focus());
                }}
                onClick={() => {
                  setPopup('volume');
                  if (!volume) writeVolume(1);
                  setAutoplayMuted(false);
                  writeMute(!(muted || !volume));
                }}>
                {muted || !volume ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              {popup === 'volume' ? (
                <div id={volumeId} className="absolute bottom-full left-1/2 z-10 -translate-x-1/2 pb-1">
                  <div className="flex w-9 flex-col items-center gap-1 rounded-lg border border-white/12 bg-[#1b1b1b]/95 py-1.5 text-xs tabular-nums shadow-lg">
                    <span aria-hidden="true">{muted ? 0 : Math.round(volume * 100)}</span>
                    <input ref={volumeSlider} type="range" min={0} max={100} value={muted ? 0 : Math.round(volume * 100)}
                      aria-label={t('canvas.video.volume')} aria-orientation="vertical" className={`${styles.volume} m-0 h-16 w-5 cursor-pointer p-0`}
                      style={{ '--played': `${muted ? 0 : volume * 100}%` } as React.CSSProperties}
                      onChange={(event) => {
                        const next = event.currentTarget.valueAsNumber / 100;
                        writeVolume(next);
                        if (next > 0) { setAutoplayMuted(false); writeMute(false); }
                      }} />
                  </div>
                </div>
              ) : null}
            </div>
            {!board.readOnly ? (
              <div className="relative shrink-0" {...popupEvents('frames', Boolean(length) && !capturing)}>
                <button ref={captureButton} type="button" className={button} disabled={!length || capturing}
                  aria-expanded={popup === 'frames'} aria-controls={popup === 'frames' ? menuId : undefined} aria-label={t('canvas.actions.frame')}
                  onClick={() => {
                    player.current?.pause();
                    setPopup('frames');
                  }}>
                  {capturing ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                </button>
                {popup === 'frames' ? (
                  <div id={menuId} className="absolute bottom-full right-0 z-10 min-w-max pb-1">
                    <div className="flex flex-col rounded-lg border border-white/12 bg-[#1b1b1b] p-1 shadow-lg">
                      {frameModes.map((mode) => (
                        <button key={mode} type="button" onClick={() => { void capture(mode); }}
                          className="rounded-md px-2.5 py-1.5 text-left text-xs text-white hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-white">
                          {t(`canvas.video.${mode}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
