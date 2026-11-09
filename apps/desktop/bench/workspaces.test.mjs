/** A throwaway desktop instance verifies the native chat and independent library together. No model request. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';
import { filmHtml } from '../../../packages/openfilm/src/film-doc.mjs';
import { launch, prepare, quit, waitForCdp } from './app.mjs';

async function until(read, ms = 30_000) {
  const end = Date.now()+ms;
  while (Date.now()<end) { const result = await read().catch(()=>null); if (result) return result; await new Promise(done=>setTimeout(done,100)); }
  throw new Error('Timed out waiting for desktop workspace');
}
async function port() { const server = createServer(); await new Promise(done=>server.listen(0,'127.0.0.1',done)); const value=server.address().port; await new Promise(done=>server.close(done)); return value; }

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
    return {bands,panes,color:getComputedStyle(document.documentElement).getPropertyValue('--dock-line').trim()};
  });
  try {
    assert.ok(samples.bands.length>=2,`${label}: multiple boundaries are exercised`);
    await page.locator('[data-layout-trigger]').focus();await page.mouse.move(800,16);
    const read=async()=>{
      const png=await page.screenshot({scale:'css'});
      return page.evaluate(async({data,bands,color})=>{
        const img=new Image();img.src=`data:image/png;base64,${data}`;await img.decode();
        const canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');
        ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const line=[...ctx.getImageData(0,0,1,1).data];ctx.drawImage(img,0,0);
        return {line,bands:bands.map(b=>({...b,pixels:Array.from({length:7},(_,i)=>[...ctx.getImageData(b.x+(b.vertical?i-3:0),b.y+(b.vertical?0:i-3),1,1).data])}))};
      },{data:png.toString('base64'),...samples});
    };
    const check=result=>{try{for(const band of result.bands)for(let i=0;i<7;i++)assert.deepEqual(band.pixels[i],i===3?result.line:[70,80,90,255],`${label} ${band.name}: the divider occupies exactly one CSS pixel (${i-3})`);}catch(error){console.error('Divider geometry',JSON.stringify(samples.panes),JSON.stringify(result.bands));throw error;}};
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
    assert.equal(await lib.isVisible(),false);
    assert.equal(await chat.getAttribute('data-assets-open'),null);
    const layout=page.locator('[data-layout-menu]'),editor=page.locator('[data-workspace-editor]');
    const openMenu=async()=>{if(!await layout.count())await page.getByRole('button',{name:'Layout',exact:true}).click();};
    const beginEdit=async()=>{await openMenu();await layout.getByRole('button',{name:'Edit layout',exact:true}).click();await editor.waitFor();};
    const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('openfilm.workspace.current.v2')).edit);
    await page.waitForFunction(()=>localStorage.getItem('openfilm.workspace.current.v2')!==null);
    const before=await stored(),chatBefore=await chat.boundingBox();
    await openMenu();
    for(const preset of ['Library','Focus','Default']) {
      await layout.getByRole('button',{name:preset,exact:true}).click();
      assert.equal(await page.locator('[data-work-mode="edit"]').count(),1);
    }
    await page.keyboard.press('Escape');
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
    const moved=await chat.boundingBox();assert.equal(moved.width,1600);assert.equal(moved.y+moved.height,1000);
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
    const output=process.env.OPENFILM_WORKSPACE_SCREENSHOTS;
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
    assert.equal((await lib.boundingBox()).width,1600);
    assert.equal(await lib.getByRole('button',{name:'Dock left',exact:true}).count(),0);
    const navigation=await lib.locator('[data-studio-library] nav').first().boundingBox();
    assert.ok(navigation.y-(await lib.boundingBox()).y<3,'no extra header above the original categories');
    const height=(await lib.boundingBox()).height;
    await page.locator('[data-workspace-seam=""]').focus();await page.keyboard.press('ArrowUp');
    assert.ok((await lib.boundingBox()).height>height);
    await page.locator('[data-work-mode="edit"]').click();
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
    await page.locator('[data-work-mode="canvas"]').click();
    assert.equal((await lib.boundingBox()).width,1600);
    assert.equal(await chat.getAttribute('data-workspace-bounds'),'');
    // The original pane layout and the custom split tree must use the same divider standard.
    await openMenu();
    for(const preset of ['Default','Library']){
      await layout.getByRole('button',{name:preset,exact:true}).click();await page.keyboard.press('Escape');
      for(const theme of ['light','dark']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await assertThinSeams(page,`preset-${preset}/${theme}`);}
      if(preset==='Default'){
        await page.evaluate(()=>{const profiles=JSON.parse(localStorage.getItem('openfilm.workspace.current.v2'));profiles.edit.chatSide='right';localStorage.setItem('openfilm.workspace.current.v2',JSON.stringify(profiles));window.dispatchEvent(new StorageEvent('storage',{key:'openfilm.workspace.current.v2'}));});
        await page.waitForFunction(()=>document.getElementById('of-chat')?.dataset.side==='right');
        await page.reload();await page.waitForFunction(()=>document.getElementById('of-chat')?.dataset.side==='right');
        for(const theme of ['light','dark']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await assertThinSeams(page,`preset-right-chat/${theme}`);}
      }
      await openMenu();
    }
    await page.keyboard.press('Escape');
    // Reproduce a library above chat, with both horizontal and vertical neighboring panels.
    await page.evaluate(()=>{
      const profiles=JSON.parse(localStorage.getItem('openfilm.workspace.current.v2'));
      profiles.edit={...profiles.edit,assets:true,layers:true,inspector:true,timeline:true,chat:true,libraryDock:'left',tree:{axis:'x',ratio:.26,first:{axis:'y',ratio:.6,first:{panel:'library'},second:{panel:'chat'}},second:{axis:'y',ratio:.6,first:{axis:'x',ratio:.7,first:{axis:'x',ratio:.2,first:{panel:'layers'},second:{panel:'viewer'}},second:{panel:'inspector'}},second:{panel:'timeline'}}}};
      profiles.canvas={...profiles.canvas,assets:true,chat:true,libraryDock:'left',tree:{axis:'x',ratio:.74,first:{axis:'y',ratio:.4,first:{panel:'library'},second:{panel:'canvas'}},second:{panel:'chat'}}};
      localStorage.setItem('openfilm.workspace.current.v2',JSON.stringify(profiles));
      window.dispatchEvent(new StorageEvent('storage',{key:'openfilm.workspace.current.v2'}));
    });
    await page.waitForFunction(()=>document.getElementById('of-chat')?.hasAttribute('data-workspace-bounds')&&document.getElementById('of-chat').getBoundingClientRect().top>32);
    await page.reload();await page.locator('[data-viewer-pane]').waitFor();
    await page.waitForFunction(()=>document.getElementById('of-chat')?.hasAttribute('data-workspace-bounds')&&document.getElementById('of-chat').getBoundingClientRect().top>32);
    for(const mode of ['edit','canvas']){
      if(mode==='canvas'){await page.locator('[data-work-mode=edit]').click();await page.waitForFunction(()=>document.querySelector('[data-studio-canvas]')?.dataset.canvasReady==='1');}
      for(const theme of ['light','dark']){await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;},theme);await assertThinSeams(page,`${mode}/${theme}`);}
      if(output)await page.screenshot({path:join(output,`workspace-dividers-${mode}.png`)});
    }
    await page.locator('[data-work-mode=canvas]').click();
    await page.evaluate(()=>localStorage.setItem('openfilm.language','zh-CN'));
    await page.reload();await page.getByRole('button',{name:'布局',exact:true}).click();
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
