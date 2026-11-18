// @ts-check
/**
 * Footage straight to the encoder. A film's frames are drawn in a browser and taken as pictures, one at a time: right
 * for pages, and many times slower than it need be for a stretch that is nothing but footage. Such a stretch is read
 * by ffmpeg itself (decoded on the graphics chip where it can be), placed on the stage as the film's CSS places it,
 * and given to the same encoder with the same options as the frames a browser draws, so its part joins theirs as it is.
 * It also leaves out the copy a browser needs of slow-seeking footage and the JPEG each frame is taken as: the
 * footage is encoded once, from the file.
 *
 * What goes this way is decided twice. By what the film says (`layersOf`, `straightPlan`): at every frame of the part
 * one video fills the stage with nothing over it, plain (no fade, no animation, no effect of its CSS), from a file
 * whose colors ffmpeg carries over as the browser does. Then by the picture (`alike`): a frame of each such file is
 * drawn both ways and compared, block by block, so a look the rules did not think of (any CSS at all) keeps its
 * footage in the browser. Anything else is drawn as before, and so is a part ffmpeg fails at.
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readVtt } from './captions.mjs';
import { clipFade, clipSpan, kindOf, lutsOf, readFilmFile, srcHref } from './film-doc.mjs';
import { hardwareDecoding } from './encoders.mjs';
import { ffmpegRate } from './rate.mjs';
import { ffmpeg, fileOf } from './shared.mjs';

/**
 * @typedef {{ fps: number, num: number, den: number }} Rate a frame rate as rate.mjs has it
 * @typedef {'none' | 'screen' | 'video'} Tone how a browser shows a file's tones (TONES)
 * @typedef {{ codec: string, pix: string, w: number, h: number, range: 'tv' | 'pc', matrix: 'bt709' | 'bt601', srgb: boolean, tone: Tone }} Footage a file ffmpeg carries over as the browser shows it
 *   (`srgb`: its transfer is sRGB's; `tone`: how this browser shows its tones, once a frame of it has told)
 * @typedef {{ id: string, kind: 'video' | 'page' | 'still', track: number, at: number, end: number, from: number, speed: number,
 *   file: string | null, fit: 'contain' | 'cover', own: { w: number, h: number }, footage: Footage | null }} Layer
 *   a picture clip that is drawn: where it is on the film, a video's file, and for one that is plain what the file is (`footage`)
 * @typedef {{ tracks: { track: number, cues: { start: number, end: number }[] }[], still: boolean }} Captions
 *   the film's caption tracks that are drawn, each with when its cues are on; `still`: a cue's picture is the same for
 *   as long as it is on (nothing in it moves), so it is drawn once and laid over the footage
 * @typedef {{ stage: { w: number, h: number }, ground: string | null, layers: Layer[], captions: Captions }} Layers
 * @typedef {{ file: string, range: 'tv' | 'pc', matrix: 'bt709' | 'bt601', tone: Tone, fit: 'contain' | 'cover', bars: boolean, want: number, speed: number, frames: number }
 *   | { gap: true, frames: number }} Segment frames of one video in a row (`want`: the file's second its first frame shows), or of the bare stage
 * @typedef {{ key: string, runs: [number, number][], at: number }} Overlay a picture laid over the plan's frames (the caption cues on: `key`
 *   says which), over its frames [a, b) counted from the plan's first, and the film's frame to draw it at
 * @typedef {{ segments: Segment[], frames: number, files: string[], overlays: Overlay[] }} Plan
 */

/** How far before the frame it wants a file is opened: the frames before it are decoded and thrown away. */
const LEAD = 0.5;
/* What sets a frame read straight apart from the one a browser drew, in levels of 255. Measured on footage the two
   draw alike (the same size, scaled down from 4K, cropped to cover, full range): a block of 8 × 8 pixels up to 16
   apart where they scale an edge differently, the whole frame up to 1.1. And on looks only a browser draws: a corner
   rounded 38 and more in a block, a frame late over 100 where anything moves; an opacity of 0.93 and a brightness of
   1.06 from 2.4 over the frame. */
const BLOCK_APART = 24;
const FRAME_APART = 1.8;
/** The same over the frame, of its color (the two chroma planes). */
const COLOR_APART = 1.8;

/** What a file's picture is, as ffprobe reads its first video stream; null when it has none. @param {string} file @returns {Promise<Record<string, any> | null>} */
function probed(file) {
  return new Promise((done) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
      'stream=codec_name,pix_fmt,width,height,sample_aspect_ratio,field_order,color_space,color_transfer,color_primaries,color_range', '-of', 'json', file],
    { windowsHide: true, timeout: 20_000 }, (error, stdout) => {
      try { done(error ? null : JSON.parse(String(stdout)).streams?.[0] ?? null); } catch { done(null); }
    });
  });
}

