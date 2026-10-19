/**
 * Updates, for the packaged app only. electron-updater reads the feed written into the app when it was built
 * (scripts/release.mjs: the product's `desktop.updates`; a build with none never looks for updates), on the channel
 * chosen here (update-channel.mjs), and downloads a new version in the background (update-controller.mjs says where
 * it is; update-schedule.mjs when to look). Studio's top bar offers Restart once it is ready (shell/bridge.ts `update`), and the menu's "Check for Updates…" answers with a dialog
 * (update-menu.mjs). Quitting installs it too: nothing is lost by not restarting now. On macOS the next launch makes
 * sure of it (update-launch.mjs): it waits for an install under way, and installs one that did not happen.
 *
 * logs/updates.log has what happened, state and versions only: no URLs, no messages from the feed's host.
 */
import { BrowserWindow, app, autoUpdater as nativeUpdater, dialog, nativeTheme, powerMonitor } from 'electron';
import electronUpdater from 'electron-updater';
import { existsSync } from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createUpdateController } from './update-controller.mjs';
import { clearPendingUpdate, installLanguage, installWords, pendingUpdate, readyToInstall, writePendingUpdate } from './update-launch.mjs';
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
    /* `off`: this build never updates (Settings → About says so) */
    const off = { status: 'off', version: app.getVersion(), channel: 'stable', availableVersion: null, progress: 0, checkedAt: null, error: null };
    return {
      packaged: false, snapshot: () => off, check: async () => off, restart: async () => ({ ok: false, error: 'not-ready' }), manualCheck: null,
      installAtLaunch: async () => ({ installing: false, dismiss: () => {} }),
      channel: () => 'stable', setChannel: () => {}, close: () => {},
    };
  }
  autoUpdater.logger = null;
  let channel = readUpdateChannel(dataDir);
  useUpdateChannel(autoUpdater, channel);

  const logFile = join(dataDir, 'logs', 'updates.log');
  let logged = '';
  /** who else is told of each change (a launch that installs waits on it) */
  const listeners = new Set();
  const controller = createUpdateController({
    updater: autoUpdater,
    /* Squirrel.Mac's second step: only macOS has one */
    nativeUpdater: process.platform === 'darwin' ? nativeUpdater : null,
    version: app.getVersion(),
    channel,
    onChange: (state) => {
      onState(state);
      for (const listener of listeners) listener(state);
      /* the next launch on macOS checks that quitting installed it (update-launch.mjs) */
      if (state.status === 'ready' && state.availableVersion && process.platform === 'darwin') writePendingUpdate(dataDir, state.availableVersion);
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
    /** Check now, quietly (Settings → About shows what it finds); the menu's check answers with a dialog */
    check: controller.check,
    restart: controller.restart,
    manualCheck: createManualUpdateCheck({ controller, productName, showMessage, focusWindow: focus }),
    channel: () => channel,
    /**
     * At launch, before the window (macOS): an update quitting should have installed and did not is installed now, in
     * a small window that says so, and the app opens again as the new version (`installing`). Not ready again soon
     * enough, the launch goes on as it is (its update downloads as usual): `dismiss` closes the window once the app's
     * own is up, so the app never has no window and quits.
     * @param {{ language?: string | null }} [options] the language Studio was last shown in
     */
    async installAtLaunch({ language = null } = {}) {
      const nothing = { installing: false, dismiss: () => {} };
      const version = process.platform === 'darwin' ? pendingUpdate(dataDir, app.getVersion()) : null;
      if (!version) return nothing;
      const words = installWords(installLanguage(language, app.getPreferredSystemLanguages()), { name: productName, version });
      const shown = new BrowserWindow({
        width: 380, height: 120, show: false, frame: false, resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
        title: productName, backgroundColor: nativeTheme.shouldUseDarkColors ? '#111111' : '#f2f2f2',
        webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
      });
      shown.once('ready-to-show', () => shown.show());
      void shown.loadFile(fileURLToPath(new URL('./installing.html', import.meta.url)), { query: words });
      const ready = await readyToInstall({ controller, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } });
      if (ready && (await controller.restart()).ok) return { installing: true, dismiss: () => {} };
      /* tried once: from here it is the usual update, and the next ready one is noted again */
      try { clearPendingUpdate(dataDir); } catch { /* tried again next launch */ }
      shown.hide();
      return { installing: false, dismiss: () => { if (!shown.isDestroyed()) shown.destroy(); } };
    },
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
