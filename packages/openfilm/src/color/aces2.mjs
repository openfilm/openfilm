// @ts-check
/**
 * The ACES 2.0 Output Transform: scene-referred ACES2065-1 to a display's linear RGB (forward), and back (inverse).
 * It is the display rendering that ends every graded clip, and its inverse is how SDR footage enters the grade, so the
 * two must round-trip. Plain JavaScript with no dependencies, so a browser page can import it as it is.
 *
 *   acesOutput20(params, inverse) → (r, g, b, out) => void, writing out[0..2]
 *
 * `params` are the 9 numbers a CTF's FixedFunction element carries (styles ACESOutputTransform20Fwd and
 * ACESOutputTransform20Inv): the peak luminance in nits, then the xy of the limiting red, green, blue and white. The
 * display side is linear RGB in the limiting primaries, 1.0 = 100 nits.
 *
 * The reference is OpenColorIO 2.6's CPU path, ported line by line: ops/fixedfunction/ACES2/Transform.cpp and
 * Common.h (the model, the tables, tonescale, chroma and gamut compression), FixedFunctionOpCPU.cpp (how the op is set
 * up from its params and run each way), FixedFunctionOpData.cpp (the params' checks) and
 * transforms/builtins/ColorMatrixHelpers.cpp (primaries to matrices). OCIO works in single precision: the setup does
 * too where a result depends on it (matrices, constants, the steps of each table's search), the per-pixel math runs in
 * double precision on those single-precision numbers.
 */

const f32 = Math.fround;

/* Common.h: the constants, as the single-precision numbers OCIO uses */
const PI = f32(3.14159265358979);
const HUE_LIMIT = 360;
const DEG_TO_RAD = PI / 180;
const RAD_TO_DEG = 180 / PI;
const REFERENCE_LUMINANCE = 100;
const L_A = 100;
const Y_B = 20;
const SURROUND = [f32(0.9), f32(0.59), f32(0.9)];
const J_SCALE_INV = f32(1 / 100);
const CAM_NL_OFFSET = f32(f32(0.2713) * 100);
const CAM_NL_SCALE = 400;
const NL_EXP = f32(0.42);
const NL_EXP_INV = f32(1 / NL_EXP);
const RA_MAX = f32(0.99);
const CHROMA_COMPRESS = f32(2.4);
const CHROMA_COMPRESS_FACT = f32(3.3);
const CHROMA_EXPAND = f32(1.3);
const CHROMA_EXPAND_FACT = f32(0.69);
const CHROMA_EXPAND_THR = f32(0.5);
const SMOOTH_CUSPS = f32(0.12);
const SMOOTH_M = f32(0.27);
const CUSP_MID_BLEND = f32(1.3);
const FOCUS_GAIN_BLEND = f32(0.3);
const FOCUS_DISTANCE = f32(1.35);
const FOCUS_DISTANCE_SCALING = f32(1.75);
const COMPRESSION_THRESHOLD = f32(0.75);
const TOE_LIMIT_OFFSET = f32(0.001);
const TOE_K2_MIN = f32(0.001);
const FOCUS_J_MIN = f32(0.0001);
const ONE_SIXTH = f32(1 / 6);
const GAMMA_MAXIMUM = 5;
const GAMMA_SEARCH_STEP = f32(0.4);
const GAMMA_ACCURACY = f32(1e-5);
const CUSP_CORNERS = 6;
const REACH_CUSP_TOLERANCE = f32(1e-3);
const DISPLAY_CUSP_TOLERANCE = f32(1e-7);
const REACH_SEARCH_TOLERANCE = f32(1e-2);
const GAMMA_TEST_POSITIONS = [0.01, 0.1, 0.5, 0.8, 0.99].map(f32);
const CHROMA_NORM_WEIGHTS = [11.34072, 16.46899, 7.8838, 14.66441, -6.37224, 9.19364, 77.12896].map(f32);

/* a hue table: 360 entries one degree apart, one more below and two above so lookups need not wrap */
const TABLE_SIZE = 363;
const FIRST = 1;
const UPPER_WRAP = 361;
const LAST = 360;

/** One pixel through the transform: r, g, b in, written to out[0..2]. @typedef {(r: number, g: number, b: number, out: { [i: number]: number }) => void} Pixel */
/** @typedef {[number, number]} XY */
/** @typedef {{ red: XY, green: XY, blue: XY, white: XY }} Primaries */
/** @typedef {number[]} M33 row-major 3×3 */
/**
 * The CAM16-based model OCIO calls JMhParams, for one set of primaries.
 * @typedef {{ toCam: M33, fromCam: M33, toAab: M33, fromAab: M33, F_L_n: number, cz: number, inv_cz: number, A_w_J: number, inv_A_w_J: number }} Model
 */

const AP0 = /** @type {Primaries} */ ({ red: [0.7347, 0.2653], green: [0, 1], blue: [0.0001, -0.077], white: [0.32168, 0.33767] });
const AP1 = /** @type {Primaries} */ ({ red: [0.713, 0.293], green: [0.165, 0.83], blue: [0.128, 0.044], white: [0.32168, 0.33767] });
const CAM16 = /** @type {Primaries} */ ({ red: [0.8336, 0.1735], green: [2.3854, -1.4659], blue: [0.087, -0.125], white: [0.333, 0.333] });

/**
 * The transform for these params: everything precomputed, then a function of one pixel.
 * @param {ArrayLike<number>} params peak nits, red x y, green x y, blue x y, white x y
 * @param {boolean} [inverse] display RGB to ACES2065-1 instead
 * @returns {Pixel}
 */
export function acesOutput20(params, inverse = false) {
  if (!params || params.length !== 9) throw new Error(`ACES 2.0 Output Transform takes 9 params, not ${params?.length ?? 0}`);
  const p = Array.from(params, Number);
  if (p.some((v) => !Number.isFinite(v))) throw new Error('ACES 2.0 Output Transform params must be numbers');
  /* FixedFunctionOpData.cpp: the peak is a whole number of nits from 1 to 10000 */
  if (!(p[0] >= 1 && p[0] <= 10000) || !Number.isInteger(p[0])) throw new Error(`ACES 2.0 peak luminance must be a whole number from 1 to 10000, not ${p[0]}`);
  const [peak, rx, ry, gx, gy, bx, by, wx, wy] = p.map(f32);
  const limiting = /** @type {Primaries} */ ({ red: [rx, ry], green: [gx, gy], blue: [bx, by], white: [wx, wy] });

  /* FixedFunctionOpCPU.cpp, Renderer_ACES_OutputTransform20: the same order of setup */
  const pIn = initModel(AP0);
  const pOut = initModel(limiting);
  const ts = initToneScale(peak);
  const reach = initModel(AP1);
  const limitJMax = yToJF(peak, pIn);
  const modelGammaInv = f32(1 / modelGamma());
  const reachTable = makeReachMTable(reach, limitJMax);
  const cc = initChromaCompress(peak, ts);
  const gc = initGamutCompress(peak, pIn, pOut, ts, limitJMax, reach);

  const shared = { limitJMax, modelGammaInv, reachTable };
  return inverse ? inversePixel(pIn, pOut, ts, cc, gc, shared) : forwardPixel(pIn, pOut, ts, cc, gc, shared);
}

