/**
 * The names and search words of what is shared with the Community (lib/community-share): what the person typed, made
 * into what the Community's library takes. Kept apart from the calls so that it runs anywhere.
 */

/** A name for an item from its title: its Latin letters and digits as a slug; '' when it has none (the server's slugOf). */
export function slugOf(words: string): string {
  return words.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
}

/**
 * Names for the items of one share, each its own: from its title where that has Latin letters or digits, else its
 * kind with a mark of the moment (`video-m3k9x2a`), so two things shared on two days never get one name and one
 * never takes the other's place as its next version. `stamp`: the moment, for the tests.
 */
export function namesFor(items: { title: string; media: string | null }[], stamp = Date.now().toString(36)): string[] {
  const taken = new Set<string>();
  return items.map((item, i) => {
    const base = slugOf(item.title) || `${item.media ?? 'media'}-${stamp}${i ? i.toString(36) : ''}`;
    let name = base;
    for (let n = 2; taken.has(name); n += 1) name = `${base.slice(0, 36)}-${n}`;
    taken.add(name);
    return name;
  });
}

/** Search words as typed, split at commas (either kind) and trimmed; at most eight. */
export const wordsOf = (typed: string) => [...new Set(typed.split(/[,，、]/).map((w) => w.trim()).filter(Boolean))].slice(0, 8);
