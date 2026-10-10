/**
 * What the stage (the web page, through the bridge) reports to the editor about the thing in hand, and the few
 * value helpers both sides read it with. The inspector and the stage code share these shapes; the DOM work behind
 * them lives with the stage.
 */

/** Which kind of layer inside a page: text, a picture (img/video/canvas), an SVG shape, a box that paints. */
export type StageNodeKind = 'text' | 'image' | 'shape' | 'box';

export type StageStyleValue = string | number;
export type StageElementStyle = Record<string, StageStyleValue | undefined>;

/** A clip's box as the stage handles it: its top left, its size over the picture's own per axis, its turn in degrees. */
export type MgTransform = {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
};

/** A clip's picture at its own size `w` × `h`, from `x` / `y` (the stage's top left by default). */
export type MgBox = { w: number; h: number; x?: number; y?: number };

/** An ancestor layer in the same clip, for the breadcrumb. */
export interface StageNodeParent {
  loc: string;
  label: string;
  kind: StageNodeKind;
}

/** A layer's override as painted now (film.html `overrides`, see film-doc's FilmOverride). */
export interface NodeOverride {
  t?: [number, number];
  /** One factor, or `[x, y]`. */
  s?: number | [number, number];
  r?: number;
  /** Style keys applied as an override. */
  style?: Record<string, string | number>;
  lock?: boolean;
  /** Replacement text. */
  text?: string;
}

/**
 * The point that stays put when a layer is scaled or turned: the center, or a corner / edge of its unrotated box.
 * `hx` / `hy` place it in the box, -1 / 0 / 1.
 */
export type OverridePivot = { hx: -1 | 0 | 1; hy: -1 | 0 | 1 };

/** What is selected on the stage: a whole clip, or a layer inside one. */
export type StageElement = {
  kind: 'clip' | StageNodeKind;
  /** Where it comes from (the layer's address); used to find it again after the page reloads. */
  loc: string | null;
  label: string;
  /** The film.html clip it is in. */
  clipLoc?: string;
  /** That clip's film.html `id` (like `hello`): what a person calls it, not its position. */
  clipId?: string;
  clipKind?: string;
  isMgOuter?: boolean;
  transform?: MgTransform;
  /** The picture's own size: the clip's numbers (`transform`) are worked out from it. */
  mgBox?: MgBox;
  /**
   * The words on this layer, when it holds some: editing them needs what was written before. `shape` says how
   * they are held (`value`: worked out, not written as one piece).
   */
  text?: { loc: string; value: string; shape: 'children' | 'prop' | 'value' };
  /** Attributes written as literals (`fill`, `strokeWidth`, `src`): the only ones the panel can change. */
  attrs?: Record<string, string>;
  /** Outer layers, nearest first. */
  parents?: readonly StageNodeParent[];
  /** This layer's override now. */
  override?: NodeOverride | null;
  tag?: string;
  /** The layer's computed style; `declaredStyle` lists the keys its own code sets. */
  style?: StageElementStyle;
  declaredStyle?: readonly string[];
  /** When a list renders several copies: which one was picked, and how many there are. */
  instance?: number;
  instances?: number;
};

/** Where the thing in hand is on the stage now, in stage px. */
export interface StageGeometry {
  /** `group`: several layers selected together, their union box. */
  kind: 'layer' | 'clip' | 'group';
  /** The layer's loc, or the clip's: the inspector checks it is still the thing it shows. */
  loc: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  /** Override offset units per stage px. */
  unit: number;
  /**
   * How far the layer's ancestors are turned (the clip, an outer card). An offset is written in the parent's
   * coordinates, so a stage X / Y has to be turned back by this; `r` is the layer's own angle without it.
   */
  parentR?: number;
  /** A clip's picture at its own size: typed numbers are worked out from it. */
  box?: MgBox;
  /** A group: how many layers, and of which kinds. */
  group?: { n: number; kinds: readonly StageNodeKind[] };
  stage: { w: number; h: number };
}

/** A style value as a number, when it is one (`12`, `"12"`, `"12px"`). */
export function asNumber(value: string | number | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const m = /^(-?[\d.]+)(?:px)?$/.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

const SVG_TEXT_TAGS = new Set(['text', 'tspan', 'textpath']);

/** The SVG tags that hold text. By name only: the caller makes sure it really is in an SVG. */
export function isSvgTextTag(tag: string): boolean {
  return SVG_TEXT_TAGS.has(tag.toLowerCase());
}

/** A loc without its copy number (`a.tsx:12:5#2` → `a.tsx:12:5`): the address of every copy. */
export function sourceLocBare(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/#\d+$/, '');
}

/** An override's scale as `[x, y]`. */
export function scalePair(s: number | readonly [number, number] | null | undefined): [number, number] {
  if (Array.isArray(s)) return [s[0] ?? 1, s[1] ?? 1];
  return typeof s === 'number' && s > 0 ? [s, s] : [1, 1];
}

/** Both axes alike → one number (`s: 1.2` reads better than `[1.2, 1.2]`). Four decimals: 320 → 500 is 1.5625. */
export function compactScale(sx: number, sy: number): number | [number, number] {
  const r = (n: number) => Math.round(n * 10000) / 10000;
  return r(sx) === r(sy) ? r(sx) : [r(sx), r(sy)];
}