/**
 * @typedef {ReturnType<typeof initToneScale>} ToneScale
 * @typedef {ReturnType<typeof initChromaCompress>} ChromaCompress
 * @typedef {ReturnType<typeof initGamutCompress>} GamutCompress
 * @typedef {{ limitJMax: number, modelGammaInv: number, reachTable: Float32Array }} Shared
 */

/**
 * ACES2065-1 to display RGB (Renderer_ACES_OutputTransform20::fwd).
 * @param {Model} pIn @param {Model} pOut @param {ToneScale} ts @param {ChromaCompress} cc @param {GamutCompress} gc
 * @param {Shared} sh @returns {Pixel}
 */
function forwardPixel(pIn, pOut, ts, cc, gc, sh) {
  const m = pIn.toCam;
  const q = pIn.toAab;
  const cz = pIn.cz;
  const jmh = [0, 0, 0];
  return (r, g, b, out) => {
    const r0 = m[0] * r + m[1] * g + m[2] * b;
    const r1 = m[3] * r + m[4] * g + m[5] * b;
    const r2 = m[6] * r + m[7] * g + m[8] * b;
    const a0 = coneFwd(r0);
    const a1 = coneFwd(r1);
    const a2 = coneFwd(r2);
    const A = q[0] * a0 + q[1] * a1 + q[2] * a2;
    const a = q[3] * a0 + q[4] * a1 + q[5] * a2;
    const bb = q[6] * a0 + q[7] * a1 + q[8] * a2;
    let J = 0;
    let M = 0;
    let h = 0;
    if (A > 0) {
      J = 100 * Math.pow(A, cz);
      M = Math.sqrt(a * a + bb * bb);
      h = fromRadians(Math.atan2(bb, a));
    }
    const reachMaxM = reachMFromTable(h, sh.reachTable);
    const hr = h * DEG_TO_RAD;
    const cos = Math.cos(hr);
    const sin = Math.sin(hr);
    const Mnorm = chromaCompressNorm(cos, sin, cc.scale);

    const Jts = toneScaleAToJFwd(A, pIn, ts);
    const Mcp = chromaCompressFwd(J, M, Jts, Mnorm, reachMaxM, sh, cc);
    gamutCompressFwd(Jts, Mcp, h, reachMaxM, sh, gc, jmh);

    jmhToRgb(jmh[0], jmh[1], cos, sin, pOut, out);
  };
}

/**
 * Display RGB to ACES2065-1 (Renderer_ACES_OutputTransform20::inv).
 * @param {Model} pIn @param {Model} pOut @param {ToneScale} ts @param {ChromaCompress} cc @param {GamutCompress} gc
 * @param {Shared} sh @returns {Pixel}
 */
function inversePixel(pIn, pOut, ts, cc, gc, sh) {
  const jmh = [0, 0, 0];
  const tm = [0, 0, 0];
  return (r, g, b, out) => {
    rgbToJmh(r, g, b, pOut, jmh);
    const h = jmh[2];
    const reachMaxM = reachMFromTable(h, sh.reachTable);
    const hr = h * DEG_TO_RAD;
    const cos = Math.cos(hr);
    const sin = Math.sin(hr);
    const Mnorm = chromaCompressNorm(cos, sin, cc.scale);

    gamutCompressInv(jmh[0], jmh[1], h, reachMaxM, sh, gc, tm);
    const J = toneScaleInv(tm[0], pIn, ts);
    const M = chromaCompressInv(tm[0], tm[1], J, Mnorm, reachMaxM, sh, cc);

    jmhToRgb(J, M, cos, sin, pIn, out);
  };
}

/* the model (CAM16, adapted as ACES 2 uses it) */

/** The post-adaptation cone response compression, signed. @param {number} v */
function coneFwd(v) {
  const x = v < 0 ? -v : v;
  const F = Math.pow(x, NL_EXP);
  const Ra = F / (CAM_NL_OFFSET + F);
  return v < 0 ? -Ra : Ra;
}

/** Its unsigned inverse, held below the asymptote. @param {number} Ra */
function coneInvAbs(Ra) {
  const lim = RA_MAX < Ra ? RA_MAX : Ra;
  return Math.pow((CAM_NL_OFFSET * lim) / (1 - lim), NL_EXP_INV);
}

/** @param {number} v */
function coneInv(v) {
  const Rc = coneInvAbs(v < 0 ? -v : v);
  return v < 0 ? -Rc : Rc;
}

/** A hue in degrees from atan2's radians, in [0, 360). @param {number} rad */
function fromRadians(rad) {
  const h = rad * RAD_TO_DEG;
  return h < 0 ? h + HUE_LIMIT : h;
}

/** JMh of an RGB triple in a model's primaries. @param {number} r @param {number} g @param {number} b @param {Model} p @param {number[]} out */
function rgbToJmh(r, g, b, p, out) {
  const m = p.toCam;
  const q = p.toAab;
  const a0 = coneFwd(m[0] * r + m[1] * g + m[2] * b);
  const a1 = coneFwd(m[3] * r + m[4] * g + m[5] * b);
  const a2 = coneFwd(m[6] * r + m[7] * g + m[8] * b);
  const A = q[0] * a0 + q[1] * a1 + q[2] * a2;
  if (A <= 0) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    return;
  }
  const a = q[3] * a0 + q[4] * a1 + q[5] * a2;
  const b2 = q[6] * a0 + q[7] * a1 + q[8] * a2;
  out[0] = 100 * Math.pow(A, p.cz);
  out[1] = Math.sqrt(a * a + b2 * b2);
  out[2] = fromRadians(Math.atan2(b2, a));
}

/** The achromatic response alone (RGB_to_Aab(...)[0]). @param {number} r @param {number} g @param {number} b @param {Model} p */
function rgbToA(r, g, b, p) {
  const m = p.toCam;
  const q = p.toAab;
  return q[0] * coneFwd(m[0] * r + m[1] * g + m[2] * b) + q[1] * coneFwd(m[3] * r + m[4] * g + m[5] * b) + q[2] * coneFwd(m[6] * r + m[7] * g + m[8] * b);
}

/**
 * RGB of a J and M at a hue given by its cosine and sine.
 * @param {number} J @param {number} M @param {number} cos @param {number} sin @param {Model} p @param {{ [i: number]: number }} out
 */
