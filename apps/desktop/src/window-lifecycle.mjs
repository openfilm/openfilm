/** Keep the macOS window available for Dock activation, and background work alive when Windows closes its window. */
export function keepWindowOnClose(win, { mac, isQuitting, save, shouldMinimize }) {
  let leavingFullScreen = false;
  let checking = false;
  let closeAllowed = false;
  function cancelClose() {
    leavingFullScreen = false;
    win.removeListener('leave-full-screen', hide);
  }
  function hide() {
    cancelClose();
    if (!win.isDestroyed() && !isQuitting()) win.hide();
  }
  win.on('close', (event) => {
    if (closeAllowed) return;
    save();
    if (mac && !isQuitting()) {
      event.preventDefault();
      if (leavingFullScreen) return;
      if (!win.isFullScreen()) { win.hide(); return; }
      /* Hiding a native full-screen window leaves its Space black. Its exit is asynchronous on macOS. */
      leavingFullScreen = true;
      win.once('leave-full-screen', hide);
      win.setFullScreen(false);
    } else if (shouldMinimize && !isQuitting()) {
      event.preventDefault();
      if (checking) return;
      checking = true;
      void Promise.resolve().then(shouldMinimize).catch(() => true).then((busy) => {
        checking = false;
        if (win.isDestroyed() || isQuitting()) return;
        if (busy) win.minimize();
        else {
          closeAllowed = true;
          try { win.close(); } finally { closeAllowed = false; }
        }
      });
    } else cancelClose();
  });
  /* Dock activation while full screen is leaving keeps the window open. */
  return cancelClose;
}

/** An empty projects page closes its window only on macOS. */
export function closeTabOrWindow(win, { mac, activeId, closeTab }) {
  if (activeId) void closeTab(activeId);
  else if (mac) win?.close();
}

/** Mark Quit before window close can run, even before Studio has started or after startup failed. */
export function quitAfterStudio(event, { quitting, markQuitting, studio, closeAgents, quit }) {
  closeAgents();
  if (quitting) return;
  markQuitting();
  if (!studio) return;
  event.preventDefault();
  void studio.quit().then(quit, quit);
}
