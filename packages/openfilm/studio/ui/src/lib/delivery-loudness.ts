/**
 * The loudness a film is delivered at: the export's choice (LUFS, true peaks under -1 dBTP; null: as mixed), -14 until
 * the person picks another. The preview turns the film's sound by the same amount and catches its peaks the same way
 * (editor/player `setDelivery`), so what is heard while editing is what the export gives.
 *
 * Kept with the export's settings (components/export/ExportCenter, `openfilm.exportCenter.v1`); a change is told to
 * this window at once, and to Studio's other windows through the storage event.
 */
export const DELIVERY_LOUDNESS = -14;
const STORE_KEY = 'openfilm.exportCenter.v1';
const EVENT = 'openfilm:delivery-loudness';

/** The export's video settings as kept, for its loudness (none kept: the default). */
export function deliveryLoudness(): number | null {
  try {
    const video = (JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null') as { video?: { loudness?: unknown; loudnessChosen?: unknown } } | null)?.video;
    return keptLoudness(video?.loudness, video?.loudnessChosen === true);
  } catch { return DELIVERY_LOUDNESS; }
}

/**
 * A kept loudness as it is meant: a number is a target; null is "as mixed" only when the person picked it (before
 * the default was a target, every export kept null without being asked).
 */
export function keptLoudness(loudness: unknown, chosen: boolean): number | null {
  if (typeof loudness === 'number' && Number.isFinite(loudness)) return loudness;
  return loudness === null && chosen ? null : DELIVERY_LOUDNESS;
}

/** Tell the preview the delivery loudness changed (the export's settings were saved). */
export function announceDeliveryLoudness() {
  window.dispatchEvent(new Event(EVENT));
}

/** Hear of the delivery loudness changing, here or in another window. */
export function onDeliveryLoudness(fn: (lufs: number | null) => void): () => void {
  const told = () => fn(deliveryLoudness());
  const stored = (e: StorageEvent) => { if (e.key === STORE_KEY) told(); };
  window.addEventListener(EVENT, told);
  window.addEventListener('storage', stored);
  return () => { window.removeEventListener(EVENT, told); window.removeEventListener('storage', stored); };
}

/**
 * How far the preview turns the mix (dB) to be heard at the delivery loudness: none when it is delivered as mixed, or
 * the mix has not been measured (or is silent). Held within ±24 dB.
 */
export function deliveryGainDb(target: number | null, mixed: number | null | undefined): number {
  if (target == null || mixed == null || !Number.isFinite(mixed)) return 0;
  return Math.max(-24, Math.min(24, target - mixed));
}
