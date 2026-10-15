// @ts-check
/**
 * Measuring a video for the replicate skill. A video, as a viewer follows it, is a run of states (a picture at rest)
 * and changes between them (a cut, a fade, a move). A model reads a state from one frame well and a change poorly, so
 * the changes are measured here: when, how long, where on screen, how they ease, against the sound's hits and beat
 * and the words said (a .vtt beside the video). The states are drawn as a storyboard. Only ffmpeg and ffprobe, from
 * the PATH; nothing to install.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

/** Small grey frames for motion, smaller colour ones for the palette. */
const GW = 96;
const GH = 54;
const CW = 24;
const CH = 14;
/** The motion grid: where on screen a move happens. */
const GRID = 3;
const AUDIO_RATE = 11025;
const HOP = 256;

const run = (cmd, args, max = 1 << 30) => {
  const r = spawnSync(cmd, args, { maxBuffer: max, windowsHide: true });
  if (r.error) throw new Error(`${cmd} is needed (${r.error.message})`);
  return r;
};

/** Duration, size, frame rate and whether it has sound. @param {string} file */
export function probe(file) {
  const r = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate', '-of', 'json', file]);
  let info;
  try { info = JSON.parse(String(r.stdout)); } catch { throw new Error(`ffprobe cannot read ${file}`); }
  const video = (info.streams ?? []).find((s) => s.codec_type === 'video');
  if (!video) throw new Error(`${file} has no picture`);
  const rate = (v) => { const [a, b] = String(v ?? '').split('/').map(Number); const x = b ? a / b : a; return x > 0 && x <= 240 ? x : null; };
  return {
    duration: Number(info.format?.duration ?? 0),
    width: video.width,
    height: video.height,
    fps: rate(video.avg_frame_rate) ?? rate(video.r_frame_rate) ?? 30,
    sound: (info.streams ?? []).some((s) => s.codec_type === 'audio'),
  };
}

/** Every frame at `fps`, decoded small: grey and colour. */
function frames(file, fps) {
  const grey = run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `fps=${fps},scale=${GW}:${GH}:flags=area,format=gray`, '-f', 'rawvideo', '-']).stdout;
  const colour = run('ffmpeg', ['-v', 'error', '-i', file, '-vf', `fps=${fps},scale=${CW}:${CH}:flags=area,format=rgb24`, '-f', 'rawvideo', '-']).stdout;
  const n = Math.floor(grey.length / (GW * GH));
  return {
    grey: Array.from({ length: n }, (_, i) => grey.subarray(i * GW * GH, (i + 1) * GW * GH)),
    colour: Array.from({ length: Math.min(n, Math.floor(colour.length / (CW * CH * 3))) }, (_, i) => colour.subarray(i * CW * CH * 3, (i + 1) * CW * CH * 3)),
  };
}

