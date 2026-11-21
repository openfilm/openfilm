// @ts-check
/**
 * Pictures of web pages: a page's frame at a moment, small (the timeline's thumbnails of a page clip, and a page's
 * poster in the media pane). A video's frames come from ffmpeg (derived.mjs); a page has no file to cut from, so it is
 * drawn the way an export draws it: in the headless browser, one frame. One browser for Studio, started on the first
 * request and closed after a minute without any; a few pages kept open (opening one is the slow part); a few pages
 * drawn at a time (PICTURE_LANES), one frame of each, so thumbnails never compete with the person's own preview for
 * long. Cached in .film/cache by the page file's
 * version, the moment and the width. Drawn on black, as the film shows a page with nothing below it; a page's poster
 * in the media pane may be drawn clear instead (a WebP with what the page leaves unpainted transparent).
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { availableParallelism, totalmem } from 'node:os';
import { join } from 'node:path';
import { FilmPage, FrameError, launch } from '../../src/host.mjs';
import { BrowserMemoryError, memoryError } from '../../src/browser-memory.mjs';
import { FILM_FILE, clipKind } from '../../src/film-doc.mjs';
import { browserCopies, filmVideos, madeCopy } from '../../src/seekable.mjs';
import { TOOL_DIR } from './projects.mjs';
import { writeAtomic } from './atomic.mjs';
import { inProject } from './files.mjs';

/**
 * How many pages are kept open, the least recently used closed past it: a film's pages are asked for their posters,
 * then for their frames, and one closed in between is opened again for them (the slow part). Four on a machine of
 * 8 GB, up to eight where there is memory for them; all are closed with the browser, a minute after the last picture.
 */
const KEEP_PAGES = Math.max(4, Math.min(8, Math.floor(totalmem() / 2 ** 31)));
/** Where a poster is looked for, as shares of the page's length. */
const POSTER_AT = [0.5, 0.4, 0.62, 0.3];
/** A page without a duration has no end: its poster is looked for in its first seconds, as long as a dropped still. */
const NO_END_SPAN = 4;
/** The width a poster is drawn at: a page asked about is opened at it too, so the two share one open page. */
const POSTER_W = 480;
const IDLE_MS = 60_000;
/* a thumbnail's frame that takes longer is given up (the queue of frames must not wait on one page for ever) */
const FRAME_MS = 15_000;
/* a whole job (the page opened, its frames drawn) that takes longer closes the browser: whatever it waits on, the
   queue goes on (the editor's requests wait on these pictures, and a browser has few connections to Studio) */
const JOB_MS = 45_000;
const FAILED_KEPT_MS = 30_000;
/** @type {Map<string, { error: unknown, at: number }>} frames that could not be drawn, by project and cache key */
const failures = new Map();
/** @type {Map<string, { error: unknown, at: number }>} pages that could not be opened, by pageFor's key: every frame of
 * one fails at once for a while, rather than each waiting out the same page again */
const unopened = new Map();
/** @type {Map<string, Promise<Buffer>>} frames being drawn, by project and cache key: asked again meanwhile, drawn once */
const drawing = new Map();
/** @type {Map<string, { version: string, error: BrowserMemoryError }>} pages whose drawing took more memory than the
 * browser may have, by project and page, at the version of the page's file then: not drawn again until it changes */
const heavy = new Map();

/** @type {Promise<import('playwright-core').Browser> | null} */
let browser = null;
/** @type {Map<string, Promise<FilmPage>>} url → open page, most recently used last */
const open = new Map();
/**
 * How many pages are drawn at once. One at a time, a film of page clips opened for the first time had its pictures
 * one after another, each page opened (the slow part: its fonts, its pictures, its code) while the others waited and
 * most of the machine stood idle. A few at once, each in its own tab of the one browser; no more, so the person's
 * own preview keeps its share of the machine (one on a small one).
 */
