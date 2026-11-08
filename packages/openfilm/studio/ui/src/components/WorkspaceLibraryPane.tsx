import React from 'react';
import { useT } from '@/i18n';
import type { LibraryDock } from '@/lib/workspaces';
import type { DockRect } from '@/lib/workspace-dock';
import styles from './WorkspaceLibraryPane.module.css';

/** The library keeps its original UI. Layout tools belong to the workspace editor, never to this panel. */
export function WorkspaceLibraryPane({ open, dock, rect, children, free = false, onResize }: {
  open: boolean; dock: LibraryDock; rect: DockRect; children: React.ReactNode; free?: boolean;
  onResize: (size: { assetsWidth?: number; libraryHeight?: number }) => void;
}) {
  const t=useT();
  const [visited,setVisited]=React.useState(open);
  React.useEffect(()=>{if(open)setVisited(true);},[open]);
  const drag=React.useRef<{x:number;y:number;size:number}|null>(null);
  const bottom=dock==='bottom',size=bottom?rect.height:rect.width;
  const set=(size:number)=>onResize(bottom?{libraryHeight:Math.max(160,size)}:{assetsWidth:Math.max(220,size)});
  return <aside hidden={!open} inert={!open} data-workspace-library={dock} data-workspace-root={rect.top===32?'':undefined} aria-label={t('layout.assets')} className={styles.pane} style={rect}>
    <div className={styles.content}>{open||visited?children:null}</div>
    {!free&&dock!=='chat'?<div role="separator" aria-label={t('layout.resizeLibrary')} aria-orientation={bottom?'horizontal':'vertical'} aria-valuenow={Math.round(size)} tabIndex={0}
      className={`workspace-resize-handle ${styles.seam} ${bottom?styles.top:dock==='right'?styles.left:styles.right}`}
      onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={x:event.clientX,y:event.clientY,size};}}
      onPointerMove={event=>{const start=drag.current;if(start)set(start.size+(bottom?start.y-event.clientY:dock==='right'?start.x-event.clientX:event.clientX-start.x));}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{if(drag.current)set(drag.current.size);drag.current=null;}}
      onDoubleClick={()=>set(bottom?280:320)}
      onKeyDown={event=>{const grow=event.key===(bottom?'ArrowUp':dock==='right'?'ArrowLeft':'ArrowRight'),shrink=event.key===(bottom?'ArrowDown':dock==='right'?'ArrowRight':'ArrowLeft');if(!grow&&!shrink)return;event.preventDefault();set(size+(grow?1:-1)*(event.shiftKey?48:16));}}/>:null}
  </aside>;
}