/**
 * A file's picture when ffmpeg carries it over as the browser shows it, else null: 8-bit 4:2:0 without alpha, square
 * pixels, whole frames, its colors BT.709's or BT.601's (said, or left unsaid: a browser takes a file of 720 lines or
 * more for BT.709, a smaller one for BT.601), its transfer theirs or sRGB's (a screen recording). HDR, ten bits and
 * interlaced footage are drawn in the browser, which has its own way with each.
 * @param {Record<string, any> | null} s @returns {Footage | null}
 */
export function footageOf(s) {
  if (!s || !(s.width > 0 && s.height > 0)) return null;
  if (s.pix_fmt !== 'yuv420p' && s.pix_fmt !== 'yuvj420p') return null;
  if (s.sample_aspect_ratio && !['1:1', '0:1', 'N/A'].includes(s.sample_aspect_ratio)) return null;
  if (s.field_order && !['progressive', 'unknown'].includes(s.field_order)) return null;
  const said = (/** @type {unknown} */ v) => (typeof v === 'string' && v !== 'unknown' ? v : null);
  const SD = ['smpte170m', 'bt470bg'];
  const matrix = said(s.color_space) ?? (s.height < 720 ? 'smpte170m' : 'bt709');
  if (matrix !== 'bt709' && !SD.includes(matrix)) return null;
  if (said(s.color_primaries) && s.color_primaries !== 'bt709' && !SD.includes(s.color_primaries)) return null;
  if (said(s.color_transfer) && !['bt709', 'smpte170m', 'iec61966-2-1'].includes(s.color_transfer)) return null;
  return { codec: String(s.codec_name), pix: s.pix_fmt, w: s.width, h: s.height, range: s.color_range === 'pc' || s.pix_fmt === 'yuvj420p' ? 'pc' : 'tv',
    matrix: matrix === 'bt709' ? 'bt709' : 'bt601', srgb: s.color_transfer === 'iec61966-2-1', tone: 'none' };
}

/** What the film's page says of its clips' elements, in the page: each track's, in order, with how its CSS leaves it. */
const pageFacts = () => {
  const spans = /** @type {any} */ (window).__filmSpans?.();
  if (!spans) return null;
  const flat = (/** @type {string} */ v) => v === 'none' || v === 'normal' || v === 'matrix(1, 0, 0, 1, 0, 0)';
  const body = getComputedStyle(document.body);
  /* a clip's filter is off while it is hidden (the host's own rule, host.mjs), so the style as computed says nothing
     of it now: its own style is read, and the film's rules that reach it. Rules that cannot be read count as one */
  const filtered = (/** @type {Element} */ el) => {
    if (/** @type {HTMLElement} */ (el).style.filter || /** @type {HTMLElement} */ (el).style.backdropFilter) return true;
    /** @type {(rules: CSSRuleList) => boolean} */
    const reaches = (rules) => [...rules].some((rule) => {
      if (rule instanceof CSSStyleRule) return Boolean(rule.style.filter && rule.style.filter !== 'none' || rule.style.backdropFilter && rule.style.backdropFilter !== 'none') && el.matches(rule.selectorText);
      return 'cssRules' in rule ? reaches(/** @type {any} */ (rule).cssRules) : false;
    });
    try { return [...document.styleSheets].some((sheet) => reaches(sheet.cssRules)); } catch { return true; }
  };
  return {
    ground: body.backgroundColor, picture: body.backgroundImage, depth: body.perspective,
    spans,
    tracks: [...document.body.querySelectorAll(':scope > section')].map((section) => [...section.children]
      .filter((el) => ['IFRAME', 'VIDEO', 'IMG', 'AUDIO'].includes(el.tagName))
      .map((el) => {
        const css = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        /* as the film's CSS leaves it when it adds nothing: the box alone, the picture whole and in the middle of it */
        const plain = css.opacity === '1' && flat(css.mixBlendMode) && flat(css.clipPath) && !filtered(el) && flat(css.maskImage) && flat(css.animationName)
          && flat(css.transform) && flat(css.rotate) && flat(css.scale) && flat(css.translate) && flat(css.boxShadow) && flat(css.backdropFilter)
          && [css.borderTopLeftRadius, css.borderTopRightRadius, css.borderBottomLeftRadius, css.borderBottomRightRadius, css.borderTopWidth, css.borderLeftWidth,
            css.paddingTop, css.paddingLeft, css.paddingRight, css.paddingBottom].every((v) => parseFloat(v) === 0)
          && css.objectPosition === '50% 50%' && ['rgba(0, 0, 0, 0)', 'transparent'].includes(css.backgroundColor);
        return { tag: el.tagName, rect: [r.x, r.y, r.width, r.height], fit: css.objectFit, plain };
      })),
  };
};

