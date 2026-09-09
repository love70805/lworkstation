// Run with Electron 44 against this worktree's Vite server, using synthetic data.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const assert = require("node:assert/strict");
const origin = process.env.WORKSPACE_SMOKE_ORIGIN || "http://127.0.0.1:5188";
if (new URL(origin).hostname !== "127.0.0.1") throw new Error("loopback preview required");
const output = fs.mkdtempSync(path.join(os.tmpdir(), "lworkstation-workspace-layout-"));
app.setPath("userData", path.join(output, "profile"));
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({ cancel: ["http:", "https:"].includes(url.protocol) && url.origin !== origin });
  });
  const window = new BrowserWindow({ width: 1024, height: 768, useContentSize: true, show: false, frame: false,
    webPreferences: { backgroundThrottling: false } });
  const evaluate = code => window.webContents.executeJavaScript(code);
  async function until(code) {
    const end = Date.now() + 20000;
    while (Date.now() < end) { if (await evaluate(code)) return; await delay(100); }
    throw new Error(`Timeout: ${code}; ${await evaluate("document.body.innerText.slice(0,1500)")}`);
  }
  async function capture(name) {
    await delay(250);
    await evaluate("new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
    fs.writeFileSync(path.join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  }
  await window.loadURL(`${origin}/workspace`);
  await until("document.body.innerText.includes('还没有月度账本')");
  await capture("empty-1024");
  const ids = await evaluate(`(async()=>{
    const {db, createOrGetMonthlyLedger, getActiveMemberContext}=await import('/src/data/database.js');
    const member=await getActiveMemberContext();
    const ids=[];
    for (const period of ['2026-09','2026-08']) {
      const ledger=await createOrGetMonthlyLedger({workspaceId:member.workspaceId,period});
      ids.push(ledger.id);
      await db.salesRows.bulkPut(Array.from({length:8},(_,i)=>({id:period+'-'+i,ledgerId:ledger.id,workspaceId:member.workspaceId,store:i%2?'乙店':'甲店',platformSku:'SKU-'+i,platformSkc:'SKC-'+Math.floor(i/2),supplierNumber:'供应商A',attribute:'合成测试商品',quantity:2,amount:50,penalty:0})));
    }
    await db.ledgers.put({id:'FOREIGN',workspaceId:'another-workspace',period:'2099-12',status:'draft'});
    return ids;
  })()`);
  await window.loadURL(`${origin}/profit?ledger=${encodeURIComponent(ids[0])}&store=甲店&missing=1#details`);
  await until("location.pathname==='/workspace' && document.querySelector('[aria-label=核算月份]')?.options.length===2 && document.querySelector('.workspace-profit-content')");
  await evaluate(`{const select=[...document.querySelectorAll('.workspace-profit-content select')].find(s=>[...s.options].some(o=>o.value==='乙店'));if(!select)throw new Error('store selector missing');select.value='乙店';select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until("new URLSearchParams(location.search).get('store')==='乙店'");
  await until("[...document.querySelectorAll('.side-navigation a')].filter(a=>['/workspace','/ledger','/cost-matching'].includes(new URL(a.href).pathname)).every(a=>new URL(a.href).searchParams.get('store')==='乙店')");
  const evidence = [];
  for (const [width, height] of [[1024, 768], [1280, 800], [390, 780]]) {
    window.setContentSize(width, height);
    await delay(300);
    const layout = await evaluate(`({width:innerWidth,height:innerHeight,shells:document.querySelectorAll('.app-shell').length,overflow:document.documentElement.scrollWidth>innerWidth,months:[...document.querySelector('[aria-label=核算月份]').options].map(o=>o.text),nav:[...document.querySelectorAll('.side-navigation a')].map(a=>({label:a.textContent.trim(),href:a.getAttribute('href')})),buttons:[...document.querySelectorAll('.workspace-profit-content .page-actions button')].map(b=>{const r=b.getBoundingClientRect();return {text:b.textContent,left:r.left,right:r.right}})})`);
    assert.equal(layout.shells, 1);
    assert.equal(layout.overflow, false);
    assert.deepEqual(layout.months, ["2026-09", "2026-08"]);
    assert.ok(layout.nav.some(item => item.label === "月度账本"));
    assert.ok(layout.nav.some(item => item.label === "成本核对"));
    assert.ok(layout.nav.every(item => !item.href.startsWith("/profit")));
    for (const label of ["月度账本", "成本核对"]) assert.equal(new URL(layout.nav.find(item => item.label === label).href, origin).searchParams.get("ledger"), ids[0]);
    assert.ok(layout.buttons.every(button => button.left >= 0 && button.right <= width));
    evidence.push(layout);
    await capture(`populated-${width}`);
    await evaluate("document.querySelector('.profit-summary-action').click()");
    await until("Boolean(document.querySelector('[role=dialog]'))");
    assert.equal(await evaluate(`(()=>{const r=document.querySelector('[role=dialog]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight})()`), true);
    await capture(`modal-${width}`);
    await evaluate("document.querySelector('[aria-label=关闭对话框]').click()");
  }
  await evaluate(`window.__content=document.querySelector('.workspace-profit-content'); const next=new URL(location.href);next.searchParams.set('q','SKU');history.replaceState(history.state,'',next);window.dispatchEvent(new PopStateEvent('popstate'));`);
  await delay(300);
  assert.equal(await evaluate("window.__content===document.querySelector('.workspace-profit-content')"), true, "filter changes must not remount the profit workspace");
  await evaluate(`{const select=document.querySelector('[aria-label=核算月份]'); select.value=${JSON.stringify(ids[1])}; select.dispatchEvent(new Event('change',{bubbles:true}));}`);
  await until(`new URLSearchParams(location.search).get('ledger')===${JSON.stringify(ids[1])}`);
  assert.equal(await evaluate("new URLSearchParams(location.search).get('store')"), "乙店");
  await until(`new URL(document.querySelector('.side-navigation a[href^="/ledger"]').href).searchParams.get('ledger')===${JSON.stringify(ids[1])}`);
  await evaluate("document.querySelector('.side-navigation a[href^=\"/ledger\"]').click()");
  await until("location.pathname==='/ledger'");
  assert.equal(await evaluate("new URLSearchParams(location.search).get('ledger')"), ids[1]);
  await evaluate("document.querySelector('.side-navigation a[href^=\"/workspace\"]').click()");
  await until("location.pathname==='/workspace' && document.querySelector('.workspace-profit-content')");
  await window.loadURL(`${origin}/workspace?ledger=FOREIGN&store=secret&q=secret`);
  await until(`new URLSearchParams(location.search).get('ledger')===${JSON.stringify(ids[0])} && document.querySelector('.workspace-profit-content')`);
  assert.equal(await evaluate("location.search.includes('secret')"), false);
  fs.writeFileSync(path.join(output, "result.json"), JSON.stringify({ ok: true, evidence, checks: ["single shell", "legacy route", "user store change updates all three navigation links", "workspace month selection", "valid filters preserved", "foreign context cleared"] }, null, 2));
  console.log(`Workspace layout smoke passed: ${output}`);
  app.exit(0);
}).catch(error => { fs.writeFileSync(path.join(output, "error.txt"), error.stack); console.error(error); app.exit(1); });
