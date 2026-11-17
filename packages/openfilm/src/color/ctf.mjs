// @ts-check
/**
 * Color transform files: what a film's grade is made of. A grade is an ordered list of files on a clip; each is
 * OpenColorIO's Common Transform Format (.ctf, a superset of the Academy/ASC CLF), a .clf, or an Iridas .cube. This
 * reads one into a plain list of ops (ops.mjs evaluates them). Plain JavaScript with no dependencies and no file
 * reading, so a browser Worker imports it as it is.
 *
 *   parseColorTransform(text, name) → ops, by the name's extension (.ctf, .clf or .cube)
 *   parseCtf(text, { clf })         → ops of a .ctf or .clf text
 *   parseCube(text)                 → ops of a .cube text (1D or 3D, DOMAIN_MIN/MAX)
 *
 * The reference is OpenColorIO 2.6: element and attribute names, defaults and validation follow its CTF reader
 * (src/OpenColorIO/fileformats/ctf/CTFReaderHelper.cpp, CTFReaderUtils.h, FileFormatCTF.cpp, xmlutils/) and the
 * op data classes it fills (ops/<op>/<Op>OpData.cpp, GradingPrimary.cpp, GradingTone.cpp, GradingBSplineCurve.cpp);
 * the .cube reader follows fileformats/FileFormatIridasCube.cpp. Names are matched without regard to case, as OCIO
 * does. Parameters come out normalized: bit depths other than 32f only scale the parameters of the ops OCIO scales
 * (Matrix, Range, LUT1D, LUT3D), and every op works on normalized float values, as OCIO's processor does.
 *
 * An op is { type, ... }; the fields of each type are described where it is read (read* below). Anything the
 * evaluator cannot do (an inverse LUT, an IndexMap, a Reference, an unknown element or style) is an Error naming it,
 * never a silently skipped op.
 */

import { HUE_CURVE_SPLINE, validateCurve } from './bspline.mjs';

/** The largest 1D and 3D LUTs OCIO reads (LutLimits.h). */
const MAX_LUT1D = 300000;
const MAX_LUT3D = 129;

/** Elements of a ProcessList (or of an op) that only describe it. */
const METADATA = new Set(['description', 'inputdescriptor', 'outputdescriptor', 'info', 'id', 'dynamicparameter']);

/**
 * A color transform file's ops, read by its name's extension.
 * @param {string} text
 * @param {string} name the file's name or path
 */
export function parseColorTransform(text, name) {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === 'cube') return parseCube(text);
  if (ext === 'ctf') return parseCtf(text);
  if (ext === 'clf') return parseCtf(text, { clf: true });
  throw new Error(`${name}: not a color transform file (.ctf, .clf or .cube)`);
}

// ---------------------------------------------------------------------------------------------------------------
// A small XML reader: elements, attributes, text. Comments, processing instructions and a DOCTYPE are skipped.

/** @typedef {{ name: string, key: string, attrs: Record<string, string>, children: XmlElement[], text: string, line: number }} XmlElement */

const ENTITIES = /** @type {Record<string, string>} */ ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" });

/** @param {string} s */
function decodeEntities(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (whole, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e.toLowerCase()] ?? whole;
  });
}

/**
 * The document's root element.
 * @param {string} text
 * @returns {XmlElement}
 */
function readXml(text) {
  /** @type {XmlElement[]} */
  const stack = [];
  /** @type {XmlElement | null} */
  let root = null;
  let i = 0;
  const lineAt = (/** @type {number} */ at) => text.slice(0, at).split('\n').length;
  /** @type {(message: string, at: number) => never} */
  const fail = (message, at) => {
    throw new Error(`XML line ${lineAt(at)}: ${message}`);
  };
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    const chunk = text.slice(i, lt < 0 ? text.length : lt);
    if (stack.length) stack[stack.length - 1].text += decodeEntities(chunk);
    else if (chunk.trim() && root) fail('text after the root element', i);
    if (lt < 0) break;
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end < 0) fail('unclosed comment', lt);
      i = end + 3;
    } else if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      if (end < 0) fail('unclosed CDATA', lt);
      if (stack.length) stack[stack.length - 1].text += text.slice(lt + 9, end);
      i = end + 3;
    } else if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      if (end < 0) fail('unclosed processing instruction', lt);
      i = end + 2;
    } else if (text.startsWith('<!', lt)) {
      const end = text.indexOf('>', lt + 2);
      if (end < 0) fail('unclosed declaration', lt);
      i = end + 1;
    } else if (text[lt + 1] === '/') {
      const end = text.indexOf('>', lt);
      if (end < 0) fail('unclosed end tag', lt);
      const name = text.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (!open || open.name !== name) fail(`</${name}> does not close <${open?.name ?? ''}>`, lt);
      i = end + 1;
    } else {
      const tag = /^<([A-Za-z_][\w.:-]*)/.exec(text.slice(lt, lt + 200));
      if (!tag) fail('malformed tag', lt);
      /** @type {XmlElement} */
      const el = { name: tag[1], key: tag[1].toLowerCase(), attrs: {}, children: [], text: '', line: lineAt(lt) };
      let j = lt + tag[0].length;
      const attr = /\s*([A-Za-z_][\w.:-]*)\s*=\s*("([^"]*)"|'([^']*)')|\s*(\/?)>/y;
      for (;;) {
        attr.lastIndex = j;
        const m = attr.exec(text);
        if (!m) fail(`malformed attributes in <${el.name}>`, j);
        j = attr.lastIndex;
        if (m[1] === undefined) {
          if (stack.length) stack[stack.length - 1].children.push(el);
          else if (root) fail('a second root element', lt);
          else root = el;
          if (m[5] !== '/') stack.push(el);
          break;
        }
        el.attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4]);
      }
      i = j;
    }
  }
  if (stack.length) fail(`<${stack[stack.length - 1].name}> is not closed`, text.length);
  if (!root) throw new Error('XML: no root element');
  return root;
}

// ---------------------------------------------------------------------------------------------------------------
// Values

/**
 * The numbers in a text, separated by white space or commas (OCIO's GetNumbers).
 * @param {string} text
 * @param {string} where what the numbers are, for the error
 */
function numbers(text, where) {
  const out = [];
  for (const token of text.split(/[\s,]+/)) {
    if (!token) continue;
    const t = token.toLowerCase();
    const v = t === 'nan' ? NaN : t === 'inf' || t === '+inf' || t === 'infinity' ? Infinity
      : t === '-inf' || t === '-infinity' ? -Infinity : Number(token);
    if (Number.isNaN(v) && t !== 'nan') throw new Error(`${where}: '${token}' is not a number`);
    out.push(v);
  }
  return out;
}

/**
 * One number attribute, or `fallback` when it is absent.
 * @param {XmlElement} el
 * @param {string} name
 * @param {number} [fallback]
 */
function scalarAttr(el, name, fallback) {
  const raw = el.attrs[name.toLowerCase()];
  if (raw === undefined) {
    if (fallback === undefined) throw new Error(`<${el.name}> (line ${el.line}) needs the attribute '${name}'`);
    return fallback;
  }
  const v = numbers(raw, `<${el.name}> ${name}`);
  if (v.length !== 1) throw new Error(`<${el.name}> ${name} must be a single number`);
  return v[0];
}

