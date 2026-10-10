import type { enUS } from './en-US';

type Deep<T> = { [K in keyof T]?: T[K] extends string ? string : Deep<T[K]> };

/** A table in another language: English's paths; one it leaves out is said in English. */
export type Words = Deep<typeof enUS>;
