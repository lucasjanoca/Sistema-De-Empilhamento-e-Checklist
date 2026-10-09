const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('empilhadores/assets/pallet-details.js','utf8');
const listeners = {};
const fields = {};
const ids = ['palletDetailsDialog','palletDetailsAddress','palletDetailsRequest','palletDetailsStatus',
  'palletDetailsRequester','palletDetailsLastOperator','palletDetailsEquipment','palletDetailsCreated',
  'palletDetailsHistory','palletDetailsAction','palletDetailsClose'];
for(const id of ids) {
  fields[id] = {
    textContent:'',innerHTML:'',dataset:{},hidden:false,
    events:{},addEventListener(type,listener){this.events[type] = listener;}
  };
}
const dialog = fields.palletDetailsDialog;
dialog.open = false;
dialog.showModal = () => {dialog.open = true;};
dialog.close = () => {dialog.open = false;};
const requests = [
  {id:1,address:'01-001-1',status:'ready',originRequestNumber:'REQ-1',
    requestedByName:'Operador A',lastHandledByName:'Empilhador B',createdAt:1000},
  {id:2,address:'02-001-1',status:'waiting',originRequestNumber:'REQ-2',
    requestedByName:'Operador C',createdAt:2000}
];
const history = [
  {address:'01-001-1',requestNumber:'REQ-1',time:1000,operator:'Operador A',action:'Solicitado'},
  {address:'01-001-1',requestNumber:'REQ-1',time:7000,operator:'Empilhador B',action:'Desceu palete'},
  {address:'01-001-1',requestNumber:'REQ-OLD',time:4000,operator:'Desconhecido',action:'Outro palete'},
  {address:'02-001-1',requestNumber:'REQ-2',time:2000,operator:'Operador C',
    action:'<img src=x onerror=alert(1)>'}
];
let canOperate=true;
const actions=[];
const ctx={
  document:{
    getElementById:id=>fields[id],
    addEventListener(type,callback){listeners[type]=callback;},
    dispatchEvent(event){actions.push(event);}
  },
  AppState:{getData:()=>({requests,history}),getUser:()=>({role:'empilhador'})},
  Permissions:{can:()=>canOperate},
  CustomEvent:class {constructor(type,opts){this.type=type;this.detail=opts.detail;}},
  Date,Number,String,Set,Math
};
vm.runInNewContext(source,ctx,{filename:'pallet-details.js'});
listeners['selene:pallet-details']({detail:{id:1}});
assert.equal(dialog.open,true);
assert.equal(fields.palletDetailsStatus.textContent,'Liberado para subir');
assert.equal(fields.palletDetailsRequester.textContent,'Operador A');
assert.equal(fields.palletDetailsAction.hidden,false);
assert.match(fields.palletDetailsAction.textContent,/Iniciar subida/);
assert.match(fields.palletDetailsHistory.innerHTML,/00:00:06/);
assert.doesNotMatch(fields.palletDetailsHistory.innerHTML,/Outro palete/);
fields.palletDetailsAction.events.click();
assert.equal(dialog.open,false);
assert.equal(actions.at(-1).type,'selene:pallet-action');
assert.equal(actions.at(-1).detail.id,1);
canOperate=false;
listeners['selene:pallet-details']({detail:{id:2}});
assert.equal(fields.palletDetailsAction.hidden,true);
assert.match(fields.palletDetailsHistory.innerHTML,/&lt;img/);
assert.doesNotMatch(fields.palletDetailsHistory.innerHTML,/<img/);
console.log('7 casos de histórico e permissões passaram.');
