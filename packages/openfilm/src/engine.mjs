// The engine films are drawn with. A film is previewed in the desktop app's Chromium (Electron) and exported, looked
// at and made into thumbnails in Playwright's headless shell (host.mjs launch). Both are the same Chromium version
// and are started with the same switches that decide how a page draws, so what the preview shows is what an export
// writes. The engine suite (src/engine.test.mjs, test/engine/) checks what this engine can do and that it draws the
// same picture for the same t; it is run again whenever either side changes.

/**
 * The Chromium both sides draw with, its major version: Electron's (apps/desktop) and the headless shell of the
 * playwright-core this package depends on. An upgrade of either one moves both, or the engine tests fail
 * (apps/desktop/src/engine-match.test.mjs).
 */
export const ENGINE_CHROMIUM = 156;

/**
 * Chromium's features as one `--enable-features` value. Chromium keeps only the last `--enable-features` switch it is
 * given (measured on 156: a second one switched off what the first turned on), so whoever adds features of its own
 * passes them all together, these with them.
 * @param {NodeJS.Platform} platform
 */
export function engineFeatures(platform = process.platform) {
  /* A 2D canvas drawn on the GPU through Skia Graphite flushes its recorded drawing every 4 KB instead of batching it.
     Without it, a canvas drawn stroke by stroke through `ctx.filter = 'blur(…)'` queued gigabytes of intermediate
     textures for one frame (7 to 9 GB in the GPU process; two such browsers froze a 16 GB Mac). With it, a few hundred
     MB (src/browser-memory.test.mjs), and canvas pictures uploaded to WebGL stay fast. */
  return platform === 'darwin' ? ['Canvas2DAutoFlushParams:max_recorded_op_graphite_kb/4'] : [];
}

/**
 * The switches that decide how a page draws, the same for the preview and for exports, as [name, value] pairs
 * without their dashes (Electron's `app.commandLine.appendSwitch(name, value)`; `--name=value` for a browser). The
 * features are not among them: see engineFeatures.
 *
 * Skia Graphite stays on on a Mac, as Chrome has it: from Chromium 156 a Mac's GPU is reached through it alone
 * (with `--disable-skia-graphite` WebGL is drawn by SwiftShader, on the CPU, and there is no WebGPU). Elsewhere
 * Chromium's other renderer (Ganesh) draws, as before.
 * @param {NodeJS.Platform} platform
 * @returns {[string, string?][]}
 */
export function engineSwitches(platform = process.platform) {
  return [
    /* HTML-in-Canvas (drawElementImage, texElementImage2D): a page draws its own DOM into a 2D canvas or WebGL */
    ['enable-blink-features', 'CanvasDrawElement'],
    /* pages are rastered on the GPU wherever there is one that can */
    ['enable-gpu-rasterization'],
    ...(platform === 'darwin' ? [] : /** @type {[string][]} */ ([['disable-skia-graphite']])),
  ];
}

/**
 * engineSwitches as a browser's command-line arguments, with `features` (the caller's own) and engineFeatures in one
 * `--enable-features`.
 * @param {NodeJS.Platform} [platform] @param {{ features?: string[] }} [opts]
 */
export function engineArgs(platform = process.platform, { features = [] } = {}) {
  const all = [...new Set([...features, ...engineFeatures(platform)])];
  return [
    ...engineSwitches(platform).map(([name, value]) => (value === undefined ? `--${name}` : `--${name}=${value}`)),
    ...(all.length ? [`--enable-features=${all.join(',')}`] : []),
  ];
}
