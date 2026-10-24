/**
 * Which Esc stops the turn while it runs (the send button's other half): one pressed in the chat (chat-layer.ts
 * `inChat`). One in Studio closes Studio's menu or dialog, and one already handled is its handler's; neither stops the
 * agent. Nor does an Esc held down, or pressed again just after one of those: Studio's Settings gives the focus back to
 * the chat as it closes, so the key held, or pressed twice to close it, would land in the chat and stop the agent.
 *
 * Pure: no React, no bridge, so `node --test` runs it (src/esc-stop.test.mjs).
 */

/** An Esc this soon after one that was not the chat's is still closing, not stopping. */
export const ESC_AGAIN_MS = 1000;

type EscKey = Pick<KeyboardEvent, 'key' | 'repeat' | 'defaultPrevented' | 'timeStamp'>;

/** Hears every key pressed (`inChat`: where it was) and says whether it stops the turn. */
export function escStopper(): (event: EscKey, inChat: boolean) => boolean {
  let elsewhereAt = -Infinity;
  return (event, inChat) => {
    if (event.key !== 'Escape') return false;
    if (event.defaultPrevented || !inChat) { elsewhereAt = event.timeStamp; return false; }
    return !event.repeat && event.timeStamp - elsewhereAt >= ESC_AGAIN_MS;
  };
}
