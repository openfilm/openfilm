// Hand-drawn strokes on a whiteboard, drawn on and written out as functions of t.
//
//   import { board, shapes, ease } from './whiteboard.js';
//   const b = board(document.querySelector('svg'));
//   const box = b.sketch(shapes.rect(200, 300, 420, 180), { color: '#1d4ed8', seed: 4 });
//   const title = b.text(document.querySelector('h1'));
//   window.film = { duration: 6, frame(t) {
//     b.pen(box.draw(ease(t, 0.5, 1.5)));    // the box draws itself from 0.5 s to 2 s, the pen at its tip
//     title.write(ease(t, 2, 1.2));
//   } };
//
// Drawing order is the order of strokes; the same t always draws the same marks.

const NS = 'http://www.w3.org/2000/svg';

/** A number in [0, 1) for an integer key. */
export function rand(key) {
  let x = (key | 0) ^ 0x2545f491;
  x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
  x = Math.imul(x ^ (x >>> 12), 0x297a2d39);
  return ((x ^ (x >>> 15)) >>> 0) / 4294967296;
}

/** Progress 0–1 of a stroke that starts at `start` and takes `dur` seconds, eased in and out like a hand. */
export function ease(t, start, dur) {
  const p = Math.min(1, Math.max(0, (t - start) / dur));
  return p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
}

/** Points of plain shapes; each shape is a list of strokes, each stroke a list of [x, y]. */
export const shapes = {
  line: (x1, y1, x2, y2) => [[[x1, y1], [x2, y2]]],
  rect: (x, y, w, h) => [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y + h * 0.02]]],
  ellipse(cx, cy, rx, ry, turn = 1.06) {
    const pts = [], n = 48;
    for (let i = 0; i <= n * turn; i++) { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    return [pts];
  },
  arrow(x1, y1, x2, y2, head = 26) {
    const a = Math.atan2(y2 - y1, x2 - x1), s = 0.45;
    return [
      [[x1, y1], [x2, y2]],
      [[x2 - head * Math.cos(a - s), y2 - head * Math.sin(a - s)], [x2, y2], [x2 - head * Math.cos(a + s), y2 - head * Math.sin(a + s)]],
    ];
  },
  /** An underline that a hand draws quickly: a little arc, a little long. */
  underline: (x, y, w) => [[[x - 6, y + 3], [x + w * 0.5, y - 2], [x + w + 8, y + 2]]],
  /** A path of your own: [[x, y], …] through which the hand passes. */
  path: (pts) => [pts],
};

/** A wobbling copy of a stroke, as a hand draws it: points every ~24 px, each nudged a little across the line. */
function wobble(pts, seed, amount) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1), steps = Math.max(1, Math.round(len / 24));
    const nx = -(y2 - y1) / (len || 1), ny = (x2 - x1) / (len || 1);
    for (let s = 0; s < steps; s++) {
      const f = s / steps, k = seed * 977 + i * 131 + s;
      const off = (rand(k) - 0.5) * amount * Math.min(1, len / 80);
      out.push([x1 + (x2 - x1) * f + nx * off, y1 + (y2 - y1) * f + ny * off]);
    }
  }
  const last = pts[pts.length - 1];
  out.push([last[0] + (rand(seed + 5) - 0.5) * amount, last[1] + (rand(seed + 6) - 0.5) * amount]);
  return out;
}

