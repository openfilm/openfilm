/**
 * Which workbench a project shows when it opens, kept on this computer by project (shell/workbenches reads it): the
 * canvas open or not, and a plugin's surface it was left on. A project started from the projects window's "Start with"
 * is set to that workbench before it opens.
 */
export const CANVAS_KEY = 'openfilm.canvas.open';
export const SURFACE_KEY = 'openfilm.surface';

export const canvasShown = (projectId: string) => { try { return localStorage.getItem(`${CANVAS_KEY}:${projectId}`) === '1'; } catch { return false; } };
export const surfacePicked = (projectId: string) => { try { return localStorage.getItem(`${SURFACE_KEY}:${projectId}`); } catch { return null; } };

/** The project opens on the edit or the canvas. */
export function openOn(projectId: string, workbench: 'edit' | 'canvas'): void {
  try {
    localStorage.setItem(`${CANVAS_KEY}:${projectId}`, workbench === 'canvas' ? '1' : '0');
    localStorage.removeItem(`${SURFACE_KEY}:${projectId}`);
  } catch { /* opens as it would */ }
}
