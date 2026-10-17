/** Keep the macOS window available for Dock activation without ending Studio or agent sessions. */
export function keepWindowOnClose(win, { mac, isQuitting, save }) {
  win.on('close', (event) => {
    save();
    if (mac && !isQuitting()) {
      event.preventDefault();
      win.hide();
    }
  });
}