/**
 * The film's pictures as its page has them: every clip that is drawn (its track not hidden, itself not disabled), from
 * the top track down, and for a video that is plain (see the head of this file) its file. A video graded by `--of-lut`
 * and otherwise plain is read from its graded copy (`graded`: the copy of a file graded by those LUTs, of the part
 * `time` plays, and the source second it starts at; seekable.mjs), which is what its page plays too. Null when the
 * page is not a film's, or says something this reading does not know: the film is drawn in the browser.
 * @param {{ page: import('playwright-core').Page }} film the film's page, ready @param {string} root the folder served @param {string} entry film.html, from it
 * @param {(file: string, luts: string[], time: number[] | null) => { file: string, from: number } | null} [graded]
 * @returns {Promise<Layers | null>}
 */
export async function layersOf(film, root, entry, graded) {
  const text = readFileSync(join(root, decodeURI(entry)), 'utf8');
  const doc = readFilmFile(text).doc;
  const facts = doc && await film.page.evaluate(pageFacts);
  if (!doc || !facts || facts.depth !== 'none' || facts.tracks.length !== doc.tracks.length) return null;
  const stage = doc.stage;
  /* the stage behind the clips: a plain color, for what a video does not cover of it */
  const rgb = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(facts.ground);
  const ground = rgb && facts.picture === 'none' ? `0x${rgb.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}` : null;
  /** @type {Map<string, any>} */
  const spans = new Map(facts.spans.map((/** @type {any} */ s) => [s.id, s]));
  /** @type {Map<string, Promise<Footage | null>>} */
  const files = new Map();
  /** @type {Layer[]} */
  const layers = [];
  for (const [ti, track] of doc.tracks.entries()) {
    const els = facts.tracks[ti];
    if (track.captions || els.length !== track.clips.length) { if (track.captions) continue; return null; }
    for (const [ci, clip] of track.clips.entries()) {
      const kind = kindOf(clip);
      const span = spans.get(clip.id);
      if (!kind || kind === 'sound' || track.hidden || clip.disabled) continue;
      if (!span || !(span.end > span.at)) return null;
      const el = els[ci];
      /** @type {Layer} */
      const layer = { id: clip.id, kind, track: ti, at: span.at, end: span.end, from: 0, speed: 1, file: null, fit: 'contain', own: { w: span.w ?? 0, h: span.h ?? 0 }, footage: null };
      layers.push(layer);
      if (kind !== 'video') continue;
      /* a video's file, plain or not: what a browser needs a copy of, where it draws it (render.mjs) */
      try { layer.file = fileOf(root, entry, srcHref(clip.src)); } catch { continue; }
      if (el.tag !== 'VIDEO' || !el.plain || !(layer.own.w > 0 && layer.own.h > 0)) continue;
      if (el.fit !== 'contain' && el.fit !== 'cover') continue;
      /* its box is the stage */
      if ([el.rect[0], el.rect[1], el.rect[2] - stage.w, el.rect[3] - stage.h].some((d) => Math.abs(d) > 0.5)) continue;
      /* no fade, and no effect a host makes of its custom properties (a cutout, a retouch, a place in 3D), but a grade:
         its graded copy is the picture */
      const luts = lutsOf(clip);
      if (clipFade(clip) || /--(of|fx)-/.test(`${clip.style ?? ''}`.replace(/--of-lut\s*:[^;]*;?/g, ''))) continue;
      if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(clip.src) || !existsSync(layer.file)) continue;
      let copy = null;
      if (luts.length) {
        try { copy = graded?.(layer.file, luts.map((lut) => fileOf(root, entry, srcHref(lut))), clip.time?.length === 2 ? clip.time : null) ?? null; } catch { copy = null; }
        if (!copy) continue;
      }
      const file = copy?.file ?? layer.file;
      if (copy) layer.file = file;
      if (!files.has(file)) files.set(file, probed(file).then(footageOf));
      const footage = await /** @type {Promise<Footage | null>} */ (files.get(file));
      if (!footage) continue;
      const cut = clipSpan(clip, span.native ?? NaN);
      Object.assign(layer, { footage: { ...footage }, fit: el.fit, from: cut.from - (copy?.from ?? 0), speed: cut.speed });
    }
  }
  /* the caption tracks: when each cue is on, and whether a cue stands still while it is (no animation in the file's
     styles, no word lit as it is said) */
  /** @type {Captions} */
  const captions = { tracks: [], still: true };
  for (const [ti, track] of doc.tracks.entries()) {
    if (!track.captions || track.hidden) continue;
    let vtt;
    try { vtt = readVtt(readFileSync(fileOf(root, entry, srcHref(track.captions.src)), 'utf8')); } catch { continue; }
    if (vtt.styles.some((css) => /animation|@keyframes|transition|:past|:future/i.test(css)) || vtt.cues.some((c) => /<\d+:\d\d/.test(c.text))) captions.still = false;
    captions.tracks.push({ track: ti, cues: vtt.cues.map((c) => ({ start: c.start, end: c.end })) });
  }
  return { stage, ground, layers, captions };
}

