import React from 'react';
import { CheckSquare, Copy, FolderInput, FolderOpen, FolderSearch, Image, ImageOff, ImagePlus, ListX, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import { Tooltip } from './Tooltip';
import { useT } from '@/i18n';

/**
 * A project's "…" menu.
 *
 * Each item shows only when its callback is passed: the editor's title (a right click: `projectMenuItems`) passes
 * Rename, the current frame as the cover and Reveal in Finder; a card in the Projects popover passes Open /
 * Rename / Duplicate / Select / Move to folder / Change cover / Restore cover / Reveal / Delete, or Locate… and Remove from list
 * when the project's folder is gone. The order is fixed here, not by the props, so the same menu looks the same wherever it
 * appears. It is a ContextMenu hanging from the button: it flips above it near the bottom of the window, and Esc
 * closes only the menu.
 */
export function ProjectMenu({
  size = 18,
  className,
  ...actions
}: ProjectMenuActions & {
  size?: number;
  className?: string;
}) {
  const t = useT();
  const [anchor, setAnchor] = React.useState<{ x: number; y: number; top: number } | null>(null);
  const button = React.useRef<HTMLButtonElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setAnchor((cur) => (cur ? null : { x: r.right, y: r.bottom + 4, top: r.top - 4 }));
  };

  const entries = projectMenuItems(t, actions);

  return (
    <>
      {/* the menu opens downward, so the tooltip does too: the button usually sits at the top of the window or a card */}
      <Tooltip label={t('projectMenu.more')} side="bottom">
        <button
          ref={button}
          type="button"
          onClick={toggle}
          aria-expanded={anchor != null}
          aria-haspopup="menu"
          aria-label={t('projectMenu.more')}
          className={
            className ??
            'flex h-[26px] w-[26px] items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text)]'
          }
        >
          <MoreHorizontal size={size} />
        </button>
      </Tooltip>

      {anchor ? (
        <ContextMenu x={anchor.x} y={anchor.y} flipTo={anchor.top} align="end" trigger={button} items={entries} onClose={() => setAnchor(null)} />
      ) : null}
    </>
  );
}

/** What a project's menu does, each item passed or not shown. */
export interface ProjectMenuActions {
  /** Open the project. Clicking the cover is quicker, but only once you know the cover can be clicked. */
  onOpen?: () => void;
  onRename?: () => void;
  onDuplicate?: () => void;
  /** Enter multi-select with this item already ticked. */
  onSelect?: () => void;
  /** Pick a folder of the Projects list to put it in. */
  onMoveToFolder?: () => void;
  /** Pick a picture for the project's card. */
  onChangeCover?: () => void;
  /** The project has a cover of its own: back to the film's poster. */
  onRestoreCover?: () => void;
  /** The film as the viewer shows it now made the project's cover. */
  onCoverFromFrame?: () => void;
  /** Show the project's folder in Finder / Explorer. */
  onReveal?: () => void;
  /** Pick the folder a project whose folder is gone is in now. */
  onLocate?: () => void;
  /** Take it off the list (a project whose folder is gone: there is nothing to delete). */
  onRemove?: () => void;
  onDelete?: () => void;
}

/** The menu's items, in their fixed order: for the "…" button, and for a right click on the editor's title. */
export function projectMenuItems(t: ReturnType<typeof useT>, actions: ProjectMenuActions): ContextMenuEntry[] {
  const { onOpen, onRename, onDuplicate, onSelect, onMoveToFolder, onChangeCover, onRestoreCover, onCoverFromFrame, onReveal, onLocate, onRemove, onDelete } = actions;
  const entries: ContextMenuEntry[] = [];
  const add = (id: string, icon: React.ReactNode, label: string, run: (() => void) | undefined) => {
    if (run) entries.push({ id, icon, label, onSelect: run });
  };
  add('open', <FolderOpen size={15} />, t('projectMenu.open'), onOpen);
  add('rename', <Pencil size={15} />, t('projectMenu.rename'), onRename);
  add('duplicate', <Copy size={15} />, t('projectMenu.duplicate'), onDuplicate);
  add('select', <CheckSquare size={15} />, t('library.select'), onSelect);
  add('move', <FolderInput size={15} />, t('projects.moveToFolder'), onMoveToFolder);
  add('cover', <ImagePlus size={15} />, t('projects.changeCover'), onChangeCover);
  add('coverFrame', <Image size={15} />, t('projects.coverFromFrame'), onCoverFromFrame);
  add('coverReset', <ImageOff size={15} />, t('projects.restoreCover'), onRestoreCover);
  add('reveal', <FolderOpen size={15} />, t('projects.revealFolder'), onReveal);
  add('locate', <FolderSearch size={15} />, t('projects.locate'), onLocate);
  add('remove', <ListX size={15} />, t('projects.removeFromList'), onRemove);
  if (onDelete) {
    /* a separator only when something is above it */
    if (entries.length) entries.push({ id: 'sep', separator: true });
    entries.push({ id: 'delete', icon: <Trash2 size={15} />, label: t('projectMenu.delete'), danger: true, onSelect: onDelete });
  }
  return entries;
}
