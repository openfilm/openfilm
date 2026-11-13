import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspacePreviewFrames,dockedSizes,type BlockRoom,type BlockSizer} from './workspace-preview.ts';
import {arrangementSpecs} from './blocks.ts';
import {defaultWorkspace,type WorkspaceLayout} from './workspaces.ts';
import {CANVAS,DEFAULT_WORKSPACE,DEFAULT_CANVAS_WORKSPACE,EDIT} from './test-arrangements.ts';

/* a sizer as the edit's: the timeline fitted (at most 45% of the column), the inspector left out of a narrow row while idle */
const editLike=(fit:number,idle:boolean):BlockSizer=>(room,places)=>{
  const inspector=Boolean(places.inspector?.open)&&!(room.width>0&&room.width<880&&idle);
  const width=room.width&&inspector?Math.max(200,Math.min(places.inspector!.size??360,room.width-288)):places.inspector?.size??360;
  return {viewer:{shown:true,size:0},inspector:{shown:inspector,size:width},layers:{shown:Boolean(places.layers?.open),size:places.layers?.size??240},
    timeline:{shown:Boolean(places.timeline?.open),size:places.timeline?.size??Math.min(fit,Math.max(104,Math.round(room.height*.45)))}};
};
const sizes=(sizer?:BlockSizer)=>(layout:WorkspaceLayout)=>(room:BlockRoom)=>dockedSizes(layout.mode==='canvas'?CANVAS:EDIT,layout,room,null,()=>sizer,()=>'');
const frames=(layout:WorkspaceLayout,viewport:{width:number;height:number},hasChat:boolean,sizer?:BlockSizer)=>workspacePreviewFrames(layout,layout.mode==='canvas'?CANVAS:EDIT,viewport,{hasChat,sizes:sizes(sizer)(layout)});

test('preset previews respect the host, actual window and idle inspector fitting',()=>{
  const viewport={width:1000,height:700};
  const desktop=frames(DEFAULT_WORKSPACE,viewport,true,editLike(200,true));
  assert.equal(desktop.chat?.width,360);
  assert.equal(desktop.inspector,undefined);
  assert.equal(desktop.viewer?.left,360);
  const browser=frames(DEFAULT_WORKSPACE,viewport,false,editLike(200,true));
  assert.equal(browser.chat,undefined);assert.equal(browser.viewer?.left,0);assert.equal(browser.inspector?.width,360);
  const selected=frames(DEFAULT_WORKSPACE,viewport,true,editLike(200,false));
  assert.equal(selected.inspector?.width,352);
});
test('preview timeline height follows the content fit and short-window constraints; canvas has no edit panels',()=>{
  const tall=frames(DEFAULT_WORKSPACE,{width:1800,height:1100},true,editLike(400,true));
  assert.equal(tall.timeline?.height,400);
  assert.equal(tall.timeline!.top,tall.viewer!.top+tall.viewer!.height+1);
  const short=frames({...DEFAULT_WORKSPACE,libraryDock:'bottom',assets:true},{width:1800,height:600},true,editLike(400,true));
  assert.equal(short.library?.height,208);
  assert.ok(short.viewer!.height>=104);
  const canvas=frames(DEFAULT_CANVAS_WORKSPACE,{width:1800,height:1100},true);
  assert.equal(canvas.timeline,undefined);assert.equal(canvas.inspector,undefined);assert.ok(canvas.canvas);
});

test('a narrow preview keeps every panel inside the window it stands for',()=>{
  const viewport={width:320,height:200};
  const shown=frames(DEFAULT_WORKSPACE,viewport,true,editLike(200,false));
  for(const [panel,rect] of Object.entries(shown)){
    const r=rect!;
    assert.ok(r.left>=0&&r.top>=0,`${panel} starts outside the window`);
    assert.ok(r.left+r.width<=viewport.width,`${panel} reaches past the right edge`);
    assert.ok(r.top+r.height<=viewport.height,`${panel} reaches past the bottom edge`);
  }
});

test('blocks of a workbench without a sizer are drawn as declared, within the room the main block keeps',()=>{
  const spec=arrangementSpecs([
    {workbench:'edit',blocks:[{id:'viewer',edge:'center',min:[240,220]},{id:'timeline',edge:'bottom',min:[240,104],range:[104,1600]}]},
    {workbench:'color',blocks:[{id:'scopes',edge:'left',size:300,min:[200,120]},{id:'wheels',edge:'bottom',size:220,min:[240,120]},'edit:viewer','edit:timeline']},
  ]).get('color')!;
  const layout=defaultWorkspace(spec);
  const drawn=dockedSizes(spec,layout,{width:1000,height:700},null,(owner)=>owner==='edit'?(()=>({viewer:{shown:true,size:0},timeline:{shown:true,size:180}})):undefined,(b)=>`Resize ${b.id}`);
  assert.deepEqual(drawn.scopes,{shown:true,size:300,seam:{min:200,minRest:240,label:'Resize scopes'}});
  assert.deepEqual(drawn['edit:timeline'],{shown:true,size:180});
  const panels=workspacePreviewFrames(layout,spec,{width:1000,height:700},{hasChat:false,sizes:(room)=>dockedSizes(spec,layout,room,null,()=>undefined,()=>'')});
  assert.equal(panels.scopes!.width,300);
  assert.equal(panels['edit:viewer']!.left,301);
  assert.ok(panels.wheels!.top>panels['edit:viewer']!.top);
  assert.equal(dockedSizes(spec,layout,{width:400,height:700},null,()=>undefined,()=>'').scopes!.size,200,'a narrow row leaves the main block its room, not less than the block\'s smallest');
});
