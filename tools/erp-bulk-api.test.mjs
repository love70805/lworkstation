import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const { Window } = await import(pathToFileURL(require.resolve('happy-dom')).href);
const directory = new URL('../integrations/erp-assistant-extension/src/', import.meta.url);
const source = (await fs.readFile(new URL('content.js', directory),'utf8')).replace(/\r\n/g,'\n');
const anchor = '    if (collectorRequestId) initializeUi(false);\n    else if (window.ShopeersErpTaskPreview) void refreshDesktopMode();\n    else initializeUi(false);';
assert.equal(source.split(anchor).length,2);
async function check(response, expected, { abortBody = false } = {}) {
    const window = new Window({url:'https://www.zhuolinkeji.cn/view/system/purchaseOrderModule/purchasingManagement.html'});
    let request;
    window.fetch=async (url,init)=>{request={url,init};return response;};
    for(const file of ['result-policy.js','request-context.js','bulk-purchase.js'])window.eval(await fs.readFile(new URL(file,directory),'utf8'));
    window.eval(source.replace(anchor,'    window.__testBinaryRequest=apiGet;'));
    const controller = new AbortController();
    try {
        const promise=window.__testBinaryRequest('/purchase/purchase/v1/export-purchase-order',{sku:'SYNTHETIC'},controller.signal,'synthetic export',{workbook:true});
        if(abortBody){await new Promise(resolve=>setTimeout(resolve,5));controller.abort();}
        await assert.rejects(promise,error=>error.code===expected||error.name===expected||error.status===expected);
        assert.equal(request.init.credentials,'include');
        assert.equal(request.init.cache,'no-store');
        assert.equal(request.init.headers['X-Requested-With'],'XMLHttpRequest');
    } finally {await window.happyDOM.close();}
}
await check(new Response(JSON.stringify({code:-40102,msg:'校验用户店铺权限失败！'}),{headers:{'content-type':'application/json'}}),'ERP_PERMISSION_REQUIRED');
await check(new Response(JSON.stringify({code:-50001,msg:'校验用户店铺权限失败！数据库地址不可为空'}),{headers:{'content-type':'application/octet-stream'}}),'ERP_PERMISSION_REQUIRED');
await check(new Response('<html><input type="password"></html>',{headers:{'content-type':'text/html'}}),'ERP_LOGIN_REQUIRED');
await check(new Response(JSON.stringify({code:401,msg:'login required'}),{headers:{'content-type':'application/json'}}),'ERP_LOGIN_REQUIRED');
await check(new Response('limited',{status:429,headers:{'retry-after':'2'}}),429);
const slowBody=new Response(new Uint8Array([80,75,3,4]),{headers:{'content-type':'application/octet-stream'}});
slowBody.arrayBuffer=()=>new Promise(()=>{});
await check(slowBody,'AbortError',{abortBody:true});
console.log('Bulk export response: native request credentials/cache, JSON/blob permission, HTML login, rate limits and body cancellation passed');