/** Whether a picture of `own` size fills a stage whole when it is fitted inside it: the same shape, to a pixel. */
const fills = (/** @type {{ w: number, h: number }} */ own, /** @type {{ w: number, h: number }} */ stage) => {
  const k = Math.min(stage.w / own.w, stage.h / own.h);
  return Math.round(own.w * k) >= stage.w && Math.round(own.h * k) >= stage.h;
};

/**
 * Frames [a, b) of the film as footage alone, or null when a browser has to draw any of them. At each frame the
 * clips on are looked at from the top: a plain video that covers the stage is the picture (what is under it is not
 * seen), with nothing over it; one that leaves bars is the picture when it is the only clip on, over a stage of a
 * plain color; no clip on is the bare stage. Caption cues on at a frame are a picture over it (`overlays`), when
 * they stand still and their tracks are above the clips on; cues that move are drawn.
 * @param {Layers} film @param {number} a @param {number} b @param {number} fps @param {number} duration the film's, in seconds
 * @returns {Plan | null}
 */
export function straightPlan(film, a, b, fps, duration) {
  /** @type {Segment[]} */
  const segments = [];
  /** @type {Map<string, Overlay>} */
  const overlays = new Map();
  /** @type {{ key: string, first: number } | null} */
  let lit = null;
  const unlit = (/** @type {number} */ f) => {
    if (!lit) return;
    const over = overlays.get(lit.key) ?? { key: lit.key, runs: [], at: lit.first };
    over.runs.push([lit.first - a, f - a]);
    overlays.set(lit.key, over);
    lit = null;
  };
  /** @type {{ layer: Layer | null, first: number } | null} */
  let run = null;
  const close = (/** @type {number} */ f) => {
    if (!run) return;
    const frames = f - run.first;
    const layer = run.layer;
    if (!layer) segments.push({ gap: true, frames });
    else {
      const t = Math.min(Math.max(0, run.first / fps), duration - 1e-4);
      const footage = /** @type {Footage} */ (layer.footage);
      segments.push({ file: /** @type {string} */ (layer.file), range: footage.range, matrix: footage.matrix, tone: footage.tone, fit: layer.fit,
        bars: layer.fit === 'contain' && !fills(layer.own, film.stage), want: layer.from + (t - layer.at) * layer.speed, speed: layer.speed, frames });
    }
  };
  for (let f = a; f < b; f++) {
    /* the second the film's page is asked for, as render asks it */
    const t = Math.min(Math.max(0, f / fps), duration - 1e-4);
    const on = film.layers.filter((l) => t >= l.at && t < l.end);
    /** @type {Layer | null} */
    let layer = null;
    if (on.length) {
      /* the top track's; where two of its clips touch (one's last moment is the other's first, to a rounding), the
         later one, as the page paints it over the earlier */
      const top = /** @type {Layer} */ (on.filter((l) => l.track === on[0].track).at(-1));
      if (!top.footage) return null;
      const covers = top.fit === 'cover' || fills(top.own, film.stage);
      if (!covers && (on.length > 1 || !film.ground)) return null;
      layer = top;
    } else if (!film.ground) return null;
    /* the cues on, by track and number: the same ones are the same picture */
    const cues = film.captions.tracks.map((track) => ({ track: track.track, on: track.cues.flatMap((c, i) => (c.start <= t && t < c.end ? [i] : [])) })).filter((c) => c.on.length);
    const key = cues.map((c) => `${c.track}:${c.on.join(',')}`).join(' ');
    if (key && (!film.captions.still || cues.some((c) => on.length && c.track > on[0].track))) return null;
    if (lit && lit.key !== key) unlit(f);
    if (key && !lit) lit = { key, first: f };
    if (!run || run.layer !== layer) { close(f); run = { layer, first: f }; }
  }
  close(b);
  unlit(b);
  return { segments, frames: b - a, files: [...new Set(segments.flatMap((s) => ('file' in s ? [s.file] : [])))], overlays: [...overlays.values()] };
}

