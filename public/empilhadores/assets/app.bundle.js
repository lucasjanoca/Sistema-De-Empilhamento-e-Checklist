'use strict';
const escapeHtml=SeleneApi.esc;
const AppState=(()=>{
  const roleMeta={ti:{label:'TI',short:'TI'},encarregado:{label:'Encarregado',short:'Enc'},empilhador:{label:'Empilhador',short:'Emp'}};
  let data={requests:[],history:[],productionRequests:[],notifications:[],tabletAssignments:[],registeredDevices:[],settings:{},selectedCorridors:[],metrics:{}},user=null,tablet=null,corridors=[],users=[];
  function apply(payload){
    const selected=data.selectedCorridors;data=payload.data;corridors=[...data.selectedCorridors];
    let preference=null;try{preference=JSON.parse(sessionStorage.getItem('selene-corridors'));}catch{}
    data.selectedCorridors=Array.isArray(preference)?preference.filter(c=>corridors.includes(c)):selected.length?selected.filter(c=>corridors.includes(c)):corridors.slice();
    user=payload.user;tablet=payload.tablet;SeleneApi.remember(payload);Permissions.apply(user);
    document.dispatchEvent(new Event('app:data-changed'));
  }
  function clear(){user=null;tablet=null;users=[];data={requests:[],history:[],productionRequests:[],notifications:[],tabletAssignments:[],registeredDevices:[],settings:{},selectedCorridors:[],metrics:{}};}
  return {apply,clear,getData:()=>data,getUser:()=>user,getTablet:()=>tablet,setUser:u=>{user=u;},clearUser:clear,clearTablet:()=>{tablet=null;},getRoleLabel:r=>roleMeta[r]?.label||'Sem perfil',roleMeta,get corridors(){return corridors;},get users(){return users;},setUsers:list=>{users=list;},save:()=>{sessionStorage.setItem('selene-corridors',JSON.stringify(data.selectedCorridors));},markAllNotificationsRead:()=>DataSync.command('/notifications/read'),markNotificationRead:()=>DataSync.command('/notifications/read'),clearNotifications:()=>DataSync.command('/notifications/dismiss')};
})();
const SecurityApi=(()=>{
  const userPath=m=>'/users/'+encodeURIComponent(m);
  async function loadUsers(){const r=await SeleneApi.request('/users');AppState.setUsers(r.users);return r.users;}
  return {init:()=>SeleneApi.session(),isServerMode:()=>true,getSessionUser:()=>SeleneApi.user(),loadUsers,
    login:(matricula,senha)=>SeleneApi.mutate('/auth/login',{matricula,senha}),logout:()=>SeleneApi.mutate('/auth/logout'),
    createUser:p=>SeleneApi.mutate('/users',p),changePassword:(m,senha)=>SeleneApi.mutate(userPath(m),{action:'password',senha},'PATCH'),
    changeRole:(m,role)=>SeleneApi.mutate(userPath(m),{action:'role',role},'PATCH'),setActive:(m,active)=>SeleneApi.mutate(userPath(m),{action:'active',active},'PATCH'),deleteUser:m=>SeleneApi.mutate(userPath(m),{},'DELETE'),
    getSecurityStatus:()=>SeleneApi.request('/security/status'),getSecureAudit:async()=> (await SeleneApi.request('/audit-secure')).events};
})();
const Permissions=(()=>{
  const map={dashboard:['dashboard:view'],operate:['pallet:lower','pallet:raise'],requestPallet:['pallet:request'],manageRequests:['production:view'],manageUsers:['users:view'],history:['history:view_own','history:view_all'],indicators:['dashboard:view'],reports:['reports:export'],audit:['audit:view'],settings:['devices:manage','system:configure'],integration:['integration:configure'],devices:['devices:manage'],technical:['security:view']};
  function can(name,user=AppState.getUser()){return (map[name]||[name]).some(p=>user?.permissions?.includes(p));}
  function apply(user=AppState.getUser()){
    document.querySelectorAll('[data-permission]').forEach(el=>{const allowed=el.dataset.permission.split(',').some(p=>can(p.trim(),user));el.classList.toggle('permission-hidden',!allowed);el.setAttribute('aria-hidden',String(!allowed));});
    document.querySelectorAll('[data-roles]').forEach(el=>el.classList.toggle('permission-hidden',!el.dataset.roles.split(',').includes(user?.role)));
  }
  return {can,apply,describe:()=> 'Permissões verificadas no servidor a cada operação.'};
})();
const Auth=(()=>{
  async function finish(user){AppState.setUser(user);await DataSync.refresh();UI.showSystem(user);Operation.renderAll();DataSync.start();TabletManager.ensureSelected();}
  function init(){
    UI.$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('[type=submit]');b.disabled=true;try{const r=await SecurityApi.login(UI.$('loginMatricula').value.trim(),UI.$('loginSenha').value);UI.$('loginSenha').value='';await finish(r.user);}catch(error){UI.setLoginError(error.message);}finally{b.disabled=false;}});
    UI.$('togglePassword').onclick=()=>{const el=UI.$('loginSenha');el.type=el.type==='password'?'text':'password';};
    UI.$('logoutButton').onclick=async()=>{try{await SecurityApi.logout();SeleneApi.clear();AppState.clear();location.reload();}catch(error){UI.toast(error.message);}};
  }
  return {init,finishLogin:finish};
})();
const DataSync=(()=>{
  let pending=null,events=null,poll=null;
  async function refresh(){
    if(pending)return pending;
    pending=SeleneApi.request('/state').then(payload=>{AppState.apply(payload);Operation.renderAll();return payload;}).finally(()=>{pending=null;});return pending;
  }
  async function command(path,body={},method='POST'){
    try{const r=await SeleneApi.mutate(path,body,method);await refresh();return r;}catch(error){UI.toast(error.message);if(error.status===409)await refresh().catch(()=>{});return null;}
  }
  function start(){
    events?.close();clearInterval(poll);events=new EventSource('/api/site-selene/events');events.addEventListener('refresh',()=>refresh().catch(()=>{}));events.addEventListener('expired',()=>document.dispatchEvent(new Event('security:expired')));
    poll=setInterval(()=>refresh().catch(()=>{}),15000);
  }
  function status(e){const online=e.detail.online;const el=UI.$('centralSyncBadge');if(el){el.className='central-sync-badge '+(online?'online':'offline');el.textContent=online?'Conectado ao servidor':'Sem conexão · ações bloqueadas';}UI.$('connectionBanner')?.classList.toggle('hidden',online);}
  function init(){document.addEventListener('server:connection',status);UI.$('forceCentralSync')?.addEventListener('click',()=>refresh().then(()=>UI.toast('Dados atualizados do servidor.')).catch(e=>UI.toast(e.message)));}
  return {init,refresh,command,start,forceSync:refresh,reconnect:start,isConnected:()=>SeleneApi.online()};
})();

const UI = (() => {
  const $ = id => document.getElementById(id);
  function toast(message){
    const openDialog=document.querySelector('dialog[open]');
    if(openDialog){
      let inline=openDialog.querySelector('.dialog-toast');
      if(!inline){
        inline=document.createElement('div');
        inline.className='dialog-toast';
        inline.setAttribute('role','alert');
        openDialog.querySelector('form')?.prepend(inline);
      }
      inline.textContent=message;
      inline.classList.add('show');
      clearTimeout(openDialog.__dialogToastTimer);
      openDialog.__dialogToastTimer=setTimeout(()=>inline.classList.remove('show'),3200);
      return;
    }
    const el = $('toast');
    if(!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }
  function setLoginError(message=''){
    const el = $('loginError');
    if(!el) return;
    el.textContent = message;
    el.classList.toggle('show', Boolean(message));
  }
  function openMenu(){
    $('sidebar')?.classList.add('open');
    $('overlay')?.classList.add('show');
  }
  function closeMenu(){
    $('sidebar')?.classList.remove('open');
    $('overlay')?.classList.remove('show');
  }
  function firstAllowedView(){
    const button=[...document.querySelectorAll('.nav-button:not(.permission-hidden)')][0];
    return button?.dataset.view || 'operacao';
  }
  function openView(name){
    const requestedButton=document.querySelector(`.nav-button[data-view="${escapeHtml(name)}"]`);
    if(requestedButton?.classList.contains('permission-hidden')){
      toast('Seu perfil não possui acesso a essa área.');
      name=firstAllowedView();
    }
    const target=document.getElementById(`view-${escapeHtml(name)}`);
    if(!target) return;
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    target.classList.add('active');
    document.querySelectorAll('.nav-button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === name);
    });
    const meta = {
      painel:['Painel geral','Visão rápida da operação e das prioridades.'],
      operacao:['Operação','Controle de movimentação dos paletes.'],
      requisicoes:['Requisições','Produção registrada por empilhador.'],
      usuarios:['Usuários','Criação, perfis e gerenciamento de acessos.'],
      historico:['Histórico','Registro completo das movimentações.'],
      indicadores:['Indicadores','Desempenho e alertas operacionais.'],
      auditoria:['Auditoria','Rastreabilidade de ações e alterações.'],
      configuracoes:['Configurações','Dados, dispositivos, backup e corredores.'],
      tecnico:['Painel TI','Diagnóstico, segurança e integração avançada.']
    };
    $('pageTitle').textContent = (meta[name] || meta.operacao)[0];
    $('pageSubtitle').textContent = (meta[name] || meta.operacao)[1];
    closeMenu();
    document.dispatchEvent(new CustomEvent('view:changed', {detail:{name}}));
  }
  function showLogin(){
    $('loginView')?.classList.remove('hidden');
    $('systemView')?.classList.add('hidden');
    setLoginError('');
  }
  function showSystem(user){
    $('loginView')?.classList.add('hidden');
    $('systemView')?.classList.remove('hidden');
    $('currentUserLabel').textContent = `${user.nome} · ${AppState.roleMeta[user.role]?.short || AppState.getRoleLabel(user.role)}`;
    Permissions.apply(user);
    $('permissionText').textContent = Permissions.describe(user.role);
    $('requestButton')?.classList.toggle('permission-hidden', !Permissions.can('requestPallet', user));
    openView('painel');
  }
  return {
    $,
    toast,
    setLoginError,
    openMenu,
    closeMenu,
    openView,
    showLogin,
    showSystem
  };
})();;

