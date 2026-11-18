/**
 * The edit, as the element its plugin brings (plugins/edit: its package.json's `browser`; Motion's plugin brings the
 * same one, as the edit's own code draws Motion): Studio's shell loads it as it does a workbench anyone made
 * (components/surfaces elementTag, src/skills.mjs elementIn) and puts one where the page's panels are, and what is
 * drawn in it is the edit's own. It is told the project by its `project-id`, and reaches Studio through its public
 * interface (`openfilm/studio`) and, for what only the edit needs of the shell, studio/internal.
 */
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ProjectView } from '../../components/ProjectView';
import { openProject } from '../../lib/navigate';

export default class EditWorkbench extends HTMLElement {
  #root: Root | null = null;

  connectedCallback(): void {
    const projectId = this.getAttribute('project-id');
    if (!projectId || this.#root) return;
    /* its panes lay themselves out in the window: the element itself takes no room */
    this.style.display = 'contents';
    /* ids made in this root are told apart from the shell's (React's useId counts from the start in each root) */
    this.#root = createRoot(this, { identifierPrefix: 'edit-' });
    this.#root.render(<StrictMode><ProjectView projectId={projectId} onProject={openProject} /></StrictMode>);
  }

  disconnectedCallback(): void {
    /* after the render that took the element out (a root is not unmounted while another is rendering), and only if it
       was not put back meanwhile: an element moved keeps what it holds */
    queueMicrotask(() => {
      if (this.isConnected || !this.#root) return;
      const root = this.#root;
      this.#root = null;
      root.unmount();
    });
  }
}
