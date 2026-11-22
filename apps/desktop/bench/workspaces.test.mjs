/** A throwaway desktop instance verifies the native chat and independent library together. No model request. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { filmHtml } from '../../../packages/openfilm/src/film-doc.mjs';
import { saveSessions } from '../src/chat-store.mjs';
import { launch, prepare, quit, waitForCdp } from './app.mjs';

async function until(read, ms = 30_000) {
  const end = Date.now()+ms;
  while (Date.now()<end) { const result = await read().catch(()=>null); if (result) return result; await new Promise(done=>setTimeout(done,100)); }
  throw new Error('Timed out waiting for desktop workspace');
}
async function port() { const server = createServer(); await new Promise(done=>server.listen(0,'127.0.0.1',done)); const value=server.address().port; await new Promise(done=>server.close(done)); return value; }

async function chooseMode(page, mode) {
  const tab = page.locator(`[data-titlebar] [data-workbench-tab="${mode}"]`);
  if (await tab.count()) await tab.click();
  else {
    await page.locator('[data-titlebar] [data-add-workbench]').click();
    await page.locator('[data-new-workbench-page]').locator(`[data-mode-option="${mode}"]`).click();
  }
  await page.locator(`[data-titlebar] [data-workbench-tab="${mode}"][aria-selected="true"]`).waitFor();
}

async function openSidebar(page) {
  await page.bringToFront();
  const sidebar = page.locator('[data-project-sidebar]');
  if (await sidebar.isVisible()) return sidebar;
  // The OS pointer can already be at this corner when the project window opens.
  await page.locator('[data-titlebar] [data-add-workbench]').hover();
  await page.locator('[data-project-sidebar-trigger]').first().hover();
  await sidebar.waitFor();
  return sidebar;
}

async function closeSidebar(page) {
  const sidebar = page.locator('[data-project-sidebar]');
  await page.mouse.move(700, 22);
  if (await sidebar.isVisible()) await page.keyboard.press('Escape');
  await sidebar.waitFor({ state: 'hidden' });
}

/** Check the painted frame with the chat docked on either side of the editor. */
async function assertDarkChatFrame(page) {
  // Measure the resting divider after the keyboard resize check.
  await page.locator('[data-add-workbench]').focus();
  const selected = page.locator('[data-workbench-tabs] [aria-selected="true"]');
  await selected.hover();
  const chat = await page.locator('#of-chat').boundingBox();
  const width = await page.evaluate(() => innerWidth);
  const onLeft = chat.x === 0;
  const edge = Math.round(onLeft ? chat.x + chat.width - 1 : chat.x);
  const chatX = Math.round(chat.x + chat.width * 0.7);
  const editorX = Math.round(onLeft ? (edge + width) / 2 : edge / 2);
  const tabList = await page.locator('[data-workbench-tabs] [role=tablist]').boundingBox();
  const firstEdge = Math.round(tabList.x);
  const tab = await selected.boundingBox();
  const tabX = Math.round(tab.x + 4);
  const bottom = chat.y - 1;
  const png = await page.screenshot({ scale: 'css', clip: { x: 0, y: 0, width, height: chat.y + 4 } });
  const colors = await page.evaluate(async ({ data, samples }) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);
    return samples.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3));
  }, { data: png.toString('base64'), samples: [
    [chatX, bottom - 1], [chatX, bottom], [chatX, bottom + 1], [chatX, bottom + 2],
    [editorX, bottom - 1], [editorX, bottom], [editorX, bottom + 1],
    [edge - 1, 2], [edge, 2], [edge + 1, 2],
    [edge - 1, bottom + 3], [edge, bottom + 3], [edge + 1, bottom + 3],
    [tabX, bottom - 1], [tabX, bottom], [tabX, bottom + 1],
    [firstEdge, 2], [firstEdge + 1, 2],
  ] });
  const surface = [25, 25, 25], black = [0, 0, 0];
  assert.deepEqual(colors.slice(0, 4), [surface, surface, surface, surface], 'the chat title and body meet without a line');
  const gray = [43, 43, 43];
  assert.deepEqual(colors.slice(4, 7), [[32, 32, 32], gray, surface], 'the editor has a one-pixel gray rule');
  assert.deepEqual(colors.slice(13, 16), [surface, surface, surface], 'the selected tab joins the workbench without a rule');
  assert.deepEqual(colors[16], gray, 'a gray rule marks the leading edge of the tabs');
  assert.notDeepEqual(colors[17], gray, 'the leading rule is one pixel wide');
  for (const [offset, label] of [[7, 'between titles'], [10, 'between panels']]) {
    assert.notDeepEqual(colors[offset], black, label);
    assert.deepEqual(colors[offset + 1], black, label);
    assert.notDeepEqual(colors[offset + 2], black, label);
  }
}

