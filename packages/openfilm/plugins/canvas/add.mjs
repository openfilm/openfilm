// @ts-check
/**
 * `openfilm canvas add <file…>`: files of the project put on the board the person has open, in a row below what is
 * there (left to right, in the order named), as Studio's library puts them when they are dragged in. It is how others
 * hand the canvas something (what another plugin made, a file an agent fetched): the sender names the files, and where
 * they go is the canvas's to say. The pair of `openfilm edit add`.
 */
import { existsSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { applyCanvasOps } from '../../studio/server/canvas.mjs';

/** a file card's width on the board, and the room between two side by side (studio/ui lib/canvas FILE_W, CanvasView) */
const FILE_W = 622;
const BETWEEN = 24;

/**
 * The steps that put `files` (paths, from `cwd`) of the project at `root` on `canvas`, in a row where the next node
 * would go. Throws an Error that says what is wrong with a file; nothing is laid down then.
 * @param {import('../../studio/server/canvas.mjs').Canvas} canvas @param {string} root @param {string[]} files
 * @param {{ cwd?: string }} [how]
 * @returns {Promise<{ op: 'add', kind: 'file', path: string, x: number, y: number }[]>}
 */
export async function addSteps(canvas, root, files, { cwd = root } = {}) {
  if (!files.length) throw new Error('Name the files to put on the canvas.');
  const paths = files.map((given) => {
    const file = resolve(cwd, given);
    const path = relative(root, file).split(sep).join('/');
    if (!path || path.split('/')[0] === '..' || isAbsolute(path)) throw new Error(`${given} is not in this project: copy it into ${root} first.`);
    if (!existsSync(file) || !statSync(file).isFile()) throw new Error(`${given}: there is no such file.`);
    return path;
  });
  /* where one more node goes on this board (below the rest, at its left), as the board's own steps say */
  const { canvas: tried, added } = await applyCanvasOps(canvas, [{ op: 'add', kind: 'file', path: paths[0] }], { exists: async () => true });
  const first = tried.nodes.find((n) => n.id === added[0]);
  const x = first?.x ?? 0, y = first?.y ?? 0;
  return paths.map((path, i) => ({ op: /** @type {const} */ ('add'), kind: /** @type {const} */ ('file'), path, x: x + i * (FILE_W + BETWEEN), y }));
}