/* a level of 0 to 255 as light, by a curve, and that light as sRGB writes it */
const SRGB = (/** @type {string} */ light) => `255*if(lte(${light},0.0031308),12.92*${light},1.055*pow(${light},1/2.4)-0.055)`;
/**
 * How a browser shows footage's tones, measured on ramps: as they are (`none`: a file whose transfer is sRGB's, and
 * any file decoded on the processor), or read as light and written again as the screen's sRGB, which lifts the middle
 * tones by a twentieth. `screen`: read by a gamma of 1.961, as the Mac's own video path reads BT.709 (footage decoded
 * on its chip). `video`: read by BT.709's own curve. Which one a file gets is told by a frame of it drawn both ways
 * (render's check): the frames a browser draws carry it, and Studio's preview shows it, so the frames read straight
 * are given the same, red, green and blue each through a table of 256.
 */
const TONES = /** @type {Record<Tone, string | null>} */ ({
  none: null,
  screen: SRGB('pow(val/255,1.961)'),
  video: SRGB('if(lt(val/255,0.081),val/255/4.5,pow((val/255+0.099)/1.099,1/0.45))'),
});
/** The tones a file may be shown in here, the likeliest first. @param {Footage} footage @returns {Tone[]} */
export const tonesFor = (footage) => (footage.srgb ? ['none', 'screen', 'video'] : process.platform === 'darwin' ? ['screen', 'none', 'video'] : ['none', 'video', 'screen']);

/**
 * Frames [f0, f1) of the film as runs, each read straight (`straight`) or drawn: where the film's footage is its
 * whole picture, and where it is not. A run begins and ends `grid` frames (or a multiple) from f0, as render's chunks
 * do; a stretch of footage shorter than `least` frames is drawn with what is around it.
 * @param {Layers} film @param {number} f0 @param {number} f1 @param {number} fps @param {number} duration @param {{ grid: number, least: number }} how
 * @returns {{ a: number, b: number, straight: boolean }[]}
 */
export function straightRuns(film, f0, f1, fps, duration, { grid, least }) {
  /** @type {{ a: number, b: number, straight: boolean }[]} */
  const runs = [];
  const put = (/** @type {number} */ a, /** @type {number} */ b, /** @type {boolean} */ straight) => {
    if (b <= a) return;
    const last = runs.at(-1);
    if (last && last.straight === straight) last.b = b;
    else runs.push({ a, b, straight });
  };
  let at = f0;
  for (let f = f0; f <= f1; f++) {
    const plain = f < f1 && !!straightPlan(film, f, f + 1, fps, duration);
    if (plain) continue;
    /* frames [at, f) are footage alone: kept from the grid's line at or after `at` to the one at or before f */
    const a = f0 + Math.ceil((at - f0) / grid) * grid;
    const b = f === f1 ? f1 : f0 + Math.floor((f - f0) / grid) * grid;
    if (b - a >= least) { put(runs.at(-1)?.b ?? f0, a, false); put(a, b, true); }
    at = f + 1;
  }
  put(runs.at(-1)?.b ?? f0, f1, false);
  return runs;
}

/** A number as ffmpeg's filters read it: plain decimals, never an exponent. */
const num = (/** @type {number} */ n) => (Number.isInteger(n) ? String(n) : n.toFixed(6).replace(/0+$/, '').replace(/\.$/, ''));

/**
 * ffmpeg's inputs and filters for a plan: each segment's file opened a little before the frame it starts at, its
 * frames put on the film's clock and one taken for each of the film's (the frame on screen at that moment, as a
 * browser shows it: the last one begun a millisecond after, host.mjs SEEK_INSIDE_FRAME), fitted to the stage, and the
 * segments joined; then each overlay's picture (`pictures`: its file, a PNG with alpha, by its key) laid over the
 * frames it is on at. The result is `[film]`: 8-bit 4:2:0, BT.709, `size` large; `count`: how many inputs it reads.
 * @param {Plan} plan @param {{ size: { w: number, h: number }, rate: Rate, ground: string | null, decoding?: string[], pictures?: Map<string, string> }} how
 * @returns {{ inputs: string[], graph: string, count: number }}
 */
