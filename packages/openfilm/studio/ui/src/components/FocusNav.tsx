import React from 'react';

/**
 * Records whether the last focus change came from Tab or from a pointer.
 *
 * The `:focus-visible` heuristic treats any key press as keyboard use, so pressing Space
 * (play) would draw a focus ring on a button that was just clicked. Tracking the source
 * ourselves lets CSS draw the ring only after a real Tab.
 */
export function FocusNav() {
  React.useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-focus-nav', 'pointer');
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') root.setAttribute('data-focus-nav', 'tab');
    };
    const onPointer = (): void => {
      root.setAttribute('data-focus-nav', 'pointer');
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);
  return null;
}
