(()=>{
  'use strict';
  document.addEventListener('DOMContentLoaded',()=>{
    const b=document.createElement('button');b.className='btn btn-soft';b.type='button';b.textContent='Código Checklist';document.querySelector('.topbar-actions').prepend(b);
    const el=document.createElement('dialog');el.className='code-checklist-modal';
    el.innerHTML='<div class="code-checklist-card"><h3>Código do Checklist</h3><p>Uso único em outro aparelho. Validade de dois minutos.</p><div class="code-checklist-number">—</div><div class="code-checklist-meta" aria-live="polite"></div><div class="code-checklist-actions"><button class="btn btn-light" data-close>Fechar</button><button class="btn btn-light" data-revoke>Revogar</button><button class="btn btn-primary" data-generate>Gerar código</button></div><p class="code-checklist-status" role="status"></p><a href="/checklist/">Abrir Checklist</a></div>';
    document.body.append(el);let expires=0,interval;
    const status=el.querySelector('[role=status]'),number=el.querySelector('.code-checklist-number');
    function clock(){const n=Math.max(0,Math.ceil((expires-SeleneApi.now())/1000));el.querySelector('.code-checklist-meta').textContent=n?'Expira em '+n+' segundos':'Nenhum código ativo';if(!n)number.textContent='—';}
    b.onclick=()=>{el.showModal();clock();interval=setInterval(clock,1000);};el.querySelector('[data-close]').onclick=()=>el.close();el.onclose=()=>{clearInterval(interval);number.textContent='—';expires=0;};
    el.querySelector('[data-generate]').onclick=async event=>{event.target.disabled=true;try{const r=await SeleneApi.mutate('/codes');expires=r.expiresAt;number.textContent=r.code.slice(0,3)+' '+r.code.slice(3);status.textContent='Código criado para '+SeleneApi.user().nome+'.';clock();}catch(e){status.textContent=e.message;}finally{event.target.disabled=false;}};
    el.querySelector('[data-revoke]').onclick=async()=>{try{await SeleneApi.mutate('/codes',{},'DELETE');expires=0;clock();status.textContent='Código revogado.';}catch(e){status.textContent=e.message;}};
    document.addEventListener('security:clear',()=>{expires=0;number.textContent='—';el.close();});
  });
})();