export function straightGraph(plan, { size, rate, ground, decoding = [], pictures = new Map() }) {
  const R = ffmpegRate(rate);
  const fps = rate.fps;
  const inputs = [];
  const chains = [];
  const tagged = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';
  let input = 0;
  for (const [i, s] of plan.segments.entries()) {
    if ('gap' in s) {
      chains.push(`color=c=${ground ?? '0x000000'}:s=${size.w}x${size.h}:r=${R}:d=${num(s.frames / fps)},format=yuv420p,${tagged},trim=end_frame=${s.frames}[s${i}]`);
      continue;
    }
    /* the moment the first frame is wanted at, and the file opened before it. The file's frames are put on a clock
       of microseconds that reads `lead` of the film's frames at that moment, so every frame decoded lands at or after
       its 0 (its start filled with the first picture); a frame of the film is the last of the file's begun by its
       tick. The ones wanted are told by their number from the clock's start: a time would be rounded to the clock */
    const moment = s.want + 0.001;
    /* times are kept to the microsecond, as a browser keeps them: a frame's, to the nearest; the moment asked,
       rounded down. So a frame that begins a fraction of a microsecond after the moment is not on screen yet (at
       29.97 fps, footage shot at 30 has such a frame every thousand) */
    const asked = Math.floor(moment * 1e6 + 1e-3);
    const open = Math.max(0, moment - LEAD);
    /* a lead that is whole microseconds too (every third frame at 29.97), so nothing is rounded on the way */
    const period = (1e6 * rate.den) / rate.num;
    let lead = Math.ceil(((moment - open) / s.speed) * fps) + 2;
    for (let more = 0; more < 2000; more++) if (Math.abs((lead + more) * period - Math.round((lead + more) * period)) < 1e-6) { lead += more; break; }
    inputs.push(...decoding, '-ss', num(open), '-t', num(moment - open + (s.frames / fps) * s.speed + 1), '-copyts', '-i', s.file);
    const fit = s.fit === 'cover'
      ? `scale=${size.w}:${size.h}:force_original_aspect_ratio=increase:flags=lanczos:in_color_matrix=${s.matrix}:out_color_matrix=bt709:in_range=${s.range}:out_range=tv,crop=${size.w}:${size.h}`
      : `scale=${size.w}:${size.h}:force_original_aspect_ratio=decrease:flags=lanczos:in_color_matrix=${s.matrix}:out_color_matrix=bt709:in_range=${s.range}:out_range=tv`
        + (s.bars ? `,pad=${size.w}:${size.h}:(ow-iw)/2:(oh-ih)/2:color=${ground ?? '0x000000'}` : `,scale=${size.w}:${size.h}:flags=lanczos`);
    chains.push(`[${input++}:v:0]settb=AVTB,setpts=(PTS-${asked})/${num(s.speed)}+${Math.round(lead * period)},fps=${R}:round=up:start_time=0,`
      + `tpad=stop_mode=clone:stop_duration=${num(s.frames / fps + 1)},trim=start_frame=${lead}:end_frame=${lead + s.frames},setpts=PTS-STARTPTS,`
      + `${fit},${TONES[s.tone] ? `${tagged},format=gbrp,lutrgb=r='${TONES[s.tone]}':g='${TONES[s.tone]}':b='${TONES[s.tone]}',scale=out_color_matrix=bt709:out_range=tv,` : ''}format=yuv420p,setsar=1,${tagged}[s${i}]`);
  }
  const all = plan.segments.map((_, i) => `[s${i}]`).join('');
  const joined = plan.overlays.length ? 'under0' : 'film';
  chains.push(plan.segments.length > 1 ? `${all}concat=n=${plan.segments.length}:v=1:a=0,setpts=N/((${R})*TB)[${joined}]` : `${all}setpts=N/((${R})*TB)[${joined}]`);
  /* each overlay's one picture, held for the frames it is on at: its colors made the film's (BT.709, as the frames
     a browser draws are), its alpha kept, laid over in 4:2:0 as the encoder takes the film */
  for (const [i, over] of plan.overlays.entries()) {
    const file = pictures.get(over.key);
    if (!file) throw new Error(`no picture for the captions ${over.key}`);
    inputs.push('-i', file);
    const on = over.runs.map(([from, to]) => `between(n,${from},${to - 1})`).join('+');
    chains.push(`[${input++}:v]scale=${size.w}:${size.h}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuva420p[over${i}]`);
    chains.push(`[under${i}][over${i}]overlay=format=yuv420:eof_action=repeat:enable='${on}',${tagged}[${i === plan.overlays.length - 1 ? 'film' : `under${i + 1}`}]`);
  }
  return { inputs, graph: chains.join(';'), count: input };
}

