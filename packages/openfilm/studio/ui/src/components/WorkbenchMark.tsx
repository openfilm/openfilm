/**
 * A workbench's app icon (components/AppIcon): the picture its folder brings (OpenFilm's own and anyone's alike), else
 * the default for a workbench.
 */
import { AudioLines, Box, Clapperboard, Film, FolderOpen, Layers, Palette, Projector, Scissors, Spline, Workflow, type LucideIcon } from 'lucide-react';
import type { Plugin } from '@/lib/plugins';
import { AppIcon } from './AppIcon';

/** The marks a plugin's `icon` names (openfilm.json), drawn where a line of text needs one (a top bar's tool). */
export const PLUGIN_ICONS: Record<string, LucideIcon> = {
  film: Film, folder: FolderOpen, scissors: Scissors, workflow: Workflow, clapperboard: Clapperboard, audio: AudioLines, palette: Palette, layers: Layers,
  projector: Projector, spline: Spline, box: Box,
};

export function WorkbenchMark({ plugin, size = 36, className = '' }: { plugin: Pick<Plugin, 'appIcon'>; size?: number; className?: string }) {
  return <AppIcon src={plugin.appIcon} kind="plugin" size={size} className={className} />;
}
