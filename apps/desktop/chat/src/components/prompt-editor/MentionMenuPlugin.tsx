'use client';

/**
 * Type `@` in the sentence to pick something and insert it.
 *
 * The host's providers decide what can be picked (see mention-menu). This plugin
 * recognizes the `@`, places the menu above the composer, and replaces the typed `@xxx`
 * with a pill.
 *
 * Built on Lexical's LexicalTypeaheadMenuPlugin, which handles anchoring, repositioning
 * on scroll, arrow keys and Enter. Only the trigger is our own: Lexical's requires
 * whitespace or line start before `@`, which does not work in text without spaces
 * (Chinese, Japanese).
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { useChatMenu } from '@/lib/chat-menu';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
  type MenuTextMatch,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import {
  $createTextNode,
  $insertNodes,
  COMMAND_PRIORITY_CRITICAL,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
  type TextNode,
} from 'lexical';
import { FileText, Image as ImageIcon, Music, Video } from 'lucide-react';
import { PILL_ICON } from './PromptPill';
import { $createPromptReferenceNode } from './PromptReferenceNode';
import {
  buildMentionMenu,
  matchMentionTrigger,
  type MentionEntry,
  type MentionProvider,
} from './mention-menu';
import { chatLayer } from '@/lib/chat-layer';

export interface MentionMenuConfig {
  /** What `@` can pick, in menu group order. */
  providers: MentionProvider[];
  /** The menu's accessible name (it is a listbox). */
  label: string;
  /**
   * Called when the menu opens.
   *
   * The file list is fetched only then: most sessions never mention a file.
   */
  onOpen?: () => void;
}

/** Lexical requires options to subclass MenuOption (it attaches a ref for scrolling). */
class MentionMenuOption extends MenuOption {
  readonly entry: MentionEntry;

  constructor(entry: MentionEntry) {
    super(entry.item.id);
    this.entry = entry;
  }
}

export function MentionMenuPlugin({ providers, label, onOpen }: MentionMenuConfig) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = React.useState('');

  const options = React.useMemo(
    () => buildMentionMenu(providers, query).map((entry) => new MentionMenuOption(entry)),
    [providers, query],
  );

  /* These callbacks must be stable. The host re-renders often (20 times a second during
     playback) and Lexical uses them as effect dependencies, so new functions would
     re-subscribe every render. The trigger likewise depends only on the typed text, not
     on a new providers array. */
  const providersRef = React.useRef(providers);
  providersRef.current = providers;
  const onOpenRef = React.useRef(onOpen);
  onOpenRef.current = onOpen;
  const handleOpen = React.useCallback(() => onOpenRef.current?.(), []);
  const handleQueryChange = React.useCallback((value: string | null) => setQuery(value ?? ''), []);

  const triggerFn = React.useCallback((text: string): MenuTextMatch | null => {
    const trigger = matchMentionTrigger(text);
    if (!trigger) return null;
    /* No matches, no menu: an open menu takes the arrow keys, so an empty one would lock
       them while the user probably wants to move the caret. */
    if (buildMentionMenu(providersRef.current, trigger.query).length === 0) return null;
    return {
      leadOffset: trigger.leadOffset,
      matchingString: trigger.query,
      replaceableString: trigger.replaceableString,
    };
  }, []);

  const onSelectOption = React.useCallback(
    (option: MentionMenuOption, nodeToReplace: TextNode | null, closeMenu: () => void) => {
      const { item } = option.entry;
      const picked = item.disabled ? null : item.select();
      const references = picked ? [picked].flat() : [];
      /* A disabled item yields nothing, but the menu still closes: an open menu takes
         Enter, so the next Enter would not send. Same when select() returns nothing
         (too many references). */
      if (!references.length) {
        closeMenu();
        return;
      }
      editor.update(() => {
        /* A space after each pill: the caret cannot enter a pill, so the next typed text
           needs somewhere to go apart from it. */
        const nodes = references.flatMap((reference) => [$createPromptReferenceNode(reference), $createTextNode(' ')]);
        // nodeToReplace is the typed `@xxx`; without it, insert at the caret.
        if (nodeToReplace) {
          nodeToReplace.replace(nodes[0]!);
          let last = nodes[0]!;
          for (const node of nodes.slice(1)) { last.insertAfter(node); last = node; }
        } else $insertNodes(nodes);
        (nodes.at(-1) as TextNode).select();
        closeMenu();
      });
      keepCaretInComposer(editor);
    },
    [editor],
  );

  return (
    <LexicalTypeaheadMenuPlugin<MentionMenuOption>
      options={options}
      onQueryChange={handleQueryChange}
      onSelectOption={onSelectOption}
      onOpen={handleOpen}
      triggerFn={triggerFn}
      /* The menu must get Enter first: the composer's Enter-to-send is HIGH, so without
         CRITICAL, Enter with the menu open would send the unfinished message. */
      commandPriority={COMMAND_PRIORITY_CRITICAL}
      menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => (
        anchorRef.current && options.length > 0 && typeof document !== 'undefined'
          ? createPortal(
            <MentionMenu
              label={label}
              options={options}
              selectedIndex={selectedIndex}
              onPick={selectOptionAndCleanUp}
              onHighlight={setHighlightedIndex}
              shell={composerShell(editor.getRootElement())}
              editorRoot={editor.getRootElement()}
              onDismiss={() => editor.dispatchCommand(KEY_ESCAPE_COMMAND, new KeyboardEvent('keydown', { key: 'Escape' }))}
            />,
            chatLayer(),
          )
          : null
      )}
    />
  );
}

