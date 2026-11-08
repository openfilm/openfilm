/** A workspace is a tree of splits. Hidden leaves keep their place, so reopening never loses a position. */
import type { WorkspaceLayout, WorkspaceMode } from './workspaces';

export type DockPanel = 'viewer' | 'canvas' | 'chat' | 'library' | 'layers' | 'inspector' | 'timeline';
export type DockEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';
export type DockNode = { panel: DockPanel } | { axis: 'x' | 'y'; ratio: number; first: DockNode; second: DockNode; size?: number; anchor?: 'first' | 'second' };
export type DockRect = { left: number; top: number; width: number; height: number };
export type DockSeam = { path: string; axis: 'x' | 'y'; rect: DockRect; parent: DockRect; ratio: number; min: number; max: number };
export const dockPanels = (mode: WorkspaceMode): DockPanel[] => mode === 'canvas' ? ['canvas','chat','library'] : ['viewer','chat','library','layers','inspector','timeline'];
export const panelFlag = (panel: DockPanel): 'assets' | 'chat' | 'layers' | 'inspector' | 'timeline' | null => panel === 'library' ? 'assets' : panel === 'viewer' || panel === 'canvas' ? null : panel;
const leaf = (panel: DockPanel): DockNode => ({ panel });
const split = (axis: 'x'|'y', first: DockNode, second: DockNode, size: number, anchor: 'first'|'second'): DockNode => ({ axis, first, second, ratio: .5, size, anchor });

export function defaultDockTree(layout: WorkspaceLayout, timelineHeight = 200): DockNode {
  let node = leaf(layout.mode === 'canvas' ? 'canvas' : 'viewer');
  if (layout.mode === 'edit') {
    if (layout.inspectorSide === 'left') node = split('x',leaf('inspector'),node,layout.inspectorWidth,'first');
    if (layout.layersSide === 'left') node = split('x',leaf('layers'),node,layout.layersWidth,'first');
    if (layout.layersSide === 'right') node = split('x',node,leaf('layers'),layout.layersWidth,'second');
    if (layout.inspectorSide === 'right') node = split('x',node,leaf('inspector'),layout.inspectorWidth,'second');
    node = layout.timelineEdge === 'top' ? split('y',leaf('timeline'),node,layout.timelineHeight ?? timelineHeight,'first') : split('y',node,leaf('timeline'),layout.timelineHeight ?? timelineHeight,'second');
  }
  node = layout.libraryDock === 'bottom' ? split('y',node,leaf('library'),layout.libraryHeight,'second') : layout.libraryDock === 'right' ? split('x',node,leaf('library'),layout.assetsWidth,'second') : split('x',leaf('library'),node,layout.assetsWidth,'first');
  return layout.chatSide === 'left' ? split('x',leaf('chat'),node,layout.chatWidth,'first') : split('x',node,leaf('chat'),layout.chatWidth,'second');
}

export function readDockTree(value: unknown, mode: WorkspaceMode): DockNode | null {
  const allowed = new Set(dockPanels(mode)), seen = new Set<DockPanel>();
  const read = (value: unknown, depth: number): DockNode | null => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 12) return null;
    const node = value as Record<string, unknown>;
    if ('panel' in node) {
      if (!allowed.has(node.panel as DockPanel) || seen.has(node.panel as DockPanel)) return null;
      seen.add(node.panel as DockPanel); return leaf(node.panel as DockPanel);
    }
    if (!['x','y'].includes(node.axis as string) || typeof node.ratio !== 'number' || !Number.isFinite(node.ratio) || node.ratio < .02 || node.ratio > .98) return null;
    if (node.size !== undefined && (typeof node.size !== 'number' || !Number.isFinite(node.size) || node.size < 1 || node.size > 4000 || !['first','second'].includes(node.anchor as string))) return null;
    const first = read(node.first,depth+1), second = read(node.second,depth+1);
    return first && second ? { axis: node.axis as 'x'|'y', ratio: node.ratio, first, second, ...(node.size !== undefined ? { size: node.size as number, anchor: node.anchor as 'first'|'second' } : {}) } : null;
  };
  const node = read(value,0);
  return node && seen.size === allowed.size ? node : null;
}

export function visibleDockPanels(layout: WorkspaceLayout, hasChat: boolean): Set<DockPanel> {
  return new Set(dockPanels(layout.mode).filter(panel => {
    if (panel === 'chat') return hasChat && layout.chat;
    if (panel === 'library') return layout.assets && (layout.libraryDock !== 'chat' || !hasChat);
    const flag = panelFlag(panel); return !flag || layout[flag];
  }));
}

const MIN: Record<DockPanel, [number,number]> = { viewer:[240,220], canvas:[240,220], chat:[280,180], library:[200,140], layers:[160,120], inspector:[240,180], timeline:[240,104] };
export function dockFrames(tree: DockNode, viewport: { width: number; height: number }, visible: ReadonlySet<DockPanel>) {
  const panels: Partial<Record<DockPanel,DockRect>> = {}, seams: DockSeam[] = [];
  const minimum = (node: DockNode): [number,number] | null => {
    if ('panel' in node) return visible.has(node.panel) ? MIN[node.panel] : null;
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

/** Visibility does not change docking. A visible child in chat requires its parent to be visible. */
export function setDockPanelVisible(layout: WorkspaceLayout, panel: DockPanel, show: boolean): WorkspaceLayout {
  const flag=panelFlag(panel); if(!flag)return layout;
  return { ...layout,[flag]:show,...(panel==='library'&&show&&layout.libraryDock==='chat'?{chat:true}:{}),...(panel==='chat'&&!show&&layout.libraryDock==='chat'?{assets:false}:{}) };
}
export function setLibraryInsideChat(layout: WorkspaceLayout, inside: boolean, outside: 'left'|'right'|'bottom' = 'left'): WorkspaceLayout {
  return { ...layout,libraryDock:inside?'chat':outside,...(inside&&layout.assets?{chat:true}:{}) };
}
