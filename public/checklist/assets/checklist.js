(()=>{

const $=(s,p=document)=>p.querySelector(s), $$=(s,p=document)=>Array.from(p.querySelectorAll(s));
const statusLabel={unchecked:'SEM CHECKLIST',ok:'OK',warn:'ATENÇÃO',crit:'CRÍTICO'};
const typeLabel={bateria:'Bateria',empilhadeira:'Empilhadeira',tablet:'Tablet'};
let currentUser=null,currentTab='bateria',currentAdminPage='overview',editingEquipmentId=null;
let equipment=[],history=[],users=[],issues=[],audit=[],auditLoaded=false,auditLoading=null;
let templates={},templateVersions=[],events=null,poll=null,checkVersion=null,checkTemplateId=null;

function fmt(dt){if(!dt)return '—';return new Date(dt).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'})}
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]))}
function toast(msg){const t=$('#toast');t.textContent=msg;t.classList.add('show');clearTimeout(window._toast);window._toast=setTimeout(()=>t.classList.remove('show'),2500)}
function applyUser(){
  $('#userName').textContent=currentUser.name;
  $('#roleName').textContent=currentUser.backendRole;
  $('#menuBtn').classList.toggle('hidden',currentUser.role!=='adm');
  $('#sideUser').textContent=currentUser.name;
  $('#sideRole').textContent=currentUser.role==='adm'?'Administrador / TI':'Operador';
  const mapping={equipment:'equipment:manage',issues:'issues:resolve',history:'audit:view',users:'users:view',templates:'checklist:manage',reports:'reports:export',settings:'system:configure'};
  for(const [page,perm] of Object.entries(mapping))$$('[data-admin-page="'+page+'"],[data-admin-page-jump="'+page+'"]').forEach(el=>el.classList.toggle('hidden',!SeleneApi.has(perm)));
  for(const id of ['printBtn','exportBtn'])$('#'+id).classList.toggle('hidden',!SeleneApi.has('reports:export'));
  if(currentUser.role!=='adm') closeSidebar();
}
function openSidebar(){if(currentUser?.role!=='adm')return;$('#sidebar').classList.add('open');$('#backdrop').classList.add('show')}
function closeSidebar(){$('#sidebar').classList.remove('open');$('#backdrop').classList.remove('show')}
function showOperation(){currentAdminPage='overview';$('#adminView').classList.add('hidden');$('#operationView').classList.remove('hidden');closeSidebar()}
function showAdmin(page='overview'){
  if(currentUser?.role!=='adm')return;
  currentAdminPage=page;$('#operationView').classList.add('hidden');$('#adminView').classList.remove('hidden');
  $$('.admin-page').forEach(x=>x.classList.toggle('active',x.dataset.page===page));
  $$('#sideNav [data-admin-page]').forEach(x=>x.classList.toggle('active',x.dataset.adminPage===page));
  renderAdmin();closeSidebar();if(page==='history')loadAudit().catch(error=>toast(error.message));
}

