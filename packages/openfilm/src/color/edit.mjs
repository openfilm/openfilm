// @ts-check
/**
 * Changing a color transform file (.ctf) the way a grader's tool does: one operation at a time, found by its `name`
 * attribute, written back in place, and nothing else in the file touched. A grade layer is a ProcessList whose
 * operations OpenFilm's tools name for what they do (`balance`, `match`, `primary`, `curves`…); a file written by
 * another program or by hand keeps every operation and every comment of its own.
 *
 * The operations OpenFilm writes are those a grade is made of, in OpenColorIO's Common Transform Format: ASC_CDL,
 * GradingPrimary, GradingTone, GradingRGBCurve and GradingHueCurve. Each is written with only the values that differ
 * from its default, as OpenColorIO writes it, and reads back (ctf.mjs) as the same operation. A file OpenFilm makes
 * says version 2.5: the first CTF version whose readers take GradingHueCurve.
 */

/** The CTF version of a file OpenFilm makes. */
export const CTF_VERSION = '2.5';

/** A number as a file keeps it: up to 7 significant digits, no trailing zeros. @param {number} v */
const num = (v) => {
  if (!Number.isFinite(v)) throw new Error(`a color value is not a number: ${v}`);
  const s = Number(v.toPrecision(7)).toString();
  return s === '-0' ? '0' : s;
};
const escape = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A new grade layer: an empty ProcessList named `id`, said in a line by `description`. @param {string} id @param {string} [description] */
export function newCtf(id, description = '') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<ProcessList version="${CTF_VERSION}" id="${escape(id)}">
${description ? `    <Description>${escape(description)}</Description>\n` : ''}</ProcessList>
`;
}

/** @typedef {{ r: number, g: number, b: number }} Rgb @typedef {Rgb & { m: number }} Rgbm */

/**
 * An ASC CDL: slope, offset and power for red, green and blue, then saturation. On ACEScct (a grade layer's space),
 * its offset is what a colorist calls printer lights: an exposure and white balance move of the light itself.
 * @param {string} name @param {{ slope?: number[], offset?: number[], power?: number[], saturation?: number }} cdl
 */
export function cdlXml(name, { slope = [1, 1, 1], offset = [0, 0, 0], power = [1, 1, 1], saturation = 1 }) {
  return `    <ASC_CDL name="${escape(name)}" inBitDepth="32f" outBitDepth="32f" style="FwdNoClamp">
        <SOPNode>
            <Slope>${slope.map(num).join(' ')}</Slope>
            <Offset>${offset.map(num).join(' ')}</Offset>
            <Power>${power.map(num).join(' ')}</Power>
        </SOPNode>
        <SatNode>
            <Saturation>${num(saturation)}</Saturation>
        </SatNode>
    </ASC_CDL>`;
}

const same = (/** @type {Rgbm} */ a, /** @type {Rgbm} */ b) => a.r === b.r && a.g === b.g && a.b === b.b && a.m === b.m;
const rgbmXml = (/** @type {string} */ tag, /** @type {Rgbm} */ v, extra = '') => `        <${tag} rgb="${num(v.r)} ${num(v.g)} ${num(v.b)}" master="${num(v.m)}"${extra} />`;

/**
 * A GradingPrimary in its log style (ACEScct): brightness (an offset), contrast and gamma, each a master with red,
 * green and blue, about the contrast pivot; and saturation. Values at their defaults are left out.
 * @param {string} name
 * @param {{ brightness?: Rgbm, contrast?: Rgbm, gamma?: Rgbm, saturation?: number, pivot?: number }} p
 */
export function primaryXml(name, p) {
  const zero = { r: 0, g: 0, b: 0, m: 0 }, one = { r: 1, g: 1, b: 1, m: 1 };
  const lines = [];
  if (p.brightness && !same(p.brightness, zero)) lines.push(rgbmXml('Brightness', p.brightness));
  if (p.contrast && !same(p.contrast, one)) lines.push(rgbmXml('Contrast', p.contrast));
  if (p.gamma && !same(p.gamma, one)) lines.push(rgbmXml('Gamma', p.gamma));
  if (p.saturation !== undefined && p.saturation !== 1) lines.push(`        <Saturation master="${num(p.saturation)}" />`);
  if (p.pivot !== undefined && p.pivot !== -0.2) lines.push(`        <Pivot contrast="${num(p.pivot)}" />`);
  return `    <GradingPrimary name="${escape(name)}" inBitDepth="32f" outBitDepth="32f" style="log">
