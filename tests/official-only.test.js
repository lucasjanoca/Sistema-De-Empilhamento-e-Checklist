const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const bundle=fs.readFileSync('empilhadores/assets/app.bundle.js','utf8');
const a=bundle.indexOf('const SeleneIntegration=(()=>{');
const b=bundle.indexOf('const Reports = (() => {',a);
assert.ok(a>=0&&b>a);
const source=bundle.slice(a,b);
const oldLocal={id:999,address:'FAKE-000',status:'waiting',sourceType:'MANUAL'};
const raw={
  pending:{Success:true,Count:1,Response:[{num_req:123,endereco_orig:'01-005-1',dat_hor_req:'2026-10-09T20:00:00',usuario_req:'Operador Teste'}]},
  attendance:{Success:true,Count:1,Response:[{num_req:124,endereco_orig:'02-010-2',icon_cor:'verde',usuario_req:'Outro Operador'}]}
};
let mode='ok';
const context={
  AppState:{getData:()=>({requests:[oldLocal],settings:{integration:{enabled:true}}}),getUser:()=>({role:'ti'})},
  SecurityApi:{
    isServerMode:()=>true,isAccountCloud:()=>false,
    getIntegrationConfig:async()=>({enabled:true,serverBase:'',routePending:'pending',routeAttendance:'attendance',interval:10000}),
    integrationRead:async route=>{
      if(mode==='error')throw Error('Sem conexão');
      if(mode==='malformed')return {Success:true,Response:[{num_req:321,usuario_req:'Sem endereco'}]};
      if(mode==='zero')return {Success:true,Count:0,Response:[]};
      return raw[route];
    }
  },
  Operation:{renderAll:()=>{}},Dashboard:{render:()=>{}},MyPallets:{render:()=>{}},
  document:{createElement:()=>({className:'',textContent:'',title:''}),querySelector:()=>({appendChild:()=>{}})},
  localStorage:{getItem:()=>null,setItem:()=>{}},
  setInterval:()=>1,clearInterval:()=>{},
  Date,Array,Math,Map,String,Number,JSON,Object
};
const api=vm.runInNewContext(source+';SeleneIntegration',context);
async function run(){
  let r=await api.refresh();
  assert.equal(r.ok,true);
  let list=api.currentRequests();
  assert.equal(list.length,2);
  assert.ok(list.every(item=>item.external&&item.officialVerified&&item.sourceType==='OFICIAL'));
  assert.ok(!list.some(item=>item.address===oldLocal.address));
  assert.equal(list[0].originRequestNumber,'123');
  assert.equal(list[0].address,'01-005-1');
  assert.equal(list[0].status,'waiting');
  assert.equal(list[1].status,'ready');
  assert.equal(api.hasLiveData(),true);
  const firstId=list[0].id;
  await api.refresh();
  assert.equal(api.currentRequests()[0].id,firstId,'ID oficial estável entre consultas');
  mode='error';
  r=await api.refresh();
  assert.equal(r.ok,false);
  assert.equal(api.currentRequests().length,0,'Falha deve ocultar dados desatualizados');
  assert.equal(api.hasLiveData(),false);
  mode='malformed';
  r=await api.refresh();
  assert.equal(r.ok,false,'Requisição sem endereço não é válida');
  assert.equal(api.currentRequests().length,0);
  mode='zero';
  r=await api.refresh();
  assert.equal(r.ok,true);
  assert.equal(api.currentRequests().length,0);
  assert.equal(api.hasLiveData(),true,'Resposta oficial vazia difere de indisponibilidade');
  console.log('16 validações passaram: apenas dados oficiais, IDs estáveis, estados e falha segura.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
