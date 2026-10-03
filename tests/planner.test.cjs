const { test } = require('node:test');
const assert = require('node:assert/strict');
const planner = require('../js/planner.js');
const now = Date.parse('2026-10-03T18:00:00Z');
test('scheduling uses El Salvador time even when the device is in another timezone', () => {
  const result = planner.schedule({ mode:'later', date:'2026-10-04', time:'04:30', bags:'2', flight:'av123' }, now);
  assert.equal(result.instant, Date.parse('2026-10-04T10:30:00Z'));
  assert.equal(result.flight,'AV123'); assert.equal(result.bags,2);
  assert.match(result.when, /El Salvador/);
  assert.equal(planner.localDate(Date.parse('2026-10-04T02:00:00Z')), '2026-10-03');
});
test('past, impossible, missing and malformed schedules are rejected', () => {
  for (const [date,time] of [['2026-10-03','11:59'],['2026-02-30','12:00'],['','12:00'],['2026-10-04','25:30'],['2026-10-04','']]) {
    assert.ok(planner.schedule({mode:'later',date,time},now).error, `${date} ${time}`);
  }
});
test('now ignores an old scheduled date and never claims a booking is confirmed', () => {
  const plan=planner.schedule({mode:'now', date:'2020-01-01',time:'10:00'},now);
  assert.equal(plan.error,undefined); assert.equal(plan.date,'');assert.equal(plan.instant,null);
  assert.match(plan.when,/sujeto a disponibilidad/);
});
test('invalid luggage and flight inputs cannot reach the request', () => {
  for (const bags of [-1,1.5,21,'bad',Infinity]) assert.equal(planner.schedule({bags},now).field,'planBags');
  for (const flight of ['<script>','AV*123','A'.repeat(13)]) assert.equal(planner.schedule({flight},now).field,'planFlight');
  assert.equal(planner.schedule({bags:''},now).bags,null);
  assert.equal(planner.schedule({bags:'0'},now).bags,0);
});
const input = {service:'aeropuerto',airportDirection:'from',origin:{name:'Aeropuerto',lat:13.44,lng:-89.05},destination:{name:'Destino',lat:13.7,lng:-89.2}};
test('saved routes whitelist data: no prices, phone, bank, date or recipient', () => {
  const result=planner.route({...input,phone:'secret',bank:'secret',price:8,recipient:'secret',date:'2026-10-04'});
  assert.deepEqual(Object.keys(result).sort(),['airportDirection','destination','origin','service']);
  assert.equal(result.airportDirection,'from');
});
test('saved routes expire, reject invalid coordinates and cap the list', () => {
  const entry={label:'Aeropuerto',savedAt:now,route:input};
  assert.equal(planner.savedRoutes({version:1,routes:Array(9).fill(entry)},now).length,6);
  assert.equal(planner.savedRoutes({version:1,routes:[entry]},now+planner.ROUTE_TTL).length,0);
  assert.equal(planner.savedRoutes({version:0,routes:[entry]},now).length,0);
  assert.equal(planner.route({...input,origin:{name:'X',lat:999,lng:0}}),null);
  assert.equal(planner.route({...input,service:'admin'}),null);
});
test('tourist stops, parcel size and fixed fare names survive safe normalization', () => {
  assert.equal(planner.route({...input,service:'turismo',stops:[input.destination]}).stops.length,1);
  assert.equal(planner.route({...input,service:'turismo',stops:[{lat:NaN,lng:0}]}),null);
  assert.equal(planner.route({...input,service:'encomienda',size:'large'}).size,'large');
  assert.deepEqual(planner.route({service:'tarifafija',fixedName:'Centro Histórico',price:8}),{service:'tarifafija',fixedName:'Centro Histórico'});
});
