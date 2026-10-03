const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const core=require('../js/core.js');
const planner=require('../js/planner.js');
const src=fs.readFileSync('js/app.js','utf8');
function extract(name) { const at=src.indexOf('  function '+name+'('); assert.ok(at>=0);return src.slice(at,src.indexOf('\n  }',at)+4); }
function fixture() {
  const elements=new Map(), calls=[];
  const $=selector=>{
    const id=selector.replace(/^#/,'');
    if(!elements.has(id)) elements.set(id,{id,value:'',textContent:'',hidden:false,dataset:{},handlers:{},
      classList:{toggle(){},add(){},remove(){}},setAttribute(){},focus(){this.focused=true;},scrollIntoView(){},
      addEventListener(event,handler){this.handlers[event]=handler;}});
    return elements.get(id);
  };
  const context={$, $$:()=>[], document:{getElementById:id=>$('#'+id),querySelectorAll:()=>[]}, M360Core:core, M360Planner:planner,
    confirmModalCtx:{key:'aeropuerto:AILA:Centro',buildMessage:payment=>'*Ruta:* AILA → Centro\n*Pago:* '+payment},
    confirmRecipient:'self',confirmPaymentMethod:'Efectivo',confirmBankChoice:{bank:'Banco de prueba',number:'123'},
    sanitizeWaText:core.sanitizeWaText || (s=>s),formatMoney:n=>'$'+n.toFixed(2),renderConfirmRecipientPills(){},
    closeConfirmModal(){},trackEvent(){},waLink:msg=>'https://wa.me/000?text='+encodeURIComponent(msg),
    window:{open:url=>calls.push(url),matchMedia:()=>({matches:true})}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/request-options.js','utf8'),context);
  vm.runInContext(extract('wireConfirmModal'),context);
  context.wireConfirmModal();
  $('#confirmNegotiatePanel').hidden=true;
  const route={service:'aeropuerto',airportDirection:'from',origin:{name:'AILA',lat:13.44,lng:-89.05},destination:{name:'Centro',lat:13.69,lng:-89.19}};
  context.M360Request.open('airport','aeropuerto',route);
  return {context,$,calls,route,send:()=>$('#confirmSendBtn').handlers.click(),message:()=>decodeURIComponent(calls[0]?.split('text=')[1]||'')};
}
test('invalid planning blocks the external handoff and focuses the exact field',()=>{
  const f=fixture();f.context.M360Request.read=()=>({error:'Elige la fecha.',field:'planDate'});
  f.send();assert.equal(f.calls.length,0);assert.equal(f.$('#confirmError').hidden,false);assert.equal(f.$('#planDate').focused,true);
});
test('WhatsApp handoff includes SV schedule, bags and flight without stale bank or recipient',()=>{
  const f=fixture();f.$('#confirmRecipientName').value='Persona anterior';f.$('#confirmRecipientPhone').value='70000000';
  f.$('#confirmNegotiatePrice').value='5';
  f.context.M360Request.read=()=>planner.schedule({mode:'later',date:'2026-10-10',time:'04:30',bags:'2',flight:'av123'},Date.parse('2026-10-03T12:00:00Z'));
  f.send();const msg=f.message();assert.equal(f.calls.length,1);assert.match(msg,/10 oct 2026, 4:30 a\. m\./);assert.match(msg,/hora de El Salvador/);
  assert.match(msg,/\*Maletas:\* 2/);assert.match(msg,/\*Vuelo:\* AV123/);assert.match(msg,/pendiente de aceptación/);
  assert.doesNotMatch(msg,/Banco de prueba|Persona anterior|Precio propuesto/);
});
test('a valid recipient, bank and proposed price are included only when enabled',()=>{
  const f=fixture();f.context.confirmRecipient='other';f.context.confirmPaymentMethod='Transferencia';
  f.$('#confirmRecipientName').value='Persona de prueba';f.$('#confirmRecipientPhone').value='70000000';
  f.$('#confirmNegotiatePanel').hidden=false;f.$('#confirmNegotiatePrice').value='25';
  f.send();assert.equal(f.calls.length,1);assert.match(f.message(),/Persona de prueba/);assert.match(f.message(),/Banco de prueba/);assert.match(f.message(),/\$25\.00/);
});
test('editing preserves planning but repeating a saved route resets dates and luggage',()=>{
  const f=fixture();f.$('#planBags').value='2';f.$('#planFlight').value='AV123';f.$('#planDate').value='2026-10-10';
  f.context.M360Request.remember('airport');f.context.M360Request.open('airport','aeropuerto',f.route);
  assert.equal(f.$('#planBags').value,'2');assert.equal(f.$('#planDate').value,'2026-10-10');
  f.context.M360Request.clearDrafts();f.context.M360Request.open('airport','aeropuerto',f.route);
  assert.equal(f.$('#planBags').value,'');assert.equal(f.$('#planDate').value,'');assert.equal(f.$('#planFlight').value,'');
});
