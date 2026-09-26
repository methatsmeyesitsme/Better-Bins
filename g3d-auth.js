/* G3D account/authentication adapter.
   Configure the public Supabase URL + anon key in g3d-auth-config.js.
   Never put a service-role key or provider API key in this file. */
(function(){
  'use strict';
  const cfg=window.G3D_AUTH_CONFIG||{};
  const configured=!!(cfg.supabaseUrl&&cfg.supabaseAnonKey&&window.supabase&&window.supabase.createClient);
  let client=null,user=null;

  if(configured){
    try{ client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}); }
    catch(e){ console.error('G3D auth initialization failed',e); }
  }

  function publish(){
    window.g3dAuthUser=user||null;
    window.dispatchEvent(new CustomEvent('g3d-auth-state',{detail:{configured:!!client,user:user||null}}));
  }
  function getUser(){return user||null;}
  async function init(){
    if(!client){publish();return;}
    try{
      const r=await client.auth.getSession();
      user=r.data&&r.data.session&&r.data.session.user||null;
    }catch(e){console.error(e);user=null;}
    publish();
    client.auth.onAuthStateChange(function(_event,session){
      user=session&&session.user||null;
      publish();
    });
  }
  async function signIn(email,password){
    if(!client)throw new Error('G3D authentication is not configured yet.');
    const r=await client.auth.signInWithPassword({email,password});
    if(r.error)throw r.error;
    user=r.data&&r.data.user||null; publish(); return r.data;
  }
  async function signUp(username,email,password){
    if(!client)throw new Error('G3D authentication is not configured yet.');
    const redirect=window.location.origin+window.location.pathname;
    const r=await client.auth.signUp({email,password,options:{data:{username:String(username).trim().slice(0,40)},emailRedirectTo:redirect}});
    if(r.error)throw r.error;
    user=r.data&&r.data.user||null; publish(); return r.data;
  }
  async function signOut(){
    if(client){const r=await client.auth.signOut();if(r.error)throw r.error;}
    user=null; publish();
  }
  async function resetPassword(email){
    if(!client)throw new Error('G3D authentication is not configured yet.');
    const redirect=window.location.origin+window.location.pathname;
    const r=await client.auth.resetPasswordForEmail(email,{redirectTo:redirect});
    if(r.error)throw r.error;
  }
  async function enrollTotp(){
    if(!client||!user)throw new Error('Sign in first.');
    const r=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'G3D'});
    if(r.error)throw r.error;
    return r.data;
  }
  async function verifyTotp(factorId,code){
    if(!client||!user)throw new Error('Sign in first.');
    const c=await client.auth.mfa.challenge({factorId});
    if(c.error)throw c.error;
    const v=await client.auth.mfa.verify({factorId,challengeId:c.data.id,code:String(code).trim()});
    if(v.error)throw v.error;
    return v.data;
  }
  async function listMfa(){
    if(!client||!user)return [];
    const r=await client.auth.mfa.listFactors();
    if(r.error)throw r.error;
    return (r.data&&r.data.all)||[];
  }

  const VAULT_PREFIX='g3d_api_vault_v1:';
  let unlockedVault=null;
  const te=new TextEncoder(),td=new TextDecoder();
  function b64(bytes){let s='';const a=new Uint8Array(bytes);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode.apply(null,a.subarray(i,i+0x8000));return btoa(s);}
  function unb64(s){const raw=atob(s),a=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)a[i]=raw.charCodeAt(i);return a;}
  async function derive(password,uid){
    const material=await crypto.subtle.importKey('raw',te.encode(String(password)),{name:'PBKDF2'},false,['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt:te.encode('G3D:'+uid),iterations:150000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  function vaultKey(){return user?VAULT_PREFIX+user.id:null;}
  function readVault(){if(!user)return null;try{const r=localStorage.getItem(vaultKey());return r?JSON.parse(r):null;}catch(e){return null;}}
  async function saveApiKey(provider,key,password){
    if(!user)throw new Error('Sign in first.');
    if(!key||!password)throw new Error('Enter the API key and your account password.');
    const iv=crypto.getRandomValues(new Uint8Array(12)),k=await derive(password,user.id);
    const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},k,te.encode(key));
    const rec={provider:String(provider||'custom'),iv:b64(iv),cipher:b64(cipher),saved:Date.now()};
    localStorage.setItem(vaultKey(),JSON.stringify(rec));
    unlockedVault={provider:rec.provider,key:String(key),saved:rec.saved};
    return rec;
  }
  async function unlockApiKey(password){
    if(!user)throw new Error('Sign in first.');
    const rec=readVault();if(!rec)throw new Error('No saved API key on this device.');
    try{
      const k=await derive(password,user.id);
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(rec.iv)},k,unb64(rec.cipher));
      unlockedVault={provider:rec.provider,key:td.decode(plain),saved:rec.saved};
      return {...unlockedVault};
    }catch(e){throw new Error('That password could not unlock the saved API key.');}
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
    configured:!!client,getUser,signIn,signUp,signOut,resetPassword,enrollTotp,verifyTotp,listMfa,
    saveApiKey,unlockApiKey,clearApiKey,apiVaultStatus
  };
  init();
})();