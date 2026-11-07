#!/usr/bin/env node
/**
 * The pictures of the library's pages (library/index.json): for each page, a poster (poster.jpg) and a two-second
 * preview (preview.mp4) beside its saved.json, drawn by the renderer itself, each over pictures of its own: an effect
 * over its scene (library/effects/samples/<name>.jpg), a transition on a cut from one picture to another, a pair of its
 * own from the effects' scenes and the filters' photos (library/filters/samples), its middle on the cut, and so each of
 * the timeline's fades and a cut's camera move; a template whole, its example pictures in its places; a sticker in the
 * middle of a plain ground. Never all of them over the same stills. A template's poster and preview are drawn larger
 * (its card is wider), and it gets its example too: the whole of it at 1280×720 with its music, what a click on it plays
 * in the viewer (library/examples/<its id>.mp4, a published part: studio/server/library.mjs). And the picture the looks
 * are shown on (library/filters/sample.jpg), and each sound's waveform (library/sounds/waves/).
 *
 *   node scripts/library-previews.mjs [id …]
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../src/render.mjs';
import { closeBrowsers } from '../src/host.mjs';
import { GROUND } from './library-ground.mjs';
import { libraryIndex } from '../studio/server/library.mjs';
import { filmHtml } from '../src/film-doc.mjs';
import { withPreset } from '../src/clip-motion.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'library');
const SAMPLES = join(HERE, 'library-samples');
const W = 640, H = 360;
/* a template's film, drawn for its example */
const TW = 1280, TH = 720;