function jmhToRgb(J, M, cos, sin, p, out) {
  const A = Math.pow(J * J_SCALE_INV, p.inv_cz);
  const a = M * cos;
  const b = M * sin;
  const q = p.fromAab;
  const c0 = coneInv(q[0] * A + q[1] * a + q[2] * b);
  const c1 = coneInv(q[3] * A + q[4] * a + q[5] * b);
  const c2 = coneInv(q[6] * A + q[7] * a + q[8] * b);
  const m = p.fromCam;
  out[0] = m[0] * c0 + m[1] * c1 + m[2] * c2;
  out[1] = m[3] * c0 + m[4] * c1 + m[5] * c2;
  out[2] = m[6] * c0 + m[7] * c1 + m[8] * c2;
}

/** @param {number} J @param {number} M @param {number} h @param {Model} p @param {number[]} out */
function jmhToRgbAtHue(J, M, h, p, out) {
  const hr = h * DEG_TO_RAD;
  jmhToRgb(J, M, Math.cos(hr), Math.sin(hr), p, out);
}

/** @param {number} A @param {Model} p */
const aToY = (A, p) => coneInvAbs(p.A_w_J * A) / p.F_L_n;
/** @param {number} absJ @param {Model} p */
const jToY = (absJ, p) => aToY(Math.pow(absJ * J_SCALE_INV, p.inv_cz), p);
/** @param {number} absY @param {Model} p */
function yToJAbs(absY, p) {
  const F = Math.pow(absY * p.F_L_n, NL_EXP);
  const Ra = F / (CAM_NL_OFFSET + F);
  return 100 * Math.pow(Ra * p.inv_A_w_J, p.cz);
}
/** J of a positive luminance in single precision, as OCIO's setup computes limitJMax and midJ. @param {number} Y @param {Model} p */
function yToJF(Y, p) {
  const F = f32(Math.pow(f32(Y * p.F_L_n), NL_EXP));
  const Ra = f32(F / f32(CAM_NL_OFFSET + F));
  return f32(100 * f32(Math.pow(f32(Ra * p.inv_A_w_J), p.cz)));
}

/** c·z, the model's nonlinearity. */
const modelGamma = () => f32(SURROUND[1] * f32(f32(1.48) + f32(Math.sqrt(f32(Y_B / REFERENCE_LUMINANCE)))));

/** init_JMhParams, in single precision as OCIO computes it. @param {Primaries} prims @returns {Model} */
function initModel(prims) {
  const base = [2, 1, 1 / 20, 1, -12 / 11, 1 / 11, 1 / 9, 1 / 9, -2 / 9].map(f32);
  const matrix16 = xyzToRgb(CAM16);
  const toXyz = rgbToXyz(prims);
  const XYZ_w = mulVecF(toXyz, [REFERENCE_LUMINANCE, REFERENCE_LUMINANCE, REFERENCE_LUMINANCE]);
  const Y_W = XYZ_w[1];
  const RGB_w = mulVecF(matrix16, XYZ_w);

  const K = f32(1 / (5 * L_A + 1));
  const K4 = f32(f32(f32(K * K) * K) * K);
  const F_L = f32(f32(f32(f32(0.2) * K4) * (5 * L_A)) + f32(f32(f32(0.1) * f32(Math.pow(f32(1 - K4), 2))) * f32(Math.pow(5 * L_A, f32(1 / 3)))));
  const F_L_n = f32(F_L / REFERENCE_LUMINANCE);
  const cz = modelGamma();
  const inv_cz = f32(1 / cz);

  const D_RGB = RGB_w.map((w) => f32(f32(F_L_n * Y_W) / w));
  const RGB_AW = RGB_w.map((w, i) => f32(coneFwd(f32(D_RGB[i] * w))));
  const coneToAab = mulF(diag(CAM_NL_SCALE, CAM_NL_SCALE, CAM_NL_SCALE), base);
  const A_w = f32(f32(f32(coneToAab[0] * RGB_AW[0]) + f32(coneToAab[1] * RGB_AW[1])) + f32(coneToAab[2] * RGB_AW[2]));
  const A_w_J = f32(coneFwd(F_L));
  const inv_A_w_J = f32(1 / A_w_J);

  const rgbToCam = mulF(mulF(xyzToRgb(CAM16), rgbToXyz(prims)), diag(REFERENCE_LUMINANCE, REFERENCE_LUMINANCE, REFERENCE_LUMINANCE));
  const toCam = mulF(diag(D_RGB[0], D_RGB[1], D_RGB[2]), rgbToCam);
  const toAab = coneToAab.map((v, i) => (i < 3 ? f32(v / A_w) : f32(f32(v * 43) * SURROUND[2])));
  return { toCam, fromCam: invertF(toCam), toAab, fromAab: invertF(toAab), F_L_n, cz, inv_cz, A_w_J, inv_A_w_J };
}

/* matrices (ColorMatrixHelpers.cpp in double, then cast to single as MatrixLib.h does) */

/** RGB to XYZ in double precision (rgb2xyz_from_xy). @param {Primaries} P @returns {M33} */
function rgbToXyzD(P) {
  const cols = [P.red, P.green, P.blue];
  const m = [cols[0][0], cols[1][0], cols[2][0], cols[0][1], cols[1][1], cols[2][1], 1 - cols[0][0] - cols[0][1], 1 - cols[1][0] - cols[1][1], 1 - cols[2][0] - cols[2][1]];
  const inv = invertD(m);
  const [wx, wy] = P.white;
  const W = [wx / wy, 1, (1 - wx - wy) / wy];
  const gains = [0, 1, 2].map((i) => W[0] * inv[i * 3] + W[1] * inv[i * 3 + 1] + W[2] * inv[i * 3 + 2]);
  return m.map((v, k) => gains[k % 3] * v);
}
/** @param {Primaries} P */
const rgbToXyz = (P) => rgbToXyzD(P).map(f32);
/** @param {Primaries} P */
const xyzToRgb = (P) => invertD(rgbToXyzD(P)).map(f32);
/** A single-precision matrix inverted in double precision, as invert_f33 does. @param {M33} m */
const invertF = (m) => invertD(m).map(f32);

/** Gauss-Jordan inversion with partial pivoting, in double precision (MatrixOpData::MatrixArray::inverse). @param {M33} m @returns {M33} */
function invertD(m) {
  const t = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
  const s = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let i = 0; i < 3; i++) {
    let pivot = i;
    let size = Math.abs(t[i][i]);
    for (let j = i + 1; j < 3; j++) if (Math.abs(t[j][i]) > size) { pivot = j; size = Math.abs(t[j][i]); }
    if (size === 0) throw new Error('ACES 2.0: a singular matrix (are the limiting primaries distinct?)');
    if (pivot !== i) { [t[i], t[pivot]] = [t[pivot], t[i]]; [s[i], s[pivot]] = [s[pivot], s[i]]; }
    for (let j = i + 1; j < 3; j++) {
      const f = t[j][i] / t[i][i];
      for (let k = 0; k < 3; k++) { t[j][k] -= f * t[i][k]; s[j][k] -= f * s[i][k]; }
    }
  }
  for (let i = 2; i >= 0; i--) {
    const f = t[i][i];
    for (let k = 0; k < 3; k++) { t[i][k] /= f; s[i][k] /= f; }
    for (let j = 0; j < i; j++) {
      const g = t[j][i];
      for (let k = 0; k < 3; k++) { t[j][k] -= g * t[i][k]; s[j][k] -= g * s[i][k]; }
    }
  }
  return [...s[0], ...s[1], ...s[2]];
}

