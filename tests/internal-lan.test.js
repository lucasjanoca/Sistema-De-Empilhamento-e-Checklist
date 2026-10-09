const assert=require('node:assert/strict');
const http=require('node:http');
const {createServer,configFromEnv,isPrivateIPv4,upstreamUrl,routes}=require('../teste-interno/server.js');
const fs=require('node:fs');
const bundle=fs.readFileSync('empilhadores/assets/app.bundle.js','utf8');

const code='um_codigo_de_teste_com_24_caracteres';
const cfg=configFromEnv({
  SELENE_API_BASE:'http://127.0.0.1:33333/reqempilhadeira-api.prd',
  SELENE_COD_GRUPO:'1',SELENE_COD_EMP:'emp1',
  SELENE_ALLOW_LAN:'1',SELENE_TEST_ACCESS_CODE:code,SELENE_TEST_PORT:'0'
});
assert.equal(cfg.bindHost,'0.0.0.0');
assert.equal(cfg.lanEnabled,true);
assert.ok(cfg.accessCode.length>=16);
assert.equal(isPrivateIPv4('192.168.112.3'),true);
assert.equal(isPrivateIPv4('172.20.10.1'),true);
assert.equal(isPrivateIPv4('8.8.8.8'),false);
assert.equal(isPrivateIPv4('172.34.0.1'),false);
assert.equal(configFromEnv({
  SELENE_API_BASE:'http://127.0.0.1:3000/api',
  SELENE_TEST_PORT:'0'
}).bindHost,'127.0.0.1');
const up=upstreamUrl(cfg,routes.pending);
assert.equal(up.searchParams.get('codEmp'),'emp1');
assert.equal(up.searchParams.get('situacao'),'1');
assert.match(bundle,/parts\[0\]===192&&parts\[1\]===168/,'Frontend aceita PC em rede privada');
const auth='Basic '+Buffer.from('infotech:'+code).toString('base64');
async function listen(s){
  await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));
  return 'http://127.0.0.1:'+s.address().port;
}
async function stop(s){await new Promise(resolve=>s.close(resolve))}
async function main(){
  const original=global.fetch;
  global.fetch=async(url)=>{
    const target=String(url);
    let payload={Success:true,Response:[],Count:0};
    if(target.includes('ObtemRequisicoesPendente'))
      payload={Success:true,Response:[{num_req:1001,endereco_orig:'11-001-1'}],Count:1};
    else if(target.includes('ObtemRequisicoesAtendimento'))
      payload={Success:true,Response:[{num_req:1002,endereco_orig:'12-002-2'}],Count:1};
    return {ok:true,status:200,headers:new Map(),text:async()=>JSON.stringify(payload)};
  };
  const server=createServer(cfg);
  try {
    const base=await listen(server);
    let res=await original(base+'/empilhadores/');
    assert.equal(res.status,401,'LAN exige senha');
    assert.match(res.headers.get('www-authenticate'),/Basic/);
    res=await original(base+'/api/selene-read/snapshot',{headers:{Authorization:auth}});
    assert.equal(res.status,200);
    const data=await res.json();
    assert.equal(data.pending.Response.length,1);
    assert.equal(data.attendance.Response.length,1);
    assert.equal(data.readOnly,true);
    res=await original(base+'/empilhadores/',{headers:{Authorization:auth}});
    assert.equal(res.status,200);
    assert.match(await res.text(),/view-operacao/);
    res=await original(base+'/api/selene-read/snapshot',{
      method:'POST',headers:{Authorization:auth}
    });
    assert.equal(res.status,405,'Bloqueia escrita');
    res=await original(base+'/api/selene-read/snapshot',{
      headers:{Authorization:auth,Origin:'https://origem-maliciosa.example'}
    });
    assert.equal(res.status,403,'Bloqueia outra origem');
    res=await original(base+'/api/selene-read/status',{headers:{
      Authorization:'Basic '+Buffer.from('infotech:senha-incorreta').toString('base64')
    }});
    assert.equal(res.status,401,'Senha errada bloqueada');
    console.log('14 verificações passaram: PC/tablet LAN, senha, consultas oficiais e bloqueio de escrita.');
  }finally{await stop(server);global.fetch=original}
}
main().catch(e=>{console.error(e);process.exitCode=1});
