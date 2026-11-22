// @ts-check
/**
 * What the app's browser (browser.mjs) lets a web page do. Only the rules, as plain functions: reads no Electron
 * module, so `node --test` can use it.
 *
 * A page of the web is never trusted. It gets no way to the app (no preload, no IPC), none to this computer's files,
 * and none to what this computer or its network serves unless the person went there themselves:
 *
 *   · an address      http and https load; mail, phone and other apps' links are the person's to open (asked first);
 *                     files, the app's own links and every other scheme are refused (`navigation`).
 *   · a request       the app's own servers (Studio, the agents' doors) are never reached from the browser; another
 *                     address on this computer or its network only by going there, or from a page that is there
 *                     already, never from a page of the web (`request`).
 *   · a permission    refused unless listed here; the ones that reach the person (camera, microphone, notifications,
 *                     reading the clipboard) are asked of the person, site by site (`permission`). Location is
 *                     refused: Chromium finds it through a service the app has no key for.
 *   · a download      the person picks where; a file that can run is said to be one first (`riskyDownload`).
 */

/** Schemes a tab loads. */
const LOADED = new Set(['http:', 'https:']);
/** Schemes that are another app's to open, once the person says so. Anything else that is not loaded is refused. */
const OUTSIDE = new Set(['mailto:', 'tel:', 'sms:', 'facetime:', 'facetime-audio:', 'maps:', 'itms-apps:', 'macappstore:', 'ms-windows-store:', 'zoommtg:', 'msteams:', 'slack:', 'tg:', 'weixin:', 'spotify:', 'vscode:', 'cursor:', 'figma:', 'notion:', 'magnet:']);

/** @param {string} text → the URL it is, or null */
function parse(text) {
  try { return new URL(text); } catch { return null; }
}

/**
 * Whether a host is this computer or its network: loopback, the private and link-local ranges, carrier-grade NAT, the
 * unspecified address, and the names that only resolve there. `hostname` as a URL gives it (a number written any way
 * is already dotted there: `http://2130706433/` is 127.0.0.1).
 * @param {string} hostname
 */
export function isLocalHost(hostname) {
  const host = String(hostname ?? '').toLowerCase().replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home|home\.arpa|localdomain|intranet|corp)$/.test(host)) return true;
  /* a single label (`http://printer/`) resolves on the network only */
  if (!host.includes('.') && !host.includes(':') && !host.startsWith('[')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) return localV4(v4.slice(1).map(Number));
  if (host.startsWith('[') && host.endsWith(']')) return localV6(host.slice(1, -1));
  return false;
}

