/** Ordinary clip CSS is the single source of truth for preview, undo, saved projects and export. */
export const BEAUTY_KEYS = Object.freeze([
  'smooth',
  'light',
  'warm',
  'rosy',
  'detail',
  'even',
  'darkCircles',
  'eyeBright',
  'teeth',
  'slim',
  'jaw',
  'chin',
  'eyes',
  'nose',
  'lip',
  'blush',
  'shadow',
  'blemish',
  'highlights',
]);
export const VISION_DEFAULTS = Object.freeze({
  cutout: 0,
  mode: 1,
  edge: 0.25,
  shrink: 0,
  despill: 0.35,
  keyTolerance: 0.25,
  keySoftness: 0.15,
  ...Object.fromEntries(BEAUTY_KEYS.map((key) => [key, 0])),
  quality: 0,
  texture: 0.6,
  protectGlasses: 1,
  bypass: 0,
});
export const VISION_PROPERTIES = Object.freeze(
  Object.fromEntries(
    Object.keys(VISION_DEFAULTS).map((key) => [
      key,
      key === 'bypass'
        ? '--of-vision-bypass'
        : ['cutout', 'mode', 'edge', 'shrink', 'despill', 'keyTolerance', 'keySoftness'].includes(key)
          ? `--of-cutout${key === 'cutout' ? '' : `-${key.replace(/[A-Z]/g, (s) => `-${s.toLowerCase()}`)}`}`
          : `--of-beauty-${key.replace(/[A-Z]/g, (s) => `-${s.toLowerCase()}`)}`,
    ]),
  ),
);
const hexColor = (value, fallback) => {
  const color = value?.trim();
  if (/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color ?? '')) return color.slice(0, 7);
  if (/^#[0-9a-f]{3}$/i.test(color ?? ''))
    return (
      '#' +
      color
        .slice(1)
        .split('')
        .map((c) => c + c)
        .join('')
    );
  return fallback;
};
export function videoEffects(read) {
  const value = Object.fromEntries(
    Object.entries(VISION_DEFAULTS).map(([key, fallback]) => {
      const n = Number.parseFloat(read(VISION_PROPERTIES[key]) ?? '');
      return [
        key,
        Number.isFinite(n)
          ? Math.min(key === 'mode' ? 4 : 1, Math.max(['warm', 'shrink', 'chin'].includes(key) ? -1 : 0, n))
          : fallback,
      ];
    }),
  );
  const color = read('--of-cutout-color')?.trim();
  return {
    ...value,
    mode: Math.round(value.mode),
    cutout: value.cutout >= 0.5,
    bypass: value.bypass >= 0.5,
    keyColor: hexColor(color, '#00ff00'),
    ...Object.fromEntries(
      [
        ['lipColor', '#a62138'],
        ['blushColor', '#c45970'],
        ['shadowColor', '#72505b'],
      ].map(([key, fallback]) => {
        const value = read(`--of-beauty-${key.replace(/[A-Z]/g, (s) => `-${s.toLowerCase()}`)}`)?.trim();
        return [key, hexColor(value, fallback)];
      }),
    ),
  };
}
export const hasBeauty = (value) => BEAUTY_KEYS.some((key) => Math.abs(value[key] ?? 0) > 0);
export const faceMaskKey = (value) => `${value.quality ?? 0}:` + BEAUTY_KEYS.map((key) => (Math.abs(value[key] ?? 0) > 0 ? 1 : 0)).join('');
export const hasVideoEffects = (value) => !value.bypass && (value.cutout || hasBeauty(value));
/** Quality modes analyze the actual frame. Only explicit fast preview can reuse for at most one 30fps frame. */
export const reuseAnalysis = (before, time, playing, mode = 0) =>
  mode === 0 && playing && time >= before && time - before <= 1 / 30;
export function analysisKey(src, time, beauty) {
  return `${src}\0${Math.round(time * 1000000)}\0${beauty ? 1 : 0}`;
}
export class AnalysisCache {
  constructor(maxBytes = 48 * 1024 * 1024) {
    this.maxBytes = maxBytes;
    this.bytes = 0;
    this.items = new Map();
  }
  get(key) {
    const item = this.items.get(key);
    if (!item) return null;
    this.items.delete(key);
    this.items.set(key, item);
    return item.value;
  }
  set(key, value, bytes) {
    const old = this.items.get(key);
    if (old) {
      this.bytes -= old.bytes;
      this.items.delete(key);
    }
    if (bytes > this.maxBytes) return;
    this.items.set(key, { value, bytes });
    this.bytes += bytes;
    while (this.bytes > this.maxBytes) {
      const first = this.items.keys().next().value;
      this.bytes -= this.items.get(first).bytes;
      this.items.delete(first);
    }
  }
}
