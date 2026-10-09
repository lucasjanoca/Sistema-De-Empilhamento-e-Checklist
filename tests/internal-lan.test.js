const assert=require('node:assert/strict');
const http=require('node:http');
const {createServer,configFromEnv,isPrivateIPv4,upstreamUrl,readUpstream,routes}=require('../teste-interno/server.js');
const fs=require('node:fs');
const {identifier}=require('../teste-interno/test-movements');
const bundle=fs.readFileSync('empilhadores/assets/app.bundle.js','utf8');

const code='um_codigo_de_teste_com_24_caracteres';
const cfg=configFromEnv({
  SELENE_API_BASE:'http://127.0.0.1:33333/reqempilhadeira-api.prd',
  SELENE_COD_GRUPO:'1',SELENE_COD_EMP:'emp1',
  SELENE_ALLOW_LAN:'1',SELENE_TEST_ACCESS_CODE:code,SELENE_TEST_PORT:'0'
});
assert.equal(cfg.bindHost,'0.0.0.0');
assert.equal(cfg.lanEnabled,true);
assert.ok(cfg.accessCode.length>=12);
assert.equal(cfg.customAccessCode,true);
const chosenPassword='SenhaEscolhida!';
const chosenConfig=configFromEnv({
  SELENE_API_BASE:'http://127.0.0.1:33333/reqempilhadeira-api.prd',
  SELENE_COD_GRUPO:'1',SELENE_COD_EMP:'emp1',SELENE_ALLOW_LAN:'1',
  SELENE_TEST_ACCESS_CODE:chosenPassword,SELENE_TEST_PORT:'0'
});
assert.equal(chosenConfig.accessCode,chosenPassword,'Deve aceitar senha escolhida de 12+ caracteres');
assert.equal(chosenConfig.customAccessCode,true);
assert.throws(()=>configFromEnv({
  SELENE_API_BASE:'http://127.0.0.1:33333/api',
  SELENE_COD_GRUPO:'1',SELENE_COD_EMP:'emp1',SELENE_ALLOW_LAN:'1',
  SELENE_TEST_ACCESS_CODE:'curta',SELENE_TEST_PORT:'0'
}),/pelo menos 12/);
const generatedConfig=configFromEnv({
  SELENE_API_BASE:'http://127.0.0.1:33333/api',
  SELENE_COD_GRUPO:'1',SELENE_COD_EMP:'emp1',SELENE_ALLOW_LAN:'1',SELENE_TEST_PORT:'0'
});
assert.equal(generatedConfig.customAccessCode,false);
assert.ok(generatedConfig.accessCode.length>=16);
const starter=fs.readFileSync('teste-interno/INICIAR-PC-E-TABLETS.bat','utf8');
const starterScript=fs.readFileSync('teste-interno/INICIAR-PC-E-TABLETS.ps1','utf8');
assert.match(starter,/INICIAR-PC-E-TABLETS\.ps1/);
assert.match(starterScript,/Read-Host.*-AsSecureString/);
assert.match(starterScript,/SELENE_TEST_ACCESS_CODE/);
assert.match(starterScript,/ZeroFreeBSTR/);
assert.equal(isPrivateIPv4('192.168.112.3'),true);
assert.equal(isPrivateIPv4('172.20.10.1'),true);
assert.equal(isPrivateIPv4('8.8.8.8'),false);
assert.equal(isPrivateIPv4('172.34.0.1'),false);
assert.equal(configFromEnv({
  SELENE_API_BASE:'http://127.0.0.1:3000/api',
  SELENE_TEST_PORT:'0'
}).bindHost,'127.0.0.1');
assert.match(routes.pending.path,/ObtemRequisicoesPendentes$/);
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
  let pending404=false;
  let usedFallback=false;
  global.fetch=async(url)=>{
    const target=String(url);
    if(pending404 && target.includes('ObtemRequisicoesPendentes'))
      return {ok:false,status:404,headers:new Map(),text:async()=>''};
    if(pending404 && target.includes('ObtemRequisicoesPendente') &&
       !target.includes('ObtemRequisicoesPendentes')) usedFallback=true;
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
    assert.equal(data.testMode,true,'Ativa simulação, sem escrita corporativa');
    const palletId=identifier({num_req:1001,endereco_orig:'11-001-1'},'pending').id;
    const moveEndpoint=base+'/api/selene-test/move';
    let moveResponse=await original(moveEndpoint,{
      method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},
      body:JSON.stringify({id:palletId,direction:'down'})
    });
    assert.equal(moveResponse.status,200,'Descida de teste permitida para palete verificado');
    let moved=await moveResponse.json();
    assert.equal(moved.state.status,'lowering');
    moveResponse=await original(moveEndpoint,{
      method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},
      body:JSON.stringify({id:palletId,direction:'down'})
    });
    assert.equal(moveResponse.status,409,'Bloqueia movimento duplicado');
    res=await original(base+'/api/selene-read/snapshot',{headers:{Authorization:auth}});
    const synchronized=await res.json();
    assert.equal(synchronized.testMovements.overlays[palletId].status,'lowering',
      'Outro dispositivo ve a mesma movimentação');
    const undoResponse=await original(base+'/api/selene-test/undo',{
      method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},
      body:JSON.stringify({id:palletId})
    });
    assert.equal(undoResponse.status,200,'Desfaz antes de 10s');
    assert.equal((await undoResponse.json()).state.status,'waiting');
    const nonexistent=await original(moveEndpoint,{
      method:'POST',headers:{Authorization:auth,'Content-Type':'application/json'},
      body:JSON.stringify({id:123,direction:'up'})
    });
    assert.equal(nonexistent.status,409,'Nenhum palete inventado pode ser movimentado');

    assert.equal(data.codEmp,'emp1');
    assert.equal(data.codGrupo,'1');
    assert.equal(data.feedback,null,'Feedback opcional nao bloqueia os paletes');
    res=await original(base+'/api/selene-read/status',{headers:{Authorization:auth}});
    assert.equal(res.status,200);
    let stat=await res.json();
    assert.equal(stat.read.ok,true);
    assert.equal(stat.read.pending,1);
    assert.equal(stat.read.attendance,1);

    pending404=true;
    res=await original(base+'/api/selene-read/snapshot',{headers:{Authorization:auth}});
    assert.equal(res.status,200,'Rota alternativa deve ser usada apos 404');
    assert.equal((await res.json()).pending.Response.length,1);
    assert.equal(usedFallback,true,'Consulta de Pendente singular foi testada apos plural 404');
    pending404=false;
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
    console.log('28 verificações passaram: PC/tablet, movimentações de teste compartilhadas, senha e proteção da API corporativa.');
  }finally{await stop(server);global.fetch=original}
}
main().catch(e=>{console.error(e);process.exitCode=1});
