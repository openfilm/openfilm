/**
 * Which OpenFilm this process is. Two apps, each with its own name, bundle id, data folder and Studio home, so the
 * one run from this repository never shares a window, a lock or a Studio with the installed one:
 *
 *   · release — the packaged app. Its Studio is the machine's Studio (~/.openfilm), the one `openfilm open` finds.
 *   · dev     — `pnpm --filter @openfilm/desktop start`: this repository's code, with its own Studio home and its own
 *               folder for new projects.
 *   · bench   — `node bench/run.mjs`: this repository's code, everything (data, Studio home, projects) in the throwaway
 *               folder the benchmark names in OPENFILM_BENCH_DIR, so a run never touches a person's dev or installed app.
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

const packaged = Boolean(process.versions.electron) && !process.defaultApp;

export const FLAVORS = Object.freeze({
  release: { productName: 'OpenFilm', bundleId: 'dev.openfilm.desktop', studioPort: 4747, studioHome: null, library: null },
  dev: {
    productName: 'OpenFilm Dev', bundleId: 'dev.openfilm.desktop.dev', studioPort: 4757,
    studioHome: join(homedir(), '.openfilm-dev'), library: join(homedir(), 'Movies', 'OpenFilm Dev', 'Projects'),
  },
});

const benchDir = process.env.OPENFILM_BENCH_DIR ?? '';
const BENCH = Object.freeze({
  productName: 'OpenFilm Bench', bundleId: 'dev.openfilm.desktop.bench', studioPort: 4767,
  studioHome: join(benchDir, 'home'), library: join(benchDir, 'projects'), userData: join(benchDir, 'data'),
});

export function flavorName(env = process.env, isPackaged = packaged) {
  if (isPackaged) return 'release';
  if (env.OPENFILM_DESKTOP_FLAVOR === 'dev') return 'dev';
  if (env.OPENFILM_DESKTOP_FLAVOR === 'bench' && env.OPENFILM_BENCH_DIR) return 'bench';
  return 'release';
}

export const FLAVOR = flavorName();
export const IDENTITY = FLAVOR === 'bench' ? BENCH : FLAVORS[FLAVOR];
export const PRODUCT_NAME = IDENTITY.productName;
