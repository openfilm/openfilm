'use client';

import React from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { PlainTextPlugin } from '@lexical/react/LexicalPlainTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  $isTextNode,
  $nodesOfType,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  DROP_COMMAND,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  type EditorState,
  type LexicalEditor,
} from 'lexical';
import { filesFromTransfer } from '@/lib/composer-attachments';
import {
  $createPromptReferenceNode,
  PromptReferenceContext,
  PromptReferenceNode,
} from './PromptReferenceNode';
import { MentionMenuPlugin, type MentionMenuConfig } from './MentionMenuPlugin';
import type { PromptPillCard } from './PromptPill';
import {
  collectPromptReferences,
  splitPromptReferenceText,
  type PromptReference,
} from './prompt-text';

export interface PromptEditorState {
  /** The text with reference markers; the host stores it as is and can restore the exact same input from it. */
  text: string;
  /** The references still in the text, in order; a deleted pill no longer appears here. */
  references: PromptReference[];
}

export interface PromptEditorHandle {
  focus: () => void;
  /** Inserts a reference at the caret, or at the end if the editor was never focused. */
  insertReference: (reference: PromptReference) => void;
  /**
   * Inserts several, separated by spaces. With `point` (the drop position, in window
   * coordinates) they land at the text there; off the text, they go to the caret.
   */
  insertReferences: (references: PromptReference[], point?: { x: number; y: number }) => void;
  /** Removes every pill with this id (and the space inserted after it); does nothing if there is none. */
  removeReference: (id: string) => void;
  /** Inserts ready-made text at the caret, or at the end if the editor was never focused. */
  insertText: (text: string) => void;
  /** Replaces everything with this text (with markers); pass an empty string to clear. */
  setText: (text: string) => void;
  clear: () => void;
}

export interface PromptEditorProps {
  /**
   * The initial draft, read once on mount.
   *
   * The editor is not controlled: pushing the text back on every render would overwrite
   * keystrokes typed faster than React renders and jump the caret to the end. Use
   * setText to change the content programmatically.
   */
  defaultValue: string;
  references: PromptReference[];
  onChange: (state: PromptEditorState) => void;
  onSubmit?: () => void;
  /**
   * Receives pasted files (a screenshot, a file copied in Finder); without it, a paste is
   * handled as usual.
   *
   * Drops do not come here: the host handles them on the whole composer card.
   */
  onPasteFiles?: (files: File[]) => void;
  /**
   * Returns the pills for references found in a paste or a drop on the text (such as a
   * clip dragged from Studio), inserted at the caret or the drop point; null handles the
   * paste or drop as usual.
   */
  onTransferReferences?: (data: DataTransfer) => PromptReference[] | null;
  /** What a pill's hover card says; without it there is only the native title. */
  describe?: (reference: PromptReference) => PromptPillCard | null;
  /** What clicking a pill does; without it, pills are not clickable. */
  onReveal?: (reference: PromptReference) => void;
  revealLabel?: string;
  removeLabel: string;
  placeholder: string;
  ariaLabel?: string;
  minHeight: number;
  maxHeight: number;
  /** Typography of the text area (size, line height, padding). */
  contentClassName: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** What `@` can pick; without it there is no `@` menu. */
  mentions?: MentionMenuConfig;
}

/**
 * The prompt input.
 *
 * A contentEditable, not a textarea, because references sit inline in the sentence as
 * pills with icons ("make [Title] blue"). Lexical handles the document model, IME
 * composition, selection and undo.
 *
 * To the host it is still one string: a reference is an invisible marker in it.
 */