/** How many pictures a file holds. @param {string} file @returns {Promise<number>} */
function framesIn(file) {
  return new Promise((done) => {
    execFile('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', file],
      { windowsHide: true }, (error, stdout) => done(error ? -1 : parseInt(String(stdout), 10)));
  });
}

/**
 * A plan's frames encoded into `file` with `format` (render's: the same options as the parts a browser draws):
 * decoded on the graphics chip when it decodes here, and again on the processor when that fails. A file that does
 * not come to the plan's frames exactly is an error, as any other: the part is then drawn in the browser.
 * @param {Plan} plan @param {string} file
 * @param {{ size: { w: number, h: number }, rate: Rate, ground: string | null, format: { video: string[], pix: string }, pictures?: Map<string, string>, signal?: AbortSignal }} how
 */
export async function straight(plan, file, { size, rate, ground, format, pictures, signal }) {
  const chip = await hardwareDecoding();
  /** @type {unknown} */
  let failure = null;
  for (const decoding of chip.length ? [chip, []] : [[]]) {
    const { inputs, graph } = straightGraph(plan, { size, rate, ground, decoding, pictures });
    const run = ffmpeg([...inputs, '-filter_complex', `${graph};[film]${format.pix}[out]`, '-map', '[out]', '-r', ffmpegRate(rate), ...format.video, file], { what: 'ffmpeg' });
    const stop = () => run.proc.kill('SIGKILL');
    signal?.addEventListener('abort', stop, { once: true });
    try {
      await run.done;
      const frames = await framesIn(file);
      if (frames !== plan.frames) throw new Error(`ffmpeg: ${frames} frames read straight from the footage, ${plan.frames} wanted`);
      return;
    } catch (e) {
      if (signal?.aborted) throw new Error('cancelled');
      failure = e;
    } finally {
      signal?.removeEventListener('abort', stop);
    }
  }
  throw failure;
}

/**
 * How far a frame read straight from its footage is from the picture the browser drew (`drawn`: a PNG of the stage
 * at that frame), in the pixels the encoder is given (4:2:0, where the two ways of spreading a file's color over its
 * pixels come to the same): their difference in brightness averaged over blocks of 8 × 8 pixels, as the block
 * furthest apart (`most`) and the whole frame (`mean`), and in color over the whole frame (`color`), in levels of
 * 255. Null when it could not be told.
 * @param {Plan} plan one frame @param {Buffer} drawn @param {{ stage: { w: number, h: number }, rate: Rate, ground: string | null, pictures?: Map<string, string> }} how
 * @returns {Promise<{ most: number, mean: number, color: number } | null>}
 */
export function apart(plan, drawn, { stage, rate, ground, pictures }) {
  const { inputs, graph, count } = straightGraph(plan, { size: stage, rate, ground, pictures });
  /* blocks of 8 × 8 of the picture's brightness, of 4 × 4 of its color (half as many each way): an even count */
  const w = Math.ceil(stage.w / 16) * 2, h = Math.ceil(stage.h / 16) * 2;
  return new Promise((done) => {
    const proc = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-loglevel', 'error', ...inputs, '-f', 'image2pipe', '-c:v', 'png', '-i', 'pipe:0',
      '-filter_complex', `${graph};[${count}:v]scale=${stage.w}:${stage.h}:out_color_matrix=bt709:out_range=tv,format=yuv420p[drawn];`
        + `[film][drawn]blend=all_mode=difference,scale=${w}:${h}:flags=area[out]`,
      '-map', '[out]', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    /** @type {Buffer[]} */
    const out = [];
    proc.stdout.on('data', (d) => out.push(d));
    proc.on('error', () => done(null));
    proc.on('close', (code) => {
      const blocks = Buffer.concat(out);
      if (code !== 0 || blocks.length !== w * h * 1.5) return done(null);
      let sum = 0, most = 0, color = 0;
      for (let i = 0; i < w * h; i++) { const v = blocks[i]; sum += v; if (v > most) most = v; }
      for (let i = w * h; i < blocks.length; i++) color += blocks[i];
      done({ most, mean: sum / (w * h), color: color / (blocks.length - w * h) });
    });
    proc.stdin.on('error', () => {});
    proc.stdin.end(drawn);
  });
}

