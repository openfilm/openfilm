/**
 * The canvas, as the element its plugin brings (plugins/canvas: its package.json's `browser`): Studio's shell puts one
 * in the canvas's box (shell/workbenches) once it is warmed or shown, and what is drawn in it is the canvas's own. It
 * is told the project by its `project-id`, reads what it shows from the shell's frame, and puts files in the film
 * through the edit's wiring.
 */
import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useT } from '../i18n';
import { studioHost } from '../lib/host';
import CanvasView from '../components/canvas/CanvasView';
import { CanvasLoading } from '../components/canvas/CanvasLoading';
import { LoadBoundary } from '../components/canvas/LoadBoundary';
import { useFrame, wiringOf } from '../shell/frame';

/** The board of the project `projectId`, with what the shell holds of it. */
function Canvas({ projectId }: { projectId: string }) {
  const t = useT();
  const { loaded, listing, mediaSources, onImport, setSettingsOpen, canvasOpen, canvasFocus, canvasInsert, canvasAddFiles, showFile, chat, toast } = useFrame(projectId);
  const canvasFiles = React.useMemo(() => (listing ? [...listing.files, ...listing.pages] : []), [listing]);
  return (
    <LoadBoundary title={t('canvas.loadFailed')} action={t('canvas.reload')}>
      <React.Suspense fallback={<CanvasLoading />}>
        <CanvasView shown={canvasOpen} projectId={projectId} folder={loaded?.project.path ?? ''} files={canvasFiles} sources={mediaSources} onAddToFilm={(file) => { wiringOf('edit')?.addToFilm?.(file); }}
          onImportFiles={(dropped, progress = () => {}) => onImport(dropped, 'assets', progress)} onOpenSettings={() => setSettingsOpen('models')}
          focus={canvasFocus} insert={canvasInsert} addFiles={canvasAddFiles} onRefer={studioHost?.refer ? (refs) => { for (const ref of refs) studioHost?.refer?.(ref); } : undefined}
          onSendToFilm={(list) => { wiringOf('edit')?.sendToFilm?.(list); }} onReveal={(path) => showFile(path, true)}
          {...(chat ? { chat } : {})}
          onError={toast.showError} onNotice={(message) => toast.show(message)} />
      </React.Suspense>
    </LoadBoundary>
  );
}

export default class CanvasWorkbench extends HTMLElement {
  #root: Root | null = null;

  connectedCallback(): void {
    const projectId = this.getAttribute('project-id');
    if (!projectId || this.#root) return;
    /* the board fills the canvas's box: the element itself takes no room */
    this.style.display = 'contents';
    /* ids made in this root are told apart from the shell's (React's useId counts from the start in each root) */
    this.#root = createRoot(this, { identifierPrefix: 'canvas-' });
    this.#root.render(<StrictMode><Canvas projectId={projectId} /></StrictMode>);
  }

  disconnectedCallback(): void {
    const root = this.#root;
    this.#root = null;
    /* after the render that took the element out: a root is not unmounted while another is rendering */
    if (root) queueMicrotask(() => root.unmount());
  }
}
