/** How a list of projects or files is drawn: icons of three sizes, or a detailed list; kept on this computer. */
export type ResourceView = 'small' | 'medium' | 'large' | 'list';
export const RESOURCE_TILE_SIZE = { small: 120, medium: 180, large: 260 };
export const RESOURCE_VIEW_KEY = 'openfilm.resource-center.view';
export function readResourceView(): ResourceView {
  try {
    const kept = localStorage.getItem(RESOURCE_VIEW_KEY);
    if (kept === 'small' || kept === 'medium' || kept === 'large' || kept === 'list') return kept;
    return localStorage.getItem('openfilm.projects.view') === 'list' ? 'list' : 'medium';
  } catch { return 'medium'; }
}
