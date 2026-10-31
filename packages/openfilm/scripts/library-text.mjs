#!/usr/bin/env node
/**
 * The library's text, made from one page (library/text/text: a line of words whose look and motion are its CSS
 * variables): the basic lines, the word-art looks and the motions in, while shown and out, each only values of those
 * variables. This writes them into library/index.json (groups first among the text's) and draws each one's poster
 * and two-second preview with the renderer itself, the variables set as a clip's `:root` override, as Studio sets
 * them.
 *
 *   node scripts/library-text.mjs [--no-pictures] [id …]   (ids: draw only those)
 */
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../src/render.mjs';
import { closeBrowsers } from '../src/host.mjs';
import { GROUND } from './library-ground.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'library');
const SAMPLES = join(HERE, 'library-samples');
const W = 640, H = 360;
const ffmpeg = (...args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' }); if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}`); };
/* each thing's name in five languages (library-text-names.json), by its group and its own name */
const NAMES = JSON.parse(readFileSync(join(HERE, 'library-text-names.json'), 'utf8'));
const N = (key) => { if (!NAMES[key]) throw new Error(`no name for ${key}`); return NAMES[key]; };

/* fonts the page comes with, and the system's */
const SANS = "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Hiragino Sans GB', sans-serif";
const SERIF = "'Songti SC', 'Noto Serif SC', 'Source Han Serif SC', Georgia, serif";
const DISPLAY = `'Smiley Sans', ${SANS}`;
const PLAY = `'ZCOOL KuaiLe', ${SANS}`;
const ring = (w, c) => [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]].map(([x, y]) => `${(x * w).toFixed(3)}em ${(y * w).toFixed(3)}em 0 ${c}`).join(', ');
/* an edge around a gradient fill: a ring of drop shadows (a stroke would cover the fill, which is the background) */
const edge = (w, c) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([x, y]) => `drop-shadow(${x * w}em ${y * w}em 0 ${c})`).join(' ');
const stack = (n, step, c) => Array.from({ length: n }, (_, i) => `${((i + 1) * step).toFixed(3)}em ${((i + 1) * step).toFixed(3)}em 0 ${c}`).join(', ');

const GROUPS = [
  { id: 'basic', name: N('groups/basic') },
  { id: 'wordart', name: N('groups/wordart') },
  { id: 'in', name: N('groups/in') },
  { id: 'loop', name: N('groups/loop') },
  { id: 'out', name: N('groups/out') },
];

/** The basic lines: words of each size, as a page is laid out (the size is their box's, `fit` of the picture's height). */
const BASIC = [
  ['title', N('basic/title'), { '--weight': '900', '--font': DISPLAY }, { fit: 0.2 }],
  ['subtitle', N('basic/subtitle'), { '--weight': '700' }, { fit: 0.11 }],
  ['body', N('basic/body'), { '--weight': '500', '--in': 'fade' }, { fit: 0.08 }],
  ['note', N('basic/note'), { '--size': '52vh', '--weight': '500', '--box': 'rgba(0,0,0,0.55)', '--box-pad': '0.35em 0.7em', '--box-radius': '0.3em', '--in': 'fade' }, { fit: 0.08 }],
  ['lower', N('basic/lower'), { '--weight': '600', '--stroke': '0.08em', '--in': 'fade' }, { fit: 0.08, low: true }],
];

