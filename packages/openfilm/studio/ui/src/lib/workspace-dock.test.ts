import { test } from 'node:test';
import assert from 'node:assert/strict';
import { workspacePresets, readWorkspaceLayout, type WorkspaceLayout } from './workspaces.ts';
import { defaultDockTree, dockFrames as framesOf, dockPanels, panelMinimum, readDockTree, visibleDockPanels as visibleOf, moveDock, resizeDock, dockDropAt, type DockNode } from './workspace-dock.ts';
import { CANVAS, DEFAULT_WORKSPACE, DEFAULT_CANVAS_WORKSPACE, EDIT } from './test-arrangements.ts';

const sides = (layout: WorkspaceLayout, layersSide: 'left' | 'right', inspectorSide: 'left' | 'right'): WorkspaceLayout => ({ ...layout, blocks: { ...layout.blocks, layers: { ...layout.blocks.layers!, edge: layersSide }, inspector: { ...layout.blocks.inspector!, edge: inspectorSide } } });
const all: WorkspaceLayout = { ...DEFAULT_WORKSPACE, assets:true, libraryDock:'left', blocks: { ...DEFAULT_WORKSPACE.blocks, layers: { ...DEFAULT_WORKSPACE.blocks.layers!, open: true } } };
const dockFrames = (tree: DockNode, viewport: { width: number; height: number }, visible: ReadonlySet<string>) => framesOf(tree, viewport, visible, panelMinimum(EDIT));
const visibleDockPanels = (layout: WorkspaceLayout, hasChat: boolean) => visibleOf(layout, hasChat, EDIT);
const edit = dockPanels(EDIT);
const leaves = (node: DockNode): string[] => 'panel' in node ? [node.panel] : [...leaves(node.first),...leaves(node.second)];
const equalRect = (a: object|undefined,b:object|undefined) => assert.deepEqual(a,b);

