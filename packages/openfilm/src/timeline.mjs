// The film: film.html, played. The host serves film.html with this module (and, before it, its own start, filmStart
// in host.mjs); the file's own elements are the clips: an <iframe> a web page, a <video>, an <img> a still, an
// <audio> a sound for the mix. Where each plays and sits is what film-doc.mjs reads in the file, the same reading
// Studio plays and exports by; how each looks is the file's own CSS. Track 0, the first <section>, is on top.
import { clipFade, clipSpan, clipTag, declarations, fadeGain, filmHead, fittedFade, kindOf, parseFilm, pictureRect, readFilmFile, sourceAt } from './film-doc.mjs';

/* the file as written (without what the host puts in it), read as every reader reads it */
const own = new URL(location.href);
own.searchParams.set('film-host', '0');
const ownText = await (await fetch(own, { cache: 'no-store' })).text();
const read = readFilmFile(ownText);
/* what the tracks are not (the stage, the styles): changed, the film is loaded again, not changed in place */
const head = filmHead(ownText);
if (!read.doc) throw new Error(read.problems.length === 1 ? read.problems[0] : `film.html has ${read.problems.length} problems:\n  ${read.problems.join('\n  ')}`);
let doc = read.doc;
const stage = doc.stage;
Object.assign(document.body.style, { width: stage.w + 'px', height: stage.h + 'px', margin: '0', overflow: 'hidden', position: 'relative' });
/* the clips' elements, in the order the file has them (the reading above checked that is all a track holds) */
const CLIP_TAGS = new Set(['iframe', 'video', 'img', 'audio']);
const sections = [...document.body.children].filter((el) => el.localName === 'section');
const elements = sections.map((s) => { s.style.display = 'contents'; return [...s.children].filter((el) => CLIP_TAGS.has(el.localName)); });
const url = (src) => new URL(src, location.href);
const ready = (a) => Promise.resolve(typeof a.ready === 'function' ? a.ready() : a.ready);

/* a browser opens about six connections to one server: more files asked at once only wait behind each other */
const LOADS = 6;
let loadsBusy = 0;
const loadsWaiting = [];
/** Run `fn` when fewer than LOADS files are loading. */
async function limited(fn) {
  if (loadsBusy >= LOADS) await new Promise((go) => loadsWaiting.push(go));
  loadsBusy++;
  try { return await fn(); } finally { loadsBusy--; loadsWaiting.shift()?.(); }
}

/** Each media file's own length and picture size, read once (the clips of one recording share it); null: unreadable. */
const factsBySrc = new Map();
function factsOf(src) {
  const href = url(src).href;
  if (!factsBySrc.has(href)) {
    factsBySrc.set(href, limited(() => new Promise((ok) => {
      /* a video element reads a sound's length too; its file is let go once read */
      const m = document.createElement('video');
      m.preload = 'metadata'; m.muted = true;
      const done = (facts) => { m.removeAttribute('src'); m.load(); ok(facts); };
      m.onloadedmetadata = () => done({ duration: m.duration, w: m.videoWidth, h: m.videoHeight });
      m.onerror = () => done(null);
      m.src = href;
    })));
  }
  return factsBySrc.get(href);
}

/**
 * Put a clip's element where film-doc's pictureRect says its picture lands in `box`. A page is drawn at its own size
 * (`c.nw` × `c.nh`) and scaled into place; a video or still is laid out at its box's size, so the file's CSS for it
 * (object-fit, border-radius, a mask) speaks in stage px. `c.w` × `c.h` is the element's own frame either way.
 * Everything that places it is written here, on the element itself: nothing in the file's CSS moves a clip.
 */
function place(c, box) {
  const at = pictureRect(c.kind, { w: c.nw, h: c.nh }, stage, box);
  const page = c.kind === 'page';
  c.w = page ? c.nw : at.w; c.h = page ? c.nh : at.h;
  const k = page ? ` scale(${at.w / c.nw}, ${at.h / c.nh})` : '';
  Object.assign(c.el.style, {
    position: 'absolute', left: '0', top: '0', right: 'auto', bottom: 'auto', margin: '0', translate: 'none', rotate: 'none', scale: 'none',
    width: c.w + 'px', height: c.h + 'px', transformOrigin: '0 0',
    transform: `translate(${at.x + at.w / 2}px, ${at.y + at.h / 2}px) rotate(${at.r}deg) translate(${-at.w / 2}px, ${-at.h / 2}px)${k}`,
  });
}

/**
 * A clip's own CSS on its element: only what changed, on the element as it is (rewritten whole, a playing video drops
 * the frame it shows). Its place is not in it: place() writes that.
 */
function wear(c, css) {
  if (c.css === css) return;
  /* its own opacity may change: the fade is taken off, its base read again, and put back at once (a frame between
     showed the clip whole where its fade has it faint, as an inspector's value is dragged) */
  unfade(c);
  c.base = undefined;
  const before = new Map(declarations(c.css)), after = new Map(declarations(css));
  for (const prop of before.keys()) if (!after.has(prop)) c.el.style.removeProperty(prop);
  for (const [prop, value] of after) if (before.get(prop) !== value) c.el.style.setProperty(prop, value.replace(/\s*!important\s*$/i, ''));
  c.css = css;
  refade(c);
}