/** Word art: a look made of a fill, a stroke, shadows, a glow and a box. */
const WORDART = [
  ['white-black', N('wordart/white-black'), { '--stroke': '0.12em', '--stroke-color': '#111' }],
  ['yellow-variety', N('wordart/yellow-variety'), { '--font': DISPLAY, '--color': '#ffd400', '--stroke': '0.14em', '--stroke-color': '#151515', '--shadow': '0.07em 0.09em 0 #151515' }],
  ['variety-pink', N('wordart/variety-pink'), { '--font': PLAY, '--weight': '400', '--color': '#ffffff', '--stroke': '0.16em', '--stroke-color': '#ff3d7f', '--shadow': '0 0.1em 0 #9e0040' }],
  ['candy', N('wordart/candy'), { '--font': PLAY, '--weight': '400', '--color': 'transparent', '--fill': 'linear-gradient(180deg, #ffffff 35%, #ffe08a 80%)', '--glow': `${edge(0.05, '#ff8a00')} ${edge(0.04, '#ff8a00')} drop-shadow(0 0.09em 0 #c24e00)` }],
  ['comic', N('wordart/comic'), { '--font': PLAY, '--weight': '400', '--color': '#ffeb3b', '--stroke': '0.12em', '--stroke-color': '#111', '--shadow': '0.09em 0.09em 0 #e53935' }],
  ['cute-pink', N('wordart/cute-pink'), { '--font': PLAY, '--weight': '400', '--color': '#ffffff', '--stroke': '0.13em', '--stroke-color': '#ff7eb6', '--shadow': '0 0.08em 0 #e05597' }],
  ['mint', N('wordart/mint'), { '--font': PLAY, '--weight': '400', '--color': '#ffffff', '--stroke': '0.13em', '--stroke-color': '#2ec4a0', '--shadow': '0 0.08em 0 #13866b' }],
  ['neon-pink', N('wordart/neon-pink'), { '--weight': '700', '--color': '#fff0fb', '--glow': 'drop-shadow(0 0 0.06em #ff2fd0) drop-shadow(0 0 0.25em #ff2fd0)' }],
  ['neon-cyan', N('wordart/neon-cyan'), { '--weight': '700', '--color': '#effffe', '--glow': 'drop-shadow(0 0 0.06em #19e3ff) drop-shadow(0 0 0.25em #19e3ff)' }],
  ['neon-yellow', N('wordart/neon-yellow'), { '--weight': '700', '--color': '#fffbe0', '--glow': 'drop-shadow(0 0 0.06em #ffd21f) drop-shadow(0 0 0.25em #ff9d00)' }],
  ['gold', N('wordart/gold'), { '--font': DISPLAY, '--color': 'transparent', '--fill': 'linear-gradient(180deg, #fff7cc 0%, #f2c14e 45%, #9a6a12 52%, #f6d784 100%)', '--stroke': '0.03em', '--stroke-color': '#5a3a00', '--glow': 'drop-shadow(0 0.04em 0.06em rgba(0,0,0,0.55))' }],
  ['silver', N('wordart/silver'), { '--font': DISPLAY, '--color': 'transparent', '--fill': 'linear-gradient(180deg, #ffffff 0%, #c9d1d9 45%, #6b7480 52%, #e8edf2 100%)', '--stroke': '0.03em', '--stroke-color': '#2d333b', '--glow': 'drop-shadow(0 0.04em 0.06em rgba(0,0,0,0.55))' }],
  ['sunset', N('wordart/sunset'), { '--font': DISPLAY, '--color': 'transparent', '--fill': 'linear-gradient(90deg, #ffb35c, #ff4d8d 55%, #8a5cff)' }],
  ['ocean', N('wordart/ocean'), { '--font': DISPLAY, '--color': 'transparent', '--fill': 'linear-gradient(90deg, #7cf6ff, #2f8cff 60%, #5b3cff)' }],
  ['aurora', N('wordart/aurora'), { '--font': DISPLAY, '--color': 'transparent', '--fill': 'linear-gradient(90deg, #8affc1, #5ad1ff 50%, #c08bff)', '--glow': 'drop-shadow(0 0 0.15em rgba(120,220,255,0.6))' }],
  ['fire', N('wordart/fire'), { '--font': DISPLAY, '--color': 'transparent', '--fill': 'linear-gradient(0deg, #ff3d00, #ffb300 55%, #fff59d)', '--glow': 'drop-shadow(0 0 0.18em #ff6d00)' }],
  ['ice', N('wordart/ice'), { '--font': DISPLAY, '--color': 'transparent', '--fill': 'linear-gradient(180deg, #ffffff, #a8ecff)', '--stroke': '0.02em', '--stroke-color': '#e6faff', '--glow': 'drop-shadow(0 0 0.15em #7fdcff)' }],
  ['solid-red', N('wordart/solid-red'), { '--font': DISPLAY, '--color': '#ff4a3d', '--shadow': stack(8, 0.012, '#7a0f08') }],
  ['solid-blue', N('wordart/solid-blue'), { '--font': DISPLAY, '--color': '#4aa8ff', '--shadow': stack(8, 0.012, '#0b2f66') }],
  ['long-shadow', N('wordart/long-shadow'), { '--font': DISPLAY, '--color': '#ffffff', '--shadow': stack(16, 0.012, 'rgba(0,0,0,0.35)') }],
  ['outline', N('wordart/outline'), { '--font': DISPLAY, '--color': 'transparent', '--stroke': '0.035em', '--stroke-color': '#ffffff' }],
  ['double-edge', N('wordart/double-edge'), { '--font': DISPLAY, '--color': '#ffffff', '--glow': `${edge(0.035, '#2b5bff')} ${edge(0.03, '#2b5bff')} ${edge(0.035, '#ffffff')}` }],
  ['retro', N('wordart/retro'), { '--font': DISPLAY, '--color': '#f6e7c8', '--shadow': '0.06em 0.06em 0 #d2452f, 0.12em 0.12em 0 #24384d' }],
  ['vapor', N('wordart/vapor'), { '--font': DISPLAY, '--color': '#ffe9ff', '--italic': 'italic', '--shadow': '0.05em 0.05em 0 #ff4fd8, 0.1em 0.1em 0 #3bd5ff' }],
  ['glitch', N('wordart/glitch'), { '--font': DISPLAY, '--color': '#ffffff', '--shadow': '-0.05em 0 0 #ff0050, 0.05em 0 0 #00e5ff' }],
  ['label-black', N('wordart/label-black'), { '--weight': '700', '--box': '#111111', '--box-pad': '0.25em 0.55em', '--box-radius': '0.18em' }],
  ['label-yellow', N('wordart/label-yellow'), { '--weight': '800', '--color': '#111111', '--box': '#ffd400', '--box-pad': '0.25em 0.55em', '--box-radius': '0.18em' }],
  ['label-red', N('wordart/label-red'), { '--weight': '800', '--box': '#d6202f', '--box-pad': '0.22em 0.6em', '--box-radius': '0' }],
  ['highlighter', N('wordart/highlighter'), { '--weight': '800', '--color': '#ffffff', '--box': 'linear-gradient(transparent 55%, rgba(255,61,127,0.85) 55%, rgba(255,61,127,0.85) 90%, transparent 90%)', '--box-pad': '0 0.15em' }],
  ['bubble', N('wordart/bubble'), { '--font': PLAY, '--weight': '400', '--color': '#222222', '--box': '#ffffff', '--box-pad': '0.3em 0.8em', '--box-radius': '1.2em', '--glow': 'drop-shadow(0 0.05em 0.1em rgba(0,0,0,0.4))' }],
  ['handwriting', N('wordart/handwriting'), { '--font': PLAY, '--weight': '400', '--shadow': '0 0.04em 0.2em rgba(0,0,0,0.5)' }],
  ['cinema', N('wordart/cinema'), { '--font': SERIF, '--weight': '600', '--color': '#f5e6c4', '--spacing': '0.25em', '--size': '6vw', '--shadow': '0 0.02em 0.12em rgba(0,0,0,0.85)' }],
  ['elegant', N('wordart/elegant'), { '--font': SERIF, '--weight': '500', '--italic': 'italic', '--spacing': '0.06em' }],
  ['thin', N('wordart/thin'), { '--weight': '200', '--spacing': '0.18em' }],
  ['soft-shadow', N('wordart/soft-shadow'), { '--weight': '800', '--shadow': '0 0.06em 0.3em rgba(0,0,0,0.65)' }],
  ['stamp', N('wordart/stamp'), { '--font': DISPLAY, '--color': '#e23b2e', '--box': 'transparent', '--box-pad': '0.15em 0.4em', '--stroke': '0', '--shadow': `${ring(0.02, 'rgba(226,59,46,0.5)')}` }],
];