/** @param {XmlElement} el @param {string} key */
const child = (el, key) => el.children.find((c) => c.key === key);
/** @param {XmlElement} el @param {string} key */
const childrenOf = (el, key) => el.children.filter((c) => c.key === key);
/** @param {string} a @param {string} b */
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

/** CLF/CTF bit depths and the largest code each holds (BitDepthUtils.cpp). */
const BIT_DEPTH_MAX = /** @type {Record<string, number>} */ ({ '8i': 255, '10i': 1023, '12i': 4095, '16i': 65535, '16f': 1, '32f': 1 });

/** A version 'a.b' as a comparable number (a * 1000 + b). @param {string} s */
function version(s) {
  const m = /^\s*(\d+)(?:\.(\d+))?(?:\.(\d+))?\s*$/.exec(s);
  if (!m) throw new Error(`ProcessList: bad version '${s}'`);
  return Number(m[1]) * 1000 + Number(m[2] ?? 0);
}

// ---------------------------------------------------------------------------------------------------------------
// CTF / CLF

/**
 * @typedef {{ version: number, clf: boolean, inMax: number, outMax: number }} OpContext
 *   version: the CTF version the file is read as (CLF 3 reads as CTF 2.0, CLF 1–2 as 1.7);
 *   inMax / outMax: the largest code of the op's inBitDepth / outBitDepth.
 */

/** @typedef {{ type: string, [key: string]: any }} ColorOp */

/**
 * The ops of a .ctf or .clf text.
 * @param {string} text
 * @param {{ clf?: boolean }} [options] clf: read as CLF (a .clf file); a ProcessList with compCLFversion or a SMPTE
 *   xmlns is CLF whatever its name
 * @returns {ColorOp[]}
 */
export function parseCtf(text, options = {}) {
  const root = readXml(text);
  if (root.key !== 'processlist') throw new Error(`CTF: the root element is <${root.name}>, not <ProcessList>`);
  let clf = !!options.clf;
  let ver = 1002; // a ProcessList with no version is CTF 1.2
  const a = root.attrs;
  const smpte = /^http:\/\/www\.smpte-ra\.org\/ns\/2136-10\/\d{4}/.test(a.xmlns ?? '');
  if (a.version !== undefined) ver = version(a.version);
  if (a.compclfversion !== undefined || smpte) {
    clf = true;
    // OCIO reads CLF up to 2.0 as CTF 1.7 and CLF 3 (and SMPTE ST 2136-10) as CTF 2.0.
    const clfVersion = a.compclfversion !== undefined ? version(a.compclfversion) : 3000;
    if (clfVersion > 3000) throw new Error(`CLF: unsupported compCLFversion '${a.compclfversion}'`);
    ver = clfVersion <= 2000 ? 1007 : 2000;
  }

  /** @type {ColorOp[]} */
  const ops = [];
  let prevOutDepth = '';
  for (const el of root.children) {
    if (METADATA.has(el.key)) continue;
    const read = READERS[el.key];
    if (!read) throw new Error(`CTF: unsupported element <${el.name}> (line ${el.line})`);
    const inDepth = (el.attrs.inbitdepth ?? '').toLowerCase();
    const outDepth = (el.attrs.outbitdepth ?? '').toLowerCase();
    if (!(inDepth in BIT_DEPTH_MAX)) throw new Error(`<${el.name}> (line ${el.line}): inBitDepth '${el.attrs.inbitdepth ?? ''}' is missing or unknown`);
    if (!(outDepth in BIT_DEPTH_MAX)) throw new Error(`<${el.name}> (line ${el.line}): outBitDepth '${el.attrs.outbitdepth ?? ''}' is missing or unknown`);
    if (prevOutDepth && prevOutDepth !== inDepth) {
      throw new Error(`<${el.name}> (line ${el.line}): inBitDepth '${inDepth}' does not match the previous op's outBitDepth '${prevOutDepth}'`);
    }
    prevOutDepth = outDepth;
    try {
      ops.push(read(el, { version: ver, clf, inMax: BIT_DEPTH_MAX[inDepth], outMax: BIT_DEPTH_MAX[outDepth] }));
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(message.startsWith(`<${el.name}>`) ? message : `<${el.name}> (line ${el.line}): ${message}`);
    }
  }
  return ops;
}

/** @type {Record<string, (el: XmlElement, ctx: OpContext) => ColorOp>} */
const READERS = {
  matrix: readMatrix,
  range: readRange,
  log: readLog,
  exponent: readExponent,
  gamma: readExponent,
  asc_cdl: readCdl,
  exposurecontrast: readExposureContrast,
  gradingprimary: readGradingPrimary,
  gradingtone: readGradingTone,
  gradingrgbcurve: readGradingRGBCurve,
  gradinghuecurve: readGradingHueCurve,
  fixedfunction: readFixedFunction,
  lut1d: readLut1D,
  lut3d: readLut3D,
};

/** The values of an op's <Array>, with its dim. @param {XmlElement} el */
function readArray(el) {
  const array = child(el, 'array');
  if (!array) throw new Error('the <Array> element is missing');
  const dim = numbers(array.attrs.dim ?? '', 'Array dim');
  if (!dim.length) throw new Error('the Array has no dim');
  return { dim, values: numbers(array.text, 'Array') };
}

/** Elements an op does not read: an error, so nothing is skipped silently. @param {XmlElement} el @param {string[]} known */
function rejectUnknownChildren(el, known) {
  for (const c of el.children) {
    if (METADATA.has(c.key) || known.includes(c.key)) continue;
    if (c.key === 'indexmap') throw new Error('IndexMap is not supported');
    throw new Error(`unsupported element <${c.name}>`);
  }
}

/**
 * Matrix → { type: 'matrix', matrix: number[9] (row-major, RGB rows), offset: number[3] }.
 * A 4x4 (or 4x5) matrix's alpha column is folded into the offset with alpha = 1, as for an RGB image (OCIO fills a
 * missing alpha with 1); its alpha row does not touch RGB. Scaled by in/out bit depth (MatrixOpData::scale).
 * @param {XmlElement} el @param {OpContext} ctx
 * @returns {ColorOp}
 */
