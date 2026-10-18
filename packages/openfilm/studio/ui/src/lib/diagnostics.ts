/**
 * The diagnostic report Settings → Developer copies: `openfilm doctor` as Studio's server runs it (src/doctor.mjs), what
 * the browser Studio is open in can do (an agent's built-in browser can lack what Studio needs), and in the desktop
 * app, its agents (lib/host.ts `diagnostics`).
 */
import { chromiumBased } from './browser.ts';

export interface PageFacts {
  userAgent: string;
  chromium: boolean;
  /** what draws WebGL here; null without WebGL */
  webgl: string | null;
  /** inside another page's frame (a preview pane), where cookies and storage can be blocked */
  framed: boolean;
  cookies: boolean;
  storage: boolean;
  /** the screen and window, in CSS px, and the pixel ratio */
  screen: string;
}

/** What the page Studio is in can do, read now. */
export function pageFacts(): PageFacts {
  let webgl: string | null = null;
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    if (gl) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      webgl = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    }
  } catch { /* none */ }
  let storage = false;
  try { localStorage.setItem('openfilm-doctor', '1'); localStorage.removeItem('openfilm-doctor'); storage = true; } catch { /* blocked */ }
  let framed = false;
  try { framed = window.top !== window; } catch { framed = true; }
  return {
    userAgent: navigator.userAgent,
    chromium: chromiumBased(),
    webgl,
    framed,
    cookies: navigator.cookieEnabled,
    storage,
    screen: `${screen.width}×${screen.height}, window ${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
  };
}

/** The browser's lines of the report, each with ✓ or ✗ as the doctor's, and what to do about a ✗. */
export function browserLines(f: PageFacts): string[] {
  const line = (ok: boolean, label: string, text: string) => `${ok ? '✓' : '✗'} ${label.padEnd(10)}${text}`;
  const fixes: string[] = [];
  if (!f.chromium) fixes.push('Browser: open Studio in Chrome, Edge or the desktop app; previews can fail in other browsers');
  if (!f.webgl) fixes.push('WebGL: turn on hardware acceleration in the browser');
  if (!f.cookies || !f.storage) fixes.push('Storage: allow cookies and site data for 127.0.0.1, or open Studio in its own tab');
  return [
    'Browser Studio is open in',
    '',
    line(f.chromium, 'Engine', f.chromium ? 'Chromium' : 'not Chromium'),
    line(true, 'UA', f.userAgent),
    line(Boolean(f.webgl), 'WebGL', f.webgl ?? 'unavailable'),
    line(f.cookies && f.storage, 'Storage', `cookies ${f.cookies ? 'on' : 'off'}, site data ${f.storage ? 'on' : 'blocked'}${f.framed ? ', inside another page' : ''}`),
    line(true, 'Screen', f.screen),
    ...(fixes.length ? ['', 'To fix:', ...fixes.map((fix) => `  ${fix}`)] : []),
  ];
}

/** The whole report: the computer's, the browser's, and the desktop app's when there is one. */
export function fullReport(computer: string, page: PageFacts, app?: string | null): string {
  return [computer, browserLines(page).join('\n'), ...(app ? [app] : [])].join('\n\n────────\n\n');
}
