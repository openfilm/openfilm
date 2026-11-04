// @ts-check
/** Local audio is read only after a click in the trusted chat, never served through Studio's HTTP origin. */
import { open } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { audioLinkPath } from './chat-audio-link.mjs';

const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
const TYPES = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.opus': 'audio/ogg' };

/** @param {string} project @param {string} href */
export async function readChatAudio(project, href) {
  const path = typeof href === 'string' ? audioLinkPath(href) : null;
  if (!path) throw new Error('not a relative audio link');
  // Parent-relative auditions are common: the path is relative to the agent's project, not the Studio page.
  const file = resolve(project, path);
  const handle = await open(file, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !stat.size || stat.size > MAX_AUDIO_BYTES) throw new Error('audio must be a file of at most 32 MB');
    // A bounded read even if the file grows while it is opened.
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (!bytesRead) throw new Error('audio changed while reading');
      offset += bytesRead;
    }
    return { name: basename(file), mediaType: TYPES[extname(file).toLowerCase()], bytes: new Uint8Array(bytes) };
  } finally { await handle.close(); }
}
