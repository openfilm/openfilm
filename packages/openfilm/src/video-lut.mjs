// @ts-check
/**
 * Live grading in the page. A video clip graded by `--of-lut` (SPEC.md) plays a graded copy the host makes at the
 * file's own bit depth (seekable.mjs); until that copy is there, and while an editor shows a grade not written yet,
 * the clip is drawn through its grade here instead: each frame of the video as the browser decodes it (8 bits) through
 * the grade's 3D LUT, onto a canvas in the video's place with the video's CSS (followVideo). The two differ only in
 * the steps of a deep shadow's gradient (internal measurement: a peak of 1.7 codes here, 0.9 in the copy); the copy
 * takes over as soon as it is made. An export never draws here: a render waits for every copy first.
 *
 * One WebGL2 context draws for every clip, then each clip's canvas takes a copy of the picture: a page keeps only 16
 * contexts at once, and the film's own pages need theirs.
 */
import { followVideo } from './video-effects.mjs';

/** @typedef {{ size: number, data: Float32Array, key: string }} Lut a 3D LUT: size³ RGB triples, red fastest (`.cube` order), named by `key` */

/** A picture drawn live is at most this many pixels on its long side: enough for any preview, and it keeps 4K at full speed. */
const LIVE_SIDE = 1920;
/** LUTs kept on the chip at once, the last used first. */
const KEPT = 8;

const vertex = `#version 300 es
in vec2 point; out vec2 uv;
void main() { gl_Position = vec4(point, 0., 1.); uv = vec2((point.x + 1.) * .5, (1. - point.y) * .5); }`;
/* the LUT's grid is sampled at the centres of its first and last cells, as a grader's tools look one up */
const fragment = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 color;
uniform sampler2D picture; uniform sampler3D lut; uniform float size;
void main() {
  vec4 p = texture(picture, uv);
  vec3 at = clamp(p.rgb, 0., 1.) * ((size - 1.) / size) + .5 / size;
  color = vec4(clamp(texture(lut, at).rgb, 0., 1.), p.a);
}`;

/** @type {{ gl: WebGL2RenderingContext, canvas: HTMLCanvasElement, size: WebGLUniformLocation | null, picture: WebGLTexture | null } | null | undefined} */
let chip;
/** @type {Map<string, WebGLTexture | null>} the LUTs on the chip, by key, the last used last */
const textures = new Map();
/** @type {Map<object, HTMLCanvasElement>} each clip's canvas */
const canvases = new Map();
/** @type {HTMLStyleElement | undefined} */
let style;

/** The shared context, made the first time; null where WebGL2 is not (the clip then shows its video as it is). */
function context() {
  if (chip !== undefined) return chip;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
  if (!gl) return (chip = null);
  const shader = (/** @type {number} */ type, /** @type {string} */ text) => {
    const s = /** @type {WebGLShader} */ (gl.createShader(type));
    gl.shaderSource(s, text);
    gl.compileShader(s);
    return s;
  };
  const program = /** @type {WebGLProgram} */ (gl.createProgram());
  gl.attachShader(program, shader(gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return (chip = null);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const point = gl.getAttribLocation(program, 'point');
  gl.enableVertexAttribArray(point);
  gl.vertexAttribPointer(point, 2, gl.FLOAT, false, 0, 0);
  gl.uniform1i(gl.getUniformLocation(program, 'picture'), 0);
  gl.uniform1i(gl.getUniformLocation(program, 'lut'), 1);
  const picture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, picture);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  return (chip = { gl, canvas, size: gl.getUniformLocation(program, 'size'), picture });
}

/** `lut` on the chip, bound to the LUT's unit; made once a key. @param {WebGL2RenderingContext} gl @param {Lut} lut */
function bindLut(gl, lut) {
  let texture = textures.get(lut.key);
  if (texture === undefined) {
    texture = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, texture);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, lut.size, lut.size, lut.size, 0, gl.RGB, gl.FLOAT, lut.data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_3D, k, v);
    if (textures.size >= KEPT) {
      const [oldest, old] = textures.entries().next().value ?? [];
      if (oldest !== undefined) { gl.deleteTexture(old ?? null); textures.delete(oldest); }
    }
  } else textures.delete(lut.key);
  textures.set(lut.key, texture);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_3D, texture);
}

/** Where the picture is split between the video as it is (left) and graded (right), 0–1 across; null: graded whole. */
let split = /** @type {number | null} */ (null);
/** Split each graded video's picture at `x` (0–1 across), or not (null). @param {number | null} x */
export function setVideoSplit(x) { split = x; }

/**
 * Draw clip `c`'s video's current frame through `lut` in the video's place. False when it can't be drawn here (no
 * WebGL2, no frame yet): the video then shows as it is.
 * @param {{ el: HTMLVideoElement, id: string, shown?: boolean }} c @param {Lut} lut
 */
export function drawVideoLut(c, lut) {
  const v = c.el;
  const at = context();
  if (!at || v.readyState < 2 || !v.videoWidth) return false;
  const { gl, canvas } = at;
  const fit = Math.min(1, LIVE_SIDE / Math.max(v.videoWidth, v.videoHeight));
  const w = Math.max(1, Math.round(v.videoWidth * fit)), h = Math.max(1, Math.round(v.videoHeight * fit));
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  gl.viewport(0, 0, w, h);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, at.picture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
  bindLut(gl, lut);
  gl.uniform1f(at.size, lut.size);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  let own = canvases.get(c);
  if (!own) {
    style ??= document.head.appendChild(document.createElement('style'));
    style.textContent = 'video[data-film-lut-source]{visibility:hidden!important}';
    own = document.createElement('canvas');
    own.setAttribute('data-film-lut', c.id);
    own.style.pointerEvents = 'none';
    canvases.set(c, own);
  }
  if (own.width !== w || own.height !== h) { own.width = w; own.height = h; }
  const draw = /** @type {CanvasRenderingContext2D} */ (own.getContext('2d'));
  draw.globalCompositeOperation = 'copy';
  draw.drawImage(canvas, 0, 0);
  if (split != null) {
    /* before and after: the frame as it is up to the line, a thin line between */
    const x = Math.round(split * w);
    draw.globalCompositeOperation = 'source-over';
    if (x > 0) draw.drawImage(v, 0, 0, (x / w) * v.videoWidth, v.videoHeight, 0, 0, x, h);
    draw.fillStyle = 'rgba(255,255,255,0.85)';
    draw.fillRect(Math.max(0, x - Math.max(1, Math.round(w / 960))), 0, Math.max(1, Math.round(w / 480)), h);
  }
  v.setAttribute('data-film-lut-source', '');
  followVideo(c, own);
  return true;
}

/** Clip `c` off screen: its canvas hidden. @param {object} c */
export function hideVideoLut(c) {
  const own = canvases.get(c);
  if (own) own.style.visibility = 'hidden';
}

/** Clip `c` no longer drawn here (its copy came, or its grade went): its canvas gone, its video shown. @param {{ el: HTMLVideoElement }} c */
export function clearVideoLut(c) {
  canvases.get(c)?.remove();
  canvases.delete(c);
  c.el.removeAttribute('data-film-lut-source');
}
