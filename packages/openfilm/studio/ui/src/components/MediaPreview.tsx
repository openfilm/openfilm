/**
 * A media file's thumbnail, filling its tile: a still or a video poster (contained, so a portrait clip is still
 * recognizable in a landscape tile), or a sound's waveform. Used by the media pane's tiles and folder covers, and by
 * the source viewer for sound.
 */
import React from 'react';
import { File as FileIcon, FileAudio, FileVideo, Image as ImageIcon, type LucideIcon } from 'lucide-react';
import {
  loadWavePeaks,
  warmedWavePeaks,
  type MediaSources,
  type WorkspaceResource,
  type WorkspaceResourceKind,
} from '@/lib/workspace-resources';
import { normalizeWavePeaks } from '@/lib/waveform-columns';

/** A file's icon by kind, where there is no picture of it. */
export const KIND_ICON: Record<WorkspaceResourceKind, LucideIcon> = {
  video: FileVideo,
  image: ImageIcon,
  audio: FileAudio,
  mg: FileVideo,
  other: FileIcon,
};

/**
 * Has this element come near the viewport yet. A tile asks for its poster only then: a pane of eighty files would
 * otherwise send eighty requests at once, and the visible row would come in last. Latched: once near, it stays.
 */
function useNearViewport<T extends Element>(margin = 200): [React.RefCallback<T>, boolean] {
  const [near, setNear] = React.useState(false);
  const observer = React.useRef<IntersectionObserver | null>(null);

  const ref = React.useCallback<React.RefCallback<T>>((node) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!node) return;
    /* no IntersectionObserver: treat it as visible rather than show nothing */
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      setNear(true);
      io.disconnect();
    }, { rootMargin: `${margin}px` });
    io.observe(node);
    observer.current = io;
  }, [margin]);

  React.useEffect(() => () => observer.current?.disconnect(), []);

  return [ref, near];
}

export function MediaPreview({
  file,
  sources,
}: {
  file: WorkspaceResource;
  sources: MediaSources;
}) {
  const [broken, setBroken] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [boxRef, near] = useNearViewport<HTMLSpanElement>();
  React.useEffect(() => { setBroken(false); setFailed(false); }, [file.path, file.mtimeMs]);

  if (file.kind === 'audio') return <AudioPreview file={file} sources={sources} />;

  const Icon = KIND_ICON[file.kind] ?? FileIcon;
  const thumbable = !broken && (file.kind === 'image' || file.kind === 'video');
  const poster = thumbable ? sources.poster?.(file) : undefined;
  const IMG = 'absolute inset-0 h-full w-full min-w-0 object-contain';

  return (
    <span ref={boxRef} className="absolute inset-0 flex items-center justify-center">
      {thumbable && file.kind === 'image' ? (
        /* the small picture when there is one; the original when not, or when it fails; broken only when both do */
        <img
          src={poster && !failed ? poster : sources.file(file)}
          alt=""
          loading="lazy"
          onError={() => (poster && !failed ? setFailed(true) : setBroken(true))}
          className={IMG}
        />
      ) : thumbable && near && poster ? (
        <img src={poster} alt="" onError={() => setBroken(true)} className={IMG} />
      ) : (
        <Icon size={26} className="text-[var(--text-muted)]" />
      )}
    </span>
  );
}

/**
 * A sound's waveform: 1px columns from the bottom, each as tall as the loudest peak under it, scaled to the file's own
 * peak as on the timeline (normalizeWavePeaks): drawn as recorded, a quiet bed is a line along the bottom of a dark
 * tile. Without a waveform (it could not be read), the sound's icon.
 */
function AudioPreview({ file, sources }: { file: WorkspaceResource; sources: MediaSources }) {
  const wrapRef = React.useRef<HTMLSpanElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [nearRef, near] = useNearViewport<HTMLSpanElement>();
  const url = sources.wave(file);
  /* the warm-up (warmProjectMedia) may already have the peaks: draw them at once */
  const [raw, setPeaks] = React.useState<number[] | null>(() => warmedWavePeaks(url) ?? null);
  const peaks = React.useMemo(() => (raw?.length ? normalizeWavePeaks(raw) : null), [raw]);
  /* asked, and there is none (a network failure is not "none": see loadWavePeaks) */
  const [none, setNone] = React.useState(false);

  const setRefs = React.useCallback((el: HTMLSpanElement | null) => {
    wrapRef.current = el;
    nearRef(el);
  }, [nearRef]);

  React.useEffect(() => {
    setPeaks(warmedWavePeaks(url) ?? null);
    if (!near) return;
    let alive = true;
    setNone(false);
    void loadWavePeaks(url).then((got) => {
      if (!alive) return;
      if (got?.length) setPeaks(got);
      else setNone(warmedWavePeaks(url) === null);
    });
    return () => {
      alive = false;
    };
  }, [near, url]);

  React.useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || !peaks?.length) return;
    const draw = (): void => {
      const width = wrap.clientWidth;
      const height = wrap.clientHeight;
      if (width <= 0 || height <= 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(96, 165, 250, 0.95)';
      const per = peaks.length / width;
      for (let x = 0; x < width; x += 1) {
        const from = Math.floor(x * per);
        const to = Math.max(from + 1, Math.floor((x + 1) * per));
        let max = 0;
        for (let i = from; i < to && i < peaks.length; i += 1) {
          if (peaks[i]! > max) max = peaks[i]!;
        }
        const h = Math.max(1, max * height);
        ctx.fillRect(x, height - h, 1, h);
      }
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [peaks]);

  return (
    <span ref={setRefs} className="absolute inset-0 overflow-hidden contain-size bg-[#1a2744]">
      {none ? <FileAudio size={26} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/50" /> : null}
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 block size-full"
        style={{ width: '100%', height: '100%' }}
      />
    </span>
  );
}
