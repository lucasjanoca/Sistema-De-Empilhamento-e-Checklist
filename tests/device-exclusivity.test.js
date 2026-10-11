'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Exercita o TabletManager REAL, sem acessar Supabase ou a rede da empresa.
const bundle = fs.readFileSync('empilhadores/assets/app.bundle.js', 'utf8');
const start = bundle.indexOf('const TabletManager = (() => {');
const end = bundle.indexOf('const Permissions = (() => {', start);
assert.ok(start >= 0 && end > start, 'TabletManager deve existir');
const source = bundle.slice(start, end);
const device = {id:'empilhadeira-01',name:'Empilhadeira 01',type:'tablet',active:true,locked:false};
const future = () => Date.now()+120000;
const granted = (person, leaseId='lease-token-example-0001') => ({
  ok:true,deviceId:device.id,matricula:person,leaseId,expiresAt:future()
});

function makeBackend() {
  const reservations = new Map();
  let seq = 0;
  return {
    reservations,
    async claimDevice({deviceId,previousDeviceId='',previousLeaseId=''}, person) {
      const existing=reservations.get(deviceId);
      if(existing && existing.leaseId !== previousLeaseId){
        const error = new Error('Ocupado');error.status=409;throw error;
      }
      // Transferência de aparelho ocorre exclusivamente no servidor.
      if(previousDeviceId && previousLeaseId && previousDeviceId!==deviceId) {
        const old=reservations.get(previousDeviceId);
        if(old?.leaseId === previousLeaseId) reservations.delete(previousDeviceId);
      }
      const result=granted(person,'lease-token-example-'+String(++seq).padStart(6,'0'));
      reservations.set(deviceId,result);
      return result;
    },
    async renewDevice({deviceId,leaseId}) {
      const result=reservations.get(deviceId);
      if(!result || result.leaseId!==leaseId) {
        const error=new Error('Sem reserva');error.status=409;throw error;
      }
      result.expiresAt=future();
      return {...result};
    },
    async releaseDevice({deviceId,leaseId}) {
      if(reservations.get(deviceId)?.leaseId===leaseId) {
        reservations.delete(deviceId);
        return {ok:true};
      }
      const error=new Error('Reserva inválida');error.status=409;throw error;
    }
  };
}

function makeClient(person, backend, {cloud=true,initialTablet=null}={}) {
  let tablet=initialTablet;
  let user={matricula:person,nome:'Pessoa '+person,role:'empilhador'};
  const errors=[];
  const changes=[];
  const data={
    registeredDevices:[{...device}],tabletAssignments:[],productionRequests:[],
    requests:[]
  };
  const app={
    getUser:()=>user,getTablet:()=>tablet,getData:()=>data,
    setTablet:obj=>{tablet=obj;changes.push(['set',obj]);},
    clearTablet:()=>{tablet=null;changes.push(['clear']);},
    addAudit:()=>{},save:()=>{},getRoleLabel:()=> 'Emp'
  };
  const ui={
    $:()=>null,
    toast:message=>errors.push(message)
  };
  const remote={
    claimDevice:req=>backend.claimDevice(req,person),
    renewDevice:req=>backend.renewDevice(req),
    releaseDevice:req=>backend.releaseDevice(req)
  };
  const sandbox={
    AppState:app,UI:ui,SecurityApi:{isAccountCloud:()=>cloud},
    InfoTechSupabaseAccounts:remote,
    Operation:{hasActiveMovement:()=>false},
    Date,Math,Number,Boolean,String,Promise,Array,Set,
    console,
    setInterval:()=>1,setTimeout:()=>1,clearInterval:()=>{},
    document:{addEventListener:()=>{}}
  };
  const manager=vm.runInNewContext(source+'\nTabletManager;',sandbox,{
    filename:'TabletManager.js',timeout:2000
  });
  return {
    manager,data,errors,changes,
    get tablet(){return tablet;},
    setUser(next){user=next;}
  };
}

