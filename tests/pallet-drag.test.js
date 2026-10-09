// Testes comportamentais do gesto de arrastar, sem conexões com paletes reais.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('empilhadores/assets/pallet-drag.js', 'utf8');

function createClassList(initial = []) {
  const items = new Set(initial);
  return {
    add(...values) { values.forEach(value => items.add(value)); },
    remove(...values) { values.forEach(value => items.delete(value)); },
    contains(value) { return items.has(value); },
    toggle(value, force) {
      if (force === true || (force === undefined && !items.has(value))) items.add(value);
      else items.delete(value);
    },
    values() { return [...items]; }
  };
}

function el(classes = [], rect = {left:0,top:0,right:400,bottom:400,width:400,height:400}) {
  const node = {
    classList: createClassList(classes), style: {}, dataset: {}, children: [],
    getBoundingClientRect: () => rect,
    setAttribute() {}, removeAttribute() {},
    querySelectorAll() { return []; },
    appendChild(child) { this.children.push(child); child.parent = this; },
    remove() { this.removed = true; },
    contains(target) { return target === this || target.parent === this; },
    closest(selector) {
      const klass = selector.split('.').pop();
      return this.classList.contains(klass) ? this : null;
    },
    cloneNode() {
      return el(this.classList.values(), rect);
    },
    setPointerCapture(id) { this.captureId = id; },
    hasPointerCapture(id) { return this.captureId === id; },
    releasePointerCapture() { this.captureId = null; }
  };
  return node;
}

function createHarness() {
  const topGrid = el();
  const bottomGrid = el();
  const scroller = el([], {left:0,top:0,right:400,bottom:400,width:400,height:400});
  const topSection = el([], {left:0,top:0,right:400,bottom:200,width:400,height:200});
  const bottomSection = el([], {left:0,top:200,right:400,bottom:400,width:400,height:200});
  const view = el(['active']);
  view.querySelector = (selector) => selector.includes('scroll-top') ? topSection : bottomSection;
  const body = el();
  const nodes = { 'view-operacao': view, palletUnifiedScroll:scroller, topGrid, bottomGrid };
  const handlers = new Map();
  const document = {
    body,
    getElementById: id => nodes[id],
    addEventListener(type, callback) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(callback);
    },
    dispatchEvent(event) {
      (handlers.get(event.type) || []).forEach(callback => callback(event));
    }
  };
  const window = {
    innerWidth:400, innerHeight:400,
    addEventListener() {}
  };
  class CustomEvent {
    constructor(type, options) { this.type = type; this.detail = options.detail; }
  }
  const logs = [];
  document.addEventListener('selene:pallet-dropped-down', event => logs.push(['down', event.detail.id]));
  document.addEventListener('selene:pallet-dropped-up', event => logs.push(['up', event.detail.id]));
  const scope = {
    document, window, CustomEvent,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    Date, Math, Number
  };
  vm.runInNewContext(source, scope, {filename:'pallet-drag.js'});

  function fire(target, type, x, y) {
    const event = { type, target,
      pointerId:1, pointerType:'mouse', isPrimary:true, button:0,
      clientX:x, clientY:y, cancelable:true, preventDefault() {}
    };
    if (target === topGrid || target === bottomGrid) {
      target.listeners?.[type]?.forEach(handler => handler(event));
    } else {
      document.dispatchEvent(event);
    }
  }
  function bindGrid(grid) {
    grid.listeners = {};
    // O script real registra handlers no DOM; reexecute com interceptadores instalados abaixo.
  }
  return { document, body, topGrid, bottomGrid, logs, handlers, fire,
    downCard: el(['pallet-card','waiting'], {left:20,top:20,right:120,bottom:110,width:100,height:90}),
    upCard: el(['pallet-card','ready'], {left:20,top:225,right:120,bottom:315,width:100,height:90}),
    scroller };
}

// Instala listeners nos elementos do ambiente antes de executar o script.
function runCase(direction, targetY, expected) {
  const grids = {
    topGrid: el(), bottomGrid: el()
  };
  const sectionTop = el([], {left:0,top:0,right:400,bottom:200,width:400,height:200});
  const sectionBottom = el([], {left:0,top:200,right:400,bottom:400,width:400,height:200});
  const scroll = el([], {left:0,top:0,right:400,bottom:400,width:400,height:400});
  const view = el(['active']);
  const body = el();
  view.querySelector = selector => selector.includes('scroll-top') ? sectionTop : sectionBottom;
  const nodes = {'view-operacao':view,palletUnifiedScroll:scroll,...grids};
  const listeners = new Map();
  const document = {
    body,
    getElementById:id=>nodes[id],
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(callback);
    },
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type)||[]) callback(event);
    }
  };
  for (const grid of Object.values(grids)) {
    grid.listeners = new Map();
    grid.addEventListener = (type, callback) => grid.listeners.set(type, callback);
  }
  const events = [];
  document.addEventListener('selene:pallet-dropped-down', event => events.push(['down', event.detail.id]));
  document.addEventListener('selene:pallet-dropped-up', event => events.push(['up', event.detail.id]));
  const window = {innerWidth:400,innerHeight:400,addEventListener() {}};
  class CustomEvent { constructor(type, opts) {this.type=type;this.detail=opts.detail;} }
  vm.runInNewContext(source, {document,window,CustomEvent,Date,Math,Number,
    requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{}}, {filename:'pallet-drag.js'});

  const isDown = direction === 'down';
  const grid = isDown ? grids.topGrid : grids.bottomGrid;
  const card = el(['pallet-card',isDown?'waiting':'ready'],
    isDown ? {left:20,top:20,right:120,bottom:110,width:100,height:90} :
             {left:20,top:225,right:120,bottom:315,width:100,height:90});
  card.dataset = {id:isDown?'7':'8',external:'false'};
  card.parent = grid;
  const yStart = isDown?30:245;
  const emit = (type, x, y, target=card) => ({
    type, target, pointerId:1, pointerType:'mouse', isPrimary:true, button:0,
    clientX:x,clientY:y,cancelable:true,preventDefault() {}
  });
  grid.listeners.get('pointerdown')(emit('pointerdown',30,yStart));
  document.dispatchEvent(emit('pointermove',90,180));
  const ghost = body.children[0];
  assert.ok(ghost, 'Palete flutuante deve surgir ao iniciar arraste');
  // 10px de distância horizontal e 10/20px vertical do ponto agarrado.
  assert.equal(ghost.style.transform,
    isDown ? 'translate3d(80px, 170px, 0)' : 'translate3d(80px, 160px, 0)',
    'O cartão deve seguir o mouse no ponto em que foi agarrado');
  document.dispatchEvent(emit('pointerup',90,targetY));
  assert.equal(ghost.removed, true, 'O fantasma precisa desaparecer após soltar');
  assert.deepEqual(events, expected, 'A direção só deve ser ativada na área oposta');
}

runCase('down',290,[['down',7]]);
runCase('up',100,[['up',8]]);
runCase('down',100,[]);
runCase('up',300,[]);
console.log('4 testes comportamentais passaram: ida, volta, cursor e soltura inválida.');
