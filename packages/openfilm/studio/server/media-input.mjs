// @ts-check
/** A file-backed upload can be reopened for a retry without keeping footage in the JavaScript heap. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { readable } from './files.mjs';
/** @param {string} root @param {string} path @param {{ speech?: boolean, signal: AbortSignal }} options */
export async function mediaInput(root, path, { speech = false, signal }) {
  const original = readable(root, path), info = await stat(original);
  if (!speech && (info.size <= 0 || info.size > 512 * 1024 ** 2)) throw new Error(`${path} exceeds the upload limit or is empty.`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(original, { signal })) hash.update(chunk);
  const version = hash.digest('hex');
  let file = original, temporary = '';
  try {
    if (speech) {
      temporary = await mkdtemp(join(tmpdir(), 'openfilm-upload-'));
      file = join(temporary, 'speech.mp3');
      await new Promise((resolve, reject) => execFile('ffmpeg', ['-y', '-nostdin', '-v', 'error', '-i', original, '-vn', '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-af', 'aresample=async=1:first_pts=0', '-c:a', 'libmp3lame', '-b:a', '32k', file],
        { signal, windowsHide: true }, error => error ? reject(error) : resolve(undefined)));
    }
    const size = (await stat(file)).size;
    if (size <= 0 || size > (speech ? 48 : 512) * 1024 ** 2) throw new Error(`${path} exceeds the upload limit or is empty.`);
    return { size, version: `${version}:${speech ? 'mp3-16k-mono-32k-v1' : 'original'}`,
      stream: () => /** @type {ReadableStream} */ (/** @type {unknown} */ (Readable.toWeb(createReadStream(file, { signal })))),
      async verify() { const current = await stat(original); if (current.size !== info.size || current.mtimeMs !== info.mtimeMs) throw new Error(`${path} changed during upload; nothing was generated.`); },
      async dispose() { if (temporary) await rm(temporary, { recursive: true, force: true }); },
    };
  } catch (e) { if (temporary) await rm(temporary, { recursive: true, force: true }); throw e; }
}
