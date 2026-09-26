(function(){
  'use strict';

  const CODE_KEY='infotech_shared_access_code_v1';
  const COOKIE_KEY='infotech_shared_access_code_v1_cookie';
  const ATTEMPT_KEY='infotech_shared_access_attempts_v1';
  const SESSION_KEY='infotech_checklist_session_v1';
  const TTL_MS=120000;
  const MAX_ATTEMPTS=5;
  const WINDOW_MS=30000;
  const LOCK_MS=60000;

  function now(){return Date.now()}
  function safeParse(v,fallback=null){try{return JSON.parse(v)}catch{return fallback}}

  function safeGet(storage,key){
    try{return storage?.getItem?.(key) ?? null}catch{return null}
  }
  function safeSet(storage,key,value){
    try{storage?.setItem?.(key,value);return true}catch{return false}
  }
  function safeRemove(storage,key){
    try{storage?.removeItem?.(key);return true}catch{return false}
  }

  function cookieGet(name){
    try{
      const prefix=name+'=';
      const item=String(document.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith(prefix));
      return item ? decodeURIComponent(item.slice(prefix.length)) : null;
    }catch{return null}
  }
  function cookieSet(name,value,maxAgeSeconds){
    try{
      const secure=location.protocol==='https:'?'; Secure':'';
      document.cookie=`${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${Math.max(0,Math.floor(maxAgeSeconds))}; SameSite=Lax${secure}`;
      return true;
    }catch{return false}
  }
  function cookieRemove(name){
    try{
      const secure=location.protocol==='https:'?'; Secure':'';
      document.cookie=`${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    }catch{}
  }

  function normalizeCode(v){return String(v||'').replace(/\D/g,'').slice(0,6)}
  function formatCode(v){const c=normalizeCode(v);return c.length>3?c.slice(0,3)+' '+c.slice(3):c}
  function randomCode(){
    const a=new Uint32Array(1);
    if(globalThis.crypto?.getRandomValues){
      crypto.getRandomValues(a);
      return String(100000+(a[0]%900000));
    }
    return String(100000+Math.floor(Math.random()*900000));
  }

  function readCodeRecord(){
    const local=safeParse(safeGet(globalThis.localStorage,CODE_KEY));
    const cookie=safeParse(cookieGet(COOKIE_KEY));
    if(local && cookie){
      return Number(cookie.issuedAt||0)>Number(local.issuedAt||0)?cookie:local;
    }
    return local||cookie||null;
  }
  function writeCodeRecord(record){
    const raw=JSON.stringify(record);
    safeSet(globalThis.localStorage,CODE_KEY,raw);
    safeSet(globalThis.sessionStorage,CODE_KEY,raw);
    const remaining=Math.max(180,Math.ceil(((record.expiresAt||now())-now())/1000)+60);
    cookieSet(COOKIE_KEY,raw,remaining);
    return record;
  }
  function removeCodeRecord(){
    safeRemove(globalThis.localStorage,CODE_KEY);
    safeRemove(globalThis.sessionStorage,CODE_KEY);
    cookieRemove(COOKIE_KEY);
  }

  function getStored(){
    const data=readCodeRecord();
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
    writeCodeRecord(record);
    return {...record,formatted:formatCode(code)};
  }

  function attempts(){
    const stored=safeParse(safeGet(globalThis.localStorage,ATTEMPT_KEY),null)
      || safeParse(safeGet(globalThis.sessionStorage,ATTEMPT_KEY),null)
      || {items:[],lockedUntil:0};
    stored.items=Array.isArray(stored.items)?stored.items.filter(t=>now()-t<WINDOW_MS):[];
    stored.lockedUntil=Number(stored.lockedUntil||0);
    return stored;
  }
  function saveAttempts(a){
    const raw=JSON.stringify(a);
    safeSet(globalThis.localStorage,ATTEMPT_KEY,raw);
    safeSet(globalThis.sessionStorage,ATTEMPT_KEY,raw);
  }
  function clearAttempts(){
    safeRemove(globalThis.localStorage,ATTEMPT_KEY);
    safeRemove(globalThis.sessionStorage,ATTEMPT_KEY);
  }

  function validate(input){
    const a=attempts();
    if(a.lockedUntil>now()){
      return {ok:false,reason:'locked',retryAt:a.lockedUntil};
    }

    const code=normalizeCode(input);
    if(code.length!==6){
      return {ok:false,reason:'invalid_format'};
    }

    const record=readCodeRecord();
    if(!record){
      return failAttempt(a,'not_found');
    }
    if(record.used){
      return failAttempt(a,'used');
    }
    if(!record.expiresAt || record.expiresAt<=now()){
      removeCodeRecord();
      return failAttempt(a,'expired');
    }
    if(String(record.code)!==code){
      return failAttempt(a,'wrong');
    }

    record.used=true;
    record.usedAt=now();
    writeCodeRecord(record);
    clearAttempts();

    const session={identity:record.identity,authenticatedAt:now(),source:'temporary_code'};
    safeSet(globalThis.sessionStorage,SESSION_KEY,JSON.stringify(session));
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

  function currentSession(){
    return safeParse(safeGet(globalThis.sessionStorage,SESSION_KEY));
  }
  function clearSession(){
    safeRemove(globalThis.sessionStorage,SESSION_KEY);
  }
  function revokeCode(){
    removeCodeRecord();
  }
  function status(){
    const r=readCodeRecord();
    if(!r) return {state:'none'};
    if(r.used) return {state:'used',record:r};
    if(!r.expiresAt || r.expiresAt<=now()) return {state:'expired',record:r};
    return {state:'active',record:r,remainingMs:r.expiresAt-now()};
  }

  window.InfoTechAccessCode={
    generate,
    validate,
    currentSession,
    clearSession,
    revokeCode,
    status,
    normalizeCode,
    formatCode,
    TTL_MS
  };
})();