/**
 * After a pick (Enter, Tab or click), the caret must stay in the composer, after the
 * pill's space.
 *
 * The pick also re-renders the host, unmounts the menu and mounts the pill's remove
 * button. If any of that takes focus, the next keystrokes go to the page as editor
 * shortcuts. So once the frame settles, focus returns if it left; Lexical's focus
 * restores the stored selection, which is right after the pill.
 */
function keepCaretInComposer(editor: LexicalEditor): void {
  if (typeof window === 'undefined') return;
  window.requestAnimationFrame(() => {
    const root = editor.getRootElement();
    if (!root?.isConnected || !editor.isEditable()) return;
    if (root.ownerDocument.activeElement === root) return;
    editor.focus();
  });
}

/** The box the menu aligns to: the host's `data-prompt-shell`, or else the editor's parent. */
function composerShell(root: HTMLElement | null): HTMLElement | null {
  if (!root) return null;
  return root.closest<HTMLElement>('[data-prompt-shell]') ?? root.parentElement ?? root;
}

/** A file's broad type from its extension, only to pick an icon, so images and audio look different. */
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|svg|heic|bmp)$/i;
const VIDEO_EXT = /\.(mp4|mov|webm|m4v|mkv|avi)$/i;
const AUDIO_EXT = /\.(mp3|wav|m4a|aac|ogg|flac|opus)$/i;
function fileIcon(label: string): React.ComponentType<{ size?: number; className?: string }> {
  if (IMAGE_EXT.test(label)) return ImageIcon;
  if (VIDEO_EXT.test(label)) return Video;
  if (AUDIO_EXT.test(label)) return Music;
  return FileText;
}

/**
 * The menu.
 *
 * Placed above the whole composer, left-aligned and as wide (at most 360), not at the
 * caret, where it would cover the text just typed. Below only when there is no room
 * above. A click anywhere outside the menu and the editor closes it, since an open menu
 * takes the arrow keys and Enter.
 */
