/**
 * A project's page: Studio's shell. What is worked in is a plugin's workbench, an element its plugin brings
 * (src/skills.mjs elementIn; OpenFilm's own in plugins/<id>, loaded as anyone's is), which the shell puts where the
 * layout says and tells the project (shell/workbenches).
 *
 * What is here is the project's frame (shell/ProjectFrame): the project and its files as read (shell/project-read),
 * the media pane's operations on them, the app's commands, the toast, which workbench is shown and the elements of
 * the plugins on (the edit among the page's panels, the canvas in its box, another plugin's surface in the panes'
 * place: shell/workbenches), the library, its pane and its drawer (shell/library), the top bar with the page's own
 * windows (shell/top-bar), and how the window is laid out (shell/layout); a workbench is given them through
 * shell/frame.
 */
import { ProjectFrame } from '@/shell/ProjectFrame';

export function ProjectPage({ projectId }: { projectId: string }) {
  return <ProjectFrame projectId={projectId} />;
}
