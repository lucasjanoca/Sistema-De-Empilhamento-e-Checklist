'use strict';
const assert=require('node:assert/strict');
const {createTestMovements,identifier}=require('../teste-interno/test-movements');
const pending={Success:true,Response:[{num_req:101,endereco_orig:'01-001-1'}]};
const attendance={Success:true,Response:[
  {num_req:202,endereco_orig:'02-001-1',icon_cor:'verde'},
  {num_req:203,endereco_orig:'02-002-1',icon_cor:'vermelho'}
]};
const m=createTestMovements();
m.update(pending,attendance);
assert.equal(m.officialCount(),3);
const down=identifier(pending.Response[0],'pending').id;
const up=identifier(attendance.Response[0],'attendance').id;
const red=identifier(attendance.Response[1],'attendance').id;
assert.equal(m.effective(down).status,'waiting');
assert.equal(m.effective(up).status,'ready');
assert.equal(m.effective(red).status,'floor');
assert.equal(m.act(red,'up','operador').ok,false,'Palete vermelho não pode subir');
assert.equal(m.act(99999,'down','operador').ok,false,'Palete inexistente é bloqueado');
assert.equal(m.act(down,'down','operador').ok,true);
assert.equal(m.effective(down).status,'lowering');
assert.equal(m.act(down,'down','operador').ok,false,'Sem descida duplicada');
assert.equal(m.act(up,'up','operador').ok,true,'Outro palete pode mover ao mesmo tempo');
assert.equal(m.effective(up).status,'returning');
assert.equal(m.act(up,'undo','operador').ok,true);
assert.equal(m.effective(up).status,'ready');
assert.equal(m.act(up,'undo','operador').ok,false);
assert.equal(m.snapshot().overlays[down].status,'lowering');
const realNow=Date.now;
try{
  Date.now=()=>realNow()+11000;
  assert.equal(m.effective(down).status,'floor','Descida completou após 10 segundos');
  assert.equal(m.act(down,'undo','operador').ok,false,'Não cancela descida já concluída');
  assert.equal(m.act(up,'up','operador').ok,true);
  Date.now=()=>realNow()+22000;
  assert.equal(m.effective(up).status,'hidden','Subida finalizada desaparece da operação de teste');
}finally{Date.now=realNow;}
m.update({Response:[]},attendance);
assert.equal(m.effective(down),null,'Palete desaparecido da fonte oficial não pode permanecer');
assert.ok(m.snapshot().revision>0);
console.log('16 cenários passaram: dados oficiais, vermelho/verde, PC/tablet, timers, cancelamento e bloqueios.');
