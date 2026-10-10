/**
 * Whether a menu of the chat's is open (the model menu, the @ list…). While the project's assets are open the chat's
 * view keeps only its composer, and a menu opening above it needs the whole column back: the app is told (main.mjs
 * `assets.menu`). Counted, since one menu can open from another.
 */
import React from 'react';

let open = 0;
const tell = () => (window as unknown as { openfilmDesktop?: { setMenuOpen?: (open: boolean) => void } }).openfilmDesktop?.setMenuOpen?.(open > 0);

export function useChatMenu(shown: boolean) {
  React.useEffect(() => {
    if (!shown) return undefined;
    open += 1;
    tell();
    return () => { open -= 1; tell(); };
  }, [shown]);
}
