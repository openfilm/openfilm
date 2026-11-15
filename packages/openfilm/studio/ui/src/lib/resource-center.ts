import type { AssetCatalog } from './asset-library';
import type { MediaListing } from './workspace-resources';

export type ResourceAssetLocation = 'home' | 'computer' | 'all' | 'recent' | 'starred' | 'offline' | 'managed' | `collection:${string}` | `location:${string}`;
export type ResourceView = 'small' | 'medium' | 'large' | 'list';
export const RESOURCE_TILE_SIZE = { small: 120, medium: 180, large: 260 };
export interface ResourceLibraryData { listing: MediaListing | null; catalog: AssetCatalog; error: boolean }
export interface ResourceNavigation { location: ResourceAssetLocation; seq: number }
export const RESOURCE_VIEW_KEY = 'openfilm.resource-center.view';
export function readResourceView(): ResourceView {
  try {
    const kept = localStorage.getItem(RESOURCE_VIEW_KEY);
    if (kept === 'small' || kept === 'medium' || kept === 'large' || kept === 'list') return kept;
    return localStorage.getItem('openfilm.projects.view') === 'list' ? 'list' : 'medium';
  } catch { return 'medium'; }
}

/** Quick access stores shortcuts, never copies or moves the folder's contents. */
export type ResourcePin = { kind: 'projects'; folderId: string | null } | { kind: 'assets'; path: string };
export const RESOURCE_PINS_KEY = 'openfilm.resource-center.pins';
export const pinKey = (pin: ResourcePin) => pin.kind === 'projects' ? `projects:${pin.folderId ?? ''}` : `assets:${pin.path}`;
export function readResourcePins(): ResourcePin[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RESOURCE_PINS_KEY) ?? 'null');
    if (Array.isArray(value)) {
      const pins = value.filter((p): p is ResourcePin => p && ((p.kind === 'projects' && (p.folderId === null || typeof p.folderId === 'string')) || (p.kind === 'assets' && typeof p.path === 'string' && !p.path.split('/').includes('..'))));
      return pins.filter((p, i) => pins.findIndex(other => pinKey(other) === pinKey(p)) === i);
    }
  } catch { /* preferences unavailable */ }
  return [{ kind: 'projects', folderId: null }, { kind: 'assets', path: '' }];
}
export interface ResourcePinActions {
  pins: ResourcePin[];
  onPin: (pin: ResourcePin) => void;
  onUnpin: (pin: ResourcePin) => void;
}
