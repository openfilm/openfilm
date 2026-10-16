// The look of old film over a page: grain, gate weave, flicker, dust, light leaks. Everything is a function of t.
//
//   import { filmLook } from './film-look.js';
//   const look = filmLook(document.body, { grain: 0.5, leaks: true, dust: true, seed: 3 });
//   window.film = { duration: 4, frame(t) { look(t); /* the page's own drawing */ } };
//
// `look(t)` adds its layers once, on top of the page, and returns the gate weave it applied ({ x, y, r }).

const FPS = 24;

/** A number in [0, 1) for an integer key: the same key always gives the same number. */
export function rand(key) {
  let x = (key | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise in [-1, 1] over time: the same t always gives the same value. */
export function wobble(t, key = 0, speed = 1) {
  const x = t * speed, i = Math.floor(x), f = x - i, s = f * f * (3 - 2 * f);
  const a = rand(i * 7919 + key * 104729) * 2 - 1, b = rand((i + 1) * 7919 + key * 104729) * 2 - 1;
  return a + (b - a) * s;
}

/** The frame number film would show at t: grain and dust change 24 times a second, as on a projector. */
export const filmFrame = (t) => Math.floor(t * FPS + 1e-6);

const CSS = `
.fl-layer { position: absolute; inset: 0; pointer-events: none; }
.fl-grain { width: 100%; height: 100%; mix-blend-mode: overlay; opacity: .9; }
.fl-leak { mix-blend-mode: screen; }
.fl-vignette { background: radial-gradient(ellipse at center, transparent 55%, rgba(20, 10, 0, .55) 100%); }
.fl-tint { background: #ffb36b; mix-blend-mode: soft-light; opacity: .22; }
`;

/**
 * Old film over `root` (usually document.body). Options:
 * - grain 0–1 (0.3), dust (true), leaks (true), vignette (true), tint (true): which layers and how strong;
 * - weave: px the picture drifts in the gate (1.5); flicker 0–1 (0.04);
 * - target: the element that weaves and flickers (root's first child by default; give it the picture, not the layers);
 * - seed: makes two pages differ.
 */
export function filmLook(root, opts = {}) {
  const o = { grain: 0.3, dust: true, leaks: true, vignette: true, tint: true, weave: 1.5, flicker: 0.04, seed: 1, ...opts };
  if (!document.getElementById('fl-style')) {
    const style = document.createElement('style');
    style.id = 'fl-style';
    style.textContent = CSS;
    document.head.append(style);
  }
  const target = o.target || root.firstElementChild;
  const layer = (cls) => { const el = document.createElement('div'); el.className = `fl-layer ${cls}`; root.append(el); return el; };
  if (o.tint) layer('fl-tint');
  const leak = o.leaks ? layer('fl-leak') : null;
  if (o.vignette) layer('fl-vignette');
  let grain = null, dust = null;
  if (o.grain > 0) {
    grain = document.createElement('canvas');
    grain.className = 'fl-layer fl-grain';
    grain.width = 960; grain.height = 540;
    root.append(grain);
  }
  if (o.dust) {
    dust = document.createElement('canvas');
    dust.className = 'fl-layer';
    dust.width = 960; dust.height = 540;
    root.append(dust);
  }

  return function look(t) {
    const n = filmFrame(t), s = o.seed * 1013;
    let shift = { x: 0, y: 0, r: 0 };
    if (target) {
      shift = { x: wobble(t, s + 1, 3) * o.weave, y: wobble(t, s + 2, 2.3) * o.weave, r: wobble(t, s + 3, 1.1) * 0.04 };
      const lum = 1 + (rand(n + s) * 2 - 1) * o.flicker;
      target.style.transform = `translate(${shift.x.toFixed(2)}px, ${shift.y.toFixed(2)}px) rotate(${shift.r.toFixed(3)}deg)`;
      target.style.filter = `brightness(${lum.toFixed(3)}) sepia(.16) saturate(.86) contrast(1.06)`;
    }
    if (grain) {
      const ctx = grain.getContext('2d'), img = ctx.createImageData(grain.width, grain.height), d = img.data;
      let x = (n + s) * 2654435761 >>> 0;
      for (let i = 0; i < d.length; i += 4) {
        x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
        const v = 128 + ((x & 255) - 128) * o.grain;
        d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
    }
    if (dust) {
      const ctx = dust.getContext('2d');
      ctx.clearRect(0, 0, dust.width, dust.height);
      const k = n * 31 + s;
      const specks = Math.floor(rand(k) * 5);
      ctx.fillStyle = 'rgba(20, 14, 8, .55)';
      for (let i = 0; i < specks; i++) {
        const r = 0.6 + rand(k + i * 3 + 1) * 2.2;
        ctx.beginPath();
        ctx.ellipse(rand(k + i * 3 + 2) * dust.width, rand(k + i * 3 + 3) * dust.height, r, r * (0.4 + rand(k + i) * 0.8), rand(k - i) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (rand(k + 99) < 0.12) {
        /* now and then a hair or a scratch for a frame */
        ctx.strokeStyle = rand(k + 98) < 0.5 ? 'rgba(20, 14, 8, .5)' : 'rgba(255, 250, 235, .35)';
        ctx.lineWidth = 0.8;
        const x0 = rand(k + 97) * dust.width;
        ctx.beginPath();
        ctx.moveTo(x0, 0);
        ctx.bezierCurveTo(x0 + 20, dust.height * 0.3, x0 - 15, dust.height * 0.7, x0 + 8, dust.height);
        ctx.stroke();
      }
    }
    if (leak) {
      const a = 0.18 + 0.14 * wobble(t, s + 7, 0.6);
      const x = 50 + 45 * wobble(t, s + 8, 0.25), y = 30 + 40 * wobble(t, s + 9, 0.2);
      leak.style.background = `radial-gradient(ellipse 60% 80% at ${x}% ${y}%, rgba(255, 120, 40, ${a.toFixed(3)}), transparent 70%),
        radial-gradient(ellipse 40% 60% at ${100 - x}% ${100 - y}%, rgba(255, 60, 90, ${(a * 0.5).toFixed(3)}), transparent 70%)`;
    }
    return shift;
  };
}

/**
 * A burst of light, as at the end of a roll: 0 before `at`, a quick flare to white-orange and back, over `dur`.
 * Use it on a cut: put a full-stage element over the picture and set its opacity to `burn(t, at)`.
 */
export function burn(t, at, dur = 0.5) {
  const p = (t - at) / dur;
  if (p <= 0 || p >= 1) return 0;
  return Math.sin(Math.PI * p) ** 1.5;
}
