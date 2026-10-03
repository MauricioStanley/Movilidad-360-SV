const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../js/core.js');
const source=fs.readFileSync('js/app.js','utf8');
function fn(name){const at=source.search(new RegExp('  (?:async )?function '+name+'\\('));assert.ok(at>=0);return source.slice(at,source.indexOf('\n  }',at)+4);}
function nodes(){const map=new Map();return sel=>{if(!map.has(sel))map.set(sel,{value:'',textContent:'',classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){}});return map.get(sel);};}
test('a same-point selection invalidates an earlier in-flight route',async()=>{
 let complete;let generation=0;let renders=0;let same=0;
 const ctx={$:nodes(),M360Core:core,lastMovilizarteSelection:null,quoteRouteData:{},requireOrigin:()=>true,
  nextQuoteGeneration:()=>++generation,isCurrentQuoteGeneration:(_,g)=>g===generation,
  currentOrigin:()=>({lat:13,lng:-89}),originLabel:()=> 'Origen',isEssentiallySamePoint:(_,b)=>b.name==='same',
  showQuoteSamePoint:()=>same++,showQuoteLoading(){},persistAll(){},fetchRoute:()=>new Promise(r=>complete=r),
  estimatePrice:()=>4,paxPetsFor:()=>({pets:false}),showQuote:()=>renders++};
 vm.createContext(ctx);vm.runInContext(fn('selectMovilizarteDestination'),ctx);
 const first=ctx.selectMovilizarteDestination({name:'first',lat:14,lng:-89});
 await ctx.selectMovilizarteDestination({name:'same',lat:13,lng:-89});
 complete({distanceKm:4,minutes:8,real:true,coords:[]});await first;
 assert.equal(same,1);assert.equal(renders,0);
});
test('clearing parcel pickup cancels an in-flight quote without dereferencing null',async()=>{
 let complete;
 const ctx={$:nodes(),M360Core:core,parcelQuoteGen:0,parcelState:{size:'small',fromPoint:{lat:13,lng:-89},toPoint:{lat:14,lng:-89}},
  invalidateQuote(){},CONFIG:{pricing:{parcel:{small:4,urgentSurcharge:5}},ratePerKmParcel:.45},
  isEssentiallySamePoint:()=>false,fetchRoute:()=>new Promise(r=>complete=r),quoteRouteData:{}};
 vm.createContext(ctx);vm.runInContext(fn('updateParcelQuote'),ctx);
 const first=ctx.updateParcelQuote();ctx.parcelState.fromPoint=null;await ctx.updateParcelQuote();
 complete({distanceKm:5,real:true});await first;
 assert.equal(ctx.$('#quote-encomienda-price').textContent,'—');assert.deepEqual(ctx.quoteRouteData,{});
});
test('malformed routing data falls back instead of showing NaN',async()=>{
 let cleared=0;
 const ctx={M360Core:core,routeCache:new Map(),AbortController,setTimeout:()=>1,clearTimeout:()=>cleared++,
  fetch:async()=>({ok:true,json:async()=>({code:'Ok',routes:[{distance:'bad'}]})}),
  estimateRoadKm:n=>n*1.35,haversineKm:()=>2,estimateMinutes:()=>9};
 vm.createContext(ctx);vm.runInContext(fn('fetchRoute'),ctx);
 const route=await ctx.fetchRoute({lat:13,lng:-89},{lat:14,lng:-89});assert.equal(route.real,false);assert.equal(route.distanceKm,2.7);assert.equal(cleared,1);
 await assert.rejects(()=>ctx.fetchRoute({lat:NaN,lng:-89},{lat:14,lng:-89}));
});
test('analytics never loads in local preview even if consent is present',()=>{
 let appended=0;
 const ctx={location:{hostname:'127.0.0.1'},localStorage:{getItem:()=> 'yes'},window:{},document:{head:{appendChild(){appended++;}}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('js/ga.js','utf8'),ctx);assert.equal(appended,0);
});
test('failed offline precache rejects installation; it never skipWaits automatically',async()=>{
 const events={};let skipped=0;let promise;
 const ctx={self:{addEventListener:(n,cb)=>events[n]=cb,skipWaiting:()=>skipped++},caches:{open:async()=>({addAll:async()=>{throw Error('offline');}})}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync('sw.js','utf8'),ctx);
 events.install({waitUntil:p=>promise=p});await assert.rejects(promise,/offline/);assert.equal(skipped,0);
 events.message({data:{type:'ACTIVATE_UPDATE'}});assert.equal(skipped,1);
});
