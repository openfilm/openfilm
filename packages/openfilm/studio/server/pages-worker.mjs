// @ts-check
/**
 * The film origin's thread (pages.mjs startPages): its server, listening on the port Studio gives (`workerData.port`,
 * 0 for any), saying it is up (`{ listening: port }`) or why not (`{ failed, code }`). Studio tells it each token's
 * folder (`{ token, root }`) and each file its editor's browser does not decode (`{ undecoded }`); a token it was not
 * told of it asks Studio for (`{ find, token }`, answered `{ found, root }`).
 */
import { parentPort, workerData } from 'node:worker_threads';
import { listenLocal } from '../../src/host.mjs';
import { recordProblem } from '../../src/problems.mjs';
import { filmServer } from './pages.mjs';
import { markUndecoded } from './proxies.mjs';

const port = /** @type {import('node:worker_threads').MessagePort} */ (parentPort);
/** each token's folder, as Studio told it @type {Map<string, string>} */
const roots = new Map(workerData.roots ?? []);
/** tokens asked of Studio, by the ask @type {Map<number, (root: string | null) => void>} */
const asked = new Map();
let asks = 0;

port.on('message', (/** @type {any} */ m) => {
  if (m.token) roots.set(m.token, m.root);
  else if (m.undecoded) markUndecoded(m.undecoded);
  else if (m.found) { asked.get(m.found)?.(m.root ?? null); asked.delete(m.found); }
});

/* a request that fails ends only itself: the origin goes on serving the others (Studio's own thread logs the same) */
process.on('uncaughtException', (e) => {
  console.error('film origin, uncaught:', e);
  recordProblem({ area: 'studio', step: 'film origin uncaught', what: String(e?.message ?? e) });
});
process.on('unhandledRejection', (e) => {
  console.error('film origin, unhandled rejection:', e);
  recordProblem({ area: 'studio', step: 'film origin unhandled rejection', what: String(/** @type {any} */ (e)?.message ?? e) });
});

const server = filmServer({
  editorOrigin: workerData.editorOrigin,
  rootOf: (token) => roots.get(token) ?? new Promise((done) => {
    const id = ++asks;
    asked.set(id, (root) => { if (root) roots.set(token, root); done(root); });
    port.postMessage({ find: id, token });
  }),
});
try {
  await listenLocal(server, workerData.port);
  port.postMessage({ listening: /** @type {import('node:net').AddressInfo} */ (server.address()).port });
} catch (e) {
  port.postMessage({ failed: String(/** @type {any} */ (e)?.message ?? e), code: /** @type {any} */ (e)?.code });
}