function calcKPIs(){
  const active=equipment.filter(e=>e.active),ok=active.filter(e=>e.status==='ok').length,warn=active.filter(e=>e.status==='warn').length,crit=active.filter(e=>e.status==='crit').length;
  $('#kpiOk').textContent=ok;$('#kpiWarn').textContent=warn;$('#kpiCrit').textContent=crit;$('#kpiSwaps').textContent=history.filter(h=>h.kind==='swap').length;$('#kpiHistory').textContent=history.length;
}
function filteredList(){
  const q=$('#searchInput').value.trim().toLowerCase(),f=$('#statusFilter').value;
  return equipment.filter(e=>e.active&&e.type===currentTab).filter(e=>{if(f!=='all'&&e.status!==f)return false;const text=`${e.code} ${e.name} ${e.operator} ${e.obs} ${e.water||''}`.toLowerCase();return !q||text.includes(q)})
}
function cardHTML(e){
  const extraA=e.type==='bateria'?`<div class="meta-box"><span>Nível de água</span><b>${esc(e.water||'—')}</b></div>`:`<div class="meta-box"><span>Status</span><b>${statusLabel[e.status]}</b></div>`;
  const extraB=e.type==='bateria'?`<div class="meta-box"><span>Litros</span><b>${esc(e.liters||'0')}</b></div>`:`<div class="meta-box"><span>Último check</span><b>${esc(fmt(e.lastCheck))}</b></div>`;
  return `<article class="card ${esc(e.status)}"><div class="card-head"><div><div class="code">${esc(e.code)}</div><div class="title">${esc(e.name)}</div></div><span class="badge ${esc(e.status)}">${esc(statusLabel[e.status])}</span></div><div class="meta">${extraA}${extraB}<div class="meta-box"><span>Operador</span><b>${esc(e.operator||'—')}</b></div><div class="meta-box"><span>Atualização</span><b>${esc(fmt(e.lastCheck))}</b></div></div><div class="obs">${esc(e.obs||'Sem observações.')}</div><div class="foot"><small>1 estado atual por equipamento</small><button class="btn primary" data-check="${esc(e.id)}">Checklist</button></div></article>`
}
function renderEquipment(){const grid=$('#equipmentGrid'),list=filteredList();grid.className=`grid ${currentTab==='bateria'?'battery-grid':'standard-grid'}`;grid.innerHTML=list.length?list.map(cardHTML).join(''):'<div class="empty">Nenhum equipamento encontrado.</div>'}
function renderHistory(){const q=$('#searchInput').value.trim().toLowerCase();const rows=history.filter(h=>!q||JSON.stringify(h).toLowerCase().includes(q));$('#historyList').innerHTML=rows.length?rows.map(h=>`<div class="history-item"><div><b>${esc(h.equipment)}</b><small>${esc(h.kind==='swap'?'Troca de bateria':'Checklist')} • ${esc(h.details)}</small><small>${esc(h.obs)}</small><small>${esc(h.operator)}</small></div><div class="history-right"><span class="badge ${esc(h.status)}">${esc(h.kind==='swap'?'TROCA':statusLabel[h.status])}</span><time>${esc(fmt(h.createdAt))}</time></div></div>`).join(''):'<div class="empty">Sem registros.</div>'}
function setTab(tab){currentTab=tab;$$('#nav button').forEach(b=>{const active=b.dataset.tab===tab;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});const hist=tab==='historico';$('#historySection').classList.toggle('hidden',!hist);$('#equipmentsSection').classList.toggle('hidden',hist);$('#statusFilter').closest('.toolbar-right').classList.toggle('hidden',hist);hist?loadHistory():renderEquipment()}

