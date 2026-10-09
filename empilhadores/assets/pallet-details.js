/* Histórico de paletes do sistema InfoTech.
 * Somente leitura de dados já autorizados e carregados pela aplicação.
 * Os botões usam a operação existente; não fazem chamadas diretas à API da Selene.
 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const dialog = $('palletDetailsDialog');
  if(!dialog) return;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  })[char]);
  function fmt(time){
    const date = new Date(Number(time));
    return Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR') : '—';
  }
  function span(ms){
    const total = Math.max(0,Math.floor(ms / 1000));
    return [Math.floor(total / 3600), Math.floor(total % 3600 / 60), total % 60]
      .map(n => String(n).padStart(2,'0')).join(':');
  }
  function render(id,open=true){
    const req = SeleneIntegration.currentRequests().find(item => item.id === id);
    if(!req){
      if(dialog.open) dialog.close();
      return;
    }
    const numbers = [...new Set([
      req.originRequestNumber,req.lastMovementRequestNumber,req.movementRequestNumber
    ].filter(Boolean).map(String))];
    const knownNumbers = new Set(numbers);
    $('palletDetailsAddress').textContent = req.address || '—';
    $('palletDetailsRequest').textContent = numbers.join(' / ') || 'Não informada';
    $('palletDetailsStatus').textContent = ({
      waiting:'Aguardando descida',lowering:'Descendo',floor:'No chão · não liberado',
      ready:'Liberado para subir',returning:'Subindo'
    })[req.status] || req.status;
    if(SeleneIntegration.canOfficialMove())
      $('palletDetailsStatus').textContent += ' · Selene oficial';
    $('palletDetailsRequester').textContent = req.requestedByName || req.operator || 'Não informado';
    $('palletDetailsLastOperator').textContent = req.lastHandledByName || 'Sem movimentação registrada';
    $('palletDetailsEquipment').textContent = req.lastHandledTablet || 'Não informado';
    $('palletDetailsCreated').textContent = req.createdAt ? fmt(req.createdAt) : 'Não informado';

    // Só mostrar eventos oficiais: não confundir histórico local com a Selene.
    const history = [];
    $('palletDetailsHistory').innerHTML = history.length ? history.map((item,index) => {
      const last = index ? history[index-1] : null;
      const elapsed = last ? span(Number(item.time || 0)-Number(last.time || 0)) : '—';
      return '<tr><td>' + esc(item.operator || item.operatorMatricula || 'Sistema') +
        '</td><td>' + esc(fmt(item.time)) +
        '</td><td>' + esc(elapsed) +
        '</td><td>' + esc(item.action || '—') + '</td></tr>';
    }).join('') : '<tr><td colspan="4">O histórico oficial desta requisição ainda não está conectado.</td></tr>';

    const permitted = Permissions.can('operate',AppState.getUser()) && (!req.external || SeleneIntegration.canOfficialMove());
    const labels = {
      waiting:'Iniciar descida ↓',ready:'Iniciar subida ↑',
      lowering:'Cancelar descida',returning:'Cancelar subida'
    };
    if(req.external){delete labels.lowering;delete labels.returning;}
    if(!req.external && ['ti','encarregado'].includes(AppState.getUser()?.role))
      labels.floor = 'Autorizar subida';
    const button = $('palletDetailsAction');
    const label = permitted ? labels[req.status] : '';
    button.hidden = !label;
    button.textContent = label ? (req.external?'OFICIAL: ':'')+label : '';
    button.dataset.id = String(req.id);
    dialog.dataset.id = String(req.id);
    if(open && !dialog.open) dialog.showModal();
  }

  document.addEventListener('selene:pallet-details', event => {
    const id = Number(event.detail?.id);
    if(Number.isSafeInteger(id)) render(id);
  });
  document.addEventListener('selene:pallet-state-updated', () => {
    if(dialog.open) render(Number(dialog.dataset.id),false);
  });
  $('palletDetailsClose').addEventListener('click', () => dialog.close());
  $('palletDetailsAction').addEventListener('click', () => {
    const id = Number(dialog.dataset.id);
    const current = SeleneIntegration.currentRequests().find(req => req.id === id);
    dialog.close();
    if(!current || (current.external && !SeleneIntegration.canOfficialMove()) || !Permissions.can('operate',AppState.getUser())) return;
    document.dispatchEvent(new CustomEvent('selene:pallet-action',{detail:{id}}));
  });
})();