async function checkNavigation(page, chat, output) {
  const titlebar = page.locator('[data-titlebar]');
  const header = titlebar.locator('[data-chat-header]');
  const title = header.locator('[data-conversation-title] button');
  const trigger = page.locator('[data-project-sidebar-trigger]').first();
  const sidebar = page.locator('[data-project-sidebar]');
  const navigator = sidebar.locator('[data-project-navigator]');
  const popup = page.locator('[data-conversation-menu]');
  const edit = titlebar.locator('[data-workbench-tab="edit"]');
  const canvas = titlebar.locator('[data-workbench-tab="canvas"]');
  const actions = titlebar.locator('[data-workbench-actions]');
  const layout = actions.locator('[data-layout-trigger]');
  const disclosure = navigator.locator('[data-project-tab]').filter({
    has: page.locator('[data-navigation-project][aria-current="page"]'),
  }).locator('[data-navigation-disclosure]');
  const currentProject = page.url();
  await title.waitFor();
  await page.locator('[data-viewer-pane]').waitFor();
  assert.equal(await edit.getAttribute('aria-selected'), 'true');
  assert.equal(await sidebar.isVisible(), false);
  assert.equal(await header.locator('[data-layout-trigger]').count(), 0);
  assert.equal(await actions.getByRole('button').first().getAttribute('data-layout-trigger'), 'true');
  assert.deepEqual(await edit.evaluate(tab => {
    const style = getComputedStyle(tab.parentElement);
    return [style.minWidth, style.borderRadius];
  }), ['120px', '0px'], 'workbench tabs use the v0.4.1 shape and minimum width');
  const divider = chat.getByRole('separator', { name: 'Resize the chat' });
  for (const key of [null, 'ArrowRight', 'ArrowLeft']) {
    if (key) await divider.press(key);
    const [bar, conversation] = await Promise.all([titlebar.boundingBox(), chat.boundingBox()]);
    assert.equal(bar.height, 32);
    assert.equal(conversation.x, 0);
    assert.equal(conversation.y, bar.y + bar.height);
    const [left, label, control] = await Promise.all([header, title, layout].map(item => item.boundingBox()));
    assert.ok(Math.abs((label.x + label.width / 2) - (left.x + left.width / 2)) <= 1, 'the title stays centered while the chat resizes');
    assert.ok(control.x >= left.x + left.width, 'layout belongs to the editor header');
    const group = await actions.boundingBox();
    assert.ok(Math.abs(group.x - control.x) <= 1, 'layout comes first in the right-aligned tools');
  }
  const original = await chat.boundingBox();
  const viewer = page.locator('[data-viewer-pane]');
  const originalViewer = await viewer.boundingBox();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await assertDarkChatFrame(page);
  await openSidebar(page);
  assert.equal(await sidebar.evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(33, 33, 33)');
  const saved = navigator.locator('[data-navigation-session="storyboard"]');
  assert.equal(await disclosure.getAttribute('aria-expanded'), 'false');
  await disclosure.click();
  await saved.hover();
  assert.equal(await saved.getAttribute('aria-current'), 'page');
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-project-sidebar]')?.getBoundingClientRect();
    return box && box.x === 0 && box.y === 0 && box.width === 224 && box.bottom === innerHeight;
  });
  assert.deepEqual(await chat.boundingBox(), original, 'previewing the sidebar keeps the conversation in place');
  assert.deepEqual(await viewer.boundingBox(), originalViewer, 'previewing the sidebar keeps the editor in place');
  if (output) await page.screenshot({ path: join(output, 'desktop-project-sidebar.png') });
  await edit.hover();
  await sidebar.waitFor({ state: 'hidden' });

  // Clicking a preview gives navigation its own column, and leaving it keeps it docked.
  await openSidebar(page);
  await trigger.click();
  const dockedSidebar = page.locator('[data-project-sidebar][data-docked]');
  await dockedSidebar.waitFor();
  const sidebarBox = await dockedSidebar.boundingBox();
  const dockedChat = await chat.boundingBox();
  assert.equal(dockedChat.x, sidebarBox.x + sidebarBox.width);
  assert.equal((await header.boundingBox()).x, dockedChat.x);
  assert.ok((await viewer.boundingBox()).x >= dockedChat.x + dockedChat.width);
  await edit.click();
  assert.equal(await dockedSidebar.isVisible(), true);
  if (output) await page.screenshot({ path: join(output, 'desktop-project-sidebar-docked.png') });

  await titlebar.locator('[data-add-workbench]').click();
  const chooser = page.locator('[data-new-workbench-page]');
  await chooser.waitFor();
  assert.equal((await chooser.boundingBox()).x, dockedChat.x + dockedChat.width);
  await chooser.locator('[data-mode-option="edit"]').click();
  assert.deepEqual(await chat.boundingBox(), dockedChat);
  assert.equal(await dockedSidebar.isVisible(), true);

  await trigger.click();
  await sidebar.waitFor({ state: 'hidden' });
  assert.deepEqual(await chat.boundingBox(), original, 'undocking restores the previous conversation bounds');
  assert.deepEqual(await viewer.boundingBox(), originalViewer, 'undocking restores the editor bounds');

  await trigger.click();
  await dockedSidebar.waitFor();
  await trigger.click();
  await sidebar.waitFor({ state: 'hidden' });
  const button = await trigger.boundingBox();
  await page.mouse.move(button.x + 3, button.y + button.height / 2);
  // Keep the pointer in the trigger past the hover delay after an explicit close.
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(await sidebar.isVisible(), false, 'the preview does not reopen under the stationary pointer');

  // A temporary preview still opens on re-entry and closes on exit, even while its search field is focused.
  await openSidebar(page);
  const search = sidebar.getByRole('searchbox');
  await search.click();
  await search.fill('Work');
  await disclosure.waitFor();
  await edit.hover();
  await sidebar.waitFor({ state: 'hidden' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  await navigator.waitFor();
  await page.keyboard.press('Escape');
  await sidebar.waitFor({ state: 'hidden' });

  await openSidebar(page);
  const account = sidebar.locator('[data-account-trigger]');
  assert.ok((await account.boundingBox()).y > original.height * .75);
  await account.click();
  const accountMenu = page.locator('[data-app-menu]');
  await accountMenu.waitFor();
  await page.keyboard.press('Escape');
  await accountMenu.waitFor({ state: 'hidden' });
  await closeSidebar(page);

  await layout.click();
  const layoutMenu = page.locator('[data-layout-menu]');
  await layoutMenu.waitFor();
  const bounds = await layoutMenu.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.y + bounds.height <= await page.evaluate(() => innerHeight));
  await page.keyboard.press('Escape');
  await layoutMenu.waitFor({ state: 'hidden' });

  await title.click();
  assert.equal(await popup.isVisible(), false);
  const name = header.getByRole('textbox', { name: 'Rename' });
  await name.fill('Discard this rename');
  await name.press('Escape');
  await header.getByRole('button', { name: 'Storyboard', exact: true }).waitFor();

  await openSidebar(page);
  if (await disclosure.getAttribute('aria-expanded') === 'false') await disclosure.click();
  await navigator.locator('[data-navigation-session="rough-cut"]').click();
  await sidebar.waitFor({ state: 'hidden' });
  await header.locator('[data-conversation-title="rough-cut"]').waitFor();
  await title.click();
  await name.fill('Rough cut updated');
  await name.press('Enter');
  await header.getByRole('button', { name: 'Rough cut updated' }).waitFor();

  // The sidebar's pages take the place of the chat and the editor, right of it; picked again, the project is back.
  await openSidebar(page);
  await navigator.locator('[data-navigation-page="projects"]').click();
  const library = page.locator('[data-side-page-host="projects"]');
  await library.getByRole('heading', { name: 'Projects', exact: true }).waitFor();
  assert.equal(await page.getByRole('dialog').count(), 0, 'the projects are a page, not a window');
  await openSidebar(page);
  await navigator.locator('[data-navigation-page="community"]').click();
  await page.locator('[data-side-page-host="community"]').waitFor();
  await library.waitFor({ state: 'detached' });
  await openSidebar(page);
  await navigator.locator('[data-navigation-page="community"][aria-current="page"]').click();
  await page.locator('[data-side-page-host]').waitFor({ state: 'detached' });

  // A new native project opens in its own window view. Closing it restores the original conversation.
  await openSidebar(page);
  await navigator.locator('[data-navigation-new-project]').click();
  const opened = await until(async () => page.context().pages().find(p => p.url() !== currentProject && /\/projects\//.test(p.url())));
  await opened.locator('[data-titlebar] [data-workbench-tab="edit"][aria-selected="true"]').waitFor();
  const otherSidebar = await openSidebar(opened);
  const currentRow = otherSidebar.locator('[data-project-tab]').filter({ has: opened.locator('[data-navigation-project][aria-current="page"]') });
  await currentRow.hover();
  await currentRow.locator('[data-project-more]').click();
  await opened.getByRole('menuitem', { name: 'Close tab' }).click();
  await until(async () => opened.isClosed());
  await openSidebar(page);
  const active = navigator.locator('[data-navigation-project][aria-current="page"]');
  assert.equal(await active.getAttribute('data-navigation-project'), new URL(currentProject).pathname.split('/').pop());
  await active.click();
  await sidebar.waitFor({ state: 'hidden' });
  await header.locator('[data-conversation-title="rough-cut"]').waitFor();
  const closeCanvas = titlebar.locator('[data-close-workbench="canvas"]');
  const selectedEdit = titlebar.locator('[data-workbench-tab="edit"][aria-selected="true"]');
  await divider.press('ArrowRight');
  const resized = await chat.boundingBox();
  assert.ok(resized.width > original.width);
  const add = titlebar.locator('[data-add-workbench]');
  const newTab = titlebar.locator('[data-new-workbench-tab]');
  const picker = page.locator('[data-new-workbench-page]');
  await add.click();
  await picker.waitFor();
  assert.equal(await newTab.getAttribute('aria-selected'), 'true');
  assert.equal(await edit.getAttribute('aria-selected'), 'false');
  assert.deepEqual(await chat.boundingBox(), resized, 'the picker keeps the resized conversation in place');
  await edit.click();
  await picker.waitFor({ state: 'hidden' });
  assert.equal(await newTab.getAttribute('aria-selected'), 'false');
  await newTab.click();
  await picker.waitFor();
  await page.keyboard.press('Escape');
  await newTab.waitFor({ state: 'detached' });
  await selectedEdit.waitFor();

  await add.click();
  await picker.locator('[data-mode-option="edit"]').click();
  await newTab.waitFor({ state: 'detached' });
  assert.equal(await edit.count(), 1, 'choosing an open workbench reuses its tab');

  await chooseMode(page, 'canvas');
  await newTab.waitFor({ state: 'detached' });
  await page.locator('[data-studio-canvas]').waitFor();
  assert.deepEqual(await chat.boundingBox(), resized, 'opening another editor keeps the resized conversation in place');
  assert.equal((await header.boundingBox()).width, resized.width);
  assert.equal(await edit.getAttribute('aria-selected'), 'false');
  if (output) await page.screenshot({ path: join(output, 'workspace-canvas-tabs.png') });

  // Closing an inactive tab leaves the selection alone, and closing the active tab returns to its neighbor.
  await divider.press('ArrowRight');
  const canvasSize = await chat.boundingBox();
  await chooseMode(page, 'edit');
  assert.deepEqual(await chat.boundingBox(), canvasSize, 'dragging or resizing in Canvas carries back to Edit');
  await divider.press('ArrowLeft');
  await divider.press('ArrowLeft');
  await canvas.hover();
  await closeCanvas.click();
  await canvas.waitFor({ state: 'detached' });
  await selectedEdit.waitFor();
  await chooseMode(page, 'canvas');
  await canvas.hover();
  await closeCanvas.click();
  await canvas.waitFor({ state: 'detached' });
  await selectedEdit.waitFor();
  assert.deepEqual(await chat.boundingBox(), original);
  // The last editor closes too: the new tab is left, alone, and the editor picked there has its tab again.
  await edit.hover();
  await titlebar.locator('[data-close-workbench="edit"]').click();
  await picker.waitFor();
  assert.equal(await edit.count(), 0);
  assert.equal(await titlebar.locator('[data-close-new-workbench]').isDisabled(), true, 'the new tab alone cannot be closed');
  await picker.locator('[data-mode-option="edit"]').click();
  await newTab.waitFor({ state: 'detached' });
  await selectedEdit.waitFor();

  await chooseMode(page, 'canvas');
  await add.click();
  await canvas.hover();
  await closeCanvas.click();
  await canvas.waitFor({ state: 'detached' });
  assert.equal(await newTab.getAttribute('aria-selected'), 'true', 'closing a background editor keeps the picker open');
  await titlebar.locator('[data-close-new-workbench]').click();
  await selectedEdit.waitFor();
  assert.deepEqual(await chat.boundingBox(), original);
  if (output) await page.screenshot({ path: join(output, 'workspace-editor-tabs.png') });
}

/** Pixel-check adjacent pane edges, with panel contents hidden to distinguish chrome from film imagery. */
async function assertThinSeams(page,label) {
  const samples=await page.evaluate(()=>{
    const selectors={chat:'#of-chat',library:'[data-workspace-library]',viewer:'[data-viewer-pane]',layers:'[data-workspace-layers]',inspector:'[data-workspace-inspector]',timeline:'[data-workspace-timeline]',canvas:'[data-workspace-canvas]'};
    const panes=Object.entries(selectors).flatMap(([name,selector])=>{const el=document.querySelector(selector);if(!el?.checkVisibility({checkVisibilityCSS:true}))return[];const r=el.getBoundingClientRect();return[{name,x:r.left,y:r.top,width:r.width,height:r.height}];});
    const nativeBounds=document.getElementById('of-chat')?.hasAttribute('data-workspace-bounds');
    const bands=[];
    for(let i=0;i<panes.length;i++)for(let j=i+1;j<panes.length;j++){
      const a=panes[i],b=panes[j],[left,right]=a.x<=b.x?[a,b]:[b,a],[top,bottom]=a.y<=b.y?[a,b]:[b,a];
      const overlapY=Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y);
      const overlapX=Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x);
      if(Math.abs(left.x+left.width+1-right.x)<.01&&overlapY>20)bands.push({name:`${left.name}|${right.name}`,vertical:true,x:Math.round(left.x+left.width),y:Math.floor(Math.max(a.y,b.y)+overlapY*.47)});
      if(!nativeBounds&&Math.abs(left.x+left.width-right.x)<.01&&overlapY>20&&(left.name==='chat'||right.name==='chat'))bands.push({name:`${left.name}|${right.name}`,vertical:true,x:Math.round(left.name==='chat'?left.x+left.width-1:right.x),y:Math.floor(Math.max(a.y,b.y)+overlapY*.47)});
      if(Math.abs(top.y+top.height+1-bottom.y)<.01&&overlapX>20)bands.push({name:`${top.name}/${bottom.name}`,vertical:false,x:Math.floor(Math.max(a.x,b.x)+overlapX*.47),y:Math.round(top.y+top.height)});
    }
    const style=document.createElement('style');style.id='divider-pixel-fixture';
    const all=Object.values(selectors).join(',');
    style.textContent=`${all}{background:rgb(70,80,90)!important;box-shadow:none!important;} ${Object.values(selectors).map(selector=>`${selector} > *`).join(',')}{visibility:hidden!important;} .workspace-resize-handle{visibility:visible!important;}`;
    document.head.append(style);
    return {bands,panes,dark:document.documentElement.dataset.theme==='dark',color:getComputedStyle(document.documentElement).getPropertyValue('--dock-line').trim()};
  });
  try {
    assert.ok(samples.bands.length>=2,`${label}: multiple boundaries are exercised`);
    await page.locator('[data-titlebar] [data-add-workbench]').focus();await page.mouse.move(800,16);
    const read=async()=>{
      const png=await page.screenshot({scale:'css'});
      return page.evaluate(async({data,bands,color})=>{
        const img=new Image();img.src=`data:image/png;base64,${data}`;await img.decode();
        const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');
        ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const line=[...ctx.getImageData(0,0,1,1).data];ctx.drawImage(img,0,0);
        return {line,bands:bands.map(b=>({...b,pixels:Array.from({length:7},(_,i)=>[...ctx.getImageData(b.x+(b.vertical?i-3:0),b.y+(b.vertical?0:i-3),1,1).data])}))};
      },{data:png.toString('base64'),...samples});
    };
    const check = result => {
      for (const band of result.bands) {
        const chatEdge = band.vertical && band.name.split('|').includes('chat');
        const line = chatEdge && samples.dark ? [0, 0, 0, 255] : result.line;
        for (let i = 0; i < 7; i++) {
          assert.deepEqual(band.pixels[i], i === 3 ? line : [70, 80, 90, 255],
            `${label} ${band.name}: expected a single-pixel divider at (${band.x}, ${band.y}), offset ${i - 3}; panes ${JSON.stringify(samples.panes)}`);
        }
      }
    };
    check(await read());
    // The enlarged drag target must stay invisible even when hovered.
    await page.mouse.move(samples.bands[0].x,samples.bands[0].y);check(await read());
  } finally {await page.evaluate(()=>document.getElementById('divider-pixel-fixture')?.remove());}
}

