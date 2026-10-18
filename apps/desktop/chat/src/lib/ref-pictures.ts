/**
 * The pictures of a message's references, for its agent: each the frame Studio gave the reference (only the part
 * pointed at, for a region or a layer), as a JPEG kept in the project (.film/refs/<turn>-<n>.jpg, which the message
 * names) and, for an agent that takes pictures, sent with the message.
 */
import { app, type StudioRef, type StudioRefImage } from '@/app-bridge';
import type { PromptImage } from '@/lib/desktop-bridge';

/** at most this many pictures a message, each at most this wide: enough to see, little enough to send */
const MAX_PICTURES = 8;
const MAX_WIDTH = 1280;
/** a frame Studio has to draw first can take a moment; one that takes longer is left out */
const LOAD_TIMEOUT_MS = 15_000;

/** The reference's picture as a JPEG: fetched from Studio, cut to its crop (stage px, scaled to the picture's). */
async function encode(image: StudioRefImage): Promise<Blob> {
  if (!image.src) throw new Error('no picture was taken');
  const res = await fetch(image.src, { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Studio answered ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());
  try {
    let sx = 0;
    let sy = 0;
    let sw = bitmap.width;
    let sh = bitmap.height;
    if (image.crop && image.stage && image.stage.w > 0) {
      const scale = bitmap.width / image.stage.w;
      sx = Math.max(0, Math.round(image.crop.x * scale));
      sy = Math.max(0, Math.round(image.crop.y * scale));
      sw = Math.min(bitmap.width - sx, Math.round(image.crop.w * scale));
      sh = Math.min(bitmap.height - sy, Math.round(image.crop.h * scale));
    }
    if (sw < 1 || sh < 1) throw new Error('nothing to cut');
    const out = Math.min(1, MAX_WIDTH / sw);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * out)), Math.max(1, Math.round(sh * out)));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    /* a JPEG has no transparency: a page's see-through parts read as white, not black */
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  } finally {
    bitmap.close();
  }
}

function base64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let text = '';
  for (let i = 0; i < view.length; i += 0x8000) text += String.fromCharCode(...view.subarray(i, i + 0x8000));
  return btoa(text);
}

/**
 * Make the pictures of `refs` (in their order, numbered from 1 as in the message): `pictures[i]` is where reference
 * [i + 1]'s was kept in the project (none when it has none, or it did not load or could not be kept), `images` what
 * the agent is sent. Never throws: a picture that fails only leaves its line without one.
 */
export async function referencePictures(refs: StudioRef[], { project, turnId }: { project: string; turnId: string }): Promise<{
  pictures: Array<string | undefined>;
  images: PromptImage[];
}> {
  const wanted = refs.flatMap((ref, i) => (ref.image ? [{ n: i + 1, image: ref.image }] : [])).slice(0, MAX_PICTURES);
  const made = await Promise.all(wanted.map(async ({ n, image }) => {
    try {
      const bytes = await (await encode(image)).arrayBuffer();
      const kept = await app.chat.saveRefImage(project, turnId, n, bytes).then((r) => r.path, () => undefined);
      return { n, path: kept, image: { data: base64(bytes), mimeType: 'image/jpeg' } };
    } catch {
      return null;
    }
  }));
  const pictures: Array<string | undefined> = refs.map(() => undefined);
  const images: PromptImage[] = [];
  for (const picture of made) {
    if (!picture) continue;
    pictures[picture.n - 1] = picture.path;
    images.push(picture.image);
  }
  return { pictures, images };
}

/**
 * an attached picture is sent as it is up to this size and this many pixels on its long side; larger, made smaller.
 * 2000: a request with more than 20 pictures in it (a conversation's, not only this message's) takes none larger
 */
const ATTACHED_MAX_BYTES = 4 * 1024 * 1024;
const ATTACHED_MAX_SIDE = 2000;
const AS_IS = new Set(['image/jpeg', 'image/png', 'image/webp']);

/**
 * A picture attached to a message, as its agent is sent it beside the text (as a picture pasted in its own chat is):
 * itself when it is a JPEG, PNG or WebP small enough, else a JPEG at most ATTACHED_MAX_SIDE on its long side. Null
 * when it cannot be read as a picture.
 */
export async function attachedPicture(file: Blob): Promise<PromptImage | null> {
  try {
    const bitmap = await createImageBitmap(file);
    try {
      const long = Math.max(bitmap.width, bitmap.height);
      if (AS_IS.has(file.type) && file.size <= ATTACHED_MAX_BYTES && long <= ATTACHED_MAX_SIDE) {
        return { data: base64(await file.arrayBuffer()), mimeType: file.type };
      }
      const scale = Math.min(1, ATTACHED_MAX_SIDE / long);
      const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return { data: base64(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })).arrayBuffer()), mimeType: 'image/jpeg' };
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
