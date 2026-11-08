import { workspaceGeometry, type WorkspaceLayout } from './workspaces.ts';
import { dockFrames, visibleDockPanels, type DockPanel, type DockRect } from './workspace-dock.ts';

/** A preset with no custom tree uses the original pane layout, including content-fitted timeline and idle inspector. */
export function workspacePreviewFrames(layout: WorkspaceLayout, viewport: {width:number;height:number}, options: {hasChat:boolean;timelineFitHeight?:number;inspectorIdle?:boolean}) {
  if(layout.tree)return dockFrames(layout.tree,viewport,visibleDockPanels(layout,options.hasChat)).panels;
  const panels:Partial<Record<DockPanel,DockRect>>={};
  const chat=options.hasChat&&layout.chat?Math.max(Math.min(layout.chatWidth,viewport.width-640),Math.min(340,viewport.width)):0;
  const effective=!options.hasChat&&layout.libraryDock==='chat'?{...layout,libraryDock:'left' as const}:layout;
  const geometry=workspaceGeometry(effective,viewport,chat);
  const left=geometry.inset.left,width=Math.max(0,viewport.width-left-geometry.inset.right);
  const top=33,height=Math.max(0,viewport.height-top-geometry.inset.bottom);
  if(chat)panels.chat={left:layout.chatSide==='right'?viewport.width-chat:0,top:32,width:chat,height:Math.max(0,viewport.height-32)};
  if(layout.assets) {
    if(effective.libraryDock!=='chat')panels.library=geometry.library;
    else if(panels.chat)panels.library={...panels.chat};
  }
  if(layout.mode==='canvas'){panels.canvas={left,top,width,height};return panels;}
  const fit=Math.max(200,Math.min(options.timelineFitHeight??200,Math.round(viewport.height*.45)));
  const tallest=Math.max(104,height-221);
  const timeline=layout.timeline?(layout.timelineHeight===null?Math.min(fit,tallest,Math.max(104,Math.round(height*.45))):Math.min(layout.timelineHeight,tallest)):0;
  const rowHeight=Math.max(0,height-(layout.timeline?timeline+1:0));
  const rowTop=top+(layout.timeline&&layout.timelineEdge==='top'?timeline+1:0);
  const inspector=layout.inspector&&!(width<880&&(options.inspectorIdle??true))?Math.max(200,Math.min(layout.inspectorWidth,width-288)):0;
  const room=width-inspector-296;
  const layers=layout.layers&&room>=180?Math.min(layout.layersWidth,room):0;
  const viewer=Math.max(0,width-inspector-layers-(inspector?1:0)-(layers?1:0));
  const order:Array<[DockPanel,number]>=[];
  if(layers&&layout.layersSide==='left')order.push(['layers',layers]);
  if(inspector&&layout.inspectorSide==='left')order.push(['inspector',inspector]);
  order.push(['viewer',viewer]);
  if(layers&&layout.layersSide==='right')order.push(['layers',layers]);
  if(inspector&&layout.inspectorSide==='right')order.push(['inspector',inspector]);
  let x=left;
  for(const [panel,size]of order){panels[panel]={left:x,top:rowTop,width:size,height:rowHeight};x+=size+1;}
  if(layout.timeline)panels.timeline={left,top:layout.timelineEdge==='top'?top:top+rowHeight+1,width,height:timeline};
  return panels;
}
