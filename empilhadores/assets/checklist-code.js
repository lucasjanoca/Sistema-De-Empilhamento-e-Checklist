(()=>{
  'use strict';
  const $=s=>document.querySelector(s);
  function roleForChecklist(role){return role==='ti'?'adm':'emp';}
  function ensureUi(){
    if($('#checklistCodeButton')) return;
    const actions=$('.topbar-actions');
    if(!actions) return;
    const button=document.createElement('button');
    button.id='checklistCodeButton';
    button.type='button';
    button.className='btn btn-soft code-checklist-btn';
    button.textContent='⌁ Código Checklist';
    const logout=$('#logoutButton');
    actions.insertBefore(button,logout||null);
    const dialog=document.createElement('dialog');
    dialog.id='checklistCodeModal';
    dialog.className='code-checklist-modal';
    dialog.innerHTML=`<div class="code-checklist-card">
      <h3>Código do Checklist</h3>
      <p>Gere um código temporário para entrar no Checklist com o mesmo usuário logado neste sistema.</p>
      <div class="code-checklist-number" id="checklistCodeNumber">--- ---</div>
      <div class="code-checklist-meta"><span id="checklistCodeUser">Usuário</span><span id="checklistCodeTimer">Nenhum código ativo</span></div>
      <div class="code-checklist-actions">
        <button class="btn btn-light" type="button" id="checklistCodeClose">Fechar</button>
        <button class="btn btn-soft" type="button" id="checklistCodeCopy" disabled>Copiar</button>
        <button class="btn btn-primary" type="button" id="checklistCodeGenerate">Gerar código</button>
      </div>
      <div class="code-checklist-status" id="checklistCodeStatus"></div>
    </div>`;
    document.body.appendChild(dialog);
    let timer=null,lastCode='';
    function currentUser(){try{return AppState.getUser?.()||null}catch{return null}}
    function render(){
      const s=InfoTechAccessCode.status();
      const timerEl=$('#checklistCodeTimer'),num=$('#checklistCodeNumber'),copy=$('#checklistCodeCopy');
      if(s.state==='active'){
        lastCode=s.record.code;num.textContent=InfoTechAccessCode.formatCode(lastCode);copy.disabled=false;
        const sec=Math.max(0,Math.ceil(s.remainingMs/1000));
        timerEl.textContent=`Expira em ${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
      }else{
        lastCode='';num.textContent='--- ---';copy.disabled=true;
        timerEl.textContent=s.state==='used'?'Código já utilizado':s.state==='expired'?'Código expirado':'Nenhum código ativo';
      }
    }
    function open(){
      const u=currentUser();
      if(!u){ UI?.toast?.('Entre no sistema antes de gerar um código.'); return; }
      $('#checklistCodeUser').textContent=`${u.nome} • ${u.matricula}`;
      $('#checklistCodeStatus').textContent='';render();dialog.showModal();clearInterval(timer);timer=setInterval(render,500);
    }
    button.addEventListener('click',open);
    $('#checklistCodeClose').addEventListener('click',()=>{dialog.close();clearInterval(timer)});
    $('#checklistCodeGenerate').addEventListener('click',()=>{
      const u=currentUser(); if(!u) return;
      const r=InfoTechAccessCode.generate({name:u.nome,matricula:u.matricula,role:roleForChecklist(u.role),sourceRole:u.role});
      lastCode=r.code;render();
      const s=$('#checklistCodeStatus');s.className='code-checklist-status ok';s.textContent='Código criado. Digite-o no Checklist em até 2 minutos.';
    });
    $('#checklistCodeCopy').addEventListener('click',async()=>{
      if(!lastCode)return;try{await navigator.clipboard.writeText(lastCode);$('#checklistCodeStatus').textContent='Código copiado.'}catch{$('#checklistCodeStatus').textContent='Copie o número exibido acima.'}
    });
    dialog.addEventListener('close',()=>clearInterval(timer));
  }
  document.addEventListener('DOMContentLoaded',()=>setTimeout(ensureUi,0));
})();
