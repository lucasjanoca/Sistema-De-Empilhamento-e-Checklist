(()=>{
  'use strict';
  const $=s=>document.querySelector(s);
  let remoteRecord=null;

  function roleForChecklist(role){return role==='ti'?'adm':'emp';}
  function cloudEnabled(){return location.protocol!=='file:'&&!!globalThis.InfoTechSupabaseAccounts;}

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
      const timerEl=$('#checklistCodeTimer'),num=$('#checklistCodeNumber'),copy=$('#checklistCodeCopy');

      if(cloudEnabled()){
        if(remoteRecord && Number(remoteRecord.expiresAt)>Date.now()){
          lastCode=String(remoteRecord.code||'');
          num.textContent=InfoTechAccessCode.formatCode(lastCode);
          copy.disabled=!lastCode;
          const sec=Math.max(0,Math.ceil((Number(remoteRecord.expiresAt)-Date.now())/1000));
          timerEl.textContent=`Expira em ${String(Math.floor(sec/60)).padStart(2,'0')}:${String(sec%60).padStart(2,'0')}`;
          return;
        }
        if(remoteRecord && Number(remoteRecord.expiresAt)<=Date.now()) remoteRecord=null;
        lastCode='';num.textContent='--- ---';copy.disabled=true;timerEl.textContent='Nenhum código ativo';
        return;
      }

      const s=InfoTechAccessCode.status();
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
      if(!u){UI?.toast?.('Entre no sistema antes de gerar um código.');return;}
      $('#checklistCodeUser').textContent=`${u.nome} • ${u.matricula}`;
      $('#checklistCodeStatus').textContent='';render();dialog.showModal();clearInterval(timer);timer=setInterval(render,500);
    }

    button.addEventListener('click',open);
    $('#checklistCodeClose').addEventListener('click',()=>{dialog.close();clearInterval(timer)});

    $('#checklistCodeGenerate').addEventListener('click',async()=>{
      const u=currentUser();if(!u)return;
      const btn=$('#checklistCodeGenerate'),status=$('#checklistCodeStatus');
      btn.disabled=true;status.className='code-checklist-status';status.textContent='Gerando código...';
      try{
        if(cloudEnabled()){
          const r=await globalThis.InfoTechSupabaseAccounts.generateChecklistCode();
          remoteRecord={code:r.code,expiresAt:r.expiresAt};
          lastCode=String(r.code||'');
        }else{
          const r=InfoTechAccessCode.generate({name:u.nome,matricula:u.matricula,role:roleForChecklist(u.role),sourceRole:u.role});
          lastCode=r.code;
        }
        render();status.className='code-checklist-status ok';
        status.textContent='Código criado. Ele pode ser usado no Checklist em outro aparelho por até 2 minutos.';
      }catch(error){
        status.className='code-checklist-status error';
        status.textContent=error?.message||'Não foi possível gerar o código.';
      }finally{btn.disabled=false;}
    });

    $('#checklistCodeCopy').addEventListener('click',async()=>{
      if(!lastCode)return;
      try{await navigator.clipboard.writeText(lastCode);$('#checklistCodeStatus').textContent='Código copiado.'}
      catch{$('#checklistCodeStatus').textContent='Copie o número exibido acima.'}
    });

    dialog.addEventListener('close',()=>clearInterval(timer));
  }

  document.addEventListener('DOMContentLoaded',()=>setTimeout(ensureUi,0));
})();