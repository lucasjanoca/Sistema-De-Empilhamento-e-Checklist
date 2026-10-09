/* Arrastar paletes da fila para a área de atendimento.
 * A movimentação é validada e registrada pelo fluxo existente do app.bundle.js.
 * Funciona com mouse, caneta e toque (Pointer Events).
 */
(() => {
  'use strict';

  const view = document.getElementById('view-operacao');
  const scroller = document.getElementById('palletUnifiedScroll');
  const topGrid = document.getElementById('topGrid');
  const bottomSection = view?.querySelector('.pallet-scroll-bottom');
  if (!view || !scroller || !topGrid || !bottomSection) return;

  const DRAG_THRESHOLD = 9;
  const SCROLL_EDGE = 72;
  let gesture = null;
  let suppressClickUntil = 0;

  function inOperationView() {
    return view.classList.contains('active') || document.body.classList.contains('operation-focus-mode');
  }

  function isValidDrop(x, y) {
    const zone = bottomSection.getBoundingClientRect();
    const clip = scroller.getBoundingClientRect();
    return x >= Math.max(zone.left, clip.left) &&
      x <= Math.min(zone.right, clip.right) &&
      y >= Math.max(zone.top, clip.top) &&
      y <= Math.min(zone.bottom, clip.bottom);
  }

  function positionGhost(g) {
    if (!g.ghost) return;
    g.ghost.style.transform = `translate3d(${g.x - g.offsetX}px, ${g.y - g.offsetY}px, 0)`;
    bottomSection.classList.toggle('pallet-drop-hover', isValidDrop(g.x, g.y));
  }

  function startDrag(g) {
    const rect = g.source.getBoundingClientRect();
    g.offsetX = g.startX - rect.left;
    g.offsetY = g.startY - rect.top;
    g.ghost = g.source.cloneNode(true);
    g.ghost.classList.add('pallet-drag-ghost');
    g.ghost.classList.remove('hazard-blink');
    g.ghost.style.width = `${rect.width}px`;
    g.ghost.style.height = `${rect.height}px`;
    g.ghost.setAttribute('aria-hidden', 'true');
    g.ghost.removeAttribute('id');
    g.ghost.querySelectorAll('[id], [data-elapsed-id]').forEach(node => {
      node.removeAttribute('id');
      node.removeAttribute('data-elapsed-id');
    });
    document.body.appendChild(g.ghost);
    g.source.classList.add('pallet-drag-source');
    scroller.classList.add('pallet-dragging');
    bottomSection.classList.add('pallet-drop-target');
    g.dragging = true;
    positionGhost(g);
    autoScroll(g);
  }

  function autoScroll(g) {
    function tick() {
      if (gesture !== g || !g.dragging) return;
      const rect = scroller.getBoundingClientRect();
      let speed = 0;
      if (g.x >= rect.left && g.x <= rect.right && g.y >= rect.top && g.y <= rect.bottom) {
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

  function cleanUp(g) {
    if (!g) return;
    if (g.raf) cancelAnimationFrame(g.raf);
    g.ghost?.remove();
    g.source.classList.remove('pallet-drag-source');
    scroller.classList.remove('pallet-dragging');
    bottomSection.classList.remove('pallet-drop-target', 'pallet-drop-hover');
    try {
      if (g.source.hasPointerCapture?.(g.pointerId)) g.source.releasePointerCapture(g.pointerId);
    } catch {}
    if (gesture === g) gesture = null;
  }

  topGrid.addEventListener('pointerdown', event => {
    if (gesture || !inOperationView() || event.isPrimary === false ||
        (event.pointerType === 'mouse' && event.button !== 0)) return;

    const card = event.target.closest('.pallet-card.waiting');
    if (!card || !topGrid.contains(card) || card.dataset.external === 'true') return;

    gesture = {
      pointerId: event.pointerId, source: card,
      startX: event.clientX, startY: event.clientY,
      x: event.clientX, y: event.clientY,
      dragging: false, ghost: null, raf: null
    };
    try { card.setPointerCapture(event.pointerId); } catch {}
  });

  document.addEventListener('pointermove', event => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    g.x = event.clientX;
    g.y = event.clientY;
    if (!g.dragging && Math.hypot(g.x - g.startX, g.y - g.startY) >= DRAG_THRESHOLD) startDrag(g);
    if (g.dragging) {
      if (event.cancelable) event.preventDefault();
      positionGhost(g);
    }
  });

  document.addEventListener('pointerup', event => {
    const g = gesture;
    if (!g || event.pointerId !== g.pointerId) return;
    const dragged = g.dragging;
    const droppedOnBottom = dragged && isValidDrop(event.clientX, event.clientY);
    const requestId = Number(g.source.dataset.id);
    const sourceStillVisible = topGrid.contains(g.source) && g.source.classList.contains('waiting');

    cleanUp(g);
    if (!dragged) return;
    suppressClickUntil = Date.now() + 700;

    if (droppedOnBottom && sourceStillVisible && Number.isSafeInteger(requestId)) {
      // Usa as mesmas permissões, locks, requisição, cronômetro e histórico da operação normal.
      document.dispatchEvent(new CustomEvent('selene:pallet-dropped-down', { detail: { id: requestId } }));
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

  // Depois de arrastar, o navegador pode emitir um clique residual.
  // Bloqueia somente esse clique; toque/click normal segue funcionando.
  document.addEventListener('click', event => {
    if (event.isTrusted && Date.now() < suppressClickUntil && scroller.contains(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
})();
