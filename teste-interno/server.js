'use strict';
// Aplicação de implantação: lê requisições da Selene e só envia movimentações
// se existir um adaptador corporativo explícito e servidor HTTPS autorizado.
// Não utiliza simulação nem movimentação fictícia.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {createOfficialOperations}=require('./official-operations');

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
  // Acesso LAN precisa ser explicitamente habilitado. Sem ele, somente localhost.
  const lanEnabled=String(env.SELENE_ALLOW_LAN || '')==='1';
  // Quando houver escrita oficial, expor a aplicação somente no loopback.
  // Tablets devem entrar por um reverse proxy HTTPS autenticado na empresa.
  const officialWritesEnabled=String(env.SELENE_OFFICIAL_WRITES||'')==='1';
  const bindHost=lanEnabled && !officialWritesEnabled?'0.0.0.0':'127.0.0.1';
  const accessUsername=String(env.SELENE_TEST_USERNAME||'infotech').trim();
  if(env.SELENE_TEST_USERNAME && !/^[0-9]{4,12}$/.test(accessUsername))
    throw new Error('Matrícula de acesso inválida. Digite de 4 a 12 números.');
  const customAccessCode=lanEnabled && typeof env.SELENE_TEST_ACCESS_CODE === 'string' && env.SELENE_TEST_ACCESS_CODE.length > 0;
  const accessCode=lanEnabled
    ? (customAccessCode ? String(env.SELENE_TEST_ACCESS_CODE) : crypto.randomBytes(18).toString('base64url'))
    : '';
  if(lanEnabled && accessCode.length<12)
    throw new Error('A senha de acesso deve conter pelo menos 12 caracteres.');
  const adapterPath=String(env.SELENE_WRITE_ADAPTER_PATH||'').trim();
  return {apiBase,codGrupo,codEmp,port,lanEnabled,bindHost,accessCode,customAccessCode,accessUsername,officialWritesEnabled,adapterPath};
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
  pending: {path:'api/Requisicao/ObtemRequisicoesPendentes',alternativePath:'api/Requisicao/ObtemRequisicoesPendente',situacao:'1',group:true},
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
  // Algumas versões do webapp usam "Pendentes" e outras "Pendente".
  // A alternativa é usada SOMENTE após 404, nunca após 401/403.
  async function attempt(route){
    const url=upstreamUrl(cfg,{...entry,path:route});
    const response=await fetch(url,{
      method:'GET',headers:{'Accept':'application/json'},redirect:'error',
      signal:AbortSignal.timeout(6500),cache:'no-store'
    });
    if(!response.ok){
      const e=new Error('API respondeu HTTP '+response.status+' em '+route.split('/').pop()+
        ' (grupo '+cfg.codGrupo+', empilhadeira '+cfg.codEmp+')');
      e.status=response.status;
      throw e;
    }
    if(Number(response.headers.get('content-length')||0)>MAX_BODY)
      throw new Error('Resposta acima do limite seguro.');
    const body=await response.text();
    if(Buffer.byteLength(body)>MAX_BODY)throw new Error('Resposta acima do limite seguro.');
    let parsed;
    try{parsed=JSON.parse(body);}catch{throw new Error('API retornou JSON inválido.');}
    if(!Array.isArray(parsed) && (!parsed || typeof parsed!=='object'))
      throw new Error('Formato da resposta inesperado.');
    if(parsed?.Success===false || parsed?.Error===true)
      throw new Error('API retornou falha na consulta '+route.split('/').pop());
    return parsed;
  }
  try{return await attempt(entry.path);}
  catch(error){
    if(error.status!==404 || !entry.alternativePath)throw error;
    return attempt(entry.alternativePath);
  }
}

