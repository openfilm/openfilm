/** What kind of thing a turn makes. Only `video` (a film arranged by film.json) for now. */
export const MODALITIES = ['video'] as const;

export type Modality = (typeof MODALITIES)[number];
