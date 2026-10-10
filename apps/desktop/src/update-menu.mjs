/**
 * "Check for Updates…" in the menu: the one place a check answers with a dialog (background checks are silent, and the
 * chat only shows an update once it is ready). The dialogs never show the updater's own errors, only UPDATE_ERRORS.
 */
import { UPDATE_ERRORS } from './update-controller.mjs';

/**
 * @param {{ controller: { check: () => Promise<any>, restart: () => Promise<{ ok: boolean, error?: string }> },
 *           showMessage: (options: Electron.MessageBoxOptions) => Promise<{ response: number }>, focusWindow: () => void,
 *           productName?: string }} options
 */
export function createManualUpdateCheck({ controller, showMessage, focusWindow, productName = 'OpenFilm' }) {
  /** one check, one dialog: the menu clicked again while it is open waits on the same one */
  let pending = null;
  const say = (options) => showMessage({ title: 'Check for Updates', buttons: ['OK'], defaultId: 0, cancelId: 0, ...options });

  return function manualCheck() {
    pending ??= (async () => {
      const state = await controller.check();
      const next = state.availableVersion ?? '';
      if (state.status === 'installing') return;
      if (state.status === 'current') {
        await say({ type: 'info', message: `${productName} is up to date`, detail: `Version ${state.version}${state.channel === 'beta' ? ' (beta)' : ''}` });
      } else if (state.status === 'ready') {
        focusWindow();
        const { response } = await say({
          type: 'info', message: `${productName} ${next} is ready`,
          detail: 'Restart now to install it, or it installs the next time you quit.',
          buttons: ['Restart', 'Later'], defaultId: 0, cancelId: 1,
        });
        if (response !== 0) return;
        const result = await controller.restart();
        if (!result.ok && UPDATE_ERRORS[result.error]) await say({ type: 'warning', message: 'Not restarting yet', detail: UPDATE_ERRORS[result.error] });
      } else if (['checking', 'available', 'downloading', 'staging'].includes(state.status)) {
        const progress = state.status === 'downloading' && state.progress ? ` (${Math.round(state.progress)}%)` : '';
        await say({
          type: 'info', message: `${['Downloading', productName, next].filter(Boolean).join(' ')}${progress}`,
          detail: 'It downloads in the background: keep working. A Restart button appears in the chat when it is ready.',
        });
      } else {
        await say({
          type: 'warning', message: 'Could not check for updates',
          detail: `${UPDATE_ERRORS[state.error] ?? UPDATE_ERRORS.failed} ${productName} also tries again by itself.`,
        });
      }
    })().finally(() => { pending = null; });
    return pending;
  };
}