/** A smooth SVG path through points (quadratic curves through the midpoints). */
function smooth(pts) {
  if (pts.length < 3) return `M${pts.map((p) => p.map((v) => v.toFixed(1)).join(' ')).join(' L')}`;
  let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += ` Q${pts[i][0].toFixed(1)} ${pts[i][1].toFixed(1)} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  const z = pts[pts.length - 1];
  return `${d} L${z[0].toFixed(1)} ${z[1].toFixed(1)}`;
}

/**
 * A board in an <svg> that covers the stage (give it a viewBox in stage px). `sketch` adds marks, `text` writes out an
 * element's words, `pen` shows a marker at the tip of what is being drawn.
 */
export function board(svg) {
  let pen = null;
  return {
    /**
     * Strokes (from `shapes`) drawn as a marker would: each one twice, a little apart, unless `twice: false`.
     * Returns { draw(p) }: p 0–1 of the whole mark, drawn stroke after stroke; it returns the tip [x, y] while drawing.
     */
    sketch(strokes, { color = '#1f2937', width = 5, seed = 1, rough = 3, twice = true, fill = null } = {}) {
      const g = document.createElementNS(NS, 'g');
      svg.append(g);
      if (fill) {
        const f = document.createElementNS(NS, 'path');
        f.setAttribute('d', strokes.map((s) => smooth(wobble(s, seed + 50, rough * 2)) + ' Z').join(' '));
        f.setAttribute('fill', fill);
        f.setAttribute('opacity', '0');
        g.append(f);
        g.fillEl = f;
      }
      const paths = [];
      strokes.forEach((s, i) => {
        for (let pass = 0; pass < (twice ? 2 : 1); pass++) {
          const p = document.createElementNS(NS, 'path');
          p.setAttribute('d', smooth(wobble(s, seed * 17 + i * 7 + pass * 101, rough)));
          p.setAttribute('fill', 'none');
          p.setAttribute('stroke', color);
          p.setAttribute('stroke-width', String(pass ? width * 0.7 : width));
          p.setAttribute('stroke-linecap', 'round');
          p.setAttribute('stroke-linejoin', 'round');
          if (pass) p.setAttribute('opacity', '0.75');
          g.append(p);
          paths.push(p);
        }
      });
      const lengths = paths.map((p) => p.getTotalLength());
      paths.forEach((p, i) => p.setAttribute('stroke-dasharray', `${lengths[i]} ${lengths[i] + 1}`));
      const total = lengths.reduce((a, b) => a + b, 0);
      return {
        el: g,
        draw(p) {
          let left = Math.min(1, Math.max(0, p)) * total, tip = null;
          paths.forEach((path, i) => {
            const len = lengths[i], shown = Math.min(len, Math.max(0, left));
            path.setAttribute('stroke-dashoffset', String(len - shown));
            if (shown > 0 && shown < len && !tip) { const q = path.getPointAtLength(shown); tip = [q.x, q.y]; }
            left -= len;
          });
          if (g.fillEl) g.fillEl.setAttribute('opacity', String(p >= 1 ? 0.9 : 0));
          return tip;
        },
      };
    },

    /** Writes out an element's text character by character (each CJK character and each letter), as a hand writes. */
    text(el) {
      const chars = [];
      const walk = (node) => {
        for (const child of [...node.childNodes]) {
          if (child.nodeType === 3) {
            const frag = document.createDocumentFragment();
            for (const ch of child.textContent) {
              const span = document.createElement('span');
              span.textContent = ch;
              span.style.display = 'inline-block';
              if (ch === ' ') span.style.width = '0.3em';
              frag.append(span);
              chars.push(span);
            }
            child.replaceWith(frag);
          } else walk(child);
        }
      };
      walk(el);
      return {
        el,
        write(p) {
          const n = Math.min(1, Math.max(0, p)) * chars.length;
          chars.forEach((c, i) => {
            const a = Math.min(1, Math.max(0, n - i));
            c.style.opacity = String(a);
            c.style.transform = `translateY(${((1 - a) * 6).toFixed(1)}px)`;
          });
          const at = chars[Math.min(chars.length - 1, Math.floor(n))];
          if (p <= 0 || p >= 1 || !at) return null;
          const r = at.getBoundingClientRect(), s = svg.getBoundingClientRect(), k = (svg.viewBox.baseVal.width || s.width) / s.width;
          return [(r.right - s.left) * k, (r.bottom - s.top) * k];
        },
      };
    },

    /** The marker pen at the tip of what is being drawn: hidden when tip is null. */
    pen(tip, color = '#1f2937') {
      if (!pen) {
        pen = document.createElementNS(NS, 'g');
        pen.innerHTML = `<g transform="rotate(-38)">
          <rect x="-10" y="-150" width="20" height="120" rx="6" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/>
          <rect x="-10" y="-150" width="20" height="34" rx="6" fill="${color}"/>
          <path d="M-10 -30 L10 -30 L4 -6 L-4 -6 Z" fill="#d1d5db" stroke="#9ca3af" stroke-width="2"/>
          <path d="M-4 -6 L4 -6 L0 2 Z" fill="${color}"/></g>`;
        pen.style.filter = 'drop-shadow(6px 10px 6px rgba(0,0,0,.18))';
        svg.append(pen);
      }
      pen.setAttribute('visibility', tip ? 'visible' : 'hidden');
      if (tip) pen.setAttribute('transform', `translate(${tip[0].toFixed(1)} ${tip[1].toFixed(1)})`);
      svg.append(pen);
    },
  };
}
