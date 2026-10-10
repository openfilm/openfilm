/**
 * What an update is doing, from electron-updater's events, for the chat's banner and the menu's dialogs. No Electron
 * here (updates.mjs wires it), so a test can drive it with a fake updater.
 *
 *   idle → checking → current | available → downloading → staging (macOS) → ready → installing
 *   any step can end in error; the next check starts over
 *
 * `error` is a code, never the updater's own message (it carries feed URLs, response bodies, local paths):
 *   offline | unavailable | failed            a check or download did not work
 *   agent-busy | exporting | install-failed   Restart was refused or did not work (the update stays ready)
 */

/** What the menu's dialogs say for each code; the chat has its own words (chat/src/i18n). */
export const UPDATE_ERRORS = {
  offline: 'Could not reach the update service. Check your connection and try again.',
  unavailable: 'Updates are unavailable right now. Please try again later.',
  failed: 'Could not complete the update. Please try again later.',
  'agent-busy': 'An agent is still working. Restart when it has finished.',
  exporting: 'An export is running. Restart when it has finished.',
  'install-failed': 'Could not install the update. Quit OpenFilm and open it again to install it.',
};

const NETWORK_CODES = ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ERR_INTERNET_DISCONNECTED', 'ERR_NETWORK_CHANGED'];

/** Which kind of failure an updater error is: the feed missing or the host busy, the network, or anything else. */
export function classifyUpdateError(error) {
  if (error?.code === 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' || [404, 429, 502, 503, 504].includes(error?.statusCode)) return 'unavailable';
  if (NETWORK_CODES.includes(error?.code)) return 'offline';
  if (/net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_[A-Z_]+|TIMED_OUT|NETWORK_CHANGED)/.test(error?.message ?? '')) return 'offline';
  return 'failed';
}

/** Whether `candidate` (x.y.z) is newer than `current`. */
export function isNewer(candidate, current) {
  if (!/^\d+\.\d+\.\d+$/.test(candidate ?? '')) return false;
  const was = String(current).split('.').map(Number);
  return candidate.split('.').map(Number).reduce((result, value, i) => result || Math.sign(value - (was[i] || 0)), 0) > 0;
}

/**
 * @param {{ updater: import('node:events').EventEmitter & Record<string, any>, nativeUpdater?: import('node:events').EventEmitter | null,
 *           version: string, channel?: 'stable' | 'beta', onChange: (state: object) => void,
 *           prepareRestart: () => Promise<{ ok: true } | { ok: false, error: string }>, install: () => Promise<void> | void,
 *           now?: () => number }} options
 * `nativeUpdater`: Electron's own autoUpdater, on macOS only (Squirrel.Mac). Windows' installer has no second step.
 */
export function createUpdateController({ updater, nativeUpdater = null, version, channel = 'stable', onChange, prepareRestart, install, now = Date.now }) {
  let state = { status: 'idle', version, channel, availableVersion: null, progress: 0, checkedAt: null, error: null };
  /** the check under way, which a second asker waits on instead of starting another */
  let checking = null;
  let installing = false;
  const publish = (patch) => { state = { ...state, ...patch }; onChange({ ...state }); };

  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.autoRunAppAfterInstall = true;
  updater.allowPrerelease = false;
  updater.allowDowngrade = false;

  updater.on('checking-for-update', () => publish({ status: 'checking', error: null }));
  updater.on('update-available', (info) => publish({ status: 'available', availableVersion: info?.version ?? null, checkedAt: now(), error: null }));
  updater.on('update-not-available', () => publish({ status: 'current', checkedAt: now(), error: null }));
  updater.on('download-progress', (info) => {
    if (state.status === 'staging' || state.status === 'ready' || installing) return;
    publish({ status: 'downloading', progress: Math.max(0, Math.min(100, Number(info?.percent) || 0)) });
  });

  /* On macOS electron-updater's 'update-downloaded' only means the zip is here: Squirrel.Mac still has to fetch it from
     electron-updater's local server, unpack and verify it. Offering Restart before then looks like a dead button. */
  let downloadedVersion = null;
  updater.on('update-downloaded', (info) => {
    /* a download cached from before, of this version or an older one, is not an update */
    if (!isNewer(info?.version, version)) return;
    downloadedVersion = info.version;
    publish({ status: nativeUpdater ? 'staging' : 'ready', availableVersion: info.version, progress: 100, error: null });
  });
  nativeUpdater?.on('update-downloaded', () => {
    if (downloadedVersion && !installing && state.status !== 'installing') publish({ status: 'ready', error: null });
  });

  const fail = (error) => {
    if (installing) return;
    downloadedVersion = null;
    publish({ status: 'error', error: classifyUpdateError(error) });
  };
  updater.on('error', fail);

  return {
    snapshot: () => ({ ...state }),
    setChannel: (next) => publish({ channel: next }),
    /** Check now; a check already under way is shared. Once an update is on its way there is nothing to check. */
    async check() {
      if (['downloading', 'staging', 'ready', 'installing'].includes(state.status)) return { ...state };
      checking ??= (async () => updater.checkForUpdates())().catch(fail).finally(() => { checking = null; });
      await checking;
      return { ...state };
    },
    /**
     * Install now: only a ready update, only once however often it is clicked, and only when nothing would be lost
     * (`prepareRestart`). Refused, the update stays ready and the reason is in `error`.
     */
    async restart() {
      if (state.status !== 'ready' || installing) return { ok: false, error: 'not-ready' };
      installing = true;
      publish({ status: 'installing', error: null });
      try {
        const ready = await prepareRestart();
        if (!ready.ok) {
          publish({ status: 'ready', error: ready.error });
          return ready;
        }
        await install();
        return { ok: true };
      } catch {
        publish({ status: 'ready', error: 'install-failed' });
        return { ok: false, error: 'install-failed' };
      } finally {
        installing = false;
      }
    },
  };
}
