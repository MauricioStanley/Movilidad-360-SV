const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const core=require('../js/core.js');
function setup(fetch) {
 const ctx={fetch,AbortController,setTimeout:(fn,ms)=>ms<2000?setTimeout(fn,0):setTimeout(fn,ms),clearTimeout,
  CONFIG:{geocodingBaseUrl:'https://nominatim.openstreetmap.org'},M360Core:core};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/geo.js','utf8'),ctx);return ctx.M360Geo;
}
const response=()=>({ok:true,json:async()=>[{display_name:'San Jacinto, San Salvador',lat:'13.68',lon:'-89.19'}]});
test('identical concurrent searches share one network request and then cache',async()=>{
 let count=0;const geo=setup(async()=>{count++;return response();});
 const [a,b]=await Promise.all([geo.search('San Jacinto'),geo.search('San Jacinto')]);
 assert.equal(a[0].name,b[0].name);await geo.search('San Jacinto');assert.equal(count,1);
});
test('obsolete queued searches never hit the provider',async()=>{
 let complete;const urls=[];const geo=setup(url=>{urls.push(url);return urls.length===1?new Promise(r=>complete=r):Promise.resolve(response());});
 const first=geo.search('Aeropuerto');await new Promise(r=>setTimeout(r,0));
 const ctrl=new AbortController();const obsolete=geo.search('Obsoleto',{signal:ctrl.signal}).catch(e=>e.code);
 ctrl.abort();const latest=geo.search('Centro Histórico');complete(response());
 await first;assert.equal(await obsolete,'cancelled');await latest;
 assert.equal(urls.length,2);assert.ok(urls.every(u=>!u.includes('Obsoleto')));
});
test('quota failures are actionable and a cancelled caller does not cancel another consumer',async()=>{
 const unavailable=setup(async()=>({ok:false,status:429}));await assert.rejects(()=>unavailable.search('Centro'),e=>e.code==='rate-limit');
 let finish;const geo=setup(()=>new Promise(r=>finish=r));const ctrl=new AbortController();
 const a=geo.search('Centro',{signal:ctrl.signal}).catch(e=>e.code),b=geo.search('Centro');
 await new Promise(r=>setTimeout(r,0));ctrl.abort();finish(response());assert.equal(await a,'cancelled');assert.equal((await b).length,1);
});
