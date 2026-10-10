/**
 * Whether focus is in a typing context: Space must not play and Cmd/Ctrl+Z must not undo the whole film.
 *
 * The keys pressed in an app's own panel inside Studio's page (lib/host.ts `panel`, marked `data-studio-host-panel`)
 * are the app's: Studio's shortcuts leave them alone, as they do a text field's.
 *
 * In-place text editing on the stage uses `contenteditable="plaintext-only"` (see
 * FilmStageSelect). Matching only `[contenteditable="true"]` would miss it, and Space would be
 * eaten by the play shortcut. `isContentEditable` recognizes both.
 *
 * Avoids `instanceof HTMLElement`: a target from another document (a page inside the picture) has its own set of
 * constructors, so a cross-document instanceof is always false.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !('nodeType' in target)) return false;
  const node = target as Node;
  const el = node.nodeType === 1
    ? node as HTMLElement
    : node.nodeType === 3
      ? node.parentElement
      : null;
  if (!el) return false;
  if (typeof el.closest === 'function' && el.closest('[data-studio-host-panel]')) return true;
  const field = typeof el.closest === 'function' ? el.closest('input, textarea, select') : null;
  if (field) {
    /* A focused slider, color swatch or checkbox is not typing: after dragging a volume or
       picking a color in the inspector, focus stays on that control. Treating it as typing would
       disable Space, Cmd/Ctrl+Z and Delete until the user clicks elsewhere, which looks like a broken undo. */
    const type = (field as HTMLInputElement).type;
    if ((field as Element).tagName === 'INPUT' && typeof type === 'string' && NON_TEXT_INPUTS.has(type)) return false;
    return true;
  }
  return Boolean(el.isContentEditable);
}

const NON_TEXT_INPUTS = new Set(['range', 'color', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image']);
