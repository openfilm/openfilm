/**
 * The marks of Features (components/PluginsWindow): its own (the chat's button, the OpenFilm menu), and each kind's,
 * the same wherever the kind is named (the side, a card's foot, a page).
 */
import { Blocks, GraduationCap, Plug, SquareMousePointer, type LucideIcon } from 'lucide-react';

export type FeatureKind = 'workbenches' | 'skills' | 'connectors';
export const FEATURE_KINDS: readonly FeatureKind[] = ['workbenches', 'skills', 'connectors'];
export const KIND_ICONS: Record<FeatureKind, LucideIcon> = { workbenches: SquareMousePointer, skills: GraduationCap, connectors: Plug };
export const FEATURES_ICON: LucideIcon = Blocks;
