const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const core=require('../js/core.js');
const src=fs.readFileSync('js/app.js','utf8');
function fn(name) { const a=src.search(new RegExp('  (?:async )?function '+name+'\\('));assert.ok(a>=0);return src.slice(a,src.indexOf('\n  }',a)+4); }
function nodes() { const map=new Map();return s=>{if(!map.has(s))map.set(s,{textContent:'',value:'',hidden:false,classList:{add(){},remove(){},toggle(){}},setAttribute(){},removeAttribute(){},focus(){}});return map.get(s);}; }
for(const direction of ['to','from']) test(`airport ${direction} routes pickup and destination in the correct order`,async()=>{
 let routed,display;const airport={name:'AILA',lat:13.44,lng:-89.05},other={name:'Casa',lat:13.7,lng:-89.2};
 const ctx={$:nodes(),M360Core:core,airportDirection:direction,airportArrivalDestination:other,lastAirportSelection:null,
  nextQuoteGeneration:()=>1,isCurrentQuoteGeneration:()=>true,requireOrigin:()=>true,currentOrigin:()=>other,originLabel:()=>other.name,
  isEssentiallySamePoint:()=>false,renderAirports(){},showQuoteLoading(){},fetchRoute:async(a,b)=>(routed=[a,b],{distanceKm:42,minutes:50,real:true,coords:[]}),
  quoteRouteData:{},estimatePrice:()=>30,paxPetsFor:()=>({pets:false}),showQuote:(_,data)=>display=data,persistAll(){}};
 vm.createContext(ctx);vm.runInContext(fn('selectAirport'),ctx);await ctx.selectAirport(airport);
 assert.equal(routed[0].name,direction==='from'?'AILA':'Casa');assert.equal(routed[1].name,direction==='from'?'Casa':'AILA');
 assert.equal(display.originName,routed[0].name);assert.equal(display.destName,routed[1].name);
 assert.deepEqual(Array.from(ctx.quoteRouteData.aeropuerto.originLatLng),[routed[0].lat,routed[0].lng]);
});
test('an unverified route never displays the geometric fare',()=>{
 let manual=0;const ctx={showManualQuote:()=>manual++};vm.createContext(ctx);vm.runInContext(fn('showQuote'),ctx);
 ctx.showQuote('movilizarte',{originName:'A',destName:'B',price:999,distanceKm:99,minutes:90,real:false});assert.equal(manual,1);
});
test('opening services focuses the missing origin instead of skipping it',()=>{
 let focused=false;const $=nodes();$('#origin-search-input').focus=()=>focused=true;$('#origin-search-input').scrollIntoView=()=>{};
 $('[data-service="aeropuerto"]').dataset={name:'Aeropuerto'};
 const ctx={$, $$:()=>[],activeService:'movilizarte',airportDirection:'to',userLocation:null,refreshActiveQuote(){}};
 vm.createContext(ctx);vm.runInContext(fn('activateService'),ctx);ctx.activateService('aeropuerto',true);
 assert.equal(focused,true);assert.equal($('#serviceSelector').open,false);
});
