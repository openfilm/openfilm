/**
 * My media's files moved between its folders (studio/server/media-library.mjs `moveFile`): a file of Saved, named
 * from its top (`Favorites/logo.png`), to the top of another folder of it (`saved:<folder>`).
 */
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const libraryApi = {
  /** A file moved to the top of another place. Resolves with where it is now, or null. */
  move: async (place: string, path: string, to: string): Promise<{ place: string; path: string } | null> => {
    const res = await post('/api/media-library/move', { place, path, to });
    return res.ok ? res.json() as Promise<{ place: string; path: string }> : null;
  },
};
