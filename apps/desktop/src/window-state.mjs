/**
 * What the window looked like when it was last closed: where it was, how wide the chat was, whether it was shown.
 * Kept in the app's data folder. Reads no Electron module, so `node --test` can use it.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const CHAT_MIN = 340;
export const CHAT_DEFAULT = 420;
export const STUDIO_MIN = 640;
export const WINDOW_MIN = { width: CHAT_MIN + STUDIO_MIN, height: 600 };

const finite = (value) => typeof value === 'number' && Number.isFinite(value);

/** The saved state, made sensible: anything missing or odd is the default. */
export function readWindowState(dir) {
  let raw = {};
  try { raw = JSON.parse(readFileSync(join(dir, 'window.json'), 'utf8')); } catch { /* first launch */ }
  const b = raw.bounds;
  const bounds = b && [b.x, b.y, b.width, b.height].every(finite)
    ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(WINDOW_MIN.width, Math.round(b.width)), height: Math.max(WINDOW_MIN.height, Math.round(b.height)) }
    : null;
  return {
    bounds,
    maximized: raw.maximized === true,
    chatWidth: finite(raw.chatWidth) ? Math.max(CHAT_MIN, Math.round(raw.chatWidth)) : CHAT_DEFAULT,
    chatOpen: raw.chatOpen !== false,
  };
}

export function writeWindowState(dir, state) {
  const file = join(dir, 'window.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, `${JSON.stringify(state)}\n`);
  renameSync(`${file}.tmp`, file);
}

/** Where a window with these bounds goes: on a display it overlaps, else centered on the main one. */
export function placeOnDisplays(bounds, displays, fallback) {
  if (!bounds) return fallback;
  const visible = displays.some(({ workArea: a }) => bounds.x < a.x + a.width - 80 && bounds.x + bounds.width > a.x + 80
    && bounds.y < a.y + a.height - 40 && bounds.y + 20 > a.y - 20);
  return visible ? bounds : { ...fallback, width: bounds.width, height: bounds.height };
}
