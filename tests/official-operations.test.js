'use strict';
const assert=require('node:assert/strict');
const {createOfficialOperations,fields,isGreen}=require('../teste-interno/official-operations');
const config={officialWritesEnabled:true,adapterPath:'',codGrupo:'1',codEmp:'emp1'};
const pending=()=>({Response:[{num_req:101,endereco_orig:'01-002-1'}]});
const attendance=()=>({Response:[
  {num_req:202,endereco_orig:'02-002-1',icon_cor:'verde'},
  {num_req:203,endereco_orig:'02-003-1',icon_cor:'vermelho'}
]});
const idPending=fields(pending().Response[0],'pending').id;
const idGreen=fields(attendance().Response[0],'attendance').id;
const idRed=fields(attendance().Response[1],'attendance').id;
assert.equal(isGreen(attendance().Response[0]),true);
assert.equal(isGreen(attendance().Response[1]),false);
assert.ok(Number.isSafeInteger(idPending));
let mutated=false,callCount=0;
const readUpstream=async (_cfg,route)=>{
  if(route.path.includes('Pendentes'))return mutated?{Response:[]}:pending();
  return attendance();
};
const routes={
  pending:{path:'api/Requisicao/ObtemRequisicoesPendentes'},
  attendance:{path:'api/Requisicao/ObtemRequisicoesAtendimento'}
};
const noWriter=createOfficialOperations({config,readUpstream,routes});
assert.equal(noWriter.enabled(),false);
async function main(){
  assert.equal((await noWriter.move({id:idPending,direction:'down'})).status,503);
  const writer={
    async move(req){
      callCount++;
      assert.equal(req.officialId,'101');
      assert.equal(req.codEmp,'emp1');
      mutated=true;
      return {confirmed:true,officialId:req.officialId};
    }
  };
  const noIdentity=createOfficialOperations({config,readUpstream,routes,adapter:writer});
  assert.equal(noIdentity.enabled(),false,'Sem validador de login escrita deve ficar bloqueada');
  assert.equal(await noIdentity.authenticate({}),null);
  const operatorValidator={
    async authenticate(req){
      return req?.authenticated ? {matricula:'123456',canOperate:true} : null;
    }
  };
  const operations=createOfficialOperations({config,readUpstream,routes,adapter:writer,operatorValidator});
  assert.deepEqual(await operations.authenticate({authenticated:true}),{matricula:'123456'});
  assert.equal(await operations.authenticate({authenticated:false}),null);
  assert.equal(operations.enabled(),true);
  assert.equal((await operations.move({id:idRed,direction:'up'})).status,409);
  assert.equal((await operations.move({id:123456,direction:'down'})).status,409);
  assert.equal((await operations.move({id:idPending,direction:'up'})).status,409);
  assert.equal((await operations.move({id:'oops',direction:'down'})).status,400);
  assert.equal(callCount,0,'Requisições inválidas nunca acionam escrita');
  const success=await operations.move({id:idPending,direction:'down',actor:'123456'});
  assert.equal(success.ok,true);
  assert.equal(success.confirmed,true);
  assert.equal(success.officialId,'101');
  assert.equal(callCount,1);
  assert.equal((await operations.move({id:idPending,direction:'down'})).status,409,'Precondicao reread');
  const failed=createOfficialOperations({
    config,readUpstream:async (_cfg,r)=>r.path.includes('Pendentes')?pending():attendance(),
    routes,
    adapter:{move:async req=>({confirmed:false,officialId:req.officialId})},
    operatorValidator
  });
  const rejected=await failed.move({id:idPending,direction:'down'});
  assert.equal(rejected.ok,false,'Sem confirmacao nao relata sucesso');
  assert.match(rejected.error,/confirmação/i);
  console.log('Operação oficial: 15 validações passaram (sem endpoint inventado, liberação, confirmação via GET e bloqueios).');
}
main().catch(error=>{console.error(error);process.exitCode=1});
