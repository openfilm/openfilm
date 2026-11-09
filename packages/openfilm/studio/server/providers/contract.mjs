// @ts-check
/**
 * Where `openfilm get` gets media from: services the person connects with their own key, each paid directly, with the
 * model the person chose for each kind of media. Each provider is a module
 * whose default export is a `Provider`; `get.mjs` picks one per verb (`--via`, else the person's choice in Settings;
 * nothing is picked for them) and lands what it returns in the project.
 *
 * Verbs (the same flags whoever serves them; a provider takes the ones it can honor and says so for the rest):
 *   voice         list voices                  --language --gender --prompt --limit
 *   tts           voice-over                   --out --text --voice
 *   sfx           sound effect                 --out --prompt --sec
 *   music         music                        --out --prompt --sec
 *   asr           transcribe a project file    --src --force
 *   cutout        a picture's background out   --src --out
 *   image-search  find pictures on the web     --out --prompt --n
 *   video-search  find video clips on the web  --out --prompt --n --orientation
 *   image         make a picture               --out --prompt --ratio --quality --transparent
 *   video         make a video clip            --out --prompt --duration --aspect-ratio --first-frame --last-frame
 *                                              --input-reference --video
 *   web-search    search the web               --query (up to 3)
 *   web-fetch     read web pages               --url (up to 3)
 * and `translate` (subtitles: `{ lines, language }` → translated lines), which is not a CLI verb. Its args also carry
 * the voice it comes from (`src`, `text`, `words`, `dur`) and each line's `times` ({ startSec, endSec }); the lines come
 * back as `receipt.lines`, one string per line asked.
 */

/**
 * @typedef {'voice' | 'tts' | 'sfx' | 'music' | 'asr' | 'cutout' | 'image-search' | 'video-search' | 'image' | 'video' | 'translate' | 'web-search' | 'web-fetch'} Verb
 */

/**
 * What a run says about a file it made or heard: `{ src, kind, text?, dur?, words?:
 * [{ token, start, end }], cast?, voice?, ... }`. Speech whose words are timed gets its transcript from it (get.mjs).
 * @typedef {Record<string, unknown> & { src: string }} IndexRow
 */

/**
 * What a run gives back. Files go under `assets/` only (no `..`); `index` says what is in them.
 * @typedef {{
 *   files: { path: string, bytes: Uint8Array }[],
 *   index: IndexRow[],
 *   receipt: Record<string, unknown>,
 *   cost?: { note?: string },
 * }} RunResult
 */

/**
 * What spending needs the person's go-ahead for: a video clip before it is made (the provider, the model's name, how
 * long, what it shows), whoever makes it. It carries no amounts: what an account has left is on the provider's own page.
 * @typedef {{
 *   kind: 'video',
 *   provider: string,
 *   model?: string,
 *   seconds?: number,
 *   prompt?: string,
 * }} Spend
 */

/**
 * `read`: a project file's bytes (for `asr`, the speech alone: a small mono copy, in `speechFormat` when requested).
 * `link`: a temporary web (https) address of a project file, for a service that fetches what it is given from an
 * address only; there only when the run can make one (OpenFilm's service: kept until the run ends, then deleted).
 * `model`: the id of the model, one of the provider's `models` for the verb, the person chose (a provider uses its first
 * when there is none).
 * @typedef {{
 *   key: string,
 *   model?: string,
 *   root: string,
 *   signal: AbortSignal,
 *   say: (line: string) => void,
 *   read: (path: string) => Promise<Uint8Array>,
 *   link?: (path: string) => Promise<string>,
 * }} RunContext
 */

/**
 * What a picture or clip model makes, as Studio's canvas offers it (nothing said: the canvas offers the usual):
 * `ratios`, its shapes; `seconds`, a clip's lengths (a range in whole seconds) or `only` some; `refs`, the most pictures
 * it is made from (`--ref` for a picture, `--input-reference` for a clip; 0: none); `frames`, a clip from a first (and
 * last) frame, or just a first frame (optional or required); `qualities`, a picture's `--quality`, the finest last;
 * `needs`, a clip made only from another clip (`--video`) or a recording spoken (`--audio`); `voice`, a clip that also takes a recording of whose voice speaks in it
 * (`--voice`); `clip`, one that also takes a clip to continue or change (`--video`); `sizes`, a picture's `--size` or
 * a clip's `--resolution`, as it makes them; `transparent`, a picture with no background (`--transparent`); `formats`,
 * a picture's `--format` beyond PNG (gif, svg); `mask` and `markup`, a picture redrawn where a mask leaves it clear
 * (`--mask`) or where changes are drawn on it (`--markup`).
 * @typedef {{
 *   ratios?: string[],
 *   seconds?: [number, number],
 *   only?: number[],
 *   refs?: number,
 *   frames?: boolean | 'first' | 'first-required',
 *   qualities?: string[],
 *   needs?: 'clip' | 'audio',
 *   voice?: boolean,
 *   clip?: boolean,
 *   sizes?: string[],
 *   transparent?: boolean,
 *   formats?: string[],
 *   mask?: boolean,
 *   markup?: boolean,
 * }} ModelSpec
 */

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   env: string,
 *   keysUrl: string,
 *   billingUrl: string,
 *   pricingUrl?: string,
 *   verbs: Verb[],
 *   models?: Partial<Record<Verb, { id: string, name: string, spec?: ModelSpec }[]>>,
 *   checkKey?: (key: string) => void,
 *   signIn?: import('../sign-in.mjs').SignIn,
 *   refresh?: (options?: { force?: boolean }) => Promise<void>,
 *   keyless?: boolean,
 *   ready?: () => boolean,
 *   speechFormat?: 'mp3',
 *   run: (verb: Verb, args: Record<string, unknown>, ctx: RunContext) => Promise<RunResult>,
 *   added?: boolean,
 * }} Provider
 * `models`: the models it can make each kind of media with, its default first, each with the name people know it by
 * (Settings → Services shows "ElevenLabs · Eleven v4") and, for pictures and clips, what it makes (`spec`), so the
 * canvas offers only that.
 * `checkKey`: throws a sentence when a pasted key cannot work as it is (Azure's must carry its region), shown where it
 * is pasted instead of at the first run. Only for what the provider knows without calling anyone: it must not fetch.
 * `signIn`: connected by signing in on the provider's website instead of pasting a key (sign-in.mjs); the key it
 * gives is kept like a pasted one.
 * `refresh`: its `models` (and `verbs`) are what its service offers now, asked again before they are shown or used
 * (`force`: now, not when last asked a while ago); it never throws, and keeps what it had when the service cannot be
 * reached.
 * `keyless`: it also works with no key (a free tier), so the person can connect it with one click and add a key for
 * higher limits. Connected without one, its `key` is ''. Like every provider, it serves nothing until it is connected.
 * `ready`: it takes no key at all (Local services): connected while it can run, which it says.
 * `added`: one the person added in their shared home (added.mjs), not built in; set when it is read.
 * `pricingUrl`: the provider's own pricing page, linked as "Pricing" in Settings → Providers. Only the link: what is free
 * and what is paid changes on the provider's side. None for OpenFilm's own service (no price is shown in the app) and for
 * Local services (free).
 * `billingUrl`: the provider's own page where the person tops up its balance. A run that fails because the account has
 * no balance left throws an Error with `code: 'balance'` (common.mjs `noBalance`), the same for every provider: the
 * person is told in Studio, with this page, and the agent is told to stop.
 */

export {};
