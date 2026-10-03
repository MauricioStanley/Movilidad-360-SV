/* Dependency-free static renderer; generated pages remain GitHub Pages compatible. */
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const templates=path.join(root,'templates');
const layout=fs.readFileSync(path.join(templates,'layout.html'),'utf8');
const pages=JSON.parse(fs.readFileSync(path.join(templates,'pages.json'),'utf8'));
const services=JSON.parse(fs.readFileSync(path.join(templates,'services.json'),'utf8'));
const image=s=>`<img src="/img/services/${s.image}.webp" width="480" height="480" alt="" loading="lazy" decoding="async">`;
const homeServices=services.map(s=>`<a href="/cotizar/#stop-${s.id}" class="service-card"><div class="service-art">${image(s)}</div><div class="service-copy"><h3>${s.name}</h3><p>${s.description}</p><span class="service-action">Elegir servicio <span aria-hidden="true">↗</span></span></div></a>`).join('\n');
const quoteServices=[...new Set(services.map(s=>s.group))].map(group=>`<fieldset class="service-group"><legend>${group}</legend><div class="service-picker">${services.filter(s=>s.group===group).map(s=>`<button class="service-choice" type="button" data-service="${s.id}" data-name="${s.name}" aria-pressed="false"><img src="/img/services/${s.image}.webp" width="480" height="480" alt="" loading="lazy" decoding="async"><span>${s.name}</span><small>${s.description}</small></button>`).join('')}</div></fieldset>`).join('\n');
const check=process.argv.includes('--check');
for(const page of pages){
  const content=fs.readFileSync(path.join(templates,page.key+'.html'),'utf8').replace('{{homeServices}}',homeServices).replace('{{quoteServices}}',quoteServices);
  const values={...page,content,modals:page.modals?fs.readFileSync(path.join(templates,page.modals),'utf8'):''};
  const output=layout.replace(/\{\{([a-zA-Z]+)\}\}/g,(_,name)=>{if(!(name in values))throw Error('Unknown template key '+name);return values[name];}).trimEnd()+'\n';
  const file=path.join(root,page.output);
  if(check){if(fs.readFileSync(file,'utf8')!==output)throw Error(page.output+' is out of date; run npm run build');}
  else {fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,output);}
}
console.log(`${pages.length} static pages ${check?'verified':'rendered'}.`);