function isPrivateIPv4(input){
  const value=String(input||'').replace(/^::ffff:/,'');
  if(value==='::1' || value==='127.0.0.1') return true;
  const segments=value.split('.').map(Number);
  if(segments.length!==4||segments.some(n=>!Number.isInteger(n)||n<0||n>255))return false;
  return segments[0]===10 ||
    (segments[0]===192&&segments[1]===168) ||
    (segments[0]===172&&segments[1]>=16&&segments[1]<=31) ||
    segments[0]===127;
}
function allowedBrowserRequest(req){
  // Não servir recursos a clientes fora da LAN, nem permitir CORS externo.
  if(!isPrivateIPv4(req.socket?.remoteAddress)) return false;
  if(req.headers['sec-fetch-site']==='cross-site')return false;
  const origin=req.headers.origin;
  if(!origin)return true;
  try{
    const url=new URL(origin);
    const host=req.headers.host;
    return (url.protocol==='http:' || url.protocol==='https:') && url.host===host;
  }catch{return false;}
}
function authenticated(req,cfg){
  if(!cfg.lanEnabled) return true; // localhost-only, não exposto na rede
  const raw=String(req.headers.authorization||'');
  if(!raw.startsWith('Basic ') || raw.length>2048) return false;
  let payload;
  try{payload=Buffer.from(raw.slice(6),'base64').toString('utf8');}
  catch{return false;}
  const separator=payload.indexOf(':');
  if(separator<0||payload.slice(0,separator)!==cfg.accessUsername)return false;
  const actual=crypto.createHash('sha256').update(payload.slice(separator+1)).digest();
  const expected=crypto.createHash('sha256').update(String(cfg.accessCode)).digest();
  return crypto.timingSafeEqual(actual,expected);
}
function requireAuthentication(res){
  res.writeHead(401,{
    'WWW-Authenticate':'Basic realm="InfoTech - teste interno", charset="UTF-8"',
    'Content-Type':'text/plain; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'
  });
  res.end('Acesso restrito: informe a matrícula e senha configuradas ao iniciar o teste.');
}
function localAddresses(){
  const addresses = [];
  for(const interfaces of Object.values(os.networkInterfaces())){
    for(const iface of interfaces || []){
      if((iface.family==='IPv4'||iface.family===4) && !iface.internal &&
        isPrivateIPv4(iface.address)) addresses.push(iface.address);
    }
  }
  return [...new Set(addresses)];
}

