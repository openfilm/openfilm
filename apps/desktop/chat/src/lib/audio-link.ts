/** A local audio link from an agent reply. Web links and non-audio files keep their ordinary link behavior. */
export function audioLinkPath(href: string): string | null {
  if (!href || /[\u0000-\u001f\u007f]/.test(href) || /^(?:[a-z][a-z0-9+.-]*:|[\\/#?])/i.test(href)) return null;
  try {
    const path = decodeURIComponent(href.split(/[?#]/, 1)[0]!);
    if (!path || /[\u0000-\u001f]/.test(path) || /^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(path)) return null;
    return /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i.test(path) ? path : null;
  } catch { return null; }
}

/** Resolve within this project's token only. Studio checks the real file, including symlinks and approved media links. */
export function projectAudioUrl(href: string, folder: string | null): string | null {
  if (!folder || !audioLinkPath(href)) return null;
  try {
    const base = new URL(folder);
    const url = new URL(href, base);
    return base.pathname.endsWith('/') && url.origin === base.origin && url.pathname.startsWith(base.pathname) ? url.href : null;
  } catch { return null; }
}