test('dois funcionários simultâneos: só um recebe a concessão do mesmo equipamento', async ()=>{
  const backend=makeBackend(),ana=makeClient('111111',backend),bruno=makeClient('222222',backend);
  const [a,b]=await Promise.all([
    ana.manager.select('Empilhadeira 01'),
    bruno.manager.select('Empilhadeira 01')
  ]);
  assert.equal(Number(a)+Number(b),1,'O servidor deve conceder exatamente uma reserva');
  assert.equal(backend.reservations.size,1);
  assert.equal([ana.tablet,bruno.tablet].filter(Boolean).length,1);
  assert.match((a?bruno:ana).errors.join(' '),/em uso por outro funcionário/i);
});

test('modo Supabase não aceita seleção se o serviço de reserva ainda não existe', async ()=>{
  const broken={claimDevice:async()=>{throw new Error('Ação desconhecida');}};
  const client=makeClient('111111',broken);
  assert.equal(await client.manager.select(device.name),false);
  assert.equal(client.tablet,null);
  assert.equal(client.data.tabletAssignments.length,0);
  assert.match(client.errors.join(' '),/servidor/i);
});

test('resposta sem token válido não registra uma ocupação como bem-sucedida', async ()=>{
  const broken={claimDevice:async()=>({ok:true,deviceId:device.id,matricula:'111111',leaseId:'',expiresAt:future()})};
  const client=makeClient('111111',broken);
  assert.equal(await client.manager.select(device.name),false);
  assert.equal(client.tablet,null);
  assert.equal(client.data.tabletAssignments.length,0);
});

test('perda de concessão no heartbeat impede uso da seleção anterior', async ()=>{
  const backend=makeBackend(),client=makeClient('111111',backend);
  assert.equal(await client.manager.select(device.name),true);
  assert.ok(client.tablet?.leaseId);
  backend.reservations.delete(device.id);
  await client.manager.heartbeat();
  assert.equal(client.tablet,null);
  assert.match(client.errors.join(' '),/servidor|expirou/i);
});

test('logout libera somente a concessão da sessão corrente', async ()=>{
  const backend=makeBackend(),client=makeClient('111111',backend);
  await client.manager.select(device.name);
  const leaseId=client.tablet.leaseId;
  assert.equal(backend.reservations.get(device.id).leaseId,leaseId);
  await client.manager.releaseCurrent('logout');
  assert.equal(backend.reservations.size,0);
});

test('renovação válida após reload exige resposta do servidor antes de restaurar seleção', async ()=>{
  const backend=makeBackend(),old=makeClient('111111',backend);
  await old.manager.select(device.name);
  const session={...old.tablet};
  const fresh=makeClient('111111',backend,{initialTablet:session});
  await fresh.manager.ensureSelected();
  assert.equal(fresh.tablet.name,device.name);
  assert.equal(fresh.tablet.leaseId,session.leaseId);
  backend.reservations.clear();
  await fresh.manager.ensureSelected();
  assert.equal(fresh.tablet,null);
});

test('logout durante reserva pendente não deve recriar a seleção do usuário antigo', async ()=>{
  let finish;
  const backend={claimDevice:()=>new Promise(resolve=>{finish=resolve;})};
  const client=makeClient('111111',backend);
  const pending=client.manager.select(device.name);
  client.setUser(null);
  finish(granted('111111'));
  assert.equal(await pending,false);
  assert.equal(client.tablet,null);
});

test('modo local preserva bloqueio de ocupação ativa, sem fingir garantia remota', async ()=>{
  const backend=makeBackend(),client=makeClient('222222',backend,{cloud:false});
  client.data.tabletAssignments.push({
    tabletName:device.name,userMatricula:'111111',userName:'Pessoa A',
    active:true,lastSeen:Date.now()
  });
  assert.equal(await client.manager.select(device.name),false);
  assert.equal(client.tablet,null);
  assert.match(client.errors.join(' '),/em uso por/i);
});