const PICTURE_LANES = Math.max(1, Math.min(3, Math.floor(availableParallelism() / 2) - 1));
/**
 * What is asked of the browser goes in two lines: the pictures (a frame, a poster), which a person is waiting to see,
 * PICTURE_LANES at a time, and the facts (a page's length and size, a compound's sounds), which nothing on screen
 * waits for, one at a time. In one line, a page that could not say its facts (a draft in the project's folder whose
 * file is missing: it is waited for until it is given up, a quarter of a minute) held every thumbnail of the film
 * behind it, each time the project was opened. One open page (by keyOf) is used by one of them at a time: the next
 * for it waits its turn, whatever its line, while what is asked of other pages goes on.
 * @type {Record<'pictures' | 'facts', number>}
 */
const MOST = { pictures: PICTURE_LANES, facts: 1 };
/** how many of each line are at work now */
const atWork = { pictures: 0, facts: 0 };
/** @type {{ line: 'pictures' | 'facts', key: string, go: () => void }[]} what waits its turn, in the order asked */
const waiting = [];
/** @type {Set<string>} the pages in use now (by keyOf): not used by another, and not closed to make room */
const inUse = new Set();
/** how many times the browser was closed for a page that took too long: what was at work beside it is drawn again */
let givenUp = 0;
/** @type {NodeJS.Timeout | null} */
let idle = null;

export class PageFrameError extends Error {}

/** The whole film, as the timeline page plays it (served on the film origin beside the project's files). */
export const FILM_PAGE = FILM_FILE;

/**
 * The page `rel` of the folder served at `base` (its film-origin URL), drawn at `ms`, `width` px wide, as JPEG (with
 * `clear`, as a WebP whose unpainted parts are transparent; never the whole film's, which a card shows as it plays).
 * `ms` past the page's end draws its last frame; `ms` < 0 draws the middle (its poster). `overrides`: a page clip's
 * (SPEC §1), drawn with it, so its pictures on the timeline show what was changed in it. `size`: a page clip's, the
 * CSS pixels a page without a size of its own is laid out at (SPEC §1), as the film lays it out; without one it is
 * 1920 × 1080, as a page opened on its own.
 * @param {string} root @param {string} base @param {string} rel @param {number} ms @param {number} width
 * @param {object[] | null} [overrides] @param {{ w: number, h: number } | null} [size] @param {boolean} [clear]
 */
