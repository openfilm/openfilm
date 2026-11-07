/**
 * Display normalization, for a sound's tile in the media pane. Peaks are absolute amplitudes (0..1): music sitting at
 * -20 dB would draw as a strip a few pixels high, and a tile is there to show where it sounds, not to be a level meter.
 * So each file is scaled to its own peak. The timeline draws a clip as loud as it plays instead (waveBarPx).
 *
 * The reference is the 99.5th percentile, not the maximum, so one spike does not flatten the rest. A file that is
 * silent throughout (reference under the noise floor) is returned as is: scaling it up would draw fake noise. The floor
 * is low because quiet pads and soft chimes peak around 0.01 and must still show; true silence quantises to 0–0.001.
 *
 * Normalized per whole file, not per part: a tile and a folder cover of the same file share one scale.
 */
export function normalizeWavePeaks(peaks: readonly number[]): number[] {
  const sorted = [...peaks].sort((a, b) => b - a);
  const ref = sorted[Math.floor(sorted.length * 0.005)] ?? 0;
  if (ref < 0.004) return [...peaks];
  const gain = 1 / ref;
  return peaks.map((v) => Math.min(1, v * gain));
}

/** Project real source peaks into pixels without stretching a shortened source over a longer clip. */
export function waveformColumns(
  wave: { peaks: readonly number[]; durationMs: number },
  inMs: number,
  durMs: number,
  width: number,
): number[] {
  const { peaks } = wave;
  const count = Math.max(1, Math.round(width));
  const from = wave.durationMs > 0 ? inMs / wave.durationMs * peaks.length : 0;
  const span = wave.durationMs > 0 ? durMs / wave.durationMs * peaks.length : peaks.length;
  const per = span / count;
  return Array.from({ length: count }, (_, x) => {
    const at = from + x * per;
    if (at >= peaks.length || at + per <= 0 || !peaks.length) return 0;
    if (per >= 1) {
      let peak = 0;
      for (let i = Math.max(0, Math.floor(at)); i < Math.min(peaks.length, Math.ceil(at + per)); i++) {
        peak = Math.max(peak, peaks[i]!);
      }
      return peak;
    }
    if (at < 0) return 0;
    const i = Math.floor(at);
    const next = Math.min(peaks.length - 1, i + 1);
    return peaks[i]! * (1 - (at - i)) + peaks[next]! * (at - i);
  });
}

/** The most of a peak's height its clipped part is tinted: past that, the shape of the sound still has to read. */
const CLIP_TINT_MAX = 1 / 3;

/**
 * A peak on the timeline as the clip plays it: its file's level (0..1, full scale at 1) times the clip's volume
 * (linear, 1 as is), in px of a band `heightPx` high whose top is full scale. Past full scale it is capped at the top,
 * and `clipPx` of it, from the top, is the part the volume pushed over: the share of the peak cut off, at least 2 px
 * so a peak just over still shows, at most a third of the band. A silent clip (volume 0) is a 1 px line.
 */
export function waveBarPx(peak: number, volume: number, heightPx: number): { barPx: number; clipPx: number } {
  const level = Math.max(0, peak) * Math.max(0, volume);
  const barPx = Math.max(1, Math.min(1, level) * heightPx);
  if (!(level > 1)) return { barPx, clipPx: 0 };
  const clipPx = Math.min(barPx, Math.max(2, Math.min(CLIP_TINT_MAX, 1 - 1 / level) * heightPx));
  return { barPx, clipPx };
}
