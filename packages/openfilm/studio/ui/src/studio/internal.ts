/**
 * OpenFilm-internal: NOT part of Studio's public interface (that is studio/index, `openfilm/studio`). What the edit
 * reaches of the shell that no other workbench needs: the shell's whole frame of the project (where its blocks are
 * arranged, the page's places, the media pane's operations, the toast as the shell holds it…), the wiring, through
 * which the shell reaches how the edit's blocks are sized, its picture and its library actions (shell/frame), which
 * of the blocks' places are in a slot now (studio/blocks), and the top bar's button style. It is built into the edit and not named by the page's import map, so no module outside Studio's build reaches
 * it, and it changes with any version. A workbench in plugins/ reaches the shell only through this entry or the
 * public one.
 */
export { useFrame, usePublishWiring, useSteady, type Frame, type Wiring } from '@/shell/frame';
export { TOP_BTN } from '@/shell/top-bar';
export { attachedBlocks, blockKey } from './blocks';
