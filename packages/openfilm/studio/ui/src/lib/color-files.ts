/**
 * A project's color files (`looks/*.ctf`, SPEC.md `--of-lut`) as the inspector reads and writes them: read once and
 * kept, read again when the folder says one changed (the agent wrote it), and written as one step of the editor's
 * undo with the film's own change (lib/clip-color says what a change writes). A write names the file as it was read,
 * and is refused when it changed since, so nothing someone else wrote is written over.
 */
import * as React from 'react';
import { api, ApiError } from '@/api';
import type { OutsideStep } from '@/editor/use-film';
import inRec709 from '../../../../src/color/transforms/in-rec709.ctf?raw';
import outRec709 from '../../../../src/color/transforms/out-rec709.ctf?raw';
import type { ColorText } from './clip-color.ts';

/** OpenFilm's own files for ordinary video, written into a project when a clip's chain first names them. */
export const STANDARD: Readonly<Record<string, string>> = { 'looks/in-rec709.ctf': inRec709, 'looks/out-rec709.ctf': outRec709 };

type Read = { text: string; rev: string } | null;
const COLOR = /\.(ctf|clf|cube)$/i;
const key = (projectId: string, path: string) => `${projectId}\0${path}`;
/** each file as read (null: not there), or being read */
const files = new Map<string, Read | Promise<Read>>();
const heard = new Set<() => void>();
let version = 0;
const tell = () => { version++; for (const fn of heard) fn(); };
/** What this page last wrote to each file (null: took it away), so a change it sees is known as its own or someone else's. */
const written = new Map<string, string | null>();
/**
 * Whether `text` is what this page last wrote to `path` (an undo or a redo included): a change to it read from disk
 * that is not is someone else's (an agent's, another window's).
 */
export function writtenHere(projectId: string, path: string, text: string | null): boolean {
  const k = key(projectId, path);
  return written.has(k) && written.get(k) === text;
}

function read(projectId: string, path: string): Read | Promise<Read> {
  const k = key(projectId, path);
  const had = files.get(k);
  if (had !== undefined) return had;
  const p = api.readPage(projectId, path).then(
    (r): Read => r,
    (e: unknown): Read => { if (e instanceof ApiError && e.status === 404) return null; throw e; },
  ).then((r) => { if (files.get(k) === p) { files.set(k, r); tell(); } return r; }, () => { if (files.get(k) === p) files.delete(k); return null; });
  files.set(k, p);
  return p;
}

/** Files of the project changed on disk (the folder's event): those of them that are color files are read again. */
export function colorFilesChanged(projectId: string, paths: readonly string[] | undefined): void {
  let any = false;
  for (const k of [...files.keys()]) {
    const [id, path] = k.split('\0') as [string, string];
    if (id === projectId && (!paths || (COLOR.test(path) && paths.includes(path)))) { files.delete(k); any = true; }
  }
  if (any) tell();
}

/** A file as read now: its text, null when it is not there, undefined while it is being read. */
function now(projectId: string, path: string): string | null | undefined {
  const r = read(projectId, path);
  return r instanceof Promise ? undefined : (r?.text ?? null);
}

/** The project's color files `paths` read (each, or as kept), as a reader of them. */
export async function readColorTexts(projectId: string, paths: readonly string[]): Promise<ColorText> {
  const got = new Map(await Promise.all(paths.map(async (p) => [p, (await read(projectId, p))?.text ?? null] as const)));
  return (path) => (got.has(path) ? got.get(path)! : now(projectId, path));
}

/**
 * The project's color files, as a reader for `paths` (each read when first asked for), and whether all of them are
 * read: the component is drawn again as they come in and whenever one changes.
 */
export function useColorFiles(projectId: string, paths: readonly string[]): { text: ColorText; ready: boolean } {
  const v = React.useSyncExternalStore((fn) => { heard.add(fn); return () => { heard.delete(fn); }; }, () => version);
  return React.useMemo(() => {
    const text: ColorText = (path) => now(projectId, path);
    return { text, ready: paths.every((p) => text(p) !== undefined) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, paths.join('\n'), v]);
}

/**
 * Files written whole, each when it is still as read: the step that takes them back (and puts them again), or why
 * they were not written (one changed since it was read: it is read again, for the next try). A file there was none of
 * is taken away by the undo.
 */
export async function writeColorFiles(projectId: string, writes: readonly { path: string; text: string }[]): Promise<OutsideStep | string> {
  const done: { path: string; was: Read; text: string; rev: string | null }[] = [];
  const back = async () => {
    for (const d of [...done].reverse()) await api.writePage(projectId, d.path, d.was?.text ?? null, d.rev, true).catch(() => null);
  };
  try {
    for (const w of writes) {
      const was = await read(projectId, w.path);
      if (was?.text === w.text) continue;
      const rev = await api.writePage(projectId, w.path, w.text, was?.rev ?? null);
      files.set(key(projectId, w.path), rev ? { text: w.text, rev } : null);
      written.set(key(projectId, w.path), w.text);
      done.push({ path: w.path, was, text: w.text, rev });
    }
  } catch (e) {
    await back();
    colorFilesChanged(projectId, writes.map((w) => w.path));
    return e instanceof Error ? e.message : String(e);
  }
  tell();
  /* each undo and redo writes over what the last wrote, refused when someone changed the file meanwhile */
  const put = async (to: 'was' | 'text') => {
    const order = to === 'was' ? [...done].reverse() : done;
    for (const d of order) {
      const from = to === 'was' ? d.rev : d.was?.rev ?? null;
      const text = to === 'was' ? d.was?.text ?? null : d.text;
      try {
        const rev = await api.writePage(projectId, d.path, text, from, to === 'was');
        files.set(key(projectId, d.path), rev && text != null ? { text, rev } : null);
        written.set(key(projectId, d.path), text);
      } catch (e) {
        colorFilesChanged(projectId, [d.path]);
        return e instanceof Error ? e.message : String(e);
      }
    }
    tell();
    return null;
  };
  return { undo: () => put('was'), redo: () => put('text') };
}

/** What the inspector's color controls are given by the project view: a change shown on the picture, and written. */
export interface ColorHost {
  projectId: string;
  /** The clips `ids` shown as `write` grades them, nothing written (null: as written again). */
  preview(write: import('./clip-color.ts').ColorWrite | null, ids: readonly string[]): void;
  /** `write` written as one step of the undo (`label` its name in the history); why not, or null. */
  commit(write: import('./clip-color.ts').ColorWrite, label?: string): Promise<string | null>;
}
