/** Switch native pages without exposing the empty window between their frames. No Electron dependency. */
export function createPagePresentation({ prepare, resume, present, discard, fallback = null, onError = () => {} }) {
  const pages = new Map();
  const retired = new Set();
  let current = null;
  let wanted = null;
  let request = 0;

  function remove(id) {
    const page = pages.get(id);
    pages.delete(id);
    retired.delete(id);
    if (page) discard(id, page.view);
  }
  function ensure(id) {
    let page = pages.get(id);
    if (page) return page;
    const prepared = prepare(id);
    page = { view: prepared.view, loaded: false, ready: null };
    pages.set(id, page);
    page.ready = Promise.resolve(prepared.ready).then(() => { page.loaded = true; }, (error) => {
      if (pages.get(id) === page) remove(id);
      throw error;
    });
    // A preloaded page may never be shown. Its failure must still be handled.
    void page.ready.catch(() => {});
    return page;
  }
  function commit(id, page, ticket) {
    if (ticket !== request || wanted !== id || retired.has(id) || pages.get(id) !== page) return false;
    present(id, page.view);
    current = id;
    for (const old of [...retired]) if (old !== id) remove(old);
    return true;
  }
  function failed(id, ticket, error) {
    // Closing a loading tab destroys its view and rejects loadURL. It is not a failed destination.
    if (ticket !== request || wanted !== id || retired.has(id)) return Promise.resolve(false);
    onError(error);
    if (fallback == null || id === fallback) return Promise.resolve(false);
    return show(fallback).then(() => false);
  }
  function show(id) {
    wanted = id;
    const ticket = ++request;
    let page;
    try { page = ensure(id); } catch (error) { return failed(id, ticket, error); }
    // Returning to the current page cancels a pending switch without disturbing its native surface.
    if (page.loaded && current === id && !retired.has(id)) return Promise.resolve(true);
    // A hidden native view may have lost its compositor surface, even though its document is loaded. Resume it
    // underneath the outgoing page, and wait for its new frame before exposing it.
    if (page.loaded && !resume) return Promise.resolve(commit(id, page, ticket));
    const ready = page.loaded
      ? (page.resuming ??= Promise.resolve().then(() => resume(id, page.view)).finally(() => { page.resuming = null; }))
      : page.ready;
    return ready.then(() => commit(id, page, ticket), (error) => failed(id, ticket, error));
  }
  return {
    currentId: () => current,
    wantedId: () => wanted,
    show,
    warm(id) { return ensure(id).ready.then(() => true, () => false); },
    retire(id) {
      retired.add(id);
      // The outgoing page remains until its replacement is presented.
      if (id !== current) remove(id);
    },
    drop(id) {
      if (id === current || id === wanted) return false;
      remove(id);
      return true;
    },
  };
}

/** Load first, then allow two paint frames; neither a hung navigation nor a throttled frame waits forever. */
export async function preparePage(contents, url, { loadTimeoutMs = 15_000, ...frameOptions } = {}) {
  let timer;
  try {
    await Promise.race([
      contents.loadURL(url),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error('Page loading timed out'));
          if (!contents.isDestroyed()) contents.stop();
        }, loadTimeoutMs);
      }),
    ]);
  } finally { clearTimeout(timer); }
  if (contents.isDestroyed()) throw new Error('Page closed while loading');
  await paintPage(contents, frameOptions);
}

/** Wait for the editor's DOM and a refreshed compositor frame, for new documents and resumed native views alike. */
export async function paintPage(contents, { paintTimeoutMs = 500, readySelector = null, readyTimeoutMs = 15_000 } = {}) {
  let timer;
  const timeout = readySelector ? readyTimeoutMs : paintTimeoutMs;
  try {
    const painted = await Promise.race([
      contents.executeJavaScript(`(${waitForPageFrame.toString()})(${timeout}, ${JSON.stringify(readySelector)})`),
      // Also bound the host-side wait if the renderer stops responding before it can run its timer.
      new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeout); }),
    ]);
    if (readySelector && !painted) throw new Error('Editor did not become ready');
  } finally { clearTimeout(timer); }
  if (contents.isDestroyed()) throw new Error('Page closed while painting');
  // requestAnimationFrame runs before paint. A tiny capture also waits for Chromium's submitted surface, without
  // retaining a full-window bitmap or showing the destination over the outgoing page.
  if (contents.capturePage) {
    try {
      await Promise.race([
        contents.capturePage({ x: 0, y: 0, width: 1, height: 1 }, { stayHidden: true }),
        new Promise(resolve => { timer = setTimeout(resolve, paintTimeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
    if (contents.isDestroyed()) throw new Error('Page closed while capturing its frame');
  }
}

/** Runs inside the loaded page. A hidden/throttled renderer may not produce animation frames. */
export function waitForPageFrame(timeoutMs, readySelector = null) {
  return new Promise((resolve) => {
    let frame, count = 0;
    const finish = (painted) => { clearTimeout(timer); cancelAnimationFrame(frame); resolve(painted); };
    const timer = setTimeout(() => finish(false), timeoutMs);
    const tick = () => {
      if (readySelector && !document.querySelector(readySelector)) count = 0;
      else if (++count === 2) { finish(true); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  });
}

/** Show and raise the replacement before hiding any previously visible page. */
export function revealPage(parent, target, pages) {
  target.setVisible(true);
  parent.addChildView(target);
  for (const page of pages) if (page !== target) page.setVisible(false);
  target.webContents.focus();
}

/** Native views remember their old hover target while hidden. Refresh it at the real cursor before painting. */
export function syncPagePointer(contents, cursor, bounds) {
  const x = Math.round(cursor.x - bounds.x), y = Math.round(cursor.y - bounds.y);
  contents.sendInputEvent({
    type: x >= 0 && y >= 0 && x < bounds.width && y < bounds.height ? 'mouseMove' : 'mouseLeave',
    x, y, globalX: cursor.x, globalY: cursor.y,
  });
}