export async function pageFrame(root, base, rel, ms, width, overrides = null, size = null, clear = false) {
  clear &&= rel !== FILM_PAGE;
  const w = Math.max(32, Math.min(960, Math.round(width / 2) * 2 || 160));
  /* `rel` is the request's: a page of the project only, never one reached by `../` or a link out of the folder */
  const page = inProject(root, rel);
  const info = page ? await stat(page).catch(() => null) : null;
  if (!info?.isFile()) throw new PageFrameError(`${rel} is not there`);
  /* `black`: how frames are drawn (frames drawn on white before are not reused); `clear`, on nothing */
  const tweaks = overrides?.some((o) => o && typeof o === 'object' && 'at' in o) ? JSON.stringify(overrides) : '';
  const laid = size ? `${Math.round(size.w)}x${Math.round(size.h)}` : '';
  const key = createHash('sha256').update(`${clear ? 'clear' : 'black'}\0${rel}\0${Math.round(ms)}\0${w}${tweaks ? `\0${tweaks}` : ''}${laid ? `\0${laid}` : ''}`).digest('hex').slice(0, 24);
  const dir = join(root, TOOL_DIR, 'cache', 'pageframes');
  const file = join(dir, `${key}.${clear ? 'webp' : 'jpg'}`);
  /* a frame is good while every file the page loaded to draw it is as it was then: the page, and its styles, code,
     fonts, pictures (a page's look changes with a stylesheet it shares as much as with itself) */
  const known = await readFile(join(dir, `${key}.json`), 'utf8').then((t) => /** @type {string[]} */ (JSON.parse(t).files), () => null);
  const files = known?.includes(rel) ? known : [rel];
  const version = await stampOf(root, files);
  if (known && version === await readFile(join(dir, `${key}.stamp`), 'utf8').catch(() => '')) {
    const cached = await readFile(file).catch(() => null);
    if (cached) return cached;
  }
  /* two projects can hold the same file at the same version (a copied folder): what failed in one is not the other's */
  const id = `${root}\0${key}\0${version}`;
  /* a page that failed is not tried again for a while (the same files, the same frame): one broken page must not
     hold every thumbnail behind it again on each request */
  const failed = failures.get(id);
  if (failed && Date.now() - failed.at < FAILED_KEPT_MS) throw failed.error;
  /* a page too heavy to draw is not drawn again, at any moment or width, until its file changes */
  const pageVersion = `${info.mtimeMs}:${info.size}`;
  const tooHeavy = heavy.get(`${root}\0${rel}`);
  if (tooHeavy?.version === pageVersion) throw tooHeavy.error;
  const pending = drawing.get(id);
  if (pending) return pending;
  const made = (async () => {
    /* the film's footage this browser does not decode (ProRes; HEVC without a chip for it) gets a copy it plays first,
       served in its place (pages.mjs): drawn without one, the film shows nothing where it is */
    if (rel === FILM_PAGE) await filmCopies(root, base, info);
    /* a page drawn with tweaks is one of its own: the page kept open for another clip of the same file has none */
    const drawn = tweaks ? `${version}:${createHash('sha256').update(tweaks).digest('hex').slice(0, 12)}` : version;
    const { jpeg, duration, loaded, facts } = await draw(pageUrl(base, rel), ms, w, drawn, base, tweaks ? overrides : null, laid ? size : null, clear).catch((e) => {
      if (e instanceof BrowserMemoryError) heavy.set(`${root}\0${rel}`, { version: pageVersion, error: e });
      failures.set(id, { error: e, at: Date.now() });
      if (failures.size > 500) failures.delete(failures.keys().next().value ?? '');
      throw e;
    });
    /* the project's folder went while the frame was drawn (deleted, moved): nothing is written where it was */
    if (!existsSync(root)) return jpeg;
    const deps = [...new Set([rel, ...loaded])].filter((f) => existsSync(join(root, f)));
    await mkdir(dir, { recursive: true });
    await writeAtomic(file, jpeg);
    await writeAtomic(join(dir, `${key}.json`), JSON.stringify({ files: deps }));
    /* its facts, learnt on the way: the editor asks them of every page, and need not have it opened again for them */
    if (facts && rel !== FILM_PAGE && !tweaks) await keepFacts(root, rel, { facts }, deps).catch(() => {});
    if (rel === FILM_PAGE) {
      /* the whole film's length, learnt on the way: the projects list shows it (projects.mjs filmDuration) */
      if (Number.isFinite(duration)) await writeAtomic(join(root, TOOL_DIR, 'cache', FILM_DURATION), JSON.stringify({ film: `${info.mtimeMs}:${info.size}`, duration }));
      /* the film's poster, kept as its last whatever film.html becomes (filmPoster) */
      if (ms < 0 && w === POSTER_W) await writeAtomic(join(root, TOOL_DIR, 'cache', FILM_POSTER), jpeg);
    }
    /* the stamp last: a request that finds it takes the frame as made, the film's length and poster written too */
    await writeAtomic(join(dir, `${key}.stamp`), await stampOf(root, deps));
    return jpeg;
  })();
  drawing.set(id, made);
  made.then(() => drawing.delete(id), () => drawing.delete(id));
  return made;
}

/**
 * What `files` (project relative) are now: each one's change time and size, as one text (a file gone reads so); a
 * video with a copy played in its place (seekable.mjs) says so, so a frame drawn before the copy was made is not kept.
 */
async function stampOf(/** @type {string} */ root, /** @type {string[]} */ files) {
  const parts = await Promise.all(files.map((f) => stat(join(root, f)).then(
    (s) => `${f}:${s.mtimeMs}:${s.size}${clipKind(f) === 'video' && madeCopy(join(root, f), root) ? ':copy' : ''}`, () => `${f}:-`)));
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 24);
}

/** @type {Map<string, string>} the version of each project's film.html whose footage got its copies */
const copied = new Map();
/**
 * The copies the film's footage needs to be drawn by this browser (seekable.mjs), made once for each version of
 * film.html (`info`); a footage file changed since gets its own when it is drawn next with a changed film.html.
 * @param {string} root @param {string} base @param {import('node:fs').Stats} info
 */
