const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs');
const core = require('../js/core.js');
const cfg = vm.runInNewContext(fs.readFileSync('js/data.js','utf8')+'\nCONFIG');
test('progressive tiers, minimum and pets',()=>{
  for (const [km,expected] of [[0,2],[1,2],[5,5],[15,13.5],[30,24.75],[50,37.75],[130,81.75]]) {
    assert.equal(core.breakdown(km,false,cfg).total,expected);
    assert.equal(core.breakdown(km,true,cfg).total,Math.round((expected+1.99)*100)/100);
  }
  assert.throws(()=>core.breakdown(NaN,false,cfg));
  assert.throws(()=>core.breakdown(-1,false,cfg));
});
test('coordinate and contact validation',()=>{
  assert.equal(core.validPoint({lat:Infinity,lng:0}),false);
  assert.equal(core.validPoint({lat:13,lng:-89}),true);
  assert.equal(core.phone('7530 8948'),'+50375308948');
  assert.equal(core.phone('call me'),null);
  assert.equal(core.phone('123'),null);
});
test('old responses cannot override a newer selection',()=>{
  const gates=core.gates(); const a=gates.next('local'); gates.next('local');
  assert.equal(gates.current('local',a),false);
});
test('draft expiry and schema validation',()=>{
  assert.equal(core.restoreDraft({version:1,savedAt:100},100),null);
  assert.equal(core.restoreDraft({version:2,savedAt:100},core.DRAFT_TTL+101),null);
  assert.ok(core.restoreDraft({version:2,savedAt:100},100));
  assert.equal(core.restoreDraft({version:2,savedAt:100,origin:{source:'search',point:{lat:999,lng:0}}},100),null);
});
