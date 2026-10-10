/**
 * Where the chat draws what floats over the window (menus, tooltips, previews): its own layer at the end of the page,
 * inside the chat's styles (`.of-chat`), so a menu opened from the composer can reach over Studio and still look like
 * the chat's. The chat itself sits in Studio's page (apps/desktop/shell), not on a page of its own.
 */
export const chatLayer = (): HTMLElement => document.getElementById('of-chat-layer') ?? document.body;

/** Whether a key or pointer event happened in the chat (its column or its layer), not in Studio around it. */
export const inChat = (target: EventTarget | null): boolean =>
  Boolean(target && (target as Element).closest?.('.of-chat'));
