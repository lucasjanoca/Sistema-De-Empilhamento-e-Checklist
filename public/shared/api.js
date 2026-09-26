'use strict';
const SeleneApi = (() => {
  const base='/api/site-selene';
  let csrf='', user=null, online=false, serverEpoch=0, clockStart=0, activityAt=0;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function connection(value){online=value;document.documentElement.classList.toggle('server-offline',!value);document.dispatchEvent(new CustomEvent('server:connection',{detail:{online:value}}));}
  function syncClock(time){if(Number.isFinite(time)){serverEpoch=time;clockStart=performance.now();}}
  function now(){return serverEpoch ? serverEpoch+performance.now()-clockStart : Date.now();}
  function remember(data){if(data.csrfToken)csrf=data.csrfToken;if(data.user)user=data.user;syncClock(data.serverTime);return data;}
  async function request(path,options={}){
    const method=options.method||'GET';
    const headers={Accept:'application/json',...options.headers};
    if(method!=='GET'){headers['Content-Type']='application/json';headers['X-CSRF-Token']=csrf;headers['Idempotency-Key']=options.key||crypto.randomUUID();}
    let response;
    try{response=await fetch(base+path,{credentials:'same-origin',cache:'no-store',...options,headers,signal:AbortSignal.timeout(20000)});}catch{
      connection(false);throw new Error(method==='GET'?'Servidor indisponível. Reconecte para continuar.':'Resposta não recebida. Consulte o estado antes de repetir a operação.');
    }
    connection(true);
    const payload=await response.json().catch(()=>({message:'Resposta inválida do servidor.'}));
    if(!response.ok){
      if(response.status===401&&!['/auth/login','/codes/redeem'].includes(path)){const hadUser=!!user;clear();if(hadUser)document.dispatchEvent(new Event('security:expired'));}
      const error=new Error(payload.message||'Operação não concluída.');error.status=response.status;error.payload=payload;throw error;
    }
    return remember(payload);
  }
  const mutate=(path,body={},method='POST')=>request(path,{method,body:JSON.stringify(body)});
  function clear(){csrf='';user=null;serverEpoch=0;document.dispatchEvent(new Event('security:clear'));}
  async function session(){try{return await request('/auth/me');}catch(error){if(error.status!==401)throw error;return null;}}
  async function download(path,filename){
    const response=await fetch(base+path,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok){const data=await response.json();throw new Error(data.message||'Exportação não concluída.');}
    const link=document.createElement('a'),url=URL.createObjectURL(await response.blob());link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function dialog(title,fields,submit='Confirmar'){
    return new Promise(resolve=>{
      const el=document.createElement('dialog');el.className='server-form-dialog';
      el.innerHTML=`<form class="dialog-form"><h3>${esc(title)}</h3>${fields.map(f=>`<label class="field"><span>${esc(f.label)}</span>${f.options?`<select name="${esc(f.name)}">${f.options.map(o=>`<option value="${esc(o.value)}" ${String(o.value)===String(f.value)?'selected':''}>${esc(o.label)}</option>`).join('')}</select>`:f.type==='textarea'?`<textarea name="${esc(f.name)}" maxlength="${f.max||1000}" ${f.required?'required':''}>${esc(f.value||'')}</textarea>`:`<input name="${esc(f.name)}" type="${esc(f.type||'text')}" value="${esc(f.value??'')}" ${f.required?'required':''} ${f.min!==undefined?`min="${f.min}"`:''} ${f.step?`step="${f.step}"`:''} maxlength="${f.max||500}" autocomplete="${f.type==='password'?'new-password':'off'}">`}</label>`).join('')}<div class="dialog-actions"><button type="button" class="btn btn-light">Cancelar</button><button class="btn btn-primary" type="submit">${esc(submit)}</button></div></form>`;
      let done=false;function finish(value){if(done)return;done=true;el.close();el.remove();resolve(value);}
      el.querySelector('form').onsubmit=e=>{e.preventDefault();finish(Object.fromEntries(new FormData(e.target)));};el.querySelector('[type=button]').onclick=()=>finish(null);el.oncancel=e=>{e.preventDefault();finish(null);};document.body.append(el);el.showModal();el.querySelector('input,textarea,select')?.focus();
    });
  }
  async function reauth(){const input=await dialog('Confirmar identidade',[{name:'senha',label:'Senha atual',type:'password',required:true,max:128}]);if(input)await mutate('/auth/reauth',input);return !!input;}
  async function activity(event){if(!event.isTrusted||!user||performance.now()-activityAt<60000)return;activityAt=performance.now();try{await mutate('/auth/activity');}catch{}}
  document.addEventListener('pointerdown',activity,{passive:true});document.addEventListener('keydown',activity,{passive:true});
  window.addEventListener('offline',()=>connection(false));
  return {request,mutate,session,remember,clear,download,dialog,reauth,esc,now,syncClock,user:()=>user,online:()=>online,has:p=>!!user?.permissions?.includes(p)};
})();
