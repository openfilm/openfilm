// @ts-check
/**
 * `.cube` LUT files (the format every grading tool reads and writes): read, written, and looked up. A 3D LUT is a
 * lattice of `size`³ RGB outputs, red changing fastest; a 1D one is `size` outputs per channel. Values outside the
 * domain are clamped to it, as graders' tools do.
 *
 * A grade OpenFilm made keeps how it was made in its own comment line, `# openfilm-grade {…}` (grade.mjs): the LUT is
 * what the film plays, and the line is only how the color workbench shows it again.
 */

/** @typedef {{ size: number, oneD: boolean, data: Float32Array, min: [number, number, number], max: [number, number, number], title: string, grade: unknown }} Lut */

const GRADE_LINE = /^#\s*openfilm-grade\s+(\{.*\})\s*$/;

/**
 * A `.cube` file's text as a LUT, or why it is not one (thrown).
 * @param {string} text @returns {Lut}
 */
export function readCube(text) {
  let size = 0, oneD = false, title = '';
  /** @type {unknown} */
  let grade = null;
  let min = /** @type {[number, number, number]} */ ([0, 0, 0]), max = /** @type {[number, number, number]} */ ([1, 1, 1]);
  /** @type {Float32Array | null} */
  let data = null;
  let at = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const m = GRADE_LINE.exec(line);
      if (m) { try { grade = JSON.parse(m[1]); } catch { /* not ours to mind */ } }
      continue;
    }
    const word = line.split(/\s+/)[0].toUpperCase();
    if (word === 'TITLE') { title = line.slice(5).trim().replace(/^"|"$/g, ''); continue; }
    if (word === 'LUT_3D_SIZE' || word === 'LUT_1D_SIZE') {
      size = Number(line.split(/\s+/)[1]);
      oneD = word === 'LUT_1D_SIZE';
      if (!Number.isInteger(size) || size < 2 || size > (oneD ? 65536 : 256)) throw new Error(`a LUT of size ${size}`);
      data = new Float32Array(3 * (oneD ? size : size ** 3));
      continue;
    }
    if (word === 'DOMAIN_MIN' || word === 'DOMAIN_MAX' || word === 'LUT_3D_INPUT_RANGE' || word === 'LUT_1D_INPUT_RANGE') {
      const n = line.split(/\s+/).slice(1).map(Number);
      const v = /** @type {[number, number, number]} */ (n.length === 2 ? (word === 'DOMAIN_MIN' ? [n[0], n[0], n[0]] : [n[1], n[1], n[1]]) : n);
      if (word.endsWith('INPUT_RANGE')) { min = [n[0], n[0], n[0]]; max = [n[1], n[1], n[1]]; }
      else if (word === 'DOMAIN_MIN') min = v; else max = v;
      continue;
    }
    if (/^[A-Z_]+$/.test(word)) continue;
    if (!data) throw new Error('a .cube needs LUT_3D_SIZE or LUT_1D_SIZE before its values');
    const v = line.split(/\s+/).map(Number);
    if (v.length < 3 || v.some((n) => !Number.isFinite(n))) throw new Error(`not a .cube line: ${line.slice(0, 40)}`);
    if (at >= data.length) throw new Error('a .cube with more values than its size');
    data[at++] = v[0]; data[at++] = v[1]; data[at++] = v[2];
  }
  if (!data) throw new Error('not a .cube: no LUT_3D_SIZE or LUT_1D_SIZE');
  if (at !== data.length) throw new Error(`a .cube with ${at / 3} of its ${data.length / 3} values`);
  return { size, oneD, data, min, max, title, grade };
}

/**
 * A 3D LUT's text: `size`³ values from `at(r, g, b)`, red fastest; `grade` kept in its comment line.
 * @param {number} size @param {(r: number, g: number, b: number) => [number, number, number]} at
 * @param {{ title?: string, grade?: unknown }} [about]
 */
