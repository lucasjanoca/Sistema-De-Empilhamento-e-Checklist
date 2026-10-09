'use strict';
// Servidor LOCAL de teste: expõe somente leitura de quatro consultas da Selene.
// Não instala nada na rede da empresa, não altera o sistema original,
// não requer biblioteca externa e escuta somente 127.0.0.1.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BASE = 'http://192.168.112.3/reqempilhadeira-api.prd';
const FILE_TYPES = Object.freeze({
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg','.jpeg':'image/jpeg',
  '.webp':'image/webp','.ico':'image/x-icon',
  '.woff':'font/woff','.woff2':'font/woff2'
});
const MAX_BODY = 2 * 1024 * 1024;

function configFromEnv(env=process.env) {
  const apiBase = String(env.SELENE_API_BASE || DEFAULT_BASE).replace(/\/+$/, '');
  const target = new URL(apiBase);
  // Apenas servidor de rede privada/loopback, nunca proxy genérico para a internet.
  const privateHost = /^(127\.0\.0\.1|localhost|10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.(?:\d{1,3}\.)\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.(?:\d{1,3}\.)\d{1,3})$/i.test(target.hostname);
  if(!privateHost || !['http:','https:'].includes(target.protocol) || target.username || target.password)
    throw new Error('SELENE_API_BASE deve ser um endereço HTTP(S) de rede privada sem credenciais.');
  const codGrupo = String(env.SELENE_COD_GRUPO || '1');
  const codEmp = String(env.SELENE_COD_EMP || 'emp1');
  if(!/^\d{1,5}$/.test(codGrupo) || !/^emp\d{1,3}$/i.test(codEmp))
    throw new Error('Grupo ou empilhadeira inválidos. Ex.: grupo 1 e emp1.');
  const port = Number(env.SELENE_TEST_PORT || 8765);
  if(!Number.isInteger(port) || port<0 || port>65535) throw new Error('Porta inválida.');
  return {apiBase,codGrupo,codEmp,port};
}

function json(res,status,value){
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'
  });
  res.end(JSON.stringify(value));
}

const routes = Object.freeze({
  pending: {path:'api/Requisicao/ObtemRequisicoesPendente',situacao:'1',group:true},
  attendance: {path:'api/Requisicao/ObtemRequisicoesAtendimento',situacao:'3',group:true},
  feedback: {path:'api/Requisicao/ObtemFeedBack'},
  addresses: {path:'api/Enderecos/ObtemEnderecosPendentes'}
});

function upstreamUrl(cfg,entry){
  const base = cfg.apiBase.replace(/\/+$/,'')+'/';
  const url = new URL(entry.path,base);
  if(entry.group)url.searchParams.set('codGrupo',cfg.codGrupo);
  url.searchParams.set('codEmp',cfg.codEmp);
  if(entry.situacao)url.searchParams.set('situacao',entry.situacao);
  return url;
}

async function readUpstream(cfg,entry){
  const url=upstreamUrl(cfg,entry);
  const response=await fetch(url,{
    method:'GET',headers:{'Accept':'application/json'},redirect:'error',
    signal:AbortSignal.timeout(6500),cache:'no-store'
  });
  if(!response.ok)throw new Error('API respondeu HTTP '+response.status+' em '+entry.path.split('/').pop());
  if(Number(response.headers.get('content-length') || 0)>MAX_BODY)
    throw new Error('Resposta acima do limite seguro.');
  const body=await response.text();
  if(Buffer.byteLength(body)>MAX_BODY)throw new Error('Resposta acima do limite seguro.');
  let parsed;
  try{parsed=JSON.parse(body);}catch{throw new Error('API retornou JSON inválido.');}
  if(!Array.isArray(parsed) && (!parsed || typeof parsed!=='object'))
    throw new Error('Formato da resposta inesperado.');
  return parsed;
}