function renderCheckItems(type){$('#checkItems').innerHTML=(templates[type]||[]).map((item,i)=>`<div class="check-row"><label for="check-item-${i}">${esc(item)}</label><select id="check-item-${i}" data-checkitem="${i}" aria-label="Resultado: ${esc(item)}"><option value="ok">OK</option><option value="warn">Atenção</option><option value="crit">Crítico</option></select></div>`).join('')}
function refreshEquipmentSelect(type,selectedId=''){
  const list=equipment.filter(e=>e.active&&e.type===type);$('#ckEquipment').innerHTML=list.map(e=>`<option value="${e.id}" ${e.id===selectedId?'selected':''}>${esc(e.code)} · ${esc(e.name)}</option>`).join('');
  const target=equipment.find(e=>e.id===$('#ckEquipment').value)||list[0];if(target){checkVersion=target.version;checkTemplateId=templateVersions.find(t=>t.type===type)?.id;$('#ckStatus').value=target.status;$('#ckOperator').value=currentUser?.name||target.operator||'';$('#ckObservation').value='';$('#ckLiters').value=target.liters||'';$('#ckWater').value='Cheio'}
  const showBattery=type==='bateria';$$('.battery-field').forEach(el=>el.classList.toggle('hidden',!showBattery));renderCheckItems(type)
}
function openChecklist(id=''){
  let target=equipment.find(e=>e.id===id&&e.active);if(!target)target=equipment.find(e=>e.active&&e.type===(currentTab==='historico'?'bateria':currentTab))||equipment.find(e=>e.active);
  if(!target){toast('Nenhum equipamento ativo.');return}if(!templates[target.type]?.length){toast('Solicite a publicação do modelo de checklist para este tipo.');return}$('#ckType').value=target.type;refreshEquipmentSelect(target.type,target.id);$('#checklistDialog').showModal()
}
function renderAdmin(){
  if(currentUser?.role!=='adm')return;
  const active=equipment.filter(e=>e.active),openIssues=issues.filter(i=>i.status!=='resolved');
  $('#admActive').textContent=active.length;$('#admIssues').textContent=openIssues.length;$('#admToday').textContent=history.filter(h=>h.kind==='checklist').length;$('#admUsers').textContent=users.filter(u=>u.active).length;
  $('#admOk').textContent=active.filter(e=>e.status==='ok').length;$('#admWarn').textContent=active.filter(e=>e.status==='warn').length;$('#admCrit').textContent=active.filter(e=>e.status==='crit').length;$('#admInactive').textContent=equipment.filter(e=>!e.active).length;
  $('#admRecent').innerHTML=issues.slice(0,4).map(i=>`<div class="list-row"><div class="main"><b>${esc(i.code)} · ${esc(i.name)}</b><small>${esc(i.summary)}</small></div><span class="badge ${esc(i.severity)}">${i.status==='resolved'?'RESOLVIDA':i.status==='in_progress'?'EM TRATAMENTO':'ABERTA'}</span></div>`).join('')||'<div class="empty">Nenhuma ocorrência.</div>';
  $('#admChecklistList').innerHTML=history.filter(h=>h.kind==='checklist').slice(0,8).map(h=>`<div class="list-row"><div class="main"><b>${esc(h.equipment)}</b><small>${esc(h.operator)} • ${esc(fmt(h.createdAt))}</small></div><span class="badge ${esc(h.status)}">${statusLabel[h.status]}</span></div>`).join('');
  $('#sumBat').textContent=active.filter(e=>e.type==='bateria').length;$('#sumEmp').textContent=active.filter(e=>e.type==='empilhadeira').length;$('#sumTab').textContent=active.filter(e=>e.type==='tablet').length;$('#sumHist').textContent=history.length;
  renderAdminEquipment();renderIssues();renderUsers();renderTemplates();renderAudit();renderReports();
}
function renderAdminEquipment(){
  const q=($('#admEquipSearch')?.value||'').toLowerCase(),t=$('#admEquipType')?.value||'all';const rows=equipment.filter(e=>(t==='all'||e.type===t)&&(!q||`${e.code} ${e.name}`.toLowerCase().includes(q)));
  $('#equipmentAdminList').innerHTML=rows.map(e=>`<div class="list-row"><div class="main"><b>${esc(e.code)} · ${esc(e.name)}</b><small>${typeLabel[e.type]} • ${e.active?'Ativo':'Inativo'} • ${statusLabel[e.status]}</small></div><div class="controls"><button class="btn small" data-edit-equipment="${e.id}">Editar</button><button class="btn small ${e.active?'warn':'primary'}" data-toggle-equipment="${e.id}">${e.active?'Desativar':'Ativar'}</button><button class="btn small" data-admin-check="${e.id}">Checklist</button></div></div>`).join('')||'<div class="empty">Nenhum equipamento.</div>'
}
function renderIssues(){
  $('#issuesList').innerHTML=issues.map(i=>`<div class="list-row"><div class="main"><b>${esc(i.code)} · ${esc(i.name)}</b><small>${esc(i.summary)}</small><small>Status: ${i.status==='resolved'?'Resolvida':i.status==='in_progress'?'Em tratamento':'Aberta'}${i.resolution?` • ${esc(i.resolution)}`:''}</small></div><div class="controls"><span class="badge ${esc(i.severity)}">${i.severity==='crit'?'CRÍTICO':'ATENÇÃO'}</span>${i.status!=='resolved'?`<button class="btn small" data-treat-issue="${i.id}">Tratar</button>`:''}</div></div>`).join('')||'<div class="empty">Nenhuma pendência.</div>'
}
function renderUsers(){
  $('#usersList').innerHTML=users.map(u=>`<div class="list-row"><div class="main"><b>${esc(u.name)}</b><small>${esc(u.username)} • ${u.role==='adm'?'ADM / TI':'Empilhador / Operador'} • ${u.active?'Ativo':'Bloqueado'}</small></div><div class="controls"><button class="btn small" data-reset-user="${u.id}">Redefinir senha</button><button class="btn small ${u.active?'warn':'primary'}" data-toggle-user="${u.id}">${u.active?'Bloquear':'Ativar'}</button></div></div>`).join('')
}
function renderTemplates(){
  $('#templatesList').innerHTML=Object.entries(templates).map(([type,items],idx)=>`<div class="admin-card"><h3>${typeLabel[type]} • v${templateVersions.find(t=>t.type===type)?.version}</h3><p>${items.length} itens ativos</p><div class="list">${items.map(x=>`<div class="list-row"><div class="main"><b>${esc(x)}</b><small>Item obrigatório</small></div></div>`).join('')}</div><button class="btn small template-edit-spacing" data-template-edit="${type}">Editar modelo</button></div>`).join('')
}
function renderAudit(){
  $('#auditBody').innerHTML=audit.length?audit.map(a=>`<tr><td>${esc(fmt(a.at))}</td><td>${esc(a.user)}</td><td>${esc(a.event)}</td><td>${esc(a.origin)}</td><td>${esc(a.detail)}</td></tr>`).join(''):`<tr><td colspan="5">${auditLoaded?'Nenhum evento encontrado.':'Os eventos serão carregados ao abrir esta página.'}</td></tr>`
}
function renderReports(){
  const active=equipment.filter(e=>e.active),good=active.filter(e=>e.status==='ok').length,pct=active.length?Math.round(good/active.length*100):0;$('#complianceBar').value=pct;$('#complianceText').textContent=pct+'%';$('#reportHist').textContent=history.length;$('#reportIssues').textContent=issues.filter(i=>i.status!=='resolved').length;$('#reportEquip').textContent=active.length
}