export function writeCube(size, at, { title = 'OpenFilm grade', grade } = {}) {
  const lines = [`TITLE "${title.replace(/"/g, "'")}"`];
  if (grade !== undefined) lines.push(`# openfilm-grade ${JSON.stringify(grade)}`);
  lines.push(`LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0');
  const n = size - 1;
  /* values past 0 and 1 are kept: a grade's LUT holds how far past black or white a clipped color went (grade.mjs) */
  const f = (/** @type {number} */ v) => (v === 0 ? '0' : v === 1 ? '1' : v.toFixed(6));
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const o = at(r / n, g / n, b / n);
    lines.push(`${f(o[0])} ${f(o[1])} ${f(o[2])}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Just the grade line of a `.cube`'s text, read from its head without parsing its values (a 65³ LUT is 7 MB). */
export function gradeOfCube(/** @type {string} */ head) {
  for (const line of head.split(/\r?\n/, 40)) {
    const m = GRADE_LINE.exec(line.trim());
    if (m) { try { return JSON.parse(m[1]); } catch { return null; } }
  }
  return null;
}

/**
 * A LUT looked up at `rgb` (each in its domain): tetrahedral between the lattice's points for a 3D one, as graders'
 * tools and ffmpeg's lut3d (`interp=tetrahedral`) do; linear for a 1D one.
 * @param {Lut} lut @param {number} r @param {number} g @param {number} b @returns {[number, number, number]}
 */
export function sample(lut, r, g, b) {
  const t = (/** @type {number} */ v, /** @type {number} */ i) => {
    const x = (v - lut.min[i]) / (lut.max[i] - lut.min[i] || 1);
    return x <= 0 ? 0 : x >= 1 ? 1 : x;
  };
  const n = lut.size - 1, d = lut.data;
  if (lut.oneD) {
    /** @type {[number, number, number]} */
    const out = [0, 0, 0];
    [r, g, b].forEach((v, c) => {
      const x = t(v, c) * n, i = Math.min(Math.floor(x), n - 1), f = x - i;
      out[c] = d[i * 3 + c] * (1 - f) + d[(i + 1) * 3 + c] * f;
    });
    return out;
  }
  const x = t(r, 0) * n, y = t(g, 1) * n, z = t(b, 2) * n;
  const x0 = Math.min(Math.floor(x), n - 1), y0 = Math.min(Math.floor(y), n - 1), z0 = Math.min(Math.floor(z), n - 1);
  const fx = x - x0, fy = y - y0, fz = z - z0;
  const s = lut.size;
  const at = (/** @type {number} */ i, /** @type {number} */ j, /** @type {number} */ k) => 3 * (i + s * (j + s * k));
  const c000 = at(x0, y0, z0), c111 = at(x0 + 1, y0 + 1, z0 + 1);
  /* the tetrahedron of the cube the point is in, by which of its coordinates are larger */
  let a, bb, w0, w1, w2, w3;
  if (fx > fy) {
    if (fy > fz) { a = at(x0 + 1, y0, z0); bb = at(x0 + 1, y0 + 1, z0); w0 = 1 - fx; w1 = fx - fy; w2 = fy - fz; w3 = fz; }
    else if (fx > fz) { a = at(x0 + 1, y0, z0); bb = at(x0 + 1, y0, z0 + 1); w0 = 1 - fx; w1 = fx - fz; w2 = fz - fy; w3 = fy; }
    else { a = at(x0, y0, z0 + 1); bb = at(x0 + 1, y0, z0 + 1); w0 = 1 - fz; w1 = fz - fx; w2 = fx - fy; w3 = fy; }
  } else if (fz > fy) { a = at(x0, y0, z0 + 1); bb = at(x0, y0 + 1, z0 + 1); w0 = 1 - fz; w1 = fz - fy; w2 = fy - fx; w3 = fx; }
  else if (fz > fx) { a = at(x0, y0 + 1, z0); bb = at(x0, y0 + 1, z0 + 1); w0 = 1 - fy; w1 = fy - fz; w2 = fz - fx; w3 = fx; }
  else { a = at(x0, y0 + 1, z0); bb = at(x0 + 1, y0 + 1, z0); w0 = 1 - fy; w1 = fy - fx; w2 = fx - fz; w3 = fz; }
  return [
    w0 * d[c000] + w1 * d[a] + w2 * d[bb] + w3 * d[c111],
    w0 * d[c000 + 1] + w1 * d[a + 1] + w2 * d[bb + 1] + w3 * d[c111 + 1],
    w0 * d[c000 + 2] + w1 * d[a + 2] + w2 * d[bb + 2] + w3 * d[c111 + 2],
  ];
}
