// A film's sound brought to a loudness target (EBU R128), as delivery asks: measured, raised or lowered as a whole,
// its few loudest peaks caught by a limiter rather than the whole film turned down, measured again as encoded.
import { spawn } from 'node:child_process';

/** The targets a film's loudness can be set to, in LUFS. */
export const LOUDNESS_RANGE = /** @type {const} */ ([-70, -5]);
/** The ceiling for true peaks, in dBTP: what delivery specs ask (-1, or lower). */
export const TRUE_PEAK = -1;
/** How far from the target a result may land, in LU. */
export const LOUDNESS_SLACK = 0.5;
/* the limiter works at four times the mix's rate, so it sees the peaks between samples; the encoder adds a little
   (at the mix's own rate, a -1.5 dBFS limit still read -0.4 dBTP after AAC), so it starts 1 dB under the ceiling */
const RATE = 48000;
const OVERSAMPLE = 4;
const HEADROOM = 1;

/** Whether `n` is a loudness target there can be. @param {unknown} n @returns {n is number} */
export const isLoudness = (n) => typeof n === 'number' && Number.isFinite(n) && n >= LOUDNESS_RANGE[0] && n <= LOUDNESS_RANGE[1];

/** @param {string[]} args @param {AbortSignal} [signal] @returns {Promise<string>} ffmpeg's log */
function run(args, signal) {
  return new Promise((done, fail) => {
    if (signal?.aborted) { fail(new Error('cancelled')); return; }
    const p = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-nostats', ...args], { windowsHide: true });
    let log = '';
    p.stderr.on('data', (d) => { log += d; });
    const stop = () => p.kill();
    signal?.addEventListener('abort', stop, { once: true });
    p.on('error', fail);
    p.on('close', (code) => {
      signal?.removeEventListener('abort', stop);
      if (signal?.aborted) fail(new Error('cancelled'));
      else if (code === 0) done(log);
      else fail(new Error(`ffmpeg: ${log.trim().split('\n').at(-1) ?? `exit ${code}`}`));
    });
  });
}

/**
 * How loud a file's sound is: integrated loudness (LUFS) and true peak (dBTP), -Infinity for silence.
 * @param {string} file @param {AbortSignal} [signal] @returns {Promise<{ lufs: number, peak: number }>}
 */
export async function loudnessOf(file, signal) {
  const log = await run(['-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-'], signal);
  const summary = log.slice(log.lastIndexOf('Summary:'));
  const value = (/** @type {RegExp} */ re) => { const v = re.exec(summary)?.[1]; return v == null || v === '-inf' ? -Infinity : Number(v); };
  /* silence measures -70 LUFS, the gate's floor */
  const lufs = value(/I:\s+(-?[\d.]+|-inf) LUFS/);
  return { lufs: lufs <= -70 ? -Infinity : lufs, peak: value(/Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}

/**
 * The mix `from` (a WAV of the film's sound) at `lufs`, its true peaks under `peak`, encoded with `codec` into `to`:
 * measured, then one gain for the whole and a limiter at four times the rate for the peaks it lifts over the ceiling,
 * then measured as encoded; at most twice more when the limiter took off enough to miss the target, or a peak passed.
 * Silence is encoded as it is. `before` and `after` are as measured.
 * @param {string} from @param {string} to @param {string[]} codec ffmpeg's options for the sound (`-c:a aac -b:a 192k`)
 * @param {{ lufs: number, peak?: number, signal?: AbortSignal }} target
 * @returns {Promise<{ before: { lufs: number, peak: number }, after: { lufs: number, peak: number } }>}
 */
export async function toLoudness(from, to, codec, { lufs, peak = TRUE_PEAK, signal }) {
  const before = await loudnessOf(from, signal);
  const encode = (/** @type {string} */ af) => run(['-v', 'error', '-y', '-i', from, ...(af ? ['-af', af] : []), ...codec, '-ar', String(RATE), to], signal);
  if (!Number.isFinite(before.lufs)) { await encode(''); return { before, after: before }; }
  let gain = lufs - before.lufs;
  let ceiling = peak - HEADROOM;
  let after = before;
  for (let pass = 0; pass < 3; pass += 1) {
    await encode(`aresample=${RATE * OVERSAMPLE},volume=${gain.toFixed(2)}dB,alimiter=limit=${(10 ** (ceiling / 20)).toFixed(4)}:attack=3:release=60:level=false:asc=1,aresample=${RATE}`);
    after = await loudnessOf(to, signal);
    if (Math.abs(after.lufs - lufs) <= LOUDNESS_SLACK && after.peak <= peak) break;
    gain += lufs - after.lufs;
    if (after.peak > peak) ceiling -= after.peak - peak + 0.1;
  }
  return { before, after };
}

/** A loudness as a line says it. @param {{ lufs: number, peak: number }} l */
export const loudnessText = (l) => `${Number.isFinite(l.lufs) ? l.lufs.toFixed(1) : '-inf'} LUFS · true peak ${Number.isFinite(l.peak) ? l.peak.toFixed(1) : '-inf'} dBTP`;