/** A clip's look, as the file says it (its class and its own CSS), then its place and whether it shows. */
function dress(c, row) {
  if (!c.el) return;
  if ((c.el.getAttribute('class') ?? '') !== (row.class ?? '')) { unfade(c); c.base = undefined; c.el.setAttribute('class', row.class ?? ''); refade(c); }
  wear(c, row.style ?? '');
  if (c.kind === 'page' && !c.el.style.border) c.el.style.border = '0';
  c.el.style.zIndex = String(doc.tracks.length - c.ti); // track 0 on top
  c.el.style.visibility = c.shown ? 'visible' : 'hidden';
  place(c, row.box);
}

/**
 * A clip's fades (SPEC §1): at `t` its picture shows `fadeGain` of its own opacity (its CSS's, `c.base`, read with
 * the fade off), set on its element with priority so no rule of the film's CSS hides it. Worked out from t alone.
 */
function fadeAt(c, t) {
  c.fadeT = t;
  const k = c.fade ? fadeGain(t - c.at, c.span.length, c.fade) : 1;
  if (k >= 1) { unfade(c); return; }
  if (c.base == null) { unfade(c); c.base = Number(getComputedStyle(c.el).opacity); }
  c.el.style.setProperty('opacity', String(c.base * k), 'important');
  c.faded = true;
}
/** The fade of a clip on screen, as at the moment it was last drawn (its look or its fades changed since). */
function refade(c) {
  if (c.shown && c.fadeT != null) fadeAt(c, c.fadeT);
}
/** The clip's own opacity back on its element, as its CSS says it. */
function unfade(c) {
  if (!c.faded) return;
  const own = new Map(declarations(c.css)).get('opacity');
  if (own) c.el.style.setProperty('opacity', own.replace(/\s*!important\s*$/i, ''));
  else c.el.style.removeProperty('opacity');
  c.faded = false;
}

/**
 * Overrides: a person's tweak of one element inside a page, applied after the page draws each frame. `found` keeps,
 * per tweak, whether its selector ever found an element (a page rewritten since may have lost it). What a tweak
 * changes is remembered as it was before (`touched`), so a tweak taken away, or changed, leaves nothing behind.
 */
