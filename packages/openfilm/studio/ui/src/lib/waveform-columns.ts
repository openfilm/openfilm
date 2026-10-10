/**
 * Display normalization. Peaks are absolute amplitudes (0..1): music sitting at -20 dB would draw as a strip a few
 * pixels high, and the waveform is there to show where it sounds, not to be a level meter. So each file is scaled to
 * its own peak — loudness is the Inspector's volume, not the waveform's height.
 *
 * The reference is the 99.5th percentile, not the maximum, so one spike does not flatten the rest. A file that is
 * silent throughout (reference under the noise floor) is returned as is: scaling it up would draw fake noise. The floor
 * is low because quiet pads and soft chimes peak around 0.01 and must still show; true silence quantises to 0–0.001.
 *
 * Normalized per whole file, not per visible slice: two clips of the same file share one scale, and a trim does not
 * make the waveform jump in height.
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
