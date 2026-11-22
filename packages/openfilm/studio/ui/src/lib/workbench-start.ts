/** Each project remembers the last workbench chosen in its window. */
const key = (projectId: string) => `openfilm.workbench:${projectId}`;

/** Older desktops saved a tab selection as well as the workbench behind their resource and start pages. */
export function lastWorkbench(projectId: string): string {
  try {
    const saved = localStorage.getItem(key(projectId));
    if (saved) return saved;
    const tabs = localStorage.getItem(`openfilm.workspace.tabs:${projectId}`);
    if (tabs) {
      try {
        const active = JSON.parse(tabs)?.active;
        if (typeof active === 'string' && active.startsWith('bench:') && active.length > 6) return active.slice(6);
      } catch { /* read the workbench settings below */ }
    }
    const surface = localStorage.getItem(`openfilm.surface:${projectId}`);
    if (surface) return surface;
    const canvas = localStorage.getItem(`openfilm.canvas.open:${projectId}`);
    if (canvas === '1') return 'canvas';
    if (canvas === '0' && localStorage.getItem('openfilm.project.color') === '1') return 'color';
  } catch { /* this window can still select a workbench without storage */ }
  return 'edit';
}

export function openOn(projectId: string, workbench: string): void {
  try { localStorage.setItem(key(projectId), workbench); } catch { /* this window only */ }
}
