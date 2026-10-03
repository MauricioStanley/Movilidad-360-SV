const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/app.js', 'utf8');
function extract(name) {
  const start = source.search(new RegExp(`  (?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `Function ${name} exists`);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
function elements() {
  const all = new Map();
  return s => {
    if (!all.has(s)) all.set(s, { value: '', textContent: '', hidden: false,
      classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, removeAttribute() {} });
    return all.get(s);
  };
}
test('fixed fare reads current passengers when reviewing', () => {
  const $ = elements(); let pax = { passengers: 1, pets: false }; let confirmation;
  const ctx = { $, fixedRouteIdx: 0, FIXED_ROUTES: { origin: 'Origen', destinations: [{ id:'centro', name:'Centro', price:8 }] },
    CONFIG: { petFee:1.99 }, paxPetsFor:()=>pax, formatMoney:n=>n.toFixed(2), cancellationLine:()=>'',
    openConfirmModal: c=>confirmation=c, persistAll(){}, pointWazeLink:()=>null, trackEvent(){} };
  vm.createContext(ctx); vm.runInContext(extract('updateFixedQuote'),ctx);
  ctx.updateFixedQuote(); pax = { passengers:3,pets:false }; $('#wa-tarifafija').onclick();
  assert.match(confirmation.buildMessage('Efectivo'), /Pasajeros:\* 3/);
  assert.ok(confirmation.rows.some(r=>r.label==='Pasajeros' && r.value==='3'));
});
test('closing a vehicle modal cancels an in-flight transition', () => {
  const jobs=[];
  const ctx = { $:elements(), $$:()=>[], vehicleModalCtx:{idx:0}, vehicleTransitionTimer:null,
    setTimeout:cb=>(jobs.push(cb),1), clearTimeout(){}, renderVehicleModalUnit(){}, M360UI:{close(){}}, document:{activeElement:null}, window:{matchMedia:()=>({matches:false})} };
  vm.createContext(ctx); vm.runInContext(extract('goToVehicleUnit')+'\n'+extract('closeVehicleModal'),ctx);
  ctx.goToVehicleUnit(1,true); ctx.closeVehicleModal();
  assert.doesNotThrow(()=>jobs[0]());
});
test('edit preserves contact and negotiation draft only for the same route', () => {
  const $=elements();
  const ctx={ $, confirmationDrafts:new Map(),confirmModalCtx:{key:'route-A'},confirmRecipient:'other',
    renderConfirmRows(){},renderConfirmPaymentPills(){},renderConfirmBankAccounts(){},renderCancellationNotice(){},renderConfirmRecipientPills(){},trackEvent(){},M360UI:{open(){},close(){}} };
  $('#confirmRecipientName').value='Persona de prueba';$('#confirmRecipientPhone').value='70000000';$('#confirmNegotiatePrice').value='5';$('#confirmNegotiatePanel').hidden=false;
  vm.createContext(ctx);vm.runInContext(extract('closeConfirmModal')+'\n'+extract('openConfirmModal'),ctx);
  ctx.closeConfirmModal();ctx.openConfirmModal({key:'route-A',rows:[],price:8,buildMessage(){}});
  assert.equal($('#confirmRecipientPhone').value,'70000000');assert.equal($('#confirmRecipientName').value,'Persona de prueba');assert.equal($('#confirmNegotiatePrice').value,'5');
  ctx.closeConfirmModal();ctx.openConfirmModal({key:'route-B',rows:[],price:8,buildMessage(){}});
  assert.equal($('#confirmRecipientPhone').value,'');assert.equal($('#confirmNegotiatePanel').hidden,true);
});
test('WhatsApp uses snapshot pickup and each tourist stop, not mutable GPS state', () => {
  const ctx={SERVICE_NAMES:{turismo:'turismo'},CONFIG:{petFee:1.99},wazeLink:(lat,lng)=>`https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
   pointWazeLink:p=>`https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`,formatMoney:n=>'$'+n.toFixed(2),formatEta:()=> '10 min',cancellationLine:()=> 'Política',userLocation:{lat:0,lng:0}};
  vm.createContext(ctx);vm.runInContext(extract('buildQuoteMessage'),ctx);
  const msg=ctx.buildQuoteMessage('turismo',{originName:'A',destName:'C',price:9.99,minutes:10,distanceKm:8,passengers:3,pets:true,real:true,
   routeSnapshot:{originLatLng:[13,-89],destLatLng:[14,-88],stops:[{name:'B',lat:13.5,lng:-88.5},{name:'C',lat:14,lng:-88}]}},'Efectivo');
  assert.match(msg,/ll=13,-89/);assert.match(msg,/Parada 1: B/);assert.match(msg,/Parada 2: C/);assert.match(msg,/Pasajeros:\* 3/);assert.match(msg,/1\.99/);assert.doesNotMatch(msg,/ll=0,0/);
});
