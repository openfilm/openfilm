/**
 * @openfilm/shared: what OpenFilm's clients and the OpenFilm service share.
 *
 *   contract / turn / video   a turn of the chat, what it made and the events a client sees
 *   agent-activity            how an agent's tool calls read in the chat
 *   prompt-reference          the pills a message points at
 *   title                     title width limits
 *
 * Also `@openfilm/shared/markdown` (Markdown parsing) and `@openfilm/shared/api` (the public API contract).
 */
export * from './modality';
export * from './contract';
export * from './agent-activity';
export * from './prompt-reference';
export * from './turn';
export * from './video';
export * from './title';
