// Simula atraso/falha de rede sem escrever na API interna da Selene.
// Usa os métodos reais de renderização e início do movimento extraídos do bundle.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync('empilhadores/assets/app.bundle.js','utf8');
function between(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0 && b>a, 'Trecho original do bundle deve existir: '+start);
  return source.slice(a,b);
}
const visible = between('  function visibleRequests(){','  function picMarkup(');
const board = between('  function pendingMovementCard(','  function updateElapsedClocks(){');
const movement = between('  async function startMovement(request,direction){','  // Um relógio compartilhado');
const data = {
  requests:[
    {id:101,address:'01-010-1',operator:'A',status:'waiting',corridor:'1-2'},
    {id:102,address:'01-020-1',operator:'B',status:'ready',corridor:'1-2'},
    {id:103,address:'01-030-1',operator:'C',status:'waiting',corridor:'1-2'}
  ],
  selectedCorridors:['1-2']
};
const grid = (id) => ({
  innerHTML:'',style:{},
  querySelectorAll(){return []},
  getBoundingClientRect(){return {top:0,bottom:400}},
  scrollTop:0,id
});
const elements={
  topGrid:grid('topGrid'), bottomGrid:grid('bottomGrid'),
  palletUnifiedScroll:grid('palletUnifiedScroll'),
  searchInput:{value:''}, statusFilter:{value:'all'}, availableOnly:{checked:false}
};
const messages=[];
const saves=[];
const pendingLocks=new Map();
const history=[];
const context={
  data, Map, Date, Number, Math, String, Set,
  AppState:{
    getData:()=>data,getUser:()=>({matricula:'emp1',nome:'Operador',role:'empilhador'}),
    getTablet:()=>({name:'Empilhadeira 1'}),
    save:opts=>saves.push(opts),
    addAudit:(...args)=>history.push(['audit',...args])
  },
  SeleneIntegration:{currentRequests:()=>data.requests,hasLiveData:()=>true,canOfficialMove:()=>false},
  UI:{
    $:id=>elements[id],
    toast:message=>messages.push(message)
  },
  SecurityApi:{
    acquirePalletLock:request=>new Promise((resolve,reject)=>{
      pendingLocks.set(request.id,{resolve,reject});
    }),
    releasePalletLock:async()=>({ok:true})
  },
  Permissions:{can:()=>true},
  getOpenProductionRequest:()=>({id:99,number:'REQ-99'}),
  compareAddresses:()=>0,
  cardTemplate:request=>'<article class="pallet-card '+request.status+'" data-id="'+request.id+'">'+request.address+'</article>',
  handlerMarkup:()=>'',unlockDueFloorRequests:()=>false,
  renderAll:()=>context.renderRequests(),
  addHistory:(...args)=>history.push(['event',...args]),
  startTimer:id=>context.timers.set(id,{deadline:Date.now()+10000}),
  timers:new Map()
};
const operation = vm.runInNewContext(
  '(function(){ const pendingMovements=new Map();'+visible+board+movement+
  'return {startMovement,renderRequests,pendingMovements}; })()',context,{filename:'operation-extracted.js'});
context.renderRequests=operation.renderRequests;

async function test(){
  operation.renderRequests();
  assert.match(elements.topGrid.innerHTML,/01-010-1/);
  const down=operation.startMovement(data.requests[0],'down');
  assert.equal(data.requests[0].status,'waiting','A movimentação não pode ser gravada antes do lock');
  assert.match(elements.bottomGrid.innerHTML,/Validando descida/,'Renderizou imediatamente abaixo');
  assert.doesNotMatch(elements.topGrid.innerHTML,/01-010-1/);

  elements.statusFilter.value='ready';
  elements.availableOnly.checked=true;
  const up=operation.startMovement(data.requests[1],'up');
  assert.equal(data.requests[1].status,'ready');
  assert.match(elements.topGrid.innerHTML,/Validando subida/,'Renderizou imediatamente acima');
  assert.match(elements.bottomGrid.innerHTML,/Validando descida/,'Mantém baixa concorrente');

  pendingLocks.get(102).resolve({ok:true});
  await up;
  assert.equal(data.requests[1].status,'returning');
  assert.match(elements.topGrid.innerHTML,/pallet-card returning/);
  assert.ok(context.timers.has(102),'Palete subindo permanece 10s visível na área de cima');

  pendingLocks.get(101).resolve({ok:true});
  await down;
  assert.equal(data.requests[0].status,'lowering');
  assert.match(elements.bottomGrid.innerHTML,/pallet-card lowering/,'Mesmo sob filtro de disponíveis');

  elements.statusFilter.value='all';
  elements.availableOnly.checked=false;
  const fail=operation.startMovement(data.requests[2],'down');
  assert.match(elements.bottomGrid.innerHTML,/Validando descida/);
  pendingLocks.get(103).reject(new Error('Sem conexão'));
  await fail;
  assert.equal(data.requests[2].status,'waiting','Falha não muda palete de estado');
  assert.match(elements.topGrid.innerHTML,/01-030-1/,'Falha devolve visualmente ao lugar de origem');
  assert.ok(!operation.pendingMovements.has(103),'Falha limpa o estado pendente');
  assert.ok(messages.includes('Sem conexão'));
  assert.equal(saves.length,2,'Só movimentações confirmadas salvam neste cenário');
  console.log('8 cenários passaram: descida/subida imediata, lock, filtro, simultaneidade, 10s e rollback.');
}
test().catch(e=>{console.error(e); process.exitCode=1;});
