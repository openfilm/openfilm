/**
 * Whether the page is in a browser built on Chromium (Chrome, Edge, Arc, the desktop app), the engine films are
 * rendered and checked in. Another one (Safari, Firefox) may lack something a film's page draws with, such as canvas
 * filters: its preview can fail where the export does not.
 */
export function chromiumBased(ua: string = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  brands: readonly { brand: string }[] | undefined = typeof navigator === 'undefined' ? undefined : (navigator as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands): boolean {
  if (brands?.some((b) => /Chromium/i.test(b.brand))) return true;
  return /\b(Chrome|Chromium|CriOS|Edg)\//.test(ua) && !/\bFirefox\//.test(ua);
}
