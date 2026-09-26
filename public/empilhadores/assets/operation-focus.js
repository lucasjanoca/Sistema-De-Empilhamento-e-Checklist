(()=>{
  'use strict';
  const KEY='site_selene_operation_focus_v20';
  const $=id=>document.getElementById(id);
  const button=()=>$('operationFocusButton');
  const scrollBox=()=>$('palletUnifiedScroll');

  function safeText(id,fallback='—'){
    const el=$(id); return (el?.textContent||'').trim()||fallback;
  }
  function currentUser(){
    try{
      const u=AppState.getUser();
      return u?.nome||u?.matricula||safeText('currentUserLabel','Operador');
    }catch{return safeText('currentUserLabel','Operador');}
  }
  function updateStatus(){
    const box=$('operationFocusStatus'); if(!box)return;
    const tablet=safeText('currentTabletBadge','Dispositivo');
    const req=safeText('currentProductionRequest','Sem requisição');
    box.innerHTML=`<span>👤 ${escapeHtml(currentUser())}</span><span>▣ ${escapeHtml(tablet.replace(/^Tablet:\s*/i,''))}</span><span>▤ ${escapeHtml(req)}</span>`;
  }
  function escapeHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}
  function setMode(on,{persist=true}={}){
    document.body.classList.toggle('operation-focus-mode',!!on);
    const b=button();
    if(b){b.classList.toggle('is-active',!!on);b.setAttribute('aria-pressed',String(!!on));b.textContent=on?'✕ Sair da Tela de Paletes':'⛶ Tela de Paletes';}
    if(persist){try{sessionStorage.setItem(KEY,on?'1':'0');}catch{}}
    updateStatus();
    setTimeout(()=>scrollBox()?.focus({preventScroll:true}),50);
  }
  function isOperationVisible(){return $('view-operacao')?.classList.contains('active');}
  function init(){
    const b=button(); if(!b)return;
    b.addEventListener('click',()=>setMode(!document.body.classList.contains('operation-focus-mode')));
    document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('operation-focus-mode'))setMode(false);});
    document.addEventListener('view:changed',e=>{
      if(e.detail?.name!=='operacao'&&document.body.classList.contains('operation-focus-mode'))setMode(false,{persist:false});
      if(e.detail?.name==='operacao'){updateStatus();let saved=false;try{saved=sessionStorage.getItem(KEY)==='1';}catch{}if(saved)setMode(true,{persist:false});}
    });
    ['currentTabletBadge','currentProductionRequest','currentUserLabel'].forEach(id=>{
      const el=$(id); if(el)new MutationObserver(updateStatus).observe(el,{subtree:true,childList:true,characterData:true,attributes:true});
    });
    let saved=false;try{saved=sessionStorage.getItem(KEY)==='1';}catch{}
    if(saved&&isOperationVisible())setMode(true,{persist:false});
    updateStatus();
  }
  document.addEventListener('DOMContentLoaded',init);
})();