const median = (xs) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
const quantile = (xs, q) => { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const round = (x, d = 3) => Number(x.toFixed(d));

/** How two grey frames differ: overall, per grid cell, and by their brightness histograms. */
function difference(a, b) {
  let sum = 0;
  const cells = new Array(GRID * GRID).fill(0);
  const ha = new Array(32).fill(0);
  const hb = new Array(32).fill(0);
  for (let y = 0; y < GH; y++) {
    const cy = Math.min(GRID - 1, Math.floor((y * GRID) / GH));
    for (let x = 0; x < GW; x++) {
      const i = y * GW + x;
      const d = Math.abs(a[i] - b[i]);
      sum += d;
      cells[cy * GRID + Math.min(GRID - 1, Math.floor((x * GRID) / GW))] += d;
      ha[a[i] >> 3]++;
      hb[b[i] >> 3]++;
    }
  }
  const px = GW * GH;
  let hist = 0;
  for (let k = 0; k < 32; k++) hist += Math.abs(ha[k] - hb[k]);
  const local = cells.map((c) => c / (px / (GRID * GRID)) / 255);
  /* `most`: the change in the part of the frame that changes most, so a small title fading in is not lost in the whole */
  return { all: sum / px / 255, cells: local, most: Math.max(...local), hist: hist / (2 * px) };
}

/** A frame is black when almost nothing in it is lit (a dark design with a line of text on it is not). */
const black = (g) => { let lit = 0; for (let i = 0; i < g.length; i++) if (g[i] > 40) lit++; return lit / g.length < 0.002; };

/**
 * Where the picture changes at once (a cut) or through a stretch (a fade or a dissolve). A cut is one frame that
 * differs from the last far more than the frames around it differ from theirs; a whip or a flash that lasts a few
 * frames is motion, not a cut.
 */
function findCuts(diffs, grey, fps) {
  const cuts = [];
  for (let i = 1; i < diffs.length; i++) {
    const d = diffs[i];
    const around = [];
    for (let j = Math.max(1, i - 6); j <= Math.min(diffs.length - 1, i + 6); j++) if (j !== i) around.push(diffs[j].all);
    const usual = median(around);
    const sharp = d.hist > 0.3 || (d.all > 0.1 && d.all > 4 * usual + 0.02);
    if (sharp && (!cuts.length || i - cuts[cuts.length - 1].frame > 2)) cuts.push({ frame: i, t: round(i / fps), kind: 'cut' });
  }
  /* fades: the picture goes to (or comes from) black over several frames */
  const dark = grey.map(black);
  for (let i = 1; i < dark.length; i++) {
    if (dark[i] && !dark[i - 1] && !cuts.some((c) => Math.abs(c.frame - i) <= 2)) cuts.push({ frame: i, t: round(i / fps), kind: 'to black' });
    if (!dark[i] && dark[i - 1] && !cuts.some((c) => Math.abs(c.frame - i) <= 2)) cuts.push({ frame: i, t: round(i / fps), kind: 'from black' });
  }
  return cuts.sort((a, b) => a.frame - b.frame);
}

/** A shot whose stillest frames still change this much moves all through (footage, a camera move, a loop). */
const STEADY = 0.015;

const REGION = ['top left', 'top', 'top right', 'left', 'centre', 'right', 'bottom left', 'bottom', 'bottom right'];

/**
 * The moves inside a shot: runs of frames that change more than the shot's stillness, each with its start, end, the
 * frame it changes fastest, its ease (fast early: it decelerates; fast late: it accelerates) and where on screen.
 */
function findMoves(diffs, from, to, fps) {
  const span = diffs.slice(from + 1, to).map((d) => d.most);
  if (!span.length) return { moves: [], still: 1, steady: 0 };
  const floor = quantile(span, 0.2);
  const level = Math.max(0.004, floor * 2.5 + 0.002);
  const moves = [];
  let start = -1;
  let gap = 0;
  const close = (end) => {
    if (end - start + 1 >= 2) {
      const curve = diffs.slice(start, end + 1).map((d) => d.most);
      const peak = curve.indexOf(Math.max(...curve));
      /* its ease, from how much changes in its first, middle and last thirds (the whole frame's change: the busiest
         part's jumps as a moving thing crosses from one part to the next) */
      const whole = diffs.slice(start, end + 1).map((d) => d.all);
      const third = (k) => { const a = Math.floor((k * whole.length) / 3); const b = Math.max(a + 1, Math.floor(((k + 1) * whole.length) / 3)); return whole.slice(a, b).reduce((x, y) => x + y, 0) / (b - a); };
      const [early, middle, late] = [third(0), third(1), third(2)];
      const ease = whole.length < 4 ? 'a flick'
        : middle > 1.4 * Math.max(early, late) ? 'eases in and out'
          : early > 1.4 * late ? 'fast start, slows (ease-out)'
            : late > 1.4 * early ? 'slow start, speeds up (ease-in)' : 'even speed';
      const cells = new Array(GRID * GRID).fill(0);
      for (let i = start; i <= end; i++) diffs[i].cells.forEach((c, k) => { cells[k] += c; });
      const total = cells.reduce((a, b) => a + b, 0) || 1;
      const where = cells.map((c, k) => [k, c / total]).filter(([, s]) => s >= 0.18).sort((a, b) => b[1] - a[1]).map(([k]) => REGION[k]);
      const seconds = (end - start + 1) / fps;
      moves.push({
        from: round((start - 1) / fps), to: round(end / fps), fastest: round((start + peak) / fps),
        ease: seconds > 3 ? 'continuous' : ease,
        where: where.length >= 6 ? ['whole frame'] : where.slice(0, 3),
        strength: round(Math.max(...curve), 4),
      });
    }
    start = -1; gap = 0;
  };
  for (let i = from + 1; i < to; i++) {
    if (diffs[i].most > level) { if (start < 0) start = i; gap = 0; }
    else if (start >= 0 && ++gap > 2) close(i - gap);
  }
  if (start >= 0) close(to - 1 - gap);
  const moving = moves.reduce((s, m) => s + (m.to - m.from), 0);
  /* `steady`: the change even the stillest frames have (footage, a drifting camera, a loop that never rests) */
  return { moves, still: round(Math.max(0, 1 - moving / Math.max(1e-6, (to - from) / fps)), 2), steady: round(floor, 4) };
}

/** A shot's colours: the few that cover most of it, as hex, with their share. */
function palette(colour, from, to) {
  const count = new Map();
  const step = Math.max(1, Math.floor((to - from) / 8));
  let n = 0;
  for (let f = from; f < to; f += step) {
    const c = colour[f];
    if (!c) continue;
    for (let i = 0; i < c.length; i += 3) {
      const key = ((c[i] >> 4) << 8) | ((c[i + 1] >> 4) << 4) | (c[i + 2] >> 4);
      count.set(key, (count.get(key) ?? 0) + 1);
      n++;
    }
  }
  const hex = (k) => `#${[(k >> 8) & 15, (k >> 4) & 15, k & 15].map((v) => (v * 17).toString(16).padStart(2, '0')).join('')}`;
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).filter(([, c]) => c / n >= 0.04).map(([k, c]) => ({ color: hex(k), share: round(c / n, 2) }));
}

