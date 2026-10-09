'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createServer,configFromEnv,isPrivateIPv4,upstreamUrl,routes}=require('../teste-interno/server');
const code='codigo-sintetico-de-acesso-seguro';
const cfg=configFromEnv({
  SELENE_API_BASE:'http://127.0.0.1:34567/reqempilhadeira-api.prd',
  SELENE_COD_GRUPO:'1',SELENE_COD_EMP:'emp1',
  SELENE_ALLOW_LAN:'1',SELENE_TEST_ACCESS_CODE:code,
  SELENE_TEST_USERNAME:'123456',SELENE_TEST_PORT:'0'
});
assert.equal(cfg.bindHost,'0.0.0.0');
assert.equal(cfg.accessUsername,'123456');
assert.equal(cfg.officialWritesEnabled,false);
assert.equal(isPrivateIPv4('192.168.112.3'),true);
assert.equal(isPrivateIPv4('8.8.8.8'),false);
assert.equal(upstreamUrl(cfg,routes.pending).searchParams.get('situacao'),'1');
const productionCfg=configFromEnv({
  SELENE_API_BASE:'http://127.0.0.1:34567/api',SELENE_OFFICIAL_WRITES:'1',
  SELENE_ALLOW_LAN:'1',SELENE_TEST_PORT:'0'
});
assert.equal(productionCfg.bindHost,'127.0.0.1','Escrita oficial só no loopback');
const starterScript=fs.readFileSync('teste-interno/INICIAR-PC-E-TABLETS.ps1','utf8');
assert.match(starterScript,/AsSecureString/);
assert.match(starterScript,/Matricula para login/);
const auth='Basic '+Buffer.from('123456:'+code).toString('base64');
async function main(){
 const original=global.fetch;
 global.fetch=async url=>{
   const name=String(url);
   const payload=name.includes('Pendentes')
     ? {Response:[{num_req:101,endereco_orig:'01-001-1'}],Success:true}
     : {Response:[{num_req:202,endereco_orig:'02-001-1',icon_cor:'verde'}],Success:true};
   return {ok:true,status:200,headers:new Map(),text:async()=>JSON.stringify(payload)};
 };
 const server=createServer(cfg);
 try{
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   const base='http://127.0.0.1:'+server.address().port;
   let res=await original(base+'/empilhadores/');
   assert.equal(res.status,401);
   res=await original(base+'/api/selene-read/snapshot',{headers:{Authorization:auth}});
   assert.equal(res.status,200);
   const data=await res.json();
   assert.equal(data.pending.Response.length,1);
   assert.equal(data.attendance.Response.length,1);
   assert.equal(data.testMode,undefined,'Não expor estado de simulação');
   assert.equal(data.testMovements,undefined);
   res=await original(base+'/api/selene-read/status',{headers:{Authorization:auth}});
   const info=await res.json();
   assert.equal(info.writeEnabled,false);
   assert.equal(info.officialOperations,true);
   res=await original(base+'/api/selene-operation/move',{
     method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},
     body:JSON.stringify({id:101,direction:'down'})
   });
   assert.equal(res.status,503,'Nunca inventar gravação oficial');
   res=await original(base+'/api/selene-test/move',{
     method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},
     body:JSON.stringify({id:101,direction:'down'})
   });
   assert.equal(res.status,405,'Endpoint de simulação removido');
   res=await original(base+'/api/selene-read/snapshot',{
     method:'POST',headers:{Authorization:auth}
   });
   assert.equal(res.status,405);
   res=await original(base+'/api/selene-read/snapshot',{
     headers:{Authorization:auth,Origin:'https://terceiro.example'}
   });
   assert.equal(res.status,403);
   res=await original(base+'/api/selene-read/status',{headers:{
     Authorization:'Basic '+Buffer.from('123456:incorreta').toString('base64')
   }});
   assert.equal(res.status,401);
   console.log('Servidor PC/tablet: autenticação, leitura real, escrita bloqueada sem adaptador, e sem simulador — 16 validações passaram.');
 }finally{
   await new Promise(resolve=>server.close(resolve));
   global.fetch=original;
 }
}
main().catch(error=>{console.error(error);process.exitCode=1});
