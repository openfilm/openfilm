/**
 * The audio meters' arithmetic: a channel's peak and RMS level from its latest samples, in dBFS, how a meter falls
 * back after a peak (ballistics), the scale it is drawn on, and when a channel clipped.
 */

/** The bottom of the meter: quieter is drawn as nothing. */
export const METER_FLOOR_DB = -60;
/** The marks on the scale, dBFS. */
export const METER_MARKS = [0, -6, -12, -18, -24, -30, -36, -42, -48, -54] as const;
/** A sample at or past this (0 dBFS, give or take rounding) clipped. */
export const CLIP_LEVEL = 0.999;
/** How fast a meter falls after a peak, dB a second (the PPM's 20 dB in 1.7 s, near enough). */
export const FALL_DB_PER_S = 12;
/** How long the peak mark stays before it falls, ms. */
export const PEAK_HOLD_MS = 1500;

export type ChannelLevel = { peakDb: number; rmsDb: number; clipped: boolean };

const toDb = (v: number) => (v > 0 ? Math.max(METER_FLOOR_DB, 20 * Math.log10(v)) : METER_FLOOR_DB);

/** One channel's level from its samples (−1…1). */
export function channelLevel(samples: ArrayLike<number>): ChannelLevel {
  let peak = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]!;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
    sum += v * v;
  }
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  return { peakDb: toDb(peak), rmsDb: toDb(rms), clipped: peak >= CLIP_LEVEL };
}

/** Where a level sits on the meter, 0 (the floor) to 1 (0 dBFS). */
export function meterPosition(db: number): number {
  if (!(db > METER_FLOOR_DB)) return 0;
  return Math.min(1, (db - METER_FLOOR_DB) / -METER_FLOOR_DB);
}

/** What the meter shows next: up at once to a louder level, down no faster than FALL_DB_PER_S. */
export function fallTo(shown: number, now: number, elapsedMs: number): number {
  if (now >= shown) return now;
  return Math.max(now, shown - (FALL_DB_PER_S * elapsedMs) / 1000);
}

/** A held peak: the loudest of late, `db` set at `at` (ms); what it shows at `nowMs` given the level `now`. */
export type HeldPeak = { db: number; at: number };

/** The peak mark: kept PEAK_HOLD_MS, then falling as the meter does; a louder level takes its place at once. */
export function holdPeak(held: HeldPeak, now: number, nowMs: number): HeldPeak & { shown: number } {
  const fallen = held.db - (FALL_DB_PER_S * Math.max(0, nowMs - held.at - PEAK_HOLD_MS)) / 1000;
  if (now >= fallen) return { db: now, at: nowMs, shown: now };
  return { ...held, shown: fallen };
}

/** A level as the meter's readout writes it: `-6.0`, `-∞` under the floor. */
export function formatDb(db: number): string {
  return db <= METER_FLOOR_DB ? '-∞' : db.toFixed(1);
}