/** A 3×3 product in single precision (mult_f33_f33). @param {M33} a @param {M33} b @returns {M33} */
function mulF(a, b) {
  const o = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o.push(f32(f32(f32(a[r * 3] * b[c]) + f32(a[r * 3 + 1] * b[3 + c])) + f32(a[r * 3 + 2] * b[6 + c])));
  return o;
}
/** @param {M33} m @param {number[]} v */
const mulVecF = (m, v) => [0, 1, 2].map((r) => f32(f32(f32(v[0] * m[r * 3]) + f32(v[1] * m[r * 3 + 1])) + f32(v[2] * m[r * 3 + 2])));
/** @param {number} a @param {number} b @param {number} c @returns {M33} */
const diag = (a, b, c) => [a, 0, 0, 0, b, 0, 0, 0, c];

/* tonescale */

/** init_ToneScaleParams, in single precision. @param {number} n peak nits */
function initToneScale(n) {
  const n_r = 100;
  const g = f32(1.15);
  const c = f32(0.18);
  const c_d = f32(10.013);
  const w_g = f32(0.14);
  const t_1 = f32(0.04);
  const r_hit_min = 128;
  const r_hit_max = 896;
  const logf = (/** @type {number} */ x) => f32(Math.log(x));
  const powf = (/** @type {number} */ x, /** @type {number} */ y) => f32(Math.pow(x, y));
  const sqrtf = (/** @type {number} */ x) => f32(Math.sqrt(x));
  const r_hit = f32(r_hit_min + f32((r_hit_max - r_hit_min) * f32(logf(f32(n / n_r)) / logf(f32(10000 / 100)))));
  const m_0 = f32(n / n_r);
  const m_1 = f32(f32(0.5) * f32(m_0 + sqrtf(f32(m_0 * f32(m_0 + f32(4 * t_1))))));
  const rm = f32(r_hit / m_1);
  const u = powf(f32(rm / f32(rm + 1)), g);
  const m = f32(m_1 / u);
  const w_i = f32(logf(f32(n / 100)) / logf(2));
  const c_t = f32(f32(c_d / n_r) * f32(1 + f32(w_i * w_g)));
  const g_ip = f32(f32(0.5) * f32(c_t + sqrtf(f32(c_t * f32(c_t + f32(4 * t_1))))));
  const gm = powf(f32(g_ip / m), f32(1 / g));
  const g_ipp2 = f32(-f32(m_1 * gm) / f32(gm - 1));
  const w_2 = f32(c / g_ipp2);
  const s_2 = f32(f32(w_2 * m_1) * REFERENCE_LUMINANCE);
  const u_2 = powf(f32(rm / f32(rm + w_2)), g);
  const m_2 = f32(m_1 / u_2);
  const inverse_limit = f32(n / f32(u_2 * n_r));
  const forward_limit = f32(8 * r_hit);
  const log_peak = f32(Math.log10(f32(n / n_r)));
  return { n, n_r, g, g_inv: f32(1 / g), t_1, c_t, s_2, m_2, forward_limit, inverse_limit, log_peak };
}

/** The tonescale in luminance, forward. @param {number} Y @param {ToneScale} t */
function tonescaleFwd(Y, t) {
  const f = t.m_2 * Math.pow(Y / (Y + t.s_2), t.g);
  const y = (f * f) / (f + t.t_1);
  /* std::max(0, y): a NaN (a negative achromatic response) gives 0 */
  return (0 < y ? y : 0) * t.n_r;
}

/** And back. @param {number} Yts @param {ToneScale} t */
function tonescaleInv(Yts, t) {
  const n = Yts / REFERENCE_LUMINANCE;
  const lim = n < t.inverse_limit ? n : t.inverse_limit;
  const Z = 0 < lim ? lim : 0;
  const f = (Z + Math.sqrt(Z * (4 * t.t_1 + Z))) / 2;
  return t.s_2 / (Math.pow(t.m_2 / f, t.g_inv) - 1);
}

/** tonescale_A_to_J_fwd. @param {number} A @param {Model} p @param {ToneScale} t */
function toneScaleAToJFwd(A, p, t) {
  const J = yToJAbs(tonescaleFwd(aToY(A, p), t), p);
  return A < 0 ? -J : J;
}

/** tonescale_inv. @param {number} J @param {Model} p @param {ToneScale} t */
function toneScaleInv(J, p, t) {
  const out = yToJAbs(tonescaleInv(jToY(J < 0 ? -J : J, p), t), p);
  return J < 0 ? -out : out;
}

/* chroma compression */

/** init_ChromaCompressParams, in single precision. @param {number} peak @param {ToneScale} t */
function initChromaCompress(peak, t) {
  const compr = f32(CHROMA_COMPRESS + f32(f32(CHROMA_COMPRESS * CHROMA_COMPRESS_FACT) * t.log_peak));
  const s = f32(CHROMA_EXPAND - f32(f32(CHROMA_EXPAND * CHROMA_EXPAND_FACT) * t.log_peak));
  const sat = f32(0.2) < s ? s : f32(0.2);
  const sat_thr = f32(CHROMA_EXPAND_THR / t.n);
  const scale = f32(f32(Math.pow(f32(f32(0.03379) * peak), f32(0.30596))) - f32(0.45135));
  return { sat, sat_thr, compr, scale };
}

/** The hue-dependent chroma normalization. @param {number} c1 @param {number} s1 @param {number} scale */
function chromaCompressNorm(c1, s1, scale) {
  const w = CHROMA_NORM_WEIGHTS;
  const c2 = 2 * c1 * c1 - 1;
  const s2 = 2 * c1 * s1;
  const c3 = 4 * c1 * c1 * c1 - 3 * c1;
  const s3 = 3 * s1 - 4 * s1 * s1 * s1;
  return (w[0] * c1 + w[1] * c2 + w[2] * c3 + w[3] * s1 + w[4] * s2 + w[5] * s3 + w[6]) * scale;
}

/** @param {number} x @param {number} limit @param {number} k1In @param {number} k2In */
function toeFwd(x, limit, k1In, k2In) {
  if (x > limit) return x;
  const k2 = k2In < TOE_K2_MIN ? TOE_K2_MIN : k2In;
  const k1 = Math.sqrt(k1In * k1In + k2 * k2);
  const k3 = (limit + k1) / (limit + k2);
  const minusB = k3 * x - k1;
  const minusAc = k2 * k3 * x;
  return 0.5 * (minusB + Math.sqrt(minusB * minusB + 4 * minusAc));
}

