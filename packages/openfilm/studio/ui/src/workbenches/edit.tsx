/**
 * The edit, as the element its plugin brings (plugins/edit: its package.json's `browser`): Studio's shell puts one in
 * the project's page, as it does a workbench anyone made (components/surfaces, src/skills.mjs elementIn), and what is
 * drawn in it is the edit's own. It is told the project by its `project-id`.
 */
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ProjectView } from '../components/ProjectView';
import { leaveProject, openProject } from '../lib/navigate';

export default class EditWorkbench extends HTMLElement {
  #root: Root | null = null;

  connectedCallback(): void {
    const projectId = this.getAttribute('project-id');
    if (!projectId || this.#root) return;
    /* its panes lay themselves out in the window: the element itself takes no room */
    this.style.display = 'contents';
    /* ids made in this root are told apart from the shell's (React's useId counts from the start in each root) */
    this.#root = createRoot(this, { identifierPrefix: 'edit-' });
    this.#root.render(<StrictMode><ProjectView projectId={projectId} onProject={openProject} onLeave={leaveProject} /></StrictMode>);
  }

  disconnectedCallback(): void {
    const root = this.#root;
    this.#root = null;
    /* after the render that took the element out: a root is not unmounted while another is rendering */
    if (root) queueMicrotask(() => root.unmount());
  }
}