function openEquipmentDialog(id=null){editingEquipmentId=id;const e=equipment.find(x=>x.id===id);$('#equipmentDialogTitle').textContent=e?'Editar equipamento':'Adicionar equipamento';$('#eqCode').value=e?.code||'';$('#eqName').value=e?.name||'';$('#eqType').value=e?.type||'bateria';$('#eqStatus').value=e?.status||'unchecked';$('#eqType').disabled=!!e;$('#equipmentDialog').showModal()}
function openIssue(id){const i=issues.find(x=>x.id===id);if(!i)return;$('#issueId').value=i.id;$('#issueEquipment').value=`${i.code} · ${i.name}`;$('#issueStatus').value=i.status==='open'?'in_progress':i.status;$('#issueResolution').value=i.resolution||'';$('#issueDialog').showModal()}
async function refresh(){
  const d=await SeleneApi.request('/checklist/state');equipment=d.equipment;if(currentTab!=='historico')history=d.history;else await loadHistory();issues=d.issues;templateVersions=d.templates;templates=Object.fromEntries(d.templates.map(x=>[x.type,x.questions]));
  $('#todayText').textContent='Data operacional '+d.operationalDate;$('#serverTime').textContent='Servidor '+fmt(d.serverTime);$('#shiftLabel').textContent=d.shift;
  if(SeleneApi.has('users:view'))users=(await SeleneApi.request('/users')).users.map(u=>({...u,id:String(u.id),name:u.nome,username:u.matricula}));
  if(SeleneApi.has('audit:view')&&auditLoaded)await loadAudit(true);
  calcKPIs();renderEquipment();renderHistory();renderAdmin();
}
async function loadAudit(force=false){
  if(!SeleneApi.has('audit:view'))return;
  if(auditLoaded&&!force){renderAudit();return;}
  if(auditLoading)return auditLoading;
  auditLoading=SeleneApi.request('/audit-secure').then(result=>{audit=result.events.map(a=>({at:a.time,user:a.actorName,event:a.action,origin:a.source,detail:a.details}));auditLoaded=true;renderAudit();}).finally(()=>{auditLoading=null;});
  return auditLoading;
}
async function command(path,body={},method='POST'){try{const r=await SeleneApi.mutate(path,body,method);await refresh();return r;}catch(error){toast(error.message);if(error.status===409)await refresh().catch(()=>{});return null;}}
async function enterWithIdentity(identity){
  currentUser={...identity,id:String(identity.id),name:identity.nome,username:identity.matricula,backendRole:identity.role,role:identity.permissions.some(p=>['equipment:manage','users:view','audit:view','issues:resolve'].includes(p))?'adm':'emp'};
  await refresh();$('#loginError').classList.add('hidden');$('#loginScreen').classList.add('hidden');$('#appScreen').classList.remove('hidden');applyUser();$('#ckOperator').value=currentUser.name;showOperation();
  if(!events){events=new EventSource('/api/site-selene/events');events.addEventListener('refresh',()=>refresh().catch(()=>{}));events.addEventListener('expired',()=>location.reload());}
  clearInterval(poll);poll=setInterval(()=>refresh().catch(()=>{}),15000);
  const state=await SeleneApi.request('/state');if(!state.tablet)await selectDevice();
}
async function selectDevice(){const state=await SeleneApi.request('/state');const list=state.data.registeredDevices.filter(d=>currentUser.backendRole!=='empilhador'||d.type==='tablet');if(!list.length){toast('Nenhum dispositivo cadastrado. Solicite cadastro ao Encarregado ou TI.');return;}const input=await SeleneApi.dialog('Equipamento desta sessão',[{name:'device',label:'Dispositivo',options:list.map(d=>({value:d.id,label:d.name}))}]);if(input&&await command('/devices/select',{device_id:Number(input.device)}))toast('Dispositivo vinculado.');}
async function logout(){try{await SeleneApi.mutate('/auth/logout');SeleneApi.clear();location.reload();}catch(e){toast(e.message);}}
async function saveChecklist(ev){
  ev.preventDefault();const item=equipment.find(e=>e.id===$('#ckEquipment').value),template=templateVersions.find(t=>t.type===item?.type);if(!item||!template)return;
  const payload={equipment_id:Number(item.id),equipment_version:checkVersion,template_version_id:checkTemplateId,answers:$$('#checkItems select').map(s=>s.value),observation:$('#ckObservation').value,water:item.type==='bateria'?$('#ckWater').value:null,liters:item.type==='bateria'?Number($('#ckLiters').value.replace(',','.')):null};
  if(await command('/checklist/records',payload)){$('#checklistDialog').close();toast('Checklist registrado. Histórico preservado.');}
}
async function saveEquipment(ev){ev.preventDefault();const old=equipment.find(e=>e.id===editingEquipmentId),body={code:$('#eqCode').value,name:$('#eqName').value,type:$('#eqType').value};if(old)Object.assign(body,{version:old.version,active:old.active});if(await command(old?'/equipment/'+old.id:'/equipment',body,old?'PUT':'POST')){$('#equipmentDialog').close();toast('Equipamento salvo.');}}
async function toggleEquipment(item){await command('/equipment/'+item.id,{code:item.code,name:item.name,type:item.type,version:item.version,active:!item.active},'PUT');}
async function saveUser(ev){ev.preventDefault();if(await command('/users',{nome:$('#usrName').value,matricula:$('#usrUser').value,senha:$('#usrPass').value,role:$('#usrRole').value})){$('#usrPass').value='';$('#userDialog').close();toast('Usuário criado.');}}
async function saveIssue(ev){ev.preventDefault();const i=issues.find(x=>x.id===$('#issueId').value);if(i&&await command('/issues/'+i.id,{version:i.version,status:$('#issueStatus').value.toUpperCase(),reason:$('#issueResolution').value},'PATCH')){$('#issueDialog').close();toast('Tratamento registrado.');}}
async function editTemplate(type){
  const old=templateVersions.find(t=>t.type===type);const input=await SeleneApi.dialog('Publicar versão de checklist',[{name:'type',label:'Tipo',value:type,options:Object.entries(typeLabel).map(([value,label])=>({value,label}))},{name:'name',label:'Nome',value:old?.name||'',required:true},{name:'questions',label:'Uma pergunta obrigatória por linha',type:'textarea',value:old?.questions.join('\n')||'',max:20000,required:true}]);
  if(input){const current=templateVersions.find(t=>t.type===input.type);if(await command('/checklist/templates',{type:input.type,name:input.name,questions:input.questions.split('\n').map(x=>x.trim()).filter(Boolean),expected_version:current?.version||0}))toast('Nova versão publicada. Registros anteriores preservados.');}
}
async function swapBattery(){
  const batteries=equipment.filter(x=>x.type==='bateria'&&x.active).map(x=>({value:x.id,label:x.code+' · '+x.name})),forklifts=equipment.filter(x=>x.type==='empilhadeira'&&x.active).map(x=>({value:x.id,label:x.code+' · '+x.name}));
  if(!batteries.length||!forklifts.length){toast('Cadastre bateria e empilhadeira antes de registrar uma troca.');return;}
  const input=await SeleneApi.dialog('Troca de bateria',[{name:'forklift_id',label:'Empilhadeira',options:forklifts},{name:'removed_id',label:'Bateria retirada',options:[{value:'',label:'Primeiro vínculo'},...batteries]},{name:'installed_id',label:'Bateria instalada',options:batteries},{name:'out_meter',label:'Horímetro de saída',type:'number',min:0,step:'0.1',required:true},{name:'in_meter',label:'Horímetro de entrada',type:'number',min:0,step:'0.1',required:true},{name:'observation',label:'Observação',type:'textarea'}]);
  if(input&&await command('/battery-swaps',{...input,forklift_id:Number(input.forklift_id),removed_id:input.removed_id?Number(input.removed_id):null,installed_id:Number(input.installed_id),out_meter:Number(input.out_meter),in_meter:Number(input.in_meter)}))toast('Troca registrada.');
}
function report(kind,format){SeleneApi.download('/reports/'+kind+'.'+format,'selene-'+kind+'.'+format).catch(e=>toast(e.message));}
let historyPage=1;
async function loadHistory(){try{const r=await SeleneApi.request(($('#historyKind').value==='swap'?'/battery-swaps':'/checklist/history')+'?'+new URLSearchParams({page:historyPage,q:$('#searchInput').value}));history=r.rows;renderHistory();$('#historyPage').textContent='Página '+historyPage;$('#historyPrev').disabled=historyPage<=1;$('#historyNext').disabled=!r.hasMore;}catch(e){toast(e.message);}}
$('#historyPrev').onclick=()=>{historyPage--;loadHistory();};$('#historyNext').onclick=()=>{historyPage++;loadHistory();};$('#historyKind').onchange=()=>{historyPage=1;loadHistory();};
$('#accessCode').addEventListener('input',e=>{e.target.value=e.target.value.replace(/\D/g,'').slice(0,6);});
$('#loginForm').addEventListener('submit',async e=>{e.preventDefault();const button=e.target.querySelector('[type=submit]');button.disabled=true;try{const result=await SeleneApi.mutate('/codes/redeem',{code:$('#accessCode').value});$('#accessCode').value='';await enterWithIdentity(result.user);}catch(error){$('#loginError').textContent=error.message;$('#loginError').classList.remove('hidden');}finally{button.disabled=false;}});
$('#menuBtn').onclick=openSidebar;$('#closeSidebar').onclick=closeSidebar;$('#backdrop').onclick=closeSidebar;$('#logoutBtn').onclick=logout;$('#sideLogout').onclick=logout;$('#backToOperation').onclick=showOperation;
$('#refreshChecklistBtn').onclick=async()=>{const button=$('#refreshChecklistBtn');button.disabled=true;try{await refresh();toast('Dados atualizados.');}catch(error){toast(error.message);}finally{button.disabled=false;}};
$('#sideNav').onclick=e=>{const b=e.target.closest('[data-admin-page]');if(b)showAdmin(b.dataset.adminPage);};
document.addEventListener('click',async e=>{
  const select=a=>e.target.closest('['+a+']');
  if(select('data-admin-page-jump'))showAdmin(select('data-admin-page-jump').dataset.adminPageJump);
  if(select('data-open-checklist'))openChecklist();
  if(select('data-check'))openChecklist(select('data-check').dataset.check);
  if(select('data-admin-check'))openChecklist(select('data-admin-check').dataset.adminCheck);
  if(select('data-edit-equipment'))openEquipmentDialog(select('data-edit-equipment').dataset.editEquipment);
  if(select('data-toggle-equipment'))await toggleEquipment(equipment.find(x=>x.id===select('data-toggle-equipment').dataset.toggleEquipment));
  if(select('data-treat-issue'))openIssue(select('data-treat-issue').dataset.treatIssue);
  if(select('data-reset-user')){const u=users.find(x=>x.id===select('data-reset-user').dataset.resetUser),input=await SeleneApi.dialog('Redefinir senha de '+u.name,[{name:'senha',label:'Nova senha (mínimo 12 caracteres)',type:'password',required:true,max:128}]);if(input)await command('/users/'+encodeURIComponent(u.username),{action:'password',senha:input.senha},'PATCH');}
  if(select('data-toggle-user')){const u=users.find(x=>x.id===select('data-toggle-user').dataset.toggleUser);await command('/users/'+encodeURIComponent(u.username),{action:'active',active:!u.active},'PATCH');}
  if(select('data-template-edit'))await editTemplate(select('data-template-edit').dataset.templateEdit);
  if(select('data-close'))$('#'+select('data-close').dataset.close).close();
});
$('#nav').onclick=e=>{const b=e.target.closest('[data-tab]');if(b)setTab(b.dataset.tab);};$('#searchInput').oninput=()=>currentTab==='historico'?renderHistory():renderEquipment();$('#statusFilter').onchange=renderEquipment;
$('#newChecklistBtn').onclick=()=>openChecklist();$('#printBtn').onclick=()=>report('checklist','pdf');$('#exportBtn').onclick=()=>report('checklist','csv');$('#ckType').onchange=e=>refreshEquipmentSelect(e.target.value);$('#ckEquipment').onchange=()=>refreshEquipmentSelect($('#ckType').value,$('#ckEquipment').value);$('#checklistForm').onsubmit=saveChecklist;
$('#goOperationBtn').onclick=showOperation;$('#addEquipmentBtn').onclick=()=>openEquipmentDialog();$('#equipmentForm').onsubmit=saveEquipment;$('#admEquipSearch').oninput=renderAdminEquipment;$('#admEquipType').onchange=renderAdminEquipment;$('#addUserBtn').onclick=()=>{$('#userForm').reset();$('#userDialog').showModal();};$('#userForm').onsubmit=saveUser;$('#issueForm').onsubmit=saveIssue;
$('#refreshIssues').onclick=()=>refresh().catch(e=>toast(e.message));$('#downloadAudit').onclick=()=>report('audit','csv');$('#newTemplateBtn').onclick=()=>editTemplate('bateria');$('#reportCsv').onclick=()=>report('checklist','csv');$('#reportPdf').onclick=()=>report('checklist','pdf');$('#backupBtn').onclick=()=>toast('Consulte OPERACAO.md: backup criptografado e restore por administrador autorizado.');
$('#healthBtn').onclick=async()=>{try{const r=await SeleneApi.request('/security/status');$('#healthResult').textContent='Servidor '+r.version+' · Banco '+r.database+' · Integração externa não configurada';}catch(e){$('#healthResult').textContent=e.message;}};
$('#saveUiSettings').onclick=()=>{const n=$('#gridSetting').value;sessionStorage.setItem('checklist-grid',n);document.documentElement.classList.remove('battery-cols-2','battery-cols-3','battery-cols-4','battery-cols-5','battery-cols-6');document.documentElement.classList.add('battery-cols-'+n);toast('Preferência visual salva nesta sessão.');};
$('#deviceButton').onclick=()=>selectDevice().catch(e=>toast(e.message));$('#swapButton').onclick=swapBattery;
document.addEventListener('security:expired',()=>{equipment=[];history=[];users=[];issues=[];audit=[];currentUser=null;location.replace('/checklist/');},{once:true});
document.addEventListener('server:connection',e=>{$('#offlineBanner').classList.toggle('hidden',e.detail.online);});
setInterval(()=>{if(currentUser)SeleneApi.mutate('/devices/heartbeat').catch(()=>{});},60000);
SeleneApi.session().then(r=>{if(r?.user)return enterWithIdentity(r.user);}).catch(e=>toast(e.message));

})();
