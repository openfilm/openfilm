/**
 * A workspace is a tree of splits over the page's own blocks (`chat`, `library`) and the workbench's (by key,
 * lib/workspaces BlockSpec). Hidden leaves keep their place, so reopening never loses a position.
 */
import { centerOf, type ArrangementSpec, type BlockSpec, type WorkspaceLayout } from './workspaces.ts';

export type DockPanel = string;
export type DockEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';
export type DockNode = { panel: DockPanel } | { axis: 'x' | 'y'; ratio: number; first: DockNode; second: DockNode; size?: number; anchor?: 'first' | 'second' };
export type DockRect = { left: number; top: number; width: number; height: number };
export type DockSeam = { path: string; axis: 'x' | 'y'; rect: DockRect; parent: DockRect; ratio: number; min: number; max: number };
/** The page's own blocks, which every arrangement has. */
export const PAGE_BLOCKS = ['chat', 'library'] as const;
const isPage = (panel: DockPanel) => panel === 'chat' || panel === 'library';
/** An arrangement's panels: its main block, the page's own, then the workbench's other blocks as declared. */
export const dockPanels = (spec: ArrangementSpec): DockPanel[] => {
  const center = centerOf(spec)?.key;
  return [...(center ? [center] : []), ...PAGE_BLOCKS, ...spec.blocks.map((b) => b.key).filter((k) => k !== center)];
};
/** Whether a panel is shown in `layout` (the main block always is). */
export const panelShown = (layout: WorkspaceLayout, panel: DockPanel, spec: ArrangementSpec): boolean =>
  panel === 'library' ? layout.assets : panel === 'chat' ? layout.chat : panel === centerOf(spec)?.key || Boolean(layout.blocks[panel]?.open);
/** Whether a panel can be hidden: any but the main block. */
export const panelHides = (panel: DockPanel, spec: ArrangementSpec): boolean => isPage(panel) || (panel !== centerOf(spec)?.key && spec.blocks.some((b) => b.key === panel));
const leaf = (panel: DockPanel): DockNode => ({ panel });
const split = (axis: 'x'|'y', first: DockNode, second: DockNode, size: number, anchor: 'first'|'second'): DockNode => ({ axis, first, second, ratio: .5, size, anchor });

/**
 * The tree an arrangement's docked form comes to: the main block, its blocks beside it and above or below it (inner
 * first), the library, then the chat. A block's size: for one beside the main block as `drawn` says (as drawn now),
 * else as kept; for one above or below, as kept, else as drawn (`drawn`: by key; none: 240 wide, 200 tall).
 */
export function defaultDockTree(layout: WorkspaceLayout, spec: ArrangementSpec, drawn: Readonly<Record<string, number>> = {}): DockNode {
  const center = centerOf(spec);
  let node = leaf(center?.key ?? 'main');
  const edgeOf = (b: BlockSpec) => layout.blocks[b.key]?.edge ?? b.edge;
  const others = spec.blocks.filter((b) => b !== center);
  const side = (b: BlockSpec) => drawn[b.key] ?? layout.blocks[b.key]?.size ?? b.size ?? 240;
  const tall = (b: BlockSpec) => layout.blocks[b.key]?.size ?? drawn[b.key] ?? b.size ?? 200;
  for (const b of others.filter((b) => edgeOf(b) === 'left').reverse()) node = split('x', leaf(b.key), node, side(b), 'first');
  for (const b of others.filter((b) => edgeOf(b) === 'right')) node = split('x', node, leaf(b.key), side(b), 'second');
  for (const b of others.filter((b) => edgeOf(b) === 'top').reverse()) node = split('y', leaf(b.key), node, tall(b), 'first');
  for (const b of others.filter((b) => edgeOf(b) === 'bottom')) node = split('y', node, leaf(b.key), tall(b), 'second');
  node = layout.libraryDock === 'bottom' ? split('y',node,leaf('library'),layout.libraryHeight,'second') : layout.libraryDock === 'right' ? split('x',node,leaf('library'),layout.assetsWidth,'second') : split('x',leaf('library'),node,layout.assetsWidth,'first');
  return layout.chatSide === 'left' ? split('x',leaf('chat'),node,layout.chatWidth,'first') : split('x',node,leaf('chat'),layout.chatWidth,'second');
}

