import {afterEach,expect,it,vi} from 'vitest';
import {computeSalesImportPlan,prepareSalesImportSnapshot} from './salesImportPlanner';
afterEach(()=>vi.unstubAllGlobals());
it('snapshots worker input synchronously and tears down after receiving the result',async()=>{
 let instance;
 class Worker { constructor(){instance=this;this.terminate=vi.fn()} postMessage(message){this.message=structuredClone(message)} }
 vi.stubGlobal('Worker',Worker);
 const items=[{rows:[{quantity:1}]}];
 const request=prepareSalesImportSnapshot(items,{period:'2026-08'});
 items[0].rows[0].quantity=9;
 expect(instance.message).toMatchObject({task:'prepare',items:[{rows:[{quantity:1}]}]});
 instance.onmessage({data:{result:['prepared']}});
 await expect(request).resolves.toEqual(['prepared']);expect(instance.terminate).toHaveBeenCalledOnce();
});
it('terminates pending snapshot calculation on cancellation without accepting a late result',async()=>{
 let instance;
 class Worker { constructor(){instance=this;this.terminate=vi.fn()} postMessage(){} }
 vi.stubGlobal('Worker',Worker);
 const controller=new AbortController();const request=computeSalesImportPlan({items:[]},{signal:controller.signal});
 controller.abort();instance.onmessage({data:{result:'late'}});
 await expect(request).rejects.toThrow('已取消');expect(instance.terminate).toHaveBeenCalled();
});
