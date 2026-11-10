// @ts-check
import { installedFontFile } from './fonts.mjs';

/** @typedef {{ css: Record<string, string>, align?: string }} CaptionLook */
/** @typedef {{ name: string, path: string }} DraftFont */

const length = /^(-?(?:\d+(?:\.\d+)?|\.\d+))(cqmin|cqh|cqw|px|em)$/i;
const shorthand = /^(?:(italic|normal)\s+)?(?:(bold|normal|\d{3})\s+)?([\d.]+(?:cqmin|cqh|cqw|px|em))(?:\/[\d.]+)?\s+(.+)$/i;

/** @param {Record<string, string>} css */
function captionFont(css) {
  const [, italic, weight, size, family] = shorthand.exec(css.font ?? '') ?? [];
  return {
    family: css['font-family'] ?? family ?? css['--font'] ?? '',
    size: css['font-size'] ?? size ?? css['--size'] ?? '',
    weight: css['font-weight'] ?? weight ?? css['--weight'],
    italic: (css['font-style'] ?? italic ?? css['--italic']) === 'italic',
  };
}

/** @param {readonly { draftLook?: CaptionLook }[]} cues @returns {Promise<Map<string, DraftFont>>} */
export async function jianyingCaptionFonts(cues) {
  const families = new Set(cues.flatMap((cue) => cue.draftLook ? [captionFont(cue.draftLook.css).family] : []));
  families.delete('');
  /** @type {Map<string, DraftFont>} */
  const fonts = new Map();
  await Promise.all([...families].map(async (family) => {
    const names = (family.match(/"[^"]*"|'[^']*'|[^,]+/g) ?? []).map((name) => name.trim().replace(/^["']|["']$/g, ''));
    const font = await installedFontFile(names);
    if (font) fonts.set(family, font);
  }));
  return fonts;
}

const clamp = (/** @type {number} */ v) => Math.max(0, Math.min(1, v));
const round = (/** @type {number} */ v) => Number(v.toFixed(4));

/** Solid CSS colors written by the inspector and the built-in caption looks. @param {string | undefined} value */
function colorOf(value) {
  const css = value?.trim().toLowerCase();
  if (css === 'transparent' || css === 'none') return { alpha: 0, color: [0, 0, 0] };
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(css ?? '')?.[1];
  if (hex) {
    const digits = hex.length <= 4 ? [...hex].map((ch) => ch + ch).join('') : hex;
    const bytes = digits.match(/../g)?.map((part) => parseInt(part, 16) / 255) ?? [];
    return { alpha: bytes[3] ?? 1, color: bytes.slice(0, 3) };
  }
  const rgb = /^rgba?\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(css ?? '');
  if (rgb) {
    const channel = (/** @type {string} */ v, /** @type {number} */ max) => clamp((parseFloat(v) || 0) / (v.endsWith('%') ? 100 : max));
    return { alpha: rgb[4] == null ? 1 : channel(rgb[4], 1), color: rgb.slice(1, 4).map((v) => channel(v, 255)) };
  }
  if (css === 'white' || css === 'black') return { alpha: 1, color: css === 'white' ? [1, 1, 1] : [0, 0, 0] };
}

/** @param {CaptionLook | undefined} look @param {{ width: number, height: number }} stage @param {ReadonlyMap<string, DraftFont> | undefined} fonts */
export function jianyingCaptionStyle(look, stage, fonts) {
  const css = look?.css ?? {};
  const font = captionFont(css);
  const installed = fonts?.get(font.family);
  const short = Math.min(stage.width, stage.height);
  const m = length.exec(font.size);
  const scale = m?.[2] === 'cqh' ? stage.height / short : m?.[2] === 'cqw' ? stage.width / short : m?.[2] === 'px' ? 100 / short : 1;
  // The draft's size of 14.4 occupies 10% of the short edge in the editor.
  const size = m && m[2] !== 'em' ? Math.max(1, round(Number(m[1]) * scale * 1.44)) : 6;
  const fill = colorOf(css.color ?? css['--color']);
  const stroke = /^(\d*\.?\d+)em\s+(.+)$/.exec(css['-webkit-text-stroke'] ?? '');
  const width = parseFloat(stroke?.[1] ?? css['-webkit-text-stroke-width'] ?? css['--stroke'] ?? (Object.keys(css).length ? '0' : '0.08'));
  const edge = colorOf(stroke?.[2] ?? css['-webkit-text-stroke-color'] ?? css['--stroke-color']) ?? { alpha: 1, color: [0, 0, 0] };
  const strokes = width > 0 && edge.alpha > 0 ? [{ width, content: { render_type: 'solid', solid: edge } }] : [];
  const spacing = parseFloat(css['letter-spacing'] ?? css['--spacing'] ?? '');
  const align = css['text-align'] ?? look?.align;
  return {
    glyph: {
      fill: { alpha: 1, content: { render_type: 'solid', solid: fill ?? { alpha: 1, color: [1, 1, 1] } } },
      size, bold: font.weight === 'bold' || Number(font.weight) >= 600, italic: font.italic, underline: false, strokes,
      ...(installed ? { font: { id: '', path: installed.path } } : {}),
    },
    material: {
      alignment: align === 'left' || align === 'start' ? 0 : align === 'right' || align === 'end' ? 2 : 1,
      check_flag: strokes.length ? 15 : 7,
      letter_spacing: Number.isFinite(spacing) ? spacing : 0,
      ...(installed ? { font_name: installed.name, font_path: installed.path } : {}),
    },
  };
}