/* every thing of the library: its index and its other catalogs, as Studio shows them */
const index = /** @type {{ items: any[] }} */ (libraryIndex());
const asked = process.argv.slice(2);
const ffmpeg = (...args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' }); if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}`); };

/* the pictures each is drawn over: an effect its scene; a transition a pair of its own from all of them */
const SCENES = join(LIB, 'effects', 'samples');
const POOL = [join(LIB, 'filters', 'samples'), SCENES].filter((d) => existsSync(d))
  .flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.jpg')).map((f) => join(d, f))).sort();
const cutIds = index.items.filter((i) => i.cat === 'transition').map((i) => i.id).sort();
/** The two pictures a thing of the library is drawn over (`a` before a cut, `b` after it, or under it), else null. */
function stillsFor(item) {
  const scene = join(SCENES, `${item.id.split('/').pop()}.jpg`);
  if (item.cat === 'effect' && existsSync(scene)) return { a: scene, b: scene };
  const i = cutIds.indexOf(item.id);
  return i >= 0 && POOL.length > 1 ? { a: POOL[i % POOL.length], b: POOL[(i + 37) % POOL.length] } : null;
}
/** The stills of a work folder: the samples, then the thing's own pictures over them. */
function stills(item, work) {
  for (const s of ['a.jpg', 'b.jpg', 'c.jpg']) cpSync(join(SAMPLES, s), join(work, s));
  const own = stillsFor(item);
  if (own) { cpSync(own.a, join(work, 'a.jpg')); cpSync(own.b, join(work, 'b.jpg')); }
}

/** The film a page is drawn in: its clip over the stills, and when its picture is best seen. */
function filmFor(item, about) {
  const src = `item/${about.clip.src.split('#')[0]}`;
  const props = about.clip.attrs?.['data-props'] ? ` data-props='${about.clip.attrs['data-props']}'` : '';
  let top;
  let under;
  let posterAt;
  if (item.place === 'cut') {
    const d = item.durationMs / 1000;
    top = `<iframe src="${src}" at="${(1 - d / 2).toFixed(3)}"${props}></iframe>`;
    under = '<img src="a.jpg#t=0,1" style="object-fit: cover"><img src="b.jpg#t=0,1" at="1" style="object-fit: cover">';
    posterAt = 1 - d * 0.3;
  } else if ((item.w ?? about.w) && (item.h ?? about.h)) {
    /* a thing of its own size (a sticker, a text template): in the middle, drawn at its box's size */
    const ow = item.w ?? about.w, oh = item.h ?? about.h;
    let s = Math.round(0.5 * H);
    let w = Math.round(s * (ow / oh));
    if (w > W * 0.9) { w = Math.round(W * 0.9); s = Math.round(w * (oh / ow)); }
    top = `<iframe src="${src}#t=0,2" size="${w}x${s}" style="left: ${Math.round((W - w) / 2)}px; top: ${Math.round((H - s) / 2)}px; width: ${w}px; height: ${s}px"${props}></iframe>`;
    under = '<iframe src="ground.html#t=0,2"></iframe>';
    posterAt = 1.2;
  } else {
    /* with its clip's own style (a light's blend with the picture under it) */
    top = `<iframe src="${src}#t=0,2"${about.clip.style ? ` style="${about.clip.style}"` : ''}${props}></iframe>`;
    /* text on a plain ground (library-ground.mjs, as a sticker is), anything else over a still */
    under = item.cat === 'text' ? '<iframe src="ground.html#t=0,2"></iframe>' : '<img src="b.jpg#t=0,2" style="object-fit: cover">';
    /* a beat's flash is over soon after it starts */
    posterAt = item.cat === 'text' ? 1.6 : item.group === 'rhythm' ? 0.18 : 0.8;
  }
  return {
    html: `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=${W}, height=${H}">\n</head>\n<body>\n<section>\n  ${top}\n</section>\n<section>\n  ${under}\n</section>\n</body>\n</html>\n`,
    posterAt,
  };
}

/** A fade's film: the cut at 1 s, made as the timeline makes the transition (lib/transitions). */
function fadeFilm(item) {
  const img = (src, at, end, fade) => `<img src="${src}#t=0,${end}"${at ? ` at="${at}"` : ''} style="object-fit: cover"${fade ? ` overrides='[{"fade":${JSON.stringify(fade)}}]'` : ''}>`;
  const tracks = item.fade === 'dissolve'
    ? [img('b.jpg', 0.75, 1.25, [0.5, 0]), img('a.jpg', 0, 1.25)]
    : [`${img('a.jpg', 0, 1, [0, 0.25])}${img('b.jpg', 1, 1, [0.25, 0])}`, ...(item.fade === 'dip-white' ? ['<iframe src="white.html#t=0,0.5" at="0.75"></iframe>'] : [])];
  const html = `<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=${W}, height=${H}">\n</head>\n<body>\n${tracks.map((t) => `<section>\n  ${t}\n</section>\n`).join('')}</body>\n</html>\n`;
  return { html, posterAt: 0.95 };
}

/** A template (a group): its clips laid out on the preview's picture, its example pictures in its places, all of its length. */
function groupFilm(item, about, W = TW, H = TH) {
  const tracks = [];
  for (const { track, at, clip } of about.clips) {
    let c = { ...clip, at, src: `item/${clip.src}` };
    const place = clip.attrs?.['data-place'];
    if (place && clip.size) {
      /* as Studio lays it out (lib/library placedGroup) */
      const p = JSON.parse(place);
      let h = Math.round(H * (p.fit ?? 0.3)), w = Math.round(h * (clip.size.w / clip.size.h));
      if (w > Math.round(W * 0.92)) { w = Math.round(W * 0.92); h = Math.round(w * (clip.size.h / clip.size.w)); }
      const x = Math.max(0, Math.min(W - w, Math.round(W * (p.x ?? 0.5) - w / 2))), y = Math.max(0, Math.min(H - h, Math.round(H * (p.y ?? 0.5) - h / 2)));
      const { 'data-place': _p, ...attrs } = clip.attrs;
      c = { ...c, box: { x, y, w, h }, size: { w, h }, attrs };
    }
    (tracks[track] ??= { clips: [] }).clips.push(c);
  }
  const marks = about.clips.filter((c) => c.clip.attrs?.['data-place']);
  const posterAt = Math.min(about.durationMs / 1000 - 0.2, (marks[0]?.at ?? 0) + 1.4);
  return { html: filmHtml({ stage: { w: W, h: H }, tracks: tracks.map((t) => t ?? { clips: [] }) }), posterAt, length: about.durationMs / 1000 };
}

/**
 * A motion preset (library/catalogs/motions.json, transitions-move.json) on the stills: a camera move across a cut from
 * one to the other, two shots moving at once over it, else the way in, out or the loop of one still two seconds long.
 */
function motionFilm(item) {
  const m = item.motion;
  const style = (slots) => slots.reduce((s, slot) => (m[slot] ? withPreset(s, slot, m[slot]) : s), 'object-fit: cover');
  const keyframes = Object.fromEntries(Object.values(m).map((p) => [p.name, p.body]));
  /* two shots moving at once (a push, a wipe): the next one over the last, overlapping it by the move's length around 1 s */
  if (item.lap) {
    const d = m.in.secs;
    const tracks = [{ clips: [{ id: 'b', src: 'b.jpg', at: 1 - d / 2, time: [0, 1 + d / 2], style: style(['in']) }] }, { clips: [{ id: 'a', src: 'a.jpg', time: [0, 1 + d / 2], style: style(['out']) }] }];
    /* a little before the middle (a turn about its axis further before: edge on there) */
    return { html: filmHtml({ stage: { w: W, h: H }, tracks, keyframes }), posterAt: 1 - d * (/rotate: y/.test(m.in.body) ? 0.4 : 0.15) };
  }
  const clips = item.place === 'cut'
    ? [{ id: 'a', src: 'a.jpg', time: [0, 1], style: style(['out']) }, { id: 'b', src: 'b.jpg', at: 1, time: [0, 1], style: style(['in']) }]
    : [{ id: 'a', src: 'b.jpg', time: [0, 2], style: style(['in', 'out', 'loop']) }];
  const posterAt = item.place === 'cut' ? 1 - m.out.secs * 0.4 : m.in ? m.in.secs * 0.45 : m.out ? 2 - m.out.secs * 0.55 : 0.8;
  return { html: filmHtml({ stage: { w: W, h: H }, tracks: [{ clips }], keyframes }), posterAt };
}

for (const item of index.items) {
  if (item.kind === 'motion' && (!asked.length || asked.includes(item.id))) {
    const dir = join(LIB, item.id);
    mkdirSync(dir, { recursive: true });
    const work = mkdtempSync(join(tmpdir(), 'openfilm-library-'));
    try {
      stills(item, work);
      const { html, posterAt } = motionFilm(item);
      writeFileSync(join(work, 'film.html'), html);
      const out = join(work, 'out.mp4');
      await render([work, '0-2'], { out, fps: 30, quiet: true });
      ffmpeg('-i', out, '-vf', 'scale=320:180', '-c:v', 'libx264', '-crf', '30', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(dir, 'preview.mp4'));
      ffmpeg('-ss', String(posterAt), '-i', out, '-frames:v', '1', '-vf', 'scale=320:180', '-q:v', '5', join(dir, 'poster.jpg'));
      console.log(`→ library/${item.id}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    continue;
  }
  if (item.kind === 'group' && (!asked.length || asked.includes(item.id))) {
    const dir = join(LIB, item.id);
    const about = JSON.parse(readFileSync(join(dir, 'saved.json'), 'utf8'));
    const work = mkdtempSync(join(tmpdir(), 'openfilm-library-'));
    try {
      cpSync(join(dir, 'files'), join(work, 'item'), { recursive: true });
      const { html, posterAt, length } = groupFilm(item, about);
      writeFileSync(join(work, 'film.html'), html);
      const out = join(work, 'out.mp4');
      await render([work, `0-${length}`], { out, fps: 30, quiet: true });
      ffmpeg('-i', out, '-vf', 'scale=480:270', '-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(dir, 'preview.mp4'));
      ffmpeg('-ss', String(posterAt), '-i', out, '-frames:v', '1', '-vf', 'scale=480:270', '-q:v', '4', join(dir, 'poster.jpg'));
      /* its example: all of it, with its music fading out at its end as it does put in */
      const example = join(LIB, 'examples', `${item.id}.mp4`);
      mkdirSync(dirname(example), { recursive: true });
      const music = item.music ? join(LIB, item.music) : null;
      const fadeAt = Math.max(0, length - 1.5).toFixed(2);
      ffmpeg('-i', out, ...(music && existsSync(music) ? ['-i', music, '-map', '0:v', '-map', '1:a', '-af', `afade=t=out:st=${fadeAt}:d=1.5`, '-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        '-t', String(length), '-c:v', 'libx264', '-crf', '23', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', example);
      console.log(`→ library/${item.id}`);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    continue;
  }
  /* a thing with a picture of its own (an emoji) has nothing to draw */
  if ((item.kind !== 'page' && item.kind !== 'fade') || item.still || (asked.length && !asked.includes(item.id))) continue;
  const dir = join(LIB, item.id);
  const about = item.kind === 'page' ? JSON.parse(readFileSync(join(dir, 'saved.json'), 'utf8')) : null;
  const work = mkdtempSync(join(tmpdir(), 'openfilm-library-'));
  mkdirSync(dir, { recursive: true });
  try {
    if (about) cpSync(join(dir, 'files'), join(work, 'item'), { recursive: true });
    stills(item, work);
    writeFileSync(join(work, 'ground.html'), GROUND);
    writeFileSync(join(work, 'white.html'), '<!doctype html><style>html,body{margin:0;height:100%;background:#fff}</style><script>window.film={frame(){}}</script>');
    const { html, posterAt } = about ? filmFor(item, about) : fadeFilm(item);
    writeFileSync(join(work, 'film.html'), html);
    const out = join(work, 'out.mp4');
    await render([work, '0-2'], { out, fps: 30, quiet: true });
    ffmpeg('-i', out, '-vf', 'scale=320:180', '-c:v', 'libx264', '-crf', '30', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(dir, 'preview.mp4'));
    ffmpeg('-ss', String(posterAt), '-i', out, '-frames:v', '1', '-vf', 'scale=320:180', '-q:v', '5', join(dir, 'poster.jpg'));
    console.log(`→ library/${item.id}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
await closeBrowsers();

/* the picture a look is shown on: the looks themselves are CSS, drawn on it in the drawer */
if (!asked.length) ffmpeg('-i', join(SAMPLES, 'c.jpg'), '-vf', 'scale=320:180', '-q:v', '4', join(LIB, 'filters', 'sample.jpg'));

/* each sound's waveform, drawn light on nothing, for the list */
mkdirSync(join(LIB, 'sounds', 'waves'), { recursive: true });
for (const item of index.items) {
  if (item.kind !== 'sound' || (asked.length && !asked.includes(item.id))) continue;
  const file = join(LIB, item.id);
  if (!existsSync(file)) continue;
  ffmpeg('-i', file, '-filter_complex', 'aformat=channel_layouts=mono,compand,showwavespic=s=480x64:colors=#d9d9d9', '-frames:v', '1', join(LIB, 'sounds', 'waves', `${item.id.split('/').pop().replace(/\.[^.]+$/, '')}.png`));
}