function createHandler(cfg,options={}){
  let pendingSnapshot=null;
  let lastRead={ok:false,checkedAt:null,pending:0,attendance:0,error:'Ainda não foi feita consulta.'};
  let lastPrinted='';
  const operations=options.operations||createOfficialOperations({config:cfg,readUpstream,routes});
  const root = options.root || ROOT;
  return async (req,res)=>{
    if(!allowedBrowserRequest(req))return json(res,403,{ok:false,error:'Acesso fora da rede interna ou de outra origem bloqueado.'});
    if(!authenticated(req,cfg))return requireAuthentication(res);
    let pathname;
    try{pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);}
    catch{return json(res,400,{ok:false,error:'Caminho inválido.'});}
    if(req.method==='POST' && pathname==='/api/selene-operation/move'){
      if(!operations.enabled())
        return json(res,503,{ok:false,error:'Movimentação oficial indisponível: falta o adaptador de escrita da Selene.'});
      if(cfg.lanEnabled && !(req.socket?.remoteAddress==='127.0.0.1' ||
           req.socket?.remoteAddress==='::1' || req.socket?.remoteAddress==='::ffff:127.0.0.1')){
        return json(res,403,{ok:false,error:'Gravação disponível somente via servidor local ou proxy HTTPS autorizado.'});
      }
      let raw='';
      try{
        for await(const chunk of req){
          raw+=chunk.toString('utf8');
          if(Buffer.byteLength(raw)>2048)return json(res,413,{ok:false,error:'Corpo da requisição muito grande.'});
        }
        const payload=JSON.parse(raw);
        const response=await operations.move({
          id:payload?.id,direction:payload?.direction,
          actor:cfg.accessUsername
        });
        return json(res,response.ok?200:(response.status||409),response);
      }catch(error){
        return json(res,400,{ok:false,error:String(error.message||'Movimentação recusada').slice(0,250)});
      }
    }
    if(req.method!=='GET' && req.method!=='HEAD')
      return json(res,405,{ok:false,error:'Rota não aceita escrita.'});
    if(pathname==='/api/selene-read/status'){
      const isLocal=['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
      return json(res,200,{ok:true,mode:'local-interno-readonly',codGrupo:cfg.codGrupo,
        codEmp:cfg.codEmp,pollMs:5000,writeEnabled:operations.enabled()&&isLocal,
        officialOperations:true,read:lastRead});
    }
    if(pathname==='/api/selene-read/snapshot'){
      try{
        if(!pendingSnapshot){
          pendingSnapshot=(async()=>{
            // Esses dois GETs determinam o painel. Feedback e endereços são opcionais
            // e não podem bloquear cada atualização da lista de paletes.
            const [pending,attendance]=await Promise.all([
              readUpstream(cfg,routes.pending),readUpstream(cfg,routes.attendance)
            ]);
            function count(list){
              if(Array.isArray(list))return list.length;
              for(const values of [list?.Response,list?.response,list?.Data,list?.data]){
                if(Array.isArray(values))return values.length;
              }
              return Number.isFinite(Number(list?.Count)) ? Number(list.Count) : 0;
            }
            lastRead={
              ok:true,checkedAt:new Date().toISOString(),
              pending:count(pending),attendance:count(attendance),error:null
            };
            const marker='ok:'+lastRead.pending+':'+lastRead.attendance;
            if(marker!==lastPrinted){
              console.log('[Consulta Selene] '+cfg.codEmp+' · '+lastRead.pending+
                ' aguardando, '+lastRead.attendance+' em atendimento.');
              lastPrinted=marker;
            }
            return {ok:true,source:'Selene',readOnly:true,retrievedAt:lastRead.checkedAt,
              codGrupo:cfg.codGrupo,codEmp:cfg.codEmp,pending,attendance,feedback:null,addresses:null};
          })().finally(()=>{pendingSnapshot=null;});
        }
        return json(res,200,await pendingSnapshot);
      }catch(error){
        lastRead={ok:false,checkedAt:new Date().toISOString(),pending:0,attendance:0,
          error:String(error?.message||'Falha desconhecida').slice(0,240)};
        const marker='erro:'+lastRead.error;
        if(marker!==lastPrinted){
          console.warn('[Consulta Selene] Falha em '+cfg.codEmp+': '+lastRead.error);
          lastPrinted=marker;
        }
        return json(res,503,{ok:false,error:'Não foi possível consultar a API interna: '+lastRead.error,
          codGrupo:cfg.codGrupo,codEmp:cfg.codEmp});
      }
    }
    if(pathname.startsWith('/api/'))return json(res,404,{ok:false,error:'Rota inexistente.'});
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

function operationsEnabledMessage(cfg){
  return cfg.officialWritesEnabled
    ? 'Escrita solicitada: exige adaptador corporativo e validacao das respostas oficiais.'
    : 'Movimentacoes: BLOQUEADAS ate configurar o contrato de escrita oficial.';
}
function createServer(cfg=configFromEnv(),options={}){
  return http.createServer(createHandler(cfg,options));
}

if(require.main===module){
  const cfg=configFromEnv();
  const server=createServer(cfg);
  server.listen(cfg.port,cfg.bindHost,()=>{
    const port=server.address().port;
    console.log('');
    console.log('InfoTech / Selene — aplicacao para instalacao no PC');
    console.log('Computador: http://127.0.0.1:'+port+'/empilhadores/');
    if(cfg.lanEnabled && !cfg.officialWritesEnabled){
      const addresses=localAddresses();
      for(const address of addresses)console.log('Tablet na mesma rede: http://'+address+':'+port+'/empilhadores/');
      if(!addresses.length)console.log('Nenhum IPv4 privado da rede encontrado. Verifique Wi-Fi/LAN.');
      console.log('Usuario do acesso restrito: '+cfg.accessUsername);
      if(cfg.customAccessCode) console.log('Senha de acesso: a mesma que voce digitou ao iniciar (nao exibida).');
      else console.log('Codigo temporario: '+cfg.accessCode);
      console.log('AVISO: HTTP LAN nao e adequado para operacao definitiva. Configure HTTPS no servidor da empresa.');
    }
    console.log('Grupo: '+cfg.codGrupo+' | Empilhadeira: '+cfg.codEmp);
    console.log('Paletes: consultas oficiais.');
    console.log(operationsEnabledMessage(cfg));
    console.log('Pressione Ctrl+C para encerrar.');
    console.log('');
  });
}
module.exports={createServer,configFromEnv,readUpstream,upstreamUrl,routes,isPrivateIPv4,authenticated,localAddresses,operationsEnabledMessage};
