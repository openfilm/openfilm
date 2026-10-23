/** Keep the macOS window available for Dock activation without ending Studio or agent sessions. */
export function keepWindowOnClose(win, { mac, isQuitting, save, quit }) {
  win.on('close', (event) => {
    save();
    if (mac && !isQuitting()) {
      event.preventDefault();
      win.hide();
    } else if (!isQuitting() && quit) {
      event.preventDefault();
      quit();
    }
  });
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
