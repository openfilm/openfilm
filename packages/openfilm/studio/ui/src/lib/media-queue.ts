/**
 * Studio's background requests for media facts (a file's length and size, a waveform): a few at a time.
 *
 * A browser keeps six connections to Studio. Opening a project used to ask for every file's facts at once — a web
 * page's are found by drawing it in the headless browser, one after another — and those requests held all six for
 * half a minute: an edit made meanwhile waited for a free one, and the person saw it fail. With at most
 * MEDIA_IN_FLIGHT of them out, the editor's own requests always find a connection.
 */
export const MEDIA_IN_FLIGHT = 2;

let running = 0;
const waiting: Array<() => void> = [];

/** `fetch`, waiting its turn among the media requests. */
export async function mediaFetch(url: string, init?: RequestInit): Promise<Response> {
  if (running >= MEDIA_IN_FLIGHT) await new Promise<void>((go) => waiting.push(go));
  running += 1;
  try {
    return await fetch(url, init);
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}