/** @param {number} x @param {number} limit @param {number} k1In @param {number} k2In */
function toeInv(x, limit, k1In, k2In) {
  if (x > limit) return x;
  const k2 = k2In < TOE_K2_MIN ? TOE_K2_MIN : k2In;
  const k1 = Math.sqrt(k1In * k1In + k2 * k2);
  const k3 = (limit + k1) / (limit + k2);
  return (x * x + k1 * x) / (k3 * (x + k2));
}

/**
 * chroma_compress_fwd: the compressed M (J becomes Jts, h stays).
 * @param {number} J @param {number} M @param {number} Jts @param {number} Mnorm @param {number} reachMaxM
 * @param {Shared} sh @param {ChromaCompress} cc
 */
function chromaCompressFwd(J, M, Jts, Mnorm, reachMaxM, sh, cc) {
  if (M === 0) return M;
  const nJ = Jts / sh.limitJMax;
  const s = 1 - nJ;
  const snJ = 0 < s ? s : 0;
  const limit = (Math.pow(nJ, sh.modelGammaInv) * reachMaxM) / Mnorm;
  let m = (M * Math.pow(Jts / J, sh.modelGammaInv)) / Mnorm;
  m = limit - toeFwd(limit - m, limit - TOE_LIMIT_OFFSET, snJ * cc.sat, Math.sqrt(nJ * nJ + cc.sat_thr));
  m = toeFwd(m, limit, nJ * cc.compr, snJ);
  return m * Mnorm;
}

/**
 * chroma_compress_inv: the uncompressed M at the untonemapped J.
 * @param {number} Jts @param {number} Mcp @param {number} J @param {number} Mnorm @param {number} reachMaxM
 * @param {Shared} sh @param {ChromaCompress} cc
 */
function chromaCompressInv(Jts, Mcp, J, Mnorm, reachMaxM, sh, cc) {
  if (Mcp === 0) return Mcp;
  const nJ = Jts / sh.limitJMax;
  const s = 1 - nJ;
  const snJ = 0 < s ? s : 0;
  const limit = (Math.pow(nJ, sh.modelGammaInv) * reachMaxM) / Mnorm;
  let m = Mcp / Mnorm;
  m = toeInv(m, limit, nJ * cc.compr, snJ);
  m = limit - toeInv(limit - m, limit - TOE_LIMIT_OFFSET, snJ * cc.sat, Math.sqrt(nJ * nJ + cc.sat_thr));
  m = m * Mnorm;
  return m * Math.pow(Jts / J, -sh.modelGammaInv);
}

/* gamut compression */

/**
 * init_GamutCompressParams: the cusp of the limiting gamut and the upper hull's gamma at each hue of a near-uniform
 * hue table that also samples every corner of the limiting and the reach gamut.
 * @param {number} peak @param {Model} pIn @param {Model} pOut @param {ToneScale} ts @param {number} limitJMax
 * @param {Model} reach
 */
function initGamutCompress(peak, pIn, pOut, ts, limitJMax, reach) {
  const midJ = yToJF(f32(ts.c_t * REFERENCE_LUMINANCE), pIn);
  const focusDist = f32(FOCUS_DISTANCE + f32(f32(FOCUS_DISTANCE * FOCUS_DISTANCE_SCALING) * ts.log_peak));
  const lowerHullGammaInv = f32(1 / f32(f32(1.14) + f32(f32(0.07) * ts.log_peak)));

  const hues = new Float32Array(TABLE_SIZE);
  const { cuspJ, cuspM, gammaInv } = makeUniformHueGamutTable(reach, pOut, peak, ts.forward_limit, limitJMax, hues);
  const searchRange = hueLinearitySearchRange(gammaInv);
  makeUpperHullGamma(hues, cuspJ, cuspM, gammaInv, peak, limitJMax, midJ, focusDist, lowerHullGammaInv, pOut);
  return { midJ, focusDist, lowerHullGammaInv, hues, cuspJ, cuspM, gammaInv, lo: searchRange[0], hi: searchRange[1] };
}

/** (b - a) * t + a, lerpf. @param {number} a @param {number} b @param {number} t */
const lerp = (a, b, t) => (b - a) * t + a;

/** reach_m_from_table: the table is one degree apart. @param {number} h @param {Float32Array} table */
function reachMFromTable(h, table) {
  const base = Math.trunc(h);
  const i = base + FIRST;
  return lerp(table[i], table[i + 1], h - base);
}

/** The upper index of the hue table interval holding h (lookup_hue_interval). @param {number} h @param {GamutCompress} gc */
function lookupHueInterval(h, gc) {
  const hues = gc.hues;
  let i = FIRST + Math.trunc(h);
  let lo = Math.max(0, i + gc.lo);
  let hi = Math.min(UPPER_WRAP, i + gc.hi);
  while (lo + 1 < hi) {
    if (h > hues[i]) lo = i;
    else hi = i;
    i = (lo + hi) >>> 1;
  }
  return hi < 1 ? 1 : hi;
}

/** @param {number} J @param {number} threshold @param {number} limitJMax @param {number} focusDist */
function focusGain(J, threshold, limitJMax, focusDist) {
  let gain = limitJMax * focusDist;
  if (J > threshold) {
    const d = limitJMax - J;
    let adjust = Math.log10((limitJMax - threshold) / (FOCUS_J_MIN < d ? d : FOCUS_J_MIN));
    adjust = adjust * adjust + 1;
    gain = gain * adjust;
  }
  return gain;
}

/** @param {number} J @param {number} M @param {number} focusJ @param {number} maxJ @param {number} slopeGain */
function solveJIntersect(J, M, focusJ, maxJ, slopeGain) {
  const Ms = M / slopeGain;
  const a = Ms / focusJ;
  if (J < focusJ) {
    const b = 1 - Ms;
    const c = -J;
    const root = Math.sqrt(b * b - 4 * a * c);
    return (-2 * c) / (b + root);
  }
  const b = -(1 + Ms + maxJ * a);
  const c = maxJ * Ms + J;
  const root = Math.sqrt(b * b - 4 * a * c);
  return (-2 * c) / (b - root);
}

/** @param {number} a @param {number} b @param {number} ref */
function sminScaled(a, b, ref) {
  const s = SMOOTH_CUSPS * ref;
  const d = s - Math.abs(a - b);
  const h = (d < 0 ? 0 : d) / s;
  return (b < a ? b : a) - h * h * h * s * ONE_SIXTH;
}

/** @param {number} intersectJ @param {number} focusJ @param {number} limitJMax @param {number} slopeGain */
function compressionVectorSlope(intersectJ, focusJ, limitJMax, slopeGain) {
  const scaler = intersectJ < focusJ ? intersectJ : limitJMax - intersectJ;
  return (scaler * (intersectJ - focusJ)) / (focusJ * slopeGain);
}

