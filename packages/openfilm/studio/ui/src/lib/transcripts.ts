/**
 * A video's or sound's transcript, and its translations, beside it with the same name (studio/server/transcripts.mjs):
 * `a.mp4` → `a.vtt`, `a.zh.vtt`. They are the file's own words and travel with it (a move or a rename takes them
 * along, files.mjs moveMedia), so the media pane lists the file and marks it, not its transcripts as files of their
 * own; nothing on disk changes. A `.vtt` with no media of its name beside it is a file like any other.
 */

/** The ending a transcript has after its media's name: `.vtt`, or a language's (`.zh.vtt`), as the server tells it. */
const ENDING = /^\.(?:[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*\.)?vtt$/;

const stemOf = (path: string) => {
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  return dot > slash ? path.slice(0, dot) : path;
};

/**
 * Of `files`: the transcripts that belong to a video or sound beside them (`hidden`), and each such media file's own
 * transcript (`of`, by its path: `a.vtt`, not a translation).
 */
export function transcriptsOf(files: readonly { path: string; kind: string }[]): { hidden: ReadonlySet<string>; of: ReadonlyMap<string, string> } {
  const media = new Map<string, string[]>();
  for (const f of files) {
    if (f.kind !== 'video' && f.kind !== 'audio') continue;
    const stem = stemOf(f.path);
    media.set(stem, [...(media.get(stem) ?? []), f.path]);
  }
  const hidden = new Set<string>();
  const of = new Map<string, string>();
  for (const f of files) {
    if (!f.path.toLowerCase().endsWith('.vtt')) continue;
    /* `a.zh.vtt` belongs to `a` (`.zh.vtt` its ending); `a.vtt` to `a` */
    for (const stem of [stemOf(f.path), stemOf(stemOf(f.path))]) {
      const owners = media.get(stem);
      if (!owners || !ENDING.test(f.path.slice(stem.length))) continue;
      hidden.add(f.path);
      if (f.path.slice(stem.length).toLowerCase() === '.vtt') for (const owner of owners) of.set(owner, f.path);
      break;
    }
  }
  return { hidden, of };
}
