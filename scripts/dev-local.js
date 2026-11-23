// Servidor local de desarrollo: sirve frontend/public y responde /api/sample con el handler real del backend.
// Sin claves de IA responde solo por índice (productos: «tapete», «taladro», «pintura»). Uso: node scripts/dev-local.js
const http=require('http'),fs=require('fs'),path=require('path');
process.env.POSTGRES_URL='';process.env.DATABASE_URL=''; // en local no se registra nada
const ROOT=path.join(__dirname,'..','frontend','public');
const sample=require(path.join(__dirname,'..','backend','api','sample.js'));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.ico':'image/x-icon'};
http.createServer(async (req,res)=>{
  if(req.url.startsWith('/api/sample')){
    let b=''; req.on('data',c=>b+=c); await new Promise(r=>req.on('end',r));
    await new Promise(r=>setTimeout(r,+(process.env.LATENCIA||1200))); // latencia para ver el estado «buscando»
    const R={status(c){this.c=c;return this;},json(o){res.writeHead(this.c||200,{'Content-Type':'application/json'});res.end(JSON.stringify(o));},setHeader(){},};
    try{ await sample({method:'POST',body:b,headers:{}},R);}catch(e){res.writeHead(500);res.end(JSON.stringify({error:'error'}));}
    return;
  }
  if(req.url.startsWith('/api/')){res.writeHead(200);res.end('{}');return;}
  let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  const f=path.join(ROOT,p); if(!f.startsWith(ROOT)||!fs.existsSync(f)){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream'}); fs.createReadStream(f).pipe(res);
}).listen(+(process.env.PORT||8077),()=>console.log('Asistente local: http://localhost:'+(process.env.PORT||8077)));