function readMatrix(el, ctx) {
  rejectUnknownChildren(el, ['array']);
  const { dim, values } = readArray(el);
  let rows, cols;
  if (ctx.version <= 1002) {
    // CTF 1.2: '3 3 3' or '4 4 3', the last value the color components.
    if (dim.length !== 3 || dim[0] !== dim[1] || dim[2] !== 3 || (dim[0] !== 3 && dim[0] !== 4)) {
      throw new Error(`bad Matrix dim '${dim.join(' ')}'`);
    }
    rows = dim[0];
    cols = dim[0];
  } else {
    // CLF 3 has 'rows cols'; older files (and many new ones) add a third value equal to the first.
    if ((dim.length !== 2 && dim.length !== 3) || (dim.length === 3 && dim[0] !== dim[2])) {
      throw new Error(`bad Matrix dim '${dim.join(' ')}'`);
    }
    [rows, cols] = dim;
    const ok = (rows === 3 && (cols === 3 || cols === 4)) || (rows === 4 && (cols === 4 || cols === 5));
    if (!ok) throw new Error(`bad Matrix dim '${dim.join(' ')}'`);
  }
  if (values.length !== rows * cols) throw new Error(`expected ${rows}x${cols} Array values, found ${values.length}`);
  const at = (/** @type {number} */ r, /** @type {number} */ c) => values[r * cols + c];
  const matrix = [];
  const offset = [];
  for (let r = 0; r < 3; r++) {
    matrix.push(at(r, 0), at(r, 1), at(r, 2));
    // 3x4 (and CTF 1.2's 4x4): the 4th column is the offset. 4x4: the 4th column multiplies alpha, which is 1.
    // 4x5: the alpha column plus the offset.
    offset.push(cols === 4 ? at(r, 3) : cols === 5 ? at(r, 3) + at(r, 4) : 0);
  }
  // Integer bit depths: the array is scaled by inMax / outMax, the offsets by 1 / outMax.
  const s = ctx.inMax / ctx.outMax;
  return { type: 'matrix', matrix: matrix.map((v) => v * s), offset: offset.map((v) => v / ctx.outMax) };
}

/**
 * Range → { type: 'range', minIn, maxIn, minOut, maxOut } (null for a missing bound), or, with style="noClamp"
 * (CTF 1.7 / CLF), the same scale and offset as a matrix (RangeOpData::convertToMatrix).
 * @param {XmlElement} el @param {OpContext} ctx
 * @returns {ColorOp}
 */
function readRange(el, ctx) {
  rejectUnknownChildren(el, ['mininvalue', 'maxinvalue', 'minoutvalue', 'maxoutvalue']);
  const value = (/** @type {string} */ key) => {
    const c = child(el, key);
    if (!c) return null;
    const v = numbers(c.text, c.name);
    if (v.length !== 1) throw new Error(`${c.name}: a single value is required`);
    return v[0];
  };
  const scale = (/** @type {number | null} */ v, /** @type {number} */ max) => (v === null ? null : v / max);
  const minIn = scale(value('mininvalue'), ctx.inMax);
  const maxIn = scale(value('maxinvalue'), ctx.inMax);
  const minOut = scale(value('minoutvalue'), ctx.outMax);
  const maxOut = scale(value('maxoutvalue'), ctx.outMax);
  // RangeOpData::validate
  if ((minIn === null) !== (minOut === null)) throw new Error('In and out minimum limits must be both set or both missing');
  if ((maxIn === null) !== (maxOut === null)) throw new Error('In and out maximum limits must be both set or both missing');
  if (minIn === null && maxIn === null) throw new Error('At least minimum or maximum limits must be set');
  if (minIn !== null && maxIn !== null && minOut !== null && maxOut !== null) {
    if (minIn > maxIn) throw new Error('maximum input value is less than minimum input value');
    if (minOut > maxOut) throw new Error('maximum output value is less than minimum output value');
    if (Math.abs(maxIn - minIn) < 1e-6) throw new Error('maxInValue is too close to minInValue');
  }
  const differ = (/** @type {number} */ x, /** @type {number} */ y) => Math.abs(x - y) > 1e-6 * Math.max(1, Math.abs(x));
  if (maxIn === null && minIn !== null && minOut !== null && differ(minOut, minIn)) {
    throw new Error('In and out minimum limits must be equal if maximum values are missing');
  }
  if (minIn === null && maxIn !== null && maxOut !== null && differ(maxOut, maxIn)) {
    throw new Error('In and out maximum limits must be equal if minimum values are missing');
  }
  const noClamp = ctx.version >= 1007 && same(el.attrs.style ?? '', 'noClamp');
  if (noClamp) {
    if (minIn === null || maxIn === null || minOut === null || maxOut === null) {
      throw new Error('Non-clamping Range min & max values have to be set');
    }
    const k = (maxOut - minOut) / (maxIn - minIn);
    const o = minOut - k * minIn;
    return { type: 'matrix', matrix: [k, 0, 0, 0, k, 0, 0, 0, k], offset: [o, o, o] };
  }
  return { type: 'range', minIn, maxIn, minOut, maxOut };
}

const LOG_STYLES = ['log10', 'log2', 'antiLog10', 'antiLog2', 'linToLog', 'logToLin', 'cameraLinToLog', 'cameraLogToLin'];

/**
 * Log → { type: 'log', style, base, params: [r, g, b] }, each channel's params
 * [logSideSlope, logSideOffset, linSideSlope, linSideOffset, linSideBreak?, linearSlope?] (LogOpData's order).
 * Cineon-type params (gamma, refWhite, refBlack, highlight, shadow) are converted as LogUtils.cpp does.
 * @param {XmlElement} el @param {OpContext} ctx
 * @returns {ColorOp}
 */
