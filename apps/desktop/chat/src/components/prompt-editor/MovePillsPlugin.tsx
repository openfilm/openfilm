'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createRangeSelection,
  $createTextNode,
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  $getRoot,
  $isLineBreakNode,
  $isTextNode,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  DRAGEND_COMMAND,
  DRAGOVER_COMMAND,
  DRAGSTART_COMMAND,
  DROP_COMMAND,
  mergeRegister,
  type LexicalNode,
  type NodeKey,
  type RangeSelection,
} from 'lexical';
import { $createPromptReferenceNode, $isPromptReferenceNode } from './PromptReferenceNode';
import { dropSpaceAfterRemoval, PILL_NEIGHBOR, spacesAroundPill } from './pill-spacing';

/* Marks a drag as a pill of this editor. The data is only the node's key: a pill moves within its own editor, and
   anything else (another window, Studio, Finder) ignores a type it does not know. */
const PILL_DRAG_TYPE = 'application/x-openfilm-pill';

/** A place in the text, as the DOM sees it. */
interface DomPlace {
  node: Node;
  offset: number;
}

/**
 * The place in the text under the pointer.
 *
 * Over a pill, it is before or after the pill, whichever half the pointer is on: inside a pill there is no place to
 * put anything. Null off the text.
 */
export function placeAtPoint(root: HTMLElement, x: number, y: number): DomPlace | null {
  const range = document.caretRangeFromPoint(x, y);
  if (!range || !root.contains(range.startContainer)) return null;
  const start = range.startContainer;
  const element = start instanceof Element ? start : start.parentElement;
  const pill = element?.closest('[data-lexical-decorator]');
  if (pill && root.contains(pill) && pill.parentNode) {
    const box = pill.getBoundingClientRect();
    const index = Array.prototype.indexOf.call(pill.parentNode.childNodes, pill) as number;
    return { node: pill.parentNode, offset: index + (x > box.left + box.width / 2 ? 1 : 0) };
  }
  return { node: start, offset: range.startOffset };
}

/** Where the insertion caret is drawn for a place: a thin line as tall as the text there. */
function caretBox(place: DomPlace): { left: number; top: number; height: number } | null {
  const range = document.createRange();
  range.setStart(place.node, place.offset);
  range.collapse(true);
  const rect = [...range.getClientRects()].find((r) => r.height > 0);
  if (rect) return { left: rect.left, top: rect.top, height: rect.height };
  /* Between elements (next to a pill, a line break) a collapsed range has no box: use the neighbor's edge. */
  if (place.node instanceof Element) {
    const after = place.node.childNodes[place.offset];
    const before = place.node.childNodes[place.offset - 1];
    const box = (node: ChildNode | undefined) => (node instanceof Element && node.tagName !== 'BR' ? node.getBoundingClientRect() : null);
    const next = box(after);
    if (next) return { left: next.left - 2, top: next.top, height: next.height };
    const previous = box(before);
    if (previous) return { left: previous.right + 1, top: previous.top, height: previous.height };
  }
  return null;
}

/** The character on one side of a node, as `spacesAroundPill` reads it: a pill counts as a word, a line break as nothing. */
export function $edgeCharacter(node: LexicalNode | null, side: 'last' | 'first'): string {
  if ($isTextNode(node)) {
    const text = node.getTextContent();
    return (side === 'last' ? text.slice(-1) : text.slice(0, 1));
  }
  if ($isPromptReferenceNode(node)) return PILL_NEIGHBOR;
  return '';
}

/** Whether the selection's caret sits right beside this node, where moving it would change nothing. */
function $besideNode(selection: RangeSelection, node: LexicalNode): boolean {
  const { anchor } = selection;
  const point = anchor.getNode();
  if (anchor.type === 'element') {
    const index = node.getIndexWithinParent();
    return point.is(node.getParent()) && (anchor.offset === index || anchor.offset === index + 1);
  }
  return (point.is(node.getPreviousSibling()) && anchor.offset === point.getTextContentSize())
    || (point.is(node.getNextSibling()) && anchor.offset === 0);
}

/**
 * Moves a pill to a place in the text, in this update (so one undo puts it back).
 *
 * A new node goes in at the place and the old one leaves, rather than the node itself moving: the place is read from
 * the document before anything changes, and taking the node out first could shift it.
 */
