/* Local-only static preview, with byte ranges for the tutorial video. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = {'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.json':'application/json','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.mp4':'video/mp4','.xml':'application/xml','.txt':'text/plain'};
http.createServer((req,res)=>{
  let pathname;
  try { pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  let file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep) && file!==root || /(?:^|[\\/])(?:\.[^/\\]*|node_modules|tests|scripts|docs|videos)(?:[\\/]|$)/.test(path.relative(root,file))) {res.writeHead(404).end();return;}
  try { if(fs.statSync(file).isDirectory()) file=path.join(file,'index.html'); } catch {}
  let code=200;
  if(!fs.existsSync(file) || !fs.statSync(file).isFile()) {file=path.join(root,'404.html');code=404;}
  const size=fs.statSync(file).size;
  const headers={'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
  const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
  if(range && code===200){
    const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):size-1,size-1);
    if(start>end || start>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}
    res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes','Content-Length':end-start+1});
    if(req.method==='HEAD') res.end(); else fs.createReadStream(file,{start,end}).pipe(res);return;
  }
  res.writeHead(code,{...headers,'Content-Length':size});
  if(req.method==='HEAD')res.end();else fs.createReadStream(file).pipe(res);
}).listen(8777,'127.0.0.1',()=>console.log('Vista local: http://127.0.0.1:8777 — sin publicar en GitHub'));
