/**
 * Where workbenches draw their blocks (lib/blocks, a plugin's openfilm.json `blocks`): each block has a place of its own
 * for the page's life (`mountOf`), which Studio's shell puts in the slot it lays out for that block in the arrangement
 * shown (shell/arrangement), and takes out when the block is not in it. What a plugin draws in it stays drawn (and its
 * state kept) wherever the shell moves it. The shell lays out a slot only for a block its workbench draws (`drawing`),
 * and says which blocks are shown now (`shownBlocks`).
 */

/** Several told of a change. */
function store<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => { if (Object.is(next, value)) return; value = next; for (const listener of [...listeners]) listener(); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}

/** A block's key among all workbenches': `owner:id`. */
export const blockKey = (owner: string, id: string): string => `${owner}:${id}`;

const mounts = new Map<string, HTMLElement>();
/** The place the block `id` of the workbench `owner` is drawn in: the same element for the page's life, taking no room of its own. */
export function mountOf(owner: string, id: string): HTMLElement {
  const key = blockKey(owner, id);
  let mount = mounts.get(key);
  if (!mount) {
    mount = document.createElement('div');
    mount.style.display = 'contents';
    mounts.set(key, mount);
  }
  return mount;
}

/** The blocks being drawn by their workbenches, by key (counted: two parts of one workbench may draw one block in turn). */
const drawn = new Map<string, number>();
export const drawingStore = store<ReadonlySet<string>>(new Set());
/** Say the block is drawn into its place; returns the way to say it is no longer. */
export function drawing(owner: string, id: string): () => void {
  const key = blockKey(owner, id);
  drawn.set(key, (drawn.get(key) ?? 0) + 1);
  if (drawn.get(key) === 1) drawingStore.set(new Set(drawn.keys()));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (drawn.get(key) ?? 1) - 1;
    if (left > 0) { drawn.set(key, left); return; }
    drawn.delete(key);
    drawingStore.set(new Set(drawn.keys()));
  };
}

/** The blocks shown now (in the arrangement on the page, not hidden under another workbench), by key: the shell's to say. */
export const shownBlocks = store<ReadonlySet<string>>(new Set());

/** The blocks whose place is in a slot now, by key: what is drawn in it then is laid out where it is shown. */
export const attachedBlocks = store<ReadonlySet<string>>(new Set());
/** The shell's: the block's place was put in a slot (`put`), or its slot was taken out. */
export function attached(key: string, put: boolean): void {
  const now = attachedBlocks.get();
  if (now.has(key) === put) return;
  const next = new Set(now);
  if (put) next.add(key); else next.delete(key);
  attachedBlocks.set(next);
}
