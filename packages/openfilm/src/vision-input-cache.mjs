/** Exact input reuse also handles held frames and source/output frame-rate differences, including VFR. */
const last = new Map();
export async function inputKey(name, pixels) {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', pixels));
  return `${name}:${Array.from(bytes, (v) => v.toString(16).padStart(2, '0')).join('')}`;
}
export function previousInput(name, key) { const item = last.get(name); return key && item?.key === key ? item.value : null; }
export function keepInput(name, key, value) { if (!key) return; last.delete(name); last.set(name, { key, value }); while (last.size > 8) last.delete(last.keys().next().value); }
export function clearInputCache() { last.clear(); }
