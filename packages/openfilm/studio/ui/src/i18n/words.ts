import type { en } from './en.ts';

type Deep<T> = { [K in keyof T]?: T[K] extends string ? string : Deep<T[K]> };

/** A table in another language: English's paths, each a string; one it leaves out is said in English. */
export type Words = Deep<typeof en>;