function readLog(el, ctx) {
  rejectUnknownChildren(el, ['logparams']);
  const style = LOG_STYLES.find((s) => same(s, el.attrs.style ?? ''));
  if (!style) throw new Error(`Log style '${el.attrs.style ?? ''}' is missing or invalid`);
  const camera = style === 'cameraLinToLog' || style === 'cameraLogToLin';
  const cineonStyle = style === 'linToLog' || style === 'logToLin';
  /** @type {(number[] | null)[]} */
  const cineon = [null, null, null];
  /** @type {(number[] | null)[]} */
  const clfParams = [null, null, null];
  let base = NaN;
  let type = '';
  for (const p of childrenOf(el, 'logparams')) {
    const chan = p.attrs.channel === undefined ? -1 : ['r', 'g', 'b'].indexOf(p.attrs.channel.toLowerCase());
    if (p.attrs.channel !== undefined && chan < 0) throw new Error(`Illegal channel attribute value '${p.attrs.channel}'`);
    const has = (/** @type {string[]} */ keys) => keys.some((k) => p.attrs[k.toLowerCase()] !== undefined);
    const clfKeys = ['linSideSlope', 'linSideOffset', 'logSideSlope', 'logSideOffset', 'base', 'linearSlope', 'linSideBreak'];
    const cineonKeys = ['gamma', 'refWhite', 'refBlack', 'highlight', 'shadow'];
    // CTF before 2.0 has Cineon-type params only; CLF and camera styles never.
    const isClf = ctx.version >= 2000 && has(clfKeys);
    const isCineon = !camera && !(ctx.version >= 2000 && ctx.clf) && has(cineonKeys);
    if (isClf && isCineon) throw new Error('CLF type and Cineon types parameters can not be mixed');
    const t = isClf ? 'clf' : isCineon ? 'cineon' : '';
    if (t && type && t !== type) throw new Error('CLF type and Cineon types parameters can not be mixed');
    type = type || t;
    const targets = chan < 0 ? [0, 1, 2] : [chan];
    if (t === 'cineon' || (ctx.version < 2000 && !t)) {
      const v = cineonKeys.map((k) => scalarAttr(p, k));
      for (const c of targets) cineon[c] = v;
    } else {
      const v = [scalarAttr(p, 'logSideSlope', 1), scalarAttr(p, 'logSideOffset', 0), scalarAttr(p, 'linSideSlope', 1),
        scalarAttr(p, 'linSideOffset', 0)];
      const linSideBreak = p.attrs.linsidebreak === undefined ? NaN : scalarAttr(p, 'linSideBreak');
      const linearSlope = p.attrs.linearslope === undefined ? NaN : scalarAttr(p, 'linearSlope');
      if (!Number.isNaN(linSideBreak)) {
        if (!camera) throw new Error(`Parameter 'linSideBreak' is only allowed for style 'cameraLogToLin' or 'cameraLinToLog'`);
        v.push(linSideBreak);
      } else if (camera) {
        throw new Error(`Parameter 'linSideBreak' should be defined for style 'cameraLogToLin' or 'cameraLinToLog'`);
      }
      if (!Number.isNaN(linearSlope)) {
        if (!camera) throw new Error(`Parameter 'linearSlope' is only allowed for style 'cameraLogToLin' or 'cameraLinToLog'`);
        v.push(linearSlope);
      }
      if (p.attrs.base !== undefined) {
        const b = scalarAttr(p, 'base');
        if (!Number.isNaN(base) && base !== b) throw new Error(`Log base has to be the same on all components`);
        base = b;
      }
      for (const c of targets) clfParams[c] = v;
    }
  }

  /** @type {number[][]} */
  let params;
  if (type === 'cineon' || ctx.version < 2000) {
    // LogUtil::ConvertLogParameters: log2/log10 keep the default params; linToLog/logToLin take Cineon params.
    if (camera) throw new Error('camera Log styles need CTF 2.0 or later and LogParams with linSideBreak');
    if (cineonStyle) {
      base = 10;
      params = cineon.map((c) => {
        if (!c) throw new Error('Log: Cineon parameters are missing for a channel');
        return cineonToParams(c);
      });
    } else {
      base = style === 'log2' || style === 'antiLog2' ? 2 : 10;
      params = [[1, 0, 1, 0], [1, 0, 1, 0], [1, 0, 1, 0]];
    }
  } else {
    if (Number.isNaN(base)) base = style === 'log10' || style === 'antiLog10' ? 10 : 2;
    params = clfParams.map((p) => p ?? [1, 0, 1, 0]);
    if (camera && clfParams.some((p) => !p)) {
      throw new Error(`Parameter 'linSideBreak' should be defined for style '${style}'`);
    }
    if (params.some((p) => p.length !== params[0].length)) throw new Error('Log: Red, green & blue parameters must have the same size');
  }
  // LogOpData::validate
  for (const p of params) {
    if (Math.abs(p[2]) < 1e-30) throw new Error('Log: linear side slope cannot be 0');
    if (Math.abs(p[0]) < 1e-30) throw new Error('Log: log side slope cannot be 0');
  }
  if (base === 1) throw new Error('Log: base cannot be 1');
  if (base <= 0) throw new Error('Log: base must be greater than 0');
  return { type: 'log', style, base, params };
}

/**
 * Cineon-type log params (gamma, refWhite, refBlack, highlight, shadow) as OCIO params, base 10
 * (LogUtils.cpp ConvertFromCTFToOCIO and ValidateLegacyParams).
 * @param {number[]} c
 */
function cineonToParams([gamma, refWhite, refBlack, highlight, shadow]) {
  if (!(gamma > 0.01)) throw new Error(`Log: Invalid gamma value '${gamma}', gamma should be greater than 0.01`);
  if (!(refWhite > refBlack)) throw new Error('Log: refWhite should be greater than refBlack');
  if (!(highlight > shadow)) throw new Error('Log: highlight should be greater than shadow');
  const range = 0.002 * 1023;
  const multFactor = range / gamma;
  const tmp = Math.min(((refBlack - refWhite) / 1023) * multFactor, -0.0001);
  const gain = (highlight - shadow) / (1 - 10 ** tmp);
  const offset = gain - (highlight - shadow);
  return [1 / multFactor, refWhite / 1023, 1 / gain, (offset - shadow) / gain];
}

const EXPONENT_STYLES = ['basicFwd', 'basicRev', 'basicMirrorFwd', 'basicMirrorRev', 'basicPassThruFwd', 'basicPassThruRev',
  'monCurveFwd', 'monCurveRev', 'monCurveMirrorFwd', 'monCurveMirrorRev'];

/**
 * Exponent (CLF) or Gamma (CTF) → { type: 'exponent', style, params: [r, g, b] }, each [exponent] for the basic
 * styles or [exponent, offset] for the monCurve styles (GammaOpData; alpha params are read and ignored).
 * @param {XmlElement} el @param {OpContext} ctx
 * @returns {ColorOp}
 */
function readExponent(el, ctx) {
  rejectUnknownChildren(el, ['exponentparams', 'gammaparams']);
  const style = EXPONENT_STYLES.find((s) => same(s, el.attrs.style ?? ''));
  if (!style) throw new Error(`Exponent style '${el.attrs.style ?? ''}' is missing or invalid`);
  if (ctx.version < 2000 && !['basicFwd', 'basicRev', 'monCurveFwd', 'monCurveRev'].includes(style)) {
    throw new Error(`Style not handled: '${style}' before CTF 2.0`);
  }
  const moncurve = style.startsWith('monCurve');
  /** @type {number[][]} */
  const params = [0, 1, 2].map(() => (moncurve ? [1, 0] : [1]));
  for (const p of el.children.filter((c) => c.key === 'exponentparams' || c.key === 'gammaparams')) {
    const chanName = p.attrs.channel;
    const chan = chanName === undefined ? -1 : ['r', 'g', 'b', 'a'].indexOf(chanName.toLowerCase());
    if (chanName !== undefined && (chan < 0 || (chan === 3 && (ctx.version < 1005 || ctx.clf)))) {
      throw new Error(`Invalid channel: ${chanName}`);
    }
    const g = p.attrs.exponent ?? p.attrs.gamma;
    if (g === undefined) throw new Error(`Missing required gamma parameter for style: ${style}`);
    const v = [scalarAttr(p, p.attrs.exponent !== undefined ? 'exponent' : 'gamma')];
    if (moncurve) {
      if (p.attrs.offset === undefined) throw new Error(`Missing required offset parameter for style: ${style}`);
      v.push(scalarAttr(p, 'offset'));
    } else if (p.attrs.offset !== undefined) {
      throw new Error(`Illegal offset parameter for style: ${style}`);
    }
    if (chan === 3) continue; // alpha
    for (const c of chan < 0 ? [0, 1, 2] : [chan]) params[c] = v;
  }
  // GammaOpData::validateParameters
  for (const v of params) {
    if (moncurve) {
      if (v[0] < 1 || v[0] > 10) throw new Error(`Parameter ${v[0]} is outside [1, 10]`);
      if (v[1] < 0 || v[1] > 0.9) throw new Error(`Parameter ${v[1]} is outside [0, 0.9]`);
    } else if (v[0] < 0.01 || v[0] > 100) {
      throw new Error(`Parameter ${v[0]} is outside [0.01, 100]`);
    }
  }
  return { type: 'exponent', style, params };
}

/** CDL style names, the CLF and the original CTF ones (CDLOpData.cpp). */
const CDL_STYLES = /** @type {Record<string, string>} */ ({
  fwd: 'Fwd', rev: 'Rev', fwdnoclamp: 'FwdNoClamp', revnoclamp: 'RevNoClamp',
  'v1.2_fwd': 'Fwd', 'v1.2_rev': 'Rev', noclampfwd: 'FwdNoClamp', noclamprev: 'RevNoClamp',
});