${lines.join('\n')}${lines.length ? '\n' : ''}    </GradingPrimary>`;
}

/** The log style's tone zones and their defaults (OpenColorIO's GradingTone(log)); the attribute each writes its width as. */
const TONE = /** @type {Record<string, { start: number, width: number, startAs: string, widthAs: string }>} */ ({
  blacks: { start: 0.4, width: 0.4, startAs: 'start', widthAs: 'width' },
  shadows: { start: 0.5, width: 0, startAs: 'start', widthAs: 'pivot' },
  midtones: { start: 0.4, width: 0.6, startAs: 'center', widthAs: 'width' },
  highlights: { start: 0.3, width: 1, startAs: 'start', widthAs: 'pivot' },
  whites: { start: 0.4, width: 0.5, startAs: 'start', widthAs: 'width' },
});

/**
 * A GradingTone in its log style: blacks, shadows, midtones, highlights and whites, each a master with red, green and
 * blue (1: as it is), where it starts and how wide it is (OpenColorIO's defaults where left out); and s-contrast.
 * @param {string} name
 * @param {Partial<Record<'blacks' | 'shadows' | 'midtones' | 'highlights' | 'whites', Rgbm & { start?: number, width?: number }>> & { scontrast?: number }} t
 */
export function toneXml(name, t) {
  const lines = [];
  for (const [zone, d] of Object.entries(TONE)) {
    const v = /** @type {(Rgbm & { start?: number, width?: number }) | undefined} */ (t[/** @type {keyof typeof t} */ (zone)]);
    if (!v) continue;
    const start = v.start ?? d.start, width = v.width ?? d.width;
    if (same(v, { r: 1, g: 1, b: 1, m: 1 }) && start === d.start && width === d.width) continue;
    const tag = zone[0].toUpperCase() + zone.slice(1);
    lines.push(rgbmXml(tag, v, ` ${d.startAs}="${num(start)}" ${d.widthAs}="${num(width)}"`));
  }
  if (t.scontrast !== undefined && t.scontrast !== 1) lines.push(`        <SContrast master="${num(t.scontrast)}" />`);
  return `    <GradingTone name="${escape(name)}" inBitDepth="32f" outBitDepth="32f" style="log">
${lines.join('\n')}${lines.length ? '\n' : ''}    </GradingTone>`;
}

/** @typedef {{ points: [number, number][], slopes?: number[] }} Curve */
const curveXml = (/** @type {string} */ tag, /** @type {Curve} */ c) => `        <${tag}>
            <ControlPoints>
${c.points.map(([x, y]) => `                ${num(x)} ${num(y)}`).join('\n')}
            </ControlPoints>${c.slopes?.some((s) => s !== 0) ? `
            <Slopes>${c.slopes.map(num).join(' ')}</Slopes>` : ''}
        </${tag}>`;

/** Points of a curve that changes nothing: the identity in ACEScct's log style. */
const STRAIGHT = /** @type {[number, number][]} */ ([[0, 0], [0.5, 0.5], [1, 1]]);
const straight = (/** @type {Curve} */ c) => c.points.length === 3 && c.points.every(([x, y], i) => x === STRAIGHT[i][0] && y === STRAIGHT[i][1]) && !c.slopes?.some((s) => s !== 0);

/**
 * A GradingRGBCurve in its log style: curves for red, green, blue and all three (master), each its control points
 * (x and y, ACEScct) and, optionally, its slopes. A straight one is left out.
 * @param {string} name @param {Partial<Record<'red' | 'green' | 'blue' | 'master', Curve>>} curves
 */
export function rgbCurveXml(name, curves) {
  const lines = ['red', 'green', 'blue', 'master'].flatMap((k) => {
    const c = curves[/** @type {'red'} */ (k)];
    return c && !straight(c) ? [curveXml(k[0].toUpperCase() + k.slice(1), c)] : [];
  });
  return `    <GradingRGBCurve name="${escape(name)}" inBitDepth="32f" outBitDepth="32f" style="log">
