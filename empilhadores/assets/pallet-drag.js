/* Arrastar e soltar paletes nos dois sentidos.
 * Um gesto somente solicita ao app.bundle.js a movimentação já autorizada,
 * preservando permissões, bloqueios, status, sincronização e auditoria.
 */
(() => {
  'use strict';

  const view = document.getElementById('view-operacao');
  const scroller = document.getElementById('palletUnifiedScroll');
  const topGrid = document.getElementById('topGrid');
  const bottomGrid = document.getElementById('bottomGrid');
  const topSection = view?.querySelector('.pallet-scroll-top');
  const bottomSection = view?.querySelector('.pallet-scroll-bottom');
  if (!view || !scroller || !topGrid || !bottomGrid || !topSection || !bottomSection) return;

  const DRAG_THRESHOLD = 9;
  const SCROLL_EDGE = 72;
  let gesture = null;
  let suppressClickUntil = 0;

  const targets = { down: bottomSection, up: topSection };

  function inOperationView() {
    return view.classList.contains('active') || document.body.classList.contains('operation-focus-mode');
  }

  // Acerta somente a intersecção da área de destino com a região realmente visível.
  function isValidDrop(x, y, direction) {
    const zone = targets[direction]?.getBoundingClientRect();
    const clip = scroller.getBoundingClientRect();
    if (!zone) return false;
    return x >= Math.max(zone.left, clip.left, 0) &&
      x <= Math.min(zone.right, clip.right, window.innerWidth) &&
      y >= Math.max(zone.top, clip.top, 0) &&
      y <= Math.min(zone.bottom, clip.bottom, window.innerHeight);
  }

  function positionGhost(g) {
    if (!g.ghost) return;
    // Posição do ponto exato agarrado no cartão, sem delay de transição CSS.
    g.ghost.style.transform =
      `translate3d(${g.x - g.offsetX}px, ${g.y - g.offsetY}px, 0)`;
    targets[g.direction].classList.toggle('pallet-drop-hover', isValidDrop(g.x, g.y, g.direction));
  }

  function autoScroll(g) {
    function tick() {
      if (gesture !== g || !g.dragging) return;
      const rect = scroller.getBoundingClientRect();
      let speed = 0;
      if (g.x >= rect.left && g.x <= rect.right &&
          g.y >= rect.top && g.y <= rect.bottom) {
        const topDistance = g.y - rect.top;
        const bottomDistance = rect.bottom - g.y;
        if (topDistance < SCROLL_EDGE) speed = -Math.ceil((SCROLL_EDGE - topDistance) / 4);
        else if (bottomDistance < SCROLL_EDGE) speed = Math.ceil((SCROLL_EDGE - bottomDistance) / 4);
      }
      if (speed) scroller.scrollTop += speed;
      positionGhost(g);
      g.raf = requestAnimationFrame(tick);
    }
    g.raf = requestAnimationFrame(tick);
  }

  function startDrag(g) {
    g.ghost = g.source.cloneNode(true);
    g.ghost.classList.add('pallet-drag-ghost');
    g.ghost.classList.remove('hazard-blink', 'pic-overdue');
    g.ghost.style.width = `${g.width}px`;
    g.ghost.style.height = `${g.height}px`;
    g.ghost.style.transition = 'none';
    g.ghost.style.animation = 'none';
    g.ghost.setAttribute('aria-hidden', 'true');
    g.ghost.removeAttribute('id');
    g.ghost.querySelectorAll('[id], [data-elapsed-id], [data-floor-time-id], [data-pic-return-id]').forEach(node => {
      node.removeAttribute('id');
      node.removeAttribute('data-elapsed-id');
      node.removeAttribute('data-floor-time-id');
      node.removeAttribute('data-pic-return-id');
    });
    document.body.appendChild(g.ghost);
    g.source.classList.add('pallet-drag-source');
    scroller.classList.add('pallet-dragging');
    targets[g.direction].classList.add('pallet-drop-target');
    g.dragging = true;
    positionGhost(g);
    autoScroll(g);
  }

  function cleanUp(g) {
    if (!g) return;
    if (g.raf) cancelAnimationFrame(g.raf);
    g.ghost?.remove();
    g.source.classList.remove('pallet-drag-source');
    scroller.classList.remove('pallet-dragging');
    for (const section of Object.values(targets)) {
      section.classList.remove('pallet-drop-target', 'pallet-drop-hover');
    }
    try {
      if (g.source.hasPointerCapture?.(g.pointerId)) g.source.releasePointerCapture(g.pointerId);
    } catch {}
    if (gesture === g) gesture = null;
  }

  function pointerDown(event, grid, selector, direction) {
    if (gesture || !inOperationView() || event.isPrimary === false ||
        (event.pointerType === 'mouse' && event.button !== 0)) return;

    const card = event.target.closest(selector);
    if (!card || !grid.contains(card) || card.dataset.external === 'true') return;
    const rect = card.getBoundingClientRect();

    gesture = {
      pointerId: event.pointerId,
      source: card, sourceGrid: grid,
      direction, startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY,
      // Gravar as coordenadas no início preserva onde o usuário pegou no palete.
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width, height: rect.height,
      dragging: false, ghost: null, raf: null
    };
    try { card.setPointerCapture(event.pointerId); } catch {}
  }

  topGrid.addEventListener('pointerdown', event => {
    pointerDown(event, topGrid, '.pallet-card.waiting', 'down');
  });

  bottomGrid.addEventListener('pointerdown', event => {
    // Paletes "no chão" não podem subir até que sejam liberados.
    pointerDown(event, bottomGrid, '.pallet-card.ready', 'up');
  });

  document.addEventListener('pointermove', event => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    g.x = event.clientX;
    g.y = event.clientY;
    if (!g.dragging && Math.hypot(g.x - g.startX, g.y - g.startY) >= DRAG_THRESHOLD) {
      startDrag(g);
    }
    if (g.dragging) {
      if (event.cancelable) event.preventDefault();
      positionGhost(g);
    }
  });

  document.addEventListener('pointerup', event => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const dragged = g.dragging;
    const droppedOnTarget = dragged && isValidDrop(event.clientX, event.clientY, g.direction);
    const requestId = Number(g.source.dataset.id);
    const stillInSource = g.sourceGrid.contains(g.source) &&
      g.source.classList.contains(g.direction === 'down' ? 'waiting' : 'ready');
    const direction = g.direction;

    cleanUp(g);
    if (!dragged) return;
    suppressClickUntil = Date.now() + 700;

    if (droppedOnTarget && stillInSource && Number.isSafeInteger(requestId)) {
      document.dispatchEvent(new CustomEvent(
        direction === 'down' ? 'selene:pallet-dropped-down' : 'selene:pallet-dropped-up',
        { detail: { id: requestId } }
      ));
    }
  });

  document.addEventListener('pointercancel', event => {
    if (gesture?.pointerId !== event.pointerId) return;
    if (gesture.dragging) suppressClickUntil = Date.now() + 700;
    cleanUp(gesture);
  });

  window.addEventListener('blur', () => {
    if (gesture?.dragging) suppressClickUntil = Date.now() + 700;
    cleanUp(gesture);
  });

  // Evita que o clique residual dispare outra movimentação após arrastar.
  document.addEventListener('click', event => {
    if (event.isTrusted && Date.now() < suppressClickUntil &&
        (scroller.contains(event.target) || event.target?.classList?.contains('pallet-card'))) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();