/** Motions, in: how it comes; loop: how it moves while shown; out: how it goes (timed by the clip's length). */
const IN = [
  ['none', N('in/none')], ['fade', N('in/fade')], ['rise', N('in/rise')],
  ['drop', N('in/drop')], ['pop', N('in/pop')], ['zoom', N('in/zoom')],
  ['blur', N('in/blur')], ['slide-left', N('in/slide-left')],
  ['slide-right', N('in/slide-right')], ['wipe', N('in/wipe')],
  ['type', N('in/type')], ['stamp', N('in/stamp')],
  ['spin-in', N('in/spin-in')], ['flip-in', N('in/flip-in')], ['bounce-in', N('in/bounce-in')],
];
const LOOP = [
  ['none', N('loop/none')], ['float', N('loop/float')], ['pulse', N('loop/pulse')],
  ['wiggle', N('loop/wiggle')], ['shake', N('loop/shake')],
  ['breathe', N('loop/breathe')], ['swing', N('loop/swing')], ['flicker', N('loop/flicker')],
];
const OUT = [
  ['none', N('out/none')], ['fade-out', N('out/fade-out')], ['sink', N('out/sink')],
  ['lift', N('out/lift')], ['shrink', N('out/shrink')], ['blur-out', N('out/blur-out')],
  ['wipe-out', N('out/wipe-out')], ['zoom-out', N('out/zoom-out')],
];