function $movePill(key: NodeKey, place: DomPlace): void {
  const node = $getNodeByKey(key);
  if (!$isPromptReferenceNode(node)) return;
  const target = $createRangeSelection();
  const range = document.createRange();
  range.setStart(place.node, place.offset);
  range.collapse(true);
  target.applyDOMRange(range);
  if (target.anchor.key === 'root') {
    const last = $getRoot().getLastDescendant();
    if (!last) return;
    if ($isTextNode(last)) target.anchor.set(last.getKey(), last.getTextContentSize(), 'text');
    else target.anchor.set(last.getParentOrThrow().getKey(), last.getIndexWithinParent() + 1, 'element');
    target.focus.set(target.anchor.key, target.anchor.offset, target.anchor.type);
  }
  if ($besideNode(target, node)) return;

  const moved = $createPromptReferenceNode(node.getReference());
  $setSelection(target);
  target.insertNodes([moved]);

  /* where it was: one space left between the words, not two */
  const left = node.getPreviousSibling();
  const right = node.getNextSibling();
  node.remove();
  const leftEdge = $isLineBreakNode(left) ? '' : $edgeCharacter(left, 'last');
  if ($isTextNode(right) && dropSpaceAfterRemoval(leftEdge, $edgeCharacter(right, 'first'))) {
    const rest = right.getTextContent().slice(1);
    if (rest) right.setTextContent(rest);
    else right.remove();
  }

  /* where it went: apart from the words beside it */
  const before = moved.getPreviousSibling();
  const after = moved.getNextSibling();
  const spaces = spacesAroundPill($edgeCharacter(before, 'last'), $edgeCharacter(after, 'first'));
  if (spaces.before) moved.insertBefore($createTextNode(' '));
  if (spaces.after) moved.insertAfter($createTextNode(' '));
  moved.selectNext(spaces.after ? 1 : 0, spaces.after ? 1 : 0);
}

/**
 * Pills move within the sentence by dragging, as mentions do in Notion or Cursor: the browser's own drag and drop,
 * with the pill itself as the drag image and a caret where it will land. Text drags stay the browser's.
 *
 * `showsCaret` says which other drags land at the pointer too (files from Finder, things from Studio), so they show
 * the same caret while over the text; dropping them is the host's.
 */
export function MovePillsPlugin({ showsCaret }: { showsCaret?: (data: DataTransfer) => boolean }) {
  const [editor] = useLexicalComposerContext();
  const [caret, setCaret] = React.useState<{ left: number; top: number; height: number } | null>(null);
  const showsCaretRef = React.useRef(showsCaret);
  showsCaretRef.current = showsCaret;

  React.useEffect(() => {
    let dragged: NodeKey | null = null;
    const done = () => { dragged = null; setCaret(null); };
    const caretAt = (event: DragEvent) => {
      const root = editor.getRootElement();
      const place = root ? placeAtPoint(root, event.clientX, event.clientY) : null;
      setCaret(place ? caretBox(place) : null);
    };
    const leave = (event: DragEvent) => {
      const root = editor.getRootElement();
      if (!root?.contains(event.relatedTarget as Node | null)) setCaret(null);
    };
    return mergeRegister(
      editor.registerCommand(DRAGSTART_COMMAND, (event) => {
        const target = event.target instanceof Element ? event.target.closest('[data-lexical-decorator]') : null;
        const node = target ? $getNearestNodeFromDOMNode(target) : null;
        if (!target || !$isPromptReferenceNode(node) || !event.dataTransfer) return false;
        dragged = node.getKey();
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData(PILL_DRAG_TYPE, dragged);
        const box = target.getBoundingClientRect();
        event.dataTransfer.setDragImage(target, event.clientX - box.left, event.clientY - box.top);
        return true;
      }, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(DRAGOVER_COMMAND, (event) => {
        const data = event.dataTransfer;
        if (!data) return false;
        if (dragged && data.types.includes(PILL_DRAG_TYPE)) {
          event.preventDefault();
          data.dropEffect = 'move';
          caretAt(event);
          return true;
        }
        /* the host takes this drop (and says so to the browser); the caret only shows where it lands */
        if (showsCaretRef.current?.(data)) caretAt(event);
        return false;
      }, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(DROP_COMMAND, (event) => {
        setCaret(null);
        const key = dragged;
        if (!key || !event.dataTransfer?.types.includes(PILL_DRAG_TYPE)) return false;
        event.preventDefault();
        done();
        const root = editor.getRootElement();
        const place = root ? placeAtPoint(root, event.clientX, event.clientY) : null;
        if (place) $movePill(key, place);
        return true;
      }, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(DRAGEND_COMMAND, () => { done(); return false; }, COMMAND_PRIORITY_CRITICAL),
      editor.registerRootListener((root, previous) => {
        previous?.removeEventListener('dragleave', leave);
        root?.addEventListener('dragleave', leave);
      }),
    );
  }, [editor]);

  return caret ? createPortal(
    <div
      aria-hidden
      className="pointer-events-none fixed z-[1000] w-[2px] rounded-full bg-[var(--accent)]"
      style={{ left: caret.left - 1, top: caret.top, height: caret.height }}
    />,
    document.body,
  ) : null;
}
