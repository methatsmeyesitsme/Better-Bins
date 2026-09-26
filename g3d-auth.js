/* G3D local account system.
   Accounts live only in this browser/device. No Supabase or external auth service is required.
   Passwords are stored as PBKDF2 hashes, never plaintext.
   Do not describe this as cross-device account synchronization. */
(function(){
  'use strict';

  const ACCOUNTS_KEY='g3d_local_accounts_v1';
  const SESSION_KEY='g3d_local_session_v1';
  const te=new TextEncoder();
  let user=null;

  function readAccounts(){
    try{
      const raw=localStorage.getItem(ACCOUNTS_KEY);
      const data=raw?JSON.parse(raw):[];
      return Array.isArray(data)?data:[];
    }catch(e){return [];}
  }
  function writeAccounts(accounts){
    localStorage.setItem(ACCOUNTS_KEY,JSON.stringify(accounts));
  }
  function randomId(prefix){
    if(window.crypto&&crypto.randomUUID)return prefix+crypto.randomUUID();
    const a=new Uint8Array(16);crypto.getRandomValues(a);
    return prefix+Array.from(a,b=>b.toString(16).padStart(2,'0')).join('');
  }
  function b64(bytes){
    let s='';const a=new Uint8Array(bytes);
    for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));
    return btoa(s);
  }
  function unb64(s){
    const raw=atob(s),a=new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i);
    return a;
  }
  async function deriveHash(password,salt){
    const material=await crypto.subtle.importKey('raw',te.encode(String(password)),{name:'PBKDF2'},false,['deriveBits']);
    const bits=await crypto.subtle.deriveBits(
      {name:'PBKDF2',salt,iterations:150000,hash:'SHA-256'},
      material,256
    );
    return new Uint8Array(bits);
  }
  function equalBytes(a,b){
    if(a.length!==b.length)return false;
    let x=0;for(let i=0;i<a.length;i++)x|=a[i]^b[i];
    return x===0;
  }
  function publicUser(rec){
    return rec?{
      id:rec.id,
      email:rec.email,
      user_metadata:{username:rec.username}
    }:null;
  }
  function publish(){
    window.g3dAuthUser=user?publicUser(user):null;
    window.dispatchEvent(new CustomEvent('g3d-auth-state',{detail:{configured:true,user:window.g3dAuthUser,local:true}}));
  }
  function findUserById(id){
    return readAccounts().find(x=>x.id===id)||null;
  }

  async function init(){
    try{
      const id=localStorage.getItem(SESSION_KEY);
      user=id?findUserById(id):null;
      if(id&&!user)localStorage.removeItem(SESSION_KEY);
      if(user)await restoreApiKey();
    }catch(e){user=null;unlockedVault=null;}
    publish();
  }
  function getUser(){return user?publicUser(user):null;}

  async function signUp(username,email,password){
    username=String(username||'').trim().slice(0,40);
    email=String(email||'').trim().toLowerCase();
    password=String(password||'');
    if(!username)throw new Error('Enter a username.');
    if(!email)throw new Error('Enter an email address.');
    if(password.length<8)throw new Error('Password must be at least 8 characters.');
    if(!window.crypto||!crypto.subtle)throw new Error('Secure browser storage is unavailable.');
    const accounts=readAccounts();
    if(accounts.some(x=>x.email===email))throw new Error('An account with that email already exists.');
    if(accounts.some(x=>x.username.toLowerCase()===username.toLowerCase()))throw new Error('That username is already taken.');
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const hash=await deriveHash(password,salt);
    const rec={id:randomId('u_'),username,email,salt:b64(salt),hash:b64(hash),created:Date.now()};
    accounts.push(rec);writeAccounts(accounts);
    localStorage.setItem(SESSION_KEY,rec.id);user=rec;await restoreApiKey();publish();
    return {session:{user:publicUser(rec)},user:publicUser(rec)};
  }

  async function signIn(email,password){
    email=String(email||'').trim().toLowerCase();password=String(password||'');
    const rec=readAccounts().find(x=>x.email===email);
    if(!rec)throw new Error('No account was found with that email.');
    const hash=await deriveHash(password,unb64(rec.salt));
    if(!equalBytes(hash,unb64(rec.hash)))throw new Error('Incorrect password.');
    localStorage.setItem(SESSION_KEY,rec.id);user=rec;await restoreApiKey();publish();
    return {session:{user:publicUser(rec)},user:publicUser(rec)};
  }

  async function signOut(){
    localStorage.removeItem(SESSION_KEY);user=null;unlockedVault=null;publish();
  }

  async function resetPassword(){
    throw new Error('Password reset needs an email service. In local account mode, use your current password to manage your account.');
  }

  // No email-based MFA is possible without an email/auth backend.
  // Keep these methods so the rest of G3D can detect that local mode is active.
  async function enrollTotp(){throw new Error('Two-factor email delivery is unavailable in local account mode.');}
  async function verifyTotp(){throw new Error('Two-factor email delivery is unavailable in local account mode.');}
  async function listMfa(){return [];}

  const VAULT_PREFIX='g3d_api_vault_v2:';
  const DEVICE_DB='g3d_api_device_key_v1';
  const DEVICE_STORE='keys';
  const DEVICE_KEY_ID='api-key-encryption';
  let unlockedVault=null;
  const td=new TextDecoder();
  const te2=new TextEncoder();

  function vaultKey(){return user?VAULT_PREFIX+user.id:null;}

  function readVault(){
    if(!user)return null;
    try{const r=localStorage.getItem(vaultKey());return r?JSON.parse(r):null;}catch(e){return null;}
  }

  async function getDeviceKey(){
    if(!window.indexedDB)throw new Error('Secure device storage is unavailable in this browser.');
    const db=await new Promise((resolve,reject)=>{
      const req=indexedDB.open(DEVICE_DB,1);
      req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(DEVICE_STORE))req.result.createObjectStore(DEVICE_STORE);};
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error('Could not open secure device storage.'));
    });
    try{
      const existing=await new Promise((resolve,reject)=>{
        const tx=db.transaction(DEVICE_STORE,'readonly'),req=tx.objectStore(DEVICE_STORE).get(DEVICE_KEY_ID);
        req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
      });
      if(existing)return existing;
      const key=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
      await new Promise((resolve,reject)=>{
        const tx=db.transaction(DEVICE_STORE,'readwrite');
        tx.objectStore(DEVICE_STORE).put(key,DEVICE_KEY_ID);
        tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error||new Error('Could not save secure device key.'));
      });
      return key;
    }finally{db.close();}
  }

  async function restoreApiKey(){
    unlockedVault=null;
    const rec=readVault();
    if(!rec)return null;
    try{
      const key=await getDeviceKey();
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(rec.iv)},key,unb64(rec.cipher));
      unlockedVault={provider:rec.provider,key:td.decode(plain),saved:rec.saved};
      return {...unlockedVault};
    }catch(e){
      unlockedVault=null;
      return null;
    }
  }

  async function saveApiKey(provider,key){
    if(!user)throw new Error('Sign in first.');
    if(!key)throw new Error('Enter an API key.');
    const iv=crypto.getRandomValues(new Uint8Array(12)),deviceKey=await getDeviceKey();
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},deviceKey,te2.encode(String(key)));
    const rec={provider:String(provider||'custom'),iv:b64(iv),cipher:b64(cipher),saved:Date.now()};
    localStorage.setItem(vaultKey(),JSON.stringify(rec));
    unlockedVault={provider:rec.provider,key:String(key),saved:rec.saved};
    return rec;
  }

  async function unlockApiKey(){
    if(!user)throw new Error('Sign in first.');
    const restored=await restoreApiKey();
    if(!restored)throw new Error('No usable saved API key was found on this device.');
    return restored;
  }

  function clearApiKey(){
    if(user)localStorage.removeItem(vaultKey());
    unlockedVault=null;
  }

  function apiVaultStatus(){
    const rec=readVault();
    return {saved:!!rec,provider:rec&&rec.provider||null,unlocked:!!unlockedVault,key:unlockedVault&&unlockedVault.key||null};
  }

  window.g3dAuth={
    configured:true,
    localOnly:true,
    getUser,signIn,signUp,signOut,resetPassword,enrollTotp,verifyTotp,listMfa,
    saveApiKey,unlockApiKey,clearApiKey,apiVaultStatus
  };
  init();
})();