async function filmCopies(root, base, info) {
  const version = `${info.mtimeMs}:${info.size}`;
  if (copied.get(root) === version) return;
  const b = await started().catch(() => null);
  if (!b) return;
  await browserCopies(b, base, root, filmVideos(root, FILM_FILE));
  copied.set(root, version);
}

/** The film's last poster, in `.film/cache/`: what its card shows at once while the poster of a changed film is drawn. */
const FILM_POSTER = 'film-poster.jpg';
/** How long a card waits for the film's current poster before it is given the last one: one drawn already is read
 * from the cache in far less, and drawing one takes seconds. */
const STALE_AFTER_MS = 300;
/** How long a card waits for a film's first poster (none drawn before) before it is told to ask again: the card's
 * request holds one of the few connections a browser opens to Studio, and the editor's own requests wait behind it. */
const FIRST_WAIT_MS = 2_000;
/** How long after a project opens its first poster is drawn: after the editor's own first thumbnails. */
const WARM_MS = 10_000;
/** @type {Map<string, NodeJS.Timeout>} projects whose first poster is about to be drawn */
const warming = new Map();

/**
 * The film's poster (pageFrame of the whole film at -1: its fullest moment around the middle), for the project's card
 * in the projects list. Drawing it takes seconds (the whole film opens, every page in it, one frame at a time behind
 * the open project's own thumbnails), and any change to film.html makes a new one, so a card waiting for it showed
 * nothing. The current poster comes when it is drawn already; else the last one comes at once while the current one
 * is drawn for next time; a film never drawn is waited for a moment (FIRST_WAIT_MS), then null: it is still being
 * drawn, ask again.
 * @param {string} root @param {string} base @returns {Promise<Buffer | null>}
 */
export async function filmPoster(root, base) {
  const fresh = pageFrame(root, base, FILM_PAGE, -1, POSTER_W);
  /* drawn for next time, whoever waits for it: a film that can't be drawn now (a page's library offline) still shows
     its last picture */
  fresh.catch(() => {});
  const soon = await within(fresh.catch(() => null), STALE_AFTER_MS);
  if (soon) return soon;
  const last = await readFile(join(root, TOOL_DIR, 'cache', FILM_POSTER)).catch(() => null);
  if (last) return last;
  return within(fresh, FIRST_WAIT_MS - STALE_AFTER_MS);
}

