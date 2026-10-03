const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const cp=require('node:child_process');
const root=path.resolve(__dirname,'..');
const skip=new Set(['.git','.claude','.codex','node_modules','videos','docs','tests','scripts','templates']);
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>skip.has(e.name)?[]:e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
const files=walk(root), html=files.filter(p=>p.endsWith('.html'));
for(const file of files.filter(p=>p.endsWith('.js')))cp.execFileSync(process.execPath,['--check',file],{stdio:'pipe'});
const titles=new Set(), canonicals=new Set(); let links=0;
for(const file of html){
 const src=fs.readFileSync(file,'utf8'),rel=path.relative(root,file);
 const title=src.match(/<title>(.*?)<\/title>/s)?.[1];assert.ok(title,rel+' title');assert.ok(!titles.has(title),rel+' unique title');titles.add(title);
 assert.match(src,/<meta name="description" content="[^"]+"/);assert.match(src,/Content-Security-Policy/);
 const canonical=src.match(/rel="canonical" href="([^"]+)"/)?.[1];if(canonical){assert.ok(!canonicals.has(canonical),rel+' canonical unique');canonicals.add(canonical);}
 const ids=[...src.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);assert.equal(ids.length,new Set(ids).size,rel+' duplicate ID');
 for(const m of src.matchAll(/\b(?:src|href|data-src)="([^"]+)"/g)){
  const url=m[1];if(/^(?:https?:|mailto:|tel:|data:|#)/.test(url))continue;
  const parsed=new URL(url,'https://preview.test/'+rel.split(path.sep).join('/'));
  let target=path.join(root,decodeURIComponent(parsed.pathname));
  if(fs.existsSync(target)&&fs.statSync(target).isDirectory())target=path.join(target,'index.html');
  assert.ok(fs.existsSync(target),rel+' missing asset/link '+url);links++;
 }
 assert.ok(!/\?v=(?!36\b)\d+/.test(src),rel+' stale version');
 assert.ok(!/<script async src="https:\/\/www.googletagmanager/.test(src),rel+' GA before consent');
}
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(root,'js/data.js'),'utf8')+';globalThis.config=CONFIG;globalThis.vehicles=VEHICLES;',ctx);
assert.equal(ctx.config.minFareUsd,2,'Do not silently change published minimum');
assert.equal(ctx.config.petFee,1.99,'Preserve pet fee');
for(const v of ctx.vehicles)for(const u of v.units||[])for(const p of [u.photo,u.driverPhoto].filter(Boolean))assert.ok(fs.existsSync(path.join(root,p)),p);
assert.match(fs.readFileSync(path.join(root,'sw.js'),'utf8'),/shell-v36/);
console.log(`OK: JS syntax, ${html.length} HTML pages, ${links} internal links/assets, metadata, unique IDs, cache versions and fleet assets.`);