/**
 * ASC_CDL → { type: 'cdl', style: 'Fwd' | 'Rev' | 'FwdNoClamp' | 'RevNoClamp', slope, offset, power, saturation }.
 * A missing style is 'Fwd' (CLF's default).
 * @param {XmlElement} el
 * @returns {ColorOp}
 */
function readCdl(el) {
  rejectUnknownChildren(el, ['sopnode', 'satnode']);
  const style = el.attrs.style === undefined ? 'Fwd' : CDL_STYLES[el.attrs.style.toLowerCase()];
  if (!style) throw new Error(`Unknown style for CDL: '${el.attrs.style}'`);
  let slope = [1, 1, 1];
  let offset = [0, 0, 0];
  let power = [1, 1, 1];
  let saturation = 1;
  const sop = child(el, 'sopnode');
  if (sop) {
    rejectUnknownChildren(sop, ['slope', 'offset', 'power']);
    const triple = (/** @type {string} */ key) => {
      const c = child(sop, key);
      if (!c) return null;
      const v = numbers(c.text, c.name);
      if (v.length !== 3) throw new Error('SOPNode: 3 values required');
      return v;
    };
    slope = triple('slope') ?? slope;
    offset = triple('offset') ?? offset;
    power = triple('power') ?? power;
  }
  const sat = child(el, 'satnode');
  if (sat) {
    rejectUnknownChildren(sat, ['saturation']);
    const c = child(sat, 'saturation');
    if (c) {
      const v = numbers(c.text, c.name);
      if (v.length !== 1) throw new Error('SatNode: non-single value');
      saturation = v[0];
    }
  }
  // ASC CDL v1.2: slope >= 0, power > 0, saturation >= 0.
  if (slope.some((v) => !(v >= 0))) throw new Error(`CDL: Invalid 'slope' ${slope.join(' ')}`);
  if (power.some((v) => !(v > 0))) throw new Error(`CDL: Invalid 'power' ${power.join(' ')}`);
  if (!(saturation >= 0)) throw new Error(`CDL: Invalid 'saturation' ${saturation}`);
  return { type: 'cdl', style, slope, offset, power, saturation };
}

/** @param {string | undefined} s @param {string[]} styles @param {string} what */
function styleOf(s, styles, what) {
  const style = styles.find((x) => same(x, s ?? ''));
  if (!style) throw new Error(`${what} style '${s ?? ''}' is missing or invalid`);
  return style;
}

/**
 * ExposureContrast (CTF only) → { type: 'exposureContrast', style: 'linear' | 'linearRev' | 'video' | 'videoRev' |
 * 'log' | 'logRev', exposure, contrast, gamma, pivot, logExposureStep, logMidGray } (ExposureContrastOpData).
 * @param {XmlElement} el
 * @returns {ColorOp}
 */
function readExposureContrast(el) {
  rejectUnknownChildren(el, ['ecparams']);
  const style = styleOf(el.attrs.style, ['linear', 'linearRev', 'video', 'videoRev', 'log', 'logRev'], 'ExposureContrast');
  const p = child(el, 'ecparams');
  const op = { type: 'exposureContrast', style, exposure: 0, contrast: 1, gamma: 1, pivot: 0.18, logExposureStep: 0.088, logMidGray: 0.435 };
  if (p) {
    op.exposure = scalarAttr(p, 'exposure');
    op.contrast = scalarAttr(p, 'contrast');
    op.pivot = scalarAttr(p, 'pivot');
    op.gamma = scalarAttr(p, 'gamma', 1);
    op.logExposureStep = scalarAttr(p, 'logExposureStep', 0.088);
    op.logMidGray = scalarAttr(p, 'logMidGray', 0.435);
  }
  return op;
}

/** A grading style attribute: 'log' | 'linear' | 'video', and whether it is the Rev form (CTFReaderUtils.cpp). */
function gradingStyle(/** @type {XmlElement} */ el) {
  const s = (el.attrs.style ?? '').toLowerCase();
  const style = { log: 'log', logrev: 'log', linear: 'linear', linearrev: 'linear', video: 'video', videorev: 'video' }[s];
  if (!style) throw new Error(`Required attribute 'style' '${el.attrs.style ?? ''}' is missing or invalid`);
  return { style, inverse: s.endsWith('rev') };
}

/**
 * The RGBM attribute values of a grading element: { r, g, b, m } (and more keys when asked).
 * @param {XmlElement} el
 * @param {Record<string, string>} extra other required attributes, by the key to store them under
 */
function rgbm(el, extra = {}) {
  const allowed = ['rgb', 'master', ...Object.values(extra).map((k) => k.toLowerCase())];
  for (const k of Object.keys(el.attrs)) if (!allowed.includes(k)) throw new Error(`Illegal attribute for '${el.name}': '${k}'`);
  if (el.attrs.rgb === undefined) throw new Error(`Missing 'rgb' attribute for '${el.name}'`);
  const rgb = numbers(el.attrs.rgb, `${el.name} rgb`);
  if (rgb.length !== 3) throw new Error(`Illegal number of 'rgb' values for '${el.name}'`);
  /** @type {Record<string, number>} */
  const v = { r: rgb[0], g: rgb[1], b: rgb[2], m: scalarAttr(el, 'master') };
  for (const [key, attr] of Object.entries(extra)) v[key] = scalarAttr(el, attr);
  return v;
}

/**
 * GradingPrimary → { type: 'gradingPrimary', style, inverse, brightness, contrast, gamma, offset, exposure, lift,
 * gain (each { r, g, b, m }), saturation, pivot, pivotBlack, pivotWhite, clampBlack, clampWhite }. Defaults per style
 * as GradingPrimary(style) in OpenColorTransforms.h; validated as GradingPrimary::validate.
 * @param {XmlElement} el
 * @returns {ColorOp}
 */