/** @param {number[]} parts */
function localV4([a, b]) {
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

/** @param {string} address an IPv6 address as a URL writes it (compressed, lowercase) */
function localV6(address) {
  if (address === '::' || address === '::1') return true;
  /* an IPv4 address inside one (`::ffff:7f00:1`, `::ffff:127.0.0.1`, `64:ff9b::…`) */
  const dotted = /:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (dotted) return localV4(dotted.slice(1).map(Number));
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(address);
  if (mapped) { const hi = parseInt(mapped[1], 16), lo = parseInt(mapped[2], 16); return localV4([hi >> 8, hi & 255, lo >> 8, lo & 255]); }
  const first = parseInt(address.split(':')[0] || '0', 16);
  /* unique local fc00::/7, link-local fe80::/10 */
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
}

/**
 * What is done with an address a tab is sent to (typed, a link followed, a redirect, a window a page opens):
 * `load` it, hand it to the person to open `outside` the app, or `refuse` it.
 * @param {string} address @returns {'load' | 'outside' | 'refuse'}
 */
export function navigation(address) {
  const url = parse(address);
  if (!url) return 'refuse';
  if (LOADED.has(url.protocol)) return url.hostname ? 'load' : 'refuse';
  if (address === 'about:blank') return 'load';
  return OUTSIDE.has(url.protocol) ? 'outside' : 'refuse';
}

/**
 * The address typed text means: an address as it is, a host with `https://` before it (`http://` on this computer or
 * its network, where few serve anything else), else what a search for the words finds. Null: nothing to go to (empty,
 * or an address that is refused).
 * @param {string} text @param {{ search?: (query: string) => string }} [o]
 */
export function typedAddress(text, { search = searchAddress } = {}) {
  const typed = String(text ?? '').trim();
  if (!typed) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) || /^(about|mailto|tel):/i.test(typed)) {
    const url = parse(typed);
    return url && navigation(url.href) !== 'refuse' ? url.href : null;
  }
  /* a host, with or without a port and a path: no spaces, and a dot, a port, or this computer by name */
  if (!/\s/.test(typed) && /^(localhost|\[[0-9a-f:.]+\]|[^/?#:]+\.[^/?#:]+|[^/?#:]+:\d{1,5})(:\d{1,5})?([/?#].*)?$/i.test(typed)) {
    const host = parse(`http://${typed}`);
    if (host?.hostname && !/[^\x21-\x7e]/.test(host.hostname)) return parse(`${isLocalHost(host.hostname) ? 'http' : 'https'}://${typed}`)?.href ?? null;
  }
  return search(typed);
}

/** A search for `query`, on the engine most networks reach. */
export function searchAddress(query) {
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
}

/** The site an address belongs to, as permissions are kept by: its origin (`https://example.com`), or null. */
export function siteOf(address) {
  const url = parse(address);
  return url && LOADED.has(url.protocol) && url.hostname ? url.origin : null;
}

/**
 * An address as the person is shown it, taken from the tab itself and never from the page: the whole address, its
 * host apart (always the encoded form, so a name written in look-alike letters reads `xn--…`), and how the page came:
 * `secure` (https), `local` (this computer or its network), `insecure` (http from the web), `none` (no page).
 * @param {string} address
 */
export function shownAddress(address) {
  const url = parse(address);
  if (!url || !LOADED.has(url.protocol)) return { text: '', host: '', state: /** @type {const} */ ('none') };
  const state = url.protocol === 'https:' ? 'secure' : isLocalHost(url.hostname) ? 'local' : 'insecure';
  /* a name and password in the address are never shown: `https://bank.com@evil.example/` reads evil.example */
  const text = `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
  return { text, host: url.hostname, state: /** @type {'secure' | 'local' | 'insecure'} */ (state) };
}

/**
 * Whether a request of the browser goes out. `own`: the origins of the app's own servers, never reached from here.
 * `type`: what asks (Electron's resourceType; `mainFrame` is the tab going somewhere); `top`: the address of the tab's
 * page (none while it has none).
 * @param {{ url: string, type?: string, top?: string | null, own?: Iterable<string> }} o
 * @returns {'allow' | 'block'}
 */
export function request({ url: address, type = 'other', top = null, own = [] }) {
  const url = parse(address);
  if (!url) return 'block';
  const web = { 'ws:': 'http:', 'wss:': 'https:' }[url.protocol] ?? url.protocol;
  /* what never leaves the page (data:, blob:, about:) */
  if (!LOADED.has(web)) return ['data:', 'blob:', 'about:'].includes(url.protocol) ? 'allow' : 'block';
  if (!url.hostname) return 'block';
  const port = (/** @type {URL} */ u) => u.port || (u.protocol === 'https:' || u.protocol === 'wss:' ? '443' : '80');
  for (const origin of own) {
    const mine = parse(origin);
    if (mine && port(mine) === port(url) && isLocalHost(url.hostname)) return 'block';
  }
  if (!isLocalHost(url.hostname)) return 'allow';
  if (type === 'mainFrame') return 'allow';
  const page = top ? parse(top) : null;
  return page && LOADED.has(page.protocol) && isLocalHost(page.hostname) ? 'allow' : 'block';
}

/**
 * What a page may be let do, by Electron's name for it. `allow`: what a browser gives any page; `ask`: what reaches
 * the person or their devices, asked of them site by site (`permissionKey` names what is kept); everything else is
 * refused, a name not known here too.
 */
const ALLOWED = new Set(['clipboard-sanitized-write', 'pointerLock', 'background-sync', 'sensors', 'screen-wake-lock', 'mediaKeySystem', 'speaker-selection']);
const ASKED = new Set(['media', 'notifications', 'clipboard-read']);

/**
 * @param {string} name @param {{ site: string | null, mainFrame?: boolean, secure?: boolean }} o `site`: the origin
 *   asking; `mainFrame`: it is the tab's own page asking, not a frame inside it; `secure`: it came over https, or from
 *   this computer
 * @returns {'allow' | 'ask' | 'deny'}
 */
export function permission(name, { site, mainFrame = true, secure = false }) {
  if (!site) return 'deny';
  if (ALLOWED.has(name)) return 'allow';
  if (!ASKED.has(name)) return 'deny';
  /* a frame inside the page, or a page that came unencrypted, cannot ask for the person's devices */
  return mainFrame && secure ? 'ask' : 'deny';
}

/**
 * What is kept of an asked permission, one answer each: the camera and the microphone apart (`media` asks for either
 * or both). → the keys this request needs, all of which must be allowed.
 * @param {string} name @param {{ mediaTypes?: string[], mediaType?: string }} [details]
 * @returns {string[]}
 */
export function permissionKeys(name, details = {}) {
  if (name !== 'media') return [name];
  const types = details.mediaTypes ?? (details.mediaType ? [details.mediaType] : []);
  const keys = [...(types.includes('video') ? ['camera'] : []), ...(types.includes('audio') ? ['microphone'] : [])];
  /* asked without saying which (a check before any request): both */
  return keys.length ? keys : ['camera', 'microphone'];
}

/**
 * The answers the person gave, site by site, as kept on disk: read whatever is there, keep only what is one.
 * @param {unknown} raw @returns {Record<string, Record<string, 'allow' | 'deny'>>}
 */
export function readAnswers(raw) {
  /** @type {Record<string, Record<string, 'allow' | 'deny'>>} */
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [site, answers] of Object.entries(raw).slice(0, 2000)) {
    if (siteOf(site) !== site || !answers || typeof answers !== 'object') continue;
    for (const [key, answer] of Object.entries(answers)) {
      if (!['camera', 'microphone', 'notifications', 'clipboard-read'].includes(key)) continue;
      if (answer === 'allow' || answer === 'deny') (out[site] ??= {})[key] = answer;
    }
  }
  return out;
}

/** Files that run, or install, when opened: said to be so before they are kept. */
const RUNS = new Set(['app', 'apk', 'appimage', 'bat', 'cmd', 'com', 'command', 'cpl', 'deb', 'dll', 'dmg', 'exe', 'hta', 'jar', 'js', 'jse', 'lnk', 'mpkg', 'msi', 'msix', 'msp', 'pif', 'pkg', 'ps1', 'reg', 'rpm', 'scr', 'sh', 'vb', 'vbe', 'vbs', 'workflow', 'wsf', 'zsh', 'terminal', 'action', 'scpt', 'iso', 'img']);

/** Whether a downloaded file of this name can run when opened. */
export function riskyDownload(name) {
  const ext = /\.([a-z0-9]{1,10})$/i.exec(String(name ?? '').trim())?.[1]?.toLowerCase();
  return Boolean(ext && RUNS.has(ext));
}

/**
 * A download's name as a file's: no folder in it, nothing a file system refuses, no dot first (a hidden file), no
 * trailing dots or spaces (Windows drops them, and the type with them), at most 200 characters, its type kept.
 * @param {string} name
 */
export function downloadName(name) {
  let clean = String(name ?? '').replace(/[\u0000-\u001f\u007f<>:"/\\|?*‪-‮⁦-⁩]/g, '_').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '');
  if (!clean) clean = 'download';
  if (clean.length > 200) {
    const ext = /\.[a-z0-9]{1,10}$/i.exec(clean)?.[0] ?? '';
    clean = `${clean.slice(0, 200 - ext.length)}${ext}`;
  }
  return clean;
}

/**
 * Windows a page opens become tabs, and a page may open only so many: at most `burst` within `withinMs`, and no more
 * once the project has `most` tabs. → `(tabsNow) => boolean`, true when one more may open.
 * @param {{ burst?: number, withinMs?: number, most?: number, now?: () => number }} [o]
 */
export function popupGate({ burst = 3, withinMs = 10_000, most = 12, now = Date.now } = {}) {
  /** @type {number[]} */
  let opened = [];
  return (/** @type {number} */ tabsNow) => {
    const at = now();
    opened = opened.filter((t) => at - t < withinMs);
    if (tabsNow >= most || opened.length >= burst) return false;
    opened.push(at);
    return true;
  };
}

/**
 * The browser's name for itself to the sites, without the app's and Electron's names: sites serve what they serve
 * Chrome, and are not told which app the person uses.
 * @param {string} userAgent
 */
export function plainUserAgent(userAgent) {
  return String(userAgent).replace(/\s(?!Chrome\/|Safari\/|Mozilla\/|AppleWebKit\/|Edg\/)[A-Za-z][\w.-]*\/[\w.+-]+(?=\s(?:Chrome|Safari)\/)/g, '').replace(/\sElectron\/[\w.+-]+/g, '');
}
