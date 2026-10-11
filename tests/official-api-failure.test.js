'use strict';

// Regressões totalmente simuladas: NUNCA consulta/grava dados corporativos.
const assert = require('node:assert/strict');
const {records, fields, createOfficialOperations} = require('../teste-interno/official-operations');
const {readUpstream} = require('../teste-interno/server');

const config = {officialWritesEnabled: true, adapterPath: '', codGrupo: '1', codEmp: 'emp1'};
const pending = {num_req: 101, endereco_orig: '01-002-1'};
const id = fields(pending, 'pending').id;
const routes = {
  pending: {path: 'api/Requisicao/ObtemRequisicoesPendentes'},
  attendance: {path: 'api/Requisicao/ObtemRequisicoesAtendimento'}
};
const auth = {authenticate: async () => ({matricula: '123456', canOperate: true})};

for (const payload of [
  {Success: false, Response: []},
  {success: false, Count: 0},
  {Error: true, Response: []},
  {error: true, data: []}
]) {
  assert.throws(() => records(payload), /falha/i, 'Resposta de falha não pode ser interpretada como lista vazia');
}
assert.deepEqual(records({Success: true, Count: 0, Response: []}), []);
assert.deepEqual(records({Count: 0}), [], 'Lista vazia legítima permanece válida');

async function main() {
  const originalFetch = global.fetch;
  try {
    for (const payload of [
      {Success: false, Response: []},
      {success: false, Response: []},
      {Error: true, Response: []},
      {error: true, Response: []}
    ]) {
      global.fetch = async () => ({
        ok: true, status: 200, headers: new Map(),
        text: async () => JSON.stringify(payload)
      });
      await assert.rejects(
        () => readUpstream(configForRead(), routes.pending),
        /falha na consulta/i,
        'GET HTTP 200 com sinalização de erro deve ser recusado'
      );
    }
  } finally {
    global.fetch = originalFetch;
  }

  let calls = 0;
  const refusedBeforeWrite = createOfficialOperations({
    config, routes, operatorValidator: auth,
    adapter: {move: async () => { calls++; throw Error('Não deveria executar'); }},
    readUpstream: async (_cfg, route) =>
      route.path.includes('Pendentes')
        ? {Success: false, Response: []}
        : {Success: true, Response: []}
  });
  const rejected = await refusedBeforeWrite.move({id, direction: 'down', actor: '123456'});
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 502);
  assert.equal(calls, 0, 'Uma falha na leitura inicial nunca pode chamar a escrita oficial');

  let written = false;
  const refusedAfterWrite = createOfficialOperations({
    config, routes, operatorValidator: auth,
    adapter: {move: async req => {
      calls++;
      written = true;
      return {confirmed: true, officialId: req.officialId};
    }},
    readUpstream: async (_cfg, route) =>
      route.path.includes('Pendentes')
        ? (written ? {Success: false, Response: []} : {Success: true, Response: [pending]})
        : {Success: true, Response: []}
  });
  const uncertain = await refusedAfterWrite.move({id, direction: 'down', actor: '123456'});
  assert.equal(uncertain.ok, false, 'A confirmação posterior falhou: não declarar sucesso');
  assert.equal(uncertain.status, 502);
  assert.match(uncertain.error, /não foi possível confirmar/i);
  assert.equal(calls, 1);

  let finished = false;
  const legitimatelyMoved = createOfficialOperations({
    config, routes, operatorValidator: auth,
    adapter: {move: async req => {
      finished = true;
      return {confirmed: true, officialId: req.officialId};
    }},
    readUpstream: async (_cfg, route) =>
      route.path.includes('Pendentes')
        ? {Success: true, Response: finished ? [] : [pending]}
        : {Success: true, Response: []}
  });
  const valid = await legitimatelyMoved.move({id, direction: 'down', actor: '123456'});
  assert.equal(valid.ok, true, 'Confirmação válida ainda deve funcionar');
  assert.equal(valid.confirmed, true);
  console.log('API oficial: falha explícita nunca vira palete vazio/sucesso; escrita recusada ou confirmada conforme dados simulados.');
}

function configForRead() {
  return {apiBase: 'http://127.0.0.1:34567/api', codGrupo: '1', codEmp: 'emp1'};
}

main().catch(error => { console.error(error); process.exitCode = 1; });