/** The sound's onsets (where it hits) and its beat (a tempo and where its beats fall), from its loudness. */
export function sound(file) {
  const pcm = run('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(AUDIO_RATE), '-f', 's16le', '-']).stdout;
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  const hops = Math.floor(samples.length / HOP);
  if (hops < 8) return null;
  const energy = new Float64Array(hops);
  for (let h = 0; h < hops; h++) {
    let s = 0;
    for (let i = h * HOP; i < (h + 1) * HOP; i++) s += (samples[i] / 32768) ** 2;
    energy[h] = Math.log10(1e-6 + s / HOP);
  }
  const rise = new Float64Array(hops);
  for (let h = 1; h < hops; h++) rise[h] = Math.max(0, energy[h] - energy[h - 1]);
  const dt = HOP / AUDIO_RATE;
  /* onsets: rises well above the local usual, at least 80 ms apart */
  const onsets = [];
  const win = Math.round(1 / dt);
  for (let h = 1; h < hops - 1; h++) {
    if (!(rise[h] >= rise[h - 1] && rise[h] > rise[h + 1])) continue;
    const local = Array.from(rise.subarray(Math.max(0, h - win), Math.min(hops, h + win)));
    const mean = local.reduce((a, b) => a + b, 0) / local.length;
    const sd = Math.sqrt(local.reduce((a, b) => a + (b - mean) ** 2, 0) / local.length);
    if (rise[h] > mean + 1.5 * sd && rise[h] > 0.15 && (!onsets.length || h * dt - onsets[onsets.length - 1] > 0.08)) onsets.push(round(h * dt));
  }
  /* the beat: the period (60–180 per minute) at which the rises repeat most, then where they fall */
  /* the rises spread over a few hops, so a period that falls between hops still meets them */
  const soft = new Float64Array(hops);
  for (let h = 0; h < hops; h++) for (let k = -2; k <= 2; k++) soft[h] += (rise[h + k] ?? 0) * [0.1, 0.25, 0.3, 0.25, 0.1][k + 2];
  const scoreOf = (bpm) => {
    const lag = 60 / bpm / dt;
    let s = 0; let m = 0;
    for (let h = 0; h + lag + 1 < hops; h++) { const a = Math.floor(h + lag); const f = h + lag - a; s += soft[h] * (soft[a] * (1 - f) + soft[a + 1] * f); m++; }
    return m ? s / m : 0;
  };
  let best = null;
  for (let bpm = 60; bpm <= 180; bpm += 0.5) { const score = scoreOf(bpm); if (!best || score > best.score) best = { bpm, score }; }
  /* a beat repeats at twice its period too: the faster one, when it holds nearly as well, is the beat */
  if (best.bpm * 2 <= 180 && scoreOf(best.bpm * 2) >= 0.7 * best.score) best = { bpm: best.bpm * 2, score: scoreOf(best.bpm * 2) };
  const period = 60 / best.bpm;
  let phase = 0; let top = -1;
  for (let p = 0; p < period; p += dt) {
    let s = 0;
    for (let t = p; t < hops * dt; t += period) s += soft[Math.round(t / dt)] ?? 0;
    if (s > top) { top = s; phase = p; }
  }
  /* a beat is said only when the sound keeps it: most beats land near an onset */
  const beats = [];
  for (let t = phase; t < hops * dt; t += period) beats.push(round(t));
  const near = (t, list, within) => list.some((o) => Math.abs(o - t) <= within);
  const kept = beats.filter((t) => near(t, onsets, 0.07)).length / Math.max(1, beats.length);
  return { onsets, beat: kept >= 0.4 ? { bpm: round(best.bpm, 1), beats, kept: round(kept, 2) } : null };
}

/** Words with their times from a WebVTT beside the video (a cue per line, a timestamp tag at each word). */
export function words(vttFile) {
  if (!existsSync(vttFile)) return null;
  const time = (s) => { const p = s.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
  const out = [];
  for (const block of readFileSync(vttFile, 'utf8').split(/\r?\n\r?\n/)) {
    const lines = block.split(/\r?\n/);
    const head = lines.findIndex((l) => l.includes('-->'));
    if (head < 0) continue;
    const [a] = lines[head].split('-->').map((s) => s.trim().split(/\s/)[0]);
    const text = lines.slice(head + 1).join(' ');
    let at = time(a);
    for (const part of text.split(/(<\d[\d:.]*>)/)) {
      const tag = part.match(/^<([\d:.]+)>$/);
      if (tag) { at = time(tag[1]); continue; }
      const word = part.replace(/<[^>]+>/g, '').trim();
      if (word) out.push({ t: round(at), word });
    }
  }
  return out;
}

/**
 * Everything measured, by shot. `fps`: frames looked at per second (the video's own, at most 60).
 * @param {string} file
 */
export function measure(file, { vtt = file.replace(/\.[^.]+$/, '.vtt') } = {}) {
  const info = probe(file);
  const fps = Math.max(10, Math.min(60, Math.round(info.fps)));
  const { grey, colour } = frames(file, fps);
  const diffs = [{ all: 0, cells: new Array(GRID * GRID).fill(0), most: 0, hist: 0 }];
  for (let i = 1; i < grey.length; i++) diffs.push(difference(grey[i - 1], grey[i]));
  const cuts = findCuts(diffs, grey, fps);
  const audio = info.sound ? sound(file) : null;
  const said = words(vtt);
  const edges = [0, ...cuts.map((c) => c.frame), grey.length];
  const near = (t, list, within = 0.06) => (list ?? []).some((o) => Math.abs(o - t) <= within);
  const shots = [];
  for (let k = 0; k < edges.length - 1; k++) {
    const [from, to] = [edges[k], edges[k + 1]];
    if (to - from < 1) continue;
    const start = round(from / fps); const end = round(to / fps);
    const { moves, still, steady } = findMoves(diffs, from, to, fps);
    const cut = k > 0 ? cuts[k - 1] : null;
    shots.push({
      n: shots.length + 1, from: start, to: end, seconds: round(end - start, 2),
      enters: cut ? cut.kind : 'start',
      onBeat: cut && audio ? near(start, audio.beat?.beats) || near(start, audio.onsets) : false,
      still: steady > STEADY ? 0 : still,
      steady,
      colors: palette(colour, from, to),
      moves: moves.map((m) => ({ ...m, onBeat: audio ? near(m.from, audio.onsets, 0.07) : false })),
      words: said ? said.filter((w) => w.t >= start && w.t < end).map((w) => w.word).join(' ') : null,
    });
  }
  const cutTimes = cuts.filter((c) => c.kind === 'cut').map((c) => c.t);
  return {
    file, ...info, sampled: fps,
    shots,
    summary: {
      shots: shots.length,
      medianShot: round(median(shots.map((s) => s.seconds)), 2),
      cutsOnBeat: audio && cutTimes.length ? round(cutTimes.filter((t) => near(t, audio.beat?.beats) || near(t, audio.onsets)).length / cutTimes.length, 2) : null,
      bpm: audio?.beat?.bpm ?? null,
      /* how busy the cutting is, every five seconds */
      cutsPer5s: Array.from({ length: Math.ceil(info.duration / 5) }, (_, i) => cutTimes.filter((t) => t >= i * 5 && t < (i + 1) * 5).length),
    },
    sound: audio,
    words: said,
    /* the motion at each frame (0–1), cuts left out, for comparing two films' rhythm */
    motion: diffs.map((d, i) => (cuts.some((c) => c.frame === i) ? 0 : round(d.most, 4))),
  };
}

/** A state shorter than this is a pause inside a change, not a picture the viewer reads. */
const MIN_STATE = 0.12;

/**
 * The video as a viewer follows it: states (the picture at rest, or a shot that moves all through) and the changes
 * between them (a cut, a fade, a move: when, how long, where, how it eases). Each state is numbered as in the
 * storyboard.
 */
export function timeline(m) {
  const events = [];
  let n = 0;
  const state = (from, to, shot, moving = false) => {
    events.push({
      kind: 'state', n: ++n, from: round(from), to: round(to), seconds: round(to - from, 2), shot: shot.n, moving,
      at: round((from + to) / 2), colors: shot.colors.map((c) => c.color),
      words: m.words ? m.words.filter((w) => w.t >= from && w.t < to).map((w) => w.word).join(' ') : null,
    });
  };
  for (const shot of m.shots) {
    if (shot.n > 1) events.push({ kind: shot.enters, at: shot.from, onBeat: shot.onBeat });
    if (shot.still === 0) {
      state(shot.from, shot.to, shot, true);
      continue;
    }
    let cursor = shot.from;
    for (const mv of shot.moves) {
      if (mv.from - cursor >= MIN_STATE) state(cursor, mv.from, shot);
      events.push({ kind: 'move', from: mv.from, to: mv.to, seconds: round(mv.to - mv.from, 2), where: mv.where, ease: mv.ease, onBeat: mv.onBeat });
      cursor = Math.max(cursor, mv.to);
    }
    if (shot.to - cursor >= MIN_STATE) state(cursor, shot.to, shot);
  }
  return events;
}

/** What `measure` found, as lines to read: the summary, then every state and change in order. */
export function describe(m) {
  const s = m.summary;
  const events = timeline(m);
  const states = events.filter((e) => e.kind === 'state');
  const lines = [
    `${m.file}  ${m.width}×${m.height} · ${m.duration.toFixed(2)}s · ${Number(m.fps.toFixed(3))} fps${m.sound ? ' · with sound' : ''} (measured at ${m.sampled} fps)`,
    `${states.length} states in ${s.shots} shots${s.bpm ? ` · beat ${s.bpm}/min` : m.sound ? ' · no steady beat' : ''}${s.cutsOnBeat != null ? ` · ${Math.round(s.cutsOnBeat * 100)}% of cuts on a beat or hit` : ''}`,
    `cuts per 5 s: ${s.cutsPer5s.join(' ')}`,
    '',
  ];
  for (const e of events) {
    if (e.kind === 'state') {
      lines.push(`#${e.n}  ${e.from.toFixed(2)}–${e.to.toFixed(2)}  ${e.moving ? 'moves all through' : 'holds'} ${e.seconds}s · ${e.colors.join(' ')}`);
      if (e.words) lines.push(`      “${e.words}”`);
    } else if (e.kind === 'move') {
      lines.push(`      ${e.from.toFixed(2)}–${e.to.toFixed(2)}  changes in ${e.seconds}s · ${e.where.join(', ')} · ${e.ease}${e.onBeat ? ' · on a hit' : ''}`);
    } else {
      lines.push(`      ${e.at.toFixed(2)}  ${e.kind}${e.onBeat ? ' on a beat' : ''}`);
    }
  }
  return lines;
}

/* A pixel font for the storyboard's labels: 3 × 5 cells per character. */
const GLYPHS = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
  '.': '000000000000010', s: '000111110011111', ' ': '000000000000000', '–': '000000111000000',
};

/** Draw `text` into an RGB image at (x, y), each font cell `k` pixels, on a dark box. */
function label(img, W, x, y, text, k = 3) {
  const w = text.length * 4 * k + k;
  const h = 7 * k;
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) { const i = (yy * W + xx) * 3; img[i] = img[i + 1] = img[i + 2] = 10; }
  [...text].forEach((ch, c) => {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    for (let r = 0; r < 5; r++) for (let q = 0; q < 3; q++) {
      if (g[r * 3 + q] !== '1') continue;
      for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
        const i = ((y + k + r * k + a) * W + (x + k + c * 4 * k + q * k + b)) * 3;
        img[i] = img[i + 1] = img[i + 2] = 240;
      }
    }
  });
}

