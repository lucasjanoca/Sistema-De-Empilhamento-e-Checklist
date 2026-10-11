'use strict';

// Simula dois clientes e a API central; não acessa contas, paletes ou rede corporativa.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');

const bundle = fs.readFileSync('empilhadores/assets/app.bundle.js', 'utf8');
const start = bundle.indexOf('const DataSync = (() => {');
const end = bundle.indexOf('const DataTools = (() => {', start);
assert.ok(start >= 0 && end > start, 'DataSync deve existir no bundle');
const source = bundle.slice(start, end);

const clone = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};

function makeState(revision = 1, updatedAt = Date.now()) {
  return {
    revision,
    updatedAt,
    cloudInitialized: true,
    snapshot: {
      version: '2.0',
      updatedAt,
      data: {
        meta: { updatedAt, cloudInitialized: true },
        settings: { centralSyncEnabled: true },
        registeredDevices: [{ id: 'tablet-01', name: 'Tablet 01', active: true }],
        tabletAssignments: []
      }
    }
  };
}

function makeBackend(initial = makeState()) {
  return {
    remote: clone(initial),
    reads: 0,
    writes: [],
    async read() {
      this.reads++;
      return clone(this.remote);
    },
    async save(snapshot, expectedRevision) {
      this.writes.push({ snapshot: clone(snapshot), expectedRevision });
      assert.equal(expectedRevision, this.remote.revision,
        'A gravação central deve usar a revisão que o cliente recebeu');
      this.remote = {
        revision: this.remote.revision + 1,
        updatedAt: Date.now(),
        cloudInitialized: true,
        snapshot: clone(snapshot)
      };
      return { revision: this.remote.revision, updatedAt: this.remote.updatedAt };
    }
  };
}

function createClient(backend) {
  let state = makeState(0).snapshot.data;
  let imported = 0;
  let timerId = 0;
  let poll = null;
  const timers = new Map();
  const listeners = new Map();
  const toasts = [];
  const appState = {
    getData() { return state; },
    getUser() { return { matricula: '123456', role: 'empilhador' }; },
    hasStoredState() { return false; },
    exportOperationalSnapshot() {
      return { version: '2.0', updatedAt: state.meta.updatedAt, data: clone(state) };
    },
    importSnapshot(snapshot) {
      imported++;
      state = clone(snapshot.data);
      return { ok: true };
    },
    addAudit() {}
  };
  const ui = { $: () => null, toast: message => toasts.push(message) };
  const context = {
    AppState: appState, UI: ui,
    SecurityApi: { isAccountCloud: () => true, isServerMode: () => false },
    InfoTechSupabaseAccounts: {
      getOperationalState: () => backend.read(),
      saveOperationalState: (snapshot, revision) => backend.save(snapshot, revision)
    },
    document: {
      addEventListener(name, listener) { listeners.set(name, listener); }
    },
    localStorage: { setItem() {} },
    location: { protocol: 'https:' },
    Operation: { renderAll() {}, resumeMovementTimers() {} },
    Dashboard: { render() {} }, Notifications: { render() {} },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(callback) { poll = callback; return ++timerId; },
    clearInterval() { poll = null; },
    console, JSON, Date, Number, Promise
  };
  const api = vm.runInNewContext(source + '\nDataSync;', context, {
    filename: 'data-sync-extracted.js', timeout: 2000
  });
  const fireTimers = () => {
    const callbacks = [...timers.values()];
    timers.clear();
    return callbacks.map(callback => callback());
  };
  return {
    api, toasts,
    get state() { return state; },
    get imported() { return imported; },
    poll() { assert.equal(typeof poll, 'function'); return poll(); },
    change(mutator) {
      mutator(state);
      state.meta.updatedAt += 1000;
      const listener = listeners.get('app:state-saved');
      assert.equal(typeof listener, 'function');
      listener({ detail: { source: 'tablet' } });
    },
    fireTimers
  };
}

