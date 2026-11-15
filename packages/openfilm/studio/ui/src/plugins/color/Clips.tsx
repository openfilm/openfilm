/**
 * The film's video clips in order, each a picture of its middle as it plays now (through its grade), so shots are
 * matched by eye side by side; a click grades that clip. A dot marks the graded ones.
 */
import * as React from 'react';

export interface ClipRow {
  id: string;
  src: string;
  file: string;
  track: number;
  at: number;
  end: number | null;
  from: number;
  to: number | null;
  speed: number;
  graded: boolean;
  lut: string | null;
  others: string[];
}

/** A picture as the server reads it (16-bit RGB) put on a canvas. */
export function paintRaw(canvas: HTMLCanvasElement, w: number, h: number, raw: ArrayBuffer) {
  const src = new Uint16Array(raw);
  const img = new ImageData(w, h);
  for (let i = 0, j = 0; i < src.length; i += 3, j += 4) {
    img.data[j] = src[i] >> 8; img.data[j + 1] = src[i + 1] >> 8; img.data[j + 2] = src[i + 2] >> 8; img.data[j + 3] = 255;
  }
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
}

export function Clips({ clips, selected, onSelect, thumb, words }: {
  clips: ClipRow[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** a clip's picture, as it plays now: resolves with what to paint */
  thumb: (clip: ClipRow) => Promise<{ w: number; h: number; raw: ArrayBuffer } | null>;
  words: { graded: string; none: string };
}) {
  if (!clips.length) return <div className="flex h-full items-center justify-center bg-[var(--bg-panel)] text-[11px] text-[var(--text-faint)]">{words.none}</div>;
  return (
    <div className="flex h-full min-h-0 items-stretch gap-2 overflow-x-auto bg-[var(--bg-panel)] px-2 py-2">
      {clips.map((c) => <Thumb key={c.id} clip={c} on={c.id === selected} onSelect={onSelect} thumb={thumb} gradedLabel={words.graded} />)}
    </div>
  );
}

function Thumb({ clip, on, onSelect, thumb, gradedLabel }: {
  clip: ClipRow; on: boolean; onSelect: (id: string) => void; thumb: (clip: ClipRow) => Promise<{ w: number; h: number; raw: ArrayBuffer } | null>; gradedLabel: string;
}) {
  const canvas = React.useRef<HTMLCanvasElement | null>(null);
  /* painted again whenever its grade's LUT changes */
  const key = `${clip.lut ?? ''}|${clip.others.join(',')}|${clip.from}|${clip.to ?? ''}`;
  React.useEffect(() => {
    let live = true;
    thumb(clip).then((t) => { if (live && t && canvas.current) paintRaw(canvas.current, t.w, t.h, t.raw); }).catch(() => {});
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const span = `${clip.at.toFixed(1)}–${clip.end === null ? '…' : clip.end.toFixed(1)} s`;
  return (
    <button type="button" onClick={() => onSelect(clip.id)} aria-pressed={on} title={`${clip.id} · ${clip.src} · ${span}`}
      className={`group relative flex h-full shrink-0 flex-col gap-1 rounded-[6px] p-1 text-left transition ${on ? 'bg-[var(--bg-selected)] ring-1 ring-[var(--accent)]' : 'hover:bg-[var(--bg-hover)]'}`}>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-[4px] bg-black" style={{ aspectRatio: '16 / 9' }}>
        <canvas ref={canvas} className="h-full w-full object-contain" />
        {clip.graded ? <span title={gradedLabel} className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)] shadow" /> : null}
      </div>
      <div className="flex items-baseline justify-between gap-2 px-0.5">
        <span className="max-w-[110px] truncate text-[10.5px] text-[var(--text)]">{clip.id}</span>
        <span className="shrink-0 font-mono text-[9.5px] text-[var(--text-faint)]">{span}</span>
      </div>
    </button>
  );
}
