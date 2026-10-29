/**
 * Whether this browser decodes a project's video, for one not every browser does (studio/server/proxies.mjs
 * playChecks): HEVC on a computer without a chip for it, ProRes, 10-bit H.264… One it does not shows nothing in the
 * preview until its proxy is made, so the editor tells the server, which makes those first.
 */

/** What the server asks of a video: its type with its codec string ('' when no browser plays its codec), its size and rate. */
export interface PlayCheck { type: string; width: number; height: number; fps: number }

/** How a browser is asked: whether it plays a type (canPlayType), and how it decodes one (MediaCapabilities). */
export interface DecodeProbes {
  canPlay: (type: string) => string;
  decodingInfo?: ((config: MediaDecodingConfiguration) => Promise<{ supported: boolean }>) | undefined;
}

/**
 * Whether a browser decodes a video: it says it plays its type, and, where it can tell, that it decodes it at its size
 * and rate (a chip that stops at 1080p says no to 4K). What it cannot tell is left to canPlayType.
 */
export async function decodesWith(check: PlayCheck, { canPlay, decodingInfo }: DecodeProbes): Promise<boolean> {
  if (!check.type || !canPlay(check.type)) return false;
  if (!decodingInfo || !(check.width > 0 && check.height > 0)) return true;
  try {
    const bitrate = Math.round(check.width * check.height * check.fps * 0.1);
    return (await decodingInfo({ type: 'file', video: { contentType: check.type, width: check.width, height: check.height, bitrate, framerate: check.fps } })).supported;
  } catch { return true; }
}

const asked = new Map<string, Promise<boolean>>();

/** Whether this browser decodes a video ({@link decodesWith}): asked once for each kind. */
export function decodes(check: PlayCheck): Promise<boolean> {
  const key = `${check.type}\0${check.width}x${check.height}@${check.fps}`;
  let answer = asked.get(key);
  if (!answer) {
    answer = decodesWith(check, {
      canPlay: (type) => document.createElement('video').canPlayType(type),
      decodingInfo: navigator.mediaCapabilities ? (config) => navigator.mediaCapabilities.decodingInfo(config) : undefined,
    });
    asked.set(key, answer);
  }
  return answer;
}