/**
 * The storyboard: the picture of each state (its middle), numbered and timed, twelve to a page, as PNGs at
 * `<out>-1.png`, `<out>-2.png`… → their paths.
 * @param {ReturnType<typeof measure>} m @param {string} out
 */
export function storyboard(m, out) {
  const states = timeline(m).filter((e) => e.kind === 'state');
  const [cw, ch] = m.width >= m.height ? [384, Math.round((384 * m.height) / m.width / 2) * 2] : [Math.round((384 * m.width) / m.height / 2) * 2, 384];
  const cols = 4; const gap = 8; const per = 12;
  const pages = [];
  for (let p = 0; p * per < states.length; p++) {
    const page = states.slice(p * per, (p + 1) * per);
    const rows = Math.ceil(page.length / cols);
    const W = cols * cw + (cols + 1) * gap; const H = rows * ch + (rows + 1) * gap;
    const img = Buffer.alloc(W * H * 3, 17);
    page.forEach((st, i) => {
      const r = run('ffmpeg', ['-v', 'error', '-ss', String(st.at), '-i', m.file, '-frames:v', '1', '-vf', `scale=${cw}:${ch}`, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-']);
      const px = r.stdout;
      const x0 = gap + (i % cols) * (cw + gap); const y0 = gap + Math.floor(i / cols) * (ch + gap);
      if (px.length >= cw * ch * 3) for (let y = 0; y < ch; y++) px.copy(img, ((y0 + y) * W + x0) * 3, y * cw * 3, (y + 1) * cw * 3);
      label(img, W, x0 + 4, y0 + 4, `${st.n}  ${st.from.toFixed(2)}–${st.to.toFixed(2)}s`);
    });
    const file = `${out}-${p + 1}.png`;
    const done = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', '-', '-frames:v', '1', file], { input: img, windowsHide: true });
    if (done.status === 0) pages.push(file);
  }
  return pages;
}
