import React from 'react';
import { createPortal } from 'react-dom';
import { Check, Eye, EyeOff, GripVertical, Redo2, RotateCcw, Undo2, X } from 'lucide-react';
import { useT } from '@/i18n';
import type { WorkspaceLayout } from '@/lib/workspaces';
import { dockDropAt, dockPanels, moveDock, panelFlag, resizeDock, setDockPanelVisible, setLibraryInsideChat, type DockNode, type DockPanel, type DockSeam, type dockFrames } from '@/lib/workspace-dock';
import { SettingsSwitch } from './settings/ui';
import styles from './WorkspaceEditor.module.css';

type Frames = ReturnType<typeof dockFrames>;
export function WorkspaceSeams({ tree, frames, editing = false, onChange, onCheckpoint }: {
  tree: DockNode; frames: Frames; editing?: boolean; onChange: (tree: DockNode) => void; onCheckpoint?: () => void;
}) {
  const t=useT();
  const drag=React.useRef<{tree:DockNode;seam:DockSeam}|null>(null);
  const apply=(x:number,y:number)=>{
    const start=drag.current;if(!start)return;
    const {seam}=start,axis=seam.axis==='x';
    const ratio=((axis?x:y)-(axis?seam.parent.left:seam.parent.top))/Math.max(1,(axis?seam.parent.width:seam.parent.height)-1);
    onChange(resizeDock(start.tree,seam.path,Math.max(seam.min,Math.min(seam.max,ratio))));
  };
  return createPortal(<>{frames.seams.map(seam=><div key={seam.path} role="separator" tabIndex={0} data-workspace-seam={seam.path}
    aria-label={t('layout.resizeSplit')} aria-orientation={seam.axis==='x'?'vertical':'horizontal'} aria-valuenow={Math.round(seam.ratio*100)} aria-valuemin={Math.round(seam.min*100)} aria-valuemax={Math.round(seam.max*100)}
    className={`workspace-resize-handle ${styles.seam} ${seam.axis==='x'?styles.vertical:styles.horizontal}`}
    style={{...seam.rect,...(seam.axis==='x'?{left:seam.rect.left-4,width:9}:{top:seam.rect.top-4,height:9}),zIndex:editing?9003:60}}
    onPointerDown={event=>{if(event.button!==0)return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);onCheckpoint?.();drag.current={tree,seam};}}
    onPointerMove={event=>apply(event.clientX,event.clientY)}
    onPointerUp={event=>{apply(event.clientX,event.clientY);drag.current=null;}}
    onPointerCancel={()=>{if(drag.current)onChange(drag.current.tree);drag.current=null;}}
    onDoubleClick={()=>{onCheckpoint?.();onChange(resizeDock(tree,seam.path,.5));}}
    onKeyDown={event=>{
      const plus=event.key===(seam.axis==='x'?'ArrowRight':'ArrowDown'),minus=event.key===(seam.axis==='x'?'ArrowLeft':'ArrowUp');
      if(!plus&&!minus)return;event.preventDefault();event.stopPropagation();onCheckpoint?.();
      onChange(resizeDock(tree,seam.path,Math.max(seam.min,Math.min(seam.max,seam.ratio+(plus?1:-1)*(event.shiftKey?.08:.02)))));
    }}/>)}</>,document.body);
}

