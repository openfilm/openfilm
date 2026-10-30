/**
 * Where copied layers are in their page's file, as the browser reads the file (no script run): the elements the stage
 * named, by their path from `<body>` and their shape (lib/layer-paste finds them there in the text). A layer is known
 * by its tag, id and classes, then its words: an element the page's code put before it moves it in the page as drawn,
 * so where the selector points in the file is the last thing to go by. Null when the file has no such element (the
 * page's code makes it as it runs).
 */
import type { PasteLayer, PasteTarget } from './layer-paste';
import type { Shape } from './html-source';

const words = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
const shapeOf = (el: Element): Shape => ({ tag: el.localName, children: [...el.children].map(shapeOf) });

/** `el`'s path from `<body>`, its tags, its shape. */
function targetOf(doc: Document, el: Element): PasteTarget {
  const path: number[] = [];
  const tags: string[] = [];
  for (let n: Element = el; n !== doc.body; n = n.parentElement!) {
    path.unshift([...n.parentElement!.children].indexOf(n));
    tags.unshift(n.localName);
  }
  return { path, tags, shape: shapeOf(el) };
}

export function pasteTargets(text: string, layers: readonly PasteLayer[]): PasteTarget[] | null {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const out: PasteTarget[] = [];
  for (const layer of layers) {
    const alike = [...doc.body.querySelectorAll(layer.tag)].filter((x) => (
      (x.id || null) === layer.id && layer.classes.every((c) => x.classList.contains(c))
    ));
    let pointed: Element[] = [];
    try { pointed = layer.at ? [...doc.querySelectorAll(layer.at)] : []; } catch { /* a selector this reading cannot take */ }
    const same = alike.filter((x) => words(x) === layer.text);
    /* its words first (several alike: the one the selector points at, else the first); none with its words (the clip
       changed them, or its code writes them): the one the selector points at, when it points at one alike */
    const pointedAlike = alike.filter((x) => pointed.includes(x));
    const el = same.length === 1 ? same[0]
      : same.length > 1 ? same.find((x) => pointed.includes(x)) ?? same[0]
        : pointedAlike.length === 1 ? pointedAlike[0] : null;
    if (!el) return null;
    out.push(targetOf(doc, el));
  }
  return out;
}

/** Where the element of id `id` is in the page's file (a copy pasted before), as pasteTargets says it. */
export function targetById(text: string, id: string): PasteTarget | null {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  const el = doc.getElementById(id);
  return el && doc.body.contains(el) ? targetOf(doc, el) : null;
}