test('PC e tablet recebem mudanças por revisão, mesmo com relógio remoto atrasado', async () => {
  const backend = makeBackend();
  const pc = createClient(backend);
  const tablet = createClient(backend);
  await pc.api.reconnect();
  await tablet.api.reconnect();
  assert.equal(pc.state.registeredDevices.length, 1);
  const oldTimestamp = pc.state.meta.updatedAt;
  backend.remote.revision = 2;
  backend.remote.updatedAt = oldTimestamp - 10000;
  backend.remote.snapshot.updatedAt = oldTimestamp - 10000;
  backend.remote.snapshot.data.registeredDevices.push({
    id: 'tablet-02', name: 'Tablet 02', active: true
  });
  await pc.poll();
  await tablet.poll();
  assert.equal(pc.state.registeredDevices.length, 2);
  assert.equal(tablet.state.registeredDevices.length, 2);
});

test('consulta iniciada antes de uma edição não pode sobrescrever essa edição', async () => {
  const backend = makeBackend();
  const pc = createClient(backend);
  await pc.api.reconnect();
  const oldRead = backend.read;
  const pending = deferred();
  backend.read = () => pending.promise;
  const outstanding = pc.poll();
  pc.change(state => state.registeredDevices.push({
    id: 'tablet-03', name: 'Tablet 03', active: true
  }));
  pending.resolve(clone(backend.remote));
  await outstanding;
  assert.equal(pc.state.registeredDevices.length, 2, 'A edição local deve sobreviver à leitura concorrente');
  backend.read = oldRead;
  await Promise.all(pc.fireTimers());
  assert.equal(backend.remote.snapshot.data.registeredDevices.length, 2);
});

test('alterações durante a primeira gravação são enviadas em uma segunda revisão', async () => {
  const backend = makeBackend();
  const tablet = createClient(backend);
  await tablet.api.reconnect();
  const first = deferred();
  const realSave = backend.save.bind(backend);
  let calls = 0;
  const snapshots = [];
  backend.save = (snapshot, revision) => {
    snapshots.push({ snapshot: clone(snapshot), revision });
    calls++;
    if (calls === 1) return first.promise;
    return realSave(snapshot, revision);
  };
  tablet.change(state => state.registeredDevices.push({
    id: 'tablet-02', name: 'Tablet 02', active: true
  }));
  const firstRun = tablet.fireTimers();
  assert.equal(calls, 1);
  tablet.change(state => state.registeredDevices.push({
    id: 'tablet-03', name: 'Tablet 03', active: true
  }));
  const secondRun = tablet.fireTimers();
  assert.equal(calls, 1, 'Gravações do mesmo navegador não devem ocorrer em paralelo');

  backend.remote.revision = 2;
  backend.remote.snapshot = clone(snapshots[0].snapshot);
  first.resolve({ revision: 2, updatedAt: Date.now() });
  await Promise.all([...firstRun, ...secondRun]);
  assert.equal(tablet.state.registeredDevices.length, 3,
    'O estado mais recente não deve ser substituído pelo timestamp da primeira gravação');
  await Promise.all(tablet.fireTimers());
  assert.equal(calls, 2);
  assert.equal(snapshots[0].revision, 1);
  assert.equal(snapshots[1].revision, 2);
  assert.equal(backend.remote.snapshot.data.registeredDevices.length, 3);
});

test('botão Sincronizar agora consulta a central sem gravar estado antigo', async () => {
  const backend = makeBackend();
  const pc = createClient(backend);
  await pc.api.reconnect();
  const originalWrites = backend.writes.length;
  const originalReads = backend.reads;
  await pc.api.forceSync();
  assert.equal(backend.writes.length, originalWrites);
  assert.ok(backend.reads > originalReads);
  assert.ok(pc.toasts.some(text => /concluída/i.test(text)));
});

test('botão Sincronizar agora envia mudanças locais pendentes', async () => {
  const backend = makeBackend();
  const pc = createClient(backend);
  await pc.api.reconnect();
  pc.change(state => state.registeredDevices.push({
    id: 'tablet-04', name: 'Tablet 04', active: true
  }));
  await pc.api.forceSync();
  assert.equal(backend.writes.length, 1);
  assert.equal(backend.remote.snapshot.data.registeredDevices.length, 2);
  // O timer que havia sido agendado antes do clique não pode duplicar a gravação.
  await Promise.all(pc.fireTimers());
  assert.equal(backend.writes.length, 1);
});