/**
 * @param {number} Jaxis @param {number} slope @param {number} invGamma @param {number} Jmax @param {number} Mmax
 * @param {number} Jref
 */
function lineBoundaryIntersectionM(Jaxis, slope, invGamma, Jmax, Mmax, Jref) {
  const shifted = Jref * Math.pow(Jaxis / Jref, invGamma);
  return (shifted * Mmax) / (Jmax - slope * Mmax);
}

/**
 * @param {number} cuspJ @param {number} cuspM @param {number} Jmax @param {number} gammaTopInv @param {number} gammaBottomInv
 * @param {number} JiSource @param {number} slope @param {number} JiCusp
 */
function gamutBoundaryIntersection(cuspJ, cuspM, Jmax, gammaTopInv, gammaBottomInv, JiSource, slope, JiCusp) {
  const lower = lineBoundaryIntersectionM(JiSource, slope, gammaBottomInv, cuspJ, cuspM, JiCusp);
  /* the upper hull is flipped, zeroed at Jmax, and the slope negated */
  const upper = lineBoundaryIntersectionM(Jmax - JiSource, -slope, gammaTopInv, Jmax - cuspJ, cuspM, Jmax - JiCusp);
  return sminScaled(lower, upper, cuspM);
}

/** @param {number} M @param {number} gamutM @param {number} reachM @param {boolean} invert */
function remapM(M, gamutM, reachM, invert) {
  const ratio = gamutM / reachM;
  const proportion = ratio < COMPRESSION_THRESHOLD ? COMPRESSION_THRESHOLD : ratio;
  const threshold = proportion * gamutM;
  if (M <= threshold || proportion >= 1) return M;
  const mOffset = M - threshold;
  const gamutOffset = gamutM - threshold;
  const reachOffset = reachM - threshold;
  const scale = reachOffset / (reachOffset / gamutOffset - 1);
  const nd = mOffset / scale;
  if (!invert) return threshold + (scale * nd) / (1 + nd);
  return threshold + (nd >= 1 ? scale : scale * -(nd / (nd - 1)));
}

/**
 * The hue-dependent values at h, looked up in the tables (init_HueDependantGamutParams).
 * @param {number} h @param {Shared} sh @param {GamutCompress} gc @param {number[]} out cuspJ, cuspM, gammaTopInv, focusJ, threshold
 */
function hueParams(h, sh, gc, out) {
  const i = lookupHueInterval(h, gc);
  const t = (h - gc.hues[i - 1]) / (gc.hues[i] - gc.hues[i - 1]);
  const cuspJ = lerp(gc.cuspJ[i - 1], gc.cuspJ[i], t);
  out[0] = cuspJ;
  out[1] = lerp(gc.cuspM[i - 1], gc.cuspM[i], t);
  out[2] = lerp(gc.gammaInv[i - 1], gc.gammaInv[i], t);
  out[3] = focusJOf(cuspJ, gc.midJ, sh.limitJMax);
  out[4] = lerp(cuspJ, sh.limitJMax, FOCUS_GAIN_BLEND);
}

/** @param {number} cuspJ @param {number} midJ @param {number} limitJMax */
function focusJOf(cuspJ, midJ, limitJMax) {
  const w = CUSP_MID_BLEND - cuspJ / limitJMax;
  return lerp(cuspJ, midJ, w < 1 ? w : 1);
}

/**
 * compressGamut: J and M toward the focus, M remapped between the gamut and the reach boundary.
 * @param {number} J @param {number} M @param {number} Jx @param {number} reachMaxM @param {Shared} sh
 * @param {GamutCompress} gc @param {number[]} hp @param {boolean} invert @param {number[]} out J, M
 */
function compressGamut(J, M, Jx, reachMaxM, sh, gc, hp, invert, out) {
  const [cuspJ, cuspM, gammaTopInv, focusJ, threshold] = hp;
  const slopeGain = focusGain(Jx, threshold, sh.limitJMax, gc.focusDist);
  const JiSource = solveJIntersect(J, M, focusJ, sh.limitJMax, slopeGain);
  const slope = compressionVectorSlope(JiSource, focusJ, sh.limitJMax, slopeGain);
  const JiCusp = solveJIntersect(cuspJ, cuspM, focusJ, sh.limitJMax, slopeGain);
  const gamutM = gamutBoundaryIntersection(cuspJ, cuspM, sh.limitJMax, gammaTopInv, gc.lowerHullGammaInv, JiSource, slope, JiCusp);
  if (gamutM <= 0) {
    out[0] = J;
    out[1] = 0;
    return;
  }
  const reachM = lineBoundaryIntersectionM(JiSource, slope, sh.modelGammaInv, sh.limitJMax, reachMaxM, sh.limitJMax);
  const m = remapM(M, gamutM, reachM, invert);
  out[0] = JiSource + m * slope;
  out[1] = m;
}

const hpScratch = [0, 0, 0, 0, 0];

/**
 * gamut_compress_fwd. @param {number} J @param {number} M @param {number} h @param {number} reachMaxM @param {Shared} sh
 * @param {GamutCompress} gc @param {number[]} out J, M, h
 */
function gamutCompressFwd(J, M, h, reachMaxM, sh, gc, out) {
  out[2] = h;
  if (J <= 0) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  /* M only is compressed; above the expected maximum M is 0 */
  if (M <= 0 || J > sh.limitJMax) {
    out[0] = J;
    out[1] = 0;
    return;
  }
  hueParams(h, sh, gc, hpScratch);
  compressGamut(J, M, J, reachMaxM, sh, gc, hpScratch, false, out);
}

/**
 * gamut_compress_inv. @param {number} J @param {number} M @param {number} h @param {number} reachMaxM @param {Shared} sh
 * @param {GamutCompress} gc @param {number[]} out J, M, h
 */
function gamutCompressInv(J, M, h, reachMaxM, sh, gc, out) {
  out[2] = h;
  if (J <= 0) {
    out[0] = 0;
    out[1] = 0;
    return;
  }
  if (M <= 0 || J > sh.limitJMax) {
    out[0] = J;
    out[1] = 0;
    return;
  }
  hueParams(h, sh, gc, hpScratch);
  let Jx = J;
  /* above the threshold the focus gain depends on J itself: approximate it from a first pass */
  if (Jx > hpScratch[4]) {
    compressGamut(J, M, Jx, reachMaxM, sh, gc, hpScratch, true, out);
    Jx = out[0];
  }
  compressGamut(J, M, Jx, reachMaxM, sh, gc, hpScratch, true, out);
}

/* the tables */

/** The unit cube's corners in hue order R, Y, G, C, B, M. @param {number} c */
const cubeCorner = (c) => [+((c + 1) % CUSP_CORNERS < 3), +((c + 5) % CUSP_CORNERS < 3), +((c + 3) % CUSP_CORNERS < 3)];

