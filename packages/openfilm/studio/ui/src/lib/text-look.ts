/**
 * The library's text component (library/text/text) as the inspector edits it: its words are the `.t` layer's text
 * override, everything else its CSS variables in the clip's `:root` override. A word-art look and each motion own a
 * set of those variables: putting one on takes the last one's off first, so they never mix.
 *
 * Pure: no React, no DOM, so `node --test` runs it.
 */

/** The page's own values, as text.html sets them (what an unset variable reads as). */
export const TEXT_DEFAULTS: Readonly<Record<string, string>> = {
  '--font': "'Smiley Sans', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', 'Hiragino Sans GB', sans-serif",
  '--size': '62vh', '--weight': '800', '--color': '#ffffff', '--fill': 'none', '--stroke': '0', '--stroke-color': '#000000',
  '--shadow': 'none', '--glow': 'none', '--box': 'transparent', '--box-pad': '0', '--box-radius': '0', '--spacing': '0.02em',
  '--italic': 'normal', '--align': 'center', '--wrap': 'pre',
  '--in': 'none', '--in-time': '0.5s', '--loop': 'none', '--loop-time': '1.6s', '--out': 'none', '--out-time': '0.4s',
};

/** The words' layer in the page. */
export const WORDS_AT = '.t';
const ROOT = ':root';

/** What a word-art look sets (its size only when it has one: a look keeps the words' size). */
export const LOOK_VARS = ['--font', '--weight', '--color', '--fill', '--stroke', '--stroke-color', '--shadow', '--glow', '--box', '--box-pad', '--box-radius', '--spacing', '--italic'];
/** What each motion sets. */
export const MOTION_VARS = { in: ['--in', '--in-time'], loop: ['--loop', '--loop-time'], out: ['--out', '--out-time'] } as const;
export type MotionSlot = keyof typeof MOTION_VARS;

type Override = Record<string, unknown>;
const rootOf = (list: readonly unknown[] | undefined) => (list ?? []).find((o) => (o as Override)?.at === ROOT && (o as Override).n === undefined) as Override | undefined;

/** The clip's variables, its own over the page's defaults. */
export function textVars(overrides: readonly unknown[] | undefined): Record<string, string> {
  return { ...TEXT_DEFAULTS, ...((rootOf(overrides)?.style as Record<string, string> | undefined) ?? {}) };
}

/** Its words as the clip set them (null: the page's own). */
export function textWords(overrides: readonly unknown[] | undefined): string | null {
  const list = (overrides ?? []) as Override[];
  const own = list.find((o) => o?.at === WORDS_AT && typeof o.text === 'string')
    ?? list.find((o) => typeof o?.at === 'string' && LINE_AT.test(o.at) && typeof o.text === 'string');
  return own ? String(own.text) : null;
}

/* the line of words named another way (by its path, `body > div.stage > div.box > span.t`, as typing in place on the
   picture names a layer): the same words */
const LINE_AT = /(^|[\s>+~])(span)?\.t$/;

/** The overrides with `set` in the `:root` entry and `drop` taken out of it (an entry left empty goes). */
export function withVars(overrides: readonly unknown[] | undefined, set: Record<string, string>, drop: readonly string[] = []): Override[] {
  const list = (overrides ?? []).map((o) => ({ ...(o as Override) }));
  const at = list.findIndex((o) => o.at === ROOT && o.n === undefined);
  const style: Record<string, string> = { ...((at >= 0 ? list[at]!.style as Record<string, string> | undefined : undefined) ?? {}) };
  for (const key of drop) delete style[key];
  Object.assign(style, set);
  if (at >= 0) {
    if (Object.keys(style).length) list[at] = { ...list[at], style };
    else list.splice(at, 1);
  } else if (Object.keys(style).length) list.push({ at: ROOT, style });
  return list;
}

/** A word-art look put on: the last look's variables off, this one's on (its size only if it has one). */
export const withLook = (overrides: readonly unknown[] | undefined, look: Record<string, string>): Override[] => withVars(overrides, look, LOOK_VARS);

/** A motion put on in its slot (in, loop, out): the slot's last motion off, this one on. */
export const withMotion = (overrides: readonly unknown[] | undefined, slot: MotionSlot, motion: Record<string, string>): Override[] =>
  withVars(overrides, motion, MOTION_VARS[slot]);

/** The overrides with the words set (empty: back to the page's own). */
export function withWords(overrides: readonly unknown[] | undefined, words: string): Override[] {
  /* one entry holds the words: any other naming the line gives its words up (the later one would win over these) */
  const list = (overrides ?? []).map((o) => ({ ...(o as Override) }))
    .map((o) => {
      if (o.at === WORDS_AT || typeof o.at !== 'string' || !LINE_AT.test(o.at) || !('text' in o)) return o;
      const { text: _gone, ...rest } = o;
      return rest;
    })
    .filter((o) => !(typeof o.at === 'string' && (o.at === WORDS_AT || LINE_AT.test(o.at)) && Object.keys(o).length <= ('text' in o ? 2 : 1)));
  const own = list.find((o) => o.at === WORDS_AT);
  if (!words) { if (own) delete own.text; return list; }
  if (own) own.text = words;
  else list.push({ at: WORDS_AT, text: words });
  return list;
}

/** Which of `items` a set of variables is now (each item its own `vars`), or null: what the inspector lights. */
export function currentOf<T extends { vars?: Record<string, string> }>(vars: Record<string, string>, items: readonly T[], keys: readonly string[]): T | null {
  return items.find((item) => item.vars && keys.every((k) => (item.vars![k] ?? TEXT_DEFAULTS[k]) === vars[k])) ?? null;
}
