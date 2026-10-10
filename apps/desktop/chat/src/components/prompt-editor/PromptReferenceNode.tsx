'use client';

import React from 'react';
import { X } from 'lucide-react';
import {
  $getNodeByKey,
  DecoratorNode,
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
 * A reference node: the caret cannot enter it, and one Backspace deletes it whole. It is
 * one indivisible thing in the document, not a few characters.
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
    dom.style.display = 'inline-flex';
    dom.style.verticalAlign = 'middle';
    return dom;
  }

  updateDOM(): false {
    return false;
  }

  isInline(): true {
    return true;
  }

  isKeyboardSelectable(): true {
    return true;
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
}

/* Pills render into the contentEditable through a portal, and context crosses portals,
   so callbacks come through context rather than node data (which must serialize). */
export const PromptReferenceContext =
  React.createContext<PromptReferencePillHandlers | null>(null);

function PromptReferencePill({
  nodeKey,
  reference,
}: {
  nodeKey: NodeKey;
  reference: PromptReference;
}) {
  const [editor] = useLexicalComposerContext();
  const handlers = React.useContext(PromptReferenceContext);
  /* Not every reference leads somewhere in the film: a file is on disk, with no moment or
     picture. Such pills drop the pointer cursor and hint, so they do not look clickable. */
  const reveal = canRevealPill(reference) ? handlers?.onReveal : undefined;

  return (
    <PromptPill
      reference={reference}
      card={handlers?.describe?.(reference) ?? null}
      {...(reveal && handlers?.revealLabel ? { hint: handlers.revealLabel } : {})}
      {...(reveal ? {
        onClick: (event: React.MouseEvent) => {
          event.preventDefault();
          reveal(reference);
        },
      } : {})}
      {...(reveal && handlers?.revealLabel ? { title: `${reference.label} · ${handlers.revealLabel}` } : {})}
      trailing={(
        <button
          type="button"
          aria-label={handlers?.removeLabel}
          /* Keep focus in the editor on mouse down, so typing continues after removing. */
          onMouseDown={(event) => event.preventDefault()}
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
