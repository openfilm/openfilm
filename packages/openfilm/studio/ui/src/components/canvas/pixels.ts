/**
 * What the canvas does to a picture or a clip on this computer, without a service: a picture cut into the cells of a
 * grid (its panels found by their gutters), a clip's frame taken as a picture. Each gives files to bring into the project.
 */

const load = (src: string) => new Promise<HTMLImageElement>((done, fail) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => done(img);
  img.onerror = () => fail(new Error('the picture did not load'));
  img.src = src;
});

const png = (canvas: HTMLCanvasElement, name: string) => new Promise<File>((done, fail) => {
  canvas.toBlob((blob) => (blob ? done(new File([blob], name, { type: 'image/png' })) : fail(new Error('no picture was made'))), 'image/png');
});

/**
 * A picture made of panels (a storyboard, a grid, a sheet) cut into them. The picture is read small: a column (or row)
 * the same tone all along is a gutter, and a run of them between two panels is cut out of both. Asked for `rows`×`cols`,
 * each cut moves from its even place onto the gutter near it — or, with none, onto the sharpest seam near it, or stays
 * even; asked for none (0×0), the gutters found say how many there are. A border round the whole picture, and gutter
 * left at a panel's edge, are trimmed away. Its cells, left to right then top to bottom, each a PNG named after it.
 */
