import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const extension = path.join(root, 'integrations/erp-assistant-extension/src');
const source = (await Promise.all(['result-policy.js','catalog-collector.js','request-context.js','shopeers-bridge.js','content.js'].map(file => readFile(path.join(extension,file),'utf8')))).join('\n');
const css = await readFile(path.join(extension,'content.css'),'utf8');
const out = path.join(root,'archive/release-0.3.4'); await mkdir(out,{recursive:true});
const browser = await chromium.launch({ channel:'msedge',headless:true });
const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
const messages = [], requests = [], errors = []; let releaseDirectory;
await context.exposeBinding('recordExtensionMessage',(_,message) => {
 messages.push(message);
 return message.type==='shopeers.erp.previewContext' ? {ok:true,ledgerPeriod:'2026-08'} : message.type==='shopeers.erp.catalogContext' ? {ok:true,request:{requestId:'CAT-UI',platformSkcs:['SKC-A']}} : {ok:true,status:'success',resultDeliveryId:message.payload?.resultDeliveryId};
});
await context.addInitScript({content:`window.chrome={runtime:{lastError:null,sendMessage(message,callback){window.recordExtensionMessage(message).then(callback)}}};\n${source}`});
await context.route('https://www.zhuolinkeji.cn/**',async route=>{
 const url=new URL(route.request().url());
 if(!url.pathname.startsWith('/purchase/')) {await route.fulfill({contentType:'text/html',body:`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>${css}</style><body><h1>隔离 ERP 采购管理</h1></body></html>`});return;}
 requests.push(url.pathname); let data;
 if(url.pathname.endsWith('purchase-order-page'))data=[{purchaseOrderId:'PO-A'}];
 else if(url.pathname.endsWith('purchase-order-details'))data=[{purchaseOrderDetailId:'D-A',itemId:'WH-A',tradeName:'合成中文商品',creationTime:'2026-08-20',purchaseQuantity:2,purchaseUnitPrice:4}];
 else if(url.pathname.endsWith('product-info-sku'))data=[{associatedProductId:'WH-A',barcodeSkcid:'SKC-A',barcodeSkuid:'SKU-A'}];
 else {await new Promise(resolve=>{releaseDirectory=resolve});data=[];}
 await route.fulfill({contentType:'application/json',body:JSON.stringify({code:0,count:data.length,data})});
});
const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message)); const checks=[];
try {
 await page.goto('https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('shopeers:erp-v8-query-captured',{detail:{url:'https://www.zhuolinkeji.cn/purchase/purchase/v1/purchase-order-page?sku=SKC-A&storeId=STORE-A'}})));
 await page.locator('#erpa-cost-trigger').click();
 await page.locator('#erpa-catalog-progress').waitFor({state:'visible'});
 assert.equal(messages.filter(m=>m.type==='shopeers.erp.submitCostResult').length,1);
 assert.equal(messages.filter(m=>m.type==='shopeers.erp.submitCatalogResult').length,0);
 await page.getByText('4.0000',{exact:true}).waitFor({state:'visible'});
 assert.equal(await page.locator('#erpa-loading').isVisible(),false);
 assert.equal(await page.locator('#erpa-export').isEnabled(),true);
 for(const theme of ['light','dark'])for(const width of [1440,1000,390]){
  await page.setViewportSize({width,height:1000});await page.evaluate(theme=>{document.documentElement.style.background=theme==='dark'?'#181c23':'#ffffff';document.documentElement.style.color=theme==='dark'?'#f5f5f5':'#253142';},theme);
  const layout=await page.evaluate(()=>{const panel=document.querySelector('.erpa-panel').getBoundingClientRect(),progress=document.querySelector('#erpa-catalog-progress').getBoundingClientRect();return{width:innerWidth,panelX:panel.x,panelRight:panel.right,progressX:progress.x,progressRight:progress.right,overflow:document.documentElement.scrollWidth>innerWidth}});
  assert.ok(layout.panelX>=0&&layout.panelRight<=width+1&&!layout.overflow);
  assert.ok(layout.progressX>=0&&layout.progressRight<=width+1, JSON.stringify(layout));
  await page.screenshot({path:path.join(out,`collection-background-${theme}-${width}.png`)}); checks.push({theme,width,layout});
 }
 await page.locator('#erpa-cancel-catalog').click();
 await page.locator('#erpa-catalog-progress').waitFor({state:'hidden'});
 const count=requests.length; releaseDirectory();await page.waitForTimeout(100);
 assert.equal(requests.length,count);assert.equal(messages.filter(m=>m.type==='shopeers.erp.submitCatalogResult').length,0);
 assert.equal(await page.locator('#erpa-recalculate').isEnabled(),true);
 assert.equal(await page.locator('#erpa-loading').isVisible(),false);
 assert.deepEqual(errors,[]);
 await writeFile(path.join(out,'collection-headless-ui.json'),JSON.stringify({ok:true,syntheticResponses:true,productionCode:true,costDeliveredBeforeOptional:true,cancelPreservesResults:true,checks,requests},null,2));
 console.log('Headless production collection UI: completed readable costs, independent stalled catalog, 6 layouts, actual cancel and enabled export passed.');
} finally {releaseDirectory?.();await browser.close();}
