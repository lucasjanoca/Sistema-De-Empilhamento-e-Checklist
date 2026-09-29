(function(){
  'use strict';

  const SUPABASE_URL='https://yncspxfsvlqdnodlsosb.supabase.co';
  const PUBLISHABLE_KEY='sb_publishable_jALAHHuvrV5oxj2mugWTCQ_stD_vFyN';
  const EMP_API=SUPABASE_URL+'/functions/v1/empilhadores-api';
  const CHECKLIST_API=SUPABASE_URL+'/functions/v1/checklist-api';
  const SESSION_KEY='infotech_emp_supabase_session_v1';
  const CHECKLIST_SESSION_KEY='infotech_checklist_session_v1';

  let session=null;
  let sessionUser=null;

  function safeParse(value,fallback=null){try{return JSON.parse(value)}catch{return fallback}}
  function normalizeMatricula(value){
    return String(value||'').trim().toLowerCase().replace(/[^a-z0-9._-]/g,'');
  }
  function emailFor(matricula){
    const m=normalizeMatricula(matricula);
    return m ? m+'@empilhadores.selene.local' : '';
  }
  function readSession(){
    const stored=safeParse(sessionStorage.getItem(SESSION_KEY),null);
    return stored && stored.access_token ? stored : null;
  }
  function writeSession(next){
    session=next||null;
    sessionUser=next?.profile||null;
    if(session) sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  }
  function authHeaders(extra={}){
    return {'apikey':PUBLISHABLE_KEY,'Content-Type':'application/json',Accept:'application/json',...extra};
  }
  async function readJson(response){
    let payload=null;
    try{payload=await response.json()}catch{}
    if(!response.ok){
      const message=payload?.message||payload?.msg||payload?.error_description||payload?.error||('HTTP '+response.status);
      const error=new Error(message);
      error.status=response.status;
      error.payload=payload;
      throw error;
    }
    return payload||{};
  }
  async function refreshSession(){
    const current=session||readSession();
    if(!current?.refresh_token) throw new Error('Sessão expirada. Entre novamente.');
    const response=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',
      headers:authHeaders(),
      body:JSON.stringify({refresh_token:current.refresh_token}),
      cache:'no-store'
    });
    const payload=await readJson(response);
    const next={
      access_token:payload.access_token,
      refresh_token:payload.refresh_token||current.refresh_token,
      expires_at:payload.expires_at||Math.floor(Date.now()/1000)+(payload.expires_in||3600),
      profile:current.profile||null
    };
    writeSession(next);
    return next;
  }
  async function ensureSession(){
    const current=session||readSession();
    if(!current?.access_token) throw new Error('Sessão necessária.');
    session=current;
    sessionUser=current.profile||null;
    const expiresAt=Number(current.expires_at||0)*1000;
    if(expiresAt && expiresAt-Date.now()<60000){
      return refreshSession();
    }
    return current;
  }
  async function invokeEmp(action,payload={},retry=true){
    const current=await ensureSession();
    const response=await fetch(EMP_API,{
      method:'POST',
      headers:authHeaders({Authorization:'Bearer '+current.access_token}),
      body:JSON.stringify({action,...payload}),
      cache:'no-store'
    });
    if(response.status===401 && retry){
      await refreshSession();
      return invokeEmp(action,payload,false);
    }
    return readJson(response);
  }
  async function loadMe(){
    const result=await invokeEmp('me');
    const profile=result.user||null;
    if(!profile) throw new Error('Perfil do usuário não encontrado.');
    const current=session||readSession()||{};
    writeSession({...current,profile});
    return profile;
  }
  async function init(){
    session=readSession();
    sessionUser=session?.profile||null;
    if(!session) return null;
    try{
      await ensureSession();
      return await loadMe();
    }catch(error){
      writeSession(null);
      return null;
    }
  }
  async function login(matricula,senha){
    const email=emailFor(matricula);
    if(!email||!senha) throw new Error('Preencha a matrícula e a senha.');
    const response=await fetch(SUPABASE_URL+'/auth/v1/token?grant_type=password',{
      method:'POST',
      headers:authHeaders(),
      body:JSON.stringify({email,password:String(senha)}),
      cache:'no-store'
    });
    let payload;
    try{payload=await readJson(response)}catch(error){
      if(error.status===400||error.status===401) throw new Error('Senha ou matrícula incorreta.');
      throw error;
    }
    writeSession({
      access_token:payload.access_token,
      refresh_token:payload.refresh_token,
      expires_at:payload.expires_at||Math.floor(Date.now()/1000)+(payload.expires_in||3600),
      profile:null
    });
    try{
      const profile=await loadMe();
      if(profile.active===false) throw new Error('Este usuário está bloqueado. Procure o Encarregado ou TI.');
      return {ok:true,user:profile};
    }catch(error){
      writeSession(null);
      throw error;
    }
  }
  async function logout(){
    const current=session||readSession();
    if(current?.access_token){
      try{
        await fetch(SUPABASE_URL+'/auth/v1/logout',{
          method:'POST',
          headers:authHeaders({Authorization:'Bearer '+current.access_token}),
          body:'{}',
          cache:'no-store'
        });
      }catch{}
    }
    writeSession(null);
  }
  async function loadUsers(){return (await invokeEmp('list-users')).users||[]}
  async function createUser(payload){return invokeEmp('create-user',payload)}
  async function changePassword(matricula,senha){return invokeEmp('update-user',{matricula,updateType:'password',senha})}
  async function changeRole(matricula,role){return invokeEmp('update-user',{matricula,updateType:'role',role})}
  async function setActive(matricula,active){return invokeEmp('update-user',{matricula,updateType:'active',active})}
  async function deleteUser(matricula){return invokeEmp('delete-user',{matricula})}
  async function generateChecklistCode(){return invokeEmp('generate-code')}

  async function validateChecklistCode(code){
    const digits=String(code||'').replace(/\D/g,'');
    if(digits.length!==6) throw new Error('Digite os 6 números do código.');
    const response=await fetch(CHECKLIST_API,{
      method:'POST',
      headers:{
        'apikey':PUBLISHABLE_KEY,
        'Content-Type':'application/json',
        Accept:'application/json'
      },
      body:JSON.stringify({code:digits}),
      cache:'no-store'
    });
    return readJson(response);
  }

  function storeChecklistSession(result){
    const sourceRole=result?.user?.role||'empilhador';
    const identity={
      name:String(result?.user?.nome||'Operador'),
      matricula:String(result?.user?.matricula||''),
      role:sourceRole==='ti'?'adm':'emp',
      sourceRole
    };
    const stored={
      identity,
      authenticatedAt:Date.now(),
      source:'supabase_temporary_code',
      token:result?.token||'',
      expiresAt:Number(result?.expiresAt||0)
    };
    sessionStorage.setItem(CHECKLIST_SESSION_KEY,JSON.stringify(stored));
    return stored;
  }

  window.InfoTechSupabaseAccounts={
    init,
    login,
    logout,
    getSessionUser:()=>sessionUser,
    hasSession:()=>!!(session||readSession()),
    loadUsers,
    createUser,
    changePassword,
    changeRole,
    setActive,
    deleteUser,
    generateChecklistCode,
    validateChecklistCode,
    storeChecklistSession
  };
})();