export async function splitGrid(src: string, rows: number, cols: number, base: string): Promise<{ files: File[]; rows: number; cols: number; cells: Array<{ w: number; h: number }> }> {
  const img = await load(src);
  const W = img.naturalWidth;
  const H = img.naturalHeight;
  const scale = Math.min(1, 900 / Math.max(W, H));
  const w = Math.max(1, Math.round(W * scale));
  const h = Math.max(1, Math.round(H * scale));
  const small = document.createElement('canvas');
  small.width = w;
  small.height = h;
  const ctx = small.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const tone = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) tone[i] = 0.299 * px[i * 4]! + 0.587 * px[i * 4 + 1]! + 0.114 * px[i * 4 + 2]!;
  const at = (x: number, y: number) => tone[y * w + x]!;

  /* along one axis: how even each line is (a gutter is), and how sharply it differs from the next (a seam) */
  const lines = (across: boolean) => {
    const n = across ? w : h;
    const spread = new Float32Array(n);
    const seam = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0; let sq = 0; let step = 0; let count = 0;
      const m = across ? h : w;
      for (let j = 0; j < m; j++) {
        const v = across ? at(i, j) : at(j, i);
        sum += v; sq += v * v; count += 1;
        if (i + 1 < n) step += Math.abs(v - (across ? at(i + 1, j) : at(j, i + 1)));
      }
      spread[i] = Math.sqrt(Math.max(0, sq / count - (sum / count) ** 2));
      seam[i] = step / count;
    }
    return { spread, seam };
  };
  const EVEN = 10;
  const runs = (spread: Float32Array, a0: number, a1: number) => {
    const found: Array<[number, number]> = [];
    let start = -1;
    for (let i = a0; i <= a1; i++) {
      const even = i < a1 && spread[i]! < EVEN;
      if (even && start < 0) start = i;
      if (!even && start >= 0) { found.push([start, i - 1]); start = -1; }
    }
    return found;
  };
  /* the cuts along one axis, as [start, end) spans of the small picture */
  const spans = (across: boolean, count: number): Array<[number, number]> => {
    const n = across ? w : h;
    const { spread, seam } = lines(across);
    const bands = runs(spread, 0, n);
    let lo = 0; let hi = n;
    /* a border round it all */
    const first = bands[0]; const last = bands[bands.length - 1];
    if (first && first[0] === 0 && first[1] < n * 0.2) lo = first[1] + 1;
    if (last && last[1] === n - 1 && last[0] > n * 0.8) hi = last[0];
    const inner = bands.filter(([a, b]) => a > lo && b < hi - 1);
    if (!count) {
      /* how many: the gutters found, if they part it into near-even panels */
      if (!inner.length || inner.length > 9) return [[lo, hi]];
      const edges = [lo, ...inner.flatMap(([a, b]) => [a, b + 1]), hi];
      const sizes = edges.reduce<number[]>((list, _, i) => (i % 2 === 0 && i + 1 < edges.length ? [...list, edges[i + 1]! - edges[i]!] : list), []);
      const mean = sizes.reduce((x, y) => x + y, 0) / sizes.length;
      if (sizes.some((size) => Math.abs(size - mean) > mean * 0.3)) return [[lo, hi]];
      return sizes.map((_, i) => [edges[2 * i]!, edges[2 * i + 1]!]);
    }
    const size = (hi - lo) / count;
    const sorted = [...seam].slice(lo, hi).sort((x, y) => x - y);
    const usual = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const cuts: Array<[number, number]> = [];
    for (let k = 1; k < count; k++) {
      const even = lo + size * k;
      const reach = size * 0.15;
      const near = inner.filter(([a, b]) => b >= even - reach && a <= even + reach)
        .sort((p, q) => Math.abs((p[0] + p[1]) / 2 - even) - Math.abs((q[0] + q[1]) / 2 - even))[0];
      if (near) { cuts.push([near[0], near[1] + 1]); continue; }
      let best = Math.round(even); let sharp = 0;
      for (let i = Math.max(lo, Math.round(even - reach)); i < Math.min(hi - 1, Math.round(even + reach)); i++) if (seam[i]! > sharp) { sharp = seam[i]!; best = i + 1; }
      const cut = sharp > usual * 3 ? best : Math.round(even);
      cuts.push([cut, cut]);
    }
    const edges = [lo, ...cuts.flat(), hi];
    return Array.from({ length: count }, (_, i) => [edges[2 * i]!, edges[2 * i + 1]!] as [number, number]);
  };
  const xs = spans(true, cols);
  const ys = spans(false, rows);
  if (xs.length < 2 && ys.length < 2) throw new Error('no grid found');

  /* gutter left at a panel's own edge, trimmed (never more than a tenth of it) */
  const trim = (x0: number, x1: number, y0: number, y1: number) => {
    const evenCol = (x: number) => { let s = 0; let q = 0; for (let y = y0; y < y1; y++) { const v = at(x, y); s += v; q += v * v; } const n = y1 - y0; return Math.sqrt(Math.max(0, q / n - (s / n) ** 2)) < EVEN; };
    const evenRow = (y: number) => { let s = 0; let q = 0; for (let x = x0; x < x1; x++) { const v = at(x, y); s += v; q += v * v; } const n = x1 - x0; return Math.sqrt(Math.max(0, q / n - (s / n) ** 2)) < EVEN; };
    const mx = Math.floor((x1 - x0) / 10); const my = Math.floor((y1 - y0) / 10);
    let a = x0; let b = x1; let c = y0; let d = y1;
    while (a < x0 + mx && evenCol(a)) a++;
    while (b > x1 - mx && evenCol(b - 1)) b--;
    while (c < y0 + my && evenRow(c)) c++;
    while (d > y1 - my && evenRow(d - 1)) d--;
    return [a, b, c, d] as const;
  };
  const files: File[] = [];
  const cells: Array<{ w: number; h: number }> = [];
  for (const [y0, y1] of ys) {
    for (const [x0, x1] of xs) {
      const [a, b, c, d] = trim(x0, x1, y0, y1);
      /* back to the picture's own size, a pixel inside so no gutter shows at the edge */
      const inset = scale < 1 ? 1 : 0;
      const sx = Math.ceil(a / scale) + inset; const sy = Math.ceil(c / scale) + inset;
      const sw = Math.max(1, Math.floor(b / scale) - inset - sx); const sh = Math.max(1, Math.floor(d / scale) - inset - sy);
      const canvas = document.createElement('canvas');
      canvas.width = sw;
      canvas.height = sh;
      canvas.getContext('2d')!.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      files.push(await png(canvas, `${base}-${files.length + 1}.png`));
      cells.push({ w: sw, h: sh });
    }
  }
  return { files, rows: ys.length, cols: xs.length, cells };
}

/** A clip's frame at `seconds` (its first, without one), as a PNG. */
export async function frameOf(src: string, seconds: number, name: string): Promise<File> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  const waitFor = (event: 'loadeddata' | 'seeked') => new Promise<void>((done, fail) => {
    const listeners = new AbortController();
    const finish = (error?: Error) => {
      clearTimeout(timer);
      listeners.abort();
      if (error) fail(error);
      else done();
    };
    const timer = window.setTimeout(() => finish(new Error('the clip took too long to load')), 15000);
    video.addEventListener(event, () => finish(), { signal: listeners.signal });
    video.addEventListener('error', () => finish(new Error('the clip did not load')), { signal: listeners.signal });
  });
  try {
    const loaded = waitFor('loadeddata');
    video.src = src;
    await loaded;
    /* The end of the media is outside its last frame. Seek just inside it. */
    const at = Math.min(Math.max(0, seconds), Math.max(0, video.duration - 0.001));
    if (Number.isFinite(at) && at !== video.currentTime) {
      const sought = waitFor('seeked');
      video.currentTime = at;
      await sought;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')!.drawImage(video, 0, 0);
    return png(canvas, name);
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}