export const PromptEditor = React.forwardRef<PromptEditorHandle, PromptEditorProps>(
  function PromptEditor(props, ref) {
    const {
      defaultValue,
      references,
      onChange,
      onSubmit,
      onPasteFiles,
      onTransferReferences,
      describe,
      onReveal,
      revealLabel,
      removeLabel,
      placeholder,
      ariaLabel,
      minHeight,
      maxHeight,
      contentClassName,
      autoFocus,
      disabled,
      mentions,
    } = props;

    const lookup = React.useMemo(() => {
      const map = new Map(references.map((item) => [item.id, item]));
      return (id: string) => map.get(id);
    }, [references]);
    /* Rebuilding the document reads the current references, but a new references object must not trigger a rebuild. */
    const lookupRef = React.useRef(lookup);
    lookupRef.current = lookup;

    const handlers = React.useMemo(
      () => ({
        ...(onReveal ? { onReveal } : {}),
        ...(revealLabel ? { revealLabel } : {}),
        ...(describe ? { describe } : {}),
        removeLabel,
      }),
      [onReveal, removeLabel, revealLabel, describe],
    );

    const initialConfig = React.useMemo(
      () => ({
        namespace: 'openfilm-prompt',
        nodes: [PromptReferenceNode],
        editable: !disabled,
        onError: (error: Error) => {
          throw error;
        },
        /* Render the draft on the first frame, so the caret does not jump after mount.
           No selection here: it would steal focus from where the user is looking. */
        editorState: () => $renderValue(defaultValue, lookupRef.current, false),
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    );

    return (
      <LexicalComposer initialConfig={initialConfig}>
        <PromptReferenceContext.Provider value={handlers}>
          <div className="relative" style={{ minHeight, maxHeight, overflowY: 'auto' }}>
            <PlainTextPlugin
              contentEditable={
                <ContentEditable
                  /* Marks the composer, so the app (⌘L) and the bench can find it. */
                  data-prompt-editor=""
                  aria-label={ariaLabel ?? placeholder}
                  aria-placeholder={placeholder}
                  className={`w-full whitespace-pre-wrap break-words outline-none ${contentClassName}`}
                  style={{ minHeight }}
                  placeholder={
                    /* One line, truncated. The placeholder is absolutely positioned and cannot
                       grow the box, so a wrapped second line would be clipped and add a scrollbar. */
                    <div
                      className={`pointer-events-none absolute left-0 top-0 w-full select-none truncate text-[var(--text-faint)] ${contentClassName}`}
                    >
                      {placeholder}
                    </div>
                  }
                />
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
          </div>
          <HistoryPlugin />
          <SubmitPlugin onSubmit={onSubmit} />
          <TransferReferencesPlugin onTransferReferences={onTransferReferences} />
          <PasteFilesPlugin onPasteFiles={onPasteFiles} />
          <EditablePlugin editable={!disabled} />
          <ChangePlugin onChange={onChange} lookup={lookup} />
          <HandlePlugin ref={ref} lookupRef={lookupRef} autoFocus={autoFocus} />
          {mentions ? <MentionMenuPlugin {...mentions} /> : null}
        </PromptReferenceContext.Provider>
      </LexicalComposer>
    );
  },
);

/** Renders a string with markers as a document: one paragraph, newlines as LineBreak nodes, so the text read back is exactly what went in. */
function $renderValue(
  value: string,
  lookup: (id: string) => PromptReference | undefined,
  select: boolean,
): void {
  const root = $getRoot();
  root.clear();
  const paragraph = $createParagraphNode();
  for (const segment of splitPromptReferenceText(value)) {
    if (segment.kind === 'reference') {
      const reference = lookup(segment.id);
      /* Drop unknown markers rather than show an empty pill that points at nothing. */
      if (reference) paragraph.append($createPromptReferenceNode(reference));
      continue;
    }
    const lines = segment.value.split('\n');
    lines.forEach((line, index) => {
      if (index > 0) paragraph.append($createLineBreakNode());
      if (line) paragraph.append($createTextNode(line));
    });
  }
  root.append(paragraph);
  if (select) paragraph.selectEnd();
}

/**
 * Reports the document to the host.
 *
 * Once on mount, since a restored draft may already hold references, then on every real
 * change; moving the caret is not a change.
 */
function ChangePlugin({
  onChange,
  lookup,
}: {
  onChange: (state: PromptEditorState) => void;
  lookup: (id: string) => PromptReference | undefined;
}) {
  const [editor] = useLexicalComposerContext();
  /* The host passes a new function on each render; a ref keeps the subscription stable. */
  const onChangeRef = React.useRef(onChange);
  onChangeRef.current = onChange;

  const emit = React.useCallback((state: EditorState) => {
    const text = state.read(() => $getRoot().getTextContent());
    onChangeRef.current({ text, references: collectPromptReferences(text, lookup) });
  }, [lookup]);
  const emitRef = React.useRef(emit);
  emitRef.current = emit;

  /**
   * Reports again when the references change.
   *
   * A pill lands in two steps: the host adds it to the references, then inserts it. The
   * insert reports before React has rendered the new references, so that report misses
   * the new pill; without a second report, sending before the next keystroke would drop it.
   */
  React.useEffect(() => {
    emit(editor.getEditorState());
  }, [editor, emit]);

  React.useEffect(() => (
    editor.registerUpdateListener(({ editorState, dirtyElements, dirtyLeaves }) => {
      if (dirtyElements.size === 0 && dirtyLeaves.size === 0) return;
      emitRef.current(editorState);
    })
  ), [editor]);

  return null;
}

/** Enter sends, Shift+Enter breaks the line; during IME composition Enter is left alone, since it picks a candidate. */
function SubmitPlugin({ onSubmit }: { onSubmit?: () => void }) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    if (!onSubmit) return;
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (!event || event.shiftKey || event.isComposing || editor.isComposing()) return false;
        event.preventDefault();
        onSubmit();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onSubmit]);

  return null;
}

/**
 * A pasted screenshot becomes an attachment.
 *
 * Without this, pasting an image into a contentEditable either inserts an <img> (which
 * Lexical's plain-text mode drops) or does nothing.
 *
 * The priority must beat Lexical's own paste handler (COMMAND_PRIORITY_EDITOR), or the
 * paste is handled as text first.
 */
