export type BeautyKey =
  | 'smooth'
  | 'light'
  | 'warm'
  | 'rosy'
  | 'detail'
  | 'even'
  | 'darkCircles'
  | 'eyeBright'
  | 'teeth'
  | 'slim'
  | 'jaw'
  | 'chin'
  | 'eyes'
  | 'nose'
  | 'lip'
  | 'blush'
  | 'shadow'
  | 'blemish'
  | 'highlights';
export type VideoEffects = Record<BeautyKey, number> & {
  cutout: boolean;
  mode: number;
  edge: number;
  shrink: number;
  despill: number;
  keyTolerance: number;
  keySoftness: number;
  keyColor: string;
  lipColor: string;
  blushColor: string;
  shadowColor: string;
  quality: number;
  texture: number;
  protectGlasses: number;
  bypass: boolean;
};
export const BEAUTY_KEYS: readonly BeautyKey[];
export const VISION_DEFAULTS: Readonly<
  Record<Exclude<keyof VideoEffects, 'keyColor' | 'lipColor' | 'blushColor' | 'shadowColor'>, number>
>;
export const VISION_PROPERTIES: Readonly<
  Record<Exclude<keyof VideoEffects, 'keyColor' | 'lipColor' | 'blushColor' | 'shadowColor'>, string>
>;
export function videoEffects(read: (property: string) => string | undefined): VideoEffects;
export function hasBeauty(value: VideoEffects): boolean;
export function faceMaskKey(value: VideoEffects): string;
export function hasVideoEffects(value: VideoEffects): boolean;
export function reuseAnalysis(before: number, time: number, playing: boolean, mode?: number): boolean;
export function analysisKey(src: string, time: number, beauty: boolean): string;
export class AnalysisCache<T = unknown> {
  constructor(maxBytes?: number);
  bytes: number;
  get(key: string): T | null;
  set(key: string, value: T, bytes: number): void;
}
