/** A sound's fades in the mix: `in` / `out` film seconds of ramp, `length` its film seconds, `skip` seconds cut off its start. */
export interface MixFade { in: number; out: number; length: number; skip: number }
export interface MixClip { file: string; at: number; from: number; to?: number; volume: number; speed?: number; fade?: MixFade }
export declare function audioClips(root: string, entry: string, clips: Array<{ src: string; at?: number; from?: number; to?: number; volume?: number; speed?: number; fade?: readonly [number, number] }> | undefined, from?: number): MixClip[];
export declare function fadeFilter(fade: MixFade | undefined): string;
export declare function mix(clips: MixClip[], duration: number, file: string, codec?: string[]): Promise<void>;
/** A film opened in a browser to be drawn: what `look` and `render` start from. */
export interface OpenFilm {
  root: string; entry: string; dir: string; name: string;
  film: import('./host.mjs').FilmPage;
  browser: import('playwright-core').Browser;
  site: { url: string; close(): Promise<void> };
  close(): Promise<void>;
}
export declare function open(target: string, opts?: { root?: string }): Promise<OpenFilm>;
/** The film's sound from `from` seconds on, as clips to mix: its sound clips and its videos' own sound. */
export declare function filmSound(s: OpenFilm, from: number): Promise<MixClip[]>;
export declare class UsageError extends Error {}
/** Run ffmpeg (`-nostdin`, errors only) with `args`; rejects with its error, or when it runs past `timeoutMs`. */
export declare function ffmpeg(args: string[], opts?: { input?: boolean; timeoutMs?: number; what?: string }): { proc: import('node:child_process').ChildProcess; done: Promise<void> };
