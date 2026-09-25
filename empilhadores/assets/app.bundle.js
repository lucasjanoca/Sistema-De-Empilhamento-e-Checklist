const AppState = (() => {
  const STORAGE_KEY = 'empilhamento_2_0_state_entrega_v2';
  const SESSION_KEY = 'empilhamento_2_0_user_entrega_v2';
  const TABLET_SESSION_KEY = 'empilhamento_2_0_tablet_entrega_v2';
  const USERS_KEY = 'empilhamento_2_0_users_secure_v2';
  const LEGACY_STATE_KEYS = [];
  const LEGACY_USER_KEYS = [];
  const roleMeta = Object.freeze({
    ti:{label:'TI', short:'TI'},
    encarregado:{label:'Encarregado', short:'ENC'},
    empilhador:{label:'Emp', short:'EMP'}
  });
  const defaultUsers = [
    { matricula:'admin', senhaHash:'cda1b259ca70c7e1a3a7758fa8158a89558feba04e248cc3758bbc4fb2139548', nome:'Técnico de Informática', role:'ti', active:true },
    { matricula:'enc', senhaHash:'d852650787abbcfb0f3cd23103143de6f5122b5ab11c76d74b07494b39b775e1', nome:'Encarregado', role:'encarregado', active:true },
    { matricula:'emp', senhaHash:'b7edb939e180002433f566919b83f3b37422c85942a6211f5ceacb49aecbe844', nome:'Empilhador', role:'empilhador', active:true }
  ];
  async function sha256Hex(value){
    const bytes = new TextEncoder().encode(String(value || ''));
    if(!globalThis.crypto?.subtle) throw new Error('Seu navegador não oferece o recurso de segurança necessário. Use o Google Chrome atualizado.');
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('');
  }
  function parseStored(keys){
    for(const key of keys){
      try{
        const raw = localStorage.getItem(key);
        if(raw) return JSON.parse(raw);
      }catch(error){
        console.warn(`Não foi possível ler ${key}:`, error);
      }
    }
    return null;
  }
  function normalizeUser(user){
    const legacyRole=String(user?.role || '').toLowerCase();
    const migratedRole = legacyRole === 'admin' ? 'ti' : (legacyRole === 'lider' ? 'encarregado' : legacyRole);
    const role = roleMeta[migratedRole] ? migratedRole : 'empilhador';
    return {
      matricula:String(user?.matricula || '').trim(),
      senhaHash:String(user?.senhaHash || ''),
      nome:String(user?.nome || 'Usuário').trim(),
      role,
      active:user?.active !== false,
      createdAt:Number(user?.createdAt || Date.now())
    };
  }
  function loadUsers(){
    const saved = parseStored([USERS_KEY, ...LEGACY_USER_KEYS]);
    const list = Array.isArray(saved) && saved.length ? saved : defaultUsers;
    return list.map(normalizeUser).filter(user => user.matricula);
  }
  const users = loadUsers();
  function dispatch(name, detail={}){
    document.dispatchEvent(new CustomEvent(name, {detail}));
  }
  function saveUsers(options={}){
    try{ localStorage.setItem(USERS_KEY, JSON.stringify(users)); }catch{}
    if(!options.silent){
      touch();
      dispatch('app:users-changed');
      dispatch('app:state-saved', {source:'users'});
    }
  }
  function replaceUsers(list,options={}){
    if(!Array.isArray(list)) return;
    users.splice(0,users.length,...list.map(normalizeUser));
    if(!options.silent) dispatch('app:users-changed');
  }
  async function addUser(user){
    const matricula = String(user.matricula || '').trim();
    const nome = String(user.nome || '').trim();
    const senha = String(user.senha || '');
    const role = roleMeta[user.role] ? user.role : 'empilhador';
    if(!matricula || !nome || !senha){
      return {ok:false, message:'Preencha nome, matrícula e senha.'};
    }
    if(senha.length < 8){
      return {ok:false, message:'A senha precisa ter pelo menos 8 caracteres.'};
    }
    if(users.some(item => item.matricula.toLowerCase() === matricula.toLowerCase())){
      return {ok:false, message:'Já existe um usuário com essa matrícula.'};
    }
    const senhaHash = await sha256Hex(senha);
    users.push(normalizeUser({matricula, nome, senhaHash, role, active:true, createdAt:Date.now()}));
    saveUsers();
    return {ok:true};
  }
  async function updateUserPassword(matricula, senha, actor=currentUser){
    const user = users.find(item => item.matricula.toLowerCase() === String(matricula).toLowerCase());
    if(!user) return {ok:false, message:'Usuário não encontrado.'};
    if(user.role === 'ti' && actor?.role !== 'ti') return {ok:false, message:'Somente o TI pode alterar a senha de uma conta TI.'};
    if(String(senha || '').length < 8) return {ok:false, message:'A senha precisa ter pelo menos 8 caracteres.'};
    user.senhaHash = await sha256Hex(senha);
    saveUsers();
    return {ok:true};
  }
  async function verifyLocalPassword(matricula, senha){
    const candidate = users.find(item => item.active!==false && item.matricula.toLowerCase() === String(matricula || '').trim().toLowerCase());
    if(!candidate?.senhaHash) return null;
    const informedHash = await sha256Hex(senha);
    return informedHash === candidate.senhaHash ? candidate : null;
  }
  function updateUserRole(matricula, role, actor=currentUser){
    const user = users.find(item => item.matricula.toLowerCase() === String(matricula).toLowerCase());
    if(!user) return {ok:false, message:'Usuário não encontrado.'};
    if(!roleMeta[role]) return {ok:false, message:'Tipo de acesso inválido.'};
    if(user.role === 'ti' && actor?.role !== 'ti') return {ok:false, message:'Somente o TI pode alterar uma conta TI.'};
    if(role === 'ti' && actor?.role !== 'ti'){
      return {ok:false, message:'Somente o TI pode criar ou alterar acessos de TI.'};
    }
    user.role = role;
    saveUsers();
    return {ok:true};
  }
  function toggleUserActive(matricula, actor=currentUser){
    const user = users.find(item => item.matricula.toLowerCase() === String(matricula).toLowerCase());
    if(!user) return {ok:false, message:'Usuário não encontrado.'};
    if(user.role === 'ti' && actor?.role !== 'ti'){
      return {ok:false, message:'Somente o TI pode bloquear ou desbloquear uma conta TI.'};
    }
    user.active = !user.active;
    saveUsers();
    return {ok:true, active:user.active};
  }
  function removeUser(matricula, actor=currentUser){
    const index = users.findIndex(item => item.matricula.toLowerCase() === String(matricula).toLowerCase());
    if(index < 0) return {ok:false, message:'Usuário não encontrado.'};
    const target=users[index];
    if(target.role === 'ti' && actor?.role !== 'ti') return {ok:false, message:'Somente o TI pode excluir uma conta TI.'};
    if(target.role === 'ti'){
      const activeTi=users.filter(item=>item.role==='ti' && item.active!==false);
      if(activeTi.length <= 1 && target.active !== false) return {ok:false, message:'Crie outra conta TI antes de excluir a última conta TI ativa.'};
    }
    users.splice(index, 1);
    saveUsers();
    return {ok:true, deletedSelf:actor?.matricula === target.matricula};
  }
  const corridors = [
    '1-2','3-4','5-6','7-8','9-10','11-12','13-14','15-16',
    '17-18','19-20','21-22','23-24','25-26','27-28','29-30',
    'A-B','C-D','E-F','G-H','I-J','K-L','M-N','O-P','Q-R','S-T',
    'U-V','W-X','Y-Z','RECEB','OUTROS'
  ];
  const defaultDevices = [
    ...Array.from({length:12}, (_,index)=>({id:`tablet-${String(index+1).padStart(2,'0')}`, name:`Tablet ${String(index+1).padStart(2,'0')}`, active:true, createdAt:Date.now(),type:'tablet'})),
    {id:'computer-encarregado',name:'Computador Encarregado',active:true,createdAt:Date.now(),type:'system',locked:true},
    {id:'computer-ti',name:'Computador TI',active:true,createdAt:Date.now(),type:'system',locked:true}
  ];
  const initialState = () => ({
    version:'2.0',
    meta:{updatedAt:Date.now(), createdAt:Date.now()},
    selectedCorridors:['1-2','3-4','19-20','21-22','RECEB'],
    nextId:5,
    requests:[
      {id:1,address:'01-001-1',operator:'Operador 01',status:'waiting',corridor:'1-2',createdAt:Date.now()-180000},
      {id:2,address:'03-003-1',operator:'Operador 02',status:'waiting',corridor:'3-4',createdAt:Date.now()-240000,isPic:true,sourceType:'PIC'},
      {id:3,address:'19-001-1',operator:'Operador 03',status:'floor',corridor:'19-20',createdAt:Date.now()-900000,loweredAt:Date.now()-900000},
      {id:4,address:'21-001-1',operator:'Operador 01',status:'ready',corridor:'21-22',createdAt:Date.now()-(100*60*1000),loweredAt:Date.now()-(100*60*1000),unlockedAt:Date.now()-(10*60*1000)}
    ],
    history:[],
    productionRequests:[],
    nextProductionRequestId:1,
    auditLog:[],
    notifications:[],
    nextNotificationId:1,
    tabletAssignments:[],
    registeredDevices:defaultDevices.map(device=>({...device})),
    settings:{
      notificationsEnabled:true,
      soundEnabled:false,
      centralSyncEnabled:true,
      dashboardAutoRefresh:true,
      tiIntegrationNotes:''
    }
  });
  function normalizeData(saved){
    const base = initialState();
    const normalized = Object.assign(base, saved || {});
    normalized.version = '2.0';
    normalized.meta = Object.assign(base.meta, saved?.meta || {});
    normalized.productionRequests = Array.isArray(saved?.productionRequests) ? saved.productionRequests : base.productionRequests;
    normalized.nextProductionRequestId = Number(saved?.nextProductionRequestId || 1);
    normalized.requests = Array.isArray(saved?.requests) ? saved.requests : base.requests;
    normalized.history = Array.isArray(saved?.history) ? saved.history : base.history;
    normalized.auditLog = Array.isArray(saved?.auditLog) ? saved.auditLog : base.auditLog;
    normalized.notifications = Array.isArray(saved?.notifications) ? saved.notifications : base.notifications;
    normalized.nextNotificationId = Number(saved?.nextNotificationId || 1);
    normalized.tabletAssignments = Array.isArray(saved?.tabletAssignments) ? saved.tabletAssignments : base.tabletAssignments;
    normalized.registeredDevices = Array.isArray(saved?.registeredDevices) && saved.registeredDevices.length
      ? saved.registeredDevices.map(device=>({id:String(device.id || '').trim() || `device-${Date.now()}-${Math.random()}`,name:String(device.name || '').trim(),active:device.active !== false,createdAt:Number(device.createdAt || Date.now()),type:device.type || 'tablet',locked:Boolean(device.locked)})).filter(device=>device.name)
      : base.registeredDevices.map(device=>({...device}));
    base.registeredDevices.filter(device=>device.locked).forEach(systemDevice=>{
      const existing=normalized.registeredDevices.find(device=>String(device.name).toLowerCase()===systemDevice.name.toLowerCase());
      if(existing){ existing.id=systemDevice.id; existing.type='system'; existing.locked=true; existing.active=true; }
      else normalized.registeredDevices.push({...systemDevice});
    });
    normalized.tabletAssignments.forEach(item=>{
      const name=String(item.tabletName || '').trim();
      if(name && !normalized.registeredDevices.some(device=>device.name.toLowerCase()===name.toLowerCase())){
        normalized.registeredDevices.push({id:`legacy-${name.toLowerCase().replace(/[^a-z0-9]+/gi,'-')}`,name,active:true,createdAt:Number(item.createdAt || Date.now())});
      }
    });
    normalized.settings = Object.assign(base.settings, saved?.settings || {});
    normalized.selectedCorridors = Array.isArray(saved?.selectedCorridors) ? saved.selectedCorridors : base.selectedCorridors;
    normalized.selectedCorridors = normalized.selectedCorridors.map(value => String(value).toUpperCase()).filter((value,index,array)=>array.indexOf(value)===index);
    if(!normalized.selectedCorridors.includes('RECEB')) normalized.selectedCorridors.push('RECEB');
    normalized.requests.forEach(request => {
      if(['floor','ready'].includes(request.status) && !request.loweredAt){
        request.loweredAt = Number(request.createdAt || Date.now());
      }
      if(request.isPic && request.status === 'floor' && !request.external){
        request.status = 'ready';
        request.unlockedAt = Number(request.loweredAt || Date.now());
      }
      if(request.status === 'ready' && !request.isPic && !request.external && request.loweredAt && Date.now() - Number(request.loweredAt) < 90 * 60 * 1000){
        request.status = 'floor';
        delete request.unlockedAt;
      }
    });
    return normalized;
  }
  function load(){
    const saved = parseStored([STORAGE_KEY, ...LEGACY_STATE_KEYS]);
    return normalizeData(saved);
  }
  let data = load();
  let currentUser = loadSession();
  let currentTablet = loadTabletSession();
  function touch(){
    data.meta = data.meta || {};
    data.meta.updatedAt = Date.now();
  }
  function save(options={}){
    if(!options.preserveTimestamp) touch();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if(!options.silent){
      dispatch('app:data-changed', {source:options.source || 'local'});
      dispatch('app:state-saved', {source:options.source || 'local'});
    }
  }
  function reset(){
    data = initialState();
    save();
  }
  function loadSession(){
    try{
      const user = JSON.parse(sessionStorage.getItem(SESSION_KEY));
      return user && user.matricula ? user : null;
    }catch{
      return null;
    }
  }
  function setUser(user){
    currentUser = user;
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));
  }
  function loadTabletSession(){
    try{
      const tablet = JSON.parse(sessionStorage.getItem(TABLET_SESSION_KEY));
      return tablet && tablet.id ? tablet : null;
    }catch{
      return null;
    }
  }
  function setTablet(tablet){
    currentTablet = tablet;
    if(tablet) sessionStorage.setItem(TABLET_SESSION_KEY, JSON.stringify(tablet));
    else sessionStorage.removeItem(TABLET_SESSION_KEY);
  }
  function clearTablet(){
    currentTablet = null;
    sessionStorage.removeItem(TABLET_SESSION_KEY);
  }
  function clearUser(){
    currentUser = null;
    sessionStorage.removeItem(SESSION_KEY);
  }
  function addAudit(action, details='', options={}){
    const actor = options.actor || currentUser || {nome:'Sistema', matricula:'sistema', role:'sistema'};
    const entry = {
      id:Date.now() + Math.random(),
      time:Date.now(),
      action:String(action || 'Ação'),
      details:String(details || ''),
      category:String(options.category || 'sistema'),
      actorName:actor.nome || 'Sistema',
      actorMatricula:actor.matricula || 'sistema',
      actorRole:actor.role || 'sistema',
      severity:options.severity || 'info'
    };
    data.auditLog.unshift(entry);
    data.auditLog = data.auditLog.slice(0, 3000);
    if(options.save !== false) save({source:'audit'});
    if(options.secure !== false && typeof SecurityApi !== 'undefined') SecurityApi.recordAudit(entry);
    return entry;
  }
  function addNotification(title, message='', options={}){
    if(data.settings?.notificationsEnabled === false && !options.force) return null;
    const notification = {
      id:data.nextNotificationId++,
      title:String(title || 'Notificação'),
      message:String(message || ''),
      type:options.type || 'info',
      time:Date.now(),
      read:false,
      link:options.link || ''
    };
    data.notifications.unshift(notification);
    data.notifications = data.notifications.slice(0, 150);
    if(options.save !== false) save({source:'notification'});
    dispatch('app:notification', {notification});
    return notification;
  }
  function markNotificationRead(id){
    const item = data.notifications.find(notification => notification.id === Number(id));
    if(item && !item.read){
      item.read = true;
      save({source:'notification'});
    }
  }
  function markAllNotificationsRead(){
    let changed = false;
    data.notifications.forEach(item => {
      if(!item.read){ item.read = true; changed = true; }
    });
    if(changed) save({source:'notification'});
  }
  function clearNotifications(){
    data.notifications = [];
    save({source:'notification'});
  }
  function exportSnapshot(){
    return {
      version:'2.0',
      exportedAt:Date.now(),
      updatedAt:Number(data.meta?.updatedAt || Date.now()),
      data:JSON.parse(JSON.stringify(data)),
      users:JSON.parse(JSON.stringify(users))
    };
  }
  function exportOperationalSnapshot(){
    return {version:'2.0',exportedAt:Date.now(),updatedAt:Number(data.meta?.updatedAt||Date.now()),data:JSON.parse(JSON.stringify(data))};
  }
  function importSnapshot(snapshot, options={}){
    if(!snapshot || typeof snapshot !== 'object' || !snapshot.data){
      return {ok:false,message:'Arquivo de dados inválido.'};
    }
    data = normalizeData(snapshot.data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    if(!options.silent){
      dispatch('app:data-changed', {source:options.source || 'import'});
      dispatch('app:users-changed');
      if(!options.skipSync) dispatch('app:state-saved', {source:options.source || 'import'});
    }
    return {ok:true};
  }
  function getData(){ return data; }
  function getUser(){ return currentUser; }
  function getTablet(){ return currentTablet; }
  function getRoleLabel(role){ return roleMeta[role]?.label || role || 'Usuário'; }
  return {
    users,
    corridors,
    roleMeta,
    getData,
    getUser,
    getTablet,
    getRoleLabel,
    setUser,
    setTablet,
    clearTablet,
    clearUser,
    save,
    reset,
    saveUsers,
    replaceUsers,
    addUser,
    updateUserPassword,
    verifyLocalPassword,
    updateUserRole,
    toggleUserActive,
    removeUser,
    addAudit,
    addNotification,
    markNotificationRead,
    markAllNotificationsRead,
    clearNotifications,
    exportSnapshot,
    exportOperationalSnapshot,
    importSnapshot
  };
})();;
const SecurityApi=(()=>{const BASE='/api/site-selene';let available=false,csrf=sessionStorage.getItem('site_selene_csrf')||'',sessionUser=null;async function raw(path='',options={}){const headers={Accept:'application/json',...(options.headers||{})};if(options.body!==undefined&&!headers['Content-Type'])headers['Content-Type']='application/json';if(csrf&&!['GET','HEAD'].includes(String(options.method||'GET').toUpperCase()))headers['X-CSRF-Token']=csrf;const r=await fetch(`${BASE}${path}`,{cache:'no-store',credentials:'same-origin',...options,headers});let p=null;try{p=await r.json();}catch{}if(r.status===401){const had=!!sessionUser;sessionUser=null;csrf='';sessionStorage.removeItem('site_selene_csrf');if(had)document.dispatchEvent(new CustomEvent('security:expired'));}if(!r.ok){const e=new Error(p?.message||`HTTP ${r.status}`);e.status=r.status;e.payload=p;throw e;}return p;}async function init(){if(location.protocol==='file:'){available=false;return;}try{available=!!(await raw('/status'))?.ok;}catch{available=false;return;}try{const me=await raw('/auth/me');sessionUser=me.user;csrf=me.csrfToken||'';if(csrf)sessionStorage.setItem('site_selene_csrf',csrf);}catch(e){if(e.status!==401)console.warn(e);}}async function login(matricula,senha){const r=await raw('/auth/login',{method:'POST',body:JSON.stringify({matricula,senha})});sessionUser=r.user;csrf=r.csrfToken||'';sessionStorage.setItem('site_selene_csrf',csrf);document.dispatchEvent(new CustomEvent('security:login',{detail:{user:sessionUser}}));return r;}async function logout(){if(available)try{await raw('/auth/logout',{method:'POST',body:'{}'});}catch{}sessionUser=null;csrf='';sessionStorage.removeItem('site_selene_csrf');}function server(){return location.protocol!=='file:'&&available;}async function loadUsers(){if(!server())return AppState.users;const r=await raw('/users');AppState.replaceUsers?.(r.users||[],{silent:true,serverPublic:true});return r.users||[];}async function createUser(p){if(!server())return AppState.addUser(p);const r=await raw('/users',{method:'POST',body:JSON.stringify(p)});await loadUsers();return {ok:true,user:r.user};}async function changePassword(m,s){if(!server())return AppState.updateUserPassword(m,s);await raw(`/users/${encodeURIComponent(m)}`,{method:'PATCH',body:JSON.stringify({action:'password',senha:s})});await loadUsers();return {ok:true};}async function changeRole(m,role){if(!server())return AppState.updateUserRole(m,role);await raw(`/users/${encodeURIComponent(m)}`,{method:'PATCH',body:JSON.stringify({action:'role',role})});await loadUsers();return {ok:true};}async function setActive(m,a){if(!server()){const u=AppState.users.find(x=>x.matricula===m);if(!u)return {ok:false,message:'Usuário não encontrado.'};if(u.active!==a)return AppState.toggleUserActive(m);return {ok:true,active:a};}const r=await raw(`/users/${encodeURIComponent(m)}`,{method:'PATCH',body:JSON.stringify({action:'active',active:a})});await loadUsers();return {ok:true,active:r.user?.active};}async function deleteUser(m){if(!server())return AppState.removeUser(m);const r=await raw(`/users/${encodeURIComponent(m)}`,{method:'DELETE',body:'{}'});await loadUsers();return r;}async function recordAudit(e){if(!server()||!sessionUser)return;try{await raw('/audit-secure',{method:'POST',body:JSON.stringify({action:e.action,details:e.details,category:e.category,severity:e.severity})});}catch{}}async function getSecureAudit(){if(!server())return[];return (await raw('/audit-secure?limit=3000')).events||[];}async function getSecurityStatus(){if(!server())return{mode:'arquivo/demo',passwordStorage:'Local somente para demonstração',csrf:false,secureAudit:false,securityHeaders:false};return raw('/security/status');}async function acquirePalletLock(req,direction){if(!server())return{ok:true,local:true};return raw('/locks/acquire',{method:'POST',body:JSON.stringify({palletId:req.id,address:req.address,direction})});}async function releasePalletLock(req){if(!server())return{ok:true};try{return await raw('/locks/release',{method:'POST',body:JSON.stringify({palletId:req.id,address:req.address})});}catch{return{ok:false};}}async function getIntegrationConfig(){if(!server())return null;return (await raw('/integration/config')).config||null;}async function saveIntegrationConfig(c){if(!server())return null;return (await raw('/integration/config',{method:'PUT',body:JSON.stringify(c)})).config||null;}async function integrationRead(route){if(!server())return null;return (await raw(`/integration/read?route=${encodeURIComponent(route)}`)).data;}return{init,login,logout,isServerMode:server,isAvailable:()=>available,getSessionUser:()=>sessionUser,loadUsers,createUser,changePassword,changeRole,setActive,deleteUser,recordAudit,getSecureAudit,getSecurityStatus,acquirePalletLock,releasePalletLock,getIntegrationConfig,saveIntegrationConfig,integrationRead,secureFetch:raw};})();;
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
    return Boolean(item?.active && Date.now()-Number(item.lastSeen||0) < ACTIVE_WINDOW_MS);
  }
  function deviceId(name){
    return normalizeName(name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || `device-${Date.now()}`;
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
    datalist.innerHTML=selectableDevices().map(device=>`<option value="${device.name}"></option>`).join('');
  }
  function addDevice(name){
    const user=AppState.getUser();
    if(!['encarregado','ti'].includes(user?.role)){
      UI.toast('Somente Encarregado ou TI pode cadastrar dispositivos.');
      return false;
    }
    const deviceName=normalizeName(name);
    if(!deviceName){ UI.toast('Informe o nome do dispositivo.'); return false; }
    const data=AppState.getData();
    if((data.registeredDevices || []).some(item=>String(item.name||'').toLowerCase()===deviceName.toLowerCase())){
      UI.toast('Esse dispositivo já está cadastrado.');
      return false;
    }
    data.registeredDevices = data.registeredDevices || [];
    data.registeredDevices.push({id:deviceId(deviceName),name:deviceName,active:true,createdAt:Date.now(),type:'tablet',locked:false});
    AppState.addAudit('Dispositivo cadastrado', `${deviceName} foi adicionado à lista de equipamentos.`,{category:'sistema',save:false});
    AppState.save({source:'devices'});
    renderDeviceOptions();
    renderDeviceAdmin();
    UI.toast(`${deviceName} cadastrado.`);
    return true;
  }
  function removeDevice(id){
    const user=AppState.getUser();
    if(!['encarregado','ti'].includes(user?.role)){
      UI.toast('Somente Encarregado ou TI pode remover dispositivos.');
      return false;
    }
    const data=AppState.getData();
    const device=(data.registeredDevices || []).find(item=>String(item.id)===String(id));
    if(!device) return false;
    if(device.locked || device.type === 'system'){
      UI.toast(`${device.name} é um dispositivo automático do sistema e não pode ser removido.`);
      return false;
    }
    const assignment=assignmentFor(device.name);
    if(assignment && isActive(assignment)){
      UI.toast(`${device.name} está em uso por ${assignment.userName || assignment.userMatricula}.`);
      return false;
    }
    data.registeredDevices=data.registeredDevices.filter(item=>String(item.id)!==String(id));
    AppState.addAudit('Dispositivo removido', `${device.name} foi removido da lista de equipamentos.`,{category:'sistema',save:false});
    AppState.save({source:'devices'});
    renderDeviceOptions();
    renderDeviceAdmin();
    UI.toast(`${device.name} removido.`);
    return true;
  }
  function automaticDeviceForRole(role){
    if(role === 'encarregado') return 'Computador Encarregado';
    if(role === 'ti') return 'Computador TI';
    return '';
  }
  function ensureSystemDevice(name){
    if(!name) return null;
    const data=AppState.getData();
    let device=deviceFor(name);
    if(!device){
      device={id:deviceId(name),name,active:true,createdAt:Date.now(),type:'system',locked:true};
      data.registeredDevices=data.registeredDevices || [];
      data.registeredDevices.push(device);
      AppState.save({source:'devices'});
    }
    device.type='system'; device.locked=true; device.active=true;
    return device;
  }
  function select(name, options={}){
    const user=AppState.getUser();
    if(!user) return false;
    const tabletName=normalizeName(name);
    if(!tabletName){ UI.toast('Selecione o tablet ou equipamento.'); return false; }
    const device=options.automatic ? ensureSystemDevice(tabletName) : deviceFor(tabletName);
    if(!device || device.active === false){
      UI.toast('Dispositivo não cadastrado. Peça ao Encarregado ou TI para adicioná-lo em Configurações.');
      return false;
    }
    if(!canUseDevice(user,device)){
      UI.toast('Para o perfil Emp, somente tablets cadastrados podem ser selecionados.');
      return false;
    }
    const data=AppState.getData();
    const previous=AppState.getTablet();
    const existing=assignmentFor(device.name);
    const now=Date.now();
    if(previous?.name && previous.name.toLowerCase()!==device.name.toLowerCase()){
      const old=assignmentFor(previous.name);
      if(old && old.userMatricula===user.matricula){ old.active=false; old.lastSeen=now; old.endedAt=now; }
    }
    let entry=existing;
    if(!entry){
      entry={id:Date.now()+Math.random(),tabletName:device.name,createdAt:now};
      data.tabletAssignments.unshift(entry);
    }
    const replaced = entry.userMatricula && entry.userMatricula!==user.matricula ? `${entry.userName || entry.userMatricula}` : '';
    entry.tabletName=device.name;
    entry.deviceId=device.id;
    entry.userMatricula=user.matricula;
    entry.userName=user.nome;
    entry.userRole=user.role;
    entry.loginAt=now;
    entry.lastSeen=now;
    entry.active=true;
    entry.endedAt=null;
    data.productionRequests.filter(item=>item.userMatricula===user.matricula && item.status==='open').forEach(item=>{ item.tabletName=device.name; });
    AppState.setTablet({id:device.id,name:device.name,selectedAt:now});
    AppState.addAudit(previous?.name && previous.name!==device.name ? 'Tablet alterado' : 'Tablet selecionado', `${user.nome} → ${device.name}${replaced ? ` (substituiu ${replaced})` : ''}.`,{category:'acesso',save:false});
    AppState.save({source:'tablet'});
    updateBadge();
    renderAdminPanel();
    if(!options.silent) UI.toast(`${device.name} vinculado a ${user.nome}.`);
    return true;
  }
  function releaseCurrent(reason='troca'){
    const user=AppState.getUser();
    const tablet=AppState.getTablet();
    if(!user || !tablet?.name) return;
    const entry=assignmentFor(tablet.name);
    if(entry && entry.userMatricula===user.matricula){
      entry.active=false; entry.lastSeen=Date.now(); entry.endedAt=Date.now();
      AppState.save({source:'tablet'});
    }
  }
  function heartbeat(){
    const user=AppState.getUser();
    const tablet=AppState.getTablet();
    if(!user || !tablet?.name) return;
    const currentDevice=deviceFor(tablet.name);
    if(!currentDevice || !canUseDevice(user,currentDevice)){
      AppState.clearTablet();
      updateBadge();
      UI.toast(user.role==='empilhador' ? 'Selecione um tablet cadastrado para continuar.' : `${tablet.name} não está mais cadastrado. Selecione outro equipamento.`);
      openSelector({force:true});
      return;
    }
    const entry=assignmentFor(tablet.name);
    if(entry && entry.userMatricula!==user.matricula){
      AppState.clearTablet();
      updateBadge();
      UI.toast(`${tablet.name} foi assumido por outro usuário. Selecione seu equipamento atual.`);
      openSelector({force:true});
      return;
    }
    if(!entry) return;
    entry.active=true;
    entry.lastSeen=Date.now();
    AppState.save({source:'tablet-heartbeat'});
    updateBadge();
  }
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
    UI.$('tabletCancelButton')?.classList.toggle('hidden',forceSelection || !current?.name);
    const warning=UI.$('tabletCurrentWarning');
    if(warning){
      warning.textContent=automatic ? `Equipamento padrão do perfil: ${automatic}. Você pode manter ou selecionar outro dispositivo cadastrado.` : '';
      warning.classList.toggle('hidden',!automatic);
    }
    if(!dialog.open) dialog.showModal();
    setTimeout(()=>input.focus(),50);
  }
  function ensureSelected(options={}){
    const user=AppState.getUser();
    if(!user) return;
    const current=AppState.getTablet();
    const automatic=automaticDeviceForRole(user.role);
    if(automatic){
      if(current?.name && deviceFor(current.name)) heartbeat();
      else select(automatic,{automatic:true,silent:true});
      updateBadge();
      return;
    }
    updateBadge();
    const currentDevice=current?.name ? deviceFor(current.name) : null;
    if(options.force || !current?.name || !currentDevice || !canUseDevice(user,currentDevice)){
      if(current?.name && (!currentDevice || !canUseDevice(user,currentDevice))) AppState.clearTablet();
      openSelector({force:true});
    }else heartbeat();
  }
  function formatAgo(time){
    const diff=Math.max(0,Date.now()-Number(time||Date.now()));
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
        <div class="tablet-device-head"><b>▣ ${item.tabletName}</b><span class="tablet-status ${active?'online':'last'}">${active?'Em uso':item.lastSeen?'Último uso':'Disponível'}</span></div>
        <div class="tablet-device-user"><strong>${item.userName || 'Sem usuário registrado'}</strong><small>${item.userMatricula ? `${item.userMatricula} · ${AppState.getRoleLabel(item.userRole)} · ${formatAgo(item.lastSeen)}` : 'Nenhum uso registrado'}</small></div>
        ${pallets.length ? `<div class="tablet-pallets">${pallets.map(p=>`<span class="tablet-pallet-chip ${p.isPic?'pic':''}">${p.address} · ${p.status==='floor'?'no chão':p.status==='ready'?'liberado':'movendo'}</span>`).join('')}</div>` : '<div class="tablet-empty">Nenhum palet associado no momento.</div>'}
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
        <div><b>▣ ${device.name}</b><small>${active ? `Em uso por ${assignment.userName || assignment.userMatricula}` : assignment?.lastSeen ? `Último uso ${formatAgo(assignment.lastSeen)}` : 'Ainda não utilizado'}</small></div>
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
        warning.textContent=`Atenção: ${existing.tabletName} foi usado por último por ${existing.userName || existing.userMatricula} (${formatAgo(existing.lastSeen)}). Ao confirmar, o equipamento será vinculado ao usuário atual.`;
        warning.classList.remove('hidden');
      }else warning.classList.add('hidden');
    });
    UI.$('tabletForm')?.addEventListener('submit',event=>{
      event.preventDefault();
      if(select(UI.$('tabletNameInput').value)){
        forceSelection=false;
        UI.$('tabletDialog').close();
      }
    });
    UI.$('tabletDialog')?.addEventListener('cancel',event=>{
      if(forceSelection || !AppState.getTablet()?.name) event.preventDefault();
    });
    UI.$('deviceAdminForm')?.addEventListener('submit',event=>{
      event.preventDefault();
      const input=UI.$('deviceAdminName');
      if(addDevice(input?.value || '')){
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
const Permissions = (() => {
  const matrix = Object.freeze({
    ti:['dashboard','operate','requestPallet','manageRequests','manageUsers','history','indicators','reports','audit','settings','integration','devices','technical'],
    encarregado:['dashboard','operate','requestPallet','manageRequests','manageUsers','history','indicators','reports','audit','settings','devices'],
    empilhador:['dashboard','operate','requestPallet','history','indicators']
  });
  function can(permission, user=AppState.getUser()){
    if(!user) return false;
    return (matrix[user.role] || matrix.empilhador).includes(permission);
  }
  function apply(user=AppState.getUser()){
    document.querySelectorAll('[data-permission]').forEach(element => {
      const required = element.dataset.permission.split(',').map(item => item.trim()).filter(Boolean);
      const allowed = required.some(permission => can(permission, user));
      element.classList.toggle('permission-hidden', !allowed);
      element.setAttribute('aria-hidden', allowed ? 'false' : 'true');
    });
    document.querySelectorAll('[data-roles]').forEach(element => {
      const roles = element.dataset.roles.split(',').map(item => item.trim());
      element.classList.toggle('permission-hidden', !roles.includes(user?.role));
    });
  }
  function describe(role){
    const labels = {
      ti:'Acesso técnico total: operação, usuários, auditoria, integração, diagnósticos e segurança.',
      encarregado:'Acesso completo às áreas operacionais, usuários, relatórios, auditoria e dispositivos.',
      empilhador:'Acesso operacional: movimentação de paletes, requisições e consultas permitidas.'
    };
    return labels[role] || labels.empilhador;
  }
  return {can, apply, describe, matrix};
})();;
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
    const requestedButton=document.querySelector(`.nav-button[data-view="${name}"]`);
    if(requestedButton?.classList.contains('permission-hidden')){
      toast('Seu perfil não possui acesso a essa área.');
      name=firstAllowedView();
    }
    const target=document.getElementById(`view-${name}`);
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
  function push(title, message='', options={}){
    const item = AppState.addNotification(title, message, options);
    render();
    if(item && options.toast !== false) UI.toast(title);
    return item;
  }
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
const Auth=(()=>{async function login(m,s){if(SecurityApi.isServerMode()){const r=await SecurityApi.login(m,s);if(['encarregado','ti'].includes(r.user?.role))try{await SecurityApi.loadUsers();}catch{}return r.user;}const user=await AppState.verifyLocalPassword(m,s);if(!user){const blocked=AppState.users.find(u=>String(u.matricula).toLowerCase()===String(m).trim().toLowerCase()&&u.active===false);AppState.addAudit(blocked?'Login bloqueado':'Login negado',blocked?'Tentativa de acesso com usuário bloqueado.':'Matrícula ou senha não conferiu.',{category:'acesso',severity:'warning',actor:{nome:blocked?.nome||'Tentativa de login',matricula:m||'não informada',role:blocked?.role||'sistema'}});throw new Error(blocked?'Este usuário está bloqueado. Procure o Encarregado ou TI.':'Senha ou matrícula incorreta.');}return user;}function finish(user){const safe={matricula:user.matricula,nome:user.nome,role:user.role};AppState.setUser(safe);if(!SecurityApi.isServerMode())AppState.addAudit('Login realizado',`Acesso pelo perfil ${AppState.getRoleLabel(safe.role)}.`,{category:'acesso'});UI.showSystem(safe);Operation.renderAll();Dashboard.render();TabletManager.ensureSelected({force:true});Notifications.push('Acesso realizado',`Bem-vindo, ${safe.nome}.`,{type:'success',toast:false,link:'painel'});UI.toast(`Bem-vindo, ${safe.nome}.`);DataSync.reconnect?.();}function init(){const form=UI.$('loginForm');form.addEventListener('submit',async e=>{e.preventDefault();UI.setLoginError('');const m=UI.$('loginMatricula').value.trim(),s=UI.$('loginSenha').value;if(!m||!s){UI.setLoginError('Preencha a matrícula e a senha.');return;}const b=form.querySelector('button[type="submit"]');if(b)b.disabled=true;try{const u=await login(m,s);if(!u){UI.setLoginError('Senha ou matrícula incorreta.');return;}finish(u);}catch(err){UI.setLoginError(err.message||'Não foi possível entrar.');}finally{if(b)b.disabled=false;}});UI.$('togglePassword').addEventListener('click',()=>{const i=UI.$('loginSenha'),show=i.type==='text';i.type=show?'password':'text';UI.$('togglePassword').textContent=show?'👁':'🙈';});UI.$('logoutButton').addEventListener('click',async()=>{TabletManager.releaseCurrent('logout');if(!SecurityApi.isServerMode())AppState.addAudit('Logout realizado','Sessão encerrada.',{category:'acesso'});await SecurityApi.logout();AppState.clearUser();AppState.clearTablet();location.reload();});}return{init,finishLogin:finish};})();;
const Operation = (() => {
  const timers = new Map();
  let elapsedRefreshTimer = null;
  const FLOOR_UNLOCK_MS = 90 * 60 * 1000;
  const WAIT_ALERT_MS = 10 * 60 * 1000;
  const PIC_RETURN_LIMIT_MS = 10 * 60 * 1000;
  function corridorFor(address){
    const normalized = String(address || '').trim().toUpperCase();
    const first = normalized.split('-')[0].trim().toUpperCase();
    if(first === 'RECEB' || first.startsWith('RECEB')) return 'RECEB';
    if(/^[A-Z]$/.test(first)){
      const index = first.charCodeAt(0) - 65;
      const startCode = 65 + Math.floor(index / 2) * 2;
      const start = String.fromCharCode(startCode);
      const end = String.fromCharCode(Math.min(startCode + 1, 90));
      return `${start}-${end}`;
    }
    const n = Number(first.replace(/\D/g,''));
    const map = {
      1:'1-2',2:'1-2',3:'3-4',4:'3-4',5:'5-6',6:'5-6',
      7:'7-8',8:'7-8',9:'9-10',10:'9-10',11:'11-12',12:'11-12',
      13:'13-14',14:'13-14',15:'15-16',16:'15-16',
      17:'17-18',18:'17-18',19:'19-20',20:'19-20',
      21:'21-22',22:'21-22',23:'23-24',24:'23-24',25:'25-26',26:'25-26',
      27:'27-28',28:'27-28',29:'29-30',30:'29-30'
    };
    return map[n] || 'OUTROS';
  }
  function addHistory(address, action, direction=null){
    const data = AppState.getData();
    const user = AppState.getUser();
    const production = getOpenProductionRequest(user);
    data.history.unshift({
      id:Date.now() + Math.random(),
      address,
      action,
      direction,
      operator:user?.nome || 'Sistema',
      operatorMatricula:user?.matricula || 'sistema',
      requestNumber:production?.number || '',
      tabletName:AppState.getTablet()?.name || '',
      time:Date.now()
    });
    AppState.addAudit(action, `${address && address !== '—' ? `Palet ${address}. ` : ''}${production ? `Requisição ${production.number}.` : ''}`.trim(), {
      category: action.toLowerCase().includes('requisição') ? 'requisicao' : 'operacao',
      save:false
    });
    AppState.save({source:'operation'});
  }
  function elapsedMinutes(request){
    return Math.max(0, Math.floor((Date.now() - Number(request.createdAt || Date.now())) / 60000));
  }
  function elapsedClock(request){
    const totalSeconds = Math.max(0, Math.floor((Date.now() - Number(request.createdAt || Date.now())) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if(hours > 0){
      return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
    }
    return `${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  }
  function waitingAlertDue(request){
    return request.status === 'waiting' && (Date.now() - Number(request.createdAt || Date.now())) >= WAIT_ALERT_MS;
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
    return Math.max(0, Date.now() - Number(request.loweredAt || request.createdAt || Date.now()));
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
  function unlockDueFloorRequests(){
    const data = AppState.getData();
    let changed = false;
    data.requests.forEach(request => {
      if(!request.isPic && request.status === 'floor' && floorElapsedMs(request) >= FLOOR_UNLOCK_MS){
        request.status = 'ready';
        request.unlockedAt = Date.now();
        addHistory(request.address, 'Palet liberado automaticamente após 1 hora e 30 minutos');
        Notifications.push('Palet liberado', `${request.address} completou 1 hora e 30 minutos e está pronto para subir.`, {type:'success',toast:false,link:'operacao'});
        changed = true;
      }
    });
    if(changed) AppState.save();
    return changed;
  }
  function visibleRequests(){
    const data = AppState.getData();
    const query = UI.$('searchInput').value.toLowerCase().trim();
    const status = UI.$('statusFilter').value;
    return data.requests.filter(request =>
      data.selectedCorridors.includes(request.corridor) &&
      (!query || `${request.address} ${request.operator}`.toLowerCase().includes(query)) &&
      (status === 'all' || request.status === status)
    ).sort(compareAddresses);
  }
  function picMarkup(request){
    return request.isPic ? '<span class="pic-badge">EXP-PIC</span><div class="pic-message">⚠ Avisar armazenista</div>' : '';
  }
  function handlerMarkup(request){
    if(!request.lastHandledByName) return '';
    const tablet = request.lastHandledTablet ? ` · ${request.lastHandledTablet}` : '';
    return `<small class="handler-info">Último: ${request.lastHandledByName}${tablet}</small>`;
  }
  function waitingCard(request){
    const alertDue = waitingAlertDue(request);
    const hazardActive = request.isPic || alertDue;
    const statusLabel = request.isPic ? 'EXP-PIC' : (alertDue ? '⚠ ALERTA · +10 min' : 'Aguardando');
    return `
      <button class="pallet-card waiting wait-normal ${request.isPic ? 'pic' : ''} ${hazardActive ? 'hazard-blink' : ''}" data-id="${request.id}" data-external="${request.external ? 'true' : 'false'}">
        <div>
          <div class="pallet-title-line"><b>${request.address}</b>${request.isPic ? '<span class="pic-badge">EXP-PIC</span>' : ''}</div>
          <small>${request.operator}</small>
          ${handlerMarkup(request)}
        </div>
        ${request.isPic ? '<div class="pic-message">⚠ Avisar armazenista</div>' : ''}
        <div class="card-footer wait-footer">
          <span class="wait-status">${statusLabel}</span>
          <time data-elapsed-id="${request.id}">${elapsedClock(request)}</time>
        </div>
        <div class="card-action">Toque para baixar ↓</div>
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
          <div class="pallet-title-line"><b>${request.address}</b>${request.isPic ? '<span class="pic-badge">EXP-PIC</span>' : ''}</div>
          <small>${request.operator}</small>
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
          <div class="pallet-title-line"><b>${request.address}</b>${request.isPic ? '<span class="pic-badge">EXP-PIC</span>' : ''}</div>
          <small>${request.operator}</small>
          ${handlerMarkup(request)}
        </div>
        <div>
          <div class="card-footer">
            <span>${lowering ? 'Descendo...' : 'Subindo...'}</span>
            <b class="countdown" id="countdown-${request.id}">${request.remaining ?? 10}s</b>
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
  function moveRequest(id){
    const data = AppState.getData();
    const user = AppState.getUser();
    const request = data.requests.find(r => r.id === id);
    if(!request || !user) return;
    if(!Permissions.can('operate', user)){
      UI.toast('Seu perfil não possui permissão para movimentar paletes.');
      return;
    }
    if(request.external){
      UI.toast('Palet recebido da Selene em modo de leitura. A baixa real ainda não está ativada.');
      return;
    }
    if(request.status === 'waiting'){
      startMovement(request, 'down');
      return;
    }
    if(request.status === 'floor'){
      if(['encarregado','ti'].includes(user.role)){
        request.status='ready';
        request.unlockedAt=Date.now();
        request.manualUnlockedAt=Date.now();
        request.manualUnlockedBy=user.matricula;
        request.manualUnlockedByName=user.nome;
        request.manualUnlockedRole=user.role;
        addHistory(request.address, `Palet liberado pelo ${AppState.getRoleLabel(user.role)}${user.nome ? ` · ${user.nome}` : ''}`);
        AppState.addAudit('Liberação antecipada',`Palet ${request.address} liberado pelo ${AppState.getRoleLabel(user.role)} ${user.nome || user.matricula} antes de 1h30. É necessário clicar novamente para iniciar a subida.`,{category:'operacao',save:false});
        AppState.save({source:'operation'});
        renderAll();
        UI.toast(`${request.address} foi LIBERADO. Clique novamente no palet se quiser iniciar a subida.`);
        return;
      }
      UI.toast(`${request.address} será liberado automaticamente após 1 hora e 30 minutos. Faltam ${floorUnlockClock(request)}.`);
      return;
    }
    if(request.status === 'ready'){
      startMovement(request, 'up');
    }
  }
  async function startMovement(request, direction){
    if(timers.has(request.id)||request.__locking) return;
    request.__locking=true;
    try{await SecurityApi.acquirePalletLock(request,direction);}catch(error){request.__locking=false;UI.toast(error?.payload?.lockedBy?`Palet já está sendo movimentado por ${error.payload.lockedBy}.`:(error?.message||'Este palet já está sendo movimentado.'));AppState.addAudit('Movimentação concorrente bloqueada',`Tentativa bloqueada no palet ${request.address}.`,{category:'seguranca',severity:'warning'});return;}
    request.__locking=false;
    const user = AppState.getUser();
    const tablet = AppState.getTablet();
    request.lastHandledByMatricula = user?.matricula || '';
    request.lastHandledByName = user?.nome || '';
    request.lastHandledTablet = tablet?.name || tablet?.id || '';
    request.lastHandledAt = Date.now();
    request.previousStatus = request.status;
    request.status = direction === 'down' ? 'lowering' : 'returning';
    request.remaining = 10;
    request.movementStartedAt = Date.now();
    addHistory(
      request.address,
      direction === 'down'
        ? 'Descida iniciada — aguardando confirmação'
        : 'Subida iniciada — aguardando confirmação'
    );
    AppState.save();
    renderAll();
    UI.toast(
      direction === 'down'
        ? 'O palet já foi para baixo. Você tem 10 segundos para cancelar.'
        : 'O palet já foi para cima. Você tem 10 segundos para voltar.'
    );
    startTimer(request.id);
  }
  function startTimer(id){
    if(timers.has(id)) return;
    const timer = setInterval(() => {
      const current = AppState.getData().requests.find(r => r.id === id);
      if(!current || !['lowering','returning'].includes(current.status)){
        clearInterval(timer);
        timers.delete(id);
        return;
      }
      current.remaining = Math.max(0, Number(current.remaining ?? 10) - 1);
      const counter = UI.$(`countdown-${id}`);
      if(counter) counter.textContent = `${current.remaining}s`;
      AppState.save();
      if(current.remaining <= 0){
        clearInterval(timer);
        timers.delete(id);
        finalizeMovement(id);
      }
    }, 1000);
    timers.set(id, timer);
  }
  function resumeMovementTimers(){
    AppState.getData().requests
      .filter(request => ['lowering','returning'].includes(request.status))
      .forEach(request => {
        if(typeof request.remaining !== 'number'){
          request.remaining = 10;
        }
        startTimer(request.id);
      });
  }
  function undoMovement(id){
    const timer = timers.get(id);
    if(timer) clearInterval(timer);
    timers.delete(id);
    const request = AppState.getData().requests.find(r => r.id === id);
    if(!request) return;
    SecurityApi.releasePalletLock(request);
    const wasLowering = request.status === 'lowering';
    request.status = wasLowering ? 'waiting' : (request.previousStatus || 'ready');
    delete request.remaining;
    delete request.movementStartedAt;
    delete request.previousStatus;
    if(!wasLowering){
      request.createdAt = Date.now();
    }
    addHistory(
      request.address,
      wasLowering
        ? 'Descida cancelada — palet voltou para cima'
        : 'Subida cancelada — palet voltou para baixo'
    );
    AppState.save();
    renderAll();
    UI.toast(
      wasLowering
        ? `${request.address} voltou para Paletes.`
        : `${request.address} voltou para Paletes baixados.`
    );
  }
  function finalizeMovement(id){
    const data = AppState.getData();
    const index = data.requests.findIndex(r => r.id === id);
    if(index < 0) return;
    const request = data.requests[index];
    SecurityApi.releasePalletLock(request);
    if(request.status === 'lowering'){
      request.status = request.isPic ? 'ready' : 'floor';
      delete request.remaining;
      delete request.movementStartedAt;
      request.createdAt = Date.now();
      request.loweredAt = Date.now();
      if(request.isPic) request.unlockedAt = request.loweredAt;
      else delete request.unlockedAt;
      delete request.previousStatus;
      addHistory(request.address, request.isPic ? 'EXP-PIC desceu e foi liberado imediatamente para subir' : 'Palet desceu e foi confirmado pelo Site Selene', 'down');
      addProductionMovement('down');
      Notifications.push(
        request.isPic ? 'EXP-PIC no chão' : 'Palet baixado',
        request.isPic
          ? `${request.address} é EXP-PIC, está liberado para subir e deve retornar em até 10 minutos. Avisar armazenista.`
          : `${request.address} foi confirmado e será liberado em 1 hora e 30 minutos.`,
        {type:request.isPic?'warning':'info',toast:false,link:'operacao'}
      );
      AppState.save({source:'operation'});
      renderAll();
      UI.toast(request.isPic ? `${request.address} EXP-PIC liberado para subir · limite: 10 min.` : `${request.address} foi confirmado em Paletes baixados.`);
      return;
    }
    if(request.status === 'returning'){
      delete request.previousStatus;
      addHistory(request.address, 'Palet subiu e movimentação foi concluída pelo Site Selene', 'up');
      addProductionMovement('up');
      data.requests.splice(index, 1);
      Notifications.push('Movimentação concluída', `${request.address} retornou e foi retirado da operação.`, {type:'success',toast:false,link:'historico'});
      AppState.save({source:'operation'});
      renderAll();
      UI.toast(`${request.address} foi concluído.`);
    }
  }
  function requestPallet(address, operator, options={}){
    if(!Permissions.can('requestPallet')){
      UI.toast('Seu perfil não possui permissão para pedir paletes.');
      return false;
    }
    const data = AppState.getData();
    const normalized = address.trim().toUpperCase();
    const corridor = corridorFor(normalized);
    if(!normalized){
      UI.toast('Informe o endereço do palet.');
      return false;
    }
    if(data.requests.some(item => item.address.toUpperCase() === normalized)){
      UI.toast('Esse palet já está na operação.');
      return false;
    }
    data.requests.unshift({
      id:data.nextId++,
      address:normalized,
      operator:operator.trim() || AppState.getUser()?.nome || 'Operador',
      status:'waiting',
      corridor,
      createdAt:Date.now(),
      isPic:Boolean(options.isPic),
      sourceType:options.isPic ? 'PIC' : 'MANUAL'
    });
    if(!data.selectedCorridors.includes(corridor)){
      data.selectedCorridors.push(corridor);
    }
    addHistory(normalized, 'Palet solicitado manualmente');
    Notifications.push('Novo palet solicitado', `${normalized} foi enviado para a fila por ${operator.trim() || AppState.getUser()?.nome || 'Operador'}.`, {type:'info',toast:false,link:'operacao'});
    AppState.save({source:'operation'});
    renderAll();
    UI.toast(`${normalized} apareceu na tela de Paletes.`);
    return true;
  }
  function renderCorridorModal(){
    const data = AppState.getData();
    UI.$('corridorOptions').innerHTML = AppState.corridors.map(corridor => `
      <label>
        <input type="checkbox" value="${corridor}"
               ${data.selectedCorridors.includes(corridor) ? 'checked' : ''}>
        ${corridor}
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
      ? selected.map(c => `<span class="chip">${c}</span>`).join('')
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
  function createProductionRequest(){
    const data = AppState.getData();
    const user = AppState.getUser();
    if(!user) return null;
    const existing = getOpenProductionRequest(user);
    if(existing) return existing;
    const startedAt = Date.now();
    const id = data.nextProductionRequestId++;
    const request = {
      id,
      number:formatRequestNumber(id, startedAt),
      userMatricula:user.matricula,
      userName:user.nome,
      tabletName:AppState.getTablet()?.name || '',
      startedAt,
      endedAt:null,
      status:'open',
      downCount:0,
      upCount:0
    };
    data.productionRequests.unshift(request);
    AppState.save({source:'requisition'});
    addHistory('—', `Requisição ${request.number} iniciada`);
    Notifications.push('Requisição iniciada', `${request.number} foi criada para ${request.userName}.`, {type:'success',toast:false,link:'requisicoes'});
    return request;
  }
  function closeProductionRequest(){
    const request = getOpenProductionRequest();
    if(!request) return null;
    request.status = 'closed';
    request.endedAt = Date.now();
    addHistory('—', `Requisição ${request.number} encerrada`);
    Notifications.push('Requisição encerrada', `${request.number} terminou com ${request.downCount + request.upCount} movimentações.`, {type:'info',toast:false,link:'requisicoes'});
    AppState.save({source:'requisition'});
    return request;
  }
  function addProductionMovement(direction){
    const request = getOpenProductionRequest();
    if(!request) return;
    if(direction === 'down') request.downCount += 1;
    if(direction === 'up') request.upCount += 1;
    AppState.save();
  }
  function renderProductionRequest(){
    const user = AppState.getUser();
    const request = getOpenProductionRequest(user);
    const badge = UI.$('currentProductionRequest');
    if(badge){
      if(request){
        badge.classList.remove('hidden');
        badge.textContent = `${request.number} · ${request.downCount + request.upCount} mov.`;
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
      UI.$('requestDialog').showModal();
      setTimeout(() => UI.$('requestAddress').focus(), 40);
    });
    UI.$('requestForm').addEventListener('submit', event => {
      event.preventDefault();
      const created = requestPallet(
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
    UI.$('corridorForm').addEventListener('submit', event => {
      event.preventDefault();
      saveCorridors();
    });
    UI.$('shiftButton').addEventListener('click', () => {
      const openRequest = getOpenProductionRequest();
      if(!openRequest){
        const request = createProductionRequest();
        renderAll();
        UI.toast(`${request.number} iniciada para ${request.userName}.`);
        if(UI.$('view-requisicoes')?.classList.contains('active')) ProductionRequests.render();
        return;
      }
      const request = closeProductionRequest();
      renderAll();
      if(UI.$('view-requisicoes')?.classList.contains('active')) ProductionRequests.render();
      UI.toast(`${request.number} encerrada com ${request.downCount + request.upCount} movimentações.`);
    });
    UI.$('refreshButton').addEventListener('click', () => {
      renderAll();
      resumeMovementTimers();
      UI.toast('Tela atualizada com sucesso.');
    });
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
  function filteredHistory(){
    const history = AppState.getData().history;
    const query = (UI.$('historySearchInput')?.value || '').trim().toLowerCase();
    if(!query) return history;
    return history.filter(item => searchableText(item).includes(query));
  }
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
    UI.$('liveUp').textContent = history.filter(h => h.direction === 'up').length;
  }
  function init(){
    UI.$('historySearchInput')?.addEventListener('input', render);
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
    const down = history.filter(h => h.direction === 'down').length;
    const up = history.filter(h => h.direction === 'up').length;
    const canceled = history.filter(h => h.action.toLowerCase().includes('cancelada')).length;
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
    const ranking = Object.entries(operators).sort((a,b) => b[1] - a[1]);
    const max = Math.max(...ranking.map(([,total]) => total), 1);
    UI.$('operatorStats').innerHTML = ranking.length
      ? ranking.map(([name,total]) => `
          <div class="operator-row">
            <div class="operator-head"><span>${name}</span><b>${total}</b></div>
            <div class="progress"><i style="width:${Math.round(total/max*100)}%"></i></div>
          </div>
        `).join('')
      : '<div class="empty">Sem movimentações registradas.</div>';
    const alerts = [];
    data.requests.forEach(request => {
      const ageMinutes = Math.floor((Date.now() - request.createdAt) / 60000);
      const floorAgeMinutes = Math.floor((Date.now() - Number(request.loweredAt || request.createdAt)) / 60000);
      if(request.isPic && request.status === 'ready' && floorAgeMinutes >= 10){
        alerts.push({type:'danger',title:`${request.address} · EXP-PIC`,message:`EXP-PIC no chão há ${floorAgeMinutes} minutos. Subir agora e avisar armazenista.`});
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
            <b>${alert.title}</b>
            <div>${alert.message}</div>
          </div>
        `).join('')
      : '<div class="alert success"><b>Operação normal</b><div>Nenhum alerta no momento.</div></div>';
  }
  return { render };
})();;
const LoginAnimation = (() => {
  function init(){
    const cards = [...document.querySelectorAll('.visual-pallet')];
    if(!cards.length) return;
    const states = [
      {className:'waiting',label:'Aguardando',headline:'Paletes aguardando atendimento',subtitle:'As solicitações aparecem assim que são enviadas.'},
      {className:'lowering',label:'Descendo',headline:'Confirmação antes de descer',subtitle:'Há 10 segundos para corrigir uma movimentação errada.'},
      {className:'floor',label:'No chão',headline:'Paletes em atendimento',subtitle:'O Encarregado acompanha e pode liberar o retorno.'},
      {className:'ready',label:'Liberado',headline:'Paletes prontos para subir',subtitle:'O empilhador confirma a subida com segurança.'}
    ];
    let step = 0;
    let down = 18;
    let up = 14;
    setInterval(() => {
      step += 1;
      cards.forEach((card,index) => {
        const state = states[(index + step) % states.length];
        card.className = `visual-pallet ${state.className}`;
        card.querySelector('span').textContent = state.label;
      });
      const current = states[step % states.length];
      UI.$('visualHeadline').textContent = current.headline;
      UI.$('visualSubtitle').textContent = current.subtitle;
      if(step % 2 === 0) down += 1;
      else up += 1;
      UI.$('visualDown').textContent = down;
      UI.$('visualUp').textContent = up;
      UI.$('visualTotal').textContent = down + up;
    }, 2100);
  }
  return { init };
})();;
const ProductionRequests = (() => {
  let filteredRequests = [];
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
    const end = request.endedAt || Date.now();
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
      users.map(user => `<option value="${user.matricula}">${user.name}</option>`).join('');
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
  function applyFilters(){
    const data = AppState.getData();
    const from = localDateStart(UI.$('productionDateFrom')?.value);
    const to = localDateEnd(UI.$('productionDateTo')?.value);
    const user = UI.$('productionUserFilter')?.value || '';
    const status = UI.$('productionStatusFilter')?.value || '';
    const number = (UI.$('productionNumberFilter')?.value || '').trim().toLowerCase();
    filteredRequests = data.productionRequests.filter(request => {
      if(from && request.startedAt < from) return false;
      if(to && request.startedAt > to) return false;
      if(user && request.userMatricula !== user) return false;
      if(status && request.status !== status) return false;
      if(number && !request.number.toLowerCase().includes(number)) return false;
      return true;
    });
    renderTable();
    renderTotals();
  }
  function renderTotals(){
    const down = filteredRequests.reduce((sum,request) => sum + Number(request.downCount || 0), 0);
    const up = filteredRequests.reduce((sum,request) => sum + Number(request.upCount || 0), 0);
    UI.$('productionFoundCount').textContent = filteredRequests.length;
    UI.$('productionDownTotal').textContent = down;
    UI.$('productionUpTotal').textContent = up;
    UI.$('productionMovementTotal').textContent = down + up;
  }
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
          <td><b>${request.number}</b></td>
          <td>${request.userName}</td>
          <td>${request.tabletName || '—'}</td>
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
    return AppState.getData().productionRequests.filter(request => ids.includes(request.id));
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
    [
      'productionDateFrom',
      'productionDateTo',
      'productionUserFilter',
      'productionStatusFilter',
      'productionNumberFilter'
    ].forEach(id => {
      UI.$(id)?.addEventListener(id === 'productionNumberFilter' ? 'input' : 'change', applyFilters);
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
      if(!SecurityApi.isServerMode())AppState.addAudit('Usuário criado',`${p.nome} · ${p.matricula}.`,{category:'usuario'});
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
        const senha=prompt(`Nova senha para ${m}:`);if(senha===null)return;
        const r=await safe(()=>SecurityApi.changePassword(m,senha));UI.toast(r?.ok?'Senha alterada.':r?.message);
      }
      if(e.target.closest('.toggle-user-active')){
        if(!confirm(`${u.active===false?'Desbloquear':'Bloquear'} ${u.nome}?`))return;
        const r=await safe(()=>SecurityApi.setActive(m,u.active===false));await render();UI.toast(r?.ok?(r.active?'Usuário desbloqueado.':'Usuário bloqueado.'):r?.message);
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
const SeleneIntegration=(()=>{const DEFAULT='',KEY='empilhamento_integracao_v20_entrega';let timer=null,badge=null,serverCfg=null;function defaults(){return{enabled:false,serverBase:DEFAULT,codGrupo:'',codEmp:'',routePending:'',routeAttendance:'',interval:10000,writeEnabled:false};}function local(){try{return Object.assign(defaults(),JSON.parse(localStorage.getItem(KEY)||'{}'),{writeEnabled:false});}catch{return defaults();}}function settings(){return Object.assign(defaults(),serverCfg||local(),{writeEnabled:false});}async function loadServerConfig(){if(!SecurityApi.isServerMode())return settings();try{const c=await SecurityApi.getIntegrationConfig();if(c)serverCfg=Object.assign(defaults(),c,{writeEnabled:false});}catch{}return settings();}async function saveSettings(input={}){const c=settings(),n={enabled:input.enabled!==undefined?!!input.enabled:c.enabled,serverBase:String(input.serverBase??c.serverBase).trim().replace(/\/+$/,''),codGrupo:String(input.codGrupo??c.codGrupo).trim(),codEmp:String(input.codEmp??c.codEmp).trim(),routePending:String(input.routePending??c.routePending).trim(),routeAttendance:String(input.routeAttendance??c.routeAttendance).trim(),interval:Math.max(5000,Number(input.interval??c.interval)||10000),writeEnabled:false};if(SecurityApi.isServerMode())serverCfg=Object.assign(n,await SecurityApi.saveIntegrationConfig(n)||{}, {writeEnabled:false});else localStorage.setItem(KEY,JSON.stringify(n));restart();return settings();}function ensureBadge(){if(badge)return badge;badge=document.createElement('div');badge.id='seleneConnectionBadge';badge.className='selene-badge selene-checking';badge.textContent='Selene: verificando...';(document.querySelector('.topbar')||document.querySelector('header'))?.appendChild(badge);return badge;}function status(t,x){const e=ensureBadge();e.className=`selene-badge selene-${t}`;e.textContent=x;e.title=x;}function unwrap(j){if(Array.isArray(j))return j;if(Array.isArray(j?.Response))return j.Response;if(Array.isArray(j?.response))return j.response;return [];}function date(v){const d=new Date(v);return Number.isNaN(d.getTime())?Date.now():d.getTime();}function corridor(a){const f=String(a||'').split('-')[0].trim().toUpperCase();if(f==='RECEB'||f.startsWith('RECEB'))return'RECEB';if(/^[A-Z]$/.test(f)){const i=f.charCodeAt(0)-65,s=65+Math.floor(i/2)*2;return`${String.fromCharCode(s)}-${String.fromCharCode(Math.min(s+1,90))}`;}const n=Number(f.replace(/\D/g,''));if(n>=1&&n<=30){const s=n%2===0?n-1:n;return`${s}-${s+1}`;}return'OUTROS';}function pic(i){try{return /\bPIC\b/i.test([i?.type,i?.origin,i?.source,i?.collector,i?.system,i?.tipo,i?.origem,JSON.stringify(i)].join(' '));}catch{return false;}}async function get(route){if(!route)throw new Error('Rota de leitura ainda não configurada pelo TI.');if(SecurityApi.isServerMode())return unwrap(await SecurityApi.integrationRead(route));const c=settings(),q=`codGrupo=${encodeURIComponent(c.codGrupo)}&codEmp=${encodeURIComponent(c.codEmp)}`,r=await fetch(`${c.serverBase.replace(/\/+$/,'')}/${String(route).replace(/^\/+/, '')}?${q}`,{cache:'no-store',headers:{Accept:'application/json'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return unwrap(await r.json());}function map(i,type){const req=Number(i.id??i.requestId??i.requisicao),address=String(i.address??i.endereco??'').trim(),isPic=pic(i),at=date(i.createdAt??i.dataHora??i.timestamp),att=type!=='pending';return{id:Number.isFinite(req)?900000000+req:Date.now()+Math.random(),externalId:req,address,operator:String(i.operator??i.operador??i.usuario??'Sistema'),status:type==='pending'?'waiting':(isPic?'ready':'floor'),corridor:corridor(address),createdAt:at,loweredAt:att?at:undefined,unlockedAt:att&&isPic?at:undefined,external:true,isPic,sourceType:isPic?'PIC':'OFICIAL'};}function merge(p,a){const d=AppState.getData(),loc=d.requests.filter(x=>!x.external),ext=[...p.map(x=>map(x,'pending')),...a.map(x=>map(x,'attendance'))],u=new Map();ext.forEach(x=>u.set(`${x.externalId}-${x.status}`,x));d.requests=[...loc,...u.values()];AppState.save({source:'selene-read'});Operation?.renderAll();}async function lists(){const c=settings();return{pending:await get(c.routePending),attendance:await get(c.routeAttendance)};}async function refresh(){if(SecurityApi.isServerMode()&&!AppState.getUser()){status('off','Selene: aguardando login');return{ok:false};}await loadServerConfig();const c=settings();if(!c.enabled){status('off','Selene: integração desligada');return{ok:false};}try{status('checking','Integração: atualizando...');const{pending,attendance}=await lists();merge(pending,attendance);status('online',`Integração conectada • ${pending.length} pendente(s) • ${attendance.length} em atendimento`);return{ok:true,pending:pending.length,attendance:attendance.length};}catch(e){status('offline','Integração indisponível — usando dados locais');return{ok:false,error:e.message};}}async function testConnection(){const start=Date.now();await loadServerConfig();const c=settings(),checks=[{name:'Camada de integração',ok:true,detail:SecurityApi.isServerMode()?'Servidor intermediário ativo; navegador não acessa o sistema oficial diretamente.':'Modo direto de avaliação.'},{name:'URL da API',ok:/^https?:\/\//i.test(c.serverBase),detail:c.serverBase}];try{const{pending,attendance}=await lists();checks.push({name:'Pendentes',ok:true,detail:`${pending.length} registro(s)`},{name:'Em atendimento',ok:true,detail:`${attendance.length} registro(s)`});return{ok:true,checks,durationMs:Date.now()-start};}catch(e){checks.push({name:'Leitura da API',ok:false,detail:e.message});return{ok:false,checks,durationMs:Date.now()-start};}}function integrationMap(){const c=settings();return{architecture:SecurityApi.isServerMode()?'Navegador → Servidor Site Selene → sistema oficial / coletor':'Modo direto / avaliação',server:c.serverBase,settings:{enabled:c.enabled,codGrupo:c.codGrupo,codEmp:c.codEmp,routePending:c.routePending,routeAttendance:c.routeAttendance,interval:c.interval},writeEnabled:false,secretsInBrowser:false,readProxy:SecurityApi.isServerMode(),futureWrite:'Implementar somente no servidor após o TI confirmar a rota oficial de escrita, sessão e parâmetros de movimentação.'};}function integrationGuide(){const c=settings();return['CHECKLIST TI — SITE SELENE 2.0',`1. Definir servidor/API no Painel TI: ${c.serverBase||'[não configurado]'}.`,'2. Informar as duas rotas oficiais de leitura (pendentes e em atendimento).',`3. Validar os parâmetros de grupo/empresa conforme o ambiente oficial.`,'4. Confirmar autenticação/sessão usada pelos sistemas internos.','5. Confirmar a rota oficial de escrita e os parâmetros exigidos para descer/subir.','6. Confirmar a origem do EXP-PIC e o contrato de leitura.','7. Só confirmar a movimentação na interface após resposta positiva do sistema oficial.','8. Validar concorrência com dois operadores.','9. Homologar com palete autorizado.','10. Só então habilitar escrita no servidor.'].join('\n');}async function processRequest(){throw new Error('Escrita real bloqueada: deve ser implementada no servidor junto ao TI.');}function restart(){if(timer)clearInterval(timer);const c=settings();if(c.enabled)timer=setInterval(refresh,Math.max(5000,c.interval));}async function init(){ensureBadge();if(!SecurityApi.isServerMode()||AppState.getUser()){await loadServerConfig();refresh();}else status('off','Selene: aguardando login');restart();document.addEventListener('security:login',()=>loadServerConfig().then(refresh));}return{init,refresh,integrationMap,processRequest,getSettings:settings,saveSettings,testConnection,integrationGuide,loadServerConfig};})();;
const Reports = (() => {
  function escapeHtml(value=''){
    return String(value).replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'})[char]);
  }
  function openPrintable(title, body){
    const win=window.open('','_blank','width=1000,height=760');
    if(!win){ UI.toast('O navegador bloqueou a janela do relatório.'); return; }
    win.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><title>${escapeHtml(title)}</title><style>
      body{font-family:Arial,sans-serif;color:#17201d;margin:32px}header{border-bottom:3px solid #0f6b52;padding-bottom:16px;margin-bottom:22px}h1{margin:0;color:#0f6b52}header p{color:#66756f}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:18px 0}.card{border:1px solid #d9e4df;border-radius:12px;padding:14px}.card span{display:block;color:#6c7a74;font-size:12px}.card b{font-size:28px;display:block;margin-top:6px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border-bottom:1px solid #d9e4df;padding:10px;text-align:left;font-size:12px}th{background:#edf7f3}footer{margin-top:30px;color:#6c7a74;font-size:11px}.no-print{margin:0 0 20px;padding:10px 16px;border:0;border-radius:8px;background:#0f6b52;color:white;font-weight:bold}@media print{.no-print{display:none}body{margin:12mm}.grid{grid-template-columns:repeat(4,1fr)}}
    </style></head><body><button class="no-print" id="printReportButton">Imprimir / Salvar em PDF</button><header><h1>${escapeHtml(title)}</h1><p>Site Selene 2.0 · Gerado em ${new Date().toLocaleString('pt-BR')}</p></header>${body}<footer>Desenvolvimento inicial: InfoTech.io · Relatório gerado para conferência operacional.</footer></body></html>`);
    win.document.close();
    win.document.getElementById('printReportButton')?.addEventListener('click',()=>win.print());
    AppState.addAudit('Relatório gerado',title,{category:'relatorio'});
  }
  function printOperationalReport(){
    if(!Permissions.can('reports')){ UI.toast('Seu perfil não possui acesso a relatórios.'); return; }
    const data=AppState.getData();
    const history=data.history || [];
    const down=history.filter(item=>item.direction==='down').length;
    const up=history.filter(item=>item.direction==='up').length;
    const open=data.productionRequests.filter(item=>item.status==='open').length;
    const rows=data.productionRequests.slice(0,50).map(request=>`<tr><td>${escapeHtml(request.number)}</td><td>${escapeHtml(request.userName)}</td><td>${escapeHtml(request.tabletName || '—')}</td><td>${new Date(request.startedAt).toLocaleString('pt-BR')}</td><td>${request.status==='open'?'Em andamento':'Encerrada'}</td><td>${request.downCount||0}</td><td>${request.upCount||0}</td><td>${(request.downCount||0)+(request.upCount||0)}</td></tr>`).join('');
    openPrintable('Relatório operacional',`<div class="grid"><div class="card"><span>Desceram</span><b>${down}</b></div><div class="card"><span>Subiram</span><b>${up}</b></div><div class="card"><span>Paletes em aberto</span><b>${data.requests.length}</b></div><div class="card"><span>Requisições abertas</span><b>${open}</b></div></div><h2>Requisições recentes</h2><table><thead><tr><th>Requisição</th><th>Operador</th><th>Tablet</th><th>Início</th><th>Status</th><th>Desceu</th><th>Subiu</th><th>Total</th></tr></thead><tbody>${rows || '<tr><td colspan="8">Nenhuma requisição registrada.</td></tr>'}</tbody></table>`);
  }
  function printSelectedProduction(){
    printOperationalReport();
  }
  function init(){
    UI.$('printOperationalReport')?.addEventListener('click',printOperationalReport);
    UI.$('printProductionReport')?.addEventListener('click',printSelectedProduction);
  }
  return {init,printOperationalReport,printSelectedProduction};
})();;
const Audit=(()=>{let secure=[];function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'})[c]);}function group(i){const t=`${i.action||''} ${i.details||''}`.toLowerCase();if(/login realizado|login negado|login bloqueado/.test(t))return'login';if(/logout/.test(t))return'logout';if(/tablet|dispositivo|equipamento/.test(t))return'dispositivo';if(/seguran|csrf|concorrente|permiss/.test(`${i.category} ${t}`))return'seguranca';if(i.category==='operacao')return'movimentacao';if(i.category==='usuario')return'usuarios';if(i.category==='integracao')return'integracao';if(i.category==='relatorio')return'relatorio';return'outros';}async function load(){if(SecurityApi.isServerMode()&&Permissions.can('audit'))try{secure=await SecurityApi.getSecureAudit();}catch{secure=[];}else secure=[];}function all(){const arr=[...secure,...(AppState.getData().auditLog||[])].sort((a,b)=>Number(b.time)-Number(a.time)),seen=new Set();return arr.filter(i=>{const k=`${Math.round(Number(i.time||0)/2000)}|${i.action}|${i.details}|${i.actorMatricula}`;if(seen.has(k))return false;seen.add(k);return true;});}function rows(){const q=(UI.$('auditSearchInput')?.value||'').toLowerCase(),cat=UI.$('auditCategoryFilter')?.value||'',actor=UI.$('auditUserFilter')?.value||'',role=UI.$('auditRoleFilter')?.value||'',event=UI.$('auditEventFilter')?.value||'',src=UI.$('auditSourceFilter')?.value||'',from=UI.$('auditDateFrom')?.value?new Date(`${UI.$('auditDateFrom').value}T00:00:00`).getTime():0,to=UI.$('auditDateTo')?.value?new Date(`${UI.$('auditDateTo').value}T23:59:59`).getTime():Infinity;return all().filter(i=>(!cat||i.category===cat)&&(!actor||i.actorMatricula===actor)&&(!role||i.actorRole===role)&&(!event||group(i)===event)&&(!src||((src==='server')===(i.source==='servidor-seguro')))&&Number(i.time)>=from&&Number(i.time)<=to&&(!q||[i.action,i.details,i.actorName,i.actorMatricula].join(' ').toLowerCase().includes(q)));}function users(){const s=UI.$('auditUserFilter');if(!s)return;const cur=s.value,map=new Map();[...AppState.users.map(u=>({matricula:u.matricula,nome:u.nome})),...all().map(i=>({matricula:i.actorMatricula,nome:i.actorName}))].filter(x=>x.matricula&&x.matricula!=='sistema').forEach(x=>map.set(x.matricula,x));const a=[...map.values()].sort((a,b)=>a.nome.localeCompare(b.nome));s.innerHTML='<option value="">Todos os usuários</option>'+a.map(x=>`<option value="${esc(x.matricula)}">${esc(x.nome)} · ${esc(x.matricula)}</option>`).join('');if(a.some(x=>x.matricula===cur))s.value=cur;}async function render(reload=true){if(!Permissions.can('audit'))return;if(reload)await load();users();const r=rows(),b=UI.$('auditTableBody');UI.$('auditCount').textContent=`${r.length} registro${r.length===1?'':'s'}`;b.innerHTML=r.length?r.slice(0,1500).map(i=>`<tr><td>${new Date(i.time).toLocaleString('pt-BR')}<small class="table-detail">${i.source==='servidor-seguro'?'Servidor seguro':'Interface'}</small></td><td><span class="audit-category ${esc(i.category)}">${esc(i.category)}</span></td><td><b>${esc(i.action)}</b><small class="table-detail">${esc(i.details)}</small></td><td>${esc(i.actorName)}<small class="table-detail">${esc(i.actorMatricula)} · ${esc(AppState.getRoleLabel(i.actorRole))}</small></td></tr>`).join(''):'<tr><td colspan="4"><div class="empty">Nenhum registro encontrado.</div></td></tr>';}function clear(){['auditCategoryFilter','auditUserFilter','auditRoleFilter','auditEventFilter','auditSourceFilter','auditDateFrom','auditDateTo','auditSearchInput'].forEach(id=>{const e=UI.$(id);if(e)e.value='';});render(false);}function exportCsv(){const r=rows(),cell=v=>`"${String(v??'').replace(/"/g,'""')}"`,csv=[['Data/Hora','Origem','Categoria','Evento','Ação','Detalhes','Usuário','Matrícula','Perfil'],...r.map(i=>[new Date(i.time).toLocaleString('pt-BR'),i.source==='servidor-seguro'?'Servidor seguro':'Interface',i.category,group(i),i.action,i.details,i.actorName,i.actorMatricula,AppState.getRoleLabel(i.actorRole)])].map(x=>x.map(cell).join(';')).join('\n'),blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='auditoria-site-selene.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);}function init(){['auditSearchInput','auditCategoryFilter','auditUserFilter','auditRoleFilter','auditEventFilter','auditSourceFilter','auditDateFrom','auditDateTo'].forEach(id=>UI.$(id)?.addEventListener(id==='auditSearchInput'?'input':'change',()=>render(false)));UI.$('auditClearFilters')?.addEventListener('click',clear);UI.$('exportAuditCsv')?.addEventListener('click',exportCsv);document.addEventListener('view:changed',e=>{if(e.detail.name==='auditoria')render();});}return{init,render};})();;
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
          <i class="chart-down" style="height:${Math.max(4,Math.round(day.down/max*100))}%"></i>
          <i class="chart-up" style="height:${Math.max(4,Math.round(day.up/max*100))}%"></i>
        </div>
        <span>${day.label}</span>
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
    const waitAvg=waiting.length ? waiting.reduce((sum,item)=>sum+(Date.now()-item.createdAt)/60000,0)/waiting.length : 0;
    UI.$('dashWaiting').textContent=waiting.length;
    UI.$('dashFloor').textContent=floor.length;
    UI.$('dashReady').textContent=ready.length;
    UI.$('dashToday').textContent=today.length;
    UI.$('dashActiveOperators').textContent=new Set(activeRequests.map(item=>item.userMatricula)).size;
    UI.$('dashAverageWait').textContent=formatMinutes(waitAvg);
    UI.$('dashboardChart').innerHTML=renderBars(lastSevenDays(history));
    const current=Operation.getOpenProductionRequest();
    UI.$('dashboardRequestStatus').innerHTML=current ? `
      <div class="request-focus active">
        <span>Requisição atual</span><b>${current.number}</b>
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
        <div><b>${item.address}</b><small>${item.action} · ${item.operator}</small></div>
        <time>${new Date(item.time).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</time>
      </div>`).join('') : '<div class="empty compact">Nenhuma atividade registrada.</div>';
    const picOverdue=data.requests.filter(item=>item.isPic && item.status==='ready' && Date.now()-Number(item.loweredAt||item.createdAt)>=10*60000);
    const normalFloorLong=floor.filter(item=>!item.isPic && Date.now()-Number(item.loweredAt||item.createdAt)>=80*60000);
    const critical=[
      ...picOverdue.map(item=>({address:item.address,text:`EXP-PIC no chão há ${Math.floor((Date.now()-(item.loweredAt||item.createdAt))/60000)} min · subir agora`,type:'danger'})),
      ...waiting.filter(item=>Date.now()-item.createdAt>=10*60000).map(item=>({address:item.address,text:`Aguardando há ${Math.floor((Date.now()-item.createdAt)/60000)} min`,type:'warning'})),
      ...normalFloorLong.map(item=>({address:item.address,text:`No chão há ${Math.floor((Date.now()-(item.loweredAt||item.createdAt))/60000)} min · próximo da liberação`,type:'warning'}))
    ].slice(0,5);
    UI.$('dashboardAlerts').innerHTML=critical.length ? critical.map(item=>`
      <div class="dashboard-alert ${item.type}"><b>${item.address}</b><span>${item.text}</span></div>`).join('') : '<div class="dashboard-ok"><b>Operação normal</b><span>Nenhum alerta prioritário.</span></div>';
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
const DataSync = (() => {
  const BASE='/api/site-selene';
  let connected=false;
  let applyingRemote=false;
  let pushTimer=null;
  let pollTimer=null;
  let lastRemoteUpdatedAt=0;
  function setStatus(type,text){
    connected=type==='online';
    const badge=UI.$('centralSyncBadge');
    if(badge){
      badge.className=`central-sync-badge ${type}`;
      badge.textContent=text;
      badge.title=text;
    }
    const config=UI.$('centralDataMode');
    if(config) config.textContent=text;
  }
  async function request(path='',options={}){
    if(typeof SecurityApi!=='undefined'&&SecurityApi.isServerMode()) return SecurityApi.secureFetch(path,options);
    const response=await fetch(`${BASE}${path}`,{cache:'no-store',headers:{'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})},...options});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.status===204?null:response.json();
  }
  async function push(){
    if(!connected || applyingRemote || AppState.getData().settings?.centralSyncEnabled===false) return;
    try{
      const snapshot=AppState.exportOperationalSnapshot();
      const result=await request('/snapshot',{method:'PUT',body:JSON.stringify(snapshot)});
      lastRemoteUpdatedAt=Number(result?.updatedAt || snapshot.updatedAt || Date.now());
      setStatus('online','Servidor local sincronizado');
    }catch(error){
      setStatus('offline','Servidor local sem conexão');
      console.warn('Falha ao enviar dados ao servidor local:',error);
    }
  }
  function schedulePush(){
    if(applyingRemote || !connected) return;
    clearTimeout(pushTimer);
    pushTimer=setTimeout(push,1400);
  }
  async function pull(initial=false){
    if(!connected || AppState.getData().settings?.centralSyncEnabled===false) return;
    try{
      const remote=await request('/snapshot');
      if(!remote?.snapshot){
        if(initial) await push();
        return;
      }
      const remoteUpdatedAt=Number(remote.updatedAt || remote.snapshot.updatedAt || 0);
      const localUpdatedAt=Number(AppState.getData().meta?.updatedAt || 0);
      lastRemoteUpdatedAt=Math.max(lastRemoteUpdatedAt,remoteUpdatedAt);
      if(remoteUpdatedAt>localUpdatedAt+50){
        applyingRemote=true;
        remote.snapshot.data.meta = remote.snapshot.data.meta || {};
        remote.snapshot.data.meta.updatedAt = remoteUpdatedAt;
        AppState.importSnapshot(remote.snapshot,{silent:false,skipSync:true,source:'servidor'});
        applyingRemote=false;
        if(typeof Operation!=='undefined') Operation.renderAll();
        if(typeof Dashboard!=='undefined') Dashboard.render();
        if(typeof Notifications!=='undefined') Notifications.render();
        setStatus('online','Dados atualizados do servidor');
      }else if(initial && localUpdatedAt>remoteUpdatedAt+50){
        await push();
      }
    }catch(error){
      setStatus('offline','Servidor local sem conexão');
      console.warn('Falha ao receber dados do servidor local:',error);
    }
  }
  async function initialize(){
    if(!AppState.getUser()){setStatus(location.protocol==='file:'?'local':'offline',location.protocol==='file:'?'Dados somente neste navegador':'Entre para conectar ao servidor');return;}
    if(location.protocol==='file:'){
      setStatus('local','Dados somente neste navegador');
      return;
    }
    try{
      const status=await request('/status');
      if(!status?.ok) throw new Error('Servidor não respondeu corretamente.');
      connected=true;
      setStatus('online','Servidor local conectado');
      await pull(true);
      pollTimer=setInterval(()=>pull(false),6000);
    }catch(error){
      connected=false;
      setStatus('offline','Modo local — servidor indisponível');
    }
  }
  async function forceSync(){
    if(!AppState.getUser()){UI.toast('Entre no sistema antes de sincronizar.');return;}
    if(location.protocol==='file:'){
      UI.toast('Abra pelo servidor local para compartilhar os dados.');
      return;
    }
    if(!connected) await initialize();
    if(connected){
      await pull(false);
      await push();
      UI.toast('Sincronização concluída.');
      AppState.addAudit('Sincronização manual','Dados enviados e recebidos do servidor local.',{category:'integracao'});
    }
  }
  function init(){
    document.addEventListener('app:state-saved',schedulePush);
    UI.$('forceCentralSync')?.addEventListener('click',forceSync);
    initialize();
  }
  async function reconnect(){connected=false;if(pollTimer){clearInterval(pollTimer);pollTimer=null;}await initialize();}
  return {init,forceSync,reconnect,isConnected:()=>connected};
})();;
const DataTools = (() => {
  function download(filename, content, type){
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  }
  function csvCell(value){ return `"${String(value ?? '').replace(/"/g,'""')}"`; }
  function exportBackup(){
    const stamp = new Date().toISOString().slice(0,10);
    download(`site-selene-backup-${stamp}.json`, JSON.stringify(SecurityApi.isServerMode()?AppState.exportOperationalSnapshot():AppState.exportSnapshot(), null, 2), 'application/json');
    AppState.addAudit('Backup exportado',SecurityApi.isServerMode()?'Backup operacional sem credenciais gerado.':'Cópia completa dos dados demo gerada.',{category:'sistema'});
    UI.toast('Backup exportado com sucesso.');
  }
  async function importBackup(file){
    try{
      const parsed = JSON.parse(await file.text());
      if(SecurityApi.isServerMode()) delete parsed.users;
      const result = AppState.importSnapshot(parsed);
      if(!result.ok) throw new Error(result.message);
      AppState.addAudit('Backup importado','Dados restaurados a partir de um arquivo JSON.',{category:'sistema'});
      UI.toast('Backup importado. Atualizando o sistema...');
      setTimeout(() => location.reload(), 500);
    }catch(error){ UI.toast(error.message || 'Não foi possível importar o backup.'); }
  }
  function exportHistory(){
    const rows = AppState.getData().history.map(item => [new Date(item.time).toLocaleString('pt-BR'), item.requestNumber || '', item.address, item.action, item.operator, item.tabletName || '']);
    const csv = [['Data/Hora','Requisição','Palet','Ação','Operador','Tablet'], ...rows].map(row => row.map(csvCell).join(';')).join('\n');
    download('historico-site-selene.csv', '\ufeff'+csv, 'text/csv;charset=utf-8');
    AppState.addAudit('Histórico exportado','Arquivo CSV de movimentações gerado.',{category:'relatorio'});
  }
  function exportProduction(){
    const rows = AppState.getData().productionRequests.map(r => [r.number,r.userName,r.tabletName||'',new Date(r.startedAt).toLocaleString('pt-BR'),r.endedAt?new Date(r.endedAt).toLocaleString('pt-BR'):'',r.status==='open'?'Em andamento':'Encerrada',r.downCount||0,r.upCount||0,(r.downCount||0)+(r.upCount||0)]);
    const csv = [['Requisição','Empilhador','Tablet','Início','Fim','Situação','Desceram','Subiram','Total'],...rows].map(row => row.map(csvCell).join(';')).join('\n');
    download('requisicoes-site-selene.csv','\ufeff'+csv,'text/csv;charset=utf-8');
    AppState.addAudit('Requisições exportadas','Arquivo CSV de produção gerado.',{category:'relatorio'});
  }
  function updateEnvironment(){
    const mode=UI.$('environmentMode'), storage=UI.$('storageMode'), integration=UI.$('integrationMode');
    if(mode) mode.textContent = location.protocol === 'file:' ? 'Apresentação no Chrome' : 'Servidor local';
    if(storage) storage.textContent = location.protocol === 'file:' ? 'Neste navegador + backup manual' : 'Servidor local + navegador';
    if(integration){
      const badge=document.getElementById('seleneConnectionBadge');
      integration.textContent = badge?.textContent || 'Verificando...';
      const observer=new MutationObserver(()=> integration.textContent=badge.textContent);
      if(badge) observer.observe(badge,{childList:true,characterData:true,subtree:true});
    }
  }
  function init(){
    UI.$('exportBackupButton')?.addEventListener('click',exportBackup);
    UI.$('importBackupButton')?.addEventListener('click',()=>UI.$('importBackupInput')?.click());
    UI.$('importBackupInput')?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)importBackup(f);});
    UI.$('exportHistoryCsv')?.addEventListener('click',exportHistory);
    UI.$('exportProductionCsv')?.addEventListener('click',exportProduction);
    document.addEventListener('view:changed', e=>{if(e.detail.name==='configuracoes')updateEnvironment();});
    updateEnvironment();
  }
  return {init};
})();;
const TechnicalPanel=(()=>{function bytes(v){if(v<1024)return`${v} B`;if(v<1048576)return`${(v/1024).toFixed(1)} KB`;return`${(v/1048576).toFixed(2)} MB`;}function ls(){let t=0;for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i)||'';t+=k.length+(localStorage.getItem(k)||'').length;}return t*2;}function esc(v=''){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','"':'&quot;'})[c]);}function map(){try{return SeleneIntegration.integrationMap();}catch{return{writeEnabled:false};}}function download(name,content,type='application/json'){const b=new Blob([content],{type}),u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),500);}async function security(){const box=UI.$('techSecurityDetails'),mode=UI.$('techSecurityMode');if(!box)return;let s;try{s=await SecurityApi.getSecurityStatus();}catch(e){s={mode:'indisponível',passwordStorage:'—'};}const server=SecurityApi.isServerMode();mode.textContent=server?'SERVIDOR SEGURO':'MODO DIRETO';const items=[['Senhas',s.passwordStorage||'Local',server?'Hash no servidor; não entram no snapshot.':'Credenciais locais somente para avaliação.'],['Sessão',server?'Cookie HttpOnly':'SessionStorage',server?`Protegida do JavaScript · ${s.sessionIdleMinutes||'—'} min de inatividade`:'Modo direto de avaliação.'],['CSRF',s.csrf?'ATIVO':'LOCAL',s.csrf?'Toda alteração exige token da sessão.':'Ativo somente no servidor.'],['Auditoria',s.secureAudit?'SERVIDOR + LOCAL':'LOCAL',s.secureAudit?'Registro append-only fora do navegador.':'Somente navegador.'],['Web',s.securityHeaders?'CABEÇALHOS ATIVOS':'N/A',s.securityHeaders?'Anti-frame, nosniff, CSP e permissões restritas.':'Abra pelo servidor para ativar.'],['Sistema oficial',server?'VIA SERVIDOR':'LOCAL',server?'O navegador não acessa o sistema oficial diretamente.':'Para produção, preferir a camada de servidor.'],['Área privada',s.staticIsolation?'BLOQUEADA':'N/A',s.staticIsolation?'Servidor publica somente /public; private/server/docs não são servidos.':'Abra pelo servidor.'],['Tentativas de login',s.rateLimit?'PROTEGIDAS':'N/A',s.rateLimit?'Bloqueio temporário após repetidas tentativas inválidas.':'Abra pelo servidor.'],['Integridade da auditoria',s.auditIntegrity?'ÍNTEGRA':'VERIFICAR',s.auditIntegrity?`${s.auditEvents||0} evento(s) com cadeia de integridade.`:'A cadeia da auditoria precisa ser verificada.'],['Backups',s.automaticBackups?'AUTOMÁTICOS':'N/A',s.automaticBackups?'Cópias privadas diárias com retenção limitada.':'Abra pelo servidor.']];box.innerHTML=items.map(([l,v,d])=>`<article class="${server?'good':'warn'}"><span>${esc(l)}</span><b>${esc(v)}</b><small>${esc(d)}</small></article>`).join('');}async function render(){if(!Permissions.can('technical'))return;await SeleneIntegration.loadServerConfig?.();const d=AppState.getData(),m=map(),c=SeleneIntegration.getSettings();UI.$('techVersion').textContent=d.version||'2.0';UI.$('techProtocol').textContent=location.protocol.replace(':','').toUpperCase();UI.$('techHost').textContent=location.host||'arquivo local';UI.$('techStorage').textContent=bytes(ls());const rows=[['Usuários',AppState.users.length],['Contas TI',AppState.users.filter(u=>u.role==='ti').length],['Requisições abertas',(d.productionRequests||[]).filter(r=>r.status==='open').length],['Paletes na operação',(d.requests||[]).length],['Sincronização',DataSync.isConnected()?'Conectada':'Local/offline'],['Autenticação',SecurityApi.isServerMode()?'Servidor + sessão':'Modo local'],['Sistema oficial pelo navegador',SecurityApi.isServerMode()?'NÃO':'Direto no navegador'],['Escrita oficial',m.writeEnabled?'LIBERADA':'BLOQUEADA']];UI.$('techDiagnostics').innerHTML=rows.map(([l,v])=>`<div><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('');UI.$('techIntegrationMap').textContent=JSON.stringify(m,null,2);UI.$('techApiBase').value=c.serverBase||'';UI.$('techCodGrupo').value=c.codGrupo||'';UI.$('techCodEmp').value=c.codEmp||'';UI.$('techRoutePending').value=c.routePending||'';UI.$('techRouteAttendance').value=c.routeAttendance||'';UI.$('techInterval').value=Math.round(Number(c.interval||10000)/1000);UI.$('techIntegrationEnabled').checked=c.enabled!==false;UI.$('techIntegrationGuide').textContent=SeleneIntegration.integrationGuide();UI.$('techIntegrationNotes').value=d.settings?.tiIntegrationNotes||'';await security();}function result(r){const b=UI.$('techConnectionResult');if(!b)return;b.className=`tech-test-result ${r?.ok?'ok':'error'}`;b.innerHTML=`<div class="tech-test-head"><b>${r?.ok?'✓ Leitura validada':'⚠ Verificação incompleta'}</b><span>${r?.durationMs??''} ms</span></div>${(r?.checks||[]).map(c=>`<div class="tech-test-line"><span class="${c.ok?'ok':'bad'}">${c.ok?'✓':'×'}</span><div><b>${esc(c.name)}</b><small>${esc(c.detail)}</small></div></div>`).join('')}`;}async function saveCfg(){const b=UI.$('techSaveIntegration');b.disabled=true;b.textContent='Salvando...';try{const n=await SeleneIntegration.saveSettings({enabled:UI.$('techIntegrationEnabled').checked,serverBase:UI.$('techApiBase').value,codGrupo:UI.$('techCodGrupo').value,codEmp:UI.$('techCodEmp').value,routePending:UI.$('techRoutePending').value,routeAttendance:UI.$('techRouteAttendance').value,interval:Number(UI.$('techInterval').value||10)*1000});AppState.addAudit('Configuração de integração alterada',`Servidor ${n.serverBase} · grupo ${n.codGrupo} · empresa ${n.codEmp}.`,{category:'integracao',secure:!SecurityApi.isServerMode()});UI.toast(SecurityApi.isServerMode()?'Configuração salva no servidor.':'Configuração local salva no navegador.');}catch(e){UI.toast(e.message);}finally{b.disabled=false;b.textContent='Salvar configuração';render();}}async function test(){const b=UI.$('techTestConnection');b.disabled=true;b.textContent='Testando...';try{const r=await SeleneIntegration.testConnection();result(r);AppState.addAudit('Validação de integração',r.ok?'Leitura validada.':'Leitura não concluída.',{category:'integracao',severity:r.ok?'info':'warning'});}finally{b.disabled=false;b.textContent='Testar conexão e leitura';render();}}function notes(){const d=AppState.getData();d.settings=d.settings||{};d.settings.tiIntegrationNotes=UI.$('techIntegrationNotes').value||'';AppState.save({source:'technical-notes'});UI.toast('Anotações salvas.');}async function guide(){const t=SeleneIntegration.integrationGuide();try{await navigator.clipboard.writeText(t);UI.toast('Roteiro copiado.');}catch{download('roteiro-integracao-selene.txt',t,'text/plain;charset=utf-8');}}function init(){UI.$('techRefresh')?.addEventListener('click',render);UI.$('techForceSync')?.addEventListener('click',()=>DataSync.forceSync());UI.$('techRefreshSelene')?.addEventListener('click',async()=>{await SeleneIntegration.refresh();render();});UI.$('techSaveIntegration')?.addEventListener('click',saveCfg);UI.$('techTestConnection')?.addEventListener('click',test);UI.$('techCopyGuide')?.addEventListener('click',guide);UI.$('techSaveNotes')?.addEventListener('click',notes);UI.$('techDownloadMap')?.addEventListener('click',()=>download('mapa-integracao-site-selene.json',JSON.stringify(map(),null,2)));UI.$('techDownloadSnapshot')?.addEventListener('click',()=>download(`site-selene-snapshot-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(AppState.exportOperationalSnapshot(),null,2)));document.addEventListener('view:changed',e=>{if(e.detail.name==='tecnico')render();});}return{init,render};})();;
document.addEventListener('DOMContentLoaded',async()=>{await SecurityApi.init();if(!SecurityApi.isServerMode()){document.body.classList.add('local-test-mode');}TabletManager.init();Auth.init();Operation.init();History.init();LoginAnimation.init();ProductionRequests.init();SeleneIntegration.init();UsersAdmin.init();Reports.init();Audit.init();Dashboard.init();Notifications.init();DataSync.init();DataTools.init();TechnicalPanel.init();UI.$('menuButton').addEventListener('click',UI.openMenu);UI.$('closeMenu').addEventListener('click',UI.closeMenu);UI.$('overlay').addEventListener('click',UI.closeMenu);document.querySelectorAll('.nav-button').forEach(b=>b.addEventListener('click',()=>UI.openView(b.dataset.view)));document.addEventListener('security:expired',()=>{AppState.clearUser();AppState.clearTablet();UI.toast('Sua sessão expirou. Entre novamente.');setTimeout(()=>location.reload(),700);},{once:true});let user=SecurityApi.isServerMode()?SecurityApi.getSessionUser():AppState.getUser();if(user){if(SecurityApi.isServerMode()){AppState.setUser({matricula:user.matricula,nome:user.nome,role:user.role});if(['encarregado','ti'].includes(user.role))try{await SecurityApi.loadUsers();}catch{}}else{const ex=AppState.users.find(x=>x.matricula===user.matricula&&x.active!==false);if(!ex){AppState.clearUser();UI.showLogin();return;}user={matricula:ex.matricula,nome:ex.nome,role:ex.role};AppState.setUser(user);}UI.showSystem(user);Operation.renderAll();Dashboard.render();TabletManager.ensureSelected();}else{AppState.clearUser();UI.showLogin();}});
