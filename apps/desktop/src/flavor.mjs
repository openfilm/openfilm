/**
 * Which OpenFilm this process is. Two apps, each with its own name, bundle id, data folder and Studio home, so the
 * one run from this repository never shares a window, a lock or a Studio with the installed one. Projects are the
 * person's, so every app but the bench shares one library: the one ~/.openfilm says (`sharedHome`; by default
 * ~/Movies/OpenFilm/Projects, or OPENFILM_LIBRARY):
 *
 *   · release — the packaged app. Its Studio is the machine's Studio (~/.openfilm), the one `openfilm open` finds.
 *   · preview — a packaged app built with `release --preview`, "OpenFilm Preview", to try a build in: its own data
 *               folder, Studio home and port, so it never meets an installed OpenFilm (its package says so:
 *               `openfilmFlavor`).
 *   · dev     — `pnpm --filter @openfilm/desktop start`: this repository's code, with its own Studio home.
 *   · bench   — `node bench/run.mjs`: this repository's code, everything (data, Studio home, projects) in the throwaway
 *               folder the benchmark names in OPENFILM_BENCH_DIR, so a run never touches a person's dev or installed app.
 *   · next    — `pnpm --filter @openfilm/desktop start` with OPENFILM_NEXT_DIR: the local next/0.3 branch, "OpenFilm
 *               Next", everything (data, Studio home, preferences, projects) in that folder, so 0.3 work never meets the
 *               dev app or a person's projects. Local to next/0.3: drop it before 0.3 goes into main.
 *
 * Reads no Electron module, so `node --test` can use it.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packaged = Boolean(process.versions.electron) && !process.defaultApp;

export const FLAVORS = Object.freeze({
  release: { productName: 'OpenFilm', bundleId: 'dev.openfilm.desktop', studioPort: 4747, studioHome: null, library: null, sharedHome: null },
  preview: {
    productName: 'OpenFilm Preview', bundleId: 'dev.openfilm.desktop.preview', studioPort: 4777,
    studioHome: join(homedir(), '.openfilm-preview'), library: null, sharedHome: join(homedir(), '.openfilm'),
  },
  dev: {
    productName: 'OpenFilm Dev', bundleId: 'dev.openfilm.desktop.dev', studioPort: 4757,
    studioHome: join(homedir(), '.openfilm-dev'), library: null, sharedHome: join(homedir(), '.openfilm'),
  },
});

const benchDir = process.env.OPENFILM_BENCH_DIR ?? '';
const BENCH = Object.freeze({
  productName: 'OpenFilm Bench', bundleId: 'dev.openfilm.desktop.bench', studioPort: 4767,
  studioHome: join(benchDir, 'home'), library: join(benchDir, 'projects'), sharedHome: null, userData: join(benchDir, 'data'),
});

const nextDir = process.env.OPENFILM_NEXT_DIR ?? '';
export const NEXT = Object.freeze({
  productName: 'OpenFilm Next', bundleId: 'dev.openfilm.desktop.next', studioPort: 4797,
  studioHome: join(nextDir, 'desktop', 'home'), library: join(nextDir, 'Projects'), sharedHome: join(nextDir, 'shared'),
  userData: join(nextDir, 'desktop', 'data'),
});

/** What the app's package says it was built as (`release --preview` writes `openfilmFlavor`). */
function builtFlavor() {
  try {
    return JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).openfilmFlavor ?? null;
  } catch { return null; }
}

export function flavorName(env = process.env, isPackaged = packaged, built = isPackaged ? builtFlavor() : null) {
  if (isPackaged) return built === 'preview' ? 'preview' : 'release';
  if (env.OPENFILM_DESKTOP_FLAVOR === 'dev') return 'dev';
  if (env.OPENFILM_DESKTOP_FLAVOR === 'bench' && env.OPENFILM_BENCH_DIR) return 'bench';
  if (env.OPENFILM_DESKTOP_FLAVOR === 'next' && env.OPENFILM_NEXT_DIR) return 'next';
  return 'release';
}

export const FLAVOR = flavorName();
export const IDENTITY = FLAVOR === 'bench' ? BENCH : FLAVOR === 'next' ? NEXT : FLAVORS[FLAVOR];
export const PRODUCT_NAME = IDENTITY.productName;