const items = [];
/* the text itself: the default line */
/* a line of words is a wide box of its own when put in (UI lib/library libraryBox), not the whole picture */
const LINE = { w: 1600, h: 260, fit: 0.14 };
items.push({ id: 'text/text', cat: 'text', group: 'basic', name: N('text'), kind: 'page', durationMs: 3000, src: 'text.html', ...LINE });
for (const [slug, name, vars, shape] of BASIC) items.push({ id: `text/looks/${slug}`, cat: 'text', group: 'basic', name, kind: 'textstyle', vars, ...LINE, ...shape });
for (const [slug, name, vars] of WORDART) items.push({ id: `text/looks/${slug}`, cat: 'text', group: 'wordart', name, kind: 'textstyle', vars });
for (const [slug, name] of IN) items.push({ id: `text/motions/in-${slug}`, cat: 'text', group: 'in', name, kind: 'textmotion', vars: { '--in': slug, '--in-time': slug === 'type' ? '1.2s' : '0.6s' } });
for (const [slug, name] of LOOP) items.push({ id: `text/motions/loop-${slug}`, cat: 'text', group: 'loop', name, kind: 'textmotion', vars: { '--loop': slug } });
for (const [slug, name] of OUT) items.push({ id: `text/motions/out-${slug}`, cat: 'text', group: 'out', name, kind: 'textmotion', vars: { '--out': slug, '--out-time': '0.5s' } });

/* the text page's own bundle, as Saved keeps one: its clip, three seconds, its properties offered */
const props = [
  { name: 'Text', type: 'text', at: '.t' }, { name: 'Color', type: 'var', var: '--color' }, { name: 'Size', type: 'var', var: '--size' },
  { name: 'Font', type: 'var', var: '--font' }, { name: 'Length', type: 'var', var: '--clip-length' },
];
writeFileSync(join(LIB, 'text', 'text', 'saved.json'), `${JSON.stringify({ version: 2, kind: 'clip', clip: { src: 'text.html', time: [0, 3], attrs: { 'data-props': JSON.stringify(props) } }, durationMs: 3000 }, null, 2)}\n`);