/** What `promise` gives within `ms`, else null (it goes on). @template T @param {Promise<T>} promise @param {number} ms */
async function within(promise, ms) {
  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  try {
    return await Promise.race([promise, new Promise((/** @type {(value: null) => void} */ done) => { timer = setTimeout(() => done(null), ms); })]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A project just opened: its film's first poster drawn a little later, so the projects list has it the first time it
 * shows the project (after that, filmPoster gives the last one at once). Nothing when it has one.
 * @param {string} root @param {string} base
 */
export function warmFilmPoster(root, base) {
  if (warming.has(root) || existsSync(join(root, TOOL_DIR, 'cache', FILM_POSTER))) return;
  warming.set(root, setTimeout(() => {
    warming.delete(root);
    if (!existsSync(join(root, TOOL_DIR, 'cache', FILM_POSTER))) pageFrame(root, base, FILM_PAGE, -1, POSTER_W).catch(() => {});
  }, WARM_MS).unref());
}

/** Where the whole film's length is kept, in `.film/cache/`: `{ film: '<film.html mtime>:<size>', duration }`. */
export const FILM_DURATION = 'film-duration.json';

/** The page `rel` of the folder served at `base`, on the film's origin. */
const pageUrl = (/** @type {string} */ base, /** @type {string} */ rel) => `${base.replace(/\/$/, '')}/${rel.split('/').map(encodeURIComponent).join('/')}`;

/** Close the browser, and draw no first posters (Studio is stopping). */
export async function closePageFrames() {
  for (const timer of warming.values()) clearTimeout(timer);
  warming.clear();
  await closeBrowser();
}

/** Close the browser (Studio is stopping, or nothing was drawn for a while). */
/**
 * The browser, started when there is none. One that disconnects (it crashed, or was ended for its memory) is let go
 * with its pages, and the next request starts another; one that could not start (not downloaded yet on a first run)
 * is tried again next time.
 */
function started() {
  if (browser) return browser;
  const starting = launch().then((b) => {
    b.on('disconnected', () => {
      if (browser !== starting) return;
      browser = null;
      open.clear();
    });
    return b;
  }, (e) => {
    if (browser === starting) browser = null;
    throw e;
  });
  browser = starting;
  return starting;
}

async function closeBrowser() {
  if (idle) clearTimeout(idle);
  const b = browser;
  browser = null;
  open.clear();
  if (b) await (await b).close().catch(() => {});
}

/**
 * Draw `url` at `ms`, `w` px wide. `loaded`: the project's files the page (and every page inside it) loaded, project
 * relative (`base`: where the project is served), so the frame is known stale when one of them changes. `clear`: on
 * nothing rather than black, as a WebP.
 */
function draw(/** @type {string} */ url, /** @type {number} */ ms, /** @type {number} */ w, /** @type {string} */ version, /** @type {string} */ base, /** @type {object[] | null} */ overrides = null, /** @type {{ w: number, h: number } | null} */ size = null, clear = false) {
  /* a page is opened once for its poster and its thumbnails, at the poster's width, and a smaller picture is taken of
     it there: opened again at each width asked, every page of a film was loaded twice before its first thumbnail */
  const open = Math.max(w, POSTER_W);
  const shot = (/** @type {FilmPage} */ page, /** @type {{ format: 'jpeg' | 'webp', quality: number }} */ how) => page.capture({
    ...how, ...(open === w ? {} : { width: w * (page.meta.width / (size?.w ?? 1920)) }),
  });
  return withPage(url, open, version, size, async (page) => {
    const duration = lengthOf(page);
    const end = duration != null ? Math.max(0, duration - 1e-3) : Infinity;
    /* a poster: the fullest of a few moments around the middle (a page's middle is often a scene's first, faded-in
       frame); the larger JPEG is the one with more in it */
    const moments = ms < 0 ? POSTER_AT.map((f) => Math.min(end, (duration ?? NO_END_SPAN) * f)) : [Math.min(ms / 1000, end)];
    let jpeg = null;
    for (const t of moments) {
      const apply = (/** @type {boolean} */ before) => page.page.evaluate(async ({ list, before }) => {
        if (Boolean(Reflect.get(window, 'film')?.frameReadsOverrides) !== before) return false;
        const { override, restore } = await import(new URL('__film/overrides.mjs', location.href).href);
        const clip = { win: window, touched: new Map(), found: [] };
        override(clip, list);
        if (before) Reflect.set(window, '__filmRestoreFrameOverrides', () => restore(clip));
        return true;
      }, { list: overrides, before });
      const before = overrides ? await apply(true) : false;
      try {
        await page.seek(Math.max(0, t), { timeoutMs: FRAME_MS });
        if (overrides && !before) await apply(false);
        const taken = clear ? await clearShot(page, shot) : await shot(page, { format: 'jpeg', quality: 70 });
        if (!jpeg || taken.length > jpeg.length) jpeg = taken;
      } finally {
        /* the same page can next draw another clip, whose controls can be different */
        if (before) await page.page.evaluate(() => {
          Reflect.get(window, '__filmRestoreFrameOverrides')?.();
          Reflect.deleteProperty(window, '__filmRestoreFrameOverrides');
        }).catch(() => {});
      }
    }
    return { jpeg: /** @type {Buffer} */ (jpeg), duration, loaded: await loadedFiles(page, base),
      /* what the page says of itself, when it is open as it is on its own (no clip's size): kept for whoever asks */
      facts: size ? null : factsOf(page) };
  });
}

/** What a page says of itself (see pageFacts). */
const factsOf = (/** @type {FilmPage} */ page) => {
  const duration = lengthOf(page);
  return { ...(duration != null ? { duration } : {}), width: page.meta.width, height: page.meta.height, ...(page.meta.sized ? {} : { reflows: true }) };
};

/** The page as it is now on nothing: the open page (kept for other frames) is drawn on black again after. */
async function clearShot(/** @type {FilmPage} */ page, /** @type {(page: FilmPage, how: { format: 'jpeg' | 'webp', quality: number }) => Promise<Buffer>} */ shot) {
  await page.ground(true);
  try { return await shot(page, { format: 'webp', quality: 80 }); } finally { await page.ground(false); }
}

/** The project's files a page and the pages in it loaded (as resource timing lists them), project relative. */
async function loadedFiles(/** @type {FilmPage} */ page, /** @type {string} */ base) {
  const prefix = new URL(base.endsWith('/') ? base : `${base}/`);
  const urls = new Set();
  for (const frame of page.page.frames()) {
    urls.add(frame.url());
    const listed = await frame.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name)).catch(() => []);
    for (const u of listed) urls.add(u);
  }
  const out = [];
  for (const u of urls) {
    let at;
    try { at = new URL(u); } catch { continue; }
    if (at.origin !== prefix.origin || !at.pathname.startsWith(prefix.pathname)) continue;
    const rel = decodeURIComponent(at.pathname.slice(prefix.pathname.length));
    if (rel && !rel.startsWith('__film/') && !rel.startsWith('.')) out.push(rel);
  }
  return out;
}

/**
 * What a page says of itself, for the media pane: `{ duration (s), width, height }`, no duration when it has no end;
 * `reflows` when it sets no size of its own (then laid out at what it is given: its size here is 1920 × 1080).
 * Asked of the page kept open for its poster.
 * @param {string} root @param {string} base @param {string} rel
 */
export async function pageFacts(root, base, rel) {
  /* `rel` is the request's: a page of the project only, never one reached by `../` or a link out of the folder */
  const file = inProject(root, rel);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!info?.isFile()) throw new PageFrameError(`${rel} is not there`);
  /* kept, as its frames are: good while every file the page loaded is as it was. The editor asks every page of the
     project for its facts each time the project opens, and each answer opened the page in the browser again */
  const kept = await readFacts(root, rel);
  if (kept) { if ('failed' in kept) throw new Error(kept.failed); return kept.facts; }
  const stamp = await factsStamp(root, rel);
  const id = `${root}\0${rel}\0${stamp}`;
  const pending = factsAsked.get(id);
  if (pending) return pending;
  /* asked of a page opened for these files as they are now: one kept open from before a file it loads changed
     would say what it said then. The page its pictures are drawn on, when one is open (the same files, the same
     width): not opened a second time for this. At its turn it may have been learnt meanwhile (a picture of the page
     was drawn): then the page is not asked at all */
  const asked = withPage(pageUrl(base, rel), POSTER_W, stamp, null, async (page) => ({ facts: /** @type {object} */ (factsOf(page)), loaded: /** @type {string[] | null} */ (await loadedFiles(page, base)) }), 'facts',
    async () => { const now = await readFacts(root, rel); return now && 'facts' in now ? { facts: now.facts, loaded: /** @type {string[] | null} */ (null) } : undefined; },
  ).then(async ({ facts, loaded }) => {
    if (loaded) await keepFacts(root, rel, { facts }, loaded).catch(() => {});
    return facts;
  }, async (e) => {
    /* the page's own doing (FrameError: no film in it, a file it asks for not there), not the browser's (it could not
       start, it ran out of memory, it was closed under it): those are tried again */
    if (e instanceof FrameError) await keepFacts(root, rel, { failed: String(e.message ?? e), at: Date.now() }, []).catch(() => {});
    throw e;
  });
  factsAsked.set(id, asked);
  asked.then(() => factsAsked.delete(id), () => factsAsked.delete(id));
  return asked;
}

