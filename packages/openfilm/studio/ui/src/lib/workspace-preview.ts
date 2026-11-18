import { centerOf, workspaceGeometry, type ArrangementSpec, type BlockPlace, type BlockSpec, type WorkspaceLayout } from './workspaces.ts';
import { dockFrames, panelMinimum, visibleDockPanels, type DockPanel, type DockRect } from './workspace-dock.ts';

/**
 * A block as drawn where the panels are docked: whether it is, its size (its width beside the main block, its height
 * above or below it), the seam that sizes it (the smallest it may get, what the main block keeps, its words), and the
 * size it fits its content to until a person sizes it (`fit`), which an arrangement made anew starts from.
 */
export interface DrawnBlock { shown: boolean; size: number; seam?: { min: number; minRest: number; label: string }; fit?: number }
/** The room the docked blocks share: the row's width beside the main block, the column's height (0: not measured yet). */
export interface BlockRoom { width: number; height: number }
/**
 * How a workbench draws its blocks where the panels are docked, in `room`, with their places in the arrangement (by
 * their ids) and, where the panels float, their boxes: each block's id → how it is drawn. The edit's fits its timeline
 * to its tracks and leaves an idle inspector out of a narrow window; without one, `plainSizes`.
 */
export type BlockSizer = (room: BlockRoom, places: Readonly<Record<string, BlockPlace>>, free: Readonly<Partial<Record<string, DockRect>>> | null) => Readonly<Record<string, DrawnBlock>>;

const sideways = (place: BlockPlace) => place.edge === 'left' || place.edge === 'right';

/** Blocks drawn as declared: as kept or declared, within the room the main block leaves; the seam's words by `label`. */
export function plainSizes(spec: ArrangementSpec, layout: WorkspaceLayout, room: BlockRoom, free: boolean, label: (block: BlockSpec) => string, keys: readonly string[]): Record<string, DrawnBlock> {
  const center = centerOf(spec);
  const out: Record<string, DrawnBlock> = {};
  for (const block of spec.blocks.filter((b) => keys.includes(b.key))) {
    const place = layout.blocks[block.key] ?? { open: block.open, edge: block.edge, size: block.size };
    if (block === center) { out[block.key] = { shown: true, size: 0 }; continue; }
    const across = sideways(place);
    const want = place.size ?? block.size ?? (across ? 240 : 200);
    const rest = center?.min[across ? 0 : 1] ?? 240;
    const room1 = across ? room.width : room.height;
    const size = free || !room1 ? want : Math.max(block.range[0], Math.min(want, room1 - rest - (across ? 8 : 1)));
    out[block.key] = { shown: place.open, size, seam: { min: block.range[0], minRest: rest, label: label(block) } };
  }
  return out;
}

/**
 * Each block of an arrangement as drawn docked in `room` (`free`: the panels' boxes where they float), by key: the
 * blocks of a workbench with a sizer (`sizerOf(owner)`) as it says, the others `plainSizes`.
 */
export function dockedSizes(spec: ArrangementSpec, layout: WorkspaceLayout, room: BlockRoom, free: Readonly<Partial<Record<string, DockRect>>> | null,
  sizerOf: (owner: string) => BlockSizer | undefined, label: (block: BlockSpec) => string): Record<string, DrawnBlock> {
  const out: Record<string, DrawnBlock> = {};
  const plain: string[] = [];
  for (const owner of new Set(spec.blocks.map((b) => b.owner))) {
    const blocks = spec.blocks.filter((b) => b.owner === owner);
    const sizer = sizerOf(owner);
    if (!sizer) { plain.push(...blocks.map((b) => b.key)); continue; }
    const places = Object.fromEntries(blocks.flatMap((b) => (layout.blocks[b.key] ? [[b.id, layout.blocks[b.key]!]] : [])));
    const boxes = free ? Object.fromEntries(blocks.flatMap((b) => (free[b.key] ? [[b.id, free[b.key]!]] : []))) : null;
    const drawn = sizer(room, places, boxes);
    for (const b of blocks) if (drawn[b.id]) out[b.key] = drawn[b.id]!;
  }
  return { ...out, ...plainSizes(spec, layout, room, Boolean(free), label, plain) };
}

/** A preset with no custom tree uses the docked layout, each block drawn as `sizes` says for the room it has. */
export function workspacePreviewFrames(layout: WorkspaceLayout, spec: ArrangementSpec, viewport: {width:number;height:number}, options: {hasChat:boolean; sizes:(room: BlockRoom) => Readonly<Record<string, DrawnBlock>>}) {
  if(layout.tree)return dockFrames(layout.tree,viewport,visibleDockPanels(layout,options.hasChat,spec),panelMinimum(spec)).panels;
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
  const drawn=options.sizes({width,height});
  const center=centerOf(spec);
  const shown=spec.blocks.filter(b=>b!==center&&drawn[b.key]?.shown);
  const edgeOf=(b:BlockSpec)=>layout.blocks[b.key]?.edge??b.edge;
  const size=(b:BlockSpec)=>Math.max(0,drawn[b.key]!.size);
  /* above and below the row: the first above outermost, the first below innermost */
  let rowTop=top,rowBottom=top+height;
  for(const b of shown.filter(b=>edgeOf(b)==='top')){const h=Math.min(size(b),Math.max(0,rowBottom-rowTop));panels[b.key]={left,top:rowTop,width,height:h};rowTop+=h+1;}
  const below=shown.filter(b=>edgeOf(b)==='bottom');
  const heights=below.map(b=>size(b));
  let y=rowBottom-heights.reduce((sum,h)=>sum+h+1,0);
  const rowHeight=Math.max(0,y-rowTop);
  for(const [i,b] of below.entries()){y+=1;panels[b.key]={left,top:y,width,height:heights[i]!};y+=heights[i]!;}
  rowBottom=rowTop+rowHeight;
  const lefts=shown.filter(b=>edgeOf(b)==='left'),rights=shown.filter(b=>edgeOf(b)==='right');
  /* beside the main block, each as drawn while the row has room for it (a preview of a tiny window stays inside it) */
  let left_=width;
  const across=new Map([...lefts,...rights].map(b=>{const w=Math.max(0,Math.min(size(b),left_-1));left_-=w+1;return [b,w];}));
  const sides=[...across.values()].reduce((sum,w)=>sum+(w?w+1:0),0);
  const row:Array<[DockPanel,number]>=[...lefts.map(b=>[b.key,across.get(b)!] as [DockPanel,number]),...(center?[[center.key,Math.max(0,width-sides)] as [DockPanel,number]]:[]),...rights.map(b=>[b.key,across.get(b)!] as [DockPanel,number])];
  let x=left;
  /* one with no room left is not drawn */
  for(const [panel,w]of row){if(!w&&panel!==center?.key)continue;panels[panel]={left:x,top:rowTop,width:w,height:rowHeight};x+=w+1;}
  return panels;
}
