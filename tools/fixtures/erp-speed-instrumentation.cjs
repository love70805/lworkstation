const assert = require('node:assert/strict');
// Rewrites a disposable copy, never the shipped extension. Each anchor is checked
// so a future production refactor fails rather than silently losing measurements.
function instrument(source, cap) {
  assert.ok([8, 10, 12].includes(cap));
  const replace = (before, after) => { assert.equal(source.split(before).length, 2, `Benchmark anchor: ${before}`); source = source.replace(before, after); };
  replace('const MAX_REQUEST_CONCURRENCY = 12;', `const MAX_REQUEST_CONCURRENCY = ${cap};`);
  replace('const REQUEST_TIMEOUT = 120000;', 'const REQUEST_TIMEOUT = Number(new URL(location.href).searchParams.get("benchmarkTimeout")) || 120000;');
  replace('await acquireRequestSlot(parentSignal);', 'const queuedAt = performance.now();\n                await acquireRequestSlot(parentSignal);\n                window.__erpBench.spans.push({kind:"queue",endpoint:path.split("/").at(-1),start:queuedAt,end:performance.now(),phase:window.__erpBench.phase});');
  replace('const previewResults = resultPolicy.previewForLedger(aggregateState.results, warehouseEvidence, previewContext.ledgerPeriod);', 'const previewStarted = performance.now();\n        const previewResults = resultPolicy.previewForLedger(aggregateState.results, warehouseEvidence, previewContext.ledgerPeriod);\n        window.__erpBench.spans.push({kind:"preview-cost",start:previewStarted,end:performance.now(),phase:window.__erpBench.phase});');
  replace('await wait(Math.min(1000, Math.max(500 * (attempt + 1), error.retryAfter || 0)), parentSignal);', 'const backoffStarted = performance.now();\n                    await wait(Math.min(1000, Math.max(500 * (attempt + 1), error.retryAfter || 0)), parentSignal);\n                    window.__erpBench.spans.push({kind:"retry-backoff",start:backoffStarted,end:performance.now(),phase:window.__erpBench.phase});');
  replace('await new Promise(resolve => window.setTimeout(resolve, 1000));', 'const gateStarted = performance.now();\n                    await new Promise(resolve => window.setTimeout(resolve, 1000));\n                    window.__erpBench.spans.push({kind:"adoption-poll-wait",start:gateStarted,end:performance.now(),phase:window.__erpBench.phase});');
  replace('        const entry = taskCache.get(key);\n        if (!entry || !activeRun && Date.now() - entry.timestamp > CACHE_TTL) return null;\n        return entry.value;',
    '        const entry = taskCache.get(key);\n        const hit = Boolean(entry && (activeRun || Date.now() - entry.timestamp <= CACHE_TTL));\n        window.__erpBench.cache.push({key,hit,phase:window.__erpBench.phase});\n        if (!hit) return null;\n        return entry.value;');
  assert.equal(source.split('catalogCollector.directory(').length, 4);
  source = source.replaceAll('catalogCollector.directory(', 'benchDirectory(');
  const prefix = `
window.__erpBench = {phase:'cold',spans:[],cache:[],calculations:[],warm:[],errors:[],started:performance.now(),timeOrigin:performance.timeOrigin};
(() => {const original=window.fetch.bind(window);window.fetch=async function(url,init){
 const trace={kind:'request',endpoint:new URL(url).pathname.split('/').at(-1),url:String(url),start:performance.now(),phase:window.__erpBench.phase};
 window.__erpBench.spans.push(trace);try {const value=await original(url,init);trace.status=value.status;return value;}
 catch(error){trace.error=error.name;throw error;}finally{trace.end=performance.now();}
};})();
`;
  const suffix = `
    const bench=window.__erpBench, contexts=[];
    const saveBench=()=>{document.documentElement.setAttribute('data-erp-benchmark',JSON.stringify(bench));};
    const wrapAsync=(kind,fn)=>async function(...args){const start=performance.now(),phase=bench.phase;try{return await fn.apply(this,args);}finally{bench.spans.push({kind,start,end:performance.now(),phase});}};
    const wrapSync=(kind,fn)=>function(...args){const start=performance.now(),phase=bench.phase;try{return fn.apply(this,args);}finally{bench.spans.push({kind,start,end:performance.now(),phase});}};
    const benchDirectory=wrapAsync('directory',(...args)=>catalogCollector.directory(...args));
    fetchMappings=wrapAsync('mapping',fetchMappings);
    fetchAllOrders=wrapAsync('purchase-pages',fetchAllOrders);
    fetchAllDetails=wrapAsync('details-drain',fetchAllDetails);
    aggregateDetails=wrapSync('aggregate',aggregateDetails);
    completeOptionalCatalog=wrapAsync('catalog',completeOptionalCatalog);
    const originalTaskOperation=taskOperation;
    taskOperation=async function(input){return wrapAsync('task-'+input.action,originalTaskOperation)(input);};
    window.ShopeersErpDeliveryBridge={...window.ShopeersErpDeliveryBridge,submit:wrapAsync('delivery',window.ShopeersErpDeliveryBridge.submit)};
    const originalCalculation=runCalculation;
    const stable=value=>Array.isArray(value)?value.map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
    const semantic=state=>JSON.stringify(stable({results:state.results.map(row=>({warehouseSku:row.warehouseSku,unitCost:row.unitCost,mappings:row.mappings,selectedRecordIds:row.selectedRecordIds})),warehouses:state.warehouseEvidence.warehouses,excludedOrders:state.warehouseEvidence.excludedOrders,excludedDetails:state.warehouseEvidence.excludedDetails,detailFailures:state.warehouseEvidence.detailFailures,mappingFailures:state.warehouseEvidence.mappingFailures}));
    runCalculation=async function(filters,run){const start=performance.now();const state=await originalCalculation(filters,run);const end=performance.now();
      const value={start,end,meta:state.meta,semantic:semantic(state)};bench.calculations.push(value);contexts.push({filters,run:{...run,batchSkcs:[...run.batchSkcs]},semantic:value.semantic});saveBench();return state;};
    const originalBatched=runBatchedCalculation;
    runBatchedCalculation=async function(run){bench.taskStart=performance.now();try{return await originalBatched(run);}finally{bench.taskEnd=performance.now();bench.costComplete=run.costReadComplete;saveBench();}};
    window.addEventListener('erp-benchmark-warm',async()=>{
      const previous=activeRun;bench.phase='warm';bench.warmStart=performance.now();
      try {for(const context of contexts){activeRun=context.run;const start=performance.now();const value=await originalCalculation(context.filters,context.run);const sem=semantic(value);bench.warm.push({start,end:performance.now(),meta:value.meta,semantic:sem,equal:sem===context.semantic});}}
      catch(error){bench.errors.push(error.stack||String(error));}finally{activeRun=previous;bench.warmEnd=performance.now();bench.phase='complete';saveBench();}
    });
`;
  // Normalize CRLF before matching, in the caller.
  assert.match(source, /\}\(\)\);\s*$/);
  source = source.replace(/\}\(\)\);\s*$/, `${suffix}\n}());\n`);
  return prefix + source;
}
module.exports = { instrument };
