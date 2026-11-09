/** Real Studio page: docks, persisted mode profiles, portable layouts and media on the canvas. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { filmHtml } from '../src/film-doc.mjs';
import { openProject } from './server/projects.mjs';
import { startStudio } from './server/server.mjs';

const output = process.env.OPENFILM_WORKSPACE_SCREENSHOTS;
async function withWorkspace(run, {hasChat=true}={}) {
  const scratch = await mkdtemp(join(tmpdir(), 'of-workspaces-'));
  const names = ['HOME', 'SHARED_HOME', 'LIBRARY', 'SAVED', 'EXPORTS', 'TRASH_DIR'];
  const saved = new Map(names.map(name => [`OPENFILM_${name}`, process.env[`OPENFILM_${name}`]]));
  for (const name of names) process.env[`OPENFILM_${name}`] = join(scratch, name.toLowerCase());
  let studio, browser;
  try {
    const root = join(process.env.OPENFILM_LIBRARY, 'Workspace');
    await mkdir(join(root, '.film'), { recursive: true });
    await mkdir(join(root, 'assets'), { recursive: true });
    await writeFile(join(root, 'film.html'), filmHtml({ stage: { w: 1280, h: 720 }, tracks: [] }));
    await writeFile(join(root, 'assets', 'sample.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#13b9b2"/></svg>');
    await writeFile(join(root, '.film', 'canvas.json'), JSON.stringify({ nodes: [{ id: 'note', x: 0, y: 0, w: 350, h: 200, text: 'Keep this canvas' }], edges: [] }));
    await mkdir(process.env.OPENFILM_SAVED, { recursive: true });
    await writeFile(join(process.env.OPENFILM_SAVED, 'saved.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
    const project = await openProject(root);
    studio = await startStudio({ port: 0, openBrowser: () => {} });
    browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader'] });
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, locale: 'en-US', reducedMotion: 'reduce' });
    page.setDefaultTimeout(8000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/library', route => route.fulfill({ json: { items: [], groups: {} } }));
    if(hasChat)await page.addInitScript(() => {
      if (window.top !== window) return;
      const state = { bounds: null, open: true, preferredWidth: 420, side: 'left', libraryDock: 'left', assets: { open: false, bottom: 120 } };
      const listeners = new Set();
      const width = () => state.open && state.bounds ? state.bounds.width : state.open ? Math.max(340, Math.min(state.preferredWidth, innerWidth - 640)) : 0;
      const snapshot = () => ({ ...state, width: width(), assets: { ...state.assets } });
      const place = () => {
        let column = document.getElementById('test-chat');
        if (!column && document.body) { column = document.createElement('aside'); column.id = 'test-chat'; column.dataset.studioHostPanel = ''; column.textContent = 'Conversation stays visible'; document.body.append(column); }
        if (column) { column.hidden = !state.open; column.style.cssText = `position:fixed;${state.bounds ? `left:${state.bounds.left}px;top:${state.bounds.top}px;height:${state.bounds.height}px` : `top:32px;bottom:0;${state.side}:0`};width:${width()}px;background:#1c2024;color:#ddd;z-index:40;padding:20px;box-sizing:border-box`; }
        for (const listener of listeners) listener(snapshot());
      };
      window.openfilmHost = { version: 1, name: 'Test', panel: {
        label: 'Chat', get open() { return state.open; }, get width() { return width(); }, get preferredWidth() { return state.preferredWidth; }, get assets() { return state.assets; },
        setOpen: open => { state.open = open; place(); }, setAssetsOpen: open => { state.assets = { ...state.assets, open }; place(); },
        setBounds: bounds => { state.bounds=bounds;place(); },
        setWidth: width => { state.preferredWidth = width; place(); }, setPlacement: next => { Object.assign(state,next); place(); },
        onChange: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      } };
      addEventListener('DOMContentLoaded', place); addEventListener('resize', place);
    });
    await page.goto(`${studio.origin}/projects/${project.id}?key=${studio.key}`);
    await page.locator('[data-work-mode="edit"]').waitFor();
    try { await run(page); assert.deepEqual(errors, []); }
    catch (error) {
      console.error('Workspace failure:', await page.evaluate(() => ({ text: document.body.innerText.slice(-2200), profile: localStorage.getItem('openfilm.workspace.current.v2') })), errors);
      if (output) await page.screenshot({ path: join(output, 'workspace-failure.png') });
      throw error;
    }
  } finally {
    await browser?.close(); await studio?.close();
    for (const [name,value] of saved) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    await rm(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
const library = page => page.locator('[data-workspace-library]');
const menu = page => page.locator('[data-layout-menu]');
async function openLayout(page) { if (!await menu(page).count()) await page.getByRole('button', { name: 'Layout', exact: true }).click(); return menu(page); }
async function closeLayout(page) { if (await menu(page).count()) await page.keyboard.press('Escape'); }
async function rect(locator) { const value = await locator.boundingBox(); assert.ok(value); return value; }
async function profile(page, mode = 'edit', { hasTree, libraryDock, changedFrom } = {}) {
  await page.waitForFunction(({ mode, hasTree, libraryDock, changedFrom }) => {
    const value = JSON.parse(localStorage.getItem('openfilm.workspace.current.v2') ?? 'null')?.[mode];
    return value && (hasTree === undefined || Boolean(value.tree) === hasTree)
      && (libraryDock === undefined || value.libraryDock === libraryDock)
      && (changedFrom === undefined || JSON.stringify(value) !== changedFrom);
  }, { mode, hasTree, libraryDock, changedFrom });
  return page.evaluate(mode => JSON.parse(localStorage.getItem('openfilm.workspace.current.v2'))[mode], mode);
}
async function shot(page, name) { if (output) await page.screenshot({ path: join(output,name) }); }

const editor = page => page.locator('[data-workspace-editor]');
async function beginEdit(page) { await openLayout(page); await menu(page).getByRole('button',{name:'Edit layout',exact:true}).click(); await editor(page).waitFor(); }
async function dragPanel(page, source, target, edge) {
  const grip=editor(page).locator(`[data-layout-panel=${source}]`);
  const from=await rect(grip),to=await rect(editor(page).locator(`[data-layout-panel=${target}]`));
  const x=edge==='left'?to.x+25:edge==='right'?to.x+to.width-25:to.x+to.width/2;
  const y=edge==='top'?to.y+25:edge==='bottom'?to.y+to.height-25:to.y+to.height/2;
  await page.mouse.move(from.x+from.width*.8,from.y+from.height*.55);await page.mouse.down();
  await page.mouse.move(x,y,{steps:12});
  assert.equal(await page.locator('[data-layout-drop]').getAttribute('data-layout-drop'),`${target}:${edge}`);
  await page.mouse.up();
}

test('normal panels have no new library header and every preset stays in the current work mode', { timeout:60_000 },async()=>{
  await withWorkspace(async page=>{
    assert.equal(await editor(page).count(),0);
    const layout=await openLayout(page);
    await layout.getByText('Edit layouts',{exact:true}).waitFor();
    assert.equal(await layout.getByRole('button',{name:'Canvas',exact:true}).count(),0);
    assert.equal(await layout.getByRole('switch').count(),0);
    for(const preset of ['Library','Focus','Default']) {
      await layout.getByRole('button',{name:preset,exact:true}).click();
      assert.equal(await page.locator('[data-work-mode="edit"]').count(),1);
      assert.equal(await editor(page).count(),0);
      if(preset==='Library') {
        assert.equal(await library(page).isVisible(),true);
        assert.equal(await library(page).getByRole('button',{name:'Dock left',exact:true}).count(),0);
        const nav=await rect(library(page).locator('[data-studio-library] nav').first());
        assert.ok(nav.y-(await rect(library(page))).y<3,'original category navigation starts at the top');
      }
    }
    await closeLayout(page);await page.locator('[data-work-mode="edit"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-studio-canvas]')?.dataset.canvasReady==='1');
    await openLayout(page);await layout.getByText('Canvas layouts',{exact:true}).waitFor();
    assert.equal(await layout.getByRole('button',{name:'Editing',exact:true}).count(),0);
    for(const preset of ['Library','Focus','Default']){
      await layout.getByRole('button',{name:preset,exact:true}).click();
      assert.equal(await page.locator('[data-work-mode="canvas"]').count(),1);
    }
    await closeLayout(page);
  });
});

test('edit mode moves real panels into nested splits, supports undo and cancel, and never persists a draft', { timeout:60_000 },async()=>{
  await withWorkspace(async page=>{
    const before=await profile(page),viewer=await rect(page.locator('[data-viewer-pane]'));
    await beginEdit(page);
    assert.equal(await page.locator('[data-work-mode="edit"]').isDisabled(),true);
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(()=>Boolean(document.activeElement?.closest('[data-workspace-editor]'))),true);
    await dragPanel(page,'timeline','viewer','left');
    const timeline=await rect(page.locator('[data-workspace-timeline]')),view=await rect(page.locator('[data-viewer-pane]'));
    assert.ok(timeline.x<view.x);assert.equal(timeline.y,view.y);assert.equal(timeline.height,view.height);
    await editor(page).getByRole('switch',{name:'Library inside chat'}).click();
    await editor(page).locator('[data-layout-palette=library]').click();
    await dragPanel(page,'library','viewer','bottom');
    assert.equal(await library(page).isVisible(),true);
    assert.equal(await editor(page).locator('[data-layout-palette=library]').getAttribute('aria-pressed'),'true');
    await editor(page).getByRole('button',{name:'Hide Inspector',exact:true}).click();
    assert.equal(await page.locator('[data-workspace-inspector]').count(),0);
    await editor(page).getByRole('button',{name:'Undo layout change'}).click();
    assert.equal(await page.locator('[data-workspace-inspector]').count(),1);
    await page.keyboard.press('Meta+z');
    assert.equal(await library(page).isVisible(),true,'undoing movement keeps visibility');
    await page.keyboard.press('Meta+z');
    assert.equal(await library(page).isVisible(),false);
    await editor(page).getByRole('button',{name:'Redo layout change'}).click();
    assert.equal(await library(page).isVisible(),true);
    await editor(page).getByRole('button',{name:'Redo layout change'}).click();
    const seam=page.locator('[data-workspace-seam=""]'),edge=await rect(seam),oldChat=await rect(page.locator('#test-chat'));
    await page.mouse.move(edge.x+edge.width/2,edge.y+100);await page.mouse.down();
    await page.mouse.move(edge.x+50,edge.y+100,{steps:8});
    assert.ok((await rect(page.locator('#test-chat'))).width>oldChat.width+35,'resizing is visible before release');
    await page.mouse.up();
    assert.deepEqual(await profile(page),before,'draft changes never reach persisted profiles');
    await shot(page,'workspace-editor-redesign.png');
    await editor(page).getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await editor(page).count(),0);assert.equal(await library(page).isVisible(),false);
    assert.deepEqual(await rect(page.locator('[data-viewer-pane]')),viewer);
    assert.deepEqual(await profile(page),before);
    await beginEdit(page);
    const grip=editor(page).locator('[data-layout-panel=viewer]'),at=await rect(grip);
    await page.mouse.move(at.x+at.width/2,at.y+at.height/2);await page.mouse.down();await page.mouse.move(900,450,{steps:10});
    await page.keyboard.press('Escape');await page.mouse.up();
    assert.equal(await editor(page).count(),1,'Escape cancels the drag before cancelling the edit');
    assert.equal(await library(page).isVisible(),false,'cancelling a panel drag leaves visibility unchanged');
    await page.keyboard.press('Escape');assert.equal(await editor(page).count(),0);
  });
});

test('finished layouts move chat and all panel boundaries, persist and restore independently for edit and canvas', { timeout:60_000 },async()=>{
  await withWorkspace(async page=>{
    await beginEdit(page);
    await editor(page).getByRole('button',{name:'Move Chat',exact:true}).press('ArrowDown');
    await editor(page).getByRole('switch',{name:'Library inside chat'}).click();
    await editor(page).locator('[data-layout-palette=library]').click();
    await editor(page).locator('[data-layout-palette=layers]').click();
    await dragPanel(page,'layers','inspector','top');
    await editor(page).getByRole('button',{name:'Done',exact:true}).click();
    assert.equal(await editor(page).count(),0);
    const chat=await rect(page.locator('#test-chat'));
    assert.equal(chat.x,0);assert.equal(chat.width,1800);assert.equal(chat.y+chat.height,1100);
    const beforeHeight=chat.height, beforeResize=JSON.stringify(await profile(page,'edit',{hasTree:true}));
    await page.locator('[data-workspace-seam=""]').focus();await page.keyboard.press('ArrowDown');
    assert.ok((await rect(page.locator('#test-chat'))).height<beforeHeight,'a split resizes actual native chat bounds');
    const edit=await profile(page,'edit',{hasTree:true,changedFrom:beforeResize});assert.ok(edit.tree);
    await page.reload();await page.locator('[data-work-mode="edit"]').waitFor();
    assert.deepEqual(await profile(page),edit);
    assert.equal((await rect(page.locator('#test-chat'))).width,1800);
    await page.locator('[data-work-mode="edit"]').click();
    await page.waitForFunction(()=>document.querySelector('[data-studio-canvas]')?.dataset.canvasReady==='1');
    assert.equal(await library(page).isVisible(),false);
    assert.equal((await profile(page,'canvas')).tree,null);
    await beginEdit(page);
    assert.equal(await editor(page).locator('[data-layout-palette]').count(),2);
    await editor(page).getByRole('switch',{name:'Library inside chat'}).click();
    await editor(page).locator('[data-layout-palette=library]').click();
    await editor(page).getByRole('button',{name:'Move Library',exact:true}).press('ArrowUp');
    await editor(page).getByRole('button',{name:'Done',exact:true}).click();
    const canvas=await profile(page,'canvas',{hasTree:true});assert.ok(canvas.tree);
    assert.equal((await rect(library(page))).y,32);
    assert.equal((await rect(library(page))).width,1800);
    assert.equal(await page.locator('.react-flow__node').count(),1);
    await page.waitForFunction(()=>{const node=document.querySelector('.react-flow__node')?.getBoundingClientRect(),canvas=document.querySelector('[data-studio-canvas]')?.getBoundingClientRect();return node&&canvas&&node.left<canvas.right&&node.right>canvas.left&&node.top<canvas.bottom&&node.bottom>canvas.top;});
    await shot(page,'workspace-canvas-redesign.png');
    await page.locator('[data-work-mode="canvas"]').click();
    assert.deepEqual(await profile(page),edit);
    assert.equal((await rect(page.locator('#test-chat'))).width,1800);
    assert.deepEqual(await profile(page,'canvas'),canvas);
    await page.setViewportSize({width:980,height:600});
    await page.waitForFunction(() => ['#test-chat','[data-viewer-pane]','[data-workspace-timeline]','[data-workspace-library]'].every(selector => {
      const box=document.querySelector(selector)?.getBoundingClientRect();
      return box && box.left>=0 && box.top>=32 && box.right<=980 && box.bottom<=600;
    }));
    for(const selector of ['#test-chat','[data-viewer-pane]','[data-workspace-timeline]','[data-workspace-library]']){
      const box=await rect(page.locator(selector));assert.ok(box.x>=0&&box.y>=32&&box.x+box.width<=980&&box.y+box.height<=600);
    }
    assert.deepEqual(await profile(page),edit,'compact-window fitting never overwrites the saved tree');
  });
});

test('named layouts keep full split trees through updates, rename, undo deletion, import and export', { timeout:60_000 },async()=>{
  await withWorkspace(async page=>{
    await beginEdit(page);await dragPanel(page,'timeline','viewer','left');
    await editor(page).getByRole('button',{name:'Done',exact:true}).click();
    const layout=await openLayout(page);
    await layout.getByRole('button',{name:'Save current layout',exact:true}).click();
    await layout.getByRole('textbox',{name:'Layout name'}).fill('My edit');await layout.getByRole('button',{name:'Save',exact:true}).click();
    assert.equal(await layout.getByRole('button',{name:'My edit',exact:true}).getAttribute('aria-pressed'),'true');
    await layout.getByRole('button',{name:'Options for My edit'}).click();await layout.getByRole('button',{name:'Rename',exact:true}).click();
    await layout.getByRole('textbox',{name:'Layout name'}).fill('Cutting');await layout.getByRole('button',{name:'Save',exact:true}).click();
    const download=page.waitForEvent('download');await layout.getByRole('button',{name:'Export',exact:true}).click();const exported=await download;
    await layout.getByRole('button',{name:'Options for Cutting'}).click();await layout.getByRole('button',{name:'Delete',exact:true}).click();
    await layout.getByRole('button',{name:'Undo delete',exact:true}).click();
    await layout.getByRole('button',{name:'Focus',exact:true}).click();await layout.getByRole('button',{name:'Cutting',exact:true}).click();
    assert.equal(await layout.getByRole('button',{name:'Cutting',exact:true}).getAttribute('aria-pressed'),'true');
    await layout.locator('input[type=file]').setInputFiles(await exported.path());
    assert.equal(await layout.getByRole('button',{name:'Cutting',exact:true}).count(),1);
    await shot(page,'workspace-menu-redesign.png');
    await closeLayout(page);
    assert.ok((await rect(page.locator('[data-workspace-timeline]'))).x<(await rect(page.locator('[data-viewer-pane]'))).x);
  });
});

test('library placement is a reversible separate switch and visibility never changes placement', {timeout:60_000},async()=>{
  await withWorkspace(async page=>{
    for(const mode of ['edit','canvas']){
      if(mode==='canvas'){await page.locator('[data-work-mode=edit]').click();await page.waitForFunction(()=>document.querySelector('[data-studio-canvas]')?.dataset.canvasReady==='1');}
      await beginEdit(page);
      const visibility=editor(page).locator('[data-layout-palette=library]'),inside=editor(page).getByRole('switch',{name:'Library inside chat'});
      assert.equal(await inside.getAttribute('aria-checked'),'true');
      assert.equal(await editor(page).locator('[data-layout-palette] .lucide-grip-vertical').count(),0,'visibility controls are not drag handles');
      const row=await rect(editor(page).locator('[data-layout-integration]')),chips=await rect(editor(page).locator('[aria-label="Visible panels"]'));
      assert.ok(row.y>=chips.y+chips.height,'placement occupies its own row');
      await visibility.click();assert.equal(await library(page).isVisible(),true);assert.equal(await visibility.getAttribute('aria-pressed'),'true');
      assert.equal(await inside.getAttribute('aria-checked'),'true');
      await visibility.click();assert.equal(await library(page).isVisible(),false);assert.equal(await inside.getAttribute('aria-checked'),'true');
      await inside.click();assert.equal(await library(page).isVisible(),false,'placement does not force a hidden library open');
      await visibility.click();
      const outside=await rect(library(page));
      for(let i=0;i<3;i++){
        await inside.click();assert.equal(await inside.getAttribute('aria-checked'),'true');
        assert.equal(await library(page).isVisible(),true);assert.equal(await visibility.getAttribute('aria-pressed'),'true');
        assert.equal(await editor(page).locator('[data-layout-panel=library]').count(),0,'inside chat is not a separate dock');
        await visibility.click();assert.equal(await library(page).isVisible(),false);
        await visibility.click();assert.equal(await library(page).isVisible(),true);
        await inside.click();assert.equal(await inside.getAttribute('aria-checked'),'false');
        assert.deepEqual(await rect(library(page)),outside,'turning placement off restores the independent slot');
      }
      await editor(page).getByRole('button',{name:'Done',exact:true}).click();
      assert.equal((await profile(page,mode,{libraryDock:'left'})).libraryDock,'left');
      await beginEdit(page);assert.equal(await editor(page).getByRole('switch',{name:'Library inside chat'}).getAttribute('aria-checked'),'false');
      await editor(page).getByRole('button',{name:'Done',exact:true}).click();
    }
  });
});

test('preset thumbnail panel bounds match actual panels at the current window size, mode and host', {timeout:90_000},async()=>{
  for(const hasChat of [true,false])await withWorkspace(async page=>{
    for(const viewport of [{width:1800,height:1100},{width:1000,height:700}]){
      await page.setViewportSize(viewport);
      for(const mode of ['edit','canvas']){
        if(!await page.locator(`[data-work-mode=${mode}]`).count())await page.locator('[data-work-mode]').click();
        if(mode==='canvas')await page.waitForFunction(()=>document.querySelector('[data-studio-canvas]')?.dataset.canvasReady==='1');
        const layout=await openLayout(page);
        for(const preset of ['Default','Library','Focus']){
          const button=layout.getByRole('button',{name:preset,exact:true});
          await button.click();await page.waitForTimeout(100);
          const svg=button.locator('[data-workspace-preview]');
          assert.equal(await svg.getAttribute('viewBox'),`0 0 ${viewport.width} ${viewport.height}`);
          const bounds=await svg.locator('[data-preview-panel]').evaluateAll(items=>items.map(el=>({panel:el.dataset.previewPanel,x:Number(el.getAttribute('x')),y:Number(el.getAttribute('y')),width:Number(el.getAttribute('width')),height:Number(el.getAttribute('height'))})));
          assert.equal(bounds.some(r=>r.panel==='chat'),hasChat&&preset==='Default');
          const selectors={chat:'#test-chat',viewer:'[data-viewer-pane]',canvas:'[data-studio-canvas]',library:'[data-workspace-library]',inspector:'[data-workspace-inspector]',layers:'[data-workspace-layers]',timeline:'[data-workspace-timeline]'};
          for(const expected of bounds){
            const actual=await rect(page.locator(selectors[expected.panel]));
            for(const key of ['x','y','width','height'])assert.ok(Math.abs(actual[key]-expected[key])<=2,`${mode}/${preset}/${hasChat}/${viewport.width} ${expected.panel}.${key}: actual ${actual[key]}, preview ${expected[key]}`);
          }
        }
        await closeLayout(page);
      }
    }
  },{hasChat});
});
