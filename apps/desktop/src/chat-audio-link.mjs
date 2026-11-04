// @ts-check
/** A local audio link from an agent reply. Web links and non-audio files keep their ordinary link behavior. */
/** @param {string} href @returns {string | null} */
export function audioLinkPath(href) {
  if (!href || /[\u0000-\u001f\u007f]/.test(href) || /^(?:[a-z][a-z0-9+.-]*:|[\\/#?])/i.test(href)) return null;
  try {
    const path = decodeURIComponent(href.split(/[?#]/, 1)[0]);
    if (!path || /[\u0000-\u001f]/.test(path) || /^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(path)) return null;
    return /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(path) ? path : null;
  } catch { return null; }
}