/* into the index: these groups first among the text's, these things first, the rest as they were */
const index = JSON.parse(readFileSync(join(LIB, 'index.json'), 'utf8'));
const mine = new Set(items.map((i) => i.id));
const ourGroups = new Set(GROUPS.map((g) => g.id));
index.groups.text = [...GROUPS, ...(index.groups.text ?? []).filter((g) => !ourGroups.has(g.id))];
const firstText = index.items.findIndex((i) => i.cat === 'text');
const rest = index.items.filter((i) => !mine.has(i.id));
const at = firstText < 0 ? rest.length : rest.findIndex((i) => i.cat === 'text');
index.items = [...rest.slice(0, at < 0 ? rest.length : at), ...items, ...rest.slice(at < 0 ? rest.length : at)];
writeFileSync(join(LIB, 'index.json'), `${JSON.stringify(index, null, 1)}\n`);
console.log(`${items.length} text things in library/index.json`);

if (!process.argv.includes('--no-pictures')) {
  /* what each one shows: the words "Aa 字" (both scripts), its look or motion on them, on a plain ground */
  const asked = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  for (const item of items) {
    if (asked.length && !asked.includes(item.id)) continue;
    const dir = join(LIB, item.id);
    const work = mkdtempSync(join(tmpdir(), 'openfilm-text-'));
    mkdirSync(dir, { recursive: true });
    try {
      cpSync(join(LIB, 'text', 'text', 'files'), join(work, 'item'), { recursive: true });
      writeFileSync(join(work, 'ground.html'), GROUND);
      const motion = item.kind === 'textmotion';
      const vars = { ...(item.vars ?? {}), '--clip-length': '2s', ...(motion ? {} : { '--in': 'none' }) };
      /* in the box it is put in with (a basic line's own, else a line's), larger so it reads in a small card: the
         basic lines as they are to each other, looks and motions alike */
      const shape = { ...LINE, ...(item.group === 'basic' ? { fit: (item.fit ?? LINE.fit) * 1.5, low: item.low } : { fit: 0.3 }) };
      let bh = Math.round(H * shape.fit);
      let bw = Math.round(bh * (shape.w / shape.h));
      if (bw > W * 0.9) { bw = Math.round(W * 0.9); bh = Math.round(bw * (shape.h / shape.w)); }
      const by = shape.low ? Math.round(H * 0.84 - bh / 2) : Math.round((H - bh) / 2);
      const place = `left: ${Math.round((W - bw) / 2)}px; top: ${by}px; width: ${bw}px; height: ${bh}px`;
      const overrides = JSON.stringify([{ at: ':root', style: vars }, { at: '.t', text: 'Aa 字' }]).replaceAll("'", '&#39;');
      writeFileSync(join(work, 'film.html'), `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=${W}, height=${H}">\n</head>\n<body>\n<section>\n  <iframe src="item/text.html#t=0,2" size="${bw}x${bh}" style="${place}" overrides='${overrides}'></iframe>\n</section>\n<section>\n  <iframe src="ground.html#t=0,2"></iframe>\n</section>\n</body>\n</html>\n`);
      const out = join(work, 'out.mp4');
      await render([work, '0-2'], { out, fps: 30, quiet: true });
      ffmpeg('-i', out, '-vf', 'scale=320:180', '-c:v', 'libx264', '-crf', '30', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(dir, 'preview.mp4'));
      /* a motion in at its middle, out near its end; a look when it is still */
      const posterAt = item.group === 'in' ? 0.3 : item.group === 'out' ? 1.75 : 1;
      ffmpeg('-ss', String(posterAt), '-i', out, '-frames:v', '1', '-vf', 'scale=320:180', '-q:v', '5', join(dir, 'poster.jpg'));
      console.log(`→ library/${item.id}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  }
  await closeBrowsers();
}
