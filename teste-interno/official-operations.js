'use strict';
// Contrato de movimentação oficial: exige adaptador privado explicitamente habilitado.
// Nenhuma rota POST/PUT do sistema corporativo é deduzida ou inventada aqui.
const fs=require('node:fs');
const path=require('node:path');

function records(payload){
  if(Array.isArray(payload))return payload;
  for(const value of [payload?.Response,payload?.response,payload?.Data,payload?.data,payload?.items]){
    if(Array.isArray(value))return value;
  }
  if(Number(payload?.Count)===0)return [];
  throw new Error('Formato da consulta oficial não reconhecido.');
}
function fields(item,type){
  const officialId=String(item?.num_req??item?.numReq??item?.requestId??item?.id??'').trim();
  const address=String(item?.endereco_orig??item?.enderecoOrig??item?.endereco??item?.address??'').trim().toUpperCase();
  if(!officialId||!address)return null;
  const seed=type+':'+officialId+':'+address;
  let hash=2166136261;
  for(let i=0;i<seed.length;i++)hash=Math.imul(hash^seed.charCodeAt(i),16777619)>>>0;
  return {id:1000000000+hash,officialId,address,type,raw:item};
}
function isGreen(item){
  return item?.liberado===true||item?.liberado===1||
    /^(verde|green|#008000|#00ff00)$/i.test(String(item?.icon_cor??item?.cor??'').trim());
}
function createOfficialOperations({config,readUpstream,routes,adapter=null}){
  let writer=adapter;
  if(!writer && config.officialWritesEnabled && config.adapterPath){
    const file=path.resolve(config.adapterPath);
    const repository=path.resolve(__dirname,'..')+path.sep;
    if(!path.isAbsolute(config.adapterPath)||file.startsWith(repository))
      throw new Error('O adaptador de escrita deve estar fora do repositório público.');
    if(!fs.existsSync(file))throw new Error('Adaptador privado de escrita não encontrado.');
    writer=require(file);
  }
  const enabled=()=>Boolean(config.officialWritesEnabled && writer && typeof writer.move==='function');
  const busy=new Set();
  async function read(){
    const [pending,attendance]=await Promise.all([
      readUpstream(config,routes.pending),
      readUpstream(config,routes.attendance)
    ]);
    const items=[];
    for(const [p,type] of [[pending,'pending'],[attendance,'attendance']]){
      for(const raw of records(p)){
        const entry=fields(raw,type);
        if(!entry)throw new Error('A API retornou um palete sem identificação. Operação recusada.');
        items.push(entry);
      }
    }
    const ids=new Set();
    for(const x of items){
      if(ids.has(x.id))throw new Error('Requisições com identificadores duplicados na API.');
      ids.add(x.id);
    }
    return items;
  }
  async function move({id,direction,actor}){
    if(!enabled())return {ok:false,status:503,error:'A escrita oficial ainda não foi configurada.'};
    const numeric=Number(id);
    if(!Number.isSafeInteger(numeric) || !['down','up'].includes(direction))
      return {ok:false,status:400,error:'Palete ou direção inválida.'};
    if(busy.has(numeric))return {ok:false,status:409,error:'Esta requisição já está em movimentação.'};
    busy.add(numeric);
    try{
      const current=await read();
      const record=current.find(x=>x.id===numeric);
      const expectedType=direction==='down'?'pending':'attendance';
      if(!record || record.type!==expectedType)
        return {ok:false,status:409,error:'O palete não está no estado oficial exigido.'};
      if(direction==='up' && !isGreen(record.raw))
        return {ok:false,status:409,error:'Palete vermelho: subida não liberada pela Selene.'};
      const result=await writer.move({
        direction,officialId:record.officialId,address:record.address,
        codGrupo:config.codGrupo,codEmp:config.codEmp,
        actor:String(actor||'').replace(/[^0-9]/g,'').slice(0,12),
        record:record.raw
      });
      if(!result||result.confirmed!==true||String(result.officialId||'')!==record.officialId)
        return {ok:false,status:502,error:'Sem confirmação válida da API oficial. Verifique no sistema original antes de repetir.'};
      // Conferência por leitura após escrita, não apenas HTTP 200.
      let seen=false;
      for(let attempt=0;attempt<4;attempt++){
        if(attempt)await new Promise(done=>setTimeout(done,650));
        const after=await read();
        const same=after.find(x=>x.id===numeric && x.type===expectedType);
        // Descida: desaparece de pendentes. Subida: desaparece de atendimento.
        if(!same){seen=true;break;}
      }
      if(!seen)
        return {ok:false,status:409,error:'A API aceitou o comando, mas não houve confirmação na consulta. Não repita sem verificar no sistema original.'};
      return {ok:true,confirmed:true,officialId:record.officialId,address:record.address,direction};
    }catch(error){
      return {ok:false,status:502,error:'Não foi possível confirmar a operação oficial: '+String(error?.message||'erro').slice(0,160)};
    }finally{
      busy.delete(numeric);
    }
  }
  return {enabled,move};
}
module.exports={createOfficialOperations,fields,isGreen,records};
