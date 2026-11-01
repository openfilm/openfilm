#!/usr/bin/env node
/**
 * The pictures of the library's pages (library/index.json): for each page, a poster (poster.jpg) and a two-second
 * preview (preview.mp4) beside its saved.json, drawn by the renderer itself over the sample stills in
 * scripts/library-samples/ (made by the OpenFilm contributors). A transition is drawn on a cut from one still to the
 * other, its middle on the cut, and so is each of the timeline's fades; a sticker in the middle of a still; a template
 * whole, its places for pictures filled with the filters' sample photos. And the
 * picture the looks are shown on (library/filters/sample.jpg), and each sound's waveform (library/sounds/waves/).
 *
 *   node scripts/library-previews.mjs [id …]
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '../src/render.mjs';
import { closeBrowsers } from '../src/host.mjs';
import { GROUND } from './library-ground.mjs';
import { libraryIndex } from '../studio/server/library.mjs';
import { filmHtml } from '../src/film-doc.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const LIB = join(HERE, '..', 'library');
const SAMPLES = join(HERE, 'library-samples');
const W = 640, H = 360;

/* every thing of the library: its index and its other catalogs, as Studio shows them */
const index = /** @type {{ items: any[] }} */ (libraryIndex());
const asked = process.argv.slice(2);
const ffmpeg = (...args) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' }); if (r.status !== 0) throw new Error(`ffmpeg ${args.join(' ')}`); };

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

/* the templates' photos for the places of the person's pictures (library-templates.json names them, the filters' samples) */
const templateDefs = new Map(JSON.parse(readFileSync(join(HERE, 'library-templates.json'), 'utf8')).templates.map((d) => [`templates/${d.id}`, d]));

/** A template (a group): its clips laid out on the preview's picture, its places filled with photos, all of its length. */
function groupFilm(item, about, work) {
  const photos = templateDefs.get(item.id)?.photos ?? ['film', 'fresh', 'scenery', 'portrait'];
  const tracks = [];
  let slot = 0;
  for (const { track, at, clip } of about.clips) {
    let c = { ...clip, at, src: `item/${clip.src}` };
    if (clip.src === 'slot.html') {
      const photo = `p${slot}.jpg`;
      cpSync(join(LIB, 'filters', 'samples', `${photos[slot % photos.length]}.jpg`), join(work, photo));
      c = { at, src: photo, time: clip.time, style: 'object-fit: cover' };
      slot += 1;
    }
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

for (const item of index.items) {
  if (item.kind === 'group' && (!asked.length || asked.includes(item.id))) {
    const dir = join(LIB, item.id);
    const about = JSON.parse(readFileSync(join(dir, 'saved.json'), 'utf8'));
    const work = mkdtempSync(join(tmpdir(), 'openfilm-library-'));
    try {
      cpSync(join(dir, 'files'), join(work, 'item'), { recursive: true });
      const { html, posterAt, length } = groupFilm(item, about, work);
      writeFileSync(join(work, 'film.html'), html);
      const out = join(work, 'out.mp4');
      await render([work, `0-${length}`], { out, fps: 30, quiet: true });
      ffmpeg('-i', out, '-vf', 'scale=320:180', '-c:v', 'libx264', '-crf', '30', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', join(dir, 'preview.mp4'));
      ffmpeg('-ss', String(posterAt), '-i', out, '-frames:v', '1', '-vf', 'scale=320:180', '-q:v', '5', join(dir, 'poster.jpg'));
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
    for (const s of ['a.jpg', 'b.jpg', 'c.jpg']) cpSync(join(SAMPLES, s), join(work, s));
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
