/**
 * Updates, for the packaged app only. electron-updater reads the feed written into the app when it was built
 * (scripts/release.mjs: the product's `desktop.updates`; a build with none never looks for updates), on the channel
 * chosen here (update-channel.mjs), and downloads a new version in the background (update-controller.mjs says where
 * it is; update-schedule.mjs when to look). The chat offers Restart once it is ready, and the menu's "Check for Updates…" answers with a dialog
 * (update-menu.mjs). Quitting installs it too: nothing is lost by not restarting now.
 *
 * logs/updates.log has what happened, state and versions only: no URLs, no messages from the feed's host.
 */
import { app, autoUpdater as nativeUpdater, dialog, powerMonitor } from 'electron';
import electronUpdater from 'electron-updater';
import { existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createUpdateController } from './update-controller.mjs';
import { UPDATE_CHANNELS, readUpdateChannel, useUpdateChannel, writeUpdateChannel } from './update-channel.mjs';
import { createManualUpdateCheck } from './update-menu.mjs';
import { scheduleUpdateChecks } from './update-schedule.mjs';

const { autoUpdater } = electronUpdater;

/**
 * @param {{ dataDir: string, productName: string, getWindow: () => Electron.BaseWindow | null,
 *           onState: (state: object) => void,
 *           prepareRestart: () => Promise<{ ok: true } | { ok: false, error: string }>,
 *           beforeInstall: () => Promise<void> }} options
 * `prepareRestart` refuses a restart that would lose work; `beforeInstall` stops what quitting would otherwise stop,
 * so the quit Squirrel starts goes straight through.
 */
export function startUpdates({ dataDir, productName, getWindow, onState, prepareRestart, beforeInstall }) {
  /* run from source, or built with no update feed (electron-builder writes app-update.yml only with one) */
  if (!app.isPackaged || !existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    const idle = { status: 'idle', version: app.getVersion(), channel: 'stable', availableVersion: null, progress: 0, checkedAt: null, error: null };
    return { packaged: false, snapshot: () => idle, restart: async () => ({ ok: false, error: 'not-ready' }), manualCheck: null, channel: () => 'stable', setChannel: () => {}, close: () => {} };
  }
  autoUpdater.logger = null;
  let channel = readUpdateChannel(dataDir);
  useUpdateChannel(autoUpdater, channel);

  const logFile = join(dataDir, 'logs', 'updates.log');
  let logged = '';
  const controller = createUpdateController({
    updater: autoUpdater,
    /* Squirrel.Mac's second step: only macOS has one */
    nativeUpdater: process.platform === 'darwin' ? nativeUpdater : null,
    version: app.getVersion(),
    channel,
    onChange: (state) => {
      onState(state);
      /* a line when something changes, not one per percent downloaded */
      const entry = { status: state.status, version: state.version, target: state.availableVersion, channel: state.channel, error: state.error };
      const line = JSON.stringify(entry);
      if (line === logged || state.status === 'downloading') return;
      logged = line;
      void appendFile(logFile, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`).catch(() => {});
    },
    prepareRestart,
    install: async () => {
      await beforeInstall();
      try {
        autoUpdater.quitAndInstall();
      } catch {
        /* Studio and the agents are already stopped: a plain quit, which installs the update if it can (autoInstallOnAppQuit) */
        app.quit();
      }
    },
  });

  const schedule = scheduleUpdateChecks({ controller });
  const wake = () => schedule.wake();
  powerMonitor.on('resume', wake);

  const showMessage = (options) => {
    const win = getWindow();
    return win && !win.isDestroyed() ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
  };
  const focus = () => {
    const win = getWindow();
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  return {
    packaged: true,
    snapshot: controller.snapshot,
    restart: controller.restart,
    manualCheck: createManualUpdateCheck({ controller, productName, showMessage, focusWindow: focus }),
    channel: () => channel,
    /**
     * Move to another channel and look there at once. Moving to stable never downgrades: a beta build stays until
     * stable passes it, and one already downloaded still installs.
     */
    setChannel(next) {
      if (!UPDATE_CHANNELS.includes(next) || next === channel) return;
      channel = next;
      try { writeUpdateChannel(dataDir, channel); } catch { /* chosen for this run only */ }
      useUpdateChannel(autoUpdater, channel);
      controller.setChannel(channel);
      void controller.check();
    },
    close() {
      schedule.stop();
      powerMonitor.removeListener('resume', wake);
    },
  };
}
