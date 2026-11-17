/**
 * The community's kinds: one open list, shown once (the window's side, a card's foot, a filter). Code kinds, as the
 * agents' apps name them (a plugin: a workbench, a connection to a service, or both; a skill), land where they are used
 * outside the library; the library's own kinds (templates, text,
 * stickers…) land in its tabs and share their marks, so a sticker looks the same in the library and here. A new kind is
 * one more entry. See internal/community.md.
 */
import { Blocks, BookOpenText, Shapes, type LucideIcon } from 'lucide-react';
import type { LibraryCategory } from '@/lib/library';
import { CategoryIcon } from './library/icons';

export type CodeKind = 'plugins' | 'skills';
/** The library's kinds, its media (footage, pictures, sounds of any kind, packed) among them */
export type AssetKind = LibraryCategory | 'media';
export type FeatureKind = CodeKind | AssetKind;
export const CODE_KINDS: readonly CodeKind[] = ['plugins', 'skills'];
/** The library's kinds, in the order its tabs show them: the media first, as the library's first tab. */
export const ASSET_KINDS: readonly AssetKind[] = ['media', 'template', 'text', 'sticker', 'effect', 'transition', 'filter', 'sound', 'music'];
export const FEATURE_KINDS: readonly FeatureKind[] = [...CODE_KINDS, ...ASSET_KINDS];
export const isCodeKind = (kind: FeatureKind): kind is CodeKind => (CODE_KINDS as readonly string[]).includes(kind);

const CODE_ICONS: Record<CodeKind, LucideIcon> = { plugins: Blocks, skills: BookOpenText };
/** The community's own mark (the chat's button, the OpenFilm menu): things of many kinds that people make. */
export const COMMUNITY_ICON: LucideIcon = Shapes;

/** A kind's mark, at a size. */
export function KindIcon({ kind, size = 18 }: { kind: FeatureKind; size?: number }) {
  if (isCodeKind(kind)) { const Mark = CODE_ICONS[kind]; return <Mark size={size} strokeWidth={1.75} aria-hidden />; }
  return <CategoryIcon id={kind} on={false} size={size} />;
}
