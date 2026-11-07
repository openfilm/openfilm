'use client';

import React from 'react';
import { X } from 'lucide-react';
import {
  $getNodeByKey,
  $getSelection,
  $setSelection,
  DecoratorNode,
  type BaseSelection,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from 'lexical';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { canRevealPill, PromptPill, type PromptPillCard } from './PromptPill';
import { promptReferenceToken, type PromptReference } from './prompt-text';

type SerializedPromptReferenceNode = Spread<
  { reference: PromptReference },
  SerializedLexicalNode
>;

/**
 * A reference node: the caret cannot enter it, an arrow key steps over it, and one
 * Backspace deletes it whole. It is one indivisible thing in the document, not a few
 * characters.
 */
export class PromptReferenceNode extends DecoratorNode<React.JSX.Element> {
  __reference: PromptReference;

  static getType(): string {
    return 'prompt-reference';
  }

  static clone(node: PromptReferenceNode): PromptReferenceNode {
    return new PromptReferenceNode(node.__reference, node.__key);
  }

  static importJSON(json: SerializedPromptReferenceNode): PromptReferenceNode {
    return $createPromptReferenceNode(json.reference);
  }

  constructor(reference: PromptReference, key?: NodeKey) {
    super(key);
    this.__reference = reference;
  }

  exportJSON(): SerializedPromptReferenceNode {
    return { ...super.exportJSON(), reference: this.__reference };
  }

  createDOM(): HTMLElement {
    const dom = document.createElement('span');
    /* Dragged to move it within the sentence (MovePillsPlugin); not editable, or the browser would not drag it. */
    dom.draggable = true;
    dom.contentEditable = 'false';
    dom.style.display = 'inline-flex';
    dom.style.verticalAlign = 'middle';
    /* Room on each side, outside this box: a click there is in the text (the caret goes
       beside the pill), where a click on the box itself puts the caret at the start. */
    dom.style.margin = '0 2px';
    return dom;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  /* Not selectable by the arrow keys: selected, a pill shows nothing and swallows what is
     typed next. The caret goes past it instead, to the text on its other side. */
  isKeyboardSelectable(): false {
    return false;
  }

  /* As plain text it is a marker, so the document's getTextContent() is the string the
     host stores and restores from, with no separate text-and-positions bookkeeping. */
  getTextContent(): string {
    return promptReferenceToken(this.__reference.id);
  }

  getReference(): PromptReference {
    return this.__reference;
  }

  decorate(): React.JSX.Element {
    return <PromptReferencePill nodeKey={this.getKey()} reference={this.__reference} />;
  }
}

export function $createPromptReferenceNode(reference: PromptReference): PromptReferenceNode {
  return new PromptReferenceNode(reference);
}

export function $isPromptReferenceNode(
  node: LexicalNode | null | undefined,
): node is PromptReferenceNode {
  return node instanceof PromptReferenceNode;
}

interface PromptReferencePillHandlers {
  /** Clicking the reference: for example, seek to its moment and light up the marked area. */
  onReveal?: (reference: PromptReference) => void;
  revealLabel?: string;
  removeLabel: string;
  /** What the hover card says. */
  describe?: (reference: PromptReference) => PromptPillCard | null;
  /** The pill as the host has it now (a file's thumbnail comes in after the pill is in the sentence). */
  lookup?: (id: string) => PromptReference | undefined;
  /** A pill whose thing is not ready yet, or could not be had: a file still on its way, or one that failed. */
  pillState?: (reference: PromptReference) => 'pending' | 'failed' | null;
  /** Pills that open when clicked (to look at a file brought in) rather than lead somewhere in the film. */
  opens?: (reference: PromptReference) => boolean;
}

/* Pills render into the contentEditable through a portal, and context crosses portals,
   so callbacks come through context rather than node data (which must serialize). */
export const PromptReferenceContext =
  React.createContext<PromptReferencePillHandlers | null>(null);

function PromptReferencePill({
  nodeKey,
  reference: inserted,
}: {
  nodeKey: NodeKey;
  reference: PromptReference;
}) {
  const [editor] = useLexicalComposerContext();
  const handlers = React.useContext(PromptReferenceContext);
  const reference = handlers?.lookup?.(inserted.id) ?? inserted;
  const opens = handlers?.opens?.(reference) ?? false;
  /* Not every reference leads somewhere in the film: a file is on disk, with no moment or
     picture. Such pills drop the pointer cursor and hint, so they do not look clickable. */
  const reveal = canRevealPill(reference) || opens ? handlers?.onReveal : undefined;
  const revealLabel = opens ? undefined : handlers?.revealLabel;
  const state = handlers?.pillState?.(reference) ?? null;
  /* A press may start a drag (the browser's, so it is not held back), and a click on the pill goes where it points
     with the caret where it was: the press remembers the caret, and the click puts it back. */
  const before = React.useRef<{ selection: BaseSelection | null; focused: Element | null } | null>(null);
  const restore = () => {
    const was = before.current;
    before.current = null;
    if (!was) return;
    const root = editor.getRootElement();
    if (!root?.contains(was.focused)) {
      /* the focus was elsewhere: it goes back there */
      editor.blur();
      if (was.focused instanceof HTMLElement && was.focused !== document.body) was.focused.focus({ preventScroll: true });
      return;
    }
    editor.update(() => {
      const selection = was.selection?.clone() ?? null;
      /* The editor has not read the click's caret yet, so the one it holds looks unchanged: marked dirty, the page's
         caret is set back to it too. */
      if (selection) selection.dirty = true;
      $setSelection(selection);
    });
  };

  return (
    <PromptPill
      reference={reference}
      {...(state ? { state } : {})}
      card={handlers?.describe?.(reference) ?? null}
      onMouseDown={(event: React.MouseEvent) => {
        if (event.button !== 0) return;
        before.current = {
          selection: editor.getEditorState().read(() => $getSelection()?.clone() ?? null),
          focused: document.activeElement,
        };
      }}
      {...(reveal && revealLabel ? { hint: revealLabel } : {})}
      onClick={(event: React.MouseEvent) => {
        event.preventDefault();
        restore();
        reveal?.(reference);
      }}
      clickable={Boolean(reveal)}
      {...(reveal && revealLabel ? { title: `${reference.label} · ${revealLabel}` } : {})}
      trailing={(
        <button
          type="button"
          aria-label={handlers?.removeLabel}
          /* Keep focus in the editor on mouse down, so typing continues after removing. */
          onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            editor.update(() => {
              $getNodeByKey(nodeKey)?.remove();
            });
          }}
          className="flex h-[1.05em] w-[1.05em] shrink-0 items-center justify-center rounded-[4px] text-[var(--text-faint)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
        >
          <X size={10} />
        </button>
      )}
    />
  );
}