function allowedBrowserRequest(req){
  if(req.headers['sec-fetch-site']==='cross-site')return false;
  const origin=req.headers.origin;
  if(!origin)return true;
  try{
    const url=new URL(origin);
    return url.hostname==='127.0.0.1' || url.hostname==='localhost';
  }catch{return false;}
}

function createHandler(cfg,options={}){
  let pendingSnapshot=null;
  const root = options.root || ROOT;
  return async (req,res)=>{
    if(!allowedBrowserRequest(req))return json(res,403,{ok:false,error:'Solicitação de outra origem bloqueada.'});
    if(req.method!=='GET' && req.method!=='HEAD')return json(res,405,{ok:false,error:'Este servidor é somente leitura.'});
    let pathname;
    try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}
    catch{return json(res,400,{ok:false,error:'Caminho inválido.'});}
    if(pathname==='/api/selene-read/status')
      return json(res,200,{ok:true,mode:'local-interno-readonly',codGrupo:cfg.codGrupo,codEmp:cfg.codEmp,pollMs:5000,writeEnabled:false});
    if(pathname==='/api/selene-read/snapshot'){
      try{
        if(!pendingSnapshot){
          pendingSnapshot=(async()=>{
            const [pending,attendance]=await Promise.all([
              readUpstream(cfg,routes.pending),readUpstream(cfg,routes.attendance)
            ]);
            // Feedback e endereços são complementares; não devem esconder paletes
            // quando algum desses dois serviços opcionais estiver indisponível.
            const [feedback,addresses]=await Promise.allSettled([
              readUpstream(cfg,routes.feedback),readUpstream(cfg,routes.addresses)
            ]);
            return {ok:true,source:'Selene',readOnly:true,retrievedAt:new Date().toISOString(),
              pending,attendance,
              feedback:feedback.status==='fulfilled'?feedback.value:null,
              addresses:addresses.status==='fulfilled'?addresses.value:null};
          })().finally(()=>{pendingSnapshot=null;});
        }
        return json(res,200,await pendingSnapshot);
      }catch(error){
        return json(res,503,{ok:false,error:'Não foi possível consultar a API interna: '+error.message});
      }
    }
    if(pathname.startsWith('/api/'))return json(res,404,{ok:false,error:'Rota indisponível (somente leitura).'});
    if(pathname==='/') pathname='/empilhadores/';
    if(pathname.endsWith('/')) pathname+='index.html';
    const target=path.resolve(root,'.'+pathname);
    if(!target.startsWith(root+path.sep))return json(res,403,{ok:false,error:'Caminho bloqueado.'});
    const extension=path.extname(target).toLowerCase();
    if(!FILE_TYPES[extension] || target.split(path.sep).some(p=>p.startsWith('.') && p!=='.'))
      return json(res,403,{ok:false,error:'Tipo de arquivo não autorizado.'});
    try{
      const contents=await fs.readFile(target);
      res.writeHead(200,{'Content-Type':FILE_TYPES[extension],
        'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
      return res.end(req.method==='HEAD'?undefined:contents);
    }catch(error){
      return json(res,error.code==='ENOENT'?404:500,{ok:false,error:'Arquivo indisponível.'});
    }
  };
}

function createServer(cfg=configFromEnv(),options={}){
  return http.createServer(createHandler(cfg,options));
}

if(require.main===module){
  const cfg=configFromEnv();
  const server=createServer(cfg);
  server.listen(cfg.port,'127.0.0.1',()=>{
    const port=server.address().port;
    console.log('');
    console.log('InfoTech / Selene — teste de leitura interna');
    console.log('Abrir no navegador: http://127.0.0.1:'+port+'/empilhadores/');
    console.log('Grupo: '+cfg.codGrupo+' | Empilhadeira: '+cfg.codEmp);
    console.log('Somente consultas GET; movimentacoes oficiais DESATIVADAS.');
    console.log('Pressione Ctrl+C para encerrar.');
    console.log('');
  });
}
module.exports={createServer,configFromEnv,readUpstream,upstreamUrl,routes};
