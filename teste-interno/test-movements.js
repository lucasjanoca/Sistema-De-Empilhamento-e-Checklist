'use strict';
// Simulador compartilhado PC/tablets. NUNCA chama a API de escrita da Selene.
// Paletes devem ter sido confirmados nas duas consultas oficiais de leitura.
function unpack(value){
  if(Array.isArray(value)) return value;
  for(const result of [value?.Response,value?.response,value?.Data,value?.data]){
    if(Array.isArray(result)) return result;
  }
  throw new Error('Resposta oficial sem lista de requisições.');
}
function identifier(item,type){
  if(!item || typeof item!=='object')return null;
  const number=String(item.num_req??item.numReq??item.requestId??item.id??'').trim();
  const address=String(item.endereco_orig??item.enderecoOrig??item.endereco??item.address??'').trim().toUpperCase();
  if(!number || !address)return null;
  const seed=type+':'+number+':'+address;
  let hash=2166136261;
  for(let i=0;i<seed.length;i++)hash=Math.imul(hash^seed.charCodeAt(i),16777619)>>>0;
  return {id:1000000000+hash,number,address};
}
function officialGreen(item){
  return item.liberado===true||item.liberado===1||
    /^(verde|green|#008000|#00ff00)$/i.test(String(item.icon_cor??item.cor??'').trim());
}
function createTestMovements(){
  const verified=new Map();
  const states=new Map();
  let revision=0;
  let lastUpdated=0;
  function update(pending,attendance){
    const items=[];
    for(const [list,type] of [[unpack(pending),'pending'],[unpack(attendance),'attendance']]){
      for(const record of list){
        const id=identifier(record,type);
        if(!id)throw new Error('Requisição oficial incompleta: movimentação de teste suspensa.');
        items.push({...id,status:type==='pending'?'waiting':(officialGreen(record)?'ready':'floor')});
      }
    }
    const next=new Map();
    for(const item of items){
      if(next.has(item.id))throw new Error('Identificador oficial duplicado.');
      next.set(item.id,item);
    }
    for(const id of states.keys()){
      if(!next.has(id)){states.delete(id);revision++;}
    }
    verified.clear();
    for(const [id,item] of next) verified.set(id,item);
    lastUpdated=Date.now();
  }
  function effective(id){
    const record=verified.get(Number(id));
    if(!record)return null;
    let movement=states.get(record.id);
    if(movement && ['lowering','returning'].includes(movement.status)
       && Date.now()>=movement.deadline){
      movement={...movement,status:movement.status==='lowering'?'floor':'hidden',deadline:null};
      states.set(record.id,movement);
      revision++;
    }
    return {
      id:record.id,status:movement?.status||record.status,
      remaining:movement?.deadline?Math.max(0,Math.ceil((movement.deadline-Date.now())/1000)):0,
      deadline:movement?.deadline??null,
      lastActor:movement?.actor??null,
      isTestMovement:!!movement
    };
  }
  function snapshot(){
    const overlays={};
    for(const id of states.keys()){
      const state=effective(id);
      if(state)overlays[id]=state;
    }
    return {revision,updatedAt:lastUpdated,overlays};
  }
  function act(id,action,actor){
    const number=Number(id);
    if(!Number.isSafeInteger(number))return {ok:false,status:400,error:'Palete inválido.'};
    const record=verified.get(number);
    if(!record || !lastUpdated || Date.now()-lastUpdated>20000)
      return {ok:false,status:409,error:'Palete não confirmado na consulta oficial atual.'};
    const current=effective(number);
    if(action==='undo'){
      if(!['lowering','returning'].includes(current.status))
        return {ok:false,status:409,error:'Nenhuma movimentação em andamento para cancelar.'};
      states.delete(number);
      revision++;
      return {ok:true,state:effective(number),revision};
    }
    if(!['down','up'].includes(action))
      return {ok:false,status:400,error:'Movimentação inválida.'};
    const required=action==='down'?'waiting':'ready';
    if(current.status!==required)return {ok:false,status:409,error:
      required==='ready'?'Subida não autorizada: o palete não está verde/liberado.':
        'Descida indisponível: palete não está em pendentes.'};
    const next={
      status:action==='down'?'lowering':'returning',
      deadline:Date.now()+10000,actor:String(actor||'Operador de teste').slice(0,60)
    };
    states.set(number,next);
    revision++;
    return {ok:true,state:effective(number),revision};
  }
  return {update,snapshot,act,effective,officialCount:()=>verified.size};
}
module.exports={createTestMovements,identifier,officialGreen,unpack};