/** Where a page's facts are kept. */
const factsFile = (/** @type {string} */ root, /** @type {string} */ rel) => join(root, TOOL_DIR, 'cache', 'pagefacts', `${createHash('sha256').update(rel).digest('hex').slice(0, 24)}.json`);
/** What the files a page's kept facts were read with are now (the page alone when none are kept), as one text. */
async function factsStamp(/** @type {string} */ root, /** @type {string} */ rel) {
  const kept = await readFile(factsFile(root, rel), 'utf8').then((t) => JSON.parse(t), () => null);
  return stampOf(root, Array.isArray(kept?.files) && kept.files.includes(rel) ? kept.files : [rel]);
}
/**
 * A page's facts as kept, good while every file the page loaded is as it was: `{ facts }`, or `{ failed }` for a page
 * that could not say them (it is not a film, a file it needs is missing), not opened again for FACTS_FAILED_MS: it is
 * waited for until it is given up, each time, and it is the same page. Null when nothing good is kept.
 * @param {string} root @param {string} rel @returns {Promise<{ facts: object } | { failed: string } | null>}
 */
async function readFacts(root, rel) {
  const kept = await readFile(factsFile(root, rel), 'utf8').then((t) => JSON.parse(t), () => null);
  if (!kept || !Array.isArray(kept.files) || !kept.files.includes(rel) || kept.stamp !== await stampOf(root, kept.files)) return null;
  if (kept.facts) return { facts: kept.facts };
  return typeof kept.failed === 'string' && Date.now() - Number(kept.at) < FACTS_FAILED_MS ? { failed: kept.failed } : null;
}
/** Keep what a page said of itself (or that it could not), with the project's files it loaded. */
async function keepFacts(/** @type {string} */ root, /** @type {string} */ rel, /** @type {object} */ what, /** @type {string[]} */ files) {
  if (!existsSync(root)) return;
  const deps = [...new Set([rel, ...files])].filter((f) => existsSync(join(root, f)));
  const name = factsFile(root, rel);
  await mkdir(join(name, '..'), { recursive: true });
  await writeAtomic(name, JSON.stringify({ ...what, files: deps, stamp: await stampOf(root, deps) }));
}
/** How long a page that could not say its facts is not asked again, its file as it was. */
const FACTS_FAILED_MS = 10 * 60_000;
/** @type {Map<string, Promise<object>>} the facts being read now, by project, page and version: asked again meanwhile, read once */
const factsAsked = new Map();