const KEY = /^(?:[a-z][a-z0-9-]{0,31}:)?[a-z][a-z0-9-]{0,31}$/;
/** A tree of splits as kept: each panel once, named as a block is; `keys`, when given, the panels it must have, all of them. */
export function readDockTree(value: unknown, keys?: readonly DockPanel[]): DockNode | null {
  const seen = new Set<DockPanel>();
  const read = (value: unknown, depth: number): DockNode | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 12) return null;
    const node = value as Record<string, unknown>;
    if ('panel' in node) {
      if (typeof node.panel !== 'string' || !KEY.test(node.panel) || seen.has(node.panel) || (keys && !keys.includes(node.panel)) || seen.size >= 40) return null;
      seen.add(node.panel); return leaf(node.panel);
    }
    if (!['x','y'].includes(node.axis as string) || typeof node.ratio !== 'number' || !Number.isFinite(node.ratio) || node.ratio < .02 || node.ratio > .98) return null;
    if (node.size !== undefined && (typeof node.size !== 'number' || !Number.isFinite(node.size) || node.size < 1 || node.size > 4000 || !['first','second'].includes(node.anchor as string))) return null;
    const first = read(node.first,depth+1), second = read(node.second,depth+1);
    return first && second ? { axis: node.axis as 'x'|'y', ratio: node.ratio, first, second, ...(node.size !== undefined ? { size: node.size as number, anchor: node.anchor as 'first'|'second' } : {}) } : null;
  };
  const node = read(value,0);
  return node && (!keys || seen.size === keys.length) ? node : null;
}

/**
 * The panels drawn: the chat and the library as the page has them, and the blocks the arrangement shows of those
 * `drawn` says can be (a block whose workbench is not in the page is not).
 */
export function visibleDockPanels(layout: WorkspaceLayout, hasChat: boolean, spec: ArrangementSpec, drawn: (key: string) => boolean = () => true): Set<DockPanel> {
  return new Set(dockPanels(spec).filter(panel => {
    if (panel === 'chat') return hasChat && layout.chat;
    if (panel === 'library') return layout.assets && (layout.libraryDock !== 'chat' || !hasChat);
    return drawn(panel) && panelShown(layout, panel, spec);
  }));
}

/** The smallest a panel is drawn where panels float (width, height): the page's own, and each block as declared. */
export const panelMinimum = (spec: ArrangementSpec) => (panel: DockPanel): readonly [number, number] =>
  panel === 'chat' ? [280,180] : panel === 'library' ? [200,140] : spec.blocks.find((b) => b.key === panel)?.min ?? [240,180];
export function dockFrames(tree: DockNode, viewport: { width: number; height: number }, visible: ReadonlySet<DockPanel>, minimumOf: (panel: DockPanel) => readonly [number, number]) {
  const panels: Partial<Record<DockPanel,DockRect>> = {}, seams: DockSeam[] = [];
  const minimum = (node: DockNode): readonly [number,number] | null => {
    if ('panel' in node) return visible.has(node.panel) ? minimumOf(node.panel) : null;
    const a = minimum(node.first), b = minimum(node.second);
    if (!a) return b; if (!b) return a;
    return node.axis === 'x' ? [a[0]+b[0]+1,Math.max(a[1],b[1])] : [Math.max(a[0],b[0]),a[1]+b[1]+1];
  };
  const walk = (node: DockNode, rect: DockRect, path: string) => {
    if ('panel' in node) { if (visible.has(node.panel)) panels[node.panel] = rect; return; }
    const a = minimum(node.first), b = minimum(node.second);
    if (!a) { if (b) walk(node.second,rect,path+'1'); return; }
    if (!b) { walk(node.first,rect,path+'0'); return; }
    const horizontal = node.axis === 'x', room = Math.max(0,(horizontal ? rect.width : rect.height)-1);
    const minA = a[horizontal ? 0 : 1], minB = b[horizontal ? 0 : 1];
    const fit = Math.min(1,room/(minA+minB)), lo = minA*fit, hi = room-minB*fit;
    const preferred = node.size === undefined ? room*node.ratio : node.anchor === 'first' ? node.size : room-node.size;
    const first = Math.max(0,Math.min(room,Math.round(Math.max(lo,Math.min(hi,preferred)))));
    const second = Math.max(0,room-first), gap = Math.min(1,horizontal ? rect.width : rect.height);
    const seam = horizontal ? { left:rect.left+first,top:rect.top,width:gap,height:rect.height } : { left:rect.left,top:rect.top+first,width:rect.width,height:gap };
    seams.push({ path, axis:node.axis,rect:seam,parent:rect,ratio:room ? first/room : .5,min:room ? lo/room : .5,max:room ? hi/room : .5 });
    walk(node.first,{ ...rect,...(horizontal ? {width:first} : {height:first}) },path+'0');
    walk(node.second,{ ...rect,...(horizontal ? {left:rect.left+first+gap,width:second} : {top:rect.top+first+gap,height:second}) },path+'1');
  };
  const root = { left:0,top:32,width:Math.max(0,viewport.width),height:Math.max(0,viewport.height-32) };
  walk(tree,root,'');
  return { panels,seams,root };
}