function readGradingPrimary(el) {
  const { style, inverse } = gradingStyle(el);
  const one = { r: 1, g: 1, b: 1, m: 1 };
  const zero = { r: 0, g: 0, b: 0, m: 0 };
  /** @type {ColorOp} */
  const op = {
    type: 'gradingPrimary', style, inverse,
    brightness: zero, contrast: one, gamma: one, offset: zero, exposure: zero, lift: zero, gain: one,
    saturation: 1, pivot: style === 'log' ? -0.2 : 0.18, pivotBlack: 0, pivotWhite: 1,
    clampBlack: -Number.MAX_VALUE, clampWhite: Number.MAX_VALUE,
  };
  const known = ['brightness', 'contrast', 'gamma', 'offset', 'exposure', 'lift', 'gain', 'pivot', 'saturation', 'clamp'];
  rejectUnknownChildren(el, known);
  for (const c of el.children) {
    if (METADATA.has(c.key)) continue;
    if (c.key === 'pivot') {
      const keys = Object.keys(c.attrs);
      if (!keys.length) throw new Error(`Missing 'contrast', 'black' or 'white' attribute for '${c.name}'`);
      for (const k of keys) if (!['contrast', 'black', 'white'].includes(k)) throw new Error(`Illegal attribute for '${c.name}': '${k}'`);
      op.pivot = scalarAttr(c, 'contrast', op.pivot);
      op.pivotBlack = scalarAttr(c, 'black', op.pivotBlack);
      op.pivotWhite = scalarAttr(c, 'white', op.pivotWhite);
    } else if (c.key === 'clamp') {
      const keys = Object.keys(c.attrs);
      if (!keys.length) throw new Error(`Missing 'black' or 'white' attribute for '${c.name}'`);
      for (const k of keys) if (!['black', 'white'].includes(k)) throw new Error(`Illegal attribute for '${c.name}': '${k}'`);
      op.clampBlack = scalarAttr(c, 'black', op.clampBlack);
      op.clampWhite = scalarAttr(c, 'white', op.clampWhite);
    } else if (c.key === 'saturation') {
      for (const k of Object.keys(c.attrs)) if (k !== 'master') throw new Error(`Illegal attribute for '${c.name}': '${k}'`);
      op.saturation = scalarAttr(c, 'master');
    } else {
      op[c.key] = rgbm(c);
    }
  }
  // GradingPrimary::validate
  const min = 0.01 - 0.000001;
  const below = (/** @type {Record<string, number>} */ v) => v.r < min || v.g < min || v.b < min || v.m < min;
  if (style !== 'linear' && below(op.gamma)) throw new Error('GradingPrimary gamma are below lower bound (0.01)');
  if (style === 'linear' && below(op.contrast)) throw new Error('GradingPrimary contrast are below lower bound (0.01)');
  if (op.pivotWhite - op.pivotBlack < min) throw new Error('GradingPrimary black pivot should be smaller than white pivot');
  if (op.clampBlack > op.clampWhite) throw new Error('GradingPrimary black clamp should be smaller than white clamp');
  return op;
}

/** GradingTone defaults per style: [start, width] of each zone (GradingTone(style) in OpenColorTransforms.h). */
const TONE_DEFAULTS = /** @type {Record<string, Record<string, [number, number]>>} */ ({
  linear: { blacks: [0, 4], shadows: [2, -7], midtones: [0, 8], highlights: [-2, 9], whites: [0, 8] },
  log: { blacks: [0.4, 0.4], shadows: [0.5, 0], midtones: [0.4, 0.6], highlights: [0.3, 1], whites: [0.4, 0.5] },
  video: { blacks: [0.4, 0.4], shadows: [0.6, 0], midtones: [0.4, 0.7], highlights: [0.2, 1], whites: [0.5, 0.5] },
});

/**
 * GradingTone → { type: 'gradingTone', style, inverse, blacks, shadows, midtones, highlights, whites (each
 * { r, g, b, m, start, width }), scontrast }. Shadows and Highlights write their width as 'pivot', Midtones its start
 * as 'center' (CTFReaderGradingToneParamElt). Validated as GradingTone::validate.
 * @param {XmlElement} el
 * @returns {ColorOp}
 */