function MentionMenu({
  label,
  options,
  selectedIndex,
  onPick,
  onHighlight,
  shell,
  editorRoot,
  onDismiss,
}: {
  label: string;
  options: MentionMenuOption[];
  selectedIndex: number | null;
  onPick: (option: MentionMenuOption) => void;
  onHighlight: (index: number) => void;
  shell: HTMLElement | null;
  editorRoot: HTMLElement | null;
  onDismiss: () => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [style, setStyle] = React.useState<React.CSSProperties | null>(null);
  useChatMenu(true);

  React.useLayoutEffect(() => {
    if (!shell) return undefined;
    const place = () => {
      const r = shell.getBoundingClientRect();
      const width = Math.min(360, Math.max(260, r.width));
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const gap = 8;
      const roomAbove = r.top - gap - 8;
      const roomBelow = window.innerHeight - r.bottom - gap - 8;
      const up = roomAbove >= Math.min(320, roomBelow) || roomAbove >= 200;
      setStyle({
        position: 'fixed',
        left,
        width,
        maxHeight: Math.max(160, Math.min(340, up ? roomAbove : roomBelow)),
        ...(up ? { bottom: window.innerHeight - r.top + gap } : { top: r.bottom + gap }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [shell]);

  /* Capture phase: some elements stop pointerdown before it bubbles to window. A click
     into an iframe sends no event but blurs the window, which also counts as outside. */
  const dismissRef = React.useRef(onDismiss);
  dismissRef.current = onDismiss;
  React.useEffect(() => {
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || editorRoot?.contains(target)) return;
      dismissRef.current();
    };
    const blur = () => dismissRef.current();
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('blur', blur);
    };
  }, [editorRoot]);

  if (!style) return null;
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={label}
      /* Marks the open mention menu. */
      data-prompt-menu=""
      style={style}
      className="z-[10000] flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--surface)] shadow-[0_18px_48px_-12px_rgba(0,0,0,0.45),0_2px_8px_rgba(0,0,0,0.12)]"
    >
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-1.5">
        {options.map((option, index) => {
          const { item, groupLabel, firstOfGroup } = option.entry;
          const Icon = item.kind === 'file' ? fileIcon(item.label) : PILL_ICON[item.kind];
          const selected = index === selectedIndex;
          return (
            <React.Fragment key={option.key}>
              {firstOfGroup ? (
                <div
                  role="presentation"
                  className={`px-2 pb-1 text-[11px] font-medium text-[var(--text-faint)] ${index === 0 ? 'pt-1' : 'mt-1 border-t border-[var(--border)] pt-2.5'}`}
                >
                  {groupLabel}
                </div>
              ) : null}
              <div
                role="option"
                /* Lexical points aria-activedescendant at this id (its own renderer uses
                   the same scheme), so screen readers follow the keyboard selection. */
                id={`typeahead-item-${index}`}
                aria-selected={selected}
                aria-disabled={item.disabled ? true : undefined}
                ref={option.setRefElement}
                onMouseEnter={() => onHighlight(index)}
                /* Keep focus in the editor on mouse down, so typing continues after the pick. */
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onPick(option)}
                className={`flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] ${
                  item.disabled
                    ? 'cursor-not-allowed opacity-50'
                    : `cursor-pointer ${selected ? 'bg-[var(--bg-hover)]' : ''}`
                }`}
              >
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${selected && !item.disabled ? 'bg-[var(--surface)] text-[var(--text)]' : 'bg-[var(--surface-2)] text-[var(--text-muted)]'}`}>
                  <Icon size={13} />
                </span>
                {/* A disabled item keeps its full name and the hint shrinks instead. */}
                <span className={`truncate text-[var(--text)] ${item.disabled ? 'shrink-0' : 'min-w-0 flex-1'}`}>{item.label}</span>
                {/* Disabled: why. Otherwise: the file size or timecode. */}
                {item.disabled && item.disabledHint ? (
                  <span className="min-w-0 flex-1 truncate text-right text-[11px] text-[var(--text-faint)]" title={item.disabledHint}>
                    {item.disabledHint}
                  </span>
                ) : item.detail ? (
                  <span className="shrink-0 tabular-nums text-[11.5px] text-[var(--text-faint)]">
                    {item.detail}
                  </span>
                ) : null}
              </div>
            </React.Fragment>
          );
        })}
      </div>
      {/* Key hints: the menu is keyboard-first */}
      <div aria-hidden className="flex shrink-0 items-center gap-3 border-t border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-faint)]">
        <span><Kbd>↑</Kbd><Kbd>↓</Kbd></span>
        <span><Kbd>↵</Kbd></span>
        <span className="ml-auto"><Kbd>esc</Kbd></span>
      </div>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mr-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded border border-[var(--border)] bg-[var(--surface-2)] px-1 font-sans text-[10.5px] text-[var(--text-muted)]">
      {children}
    </kbd>
  );
}