test('real desktop panels move and resize in layout edit mode, cancel cleanly, and keep edit/canvas independent', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(),'of-desktop-workspace-'));
  let app, browser, page;
  const errors = [], logs = [];
  try {
    prepare(dir);
    const root=join(dir,'projects','Workspace');
    await mkdir(join(root,'.film'),{recursive:true});
    await writeFile(join(root,'film.html'),filmHtml({stage:{w:1280,h:720},tracks:[]}));
    await writeFile(join(root,'.film','canvas.json'),JSON.stringify({nodes:[{id:'note',x:0,y:0,w:350,h:200,text:'Canvas layout'}],edges:[]}));
    const createdAt = new Date().toISOString();
    saveSessions(root, { last: 'storyboard', sessions: [
      { id: 'storyboard', title: 'Storyboard', turns: 1, createdAt, updatedAt: createdAt },
      { id: 'rough-cut', title: 'Rough cut', turns: 1, createdAt, updatedAt: createdAt },
    ] });
    app=await launch({dir,cdpPort:await port(),log:line=>logs.push(line)});
    await waitForCdp(app.cdp);
    browser=await chromium.connectOverCDP(app.cdp);
    const run=await until(async()=>JSON.parse(await readFile(join(dir,'home','run.json'),'utf8')),60_000);
    const response=await fetch(`${run.origin}/api/open`,{method:'POST',headers:{'content-type':'application/json','x-studio-key':run.key},body:JSON.stringify({path:root,fallback:0})});
    assert.equal(response.ok,true);
    page=await until(async()=>browser.contexts()[0].pages().find(p=>/\/projects\//.test(p.url())));
    page.setDefaultTimeout(10_000);
    page.on('pageerror',error=>errors.push(error.message));
    const lib=page.locator('[data-workspace-library]');
    const chat=page.locator('#of-chat');
    await chat.locator('[data-prompt-editor]').waitFor();
    const output = process.env.OPENFILM_WORKSPACE_SCREENSHOTS;
    if (output) await mkdir(output, { recursive: true });
    await checkNavigation(page, chat, output);

    const meter = page.getByRole('button', { name: 'Audio meters', exact: true });
    const moveMeter = page.getByRole('menuitem', { name: 'Move to right of timeline', exact: true });
    const hideMeter = page.getByRole('menuitem', { name: 'Hide audio meters', exact: true });
    await meter.click();
    await moveMeter.waitFor();
    await hideMeter.waitFor();
    assert.equal(await meter.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator('[data-audio-meters="popover"]').count(), 0);
    assert.deepEqual(await meter.locator('canvas').evaluate(canvas => [canvas.clientWidth, canvas.clientHeight]), [18, 14]);
    await meter.click();
    await moveMeter.waitFor({ state: 'hidden' });
    await meter.press('Enter');
    await moveMeter.waitFor();
    await moveMeter.click();
    const timelineMeter = page.locator('[data-audio-meters="timeline"]');
    await timelineMeter.waitFor();
    await timelineMeter.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move beside timecode', exact: true }).click();
    await meter.waitFor();

    const workspaceWidth = await page.evaluate(() => window.innerWidth);
    assert.equal(await lib.isVisible(),false);
    assert.equal(await chat.getAttribute('data-assets-open'),null);
    const layout=page.locator('[data-layout-menu]'),editor=page.locator('[data-workspace-editor]');
    const openMenu = async () => {
      if (await layout.isVisible()) return;
      await page.locator('[data-workbench-actions] [data-layout-trigger]').click();
      await layout.waitFor();
    };
    const closeMenu = async () => {
      await page.keyboard.press('Escape');
      await layout.waitFor({ state: 'hidden' });
    };
    const beginEdit = async () => {
      await openMenu();
      await layout.getByRole('button', { name: 'Edit layout', exact: true }).click();
      await editor.waitFor();
    };
    const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('openfilm.workspace.current.v3')).arrangements.edit);
    await page.waitForFunction(()=>localStorage.getItem('openfilm.workspace.current.v3')!==null);
    // A saved custom layout can have a real split seam in place of the native chat divider.
    await beginEdit();
    await editor.getByRole('button', {name:'Done', exact:true}).click();
    const seam = await page.locator('[data-workspace-seam=""][aria-orientation="vertical"]').boundingBox();
    const seamX = seam.x + seam.width / 2, seamY = seam.y + seam.height / 2;
    const initialChat = await chat.boundingBox();
    await page.mouse.move(seamX, seamY);
    await page.mouse.down();
    await page.mouse.move(seamX + 48, seamY, {steps: 6});
    await page.mouse.up();
    const customChat = await chat.boundingBox();
    assert.ok(customChat.width > initialChat.width + 40, 'dragging the saved layout seam resizes chat');
    const navigationToggle = page.locator('[data-project-sidebar-trigger]');
    await navigationToggle.click();
    const docked = page.locator('[data-project-sidebar][data-docked]');
    const offset = (await docked.boundingBox()).width;
    assert.equal((await chat.boundingBox()).x, offset, 'custom layouts use the docked sidebar as their left edge');
    await navigationToggle.click();
    await docked.waitFor({ state: 'hidden' });
    assert.deepEqual(await chat.boundingBox(), customChat, 'undocking restores the saved custom split');
    await chooseMode(page, 'canvas');
    assert.equal((await chat.boundingBox()).width, customChat.width, 'custom split carries into a docked workbench');
    await chooseMode(page, 'edit');
    assert.deepEqual(await chat.boundingBox(), customChat, 'switching back restores the same custom side column');
    await openMenu();
    await layout.getByRole('button', {name:'Default', exact:true}).click();
    await closeMenu();
    await page.waitForFunction(() => !JSON.parse(localStorage.getItem('openfilm.workspace.current.v3')).arrangements.edit.tree);

    const before=await stored(),chatBefore=await chat.boundingBox();
    const editTab = page.locator('[data-titlebar] [data-workbench-tab="edit"]');
    const currentProject = page.url();
    await openMenu();
    for(const preset of ['Library','Focus','Default']) {
      await layout.getByRole('button',{name:preset,exact:true}).click();
      assert.equal(await editTab.getAttribute('aria-selected'), 'true');
      if (preset === 'Focus') await chat.waitFor({ state: 'hidden' });
      if (preset === 'Default') await chat.waitFor();
    }
    await closeMenu();
    await beginEdit();
    await editor.getByRole('button',{name:'Move Chat',exact:true}).press('ArrowDown');
    await editor.getByRole('switch',{name:'Library inside chat'}).click();
    await editor.locator('[data-layout-palette=library]').click();
    const source=await editor.locator('[data-layout-panel=timeline]').boundingBox();
    const target=await editor.locator('[data-layout-panel=viewer]').boundingBox();
    await page.mouse.move(source.x+source.width*.8,source.y+source.height*.55);await page.mouse.down();
    await page.mouse.move(target.x+25,target.y+target.height/2,{steps:10});
    assert.equal(await page.locator('[data-layout-drop]').getAttribute('data-layout-drop'),'viewer:left');
    await page.mouse.up();
    const timeline=await page.locator('[data-workspace-timeline]').boundingBox(),viewer=await page.locator('[data-viewer-pane]').boundingBox();
    assert.ok(timeline.x<viewer.x);assert.equal(timeline.height,viewer.height);
    const moved=await chat.boundingBox();assert.equal(moved.width,workspaceWidth);assert.equal(moved.y+moved.height,1000);
    const inside=editor.getByRole('switch',{name:'Library inside chat'}),visible=editor.locator('[data-layout-palette=library]');
    const independent=await lib.boundingBox();
    for(let i=0;i<3;i++){
      await inside.click();assert.equal(await inside.getAttribute('aria-checked'),'true');
      assert.equal(await chat.getAttribute('data-assets-open'),'');assert.equal(await visible.getAttribute('aria-pressed'),'true');
      await visible.click();assert.equal(await lib.isVisible(),false);assert.equal(await inside.getAttribute('aria-checked'),'true');
      assert.equal(await chat.getAttribute('data-assets-open'),null);
      await visible.click();assert.equal(await lib.isVisible(),true);assert.equal(await chat.getAttribute('data-assets-open'),'');
      await inside.click();assert.equal(await inside.getAttribute('aria-checked'),'false');
      assert.equal(await chat.getAttribute('data-assets-open'),null);
      assert.deepEqual(await lib.boundingBox(),independent);
    }
    if(output)await page.screenshot({path:join(output,'workspace-desktop-editor-redesign.png')});
    await new Promise(done=>setTimeout(done,150));assert.deepEqual(await stored(),before);
    await editor.getByRole('button',{name:'Cancel',exact:true}).click();
    assert.equal(await chat.getAttribute('data-workspace-bounds'),null);
    assert.deepEqual(await chat.boundingBox(),chatBefore);assert.equal(await lib.isVisible(),false);
    await beginEdit();
    await editor.getByRole('switch',{name:'Library inside chat'}).click();
    await editor.locator('[data-layout-palette=library]').click();
    await editor.getByRole('button',{name:'Move Library',exact:true}).press('ArrowDown');
    await editor.getByRole('button',{name:'Done',exact:true}).click();
    assert.equal(await editor.count(),0);
    assert.equal(await chat.getAttribute('data-assets-open'),null,'the full conversation remains beside an independent library');
    assert.equal(await chat.locator('.workspace-chat-divider').isVisible(),false,'the actual split supplies its resize seam');
    assert.equal((await lib.boundingBox()).width,workspaceWidth);
    assert.equal(await lib.getByRole('button',{name:'Dock left',exact:true}).count(),0);
    const navigation=await lib.locator('[data-studio-library] nav').first().boundingBox();
    assert.ok(navigation.y-(await lib.boundingBox()).y<3,'no extra header above the original categories');
    const height=(await lib.boundingBox()).height;
    await page.locator('[data-workspace-seam=""]').focus();await page.keyboard.press('ArrowUp');
    assert.ok((await lib.boundingBox()).height>height);
    await chooseMode(page, 'canvas');
    assert.equal(page.url(), currentProject, 'opening a plugin keeps the same project selected');
    await page.waitForFunction(()=>document.querySelector('[data-studio-canvas]')?.dataset.canvasReady==='1');
    assert.equal(await lib.isVisible(),false);
    assert.equal(await chat.getAttribute('data-workspace-bounds'),null);
    await beginEdit();
    assert.equal(await editor.locator('[data-layout-palette]').count(),2);
    await editor.getByRole('switch',{name:'Library inside chat'}).click();
    await editor.locator('[data-layout-palette=library]').click();
    await editor.getByRole('button',{name:'Move Library',exact:true}).press('ArrowRight');
    await editor.getByRole('button',{name:'Done',exact:true}).click();
    const canvasRect=await page.locator('[data-studio-canvas]').boundingBox(),libraryRect=await lib.boundingBox();
    assert.ok(canvasRect.x+canvasRect.width<=libraryRect.x);
    await page.waitForFunction(()=>{const node=document.querySelector('.react-flow__node')?.getBoundingClientRect(),canvas=document.querySelector('[data-studio-canvas]')?.getBoundingClientRect();return node&&canvas&&node.left<canvas.right&&node.right>canvas.left&&node.top<canvas.bottom&&node.bottom>canvas.top;});
    if(output)await page.screenshot({path:join(output,'workspace-desktop-canvas-redesign.png')});
    await chooseMode(page, 'edit');
    assert.equal((await lib.boundingBox()).width,workspaceWidth);
    assert.equal(await chat.getAttribute('data-workspace-bounds'),'');
    // The original pane layout and the custom split tree must use the same divider standard.
    await openMenu();
    for(const preset of ['Default','Library']){
      await layout.getByRole('button',{name:preset,exact:true}).click();await closeMenu();
      for(const theme of ['light','dark']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await assertThinSeams(page,`preset-${preset}/${theme}`);}
      if(preset==='Default'){
        await page.evaluate(()=>{const profiles=JSON.parse(localStorage.getItem('openfilm.workspace.current.v3'));profiles.arrangements.edit.chatSide='right';localStorage.setItem('openfilm.workspace.current.v3',JSON.stringify(profiles));window.dispatchEvent(new StorageEvent('storage',{key:'openfilm.workspace.current.v3'}));});
        await page.waitForFunction(()=>document.getElementById('of-chat')?.dataset.side==='right');
        await page.reload();await page.waitForFunction(()=>document.getElementById('of-chat')?.dataset.side==='right');
        for(const theme of ['light','dark']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await assertThinSeams(page,`preset-right-chat/${theme}`);}
        await assertDarkChatFrame(page);
      }
      await openMenu();
    }
    await closeMenu();
    // Reproduce a library above chat, with both horizontal and vertical neighboring panels.
    await page.evaluate(()=>{
      const profiles=JSON.parse(localStorage.getItem('openfilm.workspace.current.v3')),{edit}=profiles.arrangements;
      const open=(key)=>({...edit.blocks[key],open:true});
      profiles.arrangements.edit={...edit,assets:true,chat:true,libraryDock:'left',blocks:{...edit.blocks,layers:open('layers'),inspector:open('inspector'),timeline:open('timeline')},tree:{axis:'x',ratio:.26,first:{axis:'y',ratio:.6,first:{panel:'library'},second:{panel:'chat'}},second:{axis:'y',ratio:.6,first:{axis:'x',ratio:.7,first:{axis:'x',ratio:.2,first:{panel:'layers'},second:{panel:'viewer'}},second:{panel:'inspector'}},second:{panel:'timeline'}}}};
      profiles.arrangements.canvas={mode:'canvas',chatSide:'left',assetsWidth:320,libraryHeight:280,chatWidth:420,blocks:{canvas:{open:true,edge:'center',size:null}},...profiles.arrangements.canvas,assets:true,chat:true,libraryDock:'left',tree:{axis:'x',ratio:.74,first:{axis:'y',ratio:.4,first:{panel:'library'},second:{panel:'canvas'}},second:{panel:'chat'}}};
      localStorage.setItem('openfilm.workspace.current.v3',JSON.stringify(profiles));
      window.dispatchEvent(new StorageEvent('storage',{key:'openfilm.workspace.current.v3'}));
    });
    await page.waitForFunction(()=>document.getElementById('of-chat')?.hasAttribute('data-workspace-bounds')&&document.getElementById('of-chat').getBoundingClientRect().top>32);
    await page.reload();await page.locator('[data-viewer-pane]').waitFor();
    await page.waitForFunction(()=>document.getElementById('of-chat')?.hasAttribute('data-workspace-bounds')&&document.getElementById('of-chat').getBoundingClientRect().top>32);
    for(const mode of ['edit','canvas']){
      if(mode==='canvas'){await chooseMode(page, 'canvas');await page.waitForFunction(()=>document.querySelector('[data-studio-canvas]')?.dataset.canvasReady==='1');}
      for(const theme of ['light','dark']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await assertThinSeams(page,`${mode}/${theme}`);}
      if(output)await page.screenshot({path:join(output,`workspace-dividers-${mode}.png`)});
    }
    await chooseMode(page, 'edit');
    await page.evaluate(()=>localStorage.setItem('openfilm.language','zh-CN'));
    await page.reload();
    await page.locator('[data-titlebar] [data-workbench-tab="edit"][aria-selected="true"]').waitFor();
    await openMenu();
    await page.locator('[data-layout-menu]').getByRole('button',{name:'编辑布局',exact:true}).click();
    await page.getByText('正在编辑剪辑布局',{exact:true}).waitFor();
    if(output)await page.screenshot({path:join(output,'workspace-desktop-editor-zh.png')});
    await page.locator('[data-workspace-editor]').getByRole('button',{name:'取消',exact:true}).click();
    assert.deepEqual(errors,[]);
    assert.equal(logs.some(line=>line.includes('flushSync was called from inside a lifecycle method')),false);
  } catch(error) {
    console.error(logs.slice(-12).join(''));
    if(page) { console.error(await page.evaluate(()=>document.body.innerText.slice(-1800))); await page.screenshot({path:join(dir,'failed.png')}).catch(()=>{}); }
    throw error;
  } finally {
    await browser?.close();if(app)await quit(app.child);
    await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});