export function resizeDock(tree: DockNode, path: string, ratio: number): DockNode {
  if ('panel' in tree) return tree;
  if (!path) { const { size:_size, anchor:_anchor, ...node } = tree; return { ...node,ratio:Math.max(.02,Math.min(.98,ratio)) }; }
  return path[0] === '0' ? { ...tree,first:resizeDock(tree.first,path.slice(1),ratio) } : { ...tree,second:resizeDock(tree.second,path.slice(1),ratio) };
}
export function moveDock(tree: DockNode, panel: DockPanel, target: DockPanel | 'root', edge: DockEdge): DockNode {
  if (panel === target) return tree;
  if (edge === 'center' && target !== 'root') {
    const swap = (node: DockNode): DockNode => 'panel' in node ? leaf(node.panel === panel ? target : node.panel === target ? panel : node.panel) : { ...node,first:swap(node.first),second:swap(node.second) };
    return swap(tree);
  }
  const remove = (node: DockNode): DockNode | null => {
    if ('panel' in node) return node.panel === panel ? null : node;
    const a = remove(node.first), b = remove(node.second);
    return a && b ? { ...node,first:a,second:b } : a ?? b;
  };
  const beside = (node: DockNode): DockNode => {
    const before = edge === 'left' || edge === 'top';
    return { axis:edge === 'left' || edge === 'right' ? 'x' : 'y',ratio:.5,first:before ? leaf(panel) : node,second:before ? node : leaf(panel) };
  };
  const rest = remove(tree); if (!rest) return tree;
  if (target === 'root') return beside(rest);
  const insert = (node: DockNode): DockNode => 'panel' in node ? node.panel === target ? beside(node) : node : { ...node,first:insert(node.first),second:insert(node.second) };
  return insert(rest);
}
export function dockDropAt(panels: Partial<Record<DockPanel,DockRect>>, root: DockRect, x: number, y: number, source: DockPanel): { target: DockPanel|'root'; edge: DockEdge; preview: DockRect } | null {
  if (x < root.left || y < root.top || x > root.left+root.width || y > root.top+root.height) return null;
  const preview = (r: DockRect, edge: DockEdge): DockRect => edge === 'center' ? r : edge === 'left' ? {...r,width:r.width/2} : edge === 'right' ? {...r,left:r.left+r.width/2,width:r.width/2} : edge === 'top' ? {...r,height:r.height/2} : {...r,top:r.top+r.height/2,height:r.height/2};
  const outer: DockEdge | null = x-root.left < 16 ? 'left' : root.left+root.width-x < 16 ? 'right' : y-root.top < 16 ? 'top' : root.top+root.height-y < 16 ? 'bottom' : null;
  if (outer) return { target:'root',edge:outer,preview:preview(root,outer) };
  for (const [panel,r] of Object.entries(panels) as [DockPanel,DockRect][]) {
    if (panel === source || x < r.left || x > r.left+r.width || y < r.top || y > r.top+r.height) continue;
    const px=(x-r.left)/r.width, py=(y-r.top)/r.height;
    const edge: DockEdge = px>.28 && px<.72 && py>.28 && py<.72 ? 'center' : Math.min(px,1-px) < Math.min(py,1-py) ? px<.5 ? 'left':'right' : py<.5 ? 'top':'bottom';
    return {target:panel,edge,preview:preview(r,edge)};
  }
  return null;
}

/** Visibility does not change docking. A visible child in chat requires its parent to be visible. The main block is always shown. */
export function setDockPanelVisible(layout: WorkspaceLayout, panel: DockPanel, show: boolean, spec: ArrangementSpec): WorkspaceLayout {
  if (!panelHides(panel, spec)) return layout;
  if (panel === 'library') return { ...layout, assets: show, ...(show && layout.libraryDock === 'chat' ? { chat: true } : {}) };
  if (panel === 'chat') return { ...layout, chat: show, ...(!show && layout.libraryDock === 'chat' ? { assets: false } : {}) };
  const place = layout.blocks[panel];
  return place ? { ...layout, blocks: { ...layout.blocks, [panel]: { ...place, open: show } } } : layout;
}
export function setLibraryInsideChat(layout: WorkspaceLayout, inside: boolean, outside: 'left'|'right'|'bottom' = 'left'): WorkspaceLayout {
  return { ...layout,libraryDock:inside?'chat':outside,...(inside&&layout.assets?{chat:true}:{}) };
}