function PasteFilesPlugin({ onPasteFiles }: { onPasteFiles?: (files: File[]) => void }) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    if (!onPasteFiles) return;
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) return false;
        /* If there is text, the paste is text. Copying from Excel, Word or a web page often
           puts an image on the clipboard too, and attaching it was not asked for. */
        if (event.clipboardData?.getData('text/plain')) return false;
        const files = filesFromTransfer(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        onPasteFiles(files);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onPasteFiles]);

  return null;
}

/**
 * Inserts references into the sentence, each followed by a space, as the `@` menu does.
 *
 * `point` is the drop position. If it falls in the text, the caret moves there first;
 * otherwise (on a pill, on the card's empty space, or a DOM position that does not map
 * back) they go to the caret, or the end if the editor was never focused.
 */
function insertReferencesAt(
  editor: LexicalEditor,
  references: PromptReference[],
  point?: { x: number; y: number },
): void {
  if (!references.length) return;
  editor.update(() => {
    const root = editor.getRootElement();
    const range = point && root ? document.caretRangeFromPoint(point.x, point.y) : null;
    if (range && root?.contains(range.startContainer)) {
      const dropped = $createRangeSelection();
      dropped.applyDOMRange(range);
      if (dropped.anchor.key !== 'root') $setSelection(dropped);
    }
    if (!$isRangeSelection($getSelection())) $getRoot().selectEnd();
    $insertNodes(references.flatMap((reference) => [$createPromptReferenceNode(reference), $createTextNode(' ')]));
  });
  editor.focus();
}

/**
 * Things from Studio pasted or dropped on the text become pills, not a string of JSON.
 *
 * The priority beats Lexical's paste and drop (which would insert the `text/plain` of the
 * same data) and the file paste above: recognized references win.
 */
function TransferReferencesPlugin({
  onTransferReferences,
}: {
  onTransferReferences?: (data: DataTransfer) => PromptReference[] | null;
}) {
  const [editor] = useLexicalComposerContext();

  React.useEffect(() => {
    if (!onTransferReferences) return;
    const take = (event: ClipboardEvent | DragEvent, data: DataTransfer | null) => {
      const references = data ? onTransferReferences(data) : null;
      if (!references?.length) return false;
      event.preventDefault();
      insertReferencesAt(editor, references, 'clientX' in event ? { x: event.clientX, y: event.clientY } : undefined);
      return true;
    };
    const stopPaste = editor.registerCommand(
      PASTE_COMMAND,
      (event) => event instanceof ClipboardEvent && take(event, event.clipboardData),
      COMMAND_PRIORITY_CRITICAL,
    );
    const stopDrop = editor.registerCommand(DROP_COMMAND, (event) => take(event, event.dataTransfer), COMMAND_PRIORITY_CRITICAL);
    return () => { stopPaste(); stopDrop(); };
  }, [editor, onTransferReferences]);

  return null;
}

function EditablePlugin({ editable }: { editable: boolean }) {
  const [editor] = useLexicalComposerContext();
  React.useEffect(() => {
    editor.setEditable(editable);
  }, [editable, editor]);
  return null;
}

const HandlePlugin = React.forwardRef<
  PromptEditorHandle,
  {
    lookupRef: React.RefObject<(id: string) => PromptReference | undefined>;
    autoFocus?: boolean;
  }
>(
  function HandlePlugin({ lookupRef, autoFocus }, ref) {
    const [editor] = useLexicalComposerContext();

    React.useImperativeHandle(ref, () => ({
      focus: () => editor.focus(),
      setText: (text) => {
        editor.update(() => $renderValue(text, lookupRef.current, true));
      },
      clear: () => {
        editor.update(() => $renderValue('', lookupRef.current, true));
      },
      /* Never focused: insert at the end, since the user may be pointing at something
         elsewhere. A space follows, so the pill and the next typed text stay apart. */
      insertReference: (reference) => insertReferencesAt(editor, [reference]),
      insertReferences: (references, point) => insertReferencesAt(editor, references, point),
      removeReference: (id) => {
        editor.update(() => {
          for (const node of $nodesOfType(PromptReferenceNode)) {
            if (node.getReference().id !== id) continue;
            /* Remove the space inserted after it too; only one, since any further
               spaces were typed by the user. */
            const next = node.getNextSibling();
            if ($isTextNode(next) && next.getTextContent().startsWith(' ')) {
              const rest = next.getTextContent().slice(1);
              if (rest) next.setTextContent(rest);
              else next.remove();
            }
            node.remove();
          }
        });
      },
      insertText: (text) => {
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) $getRoot().selectEnd();
          $insertNodes([$createTextNode(text)]);
        });
        editor.focus();
      },
    }), [editor, lookupRef]);

    React.useEffect(() => {
      if (autoFocus) editor.focus();
      // Focus once, on mount only.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return null;
  },
);
