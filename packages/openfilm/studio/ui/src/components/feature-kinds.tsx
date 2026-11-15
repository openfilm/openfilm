/**
 * The community's kinds: one open list, shown once (the window's side, a card's foot, a filter). Code kinds (a workbench,
 * a skill, a connector) land where they are used outside the library; the library's own kinds (templates, text,
 * stickers…) land in its tabs and share their marks, so a sticker looks the same in the library and here. A new kind is
 * one more entry. See internal/community.md.
 */
import { GraduationCap, Plug, Shapes, SquareMousePointer, type LucideIcon } from 'lucide-react';
import type { LibraryCategory } from '@/lib/library';
import { CategoryIcon } from './library/icons';

export type CodeKind = 'workbenches' | 'skills' | 'connectors';
export type FeatureKind = CodeKind | LibraryCategory;
export const CODE_KINDS: readonly CodeKind[] = ['workbenches', 'skills', 'connectors'];
/** The library's kinds, in the order its tabs show them. */
export const ASSET_KINDS: readonly LibraryCategory[] = ['template', 'text', 'sticker', 'effect', 'transition', 'filter', 'sound', 'music'];
export const FEATURE_KINDS: readonly FeatureKind[] = [...CODE_KINDS, ...ASSET_KINDS];
export const isCodeKind = (kind: FeatureKind): kind is CodeKind => (CODE_KINDS as readonly string[]).includes(kind);

const CODE_ICONS: Record<CodeKind, LucideIcon> = { workbenches: SquareMousePointer, skills: GraduationCap, connectors: Plug };
/** The community's own mark (the chat's button, the OpenFilm menu): things of many kinds that people make. */
export const COMMUNITY_ICON: LucideIcon = Shapes;

/** A kind's mark, at a size. */
export function KindIcon({ kind, size = 18 }: { kind: FeatureKind; size?: number }) {
  if (isCodeKind(kind)) { const Mark = CODE_ICONS[kind]; return <Mark size={size} strokeWidth={1.75} aria-hidden />; }
  return <CategoryIcon id={kind} on={false} size={size} />;
}