/** @param {number[]} rgb */
const anyBelowZero = (rgb) => rgb[0] < 0 || rgb[1] < 0 || rgb[2] < 0;

/**
 * The largest M at limitJMax each whole degree still inside the reach gamut (make_reach_m_table).
 * @param {Model} reach @param {number} limitJMax
 */
function makeReachMTable(reach, limitJMax) {
  const table = new Float32Array(TABLE_SIZE);
  const rgb = [0, 0, 0];
  for (let i = 0; i < 360; i++) {
    const hue = i;
    let low = 0;
    let high = 50;
    let outside = false;
    while (!outside && high < 1300) {
      jmhToRgbAtHue(limitJMax, high, hue, reach, rgb);
      outside = anyBelowZero(rgb);
      if (!outside) {
        low = high;
        high = high + 50;
      }
    }
    while (high - low > REACH_SEARCH_TOLERANCE) {
      const m = f32((high + low) / 2);
      jmhToRgbAtHue(limitJMax, m, hue, reach, rgb);
      if (anyBelowZero(rgb)) high = m;
      else low = m;
    }
    table[i + FIRST] = high;
  }
  wrap(table);
  return table;
}

/** The entries below and above the nominal 360, copied round. @param {Float32Array} t */
function wrap(t) {
  t[0] = t[LAST];
  t[UPPER_WRAP] = t[FIRST];
  t[UPPER_WRAP + 1] = t[FIRST + 1];
}

/**
 * Six corners as a cycle, lowest hue at [1], [0] and [7] copies with their hues wrapped below 0 and past 360.
 * @template T @param {T[]} items @param {number[][]} jmh
 */
function cycle(items, jmh) {
  let min = 0;
  for (let i = 1; i < CUSP_CORNERS; i++) if (jmh[i][2] < jmh[min][2]) min = i;
  const rot = (/** @type {number} */ i) => (i + min) % CUSP_CORNERS;
  const outItems = [items[rot(5)], ...[0, 1, 2, 3, 4, 5].map((i) => items[rot(i)]), items[rot(0)]];
  const outJmh = [jmh[rot(5)], ...[0, 1, 2, 3, 4, 5].map((i) => jmh[rot(i)]), jmh[rot(0)]].map((v) => [...v]);
  outJmh[0][2] = f32(outJmh[0][2] - HUE_LIMIT);
  outJmh[CUSP_CORNERS + 1][2] = f32(outJmh[CUSP_CORNERS + 1][2] + HUE_LIMIT);
  return { items: outItems, jmh: outJmh };
}

/** JMh as OCIO stores it, in single precision. @param {number[]} rgb @param {Model} p */
function jmhF(rgb, p) {
  const o = [0, 0, 0];
  rgbToJmh(rgb[0], rgb[1], rgb[2], p, o);
  return o.map(f32);
}

/**
 * make_uniform_hue_gamut_table: the hue table (written into `hues`) and the limiting gamut's cusp at each of its hues.
 * @param {Model} reach @param {Model} limit @param {number} peak @param {number} forwardLimit @param {number} limitJMax
 * @param {Float32Array} hues
 */
function makeUniformHueGamutTable(reach, limit, peak, forwardLimit, limitJMax, hues) {
  /* the reach gamut's corners where they reach limitJMax, searched on the achromatic response */
  const limitA = Math.pow(limitJMax * J_SCALE_INV, reach.inv_cz);
  const reachJmh = [];
  for (let i = 0; i < CUSP_CORNERS; i++) {
    const v = cubeCorner(i);
    let lower = 0;
    let upper = forwardLimit;
    while (upper - lower > REACH_CUSP_TOLERANCE) {
      const test = f32((lower + upper) / 2);
      const A = rgbToA(test * v[0], test * v[1], test * v[2], reach);
      if (A < limitA) lower = test;
      else upper = test;
      if (A === limitA) break;
    }
    reachJmh.push(jmhF(v.map((c) => upper * c), reach));
  }
  const reachCorners = cycle(reachJmh, reachJmh).jmh;

  /* the limiting gamut's corners at peak luminance */
  const scale = f32(peak / REFERENCE_LUMINANCE);
  const limitRgb = [0, 1, 2, 3, 4, 5].map((i) => cubeCorner(i).map((c) => scale * c));
  const limited = cycle(limitRgb, limitRgb.map((rgb) => jmhF(rgb, limit)));
  const rgbCorners = limited.items;
  const jmhCorners = limited.jmh;

  /* both sets of corner hues merged, sorted and unique (extract_sorted_cube_hues) */
  const sorted = [];
  let ri = 1;
  let di = 1;
  while (ri < CUSP_CORNERS + 1 || di < CUSP_CORNERS + 1) {
    const rh = reachCorners[ri][2];
    const dh = jmhCorners[di][2];
    if (rh === dh) {
      sorted.push(rh);
      ri++;
      di++;
    } else if (rh < dh) {
      sorted.push(rh);
      ri++;
    } else {
      sorted.push(dh);
      di++;
    }
  }
  buildHueTable(hues, sorted);

  const cuspJ = new Float32Array(TABLE_SIZE);
  const cuspM = new Float32Array(TABLE_SIZE);
  const gammaInv = new Float32Array(TABLE_SIZE);
  const previous = [0, 0];
  const mBoost = f32(1 + f32(SMOOTH_M * SMOOTH_CUSPS));
  for (let i = FIRST; i !== UPPER_WRAP; i++) {
    const [J, M] = displayCuspForHue(hues[i], rgbCorners, jmhCorners, limit, previous);
    cuspJ[i] = J;
    cuspM[i] = f32(M * mBoost);
    /* the hue rides in the third column until the upper hull's gamma replaces it */
    gammaInv[i] = hues[i];
  }
  wrap(cuspJ);
  wrap(cuspM);
  gammaInv[0] = hues[0];
  gammaInv[UPPER_WRAP] = hues[UPPER_WRAP];
  gammaInv[UPPER_WRAP + 1] = hues[UPPER_WRAP + 1];
  return { cuspJ, cuspM, gammaInv };
}

/**
 * build_hue_table: 360 hues, near one degree apart, that land on every corner hue.
 * @param {Float32Array} table @param {number[]} sorted
 */
