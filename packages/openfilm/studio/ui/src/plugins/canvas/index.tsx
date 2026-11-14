/**
 * The canvas, as the element its plugin brings (plugins/canvas: its package.json's `browser`): Studio's shell puts one
 * in the canvas's box once it is warmed or shown, and what is drawn in it is the canvas's own. It
 * is told the project by its `project-id`, and reaches Studio only through its public interface (`openfilm/studio`,
 * studio/index), as a plugin someone made does: what it shows of the project, the files it brings in, the toast,
 * Settings, the app's chat; files put in the film are the edit's `add`, and what is asked of the canvas (files put
 * on it, a node to show, a board to lay down) comes to its own.
 */
import * as React from 'react';
import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useT } from '../../i18n';
import type { CanvasDoc } from '../../lib/canvas';
import { CANVAS_FILES, parseLink } from '../../lib/links';
import CanvasView from '../../components/canvas/CanvasView';
import { CanvasLoading } from '../../components/canvas/CanvasLoading';
import { LoadBoundary } from '../../components/canvas/LoadBoundary';
import { addTo, chat, openSettings, project, toast } from '../../studio';
import { useProject, useProvide } from '../../studio/react';

/** The board a file of the project holds: `.film/canvas.json` the first, `.film/canvases/<id>.json` another; null: none. */
const boardOfFile = (path: string) => (path === CANVAS_FILES[0] ? 'main' : /^\.film\/canvases\/([^/]+)\.json$/.exec(path)?.[1] ?? null);

/** Said in the toast: an error, or a notice. */
const showError = (message: string) => toast(message, { error: true });
const notice = (message: string) => toast(message);

/** The board of the project `projectId`, with what Studio shows of it. */
function Canvas({ projectId }: { projectId: string }) {
  const t = useT();
  const state = useProject(projectId);
  /* what is asked of the canvas, each time anew (`n`): files put on it, a node to show (a link to its board,
     `.film/canvas.json#<node>`), a board to lay down */
  const [addFiles, setAddFiles] = React.useState<{ paths: string[]; n: number } | null>(null);
  const [focus, setFocus] = React.useState<{ id: string | null; board: string; n: number } | null>(null);
  const [insert, setInsert] = React.useState<{ doc: CanvasDoc; n: number } | null>(null);
  useProvide('canvas', {
    add: (paths) => setAddFiles({ paths: [...paths], n: performance.now() }),
    command: (command) => {
      if (command.type === 'lay-board') setInsert({ doc: command.board as CanvasDoc, n: Date.now() });
    },
    opens: CANVAS_FILES,
    show: (link) => {
      const read = parseLink(link);
      const board = read ? boardOfFile(read.path) : null;
      if (read && board) setFocus({ id: read.fragment, board, n: Date.now() });
    },
  });
  if (!state) return <CanvasLoading />;
  const refer = chat.refer;
  return (
    <LoadBoundary title={t('canvas.loadFailed')} action={t('canvas.reload')}>
      <React.Suspense fallback={<CanvasLoading />}>
        <CanvasView shown={state.shown === 'canvas'} projectId={projectId} folder={state.folder} files={state.files} sources={state.sources} onAddToFilm={(file) => { addTo('edit', [file.path]); }}
          onImportFiles={(dropped, progress = () => {}, into = 'assets') => project(projectId).importFiles(dropped, { into, onProgress: progress })} onOpenSettings={() => openSettings('models')}
          focus={focus} insert={insert} addFiles={addFiles} onRefer={refer ? (refs) => { for (const ref of refs) refer(ref); } : undefined}
          onSendToFilm={(list) => { addTo('edit', list.map((file) => file.path), { show: true }); }} onReveal={(path) => project(projectId).showFile(path)}
          {...(state.chat ? { chat: state.chat } : {})}
          onError={showError} onNotice={notice} />
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
