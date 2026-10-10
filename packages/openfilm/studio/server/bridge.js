/*
 * Studio's bridge into the film's timeline page (src/timeline.mjs), injected after the host flag and before the
 * page's own script. The editor, on another origin, drives the film through it:
 *
 *   editor → { source: 'openfilm-studio', type: 'seek', t, seq, behind }   draw the film at t (`behind`: this load
 *                                         is not shown yet, another one is: its first picture is waited for whole)
 *            { type: 'update', film, head, seq }  film.html changed: change the film in place if it can be
 *            { type: 'preview', clip, overrides }   show a tweak on a page, not kept (null: stop showing)
 *            { type: 'pick', x, y, seq }          what is under this stage point
 *   film   → { source: 'openfilm-film', type: 'ready', duration, width, height, sounds, spans }
 *            { type: 'seeked', t, seq }           the frame at t is on screen
 *            { type: 'updated', seq, inPlace, duration, sounds, spans }   (inPlace false: load the page again)
 *            { type: 'picked', seq, target }      (null: nothing there)
 *            { type: 'error', message }           the film or a page failed
 *
 * Only the editor's origin is listened to and answered (the server puts it in for EDITOR).
 */
(() => {
  /* a page inside the timeline page (a clip of the film) has the film's own page for parent, not the editor: it says
     nothing (a message to the editor's origin would only be refused) */
  try { if (parent !== window && parent.location.origin === location.origin) return; } catch { /* the parent is the editor */ }
  const EDITOR = __EDITOR__;
  const post = (message) => parent.postMessage({ source: 'openfilm-film', ...message }, EDITOR);
  const fail = (error) => post({ type: 'error', message: String(error?.message ?? error ?? 'the film failed') });
  window.addEventListener('error', (e) => fail(e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => fail(e.reason));

  /* window.film is set by the page's module script, which runs after this one: wait for it */
  const film = new Promise((resolve) => {
    const look = () => (window.film && typeof window.film.frame === 'function' ? resolve(window.film) : setTimeout(look, 10));
    look();
  });
  const facts = (f) => ({ duration: f.duration, width: f.width, height: f.height, sounds: window.__filmSounds?.() ?? [], spans: window.__filmSpans?.() ?? [] });
  const editor = () => window.__filmEditor;

  /* the film once loaded, or null: one that fails to load (a clip with no length, a missing file) says why once, here,
     and draws and answers nothing after — a page error for each later message would only repeat it */
  const loaded = film.then(async (f) => {
    try { await f.ready; post({ type: 'ready', ...facts(f) }); return f; } catch (e) { fail(e); return null; }
  });

  /* one frame at a time: a seek that comes while one is drawing waits, and only the latest waiting one is drawn */
  const FRAME_WAIT_MS = 1000;
  /* a load of the film behind the one shown: the editor swaps it in at its first picture, so that picture is waited
     for whole (its videos' files loaded, sought there), up to this long; let go sooner, it swapped in black */
  const BEHIND_WAIT_MS = 20_000;
  let drawing = false;
  let next = null;
  /* the moment last asked for (drawn, being drawn or waiting): what an edit changed in place is drawn at */
  let asked = 0;
  const draw = async () => {
    if (drawing || !next) return;
    drawing = true;
    const { t, seq, behind } = next;
    next = null;
    try {
      const f = await loaded;
      if (!f) { drawing = false; return; }
      /* a person is watching: the timeline draws for them (videos play by themselves, a scrub does not wait for them to
         be composited); a page on its own draws its frame. A frame that does not come within a moment is let go: one
         stuck page or video must not stop the picture. */
      const watch = editor()?.watch;
      let timer;
      await Promise.race([watch ? watch(t) : f.frame(t), new Promise((done) => { timer = setTimeout(done, behind ? BEHIND_WAIT_MS : FRAME_WAIT_MS); })]);
      clearTimeout(timer);
      post({ type: 'seeked', t, seq });
    } catch (e) { fail(e); }
    drawing = false;
    draw();
  };

  window.addEventListener('message', async (e) => {
    if (e.origin !== EDITOR || e.data?.source !== 'openfilm-studio') return;
    const m = e.data;
    if (m.type === 'seek') { next = m; asked = m.t; draw(); return; }
    const f = await loaded;
    if (!f) return;
    if (m.type === 'update') {
      let inPlace = false;
      try { inPlace = Boolean(await editor()?.update(m.film, m.head)); } catch { inPlace = false; }
      post({ type: 'updated', seq: m.seq, inPlace, ...(inPlace ? facts(f) : {}) });
      /* the moment asked for, drawn again as the film is now; not the last one drawn, which is older while a draw
         is still going (the first one, as the film comes up): the picture went back there, the playhead stayed */
      if (inPlace && !next) { next = { t: asked, seq: m.seq }; draw(); }
    }
    if (m.type === 'preview') editor()?.preview(m.clip, m.overrides);
    if (m.type === 'pick') post({ type: 'picked', seq: m.seq, target: editor()?.pick(m.x, m.y) ?? null });
  });
})();