/**
 * A compound's source timeline and the audio the preview reports for it. The version changes when files in the
 * project change, since the source film may itself contain compound clips or use a file replaced in place.
 * @param {string} root @param {string} base @param {string} rel @param {string} revision
 */
export async function compoundSound(root, base, rel, revision) {
  const file = inProject(root, rel);
  const info = file ? await stat(file).catch(() => null) : null;
  if (!info?.isFile()) throw new PageFrameError(`${rel} is not there`);
  return withPage(pageUrl(base, rel), POSTER_W, `sound:${info.mtimeMs}:${info.size}:${revision}`, null, async (page) => ({
    duration: lengthOf(page),
    sounds: page.meta.sounds,
  }), 'facts');
}

/** A page's own length in seconds; null when it has no end (no duration, or not a length). */
const lengthOf = (/** @type {FilmPage} */ page) => {
  const d = page.meta.duration;
  return d != null && Number.isFinite(d) && d > 0 ? d : null;
};

/**
 * `use` the page kept for `url` at `w` px and `version` (laid out at `size`, see pageFrame), in its turn in its `line`
 * (see MOST), one use of a page at a time. A page that failed, or never finished a frame, is not kept: the next
 * request opens it fresh.
 * @template T @param {string} url @param {number} w @param {string} version @param {{ w: number, h: number } | null} size
 * @param {(page: FilmPage) => Promise<T>} use @param {'pictures' | 'facts'} [line]
 * @param {() => Promise<T | undefined>} [had] asked when its turn comes: what it gives is the answer, the page not opened
 * @returns {Promise<T>}
 */
