/**
 * What the canvas does to a picture or a clip on this computer, without a service: a picture cut into the cells of a
 * grid (a 2×2 or 3×3 made in one), a clip's frame taken as a picture. Each gives files to bring into the project.
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

/** A picture's `n`×`n` cells, left to right then top to bottom, each a PNG named after it. */
export async function splitGrid(src: string, n: number, base: string): Promise<File[]> {
  const img = await load(src);
  const w = Math.floor(img.naturalWidth / n);
  const h = Math.floor(img.naturalHeight / n);
  const files: File[] = [];
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, col * w, row * h, w, h, 0, 0, w, h);
      files.push(await png(canvas, `${base}-${row * n + col + 1}.png`));
    }
  }
  return files;
}

/** A clip's frame at `seconds` (its first, without one), as a PNG. */
export async function frameOf(src: string, seconds: number, name: string): Promise<File> {
  const video = document.createElement('video');
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.preload = 'auto';
  video.src = src;
  await new Promise<void>((done, fail) => { video.onloadeddata = () => done(); video.onerror = () => fail(new Error('the clip did not load')); });
  video.currentTime = Math.min(Math.max(0, seconds), Math.max(0, video.duration - 0.05));
  await new Promise<void>((done) => { video.onseeked = () => done(); });
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  return png(canvas, name);
}