function readGradingTone(el) {
  const { style, inverse } = gradingStyle(el);
  /** @type {ColorOp} */
  const op = { type: 'gradingTone', style, inverse, scontrast: 1 };
  for (const [zone, [start, width]] of Object.entries(TONE_DEFAULTS[style])) op[zone] = { r: 1, g: 1, b: 1, m: 1, start, width };
  const attrs = /** @type {Record<string, Record<string, string>>} */ ({
    blacks: { start: 'start', width: 'width' }, shadows: { start: 'start', width: 'pivot' },
    midtones: { start: 'center', width: 'width' }, highlights: { start: 'start', width: 'pivot' },
    whites: { start: 'start', width: 'width' },
  });
  rejectUnknownChildren(el, [...Object.keys(attrs), 'scontrast']);
  for (const c of el.children) {
    if (METADATA.has(c.key)) continue;
    if (c.key === 'scontrast') {
      for (const k of Object.keys(c.attrs)) if (k !== 'master') throw new Error(`Illegal attribute for '${c.name}': '${k}'`);
      op.scontrast = scalarAttr(c, 'master');
    } else {
      op[c.key] = rgbm(c, attrs[c.key]);
    }
  }
  // GradingTone::validate
  const e = 0.000001;
  const rgbmOutside = (/** @type {Record<string, number>} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
    ['r', 'g', 'b', 'm'].some((k) => v[k] < lo - e || v[k] > hi + e);
  for (const zone of ['blacks', 'midtones', 'whites']) {
    if (rgbmOutside(op[zone], 0.1, 1.9)) throw new Error(`GradingTone ${zone} are outside [0.1, 1.9]`);
    if (op[zone].width < 0.01 - e) throw new Error(`GradingTone ${zone} width is below 0.01`);
  }
  for (const zone of ['shadows', 'highlights']) {
    if (rgbmOutside(op[zone], 0.2, 1.8)) throw new Error(`GradingTone ${zone} are outside [0.2, 1.8]`);
  }
  if (op.shadows.start < op.shadows.width + 0.01 - e) throw new Error('GradingTone shadows start must be above its pivot + 0.01');
  if (op.highlights.start > op.highlights.width - 0.01 + e) throw new Error('GradingTone highlights start must be below its pivot - 0.01');
  if (op.scontrast < 0.01 - e || op.scontrast > 1.99 + e) throw new Error('GradingTone s-contrast is outside [0.01, 1.99]');
  return op;
}

/**
 * The control points and slopes of a grading curve element: { points: [x, y][], slopes: number[] }, as float32
 * (OCIO keeps them as float). Slopes default to 0 (estimate them).
 * @param {XmlElement} el
 */
function readCurve(el) {
  rejectUnknownChildren(el, ['controlpoints', 'slopes']);
  const cp = child(el, 'controlpoints');
  if (!cp) throw new Error(`<${el.name}> has no ControlPoints`);
  const v = numbers(cp.text, 'ControlPoints').map(Math.fround);
  if (v.length % 2) throw new Error('Control points element: odd number of values');
  /** @type {[number, number][]} */
  const points = [];
  for (let i = 0; i < v.length; i += 2) points.push([v[i], v[i + 1]]);
  let slopes = points.map(() => 0);
  const sl = child(el, 'slopes');
  if (sl) {
    slopes = numbers(sl.text, 'Slopes').map(Math.fround);
    if (slopes.length !== points.length) throw new Error('Number of slopes must match number of control points');
  }
  return { points, slopes };
}

/** Default RGB curves (GradingRGBCurve.cpp). */
const RGB_CURVE_DEFAULT = { log: [[0, 0], [0.5, 0.5], [1, 1]], linear: [[-7, -7], [0, 0], [7, 7]] };

/**
 * GradingRGBCurve → { type: 'gradingRGBCurve', style, inverse, bypassLinToLog, red, green, blue, master }, each
 * curve { points, slopes }. Unwritten curves are OCIO's identity defaults for the style.
 * @param {XmlElement} el
 * @returns {ColorOp}
 */
function readGradingRGBCurve(el) {
  const { style, inverse } = gradingStyle(el);
  const bypass = el.attrs.bypasslintolog;
  if (bypass !== undefined && !same(bypass, 'true')) throw new Error(`Unknown bypassLinToLog value: '${bypass}'`);
  const def = style === 'linear' ? RGB_CURVE_DEFAULT.linear : RGB_CURVE_DEFAULT.log;
  /** @type {ColorOp} */
  const op = { type: 'gradingRGBCurve', style, inverse, bypassLinToLog: bypass !== undefined };
  for (const name of ['red', 'green', 'blue', 'master']) {
    const c = child(el, name);
    op[name] = c ? readCurve(c) : { points: def.map((p) => [...p]), slopes: [0, 0, 0] };
    validateCurve(op[name], 'rgb', name);
  }
  rejectUnknownChildren(el, ['red', 'green', 'blue', 'master']);
  return op;
}

/** Hue curve names in OCIO's order (HueCurveType), with their default points per style (GradingHueCurve.cpp). */
export const HUE_CURVES = ['hueHue', 'hueSat', 'hueLum', 'lumSat', 'satSat', 'lumLum', 'satLum', 'hueFx'];
const SIXTHS = [0, 1 / 6, 2 / 6, 0.5, 4 / 6, 5 / 6].map(Math.fround);
const HUE_CURVE_DEFAULT = /** @type {Record<string, [number, number][]>} */ ({
  hueHue: SIXTHS.map((x) => [x, x]),
  hueSat: SIXTHS.map((x) => [x, 1]),
  hueLum: SIXTHS.map((x) => [x, 1]),
  hueFx: SIXTHS.map((x) => [x, 0]),
  lumSat: [[0, 1], [0.5, 1], [1, 1]],
  satSat: [[0, 0], [0.5, 0.5], [1, 1]],
  satLum: [[0, 1], [0.5, 1], [1, 1]],
  lumLum: [[0, 0], [0.5, 0.5], [1, 1]],
  lumSatLinear: [[-7, 1], [0, 1], [7, 1]],
  lumLumLinear: [[-7, -7], [0, 0], [7, 7]],
});

/**
 * GradingHueCurve (CTF 2.5) → { type: 'gradingHueCurve', style, inverse, hsy, hueHue, hueSat, hueLum, lumSat,
 * satSat, lumLum, satLum, hueFx }, each curve { points, slopes }. hsy is false for hsyTransform="none".
 * @param {XmlElement} el
 * @returns {ColorOp}
 */
function readGradingHueCurve(el) {
  const { style, inverse } = gradingStyle(el);
  const hsyAttr = el.attrs.hsytransform;
  if (hsyAttr !== undefined && !same(hsyAttr, 'none')) throw new Error(`Unknown hsyTransform value: '${hsyAttr}'`);
  /** @type {ColorOp} */
  const op = { type: 'gradingHueCurve', style, inverse, hsy: hsyAttr === undefined };
  for (const name of HUE_CURVES) {
    const c = child(el, name.toLowerCase());
    const defKey = style === 'linear' && (name === 'lumSat' || name === 'lumLum') ? `${name}Linear` : name;
    const def = HUE_CURVE_DEFAULT[defKey];
    op[name] = c ? readCurve(c) : { points: def.map((p) => [...p]), slopes: def.map(() => 0) };
    validateCurve(op[name], HUE_CURVE_SPLINE[name], name);
  }
  rejectUnknownChildren(el, HUE_CURVES.map((n) => n.toLowerCase()));
  return op;
}

/** FixedFunction styles the evaluator has, with how many params each takes (FixedFunctionOpData.cpp). */
export const FIXED_FUNCTION_STYLES = /** @type {Record<string, number>} */ ({
  GamutComp13Fwd: 7, GamutComp13Rev: 7,
  Rec2100SurroundFwd: 1, Rec2100SurroundRev: 1,
  RGB_TO_HSV: 0, HSV_TO_RGB: 0,
  RGB_TO_HSY_LIN: 0, RGB_TO_HSY_LOG: 0, RGB_TO_HSY_VID: 0, HSY_LIN_TO_RGB: 0, HSY_LOG_TO_RGB: 0, HSY_VID_TO_RGB: 0,
  XYZ_TO_xyY: 0, xyY_TO_XYZ: 0, XYZ_TO_uvY: 0, uvY_TO_XYZ: 0, XYZ_TO_LUV: 0, LUV_TO_XYZ: 0,
  Lin_TO_PQ: 0, PQ_TO_Lin: 0,
  ACESOutputTransform20Fwd: 9, ACESOutputTransform20Inv: 9,
});

/**
 * FixedFunction (CTF 2.0) → { type: 'fixedFunction', style, params }. 'Surround' is the old name of
 * Rec2100SurroundFwd. Styles the evaluator does not have (the ACES 0.3/1.0 and ACES 2 building blocks, GammaLog,
 * DoubleLog) are an Error.
 * @param {XmlElement} el
 * @returns {ColorOp}
 */
function readFixedFunction(el) {
  rejectUnknownChildren(el, []);
  const name = el.attrs.style ?? '';
  const style = same(name, 'Surround') ? 'Rec2100SurroundFwd' : Object.keys(FIXED_FUNCTION_STYLES).find((s) => same(s, name));
  if (!style) throw new Error(`FixedFunction style '${name}' is missing or not supported`);
  const params = el.attrs.params === undefined ? [] : numbers(el.attrs.params, 'FixedFunction params');
  const count = FIXED_FUNCTION_STYLES[style];
  if (params.length !== count) throw new Error(`The style '${style}' must have ${count} parameters but ${params.length} found`);
  const bound = (/** @type {string} */ what, /** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) => {
    if (v < lo || v > hi) throw new Error(`Parameter ${what} ${v} is outside [${lo}, ${hi}]`);
  };
  if (style.startsWith('GamutComp13')) {
    params.slice(0, 3).forEach((v) => bound('lim', v, 1.001, 65504));
    params.slice(3, 6).forEach((v) => bound('thr', v, 0, 0.9995));
    bound('power', params[6], 1, 65504);
  } else if (style.startsWith('Rec2100Surround')) {
    bound('gamma', params[0], 0.01, 100);
  } else if (style.startsWith('ACESOutputTransform20')) {
    bound('peak_luminance', params[0], 1, 10000);
    if (!Number.isInteger(params[0])) throw new Error('Parameter peak_luminance must be a whole number');
  }
  return { type: 'fixedFunction', style, params };
}

/**
 * LUT1D → { type: 'lut1d', size, values: Float32Array (size * 3, RGB per entry), halfDomain, hueAdjust }. Values
 * are divided by outBitDepth's largest code; rawHalfs values are half-float bit patterns; a one-column array feeds all
 * three channels. Only 'linear' interpolation exists (CLF 3).
 * @param {XmlElement} el @param {OpContext} ctx
 * @returns {ColorOp}
 */
function readLut1D(el, ctx) {
  rejectUnknownChildren(el, ['array']);
  if (el.attrs.interpolation !== undefined && !same(el.attrs.interpolation, 'linear')) {
    throw new Error(`1D LUT interpolation not recognized: '${el.attrs.interpolation}'`);
  }
  const flag = (/** @type {string} */ name, /** @type {string} */ value) => {
    const v = el.attrs[name.toLowerCase()];
    if (v !== undefined && !same(v, value)) throw new Error(`Illegal '${name}' attribute '${v}'`);
    return v !== undefined;
  };
  const halfDomain = flag('halfDomain', 'true');
  const rawHalfs = flag('rawHalfs', 'true');
  const hueAdjust = ctx.version >= 1004 && flag('hueAdjust', 'dw3');
  const { dim, values } = readArray(el);
  if (dim.length !== 2 || (dim[1] !== 3 && dim[1] !== 1) || dim[0] < 2 || dim[0] > MAX_LUT1D) {
    throw new Error(`bad LUT1D dim '${dim.join(' ')}'`);
  }
  const [size, comps] = dim;
  if (values.length !== size * comps) throw new Error(`Expected ${size}x${comps} Array values, found ${values.length}`);
  if (halfDomain && size !== 65536) throw new Error('A half-domain LUT1D must have 65536 entries');
  const out = new Float32Array(size * 3);
  for (let i = 0; i < size; i++) {
    for (let c = 0; c < 3; c++) {
      const v = values[i * comps + (comps === 1 ? 0 : c)];
      out[i * 3 + c] = (rawHalfs ? halfToFloat(v) : v) / ctx.outMax;
    }
  }
  return { type: 'lut1d', size, values: out, halfDomain, hueAdjust };
}

/**
 * LUT3D → { type: 'lut3d', size, values: Float32Array (size^3 * 3, blue fastest as in CLF), interpolation:
 * 'trilinear' | 'tetrahedral' } (no interpolation attribute is trilinear, as OCIO's default). Values are divided by
 * outBitDepth's largest code.
 * @param {XmlElement} el @param {OpContext} ctx
 * @returns {ColorOp}
 */
function readLut3D(el, ctx) {
  rejectUnknownChildren(el, ['array']);
  const interp = el.attrs.interpolation;
  let interpolation = 'trilinear';
  if (interp !== undefined) {
    if (same(interp, 'tetrahedral')) interpolation = 'tetrahedral';
    else if (!same(interp, 'trilinear')) throw new Error(`3D LUT interpolation not recognized: '${interp}'`);
  }
  const { dim, values } = readArray(el);
  if (dim.length !== 4 || dim[3] !== 3 || dim[1] !== dim[0] || dim[2] !== dim[0] || dim[0] < 2 || dim[0] > MAX_LUT3D) {
    throw new Error(`bad LUT3D dim '${dim.join(' ')}'`);
  }
  const size = dim[0];
  if (values.length !== size ** 3 * 3) throw new Error(`Expected ${size}x${size}x${size}x3 Array values, found ${values.length}`);
  const out = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) out[i] = values[i] / ctx.outMax;
  return { type: 'lut3d', size, values: out, interpolation };
}

/**
 * A half float's value from its 16-bit pattern.
 * @param {number} bits
 */
export function halfToFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const mant = bits & 0x3ff;
  if (exp === 0) return sign * mant * 2 ** -24;
  if (exp === 31) return mant ? NaN : sign * Infinity;
  return sign * (1 + mant / 1024) * 2 ** (exp - 15);
}

// ---------------------------------------------------------------------------------------------------------------
// .cube

/**
 * The ops of an Iridas .cube: a Matrix mapping DOMAIN_MIN..MAX to 0..1 (when it is not already), then the LUT
 * (FileFormatIridasCube.cpp). Resolve's LUT_1D_INPUT_RANGE / LUT_3D_INPUT_RANGE are read as the domain of a file with
 * one LUT; a file with both a 1D and a 3D LUT is an Error. 3D entries are written red fastest and returned blue
 * fastest, like a LUT3D element.
 * @param {string} text
 * @returns {ColorOp[]}
 */
export function parseCube(text) {
  let size1 = 0;
  let size3 = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  /** @type {number[]} */
  const raw = [];
  let line = 0;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    line++;
    const s = rawLine.trim();
    if (!s || s.startsWith('#')) continue;
    const words = s.split(/\s+/);
    const key = words[0].toLowerCase();
    const fail = (/** @type {string} */ m) => {
      throw new Error(`.cube line ${line}: ${m}`);
    };
    const nums = (/** @type {number} */ n) => {
      if (words.length !== n + 1) fail(`malformed '${words[0]}'`);
      return numbers(words.slice(1).join(' '), words[0]);
    };
    if (key === 'title') continue;
    if (key === 'lut_1d_size' || key === 'lut_3d_size') {
      const [n] = nums(1);
      const limit = key === 'lut_1d_size' ? MAX_LUT1D : MAX_LUT3D;
      if (!Number.isInteger(n) || n < 2 || n > limit) fail(`'${words[0]}' must be between 2 and ${limit}`);
      if (key === 'lut_1d_size') size1 = n;
      else size3 = n;
    } else if (key === 'lut_2d_size') {
      fail("unsupported tag 'LUT_2D_SIZE'");
    } else if (key === 'domain_min') {
      min = nums(3);
    } else if (key === 'domain_max') {
      max = nums(3);
    } else if (key === 'lut_1d_input_range' || key === 'lut_3d_input_range') {
      const [lo, hi] = nums(2);
      min = [lo, lo, lo];
      max = [hi, hi, hi];
    } else if (/^[a-z_]/i.test(key) && !/^(nan|[+-]?inf)/i.test(key)) {
      fail(`unknown keyword '${words[0]}'`);
    } else {
      if (words.length !== 3) fail('malformed color triple');
      raw.push(...numbers(s, 'color triple').map(Math.fround));
    }
  }
  if (size1 && size3) throw new Error('.cube: a file with both a 1D and a 3D LUT is not supported');
  if (!size1 && !size3) throw new Error('.cube: LUT type (1D/3D) unspecified');
  /** @type {ColorOp[]} */
  const ops = [];
  if (min.some((v, c) => v !== 0 || max[c] !== 1)) {
    // CreateMinMaxOp: out = (in - min) / (max - min), not clamped.
    const k = min.map((v, c) => 1 / (max[c] - v));
    ops.push({ type: 'matrix', matrix: [k[0], 0, 0, 0, k[1], 0, 0, 0, k[2]], offset: min.map((v, c) => -v * k[c]) });
  }
  if (size1) {
    if (raw.length !== size1 * 3) throw new Error(`.cube: incorrect number of lut1d entries. Found ${raw.length / 3}, expected ${size1}`);
    ops.push({ type: 'lut1d', size: size1, values: Float32Array.from(raw), halfDomain: false, hueAdjust: false });
  } else {
    const n = size3;
    if (raw.length !== n ** 3 * 3) throw new Error(`.cube: incorrect number of 3D LUT entries. Found ${raw.length / 3}, expected ${n ** 3}`);
    const values = new Float32Array(raw.length);
    for (let b = 0; b < n; b++) {
      for (let g = 0; g < n; g++) {
        for (let r = 0; r < n; r++) {
          const from = 3 * (r + n * (g + n * b));
          const to = 3 * (b + n * (g + n * r));
          values[to] = raw[from];
          values[to + 1] = raw[from + 1];
          values[to + 2] = raw[from + 2];
        }
      }
    }
    ops.push({ type: 'lut3d', size: n, values, interpolation: 'trilinear' });
  }
  return ops;
}