function withPage(url, w, version, size, use, line = 'pictures', had) {
  const key = keyOf(url, w, version, size);
  const once = async () => {
    const already = await had?.().catch(() => undefined);
    if (already !== undefined) return already;
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    const late = new Promise((_, fail) => {
      timer = setTimeout(() => {
        givenUp += 1;
        void closeBrowser();
        fail(Object.assign(new Error(`drawing ${url.split('/').pop()} took over ${JOB_MS / 1000} s`), { late: true }));
      }, JOB_MS);
    });
    const using = started();
    const work = pageFor(url, w, version, size).then(use);
    /* given up on, it fails later (its browser closed): heard, so it cannot end the process */
    work.catch(() => {});
    try {
      return await Promise.race([work, late]);
    } catch (e) {
      forget(url, w, version, size);
      /* its browser ended for the memory the page took: said so, not as the browser closing */
      throw memoryError(await using.catch(() => ({}))) ?? e;
    } finally {
      clearTimeout(timer);
    }
  };
  return new Promise((done, fail) => {
    waiting.push({ line, key, go: () => {
      if (idle) clearTimeout(idle);
      idle = null;
      const gave = givenUp;
      once().catch((e) => {
        /* the browser was closed under it for another page's sake (one drawn beside it took too long): its own page
           did nothing wrong, and is drawn again, once */
        if (givenUp === gave || e?.late || e instanceof BrowserMemoryError) throw e;
        unopened.delete(key);
        return once();
      }).then(done, fail).finally(() => {
        atWork[line] -= 1;
        inUse.delete(key);
        /* closed once nothing has been asked of it for a while */
        if (!atWork.pictures && !atWork.facts && !waiting.length) {
          idle = setTimeout(() => void closeBrowser(), IDLE_MS);
          idle.unref();
        }
        turn();
      });
    } });
    turn();
  });
}

/** Start what waits and can go now: its line has room, and the page it is for is not in use. */
function turn() {
  for (let i = 0; i < waiting.length; i += 1) {
    const job = waiting[i];
    if (atWork[job.line] >= MOST[job.line] || inUse.has(job.key)) continue;
    waiting.splice(i, 1);
    i -= 1;
    atWork[job.line] += 1;
    inUse.add(job.key);
    job.go();
  }
}

/** The key a page is kept by. @param {string} url @param {number} w @param {string} version @param {{ w: number, h: number } | null} size */
const keyOf = (url, w, version, size) => `${url}@${w}${size ? `:${size.w}x${size.h}` : ''}#${version}`;

/** Close the page kept for `url` at `w` px and `version`, if one is. */
function forget(/** @type {string} */ url, /** @type {number} */ w, /** @type {string} */ version, /** @type {{ w: number, h: number } | null} */ size) {
  const key = keyOf(url, w, version, size);
  const page = open.get(key);
  open.delete(key);
  void page?.then((p) => p.close(), () => {});
}

/**
 * An open page for `url` at about `w` px wide (laid out at `size` when it has no size of its own): kept open while its
 * file is the same `version`, the least recently used one closed past KEEP_PAGES.
 */
async function pageFor(/** @type {string} */ url, /** @type {number} */ w, /** @type {string} */ version, /** @type {{ w: number, h: number } | null} */ size) {
  const key = keyOf(url, w, version, size);
  const known = open.get(key);
  if (known) {
    open.delete(key);
    open.set(key, known);
    return known;
  }
  const refused = unopened.get(key);
  if (refused && Date.now() - refused.at < FAILED_KEPT_MS) throw refused.error;
  const starting = started();
  const origin = new URL(url).origin;
  /* a page is 1920 wide (or its clip's size) unless it says otherwise; the device scale makes the capture `w` px
     without a resize */
  /* on black, as the film shows a page with nothing below it (white, the browser's default, hid a white title) */
  const opening = (async () => FilmPage.open(await starting, origin, url, { scale: w / (size?.w ?? 1920), ...(size ? { size } : {}), black: true, waitMs: 15_000, readyMs: FRAME_MS }))();
  open.set(key, opening);
  opening.catch((e) => {
    open.delete(key);
    unopened.set(key, { error: e, at: Date.now() });
    if (unopened.size > 100) unopened.delete(unopened.keys().next().value ?? '');
  });
  while (open.size > KEEP_PAGES) {
    /* the one least recently used that neither line is using now (the other line's page may be the oldest) */
    const oldest = [...open.keys()].find((k) => k !== key && !inUse.has(k));
    if (!oldest) break;
    const page = open.get(oldest);
    open.delete(oldest);
    void page?.then((p) => p.close(), () => {});
  }
  return opening;
}
