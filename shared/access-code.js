(function(){
  'use strict';
  const CODE_KEY='infotech_shared_access_code_v1';
  const ATTEMPT_KEY='infotech_shared_access_attempts_v1';
  const SESSION_KEY='infotech_checklist_session_v1';
  const TTL_MS=120000;
  const MAX_ATTEMPTS=5;
  const WINDOW_MS=30000;
  const LOCK_MS=60000;

  function now(){return Date.now()}
  function safeParse(v,fallback=null){try{return JSON.parse(v)}catch{return fallback}}
  function normalizeCode(v){return String(v||'').replace(/\D/g,'').slice(0,6)}
  function formatCode(v){const c=normalizeCode(v);return c.length>3?c.slice(0,3)+' '+c.slice(3):c}
  function randomCode(){
    const a=new Uint32Array(1);
    crypto.getRandomValues(a);
    return String(100000+(a[0]%900000));
  }
  function getStored(){
    const data=safeParse(localStorage.getItem(CODE_KEY));
    if(!data) return null;
    if(data.used || !data.expiresAt || data.expiresAt<=now()) return null;
    return data;
  }
  function generate(identity={}){
    const code=randomCode();
    const record={
      code,
      issuedAt:now(),
      expiresAt:now()+TTL_MS,
      used:false,
      identity:{
        name:String(identity.name||'Operador').trim()||'Operador',
        matricula:String(identity.matricula||'').trim(),
        role:identity.role==='adm'?'adm':'emp'
      }
    };
    localStorage.setItem(CODE_KEY,JSON.stringify(record));
    return {...record,formatted:formatCode(code)};
  }
  function attempts(){
    const a=safeParse(localStorage.getItem(ATTEMPT_KEY),{items:[],lockedUntil:0});
    a.items=Array.isArray(a.items)?a.items.filter(t=>now()-t<WINDOW_MS):[];
    a.lockedUntil=Number(a.lockedUntil||0);
    return a;
  }
  function saveAttempts(a){localStorage.setItem(ATTEMPT_KEY,JSON.stringify(a))}
  function validate(input){
    const a=attempts();
    if(a.lockedUntil>now()){
      return {ok:false,reason:'locked',retryAt:a.lockedUntil};
    }
    const code=normalizeCode(input);
    if(code.length!==6){
      return {ok:false,reason:'invalid_format'};
    }
    const record=safeParse(localStorage.getItem(CODE_KEY));
    if(!record){
      return failAttempt(a,'not_found');
    }
    if(record.used){
      return failAttempt(a,'used');
    }
    if(!record.expiresAt || record.expiresAt<=now()){
      localStorage.removeItem(CODE_KEY);
      return failAttempt(a,'expired');
    }
    if(record.code!==code){
      return failAttempt(a,'wrong');
    }
    record.used=true;
    record.usedAt=now();
    localStorage.setItem(CODE_KEY,JSON.stringify(record));
    localStorage.removeItem(ATTEMPT_KEY);
    const session={identity:record.identity,authenticatedAt:now(),source:'temporary_code'};
    sessionStorage.setItem(SESSION_KEY,JSON.stringify(session));
    return {ok:true,identity:record.identity,session};
  }
  function failAttempt(a,reason){
    a.items.push(now());
    if(a.items.length>=MAX_ATTEMPTS){
      a.lockedUntil=now()+LOCK_MS;
      a.items=[];
    }
    saveAttempts(a);
    return {ok:false,reason,lockedUntil:a.lockedUntil||0};
  }
  function currentSession(){return safeParse(sessionStorage.getItem(SESSION_KEY))}
  function clearSession(){sessionStorage.removeItem(SESSION_KEY)}
  function revokeCode(){localStorage.removeItem(CODE_KEY)}
  function status(){
    const r=safeParse(localStorage.getItem(CODE_KEY));
    if(!r) return {state:'none'};
    if(r.used) return {state:'used',record:r};
    if(r.expiresAt<=now()) return {state:'expired',record:r};
    return {state:'active',record:r,remainingMs:r.expiresAt-now()};
  }
  window.InfoTechAccessCode={generate,validate,currentSession,clearSession,revokeCode,status,normalizeCode,formatCode,TTL_MS};
})();