function buildHueTable(table, sorted) {
  const n = sorted.length;
  const counts = new Array(2 * CUSP_CORNERS + 2).fill(0);
  let lastIdx = -1;
  let minIndex = sorted[0] === 0 ? 0 : 1;
  for (let k = 0; k !== n; k++) {
    /* std::round: halves away from zero (hues are not negative) */
    let nominal = Math.min(Math.max(Math.floor(sorted[k] + 0.5), minIndex), 359);
    if (lastIdx === nominal) {
      /* two hues at the same index: move the previous one down if it can, else this one up */
      if (k > 1 && counts[k - 2] !== counts[k - 1] - 1) counts[k - 1] = counts[k - 1] - 1;
      else nominal = nominal + 1;
    }
    counts[k] = Math.min(nominal, 359);
    lastIdx = minIndex = nominal;
  }
  /** @param {number} samples @param {number} lower @param {number} upper @param {number} base */
  const interval = (samples, lower, upper, base) => {
    const delta = f32(f32(upper - lower) / samples);
    for (let i = 0; i < samples; i++) table[base + i] = f32(lower + f32(i * delta));
  };
  let total = 0;
  let i = 0;
  interval(counts[i], 0, sorted[i], total + 1);
  total += counts[i];
  for (++i; i !== n; i++) {
    const samples = counts[i] - counts[i - 1];
    interval(samples, sorted[i - 1], sorted[i], total + 1);
    total += samples;
  }
  interval(360 - total, sorted[i - 1], HUE_LIMIT, total + 1);
  table[0] = f32(table[LAST] - HUE_LIMIT);
  table[UPPER_WRAP] = f32(table[FIRST] + HUE_LIMIT);
  table[UPPER_WRAP + 1] = f32(table[FIRST + 1] + HUE_LIMIT);
}

/**
 * The limiting gamut's cusp (J, M) at a hue: a binary search along the cube edge between the two corners around it
 * (find_display_cusp_for_hue). `previous` carries the edge and position from the last hue, as OCIO's does.
 * @param {number} hue @param {number[][]} rgbCorners @param {number[][]} jmhCorners @param {Model} p @param {number[]} previous
 */
function displayCuspForHue(hue, rgbCorners, jmhCorners, p, previous) {
  let upperCorner = 1;
  for (let i = 1; i !== CUSP_CORNERS + 2; i++) {
    if (jmhCorners[i][2] > hue) {
      upperCorner = i;
      break;
    }
  }
  const lowerCorner = upperCorner - 1;
  if (jmhCorners[lowerCorner][2] === hue) return [jmhCorners[lowerCorner][0], jmhCorners[lowerCorner][1]];

  const lo = rgbCorners[lowerCorner];
  const up = rgbCorners[upperCorner];
  const loHue = jmhCorners[lowerCorner][2];
  const upHue = jmhCorners[upperCorner][2];
  /** @param {number} t */
  const sample = (t) => [0, 1, 2].map((k) => f32(f32(f32(up[k] - lo[k]) * t) + lo[k]));
  let lowerT = upperCorner === previous[0] ? previous[1] : 0;
  let upperT = 1;
  let sampleT = 0;
  while (upperT - lowerT > DISPLAY_CUSP_TOLERANCE) {
    sampleT = f32((lowerT + upperT) / 2);
    const h = jmhF(sample(sampleT), p)[2];
    /* across the 0/360 boundary the direction flips: stay between the two corners' hues */
    if (h < loHue) upperT = sampleT;
    else if (h >= upHue) lowerT = sampleT;
    else if (h > hue) upperT = sampleT;
    else lowerT = sampleT;
  }
  sampleT = f32((lowerT + upperT) / 2);
  const jmh = jmhF(sample(sampleT), p);
  previous[0] = upperCorner;
  previous[1] = sampleT;
  return [jmh[0], jmh[1]];
}

/**
 * How far the hue table strays from uniform, so a lookup searches a few entries, not all (determine_hue_linearity_search_range).
 * @param {Float32Array} hues the cusp table's hue column
 */
function hueLinearitySearchRange(hues) {
  const range = [0, 1];
  for (let i = FIRST; i !== UPPER_WRAP; i++) {
    const delta = i - (FIRST + Math.trunc(hues[i]));
    range[0] = Math.min(range[0], delta);
    range[1] = Math.max(range[1], delta + 1);
  }
  return range;
}

/**
 * The upper hull's gamma at each hue: the smallest that puts five test points of the approximate boundary just
 * outside the limiting gamut (make_upper_hull_gamma). Stored as its reciprocal, replacing the hue column.
 * @param {Float32Array} hues @param {Float32Array} cuspJ @param {Float32Array} cuspM @param {Float32Array} gammaInv
 * @param {number} peak @param {number} limitJMax @param {number} midJ @param {number} focusDist
 * @param {number} lowerHullGammaInv @param {Model} limit
 */
function makeUpperHullGamma(hues, cuspJ, cuspM, gammaInv, peak, limitJMax, midJ, focusDist, lowerHullGammaInv, limit) {
  const luminanceLimit = f32(peak / REFERENCE_LUMINANCE);
  const rgb = [0, 0, 0];
  for (let i = FIRST; i !== UPPER_WRAP; i++) {
    const hue = hues[i];
    const cJ = cuspJ[i];
    const cM = cuspM[i];
    /* generate_gamma_test_data */
    const threshold = f32(lerp(cJ, limitJMax, FOCUS_GAIN_BLEND));
    const focusJ = f32(focusJOf(cJ, midJ, limitJMax));
    const tests = GAMMA_TEST_POSITIONS.map((pos) => {
      const testJ = f32(lerp(cJ, limitJMax, pos));
      const gain = f32(focusGain(testJ, threshold, limitJMax, focusDist));
      const JiSource = f32(solveJIntersect(testJ, cM, focusJ, limitJMax, gain));
      return {
        JiSource,
        slope: f32(compressionVectorSlope(JiSource, focusJ, limitJMax, gain)),
        JiCusp: f32(solveJIntersect(cJ, cM, focusJ, limitJMax, gain)),
      };
    });
    /** evaluate_gamma_fit: every test point lands outside the gamut's top. @param {number} gamma */
    const fits = (gamma) => {
      const topInv = f32(1 / gamma);
      for (const t of tests) {
        const M = gamutBoundaryIntersection(cJ, cM, limitJMax, topInv, lowerHullGammaInv, t.JiSource, t.slope, t.JiCusp);
        const J = t.JiSource + t.slope * M;
        jmhToRgbAtHue(J, M, hue, limit, rgb);
        if (!(rgb[0] > luminanceLimit || rgb[1] > luminanceLimit || rgb[2] > luminanceLimit)) return false;
      }
      return true;
    };
    let low = 0;
    let high = GAMMA_SEARCH_STEP;
    let outside = false;
    while (!outside && high < GAMMA_MAXIMUM) {
      if (!fits(high)) {
        low = high;
        high = f32(high + GAMMA_SEARCH_STEP);
      } else outside = true;
    }
    while (high - low > GAMMA_ACCURACY) {
      const test = f32((high + low) / 2);
      if (fits(test)) high = test;
      else low = test;
    }
    gammaInv[i] = 1 / high;
  }
  gammaInv[0] = gammaInv[LAST];
  gammaInv[UPPER_WRAP] = gammaInv[FIRST];
  gammaInv[UPPER_WRAP + 1] = gammaInv[FIRST + 1];
}
