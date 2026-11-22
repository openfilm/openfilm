/**
 * The Community's first page (components/library/PluginsPane, its Featured place): the shelves a maintainer picked
 * (studio/server/examples.mjs readFeatured), each thing found among what OpenFilm has read. What a shelf names and
 * is not there (taken back since, of a kind this OpenFilm does not know, or not read yet) is left out, and so is a
 * shelf left with nothing. Kept apart from the window so it can be tested without one.
 */

/** A thing on a shelf: its kind, and the id OpenFilm knows it by (an asset's: its name in the Community, `<category>/<slug>`). */
export type FeaturedItem = { kind: 'skill' | 'example' | 'pack' | 'asset'; id: string };
export type FeaturedShelf = { id: string; title: Record<string, string>; text: Record<string, string>; items: FeaturedItem[] };
/** The shelves, in the order a maintainer put them, and the makers put forward (their names in the Community). */
export type Featured = { shelves: FeaturedShelf[]; makers: string[] };

/** What OpenFilm has read of each kind: the catalog's plugins and skills, the examples, the library's packs and things. */
export type FeaturedHere<S, E, P, A> = { skills: readonly S[]; examples: readonly E[]; packs: readonly P[]; assets: readonly A[] };
/** A shelf's thing, found: `key` is its own among everything on the page. */
export type ShelfThing<S, E, P, A> =
  | { kind: 'skill'; key: string; skill: S }
  | { kind: 'example'; key: string; example: E }
  | { kind: 'pack'; key: string; pack: P }
  | { kind: 'asset'; key: string; asset: A };

export const thingKey = (item: FeaturedItem): string => `${item.kind}:${item.id}`;

/* where the library keeps the Community's things: `community/v1/<category>/<slug>-v<version>-<revision>`, a file's name after it */
const COMMUNITY = 'community/v1/';
const VERSIONED = /^\d+-[a-f0-9]{64}(?:\/|$)/;

/**
 * One of the library's things by its name in the Community (`<category>/<slug>`). Its id in the library is its place
 * there, which carries its version too, so `media/dot` never finds `media/dot-v2`.
 */
export function assetNamed<A extends { id: string }>(assets: readonly A[], name: string): A | undefined {
  const start = `${COMMUNITY}${name}-v`;
  return assets.find((a) => a.id.startsWith(start) && VERSIONED.test(a.id.slice(start.length)));
}

/** A shelf's things in its order, those OpenFilm has read; the rest are left out. */
export function shelfThings<S extends { uid: string }, E extends { id: string }, P extends { id: string }, A extends { id: string }>(
  shelf: FeaturedShelf, here: FeaturedHere<S, E, P, A>,
): ShelfThing<S, E, P, A>[] {
  const out: ShelfThing<S, E, P, A>[] = [];
  for (const item of shelf.items) {
    const key = thingKey(item);
    if (item.kind === 'skill') { const skill = here.skills.find((k) => k.uid === item.id); if (skill) out.push({ kind: 'skill', key, skill }); }
    else if (item.kind === 'example') { const example = here.examples.find((e) => e.id === item.id); if (example) out.push({ kind: 'example', key, example }); }
    else if (item.kind === 'pack') { const pack = here.packs.find((p) => p.id === item.id); if (pack) out.push({ kind: 'pack', key, pack }); }
    else if (item.kind === 'asset') { const asset = assetNamed(here.assets, item.id); if (asset) out.push({ kind: 'asset', key, asset }); }
  }
  return out;
}

/** The shelves with something to show, each with its things. */
export function shelvesShown<S extends { uid: string }, E extends { id: string }, P extends { id: string }, A extends { id: string }>(
  featured: Featured | null, here: FeaturedHere<S, E, P, A>,
): Array<{ shelf: FeaturedShelf; things: ShelfThing<S, E, P, A>[] }> {
  return (featured?.shelves ?? []).map((shelf) => ({ shelf, things: shelfThings(shelf, here) })).filter((x) => x.things.length);
}

/**
 * The makers put forward, each with how many things of theirs OpenFilm has read (their plugins and skills, their
 * examples, their packs and the things they listed alone); `owned`: whose each thing is, in lowercase.
 */
export function makersShown(featured: Featured | null, owned: readonly string[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>();
  for (const owner of owned) counts.set(owner, (counts.get(owner) ?? 0) + 1);
  return (featured?.makers ?? []).map((name) => ({ name, count: counts.get(name) ?? 0 }));
}