const TabletManager = (() => {
  const ACTIVE_WINDOW_MS = 10 * 60 * 1000;
  let heartbeatTimer = null;
  let forceSelection = false;
  function normalizeName(value){
    return String(value || '').trim().replace(/\s+/g,' ');
  }
  function deviceFor(name){
    const normalized=normalizeName(name).toLowerCase();
    return (AppState.getData().registeredDevices || []).find(item => String(item.name||'').toLowerCase()===normalized) || null;
  }
  function assignmentFor(name){
    const normalized=normalizeName(name).toLowerCase();
    return AppState.getData().tabletAssignments.find(item => String(item.tabletName||'').toLowerCase()===normalized) || null;
  }
  function isActive(item){
    return Boolean(item?.active && SeleneApi.now()-Number(item.lastSeen||0) < ACTIVE_WINDOW_MS);
  }
  function deviceId(name){
    return normalizeName(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || `device-${SeleneApi.now()}`;
  }
  function registeredDevices(){
    return [...(AppState.getData().registeredDevices || [])]
      .filter(item=>item.active !== false)
      .sort((a,b)=>String(a.name).localeCompare(String(b.name),'pt-BR',{numeric:true,sensitivity:'base'}));
  }
  function canUseDevice(user, device){
    if(!user || !device || device.active === false) return false;
    // Empilhador trabalha apenas com tablets. Computadores de Encarregado/TI nunca aparecem nem podem ser informados manualmente.
    if(user.role === 'empilhador') return device.type === 'tablet';
    return true;
  }
  function selectableDevices(user=AppState.getUser()){
    return registeredDevices().filter(device=>canUseDevice(user,device));
  }
  function renderDeviceOptions(){
    const datalist=UI.$('tabletOptions');
    if(!datalist) return;
    datalist.innerHTML=selectableDevices().map(device=>`<option value="${escapeHtml(device.name)}"></option>`).join('');
  }
  async function addDevice(name){const r=await DataSync.command('/devices',{name:name.trim(),type:UI.$('deviceAdminType').value});if(r){UI.toast('Dispositivo cadastrado.');return true;}return false;}
  async function removeDevice(id){if(confirm('Desativar este dispositivo?'))await DataSync.command('/devices/'+id,{},'DELETE');}
  function automaticDeviceForRole(){return '';}
  function ensureSystemDevice(){return null;}
  async function select(name){const d=deviceFor(name);if(!d){UI.toast('Selecione um dispositivo cadastrado.');return false;}const r=await DataSync.command('/devices/select',{device_id:d.id});updateBadge();return !!r;}
  function releaseCurrent(){}
  async function heartbeat(){if(!AppState.getUser()||!AppState.getTablet())return;try{await SeleneApi.mutate('/devices/heartbeat');}catch(error){UI.toast(error.message);if(error.status===409){AppState.clearTablet();updateBadge();}}}
  function updateBadge(){
    const badge=UI.$('currentTabletBadge');
    if(!badge) return;
    const user=AppState.getUser();
    const tablet=AppState.getTablet();
    const automaticName=automaticDeviceForRole(user?.role);
    const usingDefault=Boolean(automaticName && tablet?.name === automaticName);
    badge.textContent=tablet?.name ? `▣ ${tablet.name}${usingDefault ? ' · padrão' : ''}` : '▣ Selecionar equipamento';
    badge.classList.toggle('attention',!tablet?.name);
    badge.classList.toggle('automatic-device',usingDefault);
    badge.title='Clique para trocar o equipamento atual';
  }
  function openSelector(options={}){
    const user=AppState.getUser();
    if(!user) return;
    const dialog=UI.$('tabletDialog');
    const input=UI.$('tabletNameInput');
    if(!dialog || !input) return;
    renderDeviceOptions();
    const automatic=automaticDeviceForRole(user.role);
    const current=AppState.getTablet();
    const currentDevice=current?.name ? deviceFor(current.name) : null;
    const validCurrent=Boolean(currentDevice && canUseDevice(user,currentDevice));
    forceSelection=Boolean(options.force && user.role==='empilhador' && !validCurrent);
    input.value=validCurrent ? current.name : (automatic || '');
    UI.$('tabletCancelButton')?.classList.toggle('hidden',forceSelection);
    const warning=UI.$('tabletCurrentWarning');
    if(warning){
      warning.textContent=automatic ? `Equipamento padrão do perfil: ${automatic}. Você pode manter ou selecionar outro dispositivo cadastrado.` : '';
      warning.classList.toggle('hidden',!automatic);
    }
    if(!dialog.open) dialog.showModal();
    setTimeout(()=>input.focus(),50);
  }
  function ensureSelected(){updateBadge();if(!AppState.getTablet()&&AppState.getUser()?.role==='empilhador')openSelector({force:true});}
  function formatAgo(time){
    const diff=Math.max(0,SeleneApi.now()-Number(time||SeleneApi.now()));
    const min=Math.floor(diff/60000);
    if(min<1) return 'agora';
    if(min<60) return `há ${min} min`;
    const h=Math.floor(min/60), m=min%60;
    return `há ${h}h${m?` ${m}min`:''}`;
  }
  function palletListFor(entry){
    const data=AppState.getData();
    return data.requests.filter(request =>
      request.lastHandledByMatricula===entry.userMatricula &&
      request.lastHandledTablet===entry.tabletName &&
      ['lowering','floor','ready','returning'].includes(request.status)
    );
  }
  function renderAdminPanel(){
    const grid=UI.$('tabletControlGrid');
    if(!grid) return;
    const user=AppState.getUser();
    if(!['encarregado','ti'].includes(user?.role)){ grid.innerHTML=''; return; }
    const registered=registeredDevices();
    const assignments=AppState.getData().tabletAssignments || [];
    const items=registered.map(device=>{
      const assignment=assignments.find(item=>String(item.tabletName||'').toLowerCase()===device.name.toLowerCase());
      return assignment ? {...assignment,tabletName:device.name} : {tabletName:device.name,deviceId:device.id,active:false,lastSeen:0};
    }).sort((a,b)=>Number(b.lastSeen||0)-Number(a.lastSeen||0) || String(a.tabletName).localeCompare(String(b.tabletName),'pt-BR',{numeric:true}));
    if(!items.length){ grid.innerHTML='<div class="empty compact">Nenhum dispositivo cadastrado.</div>'; return; }
    grid.innerHTML=items.map(item=>{
      const active=isActive(item);
      const pallets=item.userMatricula ? palletListFor(item) : [];
      return `<article class="tablet-device-card">
        <div class="tablet-device-head"><b>▣ ${escapeHtml(item.tabletName)}</b><span class="tablet-status ${active?'online':'last'}">${active?'Em uso':item.lastSeen?'Último uso':'Disponível'}</span></div>
        <div class="tablet-device-user"><strong>${escapeHtml(item.userName || 'Sem usuário registrado')}</strong><small>${item.userMatricula ? `${escapeHtml(item.userMatricula)} · ${AppState.getRoleLabel(item.userRole)} · ${formatAgo(item.lastSeen)}` : 'Nenhum uso registrado'}</small></div>
        ${pallets.length ? `<div class="tablet-pallets">${pallets.map(p=>`<span class="tablet-pallet-chip ${p.isPic?'pic':''}">${escapeHtml(p.address)} · ${p.status==='floor'?'no chão':p.status==='ready'?'liberado':'movendo'}</span>`).join('')}</div>` : '<div class="tablet-empty">Nenhum palet associado no momento.</div>'}
      </article>`;
    }).join('');
  }
  function renderDeviceAdmin(){
    const list=UI.$('registeredDeviceList');
    if(!list) return;
    if(!['encarregado','ti'].includes(AppState.getUser()?.role)){
      list.innerHTML='';
      return;
    }
    const devices=registeredDevices();
    list.innerHTML=devices.length ? devices.map(device=>{
      const assignment=assignmentFor(device.name);
      const active=assignment && isActive(assignment);
      return `<div class="registered-device-row">
        <div><b>▣ ${escapeHtml(device.name)}</b><small>${active ? `Em uso por ${escapeHtml(assignment.userName || assignment.userMatricula)}` : assignment?.lastSeen ? `Último uso ${formatAgo(assignment.lastSeen)}` : 'Ainda não utilizado'}</small></div>
        <button class="btn btn-soft device-remove-button" type="button" data-remove-device="${device.id}" ${active || device.locked ? `disabled title="${device.locked?'Dispositivo automático protegido':'Dispositivo em uso'}"` : ''}>Remover</button>
      </div>`;
    }).join('') : '<div class="empty compact">Nenhum dispositivo cadastrado.</div>';
  }
  function init(){
    renderDeviceOptions();
    UI.$('currentTabletBadge')?.addEventListener('click',()=>openSelector({force:false}));
    UI.$('tabletCancelButton')?.addEventListener('click',()=>UI.$('tabletDialog')?.close());
    UI.$('tabletNameInput')?.addEventListener('input',event=>{
      const existing=assignmentFor(event.target.value);
      const warning=UI.$('tabletCurrentWarning');
      if(!warning) return;
      const typedDevice=deviceFor(event.target.value);
      if(event.target.value && !typedDevice){
        warning.textContent='Esse equipamento não está cadastrado. O Encarregado ou TI precisa adicioná-lo em Configurações > Dispositivos.';
        warning.classList.remove('hidden');
      }else if(typedDevice && !canUseDevice(AppState.getUser(),typedDevice)){
        warning.textContent='Para o perfil Emp, somente tablets cadastrados podem ser selecionados.';
        warning.classList.remove('hidden');
      }else if(existing?.userMatricula && existing.userMatricula!==AppState.getUser()?.matricula){
        warning.textContent=`Atenção: ${existing.tabletName} foi usado por último por ${existing.userName || existing.userMatricula} (${formatAgo(existing.lastSeen)}). Um equipamento em uso não pode ser assumido por outra sessão.`;
        warning.classList.remove('hidden');
      }else warning.classList.add('hidden');
    });
    UI.$('tabletForm')?.addEventListener('submit',async event=>{
      event.preventDefault();
      if(await select(UI.$('tabletNameInput').value)){
        forceSelection=false;
        UI.$('tabletDialog').close();
      }
    });
    UI.$('tabletDialog')?.addEventListener('cancel',event=>{
      if(forceSelection) event.preventDefault();
    });
    UI.$('deviceAdminForm')?.addEventListener('submit',async event=>{
      event.preventDefault();
      const input=UI.$('deviceAdminName');
      if(await addDevice(input?.value || '')){
        event.target.reset();
        input?.focus();
      }
    });
    UI.$('registeredDeviceList')?.addEventListener('click',event=>{
      const button=event.target.closest('[data-remove-device]');
      if(button) removeDevice(button.dataset.removeDevice);
    });
    document.addEventListener('app:data-changed',()=>{ renderAdminPanel(); renderDeviceAdmin(); renderDeviceOptions(); });
    document.addEventListener('view:changed',event=>{
      if(event.detail.name==='painel') renderAdminPanel();
      if(event.detail.name==='configuracoes') renderDeviceAdmin();
    });
    heartbeatTimer=setInterval(heartbeat,60000);
    updateBadge();
    renderDeviceAdmin();
  }
  return {init,ensureSelected,openSelector,select,releaseCurrent,renderAdminPanel,renderDeviceAdmin,addDevice,removeDevice,heartbeat};
})();;

const Operation = (() => {
  
  let elapsedRefreshTimer = null;
  const FLOOR_UNLOCK_MS = 90 * 60 * 1000;
  const WAIT_ALERT_MS = 10 * 60 * 1000;
  const PIC_RETURN_LIMIT_MS = 10 * 60 * 1000;
  function corridorFor(){return 'OUTROS';}
  function addHistory(){throw new Error('O histórico é registrado pelo servidor.');}
  function elapsedMinutes(request){
    return Math.max(0, Math.floor((SeleneApi.now() - Number(request.createdAt || SeleneApi.now())) / 60000));
  }
  function elapsedClock(request){
    const totalSeconds = Math.max(0, Math.floor((SeleneApi.now() - Number(request.createdAt || SeleneApi.now())) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if(hours > 0){
      return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
    }
    return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  }
  function waitingAlertDue(request){
    return request.status === 'waiting' && (SeleneApi.now() - Number(request.createdAt || SeleneApi.now())) >= WAIT_ALERT_MS;
  }
  function picReturnOverdue(request){
    return Boolean(request.isPic && ['ready','floor'].includes(request.status) && floorElapsedMs(request) >= PIC_RETURN_LIMIT_MS);
  }
  function picReturnClock(request){
    return formatDurationSeconds(Math.ceil((PIC_RETURN_LIMIT_MS - floorElapsedMs(request)) / 1000));
  }
  function addressParts(address){
    return String(address || '').toUpperCase().match(/\d+|[A-Z]+/g) || [];
  }
  function compareAddresses(a, b){
    const left = addressParts(a.address);
    const right = addressParts(b.address);
    const length = Math.max(left.length, right.length);
    for(let index = 0; index < length; index += 1){
      if(left[index] === undefined) return -1;
      if(right[index] === undefined) return 1;
      const leftNumber = Number(left[index]);
      const rightNumber = Number(right[index]);
      const bothNumbers = Number.isFinite(leftNumber) && Number.isFinite(rightNumber);
      const comparison = bothNumbers
        ? leftNumber - rightNumber
        : left[index].localeCompare(right[index], 'pt-BR', {numeric:true, sensitivity:'base'});
      if(comparison !== 0) return comparison;
    }
    return 0;
  }
  function floorElapsedMs(request){
    return Math.max(0, SeleneApi.now() - Number(request.loweredAt || request.createdAt || SeleneApi.now()));
  }
  function formatDurationSeconds(totalSeconds){
    const safe = Math.max(0, Math.floor(totalSeconds));
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const seconds = safe % 60;
    return hours > 0
      ? `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`
      : `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  }
  function floorUnlockClock(request){
    return formatDurationSeconds(Math.ceil((FLOOR_UNLOCK_MS - floorElapsedMs(request)) / 1000));
  }
  function floorElapsedClock(request){
    return formatDurationSeconds(Math.floor(floorElapsedMs(request) / 1000));
  }
  function unlockDueFloorRequests(){return false;}
  function visibleRequests(){
    const data = AppState.getData();
    const query = UI.$('searchInput').value.toLowerCase().trim();
    const status = UI.$('statusFilter').value;
    return data.requests.filter(request =>
      data.selectedCorridors.includes(request.corridor) &&
      (!query || `${escapeHtml(request.address)} ${escapeHtml(request.operator)}`.toLowerCase().includes(query)) &&
      (status === 'all' || request.status === status)
    ).sort(compareAddresses);
  }
  function picMarkup(request){
    return request.isPic ? '<span class="pic-badge">EXP-PIC</span><div class="pic-message">⚠ Avisar armazenista</div>' : '';
  }
  function handlerMarkup(request){
    if(!request.lastHandledByName) return '';
    const tablet = request.lastHandledTablet ? ` · ${escapeHtml(request.lastHandledTablet)}` : '';
    return `<small class="handler-info">Último: ${escapeHtml(request.lastHandledByName)}${tablet}</small>`;
  }
  function waitingCard(request){
    const alertDue = waitingAlertDue(request);
    const hazardActive = request.isPic || alertDue;
    const statusLabel = request.isPic ? 'EXP-PIC' : (alertDue ? '⚠ ALERTA · +10 min' : 'Aguardando');
    return `
      <button class="pallet-card waiting wait-normal ${request.isPic ? 'pic' : ''} ${hazardActive ? 'hazard-blink' : ''}" data-id="${request.id}" data-external="${request.external ? 'true' : 'false'}">
        <div>
          <div class="pallet-title-line"><b>${escapeHtml(request.address)}</b>${request.isPic ? '<span class="pic-badge">EXP-PIC</span>' : ''}</div>
          <small>${escapeHtml(request.operator)}</small>
          ${handlerMarkup(request)}
        </div>
        ${request.isPic ? '<div class="pic-message">⚠ Avisar armazenista</div>' : ''}
        <div class="card-footer wait-footer">
          <span class="wait-status">${statusLabel}</span>
          <time data-elapsed-id="${request.id}">${elapsedClock(request)}</time>
        </div>
        <div class="card-action">${request.state==='LOWER_AUTHORIZED'?'Autorizado · toque para baixar ↓':Permissions.can('pallet:authorize_lower')?'Toque para autorizar descida':'Aguardando autorização'}</div>
      </button>
    `;
  }
  function manualUnlockLabel(request){
    if(!request.manualUnlockedBy && !request.manualUnlockedRole) return '';
    const user=AppState.users.find(item=>item.matricula===request.manualUnlockedBy);
    const role=request.manualUnlockedRole || user?.role || '';
    const label=role ? AppState.getRoleLabel(role) : 'responsável';
    return `Liberado pelo ${label}`;
  }
  function stableCard(request){
    let hint = '';
    let timing = '';
    const picOverdue = picReturnOverdue(request);
    if(request.status === 'floor'){
      const privileged = ['encarregado','ti'].includes(AppState.getUser()?.role);
      hint = privileged
        ? `Clique para liberar · automático em ${floorUnlockClock(request)}`
        : `Liberação automática em ${floorUnlockClock(request)}`;
      timing = `<time class="floor-time" data-floor-time-id="${request.id}">Baixado há ${floorElapsedClock(request)}</time>`;
    }
    if(request.status === 'ready'){
      if(request.isPic){
        hint = picOverdue ? '⚠ ALERTA VERMELHO · EXP-PIC +10 min no chão' : 'EXP-PIC liberado · subir em até 10 min ↑';
        timing = `<time class="floor-time pic-return-time ${picOverdue ? 'overdue' : ''}" data-pic-return-id="${request.id}">${picOverdue ? `Atrasado · ${floorElapsedClock(request)}` : `Tempo restante ${picReturnClock(request)}`}</time>`;
      }else{
        hint = 'Toque para subir ↑';
        const manualLabel=manualUnlockLabel(request);
        timing = `<time class="floor-time ready-time ${manualLabel ? 'manual-release' : ''}">${manualLabel || 'Liberado automaticamente · 1h30 concluída'}</time>`;
      }
    }
    return `
      <button class="pallet-card ${request.status} ${request.isPic ? 'pic hazard-blink' : ''} ${picOverdue ? 'pic-overdue' : ''}" data-id="${request.id}" data-external="${request.external ? 'true' : 'false'}">
        <div>
          <div class="pallet-title-line"><b>${escapeHtml(request.address)}</b>${request.isPic ? '<span class="pic-badge">EXP-PIC</span>' : ''}</div>
          <small>${escapeHtml(request.operator)}</small>
          ${handlerMarkup(request)}
        </div>
        ${request.isPic ? '<div class="pic-message">⚠ Avisar armazenista</div>' : ''}
        <div class="card-footer floor-footer"><span>${hint}</span>${timing}</div>
      </button>
    `;
  }
  function movingCard(request){
    const lowering = request.status === 'lowering';
    return `
      <article class="pallet-card ${request.status} ${request.isPic ? 'pic hazard-blink' : ''}" data-id="${request.id}" data-external="${request.external ? 'true' : 'false'}">
        <div>
          <div class="pallet-title-line"><b>${escapeHtml(request.address)}</b>${request.isPic ? '<span class="pic-badge">EXP-PIC</span>' : ''}</div>
          <small>${escapeHtml(request.operator)}</small>
          ${handlerMarkup(request)}
        </div>
        <div>
          <div class="card-footer">
            <span>${lowering ? 'Descendo...' : 'Subindo...'}</span>
            <b class="countdown" id="countdown-${request.id}">${Math.max(0,Math.ceil((request.confirmAt-SeleneApi.now())/1000))}s</b>
          </div>
          <button class="undo-button" data-undo="${request.id}">
            ↩ ${lowering ? 'Cancelar descida' : 'Voltar palet'}
          </button>
        </div>
      </article>
    `;
  }
  function cardTemplate(request){
    if(request.status === 'waiting') return waitingCard(request);
    if(['lowering','returning'].includes(request.status)) return movingCard(request);
    return stableCard(request);
  }
  function renderRequests(){
    unlockDueFloorRequests();
    const data = AppState.getData();
    const list = visibleRequests();
    const top = list.filter(r => ['waiting','returning'].includes(r.status));
    let bottom = list.filter(r => ['lowering','floor','ready'].includes(r.status));
    if(UI.$('availableOnly').checked){
      bottom = bottom.filter(r => r.status === 'ready');
    }
    UI.$('topGrid').innerHTML = top.length
      ? top.map(cardTemplate).join('')
      : '<div class="empty">Nenhum palet nesta seleção.</div>';
    UI.$('bottomGrid').innerHTML = bottom.length
      ? bottom.map(cardTemplate).join('')
      : (UI.$('availableOnly').checked
          ? '<div class="empty">Nenhum palet disponível para subir.</div>'
          : '<div class="empty">Nenhum palet baixado.</div>');
    UI.$('countWaiting').textContent = data.requests.filter(r => r.status === 'waiting').length;
    UI.$('countFloor').textContent = data.requests.filter(r => r.status === 'floor').length;
    UI.$('countReady').textContent = data.requests.filter(r => r.status === 'ready').length;
    UI.$('countMoving').textContent = data.requests.filter(r => ['lowering','returning'].includes(r.status)).length;
  }
  function updateElapsedClocks(){
    const unlocked = unlockDueFloorRequests();
    if(unlocked){
      renderAll();
      return;
    }
    const data = AppState.getData();
    for(const r of data.requests.filter(x=>x.confirmAt)){const el=UI.$('countdown-'+r.id);if(el)el.textContent=Math.max(0,Math.ceil((r.confirmAt-SeleneApi.now())/1000))+'s';}
    document.querySelectorAll('[data-elapsed-id]').forEach(element => {
      const request = data.requests.find(r => r.id === Number(element.dataset.elapsedId));
      if(!request) return;
      element.textContent = elapsedClock(request);
      const card = element.closest('.pallet-card');
      if(!card || request.status !== 'waiting') return;
      const alertDue = waitingAlertDue(request);
      card.classList.toggle('hazard-blink', request.isPic || alertDue);
      const status = card.querySelector('.wait-status');
      if(status) status.textContent = request.isPic ? 'EXP-PIC' : (alertDue ? '⚠ ALERTA · +10 min' : 'Aguardando');
    });
    document.querySelectorAll('[data-floor-time-id]').forEach(element => {
      const request = data.requests.find(r => r.id === Number(element.dataset.floorTimeId));
      if(!request || request.status !== 'floor') return;
      element.textContent = `Baixado há ${floorElapsedClock(request)}`;
      const hint = element.closest('.pallet-card')?.querySelector('.floor-footer span');
      const privileged=['encarregado','ti'].includes(AppState.getUser()?.role);
      if(hint) hint.textContent = privileged
        ? `Clique para liberar · automático em ${floorUnlockClock(request)}`
        : `Liberação automática em ${floorUnlockClock(request)}`;
    });
    document.querySelectorAll('[data-pic-return-id]').forEach(element => {
      const request = data.requests.find(r => r.id === Number(element.dataset.picReturnId));
      if(!request || !request.isPic || request.status !== 'ready') return;
      const overdue = picReturnOverdue(request);
      const card = element.closest('.pallet-card');
      card?.classList.toggle('hazard-blink', true);
      card?.classList.toggle('pic-overdue', overdue);
      element.classList.toggle('overdue', overdue);
      element.textContent = overdue ? `Atrasado · ${floorElapsedClock(request)}` : `Tempo restante ${picReturnClock(request)}`;
      const hint = card?.querySelector('.floor-footer span');
      if(hint) hint.textContent = overdue ? '⚠ ALERTA VERMELHO · EXP-PIC +10 min no chão' : 'EXP-PIC liberado · subir em até 10 min ↑';
    });
  }
  async function moveRequest(id){
    const r=AppState.getData().requests.find(x=>x.id===id);if(!r)return;
    if(r.state==='WAITING'||r.state==='ASSIGNED'){
      if(!Permissions.can('pallet:authorize_lower')){UI.toast('Palete ainda não está autorizado para baixar.');return;}
      const input=await SeleneApi.dialog('Autorizar descida',[{name:'reason',label:'Motivo da autorização',required:true}]);if(input)await command(r,'authorize-lower',input);return;
    }
    if(r.status==='floor'){
      if(!Permissions.can('pallet:authorize_raise')){UI.toast('Palete ainda não está autorizado para subir.');return;}
      const input=await SeleneApi.dialog('Autorizar retorno antecipado',[{name:'reason',label:'Motivo obrigatório',required:true}]);if(input)await command(r,'authorize-raise',input);return;
    }
    if(r.status==='waiting')await command(r,'lower');else if(r.status==='ready')await command(r,'raise');
  }
  async function command(r,action,body={}){return DataSync.command(`/pallets/${r.id}/${action}`,{version:r.version,...body});}

  async function startMovement(r,direction){return command(r,direction==='down'?'lower':'raise');}
  function startTimer(){}
  function resumeMovementTimers(){}
  async function undoMovement(id){const r=AppState.getData().requests.find(x=>x.id===id);if(r)await command(r,'undo');}
  function finalizeMovement(){}
  async function requestPallet(address,operator,options={}){const r=await DataSync.command('/pallets',{address,operator,area:options.isPic?'EXP-PIC':'NORMAL',quantity:Number(UI.$('requestQuantity').value),reference:UI.$('requestReference').value,volumes:UI.$('requestVolumes').value===''?null:Number(UI.$('requestVolumes').value),note:UI.$('requestNote').value,identified:UI.$('requestIdentified').checked,stretch:UI.$('requestStretch').checked});if(r)UI.toast('Solicitação registrada. Aguarde autorização de descida.');return !!r;}
  function renderCorridorModal(){
    const data = AppState.getData();
    UI.$('corridorOptions').innerHTML = AppState.corridors.map(corridor => `
      <label>
        <input type="checkbox" value="${escapeHtml(corridor)}"
               ${data.selectedCorridors.includes(corridor) ? 'checked' : ''}>
        ${escapeHtml(corridor)}
      </label>
    `).join('');
    updateToggleAllLabel();
  }
  function updateToggleAllLabel(){
    const boxes = [...UI.$('corridorOptions').querySelectorAll('input[type="checkbox"]')];
    const allSelected = boxes.length > 0 && boxes.every(box => box.checked);
    UI.$('toggleAllCorridors').textContent = allSelected
      ? '✓ Desmarcar todos'
      : '□ Selecionar todos';
  }
  function toggleAllCorridors(){
    const boxes = [...UI.$('corridorOptions').querySelectorAll('input[type="checkbox"]')];
    const shouldSelect = !boxes.every(box => box.checked);
    boxes.forEach(box => box.checked = shouldSelect);
    updateToggleAllLabel();
  }
  function saveCorridors(){
    const data = AppState.getData();
    data.selectedCorridors = [...UI.$('corridorOptions').querySelectorAll('input:checked')]
      .map(input => input.value);
    AppState.save();
    UI.$('corridorDialog').close();
    renderAll();
    UI.toast('Corredores atualizados.');
  }
  function renderSelectedCorridors(){
    const selected = AppState.getData().selectedCorridors;
    UI.$('selectedCorridors').innerHTML = selected.length
      ? selected.map(c => `<span class="chip">${escapeHtml(c)}</span>`).join('')
      : '<span class="chip">Nenhum corredor</span>';
  }
  function updateRequestButton(){
    const active = Boolean(getOpenProductionRequest());
    UI.$('shiftButton').classList.toggle('inactive', !active);
    UI.$('shiftButton').querySelector('span').textContent = active
      ? 'Encerrar requisição'
      : 'Iniciar requisição';
  }
  function formatRequestNumber(id, startedAt){
    const date = new Date(startedAt);
    const y = date.getFullYear();
    const m = String(date.getMonth()+1).padStart(2,'0');
    const d = String(date.getDate()).padStart(2,'0');
    return `REQ-${y}${m}${d}-${String(id).padStart(4,'0')}`;
  }
  function getOpenProductionRequest(user = AppState.getUser()){
    if(!user) return null;
    return AppState.getData().productionRequests.find(request =>
      request.userMatricula === user.matricula &&
      request.status === 'open'
    ) || null;
  }
  async function createProductionRequest(){const r=await DataSync.command('/production/start');return r?getOpenProductionRequest():null;}
  async function closeProductionRequest(){const current=getOpenProductionRequest();const r=await DataSync.command('/production/close');return r?AppState.getData().productionRequests.find(x=>x.id===current.id):null;}
  function addProductionMovement(){}
  function renderProductionRequest(){
    const user = AppState.getUser();
    const request = getOpenProductionRequest(user);
    const badge = UI.$('currentProductionRequest');
    if(badge){
      if(request){
        badge.classList.remove('hidden');
        badge.textContent = `${escapeHtml(request.number)} · ${request.downCount + request.upCount} mov.`;
      }else{
        badge.classList.add('hidden');
        badge.textContent = '';
      }
    }
  }
  function renderAll(){
    renderRequests();
    History.render();
    Indicators.render();
    renderSelectedCorridors();
    updateRequestButton();
    renderProductionRequest();
    updateElapsedClocks();
    if(typeof Dashboard !== 'undefined') Dashboard.render();
    if(typeof Notifications !== 'undefined') Notifications.render();
  }
  function init(){
    document.addEventListener('click', event => {
      const undo = event.target.closest('[data-undo]');
      if(undo){
        event.stopPropagation();
        undoMovement(Number(undo.dataset.undo));
        return;
      }
      const card = event.target.closest('.pallet-card');
      if(card && !card.classList.contains('lowering') && !card.classList.contains('returning')){
        moveRequest(Number(card.dataset.id));
      }
    });
    UI.$('searchInput').addEventListener('input', renderRequests);
    UI.$('statusFilter').addEventListener('change', renderRequests);
    UI.$('availableOnly').addEventListener('change', renderRequests);
    UI.$('requestButton').addEventListener('click', () => {
      if(!Permissions.can('requestPallet')){
        UI.toast('Seu perfil não possui permissão para pedir paletes.');
        return;
      }
      UI.$('requestOperator').value = AppState.getUser()?.nome || '';
      UI.$('requestAddress').value = '';
      UI.$('requestIsPic').disabled=!Permissions.can('pallet:exp_pic_manage');
      UI.$('requestDialog').showModal();
      setTimeout(() => UI.$('requestAddress').focus(), 40);
    });
    UI.$('requestForm').addEventListener('submit', async event => {
      event.preventDefault();
      const created = await requestPallet(
        UI.$('requestAddress').value,
        UI.$('requestOperator').value,
        {isPic:Boolean(UI.$('requestIsPic')?.checked)}
      );
      if(created){
        event.target.reset();
        UI.$('requestDialog').close();
      }
    });
    UI.$('corridorButton').addEventListener('click', () => {
      renderCorridorModal();
      UI.$('corridorDialog').showModal();
    });
    UI.$('toggleAllCorridors').addEventListener('click', toggleAllCorridors);
    UI.$('corridorOptions').addEventListener('change', updateToggleAllLabel);
    UI.$('corridorForm').addEventListener('submit', async event => {
      event.preventDefault();
      saveCorridors();
    });
    UI.$('shiftButton').addEventListener('click', async () => {
      const openRequest = getOpenProductionRequest();
      if(!openRequest){
        const request = await createProductionRequest();
        if(!request)return;
        renderAll();
        UI.toast(`${escapeHtml(request.number)} iniciada para ${escapeHtml(request.userName)}.`);
        if(UI.$('view-requisicoes')?.classList.contains('active')) ProductionRequests.render();
        return;
      }
      const request = await closeProductionRequest();
      if(!request)return;
      renderAll();
      if(UI.$('view-requisicoes')?.classList.contains('active')) ProductionRequests.render();
      UI.toast(`${escapeHtml(request.number)} encerrada com ${request.downCount + request.upCount} movimentações.`);
    });
    UI.$('refreshButton').addEventListener('click',()=>DataSync.refresh().then(()=>UI.toast('Dados atualizados do servidor.')).catch(e=>UI.toast(e.message)));
    document.querySelectorAll('.cancel-dialog').forEach(button => {
      button.addEventListener('click', () => button.closest('dialog').close());
    });
    if(elapsedRefreshTimer) clearInterval(elapsedRefreshTimer);
    elapsedRefreshTimer = setInterval(updateElapsedClocks, 1000);
    resumeMovementTimers();
  }
  return {
    init,
    renderAll,
    renderRequests,
    addHistory,
    getOpenProductionRequest
  };
})();;

const History = (() => {
  let page=1,remoteRows=null,hasMore=false,queryTimer;
  async function load(){if(!Permissions.can('history'))return;try{const r=await SeleneApi.request('/history?page='+page+'&q='+encodeURIComponent(UI.$('historySearchInput').value));remoteRows=r.rows;hasMore=r.hasMore;render();}catch(e){UI.toast(e.message);}}
  function escapeHtml(value=''){
    return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'})[char]);
  }
  function searchableText(item){
    const date = new Date(item.time);
    return [
      item.requestNumber,
      item.address,
      item.action,
      item.operator,
      item.operatorMatricula,
      date.toLocaleString('pt-BR'),
      date.toLocaleDateString('pt-BR'),
      date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})
    ].join(' ').toLowerCase();
  }
  function filteredHistory(){return remoteRows||AppState.getData().history;}
  function render(){
    const history = AppState.getData().history;
    const filtered = filteredHistory();
    UI.$('liveHistory').innerHTML = history.length
      ? history.slice(0,40).map(item => {
          const directionClass = item.direction === 'down' ? 'down' : item.direction === 'up' ? 'up' : 'other';
          const icon = item.direction === 'down' ? '↓' : item.direction === 'up' ? '↑' : '•';
          return `
            <div class="history-item">
              <span class="history-icon ${directionClass}">${icon}</span>
              <span><b>${escapeHtml(item.address)}</b><small>${escapeHtml(item.action)} · ${escapeHtml(item.operator)}</small></span>
              <time>${new Date(item.time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time>
            </div>`;
        }).join('')
      : '<div class="empty">Nenhuma movimentação ainda.</div>';
    UI.$('historyTable').innerHTML = filtered.length ? filtered.map(item => `
      <tr>
        <td>${new Date(item.time).toLocaleString('pt-BR')}</td>
        <td>${item.requestNumber ? `<span class="request-number-cell">${escapeHtml(item.requestNumber)}</span>` : '—'}</td>
        <td>${escapeHtml(item.address)}</td>
        <td>${escapeHtml(item.action)}</td>
        <td>${escapeHtml(item.operator)}</td>
      </tr>`).join('') : `
      <tr><td colspan="5"><div class="empty">Nenhum registro encontrado na pesquisa.</div></td></tr>`;
    UI.$('liveDown').textContent = history.filter(h => h.direction === 'down').length;
    UI.$('liveUp').textContent = AppState.getData().metrics.up||0;
    UI.$('historyPage').textContent='Página '+page;UI.$('historyPrev').disabled=page<=1;UI.$('historyNext').disabled=!hasMore;
  }
  function init(){
    UI.$('historySearchInput')?.addEventListener('input',()=>{clearTimeout(queryTimer);queryTimer=setTimeout(()=>{page=1;load();},300);});
    UI.$('historyPrev').onclick=()=>{page--;load();};UI.$('historyNext').onclick=()=>{page++;load();};document.addEventListener('view:changed',e=>{if(e.detail.name==='historico')load();});
    document.addEventListener('app:data-changed',()=>{
      if(UI.$('view-historico')?.classList.contains('active')) render();
    });
  }
  return { init, render };
})();;

const Indicators = (() => {
  function render(){
    const data = AppState.getData();
    const history = data.history;
    const down = data.metrics.down||0;
    const up = data.metrics.up||0;
    const canceled = data.metrics.cancelled||0;
    UI.$('metricDown').textContent = down;
    UI.$('metricUp').textContent = up;
    UI.$('metricCanceled').textContent = canceled;
    UI.$('metricOpen').textContent = data.requests.length;
    const productionRequest = Operation.getOpenProductionRequest();
    const productionTotal = productionRequest
      ? productionRequest.downCount + productionRequest.upCount
      : 0;
    UI.$('metricProduction').textContent = productionTotal;
    UI.$('metricProductionDetail').textContent = productionRequest
      ? `${productionRequest.number} · ↓ ${productionRequest.downCount} · ↑ ${productionRequest.upCount}`
      : 'Sem requisição aberta';
    const operators = {};
    history.filter(h => h.direction).forEach(item => {
      operators[item.operator] = (operators[item.operator] || 0) + 1;
    });
    const ranking = (data.metrics.ranking||[]).map(x=>[x.nome,x.total]);
    const max = Math.max(...ranking.map(([,total]) => total), 1);
    UI.$('operatorStats').innerHTML = ranking.length
      ? ranking.map(([name,total]) => `
          <div class="operator-row">
            <div class="operator-head"><span>${escapeHtml(name)}</span><b>${total}</b></div>
            <div class="progress"><i class="width-${Math.round(total/max*100)}"></i></div>
          </div>
        `).join('')
      : '<div class="empty">Sem movimentações registradas.</div>';
    const alerts = [];
    data.requests.forEach(request => {
      const ageMinutes = Math.floor((SeleneApi.now() - request.createdAt) / 60000);
      const floorAgeMinutes = Math.floor((SeleneApi.now() - Number(request.loweredAt || request.createdAt)) / 60000);
      if(request.isPic && request.status === 'ready' && floorAgeMinutes >= 10){
        alerts.push({type:'danger',title:`${escapeHtml(request.address)} · EXP-PIC`,message:`EXP-PIC no chão há ${floorAgeMinutes} minutos. Subir agora e avisar armazenista.`});
      }
      if(!request.isPic && request.status === 'floor' && floorAgeMinutes >= 80){
        alerts.push({type:'warning',title:request.address,message:`No chão há ${floorAgeMinutes} minutos. Próximo da liberação de 1h30.`});
      }
      if(request.status === 'waiting' && ageMinutes >= 10){
        alerts.push({type:'warning',title:request.address,message:`Aguardando há ${ageMinutes} minutos · pisca-alerta ativo.`});
      }
      if(['lowering','returning'].includes(request.status)){
        alerts.push({
          type:'warning',
          title:request.address,
          message:`${request.status === 'lowering' ? 'Descendo' : 'Subindo'}: ${request.remaining ?? 0}s para confirmar.`
        });
      }
    });
    UI.$('alerts').innerHTML = alerts.length
      ? alerts.map(alert => `
          <div class="alert ${alert.type}">
            <b>${escapeHtml(alert.title)}</b>
            <div>${escapeHtml(alert.message)}</div>
          </div>
        `).join('')
      : '<div class="alert success"><b>Operação normal</b><div>Nenhum alerta no momento.</div></div>';
  }
  return { render };
})();;

const ProductionRequests = (() => {
  let filteredRequests = [], page=1, hasMore=false, totals={count:0,down:0,up:0}, queryVersion=0;
  function formatDateTime(timestamp){
    if(!timestamp) return '—';
    return new Date(timestamp).toLocaleString('pt-BR', {
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit'
    });
  }
  function formatDuration(milliseconds){
    const safe = Math.max(0, Number(milliseconds || 0));
    const totalMinutes = Math.floor(safe / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2,'0')}h ${String(minutes).padStart(2,'0')}min`;
  }
  function requestDuration(request){
    const end = request.endedAt || SeleneApi.now();
    return Math.max(0, end - request.startedAt);
  }
  function populateUsers(){
    const select = UI.$('productionUserFilter');
    if(!select) return;
    const current = select.value;
    const users = [...new Map(
      AppState.getData().productionRequests.map(request => [
        request.userMatricula,
        {matricula:request.userMatricula, name:request.userName}
      ])
    ).values()].sort((a,b) => a.name.localeCompare(b.name));
    select.innerHTML = '<option value="">Todos os usuários</option>' +
      users.map(user => `<option value="${escapeHtml(user.matricula)}">${escapeHtml(user.name)}</option>`).join('');
    select.value = users.some(user => user.matricula === current) ? current : '';
  }
  function localDateStart(value){
    if(!value) return null;
    const [year,month,day] = value.split('-').map(Number);
    return new Date(year, month-1, day, 0, 0, 0, 0).getTime();
  }
  function localDateEnd(value){
    if(!value) return null;
    const [year,month,day] = value.split('-').map(Number);
    return new Date(year, month-1, day, 23, 59, 59, 999).getTime();
  }
  async function applyFilters(){
    if(!Permissions.can('manageRequests'))return;const version=++queryVersion;
    const query=new URLSearchParams({page,q:UI.$('productionNumberFilter').value,user:UI.$('productionUserFilter').value,status:UI.$('productionStatusFilter').value,date_from:UI.$('productionDateFrom').value,date_to:UI.$('productionDateTo').value});
    try{const r=await SeleneApi.request('/production?'+query);if(version!==queryVersion)return;filteredRequests=r.rows;totals=r.totals;hasMore=r.hasMore;renderTable();renderTotals();UI.$('productionPage').textContent='Página '+page;UI.$('productionPrev').disabled=page<=1;UI.$('productionNext').disabled=!hasMore;}catch(e){UI.toast(e.message);}
  }
  function renderTotals(){UI.$('productionFoundCount').textContent=totals.count;UI.$('productionDownTotal').textContent=totals.down;UI.$('productionUpTotal').textContent=totals.up;UI.$('productionMovementTotal').textContent=totals.down+totals.up;}
  function renderTable(){
    const body = UI.$('productionRequestsBody');
    if(!body) return;
    if(!filteredRequests.length){
      body.innerHTML = `
        <tr>
          <td colspan="10">
            <div class="empty">Nenhuma requisição encontrada com esses filtros.</div>
          </td>
        </tr>
      `;
      UI.$('selectAllProductionRequests').checked = false;
      return;
    }
    body.innerHTML = filteredRequests.map(request => {
      const total = Number(request.downCount || 0) + Number(request.upCount || 0);
      const statusLabel = request.status === 'open' ? 'Em andamento' : 'Encerrada';
      return `
        <tr>
          <td>
            <input class="production-request-check" type="checkbox" value="${request.id}">
          </td>
          <td><b>${escapeHtml(request.number)}</b></td>
          <td>${escapeHtml(request.userName)}</td>
          <td>${escapeHtml(request.tabletName || '—')}</td>
          <td>${formatDateTime(request.startedAt)}</td>
          <td>${formatDateTime(request.endedAt)}</td>
          <td><span class="request-status ${request.status}">${statusLabel}</span></td>
          <td class="number-cell">${request.downCount || 0}</td>
          <td class="number-cell">${request.upCount || 0}</td>
          <td class="number-cell total-cell">${total}</td>
        </tr>
      `;
    }).join('');
    UI.$('selectAllProductionRequests').checked = false;
  }
  function selectedRequests(){
    const ids = [...document.querySelectorAll('.production-request-check:checked')]
      .map(input => Number(input.value));
    return filteredRequests.filter(request => ids.includes(request.id));
  }
  function sumSelected(){
    const selected = selectedRequests();
    if(!selected.length){
      UI.$('selectedProductionSummary').classList.add('hidden');
      UI.toast('Selecione pelo menos uma requisição.');
      return;
    }
    const down = selected.reduce((sum,request) => sum + Number(request.downCount || 0), 0);
    const up = selected.reduce((sum,request) => sum + Number(request.upCount || 0), 0);
    const duration = selected.reduce((sum,request) => sum + requestDuration(request), 0);
    const total = down + up;
    const average = total / selected.length;
    const users = [...new Set(selected.map(request => request.userName))];
    UI.$('selectedProductionSummary').classList.remove('hidden');
    UI.$('selectedProductionDescription').textContent =
      `${selected.length} requisição(ões) · ${users.join(', ')}`;
    UI.$('selectedRequestCount').textContent = selected.length;
    UI.$('selectedDownCount').textContent = down;
    UI.$('selectedUpCount').textContent = up;
    UI.$('selectedMovementCount').textContent = total;
    UI.$('selectedDuration').textContent = formatDuration(duration);
    UI.$('selectedAverage').textContent = average.toLocaleString('pt-BR', {
      maximumFractionDigits:1
    });
    UI.$('selectedProductionSummary').scrollIntoView({behavior:'smooth', block:'start'});
  }
  function clearFilters(){
    UI.$('productionDateFrom').value = '';
    UI.$('productionDateTo').value = '';
    UI.$('productionUserFilter').value = '';
    UI.$('productionStatusFilter').value = '';
    UI.$('productionNumberFilter').value = '';
    UI.$('selectedProductionSummary').classList.add('hidden');
    applyFilters();
  }
  function render(){
    if(!Permissions.can('manageRequests')) return;
    populateUsers();
    applyFilters();
  }
  function init(){
    UI.$('productionPrev').onclick=()=>{page--;applyFilters();};UI.$('productionNext').onclick=()=>{page++;applyFilters();};
    [
      'productionDateFrom',
      'productionDateTo',
      'productionUserFilter',
      'productionStatusFilter',
      'productionNumberFilter'
    ].forEach(id => {
      UI.$(id)?.addEventListener(id === 'productionNumberFilter' ? 'input' : 'change', ()=>{page=1;applyFilters();});
    });
    UI.$('clearProductionFilters')?.addEventListener('click', clearFilters);
    UI.$('sumSelectedRequests')?.addEventListener('click', sumSelected);
    UI.$('selectAllProductionRequests')?.addEventListener('change', event => {
      document.querySelectorAll('.production-request-check')
        .forEach(input => input.checked = event.target.checked);
    });
    document.addEventListener('view:changed', event => {
      if(event.detail.name === 'requisicoes') render();
    });
  }
  return { init, render };
})();;

const UsersAdmin=(()=>{
  function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'})[c]);}
  function roleOptions(sel){
    const actor=AppState.getUser();
    return Object.entries(AppState.roleMeta)
      .filter(([value])=>value!=='ti'||actor?.role==='ti'||sel==='ti')
      .map(([value,meta])=>`<option value="${value}" ${value===sel?'selected':''}>${esc(meta.label)}</option>`).join('');
  }
  async function refresh(){if(SecurityApi.isServerMode())try{await SecurityApi.loadUsers();}catch(e){UI.toast(e.message||'Falha ao carregar usuários.');}}
  async function render(){
    if(!Permissions.can('manageUsers'))return;
    await refresh();
    const actor=AppState.getUser();
    const list=UI.$('usersList');
    const tiOption=UI.$('newUserRole')?.querySelector('option[value="ti"]');
    if(tiOption){const ok=actor?.role==='ti';tiOption.disabled=!ok;tiOption.textContent=ok?'TI':'TI (somente TI pode criar)';}
    UI.$('usersCountLabel').textContent=`${AppState.users.length} usuário${AppState.users.length===1?'':'s'}`;
    list.innerHTML=AppState.users.map(u=>{
      const protectedTi=u.role==='ti'&&actor?.role!=='ti';
      const protectionTitle=protectedTi?'Somente o TI pode alterar contas TI.':'';
      return `<article class="user-card ${u.active===false?'blocked':''}" data-matricula="${esc(u.matricula)}">
        <div class="user-avatar">${esc(u.nome.charAt(0).toUpperCase())}</div>
        <div class="user-card-info"><strong>${esc(u.nome)}</strong><span>Matrícula: ${esc(u.matricula)}</span><small class="user-role ${u.role}">${esc(AppState.getRoleLabel(u.role))}</small><small class="user-status ${u.active===false?'off':'on'}">${u.active===false?'Bloqueado':'Ativo'}</small>${protectedTi?'<small class="ti-protected-note">🔒 Conta protegida pelo TI</small>':''}</div>
        <div class="user-card-actions">
          <select class="user-role-select" ${protectedTi?'disabled':''} title="${protectionTitle}">${roleOptions(u.role)}</select>
          <button class="btn btn-soft change-user-password" type="button" ${protectedTi?'disabled':''} title="${protectionTitle}">Alterar senha</button>
          <button class="btn btn-light toggle-user-active" type="button" ${protectedTi?'disabled':''} title="${protectionTitle}">${u.active===false?'Desbloquear':'Bloquear'}</button>
          <button class="btn btn-light delete-user" type="button" ${protectedTi?'disabled':''} title="${protectionTitle}">Excluir</button>
        </div>
      </article>`;
    }).join('');
  }
  async function safe(fn){try{return await fn();}catch(e){return{ok:false,message:e.message||'Operação bloqueada.'};}}
  function init(){
    const form=UI.$('createUserForm');if(!form)return;
    form.addEventListener('submit',async e=>{
      e.preventDefault();
      const p={nome:UI.$('newUserName').value,matricula:UI.$('newUserMatricula').value,senha:UI.$('newUserPassword').value,role:UI.$('newUserRole').value};
      if(p.role==='ti'&&AppState.getUser()?.role!=='ti'){UI.toast('Somente TI pode criar outro TI.');return;}
      const r=await safe(()=>SecurityApi.createUser(p));if(!r?.ok){UI.toast(r?.message);return;}
      form.reset();await render();UI.toast('Usuário criado.');
    });
    UI.$('usersList').addEventListener('change',async e=>{
      const card=e.target.closest('.user-card');if(!card||!e.target.matches('.user-role-select'))return;
      const m=card.dataset.matricula,old=AppState.users.find(x=>x.matricula===m)?.role,r=await safe(()=>SecurityApi.changeRole(m,e.target.value));
      if(!r?.ok){e.target.value=old;UI.toast(r?.message);return;}await render();UI.toast('Perfil atualizado.');
    });
    UI.$('usersList').addEventListener('click',async e=>{
      const card=e.target.closest('.user-card');if(!card)return;
      const m=card.dataset.matricula,u=AppState.users.find(x=>x.matricula===m);
      if(!u)return;
      if(u.role==='ti'&&AppState.getUser()?.role!=='ti'){UI.toast('Somente o TI pode alterar contas TI.');return;}
      if(e.target.closest('.change-user-password')){
        const input=await SeleneApi.dialog('Nova senha para '+m,[{name:'senha',label:'Nova senha (12 a 128 caracteres)',type:'password',required:true,max:128}]);if(!input)return;const senha=input.senha;
        const r=await safe(()=>SecurityApi.changePassword(m,senha));UI.toast(r?.ok?'Senha alterada.':r?.message);
      }
      if(e.target.closest('.toggle-user-active')){
        if(!confirm(`${u.active===false?'Desbloquear':'Bloquear'} ${u.nome}?`))return;
        const r=await safe(()=>SecurityApi.setActive(m,u.active===false));await render();UI.toast(r?.ok?(r.user.active?'Usuário desbloqueado.':'Usuário bloqueado.'):r?.message);
      }
      if(e.target.closest('.delete-user')){
        if(!confirm(`Excluir ${u.nome}?`))return;
        const self=AppState.getUser()?.matricula===m;
        if(self&&u.role==='ti'&&!confirm('Excluir sua própria conta TI e encerrar a sessão?'))return;
        const r=await safe(()=>SecurityApi.deleteUser(m));
        if(r?.ok){if(self){await SecurityApi.logout();AppState.clearUser();location.reload();return;}await render();UI.toast('Usuário excluído.');}else UI.toast(r?.message);
      }
    });
    document.addEventListener('view:changed',e=>{if(e.detail.name==='usuarios')render();});
    document.addEventListener('app:users-changed',render);
  }
  return{init,render};
})();

const Audit=(()=>{
  let page=1,version=0;
  function filters(){return {q:UI.$('auditSearchInput').value,user:UI.$('auditUserFilter').value,role:UI.$('auditRoleFilter').value,category:UI.$('auditCategoryFilter').value,event:UI.$('auditEventFilter').value,date_from:UI.$('auditDateFrom').value,date_to:UI.$('auditDateTo').value};}
  async function render(){if(!Permissions.can('audit'))return;const n=++version;try{const r=await SeleneApi.request('/audit-secure?'+new URLSearchParams({page,...filters()}));if(n!==version)return;UI.$('auditCount').textContent=r.events.length+' registros nesta página';UI.$('auditPage').textContent='Página '+page;UI.$('auditPrev').disabled=page<=1;UI.$('auditNext').disabled=!r.hasMore;
    UI.$('auditTableBody').innerHTML=r.events.length?r.events.map(i=>`<tr><td>${new Date(i.time).toLocaleString('pt-BR')}<small class="table-detail">Servidor</small></td><td><span class="audit-category ${escapeHtml(i.category)}">${escapeHtml(i.category)}</span></td><td><b>${escapeHtml(i.action)}</b><small class="table-detail">${escapeHtml(i.details)}</small></td><td>${escapeHtml(i.actorName)}<small class="table-detail">${escapeHtml(i.actorMatricula)} · ${escapeHtml(i.actorRole)}</small></td></tr>`).join(''):'<tr><td colspan="4"><div class="empty">Nenhum registro encontrado.</div></td></tr>';
  }catch(e){UI.toast(e.message);}}
  function init(){UI.$('auditPrev').onclick=()=>{page--;render();};UI.$('auditNext').onclick=()=>{page++;render();};let timer;for(const id of ['auditSearchInput','auditCategoryFilter','auditUserFilter','auditRoleFilter','auditEventFilter','auditDateFrom','auditDateTo'])UI.$(id).addEventListener(id==='auditSearchInput'?'input':'change',()=>{clearTimeout(timer);timer=setTimeout(()=>{page=1;render();},250);});
    UI.$('auditClearFilters').onclick=()=>{for(const id of ['auditSearchInput','auditCategoryFilter','auditUserFilter','auditRoleFilter','auditEventFilter','auditDateFrom','auditDateTo'])UI.$(id).value='';page=1;render();};UI.$('exportAuditCsv').onclick=()=>SeleneApi.download('/reports/audit.csv?'+new URLSearchParams(filters()),'selene-audit.csv').catch(e=>UI.toast(e.message));
    document.addEventListener('view:changed',async e=>{if(e.detail.name!=='auditoria')return;if(Permissions.can('manageUsers')){try{const users=await SecurityApi.loadUsers();const selected=UI.$('auditUserFilter').value;UI.$('auditUserFilter').innerHTML='<option value="">Todos os usuários</option>'+users.map(u=>`<option value="${escapeHtml(u.matricula)}">${escapeHtml(u.nome)}</option>`).join('');UI.$('auditUserFilter').value=selected;}catch{}}render();});}
  return {init,render,filters};
})();

const Dashboard = (() => {
  let timer = null;
  function todayStart(){
    const d = new Date();
    return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();
  }
  function formatMinutes(value){
    const minutes = Math.max(0, Math.round(value || 0));
    if(minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes/60)}h ${minutes%60}min`;
  }
  function lastSevenDays(history){
    const days=[];
    for(let i=6;i>=0;i-=1){
      const date=new Date(); date.setHours(0,0,0,0); date.setDate(date.getDate()-i);
      const next=date.getTime()+86400000;
      const entries=history.filter(item => item.time>=date.getTime() && item.time<next && item.direction);
      days.push({
        label:date.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.',''),
        total:entries.length,
        down:entries.filter(item=>item.direction==='down').length,
        up:entries.filter(item=>item.direction==='up').length
      });
    }
    return days;
  }
  function renderBars(days){
    const max=Math.max(...days.map(day=>day.total),1);
    return days.map(day=>`
      <div class="chart-column" title="${day.total} movimentações">
        <div class="chart-value">${day.total}</div>
        <div class="chart-bars">
          <i class="chart-down height-${Math.round(day.down/max*100)}"></i>
          <i class="chart-up height-${Math.round(day.up/max*100)}"></i>
        </div>
        <span>${escapeHtml(day.label)}</span>
      </div>
    `).join('');
  }
  function render(){
    const data=AppState.getData();
    const history=data.history || [];
    const today=history.filter(item=>item.time>=todayStart() && item.direction);
    const waiting=data.requests.filter(item=>item.status==='waiting');
    const floor=data.requests.filter(item=>item.status==='floor');
    const ready=data.requests.filter(item=>item.status==='ready');
    const activeRequests=data.productionRequests.filter(item=>item.status==='open');
    const waitAvg=waiting.length ? waiting.reduce((sum,item)=>sum+(SeleneApi.now()-item.createdAt)/60000,0)/waiting.length : 0;
    UI.$('dashWaiting').textContent=data.metrics.waiting||0;
    UI.$('dashFloor').textContent=data.metrics.floor||0;
    UI.$('dashReady').textContent=data.metrics.ready||0;
    UI.$('dashToday').textContent=data.metrics.today||0;
    UI.$('dashActiveOperators').textContent=data.metrics.activeOperators||0;
    UI.$('dashAverageWait').textContent=formatMinutes(data.metrics.averageWait||0);
    UI.$('dashboardChart').innerHTML=renderBars(data.metrics.days||[]);
    const current=Operation.getOpenProductionRequest();
    UI.$('dashboardRequestStatus').innerHTML=current ? `
      <div class="request-focus active">
        <span>Requisição atual</span><b>${escapeHtml(current.number)}</b>
        <small>${current.downCount+current.upCount} movimentações · ↓ ${current.downCount} · ↑ ${current.upCount}</small>
      </div>` : `
      <div class="request-focus">
        <span>Requisição atual</span><b>Nenhuma aberta</b>
        <small>Inicie uma requisição para registrar sua produção.</small>
      </div>`;
    const activity=history.slice(0,6);
    UI.$('dashboardActivity').innerHTML=activity.length ? activity.map(item=>`
      <div class="dashboard-activity-item">
        <span class="activity-dot ${item.direction || 'other'}"></span>
        <div><b>${escapeHtml(item.address)}</b><small>${escapeHtml(item.action)} · ${escapeHtml(item.operator)}</small></div>
        <time>${new Date(item.time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time>
      </div>`).join('') : '<div class="empty compact">Nenhuma atividade registrada.</div>';
    const picOverdue=data.requests.filter(item=>item.isPic && item.status==='ready' && SeleneApi.now()-Number(item.loweredAt||item.createdAt)>=10*60000);
    const normalFloorLong=floor.filter(item=>!item.isPic && SeleneApi.now()-Number(item.loweredAt||item.createdAt)>=80*60000);
    const critical=[
      ...picOverdue.map(item=>({address:item.address,text:`EXP-PIC no chão há ${Math.floor((SeleneApi.now()-(item.loweredAt||item.createdAt))/60000)} min · subir agora`,type:'danger'})),
      ...waiting.filter(item=>SeleneApi.now()-item.createdAt>=10*60000).map(item=>({address:item.address,text:`Aguardando há ${Math.floor((SeleneApi.now()-item.createdAt)/60000)} min`,type:'warning'})),
      ...normalFloorLong.map(item=>({address:item.address,text:`No chão há ${Math.floor((SeleneApi.now()-(item.loweredAt||item.createdAt))/60000)} min · próximo da liberação`,type:'warning'}))
    ].slice(0,5);
    UI.$('dashboardAlerts').innerHTML=critical.length ? critical.map(item=>`
      <div class="dashboard-alert ${item.type}"><b>${escapeHtml(item.address)}</b><span>${escapeHtml(item.text)}</span></div>`).join('') : '<div class="dashboard-ok"><b>Operação normal</b><span>Nenhum alerta prioritário.</span></div>';
    if(typeof TabletManager !== 'undefined') TabletManager.renderAdminPanel();
    const role=AppState.getUser()?.role;
    const currentUser=AppState.getUser();
    UI.$('dashboardWelcome').textContent=currentUser?.role==='ti' ? 'Olá, Técnico de Informática' : `Olá, ${currentUser?.nome || 'usuário'}`;
    UI.$('dashboardRoleText').textContent=Permissions.describe(role);
  }
  function init(){
    document.addEventListener('view:changed', event=>{ if(event.detail.name==='painel') render(); });
    document.addEventListener('app:data-changed', ()=>{
      if(UI.$('view-painel')?.classList.contains('active')) render();
    });
    UI.$('dashboardOpenOperation')?.addEventListener('click',()=>UI.openView('operacao'));
    UI.$('dashboardGenerateReport')?.addEventListener('click',()=>Reports.printOperationalReport());
    timer=setInterval(()=>{
      if(AppState.getData().settings?.dashboardAutoRefresh !== false && UI.$('view-painel')?.classList.contains('active')) render();
    },5000);
    render();
  }
  return {init,render};
})();;

const Notifications = (() => {
  let opened = false;
  function iconFor(type){
    return ({success:'✓', warning:'!', danger:'×', info:'i'})[type] || 'i';
  }
  function render(){
    const data = AppState.getData();
    const items = data.notifications || [];
    const unread = items.filter(item => !item.read).length;
    const badge = UI.$('notificationCount');
    const list = UI.$('notificationList');
    if(badge){
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.classList.toggle('hidden', unread === 0);
    }
    if(!list) return;
    list.innerHTML = items.length ? items.slice(0,40).map(item => `
      <button class="notification-item ${item.read ? '' : 'unread'}" data-notification-id="${item.id}" data-link="${item.link || ''}" type="button">
        <span class="notification-icon ${item.type}">${iconFor(item.type)}</span>
        <span class="notification-copy">
          <b>${escapeHtml(item.title)}</b>
          <small>${escapeHtml(item.message)}</small>
          <time>${new Date(item.time).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}</time>
        </span>
      </button>
    `).join('') : '<div class="notification-empty">Nenhuma notificação.</div>';
  }
  function escapeHtml(value=''){
    return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'})[char]);
  }
  function setOpen(value){
    opened = Boolean(value);
    UI.$('notificationPanel')?.classList.toggle('open', opened);
    UI.$('notificationButton')?.setAttribute('aria-expanded', String(opened));
  }
  function push(title){UI.toast(title);}
  function init(){
    UI.$('notificationButton')?.addEventListener('click', event => {
      event.stopPropagation();
      setOpen(!opened);
    });
    UI.$('notificationPanel')?.addEventListener('click', event => event.stopPropagation());
    UI.$('markNotificationsRead')?.addEventListener('click', () => {
      AppState.markAllNotificationsRead();
      render();
    });
    UI.$('clearNotifications')?.addEventListener('click', () => {
      if(confirm('Limpar todas as notificações?')){
        AppState.clearNotifications();
        render();
      }
    });
    UI.$('notificationList')?.addEventListener('click', event => {
      const item = event.target.closest('[data-notification-id]');
      if(!item) return;
      AppState.markNotificationRead(item.dataset.notificationId);
      const link = item.dataset.link;
      if(link){ UI.openView(link); setOpen(false); }
      render();
    });
    document.addEventListener('click', () => setOpen(false));
    document.addEventListener('app:data-changed', render);
    document.addEventListener('app:notification', render);
    render();
  }
  return {init, render, push};
})();;

const SeleneIntegration=(()=>{
  let config={enabled:false};
  const guide='Integração externa aguardando contrato oficial. TI deve informar ambiente de homologação, autenticação, endpoints, parâmetros, estados, EXP-PIC, idempotência e regras de conflito. Nenhuma movimentação externa é aceita sem homologação.';
  async function loadServerConfig(){if(Permissions.can('integration'))config=(await SeleneApi.request('/integration/config')).config;return config;}
  function init(){const el=document.createElement('span');el.id='seleneConnectionBadge';el.className='selene-badge selene-off';el.textContent='Selene externa: não configurada';document.querySelector('.topbar')?.append(el);}
  return {init,loadServerConfig,getSettings:()=>config,saveSettings:async input=>{config=(await SeleneApi.mutate('/integration/config',input,'PUT')).config;return config;},refresh:()=>SeleneApi.mutate('/integration/test'),testConnection:()=>SeleneApi.mutate('/integration/test'),integrationGuide:()=>guide,integrationMap:()=>({architecture:'Navegador → Site Selene → PostgreSQL',external:'Contrato pendente de TI',writeEnabled:false})};
})();
const Reports=(()=>{
  function download(kind,format){const filters=kind==='production'?{q:UI.$('productionNumberFilter').value,user:UI.$('productionUserFilter').value,status:UI.$('productionStatusFilter').value,date_from:UI.$('productionDateFrom').value,date_to:UI.$('productionDateTo').value}:kind==='history'?{q:UI.$('historySearchInput').value}:{q:UI.$('auditSearchInput').value,date_from:UI.$('auditDateFrom').value,date_to:UI.$('auditDateTo').value};return SeleneApi.download(`/reports/${kind}.${format}?`+new URLSearchParams(filters),`selene-${kind}.${format}`).catch(e=>UI.toast(e.message));}
  function init(){UI.$('printOperationalReport')?.addEventListener('click',()=>download('history','pdf'));UI.$('printProductionReport')?.addEventListener('click',()=>download('production','pdf'));}
  return {init,download,printOperationalReport:()=>download('history','pdf')};
})();
const DataTools=(()=>{
  function backup(){UI.toast('Backup e restauração exigem o procedimento administrativo validado. Consulte OPERACAO.md na entrega.');}
  function init(){UI.$('importBackupButton')?.addEventListener('click',backup);UI.$('exportHistoryCsv')?.addEventListener('click',()=>Reports.download('history','csv'));UI.$('exportProductionCsv')?.addEventListener('click',()=>Reports.download('production','csv'));
    for(const [id,value] of Object.entries({environmentMode:'Servidor',storageMode:'PostgreSQL central',integrationMode:'Contrato externo não configurado',centralDataMode:'Atualização pelo servidor'})){if(UI.$(id))UI.$(id).textContent=value;}}
  return {init};
})();
const TechnicalPanel=(()=>{
  async function render(){if(!Permissions.can('technical'))return;try{
    const s=await SecurityApi.getSecurityStatus();await SeleneIntegration.loadServerConfig();const c=SeleneIntegration.getSettings();
    for(const [id,value] of Object.entries({techVersion:s.version,techProtocol:location.protocol,techHost:location.host,techStorage:'PostgreSQL',techSecurityMode:'Servidor',techIntegrationGuide:SeleneIntegration.integrationGuide(),techIntegrationMap:JSON.stringify(SeleneIntegration.integrationMap(),null,2)})){if(UI.$(id))UI.$(id).textContent=value;}
    const rows=[['Banco',s.database],['Usuários',s.counts.users],['Paletes registrados',s.counts.pallets],['Backup automático',s.automaticBackups?'Ativo':'Não configurado'],['Integração externa',s.integrationConfigured?'Configurada':'Não configurada']];
    UI.$('techDiagnostics').innerHTML=rows.map(([a,b])=>`<div><span>${escapeHtml(a)}</span><b>${escapeHtml(b)}</b></div>`).join('');
    UI.$('techSecurityDetails').innerHTML=[['Senhas',s.passwordStorage],['Sessão',s.sessionCookie],['CSRF',s.csrf?'Ativo':'Inativo'],['Auditoria','Append-only / verificação por CLI'],['Cabeçalhos',s.securityHeaders?'Ativos':'Inativos'],['Inatividade',s.sessionIdleMinutes+' minutos']].map(([a,b])=>`<article><span>${escapeHtml(a)}</span><b>${escapeHtml(b)}</b></article>`).join('');
    for(const [id,key] of Object.entries({techApiBase:'serverBase',techCodGrupo:'codGrupo',techCodEmp:'codEmp',techRoutePending:'routePending',techRouteAttendance:'routeAttendance'}))UI.$(id).value=c[key]||'';
    UI.$('techInterval').value=(c.interval||10000)/1000;UI.$('techIntegrationEnabled').checked=!!c.enabled;UI.$('techIntegrationNotes').value=AppState.getData().settings.tiIntegrationNotes||'';
  }catch(e){UI.toast(e.message);}}
  function init(){
    document.addEventListener('view:changed',e=>{if(e.detail.name==='tecnico')render();});UI.$('techRefresh').onclick=render;UI.$('techForceSync').onclick=()=>DataSync.refresh().catch(e=>UI.toast(e.message));
    for(const id of ['techTestConnection','techRefreshSelene'])UI.$(id).onclick=async()=>{try{await SeleneIntegration.testConnection();}catch(e){UI.$('techConnectionResult').textContent=e.message;UI.$('techConnectionResult').className='tech-test-result error';}};
    UI.$('techSaveIntegration').onclick=async()=>{try{await SeleneIntegration.saveSettings({serverBase:UI.$('techApiBase').value,codGrupo:UI.$('techCodGrupo').value,codEmp:UI.$('techCodEmp').value,routePending:UI.$('techRoutePending').value,routeAttendance:UI.$('techRouteAttendance').value,interval:Number(UI.$('techInterval').value)*1000,enabled:UI.$('techIntegrationEnabled').checked});UI.toast('Configuração registrada.');}catch(e){UI.toast(e.message);}};
    UI.$('techSaveNotes').onclick=()=>DataSync.command('/settings/ti-notes',{value:UI.$('techIntegrationNotes').value},'PUT');UI.$('techCopyGuide').onclick=()=>navigator.clipboard.writeText(SeleneIntegration.integrationGuide()).catch(()=>UI.toast('Selecione o roteiro para copiar.'));
    UI.$('techDownloadMap').onclick=()=>UI.toast(SeleneIntegration.integrationGuide());UI.$('techDownloadSnapshot').onclick=()=>Reports.download('history','csv');
  }
  return {init,render};
})();
document.addEventListener('DOMContentLoaded',async()=>{
  TabletManager.init();Auth.init();Operation.init();History.init();ProductionRequests.init();UsersAdmin.init();Reports.init();Audit.init();Dashboard.init();Notifications.init();DataSync.init();DataTools.init();TechnicalPanel.init();SeleneIntegration.init();
  UI.$('menuButton').onclick=UI.openMenu;UI.$('closeMenu').onclick=UI.closeMenu;UI.$('overlay').onclick=UI.closeMenu;
  document.querySelectorAll('.nav-button').forEach(b=>b.onclick=()=>UI.openView(b.dataset.view));
  document.addEventListener('security:expired',()=>{AppState.clear();SeleneApi.clear();location.replace('/empilhadores/');},{once:true});
  UI.$('reauthButton').onclick=()=>SeleneApi.reauth().then(ok=>{if(ok)UI.toast('Identidade confirmada.');}).catch(e=>UI.toast(e.message));
  try{const r=await SecurityApi.init();if(r?.user)await Auth.finishLogin(r.user);else UI.showLogin();}catch(e){UI.showLogin();UI.setLoginError(e.message);}
});
