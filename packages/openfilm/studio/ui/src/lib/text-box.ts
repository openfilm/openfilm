/**
 * A line of the library's words (its text component) goes in with a box that hugs them: as tall as its catalog shape
 * gives it (lib/library libraryBox: the words take most of that height, the rest is room for them to move in), and as
 * wide as the words are, with the same room on each side. So the clip's box and its words are one frame on the picture,
 * and the words' motions (text.html: never further than that room) are never cut by the box.
 *
 * The words are measured as the page draws them, in a page of the library loaded out of sight at the box's size (the
 * same font and look, `vars`); a page that does not answer in time keeps the shape's box.
 */
type Box = { x: number; y: number; w: number; h: number };

/** The room the words keep on each side, of their font size: what their motions may use (text.html). */
export const TEXT_ROOM = 0.23;

/**
 * The box of words `wordsW` px wide in a font of `fontPx`, in place of `box` (same middle, same height), and never
 * wider than the picture. A little of their width is kept too: a motion that grows them (a pulse) grows them by it.
 */
export function huggingBox(box: Box, wordsW: number, fontPx: number, stageW: number): Box {
  if (!(wordsW > 0) || !(fontPx > 0)) return box;
  const w = Math.min(stageW, Math.round(wordsW + 2 * (TEXT_ROOM * fontPx + 0.04 * wordsW)));
  if (w >= box.w) return box;
  return { ...box, x: Math.round(box.x + (box.w - w) / 2), w };
}

/** `box` hugging the words of the text page at `url` (lib/library pageUrl) with CSS variables `vars`; `words`: what it says. */
export function hugText(url: string, box: Box, stageW: number, vars: Record<string, string> = {}, words?: string): Promise<Box> {
  /* words sized by the box's width (`vw`) would shrink with it: they keep their shape's box */
  if (typeof document === 'undefined' || /vw\s*$/.test(vars['--size'] ?? '')) return Promise.resolve(box);
  return new Promise((done) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = `position:fixed;left:-20000px;top:0;width:${box.w}px;height:${box.h}px;border:0;visibility:hidden;pointer-events:none`;
    let over = false;
    const end = (out: Box) => { if (over) return; over = true; frame.remove(); done(out); };
    const late = window.setTimeout(() => end(box), 2500);
    frame.onload = () => {
      const doc = frame.contentDocument;
      const line = doc?.querySelector<HTMLElement>('.t');
      if (!doc || !line) { window.clearTimeout(late); end(box); return; }
      if (words) line.textContent = words;
      void (doc.fonts?.ready ?? Promise.resolve()).then(() => requestAnimationFrame(() => {
        window.clearTimeout(late);
        /* its layout width (a motion's transform not counted), as the page fits it (`--fit`, the box's scale) */
        const fit = Number(getComputedStyle(line.parentElement ?? line).getPropertyValue('--fit')) || 1;
        end(huggingBox(box, line.offsetWidth * fit, parseFloat(getComputedStyle(line).fontSize) * fit, stageW));
      }));
    };
    const query = Object.keys(vars).length ? `?vars=${encodeURIComponent(JSON.stringify(vars))}` : '';
    frame.src = `${url}${query}`;
    document.body.append(frame);
  });
}
