import type { LaunchOptions, PageNetwork } from './host.mjs';
export declare function look(args: string[], opts?: { count?: number; full?: boolean; root?: string; offline?: boolean; network?: PageNetwork; launch?: LaunchOptions }): Promise<{ ok: boolean; lines: string[]; files: string[] }>;
export declare function watchLines(file: string, fps: number, from: number, to: number): Promise<string[]>;