function override(c, list = []) {
  const win = c.win;
  const touch = (el, prop) => {
    let saved = c.touched.get(el);
    if (!saved) { saved = { props: new Map(), texts: null }; c.touched.set(el, saved); }
    if (!saved.props.has(prop)) saved.props.set(prop, [el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
  };
  const set = (el, prop, value, priority = '') => { touch(el, prop); el.style.setProperty(prop, value, priority); };
  for (const [i, o] of list.entries()) {
    if (o.at === undefined) continue; // the clip's own entry (its fades): not an element's
    let nodes = [];
    try { nodes = [...win.document.querySelectorAll(o.at)]; } catch { continue; }
    if (o.n) nodes = nodes.slice(o.n - 1, o.n);
    if (nodes.length) c.found[i] = true;
    for (const el of nodes) {
      if (o.t) set(el, 'translate', `${o.t[0]}px ${o.t[1]}px`);
      if (o.s != null) set(el, 'scale', Array.isArray(o.s) ? `${o.s[0]} ${o.s[1]}` : String(o.s));
      if (o.r != null) set(el, 'rotate', `${o.r}deg`);
      for (const [k, v] of Object.entries(o.style ?? {})) {
        const prop = k.replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase());
        set(el, prop, typeof v === 'number' && !/opacity|z-index|font-weight|line-height|flex/.test(prop) ? v + 'px' : String(v), 'important');
      }
      if (o.text != null) {
        const saved = (touch(el, 'translate'), c.touched.get(el));
        const parts = [...el.childNodes].filter((n) => n.nodeType === 3 && n.data.trim());
        saved.texts ??= el.childElementCount === 0 ? el.textContent : parts.map((n) => [n, n.data]);
        /* a heading with inline parts (`Quiet<br><em>you</em>`): its own words change, the parts stay */
        if (el.childElementCount === 0) { if (el.textContent !== o.text) el.textContent = o.text; }
        else parts.forEach((n, k) => { n.data = k ? '' : o.text; });
      }
    }
  }
}

/** Put back what a clip's tweaks changed (before a changed list is applied, or when it is taken away). */
function restore(c) {
  for (const [el, saved] of c.touched) {
    for (const [prop, [value, priority]] of saved.props) {
      if (value) el.style.setProperty(prop, value, priority); else el.style.removeProperty(prop);
    }
    if (typeof saved.texts === 'string') el.textContent = saved.texts;
    else if (saved.texts) for (const [node, data] of saved.texts) node.data = data;
  }
  c.touched = new Map();
  c.found = [];
}

const SAME_TIME = 1e-4; // s: a video's currentTime is kept to the microsecond, so a time set is read back a hair off

/**
 * Put a video on the frame at `t` and wait until that frame is the one on screen. `seeked` fires when the decoder
 * has the frame, not when the compositor shows it: captured right after, the picture is still the previous one
 * (often a stretch back, after a long seek), and the same t drew different pictures. The frame callback is the
 * moment the new frame is presented.
 */
async function showVideoAt(v, t) {
  /* a seek still under way (the start a video was woken at, see wake): its `seeked` and its frame would be taken for
     this one's, and the picture captured was the earlier time's */
  if (v.seeking) await new Promise((done) => { v.addEventListener('seeked', done, { once: true }); setTimeout(done, 10000); });
  /* the same time again (to the microsecond the element keeps): no seek, nothing new to present (a seek there would
     present nothing, and the wait would run out) */
  if (!v.seeking && Math.abs(v.currentTime - t) < SAME_TIME && v.readyState >= 2) return;
  const presented = typeof v.requestVideoFrameCallback === 'function'
    ? new Promise((done) => { v.requestVideoFrameCallback(() => done()); setTimeout(done, 3000); })
    : null;
  v.currentTime = t;
  await new Promise((done) => {
    if (!v.seeking && v.readyState >= 2) { done(); return; }
    v.addEventListener('seeked', done, { once: true });
    v.addEventListener('loadeddata', done, { once: true });
    setTimeout(done, 10000);
  });
  if (presented) await presented;
}

/**
 * Every video a page moved in its frame, until its new frame is on screen (SPEC §4: a host waits for pending seeks):
 * decoded (`seeked`), then presented (the frame callback), each with a time limit so a stalled video cannot hold the
 * film. A page's own footage is as exact as a video clip's.
 */
function mediaShown(page) {
  return Promise.all([...page.querySelectorAll('video')].map((v) => (v.seeking || v.readyState < 2 ? new Promise((done) => {
    const shown = () => (typeof v.requestVideoFrameCallback === 'function' ? (v.requestVideoFrameCallback(() => done()), setTimeout(done, 1000)) : done());
    v.addEventListener('seeked', shown, { once: true });
    v.addEventListener('loadeddata', shown, { once: true });
    setTimeout(done, 10000);
  }) : null)));
}

/*
 * While a person watches, a video plays by itself instead of being sought frame by frame (a seek decodes from the
 * last key frame: on a long one each frame costs more, and playback stutters). It rolls while frames come in order at
 * about the clock's pace, its own pace nudged toward the film's clock; otherwise (a still moment, a scrub) it is
 * sought (see glance). A video about to come on is sought ahead and starts a moment before its cut, so it is running in
 * step when it shows. When frames stop coming, every video stops; a frame asked of window.film (an export's) is always
 * exact.
 */
const ROLL_STEP = 0.5;   // s: a frame further on than this from the last one is a jump
const ROLL_DRIFT = 0.25; // s: a playing video further off the film's clock than this is sought again
const CUE_AHEAD = 1.5;   // s: how long before its clip starts a video is sought, ready
const PREROLL = 0.2;     // s: how long before its clip starts a video plays, hidden, to be in step at its cut
const START_LAG = 0.08;  // s: how long play() takes to get a video going
let rollStop = 0;
/** the last frame drawn while a person watches: its t and when (to tell playing, in step with the clock, from a scrub) */
let lastLive = { t: -Infinity, at: 0 };
/** Keep a playing video at `want`: sought when far off, else its pace nudged until it is in step. */
function roll(c, want) {
  const v = c.el;
  const speed = c.span.speed ?? 1;
  const drift = v.currentTime - want;
  if (Math.abs(drift) > ROLL_DRIFT || v.ended) { v.currentTime = want; v.playbackRate = speed; }
  else {
    const rate = speed * (1 - Math.max(-0.1, Math.min(0.1, drift * 2)));
    if (Math.abs(v.playbackRate - rate) > 0.005) v.playbackRate = rate;
  }
  if (v.paused) v.play().catch((e) => { if (e?.name === 'NotAllowedError') c.held = true; });
  c.lastWant = want;
}
/**
 * A video the browser will not play here (an embedding app's autoplay rules): while the film plays it is stepped
 * instead, each frame sought without waiting for it, so the picture still moves. It is tried again after a pause.
 */
function step(c, want) {
  const v = c.el;
  c.lastWant = want;
  if (!v.seeking && Math.abs(v.currentTime - want) > 1 / 30) v.currentTime = want;
}
/**
 * A video on screen while a person looks at one moment or scrubs: sought, and waited for until its frame is decoded
 * (not until the compositor shows it: a seek within the frame on screen shows nothing new, and that wait would only
 * run out). The editor asks for the next moment once this one is drawn, so a scrub goes as fast as the decoder.
 */
async function glance(c, want) {
  const v = c.el;
  if (!v.paused) v.pause();
  c.lastWant = want;
  /* its file still loading: sought once it is, unless another moment was asked for meanwhile. Sought even when it
     loaded right there (its first second): a paused video's first frame may not be painted by itself (one loaded
     while its page was hidden or transparent, as Studio's preview loading behind the picture), and the picture
     stayed black until the playhead moved */
  let justLoaded = false;
  if (v.readyState < 2) {
    await wake(c);
    if (c.lastWant !== want || !c.awake) return;
    justLoaded = true;
  }
  if (!justLoaded && !v.seeking && Math.abs(v.currentTime - want) < SAME_TIME && v.readyState >= 2) return;
  v.currentTime = want;
  await new Promise((done) => {
    if (!v.seeking && v.readyState >= 2) { done(); return; }
    v.addEventListener('seeked', done, { once: true });
    v.addEventListener('loadeddata', done, { once: true });
    setTimeout(done, 3000);
  });
}
/**
 * A video whose clip starts `lead` seconds from now: sought ahead (to PREROLL before its first frame), started a
 * moment before that point comes (play() takes a moment to get going), then kept in step until its cut.
 */
function getReady(c, lead) {
  const v = c.el;
  const speed = c.span.speed ?? 1;
  const first = sourceAt(c.span, 0, c.row);
  const cue = Math.max(0, first - PREROLL * speed);
  const rolling = (first - cue) / speed; // the lead at which the video is at `cue`
  if (lead < rolling) { roll(c, first - lead * speed); return; }
  if (c.cued !== cue || c.lastWant !== cue) {
    if (!v.paused) v.pause();
    v.currentTime = cue;
    c.cued = c.lastWant = cue;
  }
  if (lead < rolling + START_LAG && v.paused && !v.seeking && !c.held) { v.playbackRate = speed; v.play().catch((e) => { if (e?.name === 'NotAllowedError') c.held = true; }); }
}
function stopRolling() {
  for (const c of clips) if (c.kind === 'video' && !c.el.paused) c.el.pause();
}

/*
 * A video holds its file only near the playhead: a film of a hundred clips does not open a hundred files (a browser
 * loads a few at a time, and each one held keeps a decoder and its buffers). Every frame drawn wakes the videos on at
 * t, then the ones about to come on, nearest first; one far from t lets its file go. A frame waits for its own
 * videos to be loaded, so an export's frame is as exact as ever.
 */
const WAKE_AHEAD = 4;   // s: a video this close to coming on is given its file (more than CUE_AHEAD)
const WAKE_BEHIND = 1;  // s: and one that went off this recently keeps it (a scrub back)
const KEEP = 12;        // s: one further than this from t lets its file go
const AWAKE_MAX = 12;   // videos holding their files at once, besides those on at t
const LOAD_MS = 30_000; // how long an export's frame waits for a video's file before that is an error

/**
 * Give a video its file; for an exact frame, to start at its source second `from`. Resolves once its first frame is
 * there (or it failed: a frame of it then shows nothing).
 */
function wake(c, from = null) {
  if (c.awake) return c.awake;
  const v = c.el;
  v.preload = 'auto';
  /* without the fragment: which seconds play is the film's to keep (a browser would stop the video at its end) */
  v.src = url(c.row.src).href;
  /* an exact frame's video loads at that frame: one sought at once after loading can stay on its first frame
     (Chromium). Not while a person watches: a start set before loading stalls the whole picture for a moment */
  if (from > 0) v.currentTime = from;
  c.awake = new Promise((done) => {
    v.addEventListener('loadeddata', () => done(), { once: true });
    v.addEventListener('error', () => done(), { once: true });
  });
  return c.awake;
}

/** Let a video's file go: its decoder and buffers are freed. */
function rest(c) {
  const v = c.el;
  if (!v.paused) v.pause();
  v.preload = 'none';
  if (v.hasAttribute('src')) { v.removeAttribute('src'); v.load(); }
  c.awake = null;
  c.lastWant = c.cued = undefined;
  c.held = false;
}

/**
 * Wake the videos near t (those on at t always), and let those far from it rest. `only`: wake only those on at t, and
 * let none rest unless far too many hold their files (a scrub: the rest is done once it stops, see draw). `exact`:
 * for an exact frame (an export's), each woken at the frame it is wanted at.
 */
function near(t, { only = false, exact = false } = {}) {
  const off = (c) => (t < c.at ? c.at - t : t >= c.end ? t - c.end : 0);
  const videos = clips.filter((c) => c.kind === 'video');
  const wanted = videos
    .filter((c) => !c.hidden && (only ? off(c) === 0 : t < c.at ? c.at - t <= WAKE_AHEAD : t - c.end <= WAKE_BEHIND))
    .sort((a, b) => off(a) - off(b));
  const on = wanted.filter((c) => off(c) === 0).length;
  const keep = new Set(wanted.slice(0, Math.max(on, AWAKE_MAX)));
  for (const c of keep) wake(c, exact ? sourceAt(c.span, Math.min(Math.max(0, t - c.at), c.span.length), c.row) : null);
  /* the rest: those far off rest, and the farthest while too many hold their files */
  const most = only ? 2 * AWAKE_MAX : AWAKE_MAX;
  const awake = videos.filter((c) => c.awake && !keep.has(c)).sort((a, b) => off(b) - off(a));
  let over = keep.size + awake.length - most;
  for (const c of awake) {
    /* one an edit is putting on screen (see cue) keeps its file, wherever it is now */
    if (cueing.has(c)) continue;
    if ((!only && (c.hidden || off(c) > KEEP)) || over > 0) { rest(c); over--; }
  }
}
/** a scrub's last moment, its neighbors woken (and the far ones let go) once it stops */
let settleNear = 0;
/** the moment last drawn (or being drawn): what an edit puts on there is made ready before the edit shows */
let shownT = null;
/** clips being made ready for an edit (see cue): their files are not let go meanwhile */
const cueing = new Set();
/** how long an edit waits for what it puts on screen; then it shows anyway, the rest drawn as it comes */
const CUE_MS = 5000;

/** Wait for a video's file for an exact frame: too long is the film's error, said by the clip. */
function loaded(c) {
  let timer;
  const late = new Promise((_, fail) => {
    timer = setTimeout(() => fail(new Error(`clip "${c.id}" (${c.src}): its video did not load within ${LOAD_MS / 1000} s`)), LOAD_MS);
  });
  return Promise.race([wake(c), late]).finally(() => clearTimeout(timer));
}

/**
 * Every clip of the film, as loaded: its element, its source's own length (`native`) and picture size, and what
 * film.html says of it now (`row`). A sound has no element. `sounds` is worked out from these, so an edit to a clip's
 * fields is applied by changing its record (see update).
 */
const clips = [];
const sounds = [];

/** A clip's timing, volume and placement from its film.html row (its source already loaded). */
function settle(c, row, track, ti) {
  const where = `clip "${row.id}" (${row.src})`;
  c.row = row;
  c.ti = ti;
  c.track = ti;
  c.at = row.at ?? 0;
  /* a hidden track's clips are loaded (an editor shows them, grayed) but neither drawn nor heard */
  c.hidden = Boolean(track.hidden);
  c.volume = track.muted || c.hidden ? 0 : (row.volume ?? 1);
  c.span = clipSpan(row, c.native, where);
  c.end = c.at + c.span.length;
  c.fade = fittedFade(clipFade(row), c.span.length);
  dress(c, row);
  /* the tweaks of a page's elements (the clip's own entry, its fades, is not one) */
  const tweaks = row.overrides?.filter((o) => o.at !== undefined);
  if (c.kind === 'page' && JSON.stringify(c.overrides ?? []) !== JSON.stringify(tweaks ?? [])) {
    restore(c);
    c.overrides = tweaks?.length ? tweaks : undefined;
  }
}

/** The film's sound: each sound clip's and each video's own, placed where its clip sits (`clip`: whose). */
function hear() {
  sounds.length = 0;
  for (const c of clips) {
    if (c.volume <= 0 || (c.kind !== 'sound' && c.kind !== 'video')) continue;
    sounds.push({ clip: c.id, src: url(c.row.src).pathname, at: c.at, from: c.span.from, to: c.span.to, volume: c.volume, speed: c.span.speed,
      ...(c.fade ? { fade: c.fade } : {}) });
  }
}

/** A clip's file has to be there: a missing one is said at once, by its name (not as a page that never answered). */
async function mustBeThere(src) {
  const res = await fetch(url(src), { method: 'HEAD' }).catch(() => null);
  if (res && res.status === 404) throw new Error(`${src}: there is no such file`);
}

/** Clips loaded so far: what a host waiting for `ready` sees moving (see host.mjs). */
let progress = 0;

/**
 * Take over one clip's element (`el`, the file's own, or one an update made): read its source and make its record.
 * A video's file is read for its length and size only; it loads when the playhead comes near (see near).
 */
async function load(row, track, ti, el) {
  const kind = kindOf(row);
  /* the element's own style as the file wrote it, its place (left, top…) included: place() writes over that */
  const c = { kind, id: row.id, src: row.src, track: ti, el, node: el, touched: new Map(), found: [], drawn: false, shown: false, css: el.getAttribute('style') ?? '' };
  if (kind === 'sound') {
    /* a sound is heard in the mix (see hear), never by its element */
    el.pause?.();
    el.preload = 'none';
    c.el = null;
    const facts = await factsOf(row.src);
    if (!facts) await mustBeThere(row.src);
    c.native = facts?.duration ?? 0;
  } else if (kind === 'still') {
    await el.decode().catch(() => {});
    c.nw = el.naturalWidth || stage.w; c.nh = el.naturalHeight || stage.h;
  } else if (kind === 'video') {
    el.muted = true; el.playsInline = true;
    rest(c);
    const facts = await factsOf(row.src);
    if (!facts) await mustBeThere(row.src);
    c.native = facts?.duration ?? NaN;
    c.nw = facts?.w || stage.w; c.nh = facts?.h || stage.h;
  } else {
    /* a film is a picture, never scrolled: a page a little larger than its frame shows no scrollbars (some browsers
       always draw them; exports draw none) */
    el.setAttribute('scrolling', 'no');
    await mustBeThere(row.src);
    const t0 = performance.now();
    /* the page is loading since the file was read (filmStart in host.mjs gave it the stage's size to lay itself out for) */
    while (!(el.contentWindow?.film && typeof el.contentWindow.film.frame === 'function')) {
      if (performance.now() - t0 > 10000) throw new Error(`${row.src}: window.film with a frame() function did not appear`);
      await new Promise((r) => setTimeout(r, 20));
    }
    const win = c.win = el.contentWindow;
    c.child = win.film;
    const sized = c.child.width > 0 && c.child.height > 0;
    c.nw = sized ? c.child.width : stage.w; c.nh = sized ? c.child.height : stage.h;
    await ready(c.child);
    /* a page without a duration has no end: its clip's #t= is its length, as a still's */
    const length = c.child.duration;
    c.native = Number.isFinite(length) && length > 0 ? length : undefined;
  }
  settle(c, row, track, ti);
  progress++;
  return c;
}

/**
 * Load clips side by side (a few files at a time, see limited) and give their records in file order; a clip that
 * fails is said, the first one in the file's order when several do.
 */
async function loadAll(list) {
  const settled = await Promise.allSettled(list.map(({ row, track, ti, el }) => load(row, track, ti, el)));
  const failed = settled.find((s) => s.status === 'rejected');
  if (failed) throw failed.reason;
  return settled.map((s) => s.value);
}

/* window.film is there at once and `ready` is the loading: a film of many pages (each with its own libraries and
   fonts from the network) takes longer to load than a host waits for the object to appear. Ready is every clip's
   length and place known and every page ready; a video's picture loads when a frame needs it. */
const loading = (async () => {
  clips.push(...await loadAll(doc.tracks.flatMap((track, ti) => track.clips.map((row, ci) => ({ row, track, ti, el: elements[ti][ci] })))));
  hear();
})();
/* a film that cannot load (a clip with no length, a missing file) is the host's to report, once, when it awaits
   `ready`: until it does, that is not an error nobody handled */
loading.catch(() => {});

/**
 * Draw the film at t. `live`: a person is watching (an editor, or the film opened as a page), so videos play by
 * themselves while frames come in order, and a scrub's frame does not wait for its video to be on screen; otherwise
 * the frame is exact (an export's, `look`'s).
 */
async function draw(t, live) {
  shownT = t;
  clearTimeout(rollStop);
  if (live) rollStop = setTimeout(stopRolling, 150); else stopRolling();
  /* playing: this frame follows the last one at about the clock's pace (a scrub goes anywhere at any pace) */
  const now = performance.now();
  const pace = (t - lastLive.t) / Math.max(1e-3, (now - lastLive.at) / 1000);
  const playing = live && t >= lastLive.t && t - lastLive.t < ROLL_STEP && pace > 0.5 && pace < 2;
  lastLive = live ? { t, at: now } : { t: -Infinity, at: 0 };
  clearTimeout(settleNear);
  if (live && !playing) { near(t, { only: true }); settleNear = setTimeout(() => near(t), 250); } else near(t, { exact: !live });
  await Promise.all(clips.map(async (c) => {
    if (c.kind === 'sound') return;
    const on = !c.hidden && t >= c.at && t < c.end;
    c.shown = on;
    c.el.style.visibility = on ? 'visible' : 'hidden';
    if (on) fadeAt(c, t);
    if (!on) {
      if (c.kind !== 'video') return;
      if (playing && c.awake && c.at > t && c.at - t < CUE_AHEAD) getReady(c, c.at - t);
      else { if (!c.el.paused) c.el.pause(); c.lastWant = c.cued = undefined; }
      return;
    }
    if (c.kind === 'still') return;
    if (c.kind === 'video') {
      const want = sourceAt(c.span, t - c.at, c.row);
      if (playing) { if (c.held) step(c, want); else roll(c, want); return; }
      c.held = false;
      if (live) { await glance(c, want); return; }
      if (!c.el.paused) c.el.pause();
      c.lastWant = want;
      await loaded(c);
      await showVideoAt(c.el, want);
      return;
    }
    const local = sourceAt(c.span, t - c.at, c.row, c.native);
    c.win.filmHost?.time?.(local);
    /* a page's error says which clip and which of its own seconds, not only the film's t */
    try { await c.child.frame(local); }
    catch (e) { throw new Error(`clip "${c.id}" (${c.src}) at its ${Number(local.toFixed(3))}s: ${e?.message ?? e}`); }
    c.win.filmHost?.settle?.(local);
    if (!live) await mediaShown(c.win.document);
    c.drawn = true;
    override(c, c.preview ?? c.overrides);
  }));
}

window.film = {
  get duration() { return Math.max(0.001, ...clips.filter((c) => !c.hidden).map((c) => c.end)); },
  width: stage.w, height: stage.h,
  ready: loading,
  frame(t) { return draw(t, false); },
};

/* for every tool that plays the film's sound (render, look, Studio's preview and exports): what is heard, where, how
   loud; `src` is a path on the film's origin */
window.__filmSounds = () => sounds;
/* for a host waiting for `ready`: how many clips have loaded, so a long film still loading is told from a stuck one */
window.__filmProgress = () => progress;
/* for `look`: where each picture starts, to check the picture is there */
window.__filmCuts = () => clips.filter((c) => c.kind !== 'sound' && !c.hidden).map((c) => ({ id: c.id, src: c.src, at: c.at, end: c.end }));
/* for an editor: where every clip sits on the film, sounds included, in seconds, its source's own length and picture
   size (a page's width × height, a video's frame, a still's pixels; none for a sound), and how a picture looks */
window.__filmSpans = () => clips.map((c) => ({
  id: c.id, src: c.src, track: c.track, at: c.at, end: c.end, native: Number.isFinite(c.native) ? c.native : null,
  ...(c.kind !== 'sound' && c.nw > 0 && c.nh > 0 ? { w: c.nw, h: c.nh } : {}),
  ...(c.el ? { look: lookOf(c) } : {}),
}));
/**
 * How a picture looks as all of the film's CSS for it makes it (its classes and its own style): what an editor shows.
 * Its opacity is its own, not as a fade has it now.
 */
function lookOf(c) {
  const css = getComputedStyle(c.el);
  return {
    fit: css.objectFit, position: css.objectPosition, radius: css.borderTopLeftRadius, opacity: c.faded && c.base != null ? String(c.base) : css.opacity,
    blend: css.mixBlendMode, clip: css.clipPath, filter: css.filter,
  };
}
/* for `look`: the person's tweaks inside pages, whether each still finds its element in the frames drawn, and fades */
window.__filmOverrides = () => clips.filter((c) => (c.overrides?.length || c.fade) && !c.hidden).map((c) => ({
  id: c.id, src: c.src, drawn: c.drawn, overrides: (c.overrides ?? []).map((o, i) => ({ ...o, found: Boolean(c.found[i]) })),
  ...(c.fade ? { fade: clipFade(c.row) } : {}),
}));

/* ── for an editor: change the film in place, find what is under a point, show a tweak before it is kept ── */

/** A clip's element as film.html holds it (film-doc's clipTag), for a clip an edit added; its file is not loaded yet. */
function element(row) {
  const shell = document.createElement('template');
  shell.innerHTML = clipTag(row);
  const el = document.importNode(shell.content.firstElementChild, true);
  if (el.localName === 'video' || el.localName === 'audio') el.preload = 'none';
  /* out of sight until it is placed and drawn: a page loading would show at its own size in the corner */
  el.style.visibility = 'hidden';
  return el;
}

/** Track `ti`'s section; one more is made after the last for a track the film did not have when it loaded. */
function sectionOf(ti, track) {
  while (sections.length <= ti) {
    const s = document.createElement('section');
    for (const flag of ['hidden', 'muted', 'locked']) if (track[flag] && sections.length === ti) s.setAttribute(flag, '');
    s.style.display = 'contents';
    if (sections.length) sections.at(-1).after(s); else document.body.append(s);
    sections.push(s);
  }
  return sections[ti];
}

/**
 * The film after an edit, changed in place: clips kept (by id, with the same source) take their new fields, clips
 * added get elements and load (a video's file only once the playhead comes near), clips gone are taken out. False
 * when the film has to be loaded again: another stage or head, or a clip that cannot load (that says why).
 */
async function change(value, look) {
  if (look != null && look !== head) return false;
  const next = parseFilm(value);
  if (next.stage.w !== stage.w || next.stage.h !== stage.h) return false;
  const rows = next.tracks.flatMap((track, ti) => track.clips.map((row) => ({ row, track, ti })));
  const byId = new Map(clips.map((c) => [c.id, c]));
  const kept = (row) => { const c = byId.get(row.id); return c && c.src === row.src && c.kind === kindOf(row) ? c : null; };
  /* each new element right after the one before it on its track, where that one is */
  const fresh = [];
  let before = null;
  rows.forEach(({ row, track, ti }, i) => {
    if (i === 0 || rows[i - 1].ti !== ti) before = null;
    const c = kept(row);
    if (c) { if (c.node.parentElement === sections[ti]) before = c.node; return; }
    const el = element(row);
    if (before) before.after(el); else sectionOf(ti, track).prepend(el);
    before = el;
    fresh.push({ row, track, ti, el });
  });
  let made;
  try { made = new Map((await loadAll(fresh)).map((c) => [c.id, c])); }
  catch { for (const f of fresh) f.el.remove(); return false; }
  const records = rows.map(({ row }) => made.get(row.id) ?? kept(row));
  if (shownT != null) {
    const t = shownT;
    let timer;
    const late = new Promise((done) => { timer = setTimeout(done, CUE_MS); });
    const ready = Promise.all(rows.map(({ row, track }, i) => cue(records[i], row, track, t, made.has(row.id)).catch(() => {})));
    await Promise.race([ready, late]);
    clearTimeout(timer);
  }
  try { doc = next; rows.forEach(({ row, track, ti }, i) => settle(records[i], row, track, ti)); }
  catch { return false; }
  /* what the change put on at the moment shown and made ready shows now, with the clips it took away going: the
     picture changes at once, not first without them until that moment is drawn again */
  if (shownT != null) {
    for (const c of records) {
      const on = c.el && !c.hidden && shownT >= c.at && shownT < c.end;
      const ready = c.kind === 'still' || (c.kind === 'video' && c.el.readyState >= 2) || (c.kind === 'page' && made.has(c.id));
      if (on && !c.shown && ready) { c.shown = true; c.el.style.visibility = 'visible'; fadeAt(c, shownT); }
    }
  }
  const now = new Set(records);
  for (const c of clips) {
    if (now.has(c)) continue;
    if (c.kind === 'video') rest(c);
    c.node.remove();
  }
  clips.splice(0, clips.length, ...records);
  hear();
  window.__filmEditor.stage.updated?.();
  return true;
}
/* edits are changed in the order they came, each once the one before is done */
let changing = Promise.resolve(true);

/**
 * Make ready, out of sight, what an edit puts on screen at `t` (`row` on `track`: the clip as the edit has it): a
 * video not showing now is given its file and sought to its frame there, a page just added is drawn there. Until
 * then the picture stays as it was: it does not go black while a file loads, and a page does not show its first
 * state before its frame. A video on screen already keeps its picture until its new frame is drawn.
 */
async function cue(c, row, track, t, fresh) {
  if (track.hidden || (c.kind !== 'video' && !(fresh && c.kind === 'page'))) return;
  if (c.kind === 'video' && c.shown && c.el.readyState >= 2) return;
  let span;
  try { span = clipSpan(row, c.native, row.id); } catch { return; }
  const at = row.at ?? 0;
  if (t < at || t >= at + span.length) return;
  if (c.kind === 'page') {
    const local = sourceAt(span, t - at, row, c.native);
    c.win.filmHost?.time?.(local);
    await c.child.frame(local);
    c.win.filmHost?.settle?.(local);
    override(c, c.overrides);
    return;
  }
  cueing.add(c);
  try { await glance(c, sourceAt(span, t - at, row)); } finally { cueing.delete(c); }
}

/** Where a clip's own pixel (x, y) is on the stage: its placement, as the browser applies it. */
const matrixOf = (c) => new DOMMatrix(getComputedStyle(c.el).transform);
const toStage = (c, x, y) => { const p = matrixOf(c).transformPoint(new DOMPoint(x, y)); return [p.x, p.y]; };

/** A selector that finds this element in its page (a unique id or class, else its path), and which match it is. */
function selectorOf(el) {
  const page = el.ownerDocument;
  const unique = (s) => { try { return page.querySelectorAll(s).length === 1; } catch { return false; } };
  if (el.id && unique(`#${CSS.escape(el.id)}`)) return { at: `#${CSS.escape(el.id)}` };
  for (const cls of el.classList) if (unique(`${el.localName}.${CSS.escape(cls)}`)) return { at: `${el.localName}.${CSS.escape(cls)}` };
  const parts = [];
  for (let node = el; node && node !== page.body && node.nodeType === 1; node = node.parentElement) {
    if (node !== el && node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
    const same = [...node.parentElement.children].filter((n) => n.localName === node.localName);
    parts.unshift(same.length > 1 ? `${node.localName}:nth-of-type(${same.indexOf(node) + 1})` : node.localName);
  }
  const at = parts.join(' > ');
  const all = [...page.querySelectorAll(at)];
  return all.length > 1 ? { at, n: all.indexOf(el) + 1 } : { at };
}

/** Whether a person sees the element: not hidden, and not faded out along the way up. */
function seen(win, el) {
  let opacity = 1;
  for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    opacity *= Number(style.opacity);
  }
  return opacity > 0.05;
}

const STYLE_KEYS = ['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'background-color', 'opacity', 'border-radius'];

/** What an editor shows of a target: its corners on the stage, its text when it holds text alone, its style. */
function describe(c, el) {
  const r = el ? el.getBoundingClientRect() : { left: 0, top: 0, right: c.w, bottom: c.h };
  const quad = [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]].map(([x, y]) => toStage(c, x, y));
  if (!el) return { clip: c.id, kind: c.kind, quad };
  const computed = c.win.getComputedStyle(el);
  return {
    clip: c.id, kind: 'element', quad, ...selectorOf(el), tag: el.localName,
    text: el.childElementCount === 0 && el.textContent.trim() ? el.textContent : null,
    style: Object.fromEntries(STYLE_KEYS.map((k) => [k, computed.getPropertyValue(k)])),
  };
}

window.__filmEditor = {
  /** Draw the film at t for a person watching it (see draw). */
  watch: (t) => draw(t, true),
  /**
   * For Studio's stage (studio/server/stage.js): the clips as loaded, a clip placed by a box not kept yet (null: by
   * its own again), and `updated`, which the stage sets to hear of each update made in place.
   */
  stage: {
    clips: () => clips,
    place(id, box) {
      const c = clips.find((x) => x.id === id);
      if (c?.el && c.kind !== 'sound') place(c, box ?? c.row.box);
    },
    /** Show a clip in CSS of its own not kept yet (null: its own again), as an inspector's value is dragged. */
    look(id, css) {
      const c = clips.find((x) => x.id === id);
      if (!c?.el) return;
      wear(c, css ?? c.row.style ?? '');
      place(c, c.row.box);
    },
    updated: null,
  },
  /**
   * The film after an edit (`look`: its file's filmHead, when the edit came from the file; another one than this film
   * was loaded with needs the page loaded again): changed in place (see change), resolving to true, or to false when
   * the page has to be loaded again.
   */
  update(value, look) {
    changing = changing.then(() => change(value, look)).catch(() => false);
    return changing;
  },
  /** Show `overrides` on a page clip instead of its own until called with null (a drag, a typed word). */
  preview(id, overrides) {
    const c = clips.find((x) => x.id === id && x.kind === 'page');
    if (!c) return;
    restore(c);
    c.preview = overrides ?? undefined;
    if (c.drawn) override(c, c.preview ?? c.overrides);
  },
  /** What is on top under the stage point (x, y) now: an element of a page, or a clip. */
  pick(x, y) {
    const shown = clips.filter((c) => c.el && c.el.style.visibility === 'visible').sort((a, b) => a.ti - b.ti);
    for (const c of shown) {
      const local = matrixOf(c).inverse().transformPoint(new DOMPoint(x, y));
      if (local.x < 0 || local.y < 0 || local.x > c.w || local.y > c.h) continue;
      if (c.kind !== 'page') return describe(c, null);
      /* the topmost element a person can see there: one faded out or hidden (a line still to come) is passed over */
      const page = c.win.document;
      const el = page.elementsFromPoint(local.x, local.y).find((e) => e !== page.body && e !== page.documentElement && seen(c.win, e));
      return describe(c, el ?? null);
    }
    return null;
  },
};

if (!window.filmHost) {
  await loading;
  const t0 = performance.now();
  const loop = async () => { await draw(((performance.now() - t0) / 1000) % film.duration, true); requestAnimationFrame(loop); };
  loop();
}
