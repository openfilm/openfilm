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
let mutedInMemory = false;

function readMute() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; }
  catch { return mutedInMemory; }
}

function writeMute(value: boolean) {
  mutedInMemory = value;
  try { localStorage.setItem(MUTE_KEY, value ? '1' : '0'); } catch { /* kept in memory */ }
  window.dispatchEvent(new Event(MUTE_KEY));
}

function watchMute(notify: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === MUTE_KEY || event.key === null) notify(); };
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
  const captureButton = React.useRef<HTMLButtonElement>(null);
  const pointerInside = React.useRef(false);
  const [ready, setReady] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const sharedMuted = React.useSyncExternalStore(watchMute, readMute, () => false);
  const [autoplayMuted, setAutoplayMuted] = React.useState(false);
  const muted = sharedMuted || autoplayMuted;
  const [seconds, setSeconds] = React.useState(0);
  const [length, setLength] = React.useState((file.durationMs ?? 0) / 1000);
  const [menu, setMenu] = React.useState(false);
  const [capturing, setCapturing] = React.useState(false);
  const menuId = React.useId();
  const updateLength = (video: HTMLVideoElement) => { if (Number.isFinite(video.duration)) setLength(video.duration); };
  const toggle = () => {
    const video = player.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };
  const reset = React.useCallback(() => {
    pointerInside.current = false;
    const video = player.current;
    if (video) {
      video.pause();
      if (video.currentTime !== 0) video.currentTime = 0;
    }
    setSeconds(0);
    setAutoplayMuted(false);
  }, []);
  const capture = async (mode: typeof frameModes[number]) => {
    const video = player.current;
    if (!video || capturing) return;
    const at = mode === 'first' ? 0 : mode === 'last' ? video.duration : video.currentTime;
    const base = file.name.replace(/\.[^.]+$/, '');
    setMenu(false);
    captureButton.current?.focus();
    setCapturing(true);
    try { board.bring(id, [await frameOf(src, at, `${base}-${mode}-frame.png`)]); }
    catch { board.reportError?.(t('canvas.video.captureFailed')); }
    finally { setCapturing(false); }
  };
  React.useEffect(() => {
    if (board.shown === false) {
      reset();
      setMenu(false);
    }
  }, [board.shown, reset]);
  return (
    <div className="absolute inset-0 overflow-hidden bg-black @container"
      onPointerEnter={(event) => {
        const video = player.current;
        if (event.pointerType !== 'mouse' || event.buttons || pointerInside.current || board.shown === false) return;
        pointerInside.current = true;
        if (menu || !video?.paused) return;
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
        reset();
      }}>
      <video ref={player} src={src} muted={muted} playsInline preload={board.shown === false ? 'metadata' : 'auto'} draggable={false}
        onLoadedMetadata={(event) => updateLength(event.currentTarget)} onDurationChange={(event) => updateLength(event.currentTarget)}
        onLoadedData={() => setReady(true)} onError={() => setFailed(true)}
        onTimeUpdate={(event) => setSeconds(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
        className="pointer-events-none absolute inset-0 size-full object-contain" />
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
        <div data-canvas-video-controls="" className={`nodrag nopan absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-1.5 pb-1.5 pt-4 text-white transition-opacity @[260px]:px-3 @[260px]:pb-2 ${selected || menu ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100'}`}
          onClick={(event) => event.stopPropagation()}
          onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false); }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape' && menu) { setMenu(false); captureButton.current?.focus(); }
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
                if (video) { video.currentTime = event.currentTarget.valueAsNumber; setSeconds(video.currentTime); }
              }} />
            <span className="hidden shrink-0 text-xs tabular-nums @[260px]:inline">{time(length)}</span>
            <button type="button" className={button} aria-label={t(muted ? 'versions.unmute' : 'versions.mute')} onClick={() => {
              if (player.current) player.current.muted = !muted;
              setAutoplayMuted(false);
              writeMute(!muted);
            }}>
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>
            {!board.readOnly ? (
              <div className="relative shrink-0">
                <button ref={captureButton} type="button" className={button} disabled={!length || capturing}
                  aria-expanded={menu} aria-controls={menu ? menuId : undefined} aria-label={t('canvas.actions.frame')}
                  onClick={() => {
                    if (!menu) player.current?.pause();
                    setMenu(!menu);
                  }}>
                  {capturing ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
                </button>
                {menu ? (
                  <div id={menuId} className="absolute bottom-full right-0 mb-1 flex min-w-max flex-col rounded-lg border border-white/12 bg-[#1b1b1b] p-1 shadow-lg">
                    {frameModes.map((mode) => (
                      <button key={mode} type="button" onClick={() => { void capture(mode); }}
                        className="rounded-md px-2.5 py-1.5 text-left text-xs text-white hover:bg-white/12 focus-visible:outline-2 focus-visible:outline-white">
                        {t(`canvas.video.${mode}`)}
                      </button>
                    ))}
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
