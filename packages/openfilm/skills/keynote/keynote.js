// Moves of a product keynote, as functions of t: a slow camera, words revealed from a mask, devices holding real
// screenshots. Pair with keynote.css.
//
//   import { camera, reveal, device, scroll, inOut } from './keynote.js';
//   const laptop = device('laptop', 'assets/ui/home.png');
//   document.querySelector('.stage').append(laptop);
//   window.film = { duration: 5, frame(t) {
//     camera(laptop, t, [{ t: 0, scale: 0.9, y: 60 }, { t: 5, scale: 1.04, y: 0 }]);
//     reveal(document.querySelector('h1'), inOut((t - 0.4) / 0.9));
//   } };

export const clamp = (x) => Math.min(1, Math.max(0, x));
/** The keynote ease: slow out, slow in. */
export const inOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2; };
/** Fast then settling, for words and things that arrive. */
export const out = (x) => { x = clamp(x); return x >= 1 ? 1 : 1 - 2 ** (-10 * x); };

/**
 * Moves `el` through keys [{ t, x?, y?, scale?, rotate?, rotateX?, rotateY? }] (px and degrees), easing between
 * them. Before the first key it holds the first; after the last, the last. One long move per shot reads best.
 */
export function camera(el, t, keys, ease = inOut) {
  const at = keys.findIndex((k) => k.t > t);
  const a = keys[Math.max(0, at < 0 ? keys.length - 1 : at - 1)], b = keys[at < 0 ? keys.length - 1 : at];
  const p = a === b ? 1 : ease((t - a.t) / (b.t - a.t));
  const v = (k, d) => (a[k] ?? d) + ((b[k] ?? a[k] ?? d) - (a[k] ?? d)) * p;
  el.style.transform = `perspective(2400px) translate(${v('x', 0)}px, ${v('y', 0)}px) scale(${v('scale', 1)}) rotateX(${v('rotateX', 0)}deg) rotateY(${v('rotateY', 0)}deg) rotate(${v('rotate', 0)}deg)`;
}

/**
 * Reveals an element's text from below a mask, line by line or word by word (`by`: 'line' or 'word'), p 0–1.
 * The first call wraps its text in masks; the element keeps its own font and color.
 */
export function reveal(el, p, { by = 'word', stagger = 0.12, blur = true } = {}) {
  if (!el._kn) {
    const parts = by === 'line' ? [el.innerHTML] : el.textContent.split(/(\s+)/);
    el.innerHTML = parts.map((w) => (/^\s+$/.test(w) ? w : `<span class="kn-mask"><span class="kn-in">${w}</span></span>`)).join('');
    el._kn = [...el.querySelectorAll('.kn-in')];
  }
  const n = el._kn.length;
  el._kn.forEach((s, i) => {
    const q = out(clamp((p * (1 + stagger * (n - 1)) - stagger * i)));
    s.style.transform = `translateY(${((1 - q) * 105).toFixed(1)}%)`;
    s.style.opacity = String(q < 0.001 ? 0 : 1);
    s.style.filter = blur ? `blur(${((1 - q) * 6).toFixed(2)}px)` : '';
  });
}

/**
 * A device holding a screenshot: 'laptop', 'phone', 'browser' (a window with its bar) or 'tablet'. Returns the
 * element; size it with CSS width (the rest follows). The screenshot fills the screen from its top.
 */
export function device(kind, src, { alt = '' } = {}) {
  const el = document.createElement('div');
  el.className = `kn-device kn-${kind}`;
  el.innerHTML = `<div class="kn-body"><div class="kn-screen"><img src="${src}" alt="${alt}"></div></div>${kind === 'laptop' ? '<div class="kn-base"></div>' : ''}`;
  if (kind === 'browser') el.querySelector('.kn-body').insertAdjacentHTML('afterbegin', '<div class="kn-bar"><i></i><i></i><i></i></div>');
  return el;
}

/** Scrolls a device's full-page screenshot: p 0–1 from its top to as far as it goes. */
export function scroll(deviceEl, p) {
  const img = deviceEl.querySelector('.kn-screen img'), screen = deviceEl.querySelector('.kn-screen');
  const over = Math.max(0, img.offsetHeight - screen.clientHeight);
  img.style.transform = `translateY(${(-over * inOut(p)).toFixed(1)}px)`;
}

/** Waits for every image and font a page uses: give it to window.film.ready. */
export function loaded() {
  return Promise.all([...document.images].map((i) => i.decode().catch(() => {}))).then(() => document.fonts.ready);
}