export function WorkspaceEditor({ value, frames, hasChat, onChange, onDone, onCancel, onUndo, onRedo, canUndo, canRedo, onReset }: {
  value: WorkspaceLayout; frames: Frames; hasChat: boolean; onChange:(layout:WorkspaceLayout)=>void;
  onDone:()=>void; onCancel:()=>void; onUndo:()=>void; onRedo:()=>void; canUndo:boolean; canRedo:boolean; onReset:()=>void;
}) {
  const t=useT();
  const root=React.useRef<HTMLDivElement>(null);
  const [moving,setMoving]=React.useState<DockPanel|null>(null);
  const [drop,setDrop]=React.useState<ReturnType<typeof dockDropAt>>(null);
  const outsideDock=React.useRef<'left'|'right'|'bottom'>(value.libraryDock==='chat'?'left':value.libraryDock);
  const drag=React.useRef<{panel:DockPanel;x:number;y:number;active:boolean}|null>(null);
  const last=React.useRef({onCancel,onUndo,onRedo});last.current={onCancel,onUndo,onRedo};
  const cancelDrag=()=>{drag.current=null;setMoving(null);setDrop(null);};
  React.useEffect(()=>{
    root.current?.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape') {event.preventDefault();event.stopPropagation();if(drag.current)cancelDrag();else last.current.onCancel();}
      else if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='z'){event.preventDefault();event.stopPropagation();if(event.shiftKey)last.current.onRedo();else last.current.onUndo();}
      else if(event.key==='Tab') {
        const buttons=[...root.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])')??[]];
        if(!buttons.length)return;event.preventDefault();
        const index=buttons.indexOf(document.activeElement as HTMLButtonElement),next=event.shiftKey?(index<=0?buttons.length-1:index-1):(index+1)%buttons.length;
        buttons[next].focus();
      }
    };
    window.addEventListener('keydown',key,true);window.addEventListener('blur',cancelDrag);
    return()=>{window.removeEventListener('keydown',key,true);window.removeEventListener('blur',cancelDrag);queueMicrotask(()=>document.querySelector<HTMLButtonElement>('[data-layout-trigger]')?.focus());};
  },[]);
  const label=(panel:DockPanel)=>t(panel==='library'?'layout.assets':panel==='viewer'?'layout.viewer':panel==='canvas'?'canvas.title':`layout.${panel}`);
  const toggle=(panel:DockPanel)=>{
    const flag=panelFlag(panel);if(flag)onChange(setDockPanelVisible(value,panel,!value[flag]));
  };
  const pointerGrip=(panel:DockPanel)=>({
    onPointerDown:(event:React.PointerEvent<HTMLDivElement>)=>{if(event.button!==0||(event.target as Element).closest('[data-layout-control]'))return;event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);drag.current={panel,x:event.clientX,y:event.clientY,active:false};},
    onPointerMove:(event:React.PointerEvent<HTMLDivElement>)=>{
      const start=drag.current;if(!start)return;
      if(!start.active&&Math.hypot(event.clientX-start.x,event.clientY-start.y)<5)return;
      start.active=true;setMoving(panel);setDrop(dockDropAt(frames.panels,frames.root,event.clientX,event.clientY,panel));
    },
    onPointerUp:(event:React.PointerEvent<HTMLDivElement>)=>{
      const start=drag.current;
      const at=start?.active?dockDropAt(frames.panels,frames.root,event.clientX,event.clientY,panel):null;
      cancelDrag();
      if(at&&value.tree){const flag=panelFlag(panel);onChange({...value,tree:moveDock(value.tree,panel,at.target,at.edge),...(flag?{[flag]:true}:{}),...(panel==='library'?{libraryDock:'left' as const}:{})});}
    },
    onPointerCancel:cancelDrag,onLostPointerCapture:cancelDrag,
  });
  const moveWithKeyboard=(panel:DockPanel)=>(event:React.KeyboardEvent<HTMLButtonElement>)=>{
    const edge=({ArrowLeft:'left',ArrowRight:'right',ArrowUp:'top',ArrowDown:'bottom'} as const)[event.key as 'ArrowLeft'];
    if(!edge||!value.tree)return;event.preventDefault();event.stopPropagation();
    const flag=panelFlag(panel);onChange({...value,tree:moveDock(value.tree,panel,'root',edge),...(flag?{[flag]:true}:{}),...(panel==='library'?{libraryDock:'left' as const}:{})});
  };
  return createPortal(<div ref={root} data-workspace-editor role="dialog" aria-modal="true" tabIndex={-1} aria-label={t(value.mode==='edit'?'layout.editingEdit':'layout.editingCanvas')} className={`${styles.editor} ${moving?styles.moving:''}`}>
    {(Object.entries(frames.panels) as [DockPanel,Frames['root']][]).map(([panel,rect])=><div key={panel} data-layout-panel={panel} className={styles.tile} {...pointerGrip(panel)} style={{...rect,left:rect.left+2,top:rect.top+2,width:Math.max(0,rect.width-4),height:Math.max(0,rect.height-4)}}>
      <button type="button" aria-label={t('layout.movePanel').replace('{name}',label(panel))} className={styles.handle} onKeyDown={moveWithKeyboard(panel)}><GripVertical size={14}/><span>{label(panel)}</span></button>
      {panelFlag(panel)?<button type="button" data-layout-control className={styles.hide} aria-label={t('layout.hidePanel').replace('{name}',label(panel))} onClick={()=>toggle(panel)}><X size={14}/></button>:null}
    </div>)}
    {drop?<div data-layout-drop={`${drop.target}:${drop.edge}`} className={styles.drop} style={drop.preview}><span>{t(drop.edge==='center'?'layout.swapPanels':'layout.placePanel').replace('{name}',moving?label(moving):'')}</span></div>:null}
    <div className={styles.tools}>
      <div className={styles.instructions}><strong>{t(value.mode==='edit'?'layout.editingEdit':'layout.editingCanvas')}</strong><span>{t('layout.editHint')}</span></div>
      <div className={styles.palette} aria-label={t('layout.visiblePanels')}>
        {dockPanels(value.mode).filter(panel=>panelFlag(panel)&& (panel!=='chat'||hasChat)).map(panel=>{const visible=!!value[panelFlag(panel)!];return <button key={panel} type="button" data-layout-palette={panel} aria-pressed={visible} className={styles.chip} onClick={()=>toggle(panel)} title={t('layout.paletteHint')}>
          {visible?<Eye size={12}/>:<EyeOff size={12}/>}<span>{label(panel)}</span>
        </button>;})}
      </div>
      {hasChat?<div className={styles.integration} data-layout-integration>
        <span>{t('layout.libraryInChat')}</span>
        <SettingsSwitch label={t('layout.libraryInChat')} checked={value.libraryDock==='chat'} onChange={inside=>{if(inside&&value.libraryDock!=='chat')outsideDock.current=value.libraryDock;onChange(setLibraryInsideChat(value,inside,outsideDock.current));}}/>
      </div>:null}
      <div className={styles.actions}>
        <button type="button" aria-label={t('layout.undoLayout')} disabled={!canUndo} onClick={onUndo}><Undo2 size={15}/></button>
        <button type="button" aria-label={t('layout.redoLayout')} disabled={!canRedo} onClick={onRedo}><Redo2 size={15}/></button>
        <button type="button" onClick={onReset}><RotateCcw size={13}/>{t('layout.reset')}</button>
        <span className={styles.spacer}/><button type="button" onClick={onCancel}>{t('layout.cancel')}</button>
        <button type="button" className={styles.done} onClick={onDone}><Check size={14}/>{t('layout.doneEditing')}</button>
      </div>
    </div>
  </div>,document.body);
}