/**
 * Whether a frame read straight from its footage is the picture the browser drew. A block far apart is something of
 * the look only the browser draws (a corner rounded, a border), or another frame of footage that moves; the whole
 * frame apart, a look over all of it (a tint, a fade); a little everywhere is how each scales and rounds.
 * @param {Plan} plan one frame @param {Buffer} drawn @param {{ stage: { w: number, h: number }, rate: Rate, ground: string | null, pictures?: Map<string, string> }} how
 */
export async function alike(plan, drawn, how) {
  const far = await apart(plan, drawn, how);
  return !!far && far.most < BLOCK_APART && far.mean < FRAME_APART && far.color < COLOR_APART;
}

/**
 * The footage that is drawn alike both ways, told by the picture: for each file a plan would read straight, a frame
 * or two of it are drawn by the film's page and read straight, in each of the tones a browser may show it in, until
 * one is the same picture (`alike`); that is the file's tone. A file no tone fits, or whose frame the page cannot
 * draw (footage this browser does not play), is drawn in the browser: its layers lose their footage.
 * @param {{ seek: (t: number) => Promise<unknown>, capture: (how: { format: 'png' }) => Promise<Buffer>, page?: import('playwright-core').Page }} page the film's page, at the stage's own size
 * @param {Layers} film @param {Rate} rate @param {number} duration the film's
 */
export async function settle(page, film, rate, duration) {
  const fps = rate.fps;
  const how = { stage: film.stage, rate, ground: film.ground };
  /** @type {Map<string, Layer[]>} the layers of each file as it is fitted */
  const groups = new Map();
  for (const l of film.layers) if (l.footage) groups.set(`${l.file}\n${l.fit}`, [...(groups.get(`${l.file}\n${l.fit}`) ?? []), l]);
  /* the footage alone is told here: the page draws its frames without the captions over them, which have their own
     check (render.mjs) */
  const bare = { ...film, captions: { tracks: [], still: true } };
  const uncaptioned = film.captions.tracks.length ? await page.page?.addStyleTag({ content: '[data-film-captions] { visibility: hidden !important; }' }) : null;
  /* a page's first pictures come out a little off the rest (render.mjs): one is taken and thrown away */
  let warm = false;
  for (const layers of groups.values()) {
    /* frames where the file is the film's whole picture: a quarter and three quarters into its clips, the first two */
    /** @type {{ f: number, plan: Plan }[]} */
    const frames = [];
    for (const l of layers) {
      for (const share of [0.25, 0.75]) {
        const f = Math.round((l.at + (l.end - l.at) * share) * fps);
        const plan = straightPlan(bare, f, f + 1, fps, duration);
        if (plan && plan.files[0] === l.file && frames.length < 2 && !frames.some((x) => x.f === f)) frames.push({ f, plan });
      }
    }
    if (!frames.length) continue;
    const footage = /** @type {Footage} */ (layers[0].footage);
    /** @type {Tone | null} */
    let tone = null;
    try {
      for (const [i, { f, plan }] of frames.entries()) {
        const t = Math.min(Math.max(0, f / fps), duration - 1e-4);
        if (!warm) { await page.seek(t); await page.capture({ format: 'png' }); warm = true; }
        await page.seek(t);
        const drawn = await page.capture({ format: 'png' });
        const toned = (/** @type {Tone} */ as) => ({ ...plan, segments: plan.segments.map((s) => ('file' in s ? { ...s, tone: as } : s)) });
        if (i === 0) {
          for (const as of tonesFor(footage)) if (await alike(toned(as), drawn, how)) { tone = as; break; }
        } else if (tone && !await alike(toned(tone), drawn, how)) tone = null;
        if (!tone) break;
      }
    } catch { tone = null; }
    for (const l of layers) {
      if (tone) /** @type {Footage} */ (l.footage).tone = tone;
      else l.footage = null;
    }
  }
  await uncaptioned?.evaluate((el) => /** @type {Element} */ (el).remove()).catch(() => {});
}

/**
 * A film's page that draws its captions alone, on nothing: every clip of it off, so a frame of it is the cues on at
 * that moment and costs no footage sought. Its pictures are what `straightGraph` lays over the footage.
 * @param {{ page: import('playwright-core').Page }} film a page of the film opened to be transparent
 */
export async function captionsAlone(film) {
  await film.page.addStyleTag({ content: 'html, body { background: transparent !important; }' });
  await film.page.evaluate(() => { for (const c of /** @type {any} */ (window).__filmEditor?.stage.clips() ?? []) c.hidden = true; });
}