${lines.join('\n')}${lines.length ? '\n' : ''}    </GradingRGBCurve>`;
}

/** Hue curves by their CTF element: hue against hue, saturation and luma; luma and saturation against saturation, … */
const HUE_TAGS = /** @type {Record<string, string>} */ ({ hueHue: 'HueHue', hueSat: 'HueSat', hueLum: 'HueLum', lumSat: 'LumSat', satSat: 'SatSat', lumLum: 'LumLum', satLum: 'SatLum', hueFx: 'HueFx' });

/**
 * A GradingHueCurve in its log style: each curve given (x across, 0–1; y the hue, or a gain where 1 is as it is).
 * Curves not given are left as they are.
 * @param {string} name @param {Partial<Record<keyof typeof HUE_TAGS, Curve>>} curves
 */
export function hueCurveXml(name, curves) {
  const lines = Object.entries(HUE_TAGS).flatMap(([k, tag]) => {
    const c = curves[/** @type {keyof typeof curves} */ (k)];
    return c ? [curveXml(tag, c)] : [];
  });
  return `    <GradingHueCurve name="${escape(name)}" inBitDepth="32f" outBitDepth="32f" style="log">
${lines.join('\n')}${lines.length ? '\n' : ''}    </GradingHueCurve>`;
}

/**
 * The top-level elements of a ProcessList: each one's tag, `name` attribute and where it is in the text (from its
 * `<` to just past its end). A small reader of its own: it only needs to tell elements apart at depth one.
 * @param {string} text @returns {{ tag: string, name: string | null, from: number, to: number }[]}
 */
export function elementsOf(text) {
  const out = [];
  const open = /<ProcessList\b[^>]*>/i.exec(text);
  if (!open) throw new Error('not a color transform file: no <ProcessList>');
  let i = open.index + open[0].length;
  let depth = 0;
  /** @type {{ tag: string, name: string | null, from: number } | null} */
  let current = null;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) { const end = text.indexOf('-->', lt); i = end < 0 ? text.length : end + 3; continue; }
    if (text.startsWith('<![CDATA[', lt)) { const end = text.indexOf(']]>', lt); i = end < 0 ? text.length : end + 3; continue; }
    const gt = text.indexOf('>', lt);
    if (gt < 0) break;
    const tag = text.slice(lt + 1, gt);
    if (tag.startsWith('/')) {
      if (depth === 0) break; /* </ProcessList> */
      depth--;
      if (depth === 0 && current) { out.push({ ...current, to: gt + 1 }); current = null; }
    } else if (!tag.startsWith('?')) {
      const self = tag.endsWith('/');
      if (depth === 0) {
        const name = /\bname\s*=\s*"([^"]*)"/.exec(tag)?.[1] ?? null;
        current = { tag: /^[\w:-]+/.exec(tag)?.[0] ?? '', name, from: lt };
      }
      if (self) { if (depth === 0 && current) { out.push({ ...current, to: gt + 1 }); current = null; } } else depth++;
    }
    i = gt + 1;
  }
  return out;
}

/**
 * `text` with its top-level operation named `name` replaced by `xml` (an element, as the writers above give it),
 * added at the end when there is none, or taken out when `xml` is null. `before`: the name of an operation the new
 * one goes in front of, when it is added and that one is there. Everything else in the file stays as it was.
 * @param {string} text @param {string} name @param {string | null} xml @param {{ before?: string }} [where]
 */
export function setOp(text, name, xml, { before } = {}) {
  const els = elementsOf(text);
  const at = els.find((e) => e.name === name);
  if (at) {
    const lineStart = text.lastIndexOf('\n', at.from - 1) + 1;
    const indented = /^[ \t]*$/.test(text.slice(lineStart, at.from));
    const from = indented ? lineStart : at.from;
    const to = indented && text[at.to] === '\n' ? at.to + 1 : at.to;
    return text.slice(0, from) + (xml ? `${xml}\n` : '') + text.slice(to);
  }
  if (!xml) return text;
  const next = before ? els.find((e) => e.name === before) : null;
  const point = next ? text.lastIndexOf('\n', next.from - 1) + 1 : text.search(/[ \t]*<\/ProcessList>/i);
  if (point < 0) throw new Error('not a color transform file: no </ProcessList>');
  return `${text.slice(0, point)}${xml}\n${text.slice(point)}`;
}
