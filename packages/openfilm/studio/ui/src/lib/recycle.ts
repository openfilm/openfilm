/**
 * Windows: an item Studio's server left where it was instead of recycling it, because the Recycle Bin would not have
 * taken it and the shell deletes such an item for good (studio/server/trash.mjs). The API answers 409 with this, and
 * the UI says why in the person's language.
 */
export interface RecycleRefusal {
  code: 'recycle';
  why: 'network' | 'removable' | 'no-bin' | 'no-volume' | 'policy' | 'nuke' | 'too-big';
  /** the item, by its name */
  name: string;
  /** the drive it is on (`D:`), or the network path's root */
  drive: string;
  /** too-big: the item's size, and what the bin holds, as words (`12.4 GB`) */
  size?: string | null;
  holds?: string | null;
}

const WHY = ['network', 'removable', 'no-bin', 'no-volume', 'policy', 'nuke', 'too-big'] as const;

/** The refusal in an API answer's body, if that is what it is. */
export function recycleRefusalOf(body: unknown): RecycleRefusal | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (b.code !== 'recycle' || typeof b.name !== 'string' || typeof b.drive !== 'string' || !WHY.includes(b.why as never)) return null;
  return { code: 'recycle', why: b.why as RecycleRefusal['why'], name: b.name, drive: b.drive, size: typeof b.size === 'string' ? b.size : null, holds: typeof b.holds === 'string' ? b.holds : null };
}

const KEY: Record<RecycleRefusal['why'], string> = { network: 'network', removable: 'removable', 'no-bin': 'noBin', 'no-volume': 'noVolume', policy: 'policy', nuke: 'nuke', 'too-big': 'tooBig' };

/** `{key}` in `words` filled with `value` as it is (a replacement string would read `$&` or `$1` in a file's name). */
const fill = (words: string, key: string, value: string) => words.replace(`{${key}}`, () => value);

/** Why alone, a clause: "it is 12.4 GB, more than the Recycle Bin of drive D: holds (5 GB)". */
export function recycleWhyWords(t: (path: string) => string, r: RecycleRefusal): string {
  return fill(fill(fill(t(`recycle.${KEY[r.why]}`), 'drive', r.drive), 'size', r.size ?? ''), 'holds', r.holds ?? '');
}

/** The refusal said whole: the item, why, and that it stays where it is. */
export function recycleRefusalWords(t: (path: string) => string, r: RecycleRefusal): string {
  return fill(fill(t('recycle.refused'), 'name', r.name), 'why', recycleWhyWords(t, r));
}
