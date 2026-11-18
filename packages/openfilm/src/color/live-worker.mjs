// @ts-check
/**
 * A grade baked for the live preview (src/video-lut.mjs): the files of a clip's `--of-lut`, fetched from the film's
 * folder, evaluated as one transform (ctf.mjs, ops.mjs) and baked into a small 3D LUT, off the page's thread. Asked
 * `{ id, files: [url…], size }`, it answers `{ id, size, data }` (data: size³ RGB, red fastest) or `{ id, error }`.
 */
import { parseColorTransform } from './ctf.mjs';
import { bake } from './ops.mjs';

/* `texts`: files as an editor has them and has not written yet, by their url, read in their place */
self.onmessage = async ({ data: { id, files, size = 33, texts: drafts = {} } }) => {
  try {
    const texts = await Promise.all(files.map((url) => drafts[url] ?? fetch(url, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.text(); })));
    const ops = texts.flatMap((text, i) => parseColorTransform(text, new URL(files[i], location.href).pathname));
    const { lut } = bake(ops, { size });
    self.postMessage({ id, size, data: lut }, [lut.buffer]);
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
