/**
 * Words written in a box whose words the board holds (a node panel's ask): what is typed kept as it is typed.
 */
import React from 'react';

/**
 * Words written in a box whose words the board holds. The board's copy reaches the box a render late, so a box drawn
 * from it is put back to what it was before each key — which ends what an input method is composing and leaves its
 * letters behind (shuang, not 双). The box keeps its own words instead, sent to the board as they change, and takes the
 * board's only while it is not written in (an agent's words, an undo). `set` changes them from outside the box (the bar
 * over a note).
 */
export function useDraft(value: string, send: (text: string) => void) {
  const [draft, setDraft] = React.useState(value);
  const writing = React.useRef(false);
  React.useEffect(() => { if (!writing.current) setDraft(value); }, [value]);
  const set = (text: string) => { setDraft(text); send(text); };
  return {
    set,
    props: {
      value: draft,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => set(event.target.value),
      onFocusCapture: () => { writing.current = true; },
      onBlurCapture: () => { writing.current = false; },
    },
  };
}
