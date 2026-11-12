import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_WORKSPACE,DEFAULT_CANVAS_WORKSPACE} from './workspaces.ts';
import {workspacePreviewFrames} from './workspace-preview.ts';

test('preset previews respect the host, actual window and idle inspector fitting',()=>{
  const viewport={width:1000,height:700};
  const desktop=workspacePreviewFrames(DEFAULT_WORKSPACE,viewport,{hasChat:true});
  assert.equal(desktop.chat?.width,360);
  assert.equal(desktop.inspector,undefined);
  assert.equal(desktop.viewer?.left,360);
  const browser=workspacePreviewFrames(DEFAULT_WORKSPACE,viewport,{hasChat:false});
  assert.equal(browser.chat,undefined);assert.equal(browser.viewer?.left,0);assert.equal(browser.inspector?.width,360);
  const selected=workspacePreviewFrames(DEFAULT_WORKSPACE,viewport,{hasChat:true,inspectorIdle:false});
  assert.equal(selected.inspector?.width,352);
});
test('preview timeline height follows the content fit and short-window constraints; canvas has no edit panels',()=>{
  const options={hasChat:true,timelineFitHeight:400};
  const tall=workspacePreviewFrames(DEFAULT_WORKSPACE,{width:1800,height:1100},options);
  assert.equal(tall.timeline?.height,400);
  const short=workspacePreviewFrames({...DEFAULT_WORKSPACE,libraryDock:'bottom',assets:true},{width:1800,height:600},options);
  assert.equal(short.library?.height,208);
  assert.ok(short.viewer!.height>=220);
  const canvas=workspacePreviewFrames(DEFAULT_CANVAS_WORKSPACE,{width:1800,height:1100},options);
  assert.equal(canvas.timeline,undefined);assert.equal(canvas.inspector,undefined);assert.ok(canvas.canvas);
});

test('a narrow preview keeps every panel inside the window it stands for',()=>{
  const viewport={width:320,height:200};
  const frames=workspacePreviewFrames(DEFAULT_WORKSPACE,viewport,{hasChat:true,inspectorIdle:false});
  for(const [panel,rect] of Object.entries(frames)){
    const r=rect!;
    assert.ok(r.left>=0&&r.top>=0,`${panel} starts outside the window`);
    assert.ok(r.left+r.width<=viewport.width,`${panel} reaches past the right edge`);
    assert.ok(r.top+r.height<=viewport.height,`${panel} reaches past the bottom edge`);
  }
});