test('every preset stays in its own mode and defaults retain the original chat/library UI',()=>{
  for(const spec of [EDIT,CANVAS])for(const preset of workspacePresets(spec))assert.equal(preset.layout.mode,spec.name);
  assert.equal(DEFAULT_WORKSPACE.libraryDock,'chat');
  assert.equal(DEFAULT_WORKSPACE.assets,false);
  assert.equal(DEFAULT_CANVAS_WORKSPACE.assets,false);
  assert.deepEqual(workspacePresets(EDIT).map(p=>p.id),['standard','library','detail','focus']);
  assert.deepEqual(edit,['viewer','chat','library','layers','inspector','timeline'],'the main block, the page\'s own, then the others as declared');
  assert.deepEqual(dockPanels(CANVAS),['canvas','chat','library']);
});
test('all moves and center swaps preserve each panel exactly once and remain valid portable trees',()=>{
  const tree=defaultDockTree(all,EDIT);
  for(const source of edit)for(const target of [...edit,'root'] as const)for(const edge of ['left','right','top','bottom','center'] as const){
    const next=moveDock(tree,source,target,edge);
    assert.deepEqual(leaves(next).sort(),[...edit].sort());
    assert.ok(readDockTree(next,edit));
    const stored=readWorkspaceLayout({...all,tree:next});assert.ok(stored);
  }
});
test('nested docking actually changes panel geometry, including the viewer, chat and timeline',()=>{
  const tree=defaultDockTree(all,EDIT), visible=visibleDockPanels(all,true),viewport={width:2000,height:1200};
  for (const layersSide of ['left','right'] as const) for (const inspectorSide of ['left','right'] as const) {
    const layout=sides(all,layersSide,inspectorSide), current=dockFrames(defaultDockTree(layout,EDIT),viewport,visible);
    const order: Array<'layers'|'inspector'|'viewer'>=['layers','inspector','viewer'];
    order.sort((a,b)=>current.panels[a]!.left-current.panels[b]!.left);
    assert.deepEqual(order,[...(layersSide==='left'?['layers']:[]),...(inspectorSide==='left'?['inspector']:[]),'viewer',...(layersSide==='right'?['layers']:[]),...(inspectorSide==='right'?['inspector']:[])], 'entering edit preserves the existing panel order');
  }
  const moved=moveDock(tree,'timeline','viewer','left');
  const frame=dockFrames(moved,viewport,visible);
  assert.ok(frame.panels.timeline!.left<frame.panels.viewer!.left);
  assert.equal(frame.panels.timeline!.top,frame.panels.viewer!.top);
  assert.equal(frame.panels.timeline!.height,frame.panels.viewer!.height);
  const swap=dockFrames(moveDock(moved,'viewer','chat','center'),viewport,visible);
  equalRect(swap.panels.chat,frame.panels.viewer);
  // Different minimum widths can fit the split differently; viewer nevertheless occupies the former chat branch.
  assert.equal(swap.panels.viewer!.left,0);
  const outer=dockFrames(moveDock(tree,'chat','root','bottom'),viewport,visible);
  assert.equal(outer.panels.chat!.top+outer.panels.chat!.height,1200);
  assert.equal(outer.panels.chat!.width,2000);
});
test('hidden panels keep their branch and reopening restores it; splits never overlap at compact sizes',()=>{
  const tree=moveDock(defaultDockTree(all,EDIT),'library','viewer','bottom');
  for(const width of [0,500,980,2000])for(const height of [32,400,600,1200]){
    const visible=visibleDockPanels(all,true), frames=dockFrames(tree,{width,height},visible);
    const rects=Object.values(frames.panels);
    for(const rect of rects){for(const value of Object.values(rect))assert.ok(Number.isFinite(value)&&value>=0);assert.ok(rect.left+rect.width<=width);assert.ok(rect.top+rect.height<=height);}
    for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){
      const a=rects[i],b=rects[j];assert.ok(a.width===0||a.height===0||b.width===0||b.height===0||a.left+a.width<=b.left||b.left+b.width<=a.left||a.top+a.height<=b.top||b.top+b.height<=a.top);
    }
  }
  const viewport={width:1800,height:1000},before=dockFrames(tree,viewport,visibleDockPanels(all,true));
  assert.equal(dockFrames(tree,viewport,visibleDockPanels({...all,assets:false},true)).panels.library,undefined);
  equalRect(dockFrames(tree,viewport,visibleDockPanels(all,true)).panels.library,before.panels.library);
});
test('resizing a nested split changes its ratio without altering other branches; invalid trees are rejected',()=>{
  const tree=defaultDockTree(all,EDIT),visible=visibleDockPanels(all,true),viewport={width:2000,height:1200};
  const frames=dockFrames(tree,viewport,visible),seam=frames.seams.find(s=>s.axis==='y')!;
  const changed=resizeDock(tree,seam.path,.4);
  assert.ok(readDockTree(changed,edit));
  assert.notDeepEqual(dockFrames(changed,viewport,visible).panels.timeline,frames.panels.timeline);
  equalRect(dockFrames(changed,viewport,visible).panels.chat,frames.panels.chat);
  for(const invalid of [{panel:'viewer'}, {...tree,ratio:NaN}, {...tree,size:Infinity},defaultDockTree(DEFAULT_CANVAS_WORKSPACE,CANVAS)])assert.equal(readDockTree(invalid,edit),null);
  for(const invalid of [{panel:'Bad Name'}, {axis:'x',ratio:.5,first:{panel:'viewer'},second:{panel:'viewer'}}])assert.equal(readDockTree(invalid),null);
  assert.ok(readDockTree({axis:'x',ratio:.5,first:{panel:'color-scopes'},second:{panel:'edit:viewer'}}),'any block, by its key');
});
test('drop affordances distinguish nested edges, center swap and the outer workspace edges',()=>{
  const frames=dockFrames(defaultDockTree(all,EDIT),{width:2000,height:1200},visibleDockPanels(all,true));
  const view=frames.panels.viewer!;
  assert.equal(dockDropAt(frames.panels,frames.root,view.left+view.width/2,view.top+view.height/2,'chat')?.edge,'center');
  assert.equal(dockDropAt(frames.panels,frames.root,view.left+2,view.top+view.height/2,'chat')?.edge,'left');
  assert.equal(dockDropAt(frames.panels,frames.root,5,500,'chat')?.target,'root');
  assert.equal(dockDropAt(frames.panels,frames.root,-1,500,'chat'),null);
});

test('library embedding and visibility remain separate and reversible without changing the tree',async()=>{
  const {setDockPanelVisible,setLibraryInsideChat}=await import('./workspace-dock.ts');
  for(const dock of ['left','right','bottom'] as const) {
    const original={...all,libraryDock:dock,tree:defaultDockTree(all,EDIT)};
    const inside=setLibraryInsideChat(original,true,dock);
    assert.equal(inside.libraryDock,'chat');assert.equal(inside.assets,true);
    const hidden=setDockPanelVisible(inside,'library',false,EDIT);
    assert.equal(hidden.assets,false);assert.equal(hidden.libraryDock,'chat');
    assert.equal(setDockPanelVisible(hidden,'library',true,EDIT).libraryDock,'chat');
    assert.deepEqual(setLibraryInsideChat(inside,false,dock),original);
    assert.equal(setLibraryInsideChat(hidden,false,dock).assets,false);
    const parentHidden=setDockPanelVisible(inside,'chat',false,EDIT);
    assert.equal(parentHidden.chat,false);assert.equal(parentHidden.assets,false);
    assert.equal(setDockPanelVisible(parentHidden,'library',true,EDIT).chat,true);
    assert.equal(setDockPanelVisible(inside,'viewer',false,EDIT),inside,'the main block is always shown');
    assert.equal(setDockPanelVisible(inside,'timeline',false,EDIT).blocks.timeline!.open,false);
  }
});
