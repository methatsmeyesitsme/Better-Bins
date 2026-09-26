const MODEL="onnx-community/Qwen2.5-0.5B-Instruct";
const WORKER_URL="./qwen-worker-v1.20.js";
let worker=null,seq=0;
const pending=new Map();


function fastPrimitiveSpec(text,prevSpec){
  const s=String(text||"").toLowerCase().replace(/[×x]/g," x ").replace(/,/g," ");
  const mm=Array.from(s.matchAll(/(\d+(?:\.\d+)?)\s*mm/g)).map(m=>parseFloat(m[1]));
  const n=(i,d)=>Number.isFinite(mm[i])?mm[i]:d;
  const has=(...words)=>words.some(w=>s.includes(w));
  const base={pattern:"none",periods:2.5,thickness:1.5,quality:18};
  const complex=has("with"," and ","hole","holes","cutout","slot","stand","hollow","lattice","gyroid","pattern","handle","lip","opening","keychain","phone");
  if(has("cube","box")&&!complex&&!has("phone box","box of")){
    const size=n(0,40);
    return {...base,parts:[{type:has("rounded")?"roundedBox":"box",size:[size,size,size],radius:has("rounded")?Math.min(n(1,5),size/2):0,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}]};
  }
  if(has("sphere","ball")){
    const diameter=n(0,40);
    return {...base,parts:[{type:"sphere",radius:diameter/2,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}]};
  }
  if(has("cylinder")){
    const diameter=n(0,40),height=n(1,40);
    return {...base,parts:[{type:"cylinder",radius:diameter/2,height,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}]};
  }
  if(has("torus","ring")){
    const outer=n(0,50),tube=n(1,12);
    return {...base,parts:[{type:"torus",majorRadius:Math.max(tube/2+0.5,outer/2-tube/2),minorRadius:tube/2,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}]};
  }
  if(prevSpec && has("make it","change it") && mm.length){
    const p=JSON.parse(JSON.stringify(prevSpec));
    const first=p.parts?.[0];
    if(first?.type==="sphere"){first.radius=mm[0]/2;return p;}
    if((first?.type==="box"||first?.type==="roundedBox")&&mm.length===1){first.size=[mm[0],mm[0],mm[0]];if(first.radius)first.radius=Math.min(first.radius,mm[0]/2);return p;}
  }
  return null;
}

function ensureWorker(){
  if(worker)return worker;
  worker=new Worker(WORKER_URL,{type:"module"});
  worker.addEventListener("message",e=>{
    const m=e.data||{};
    if(m.type==="status"){const s=document.getElementById("aiStatus");if(s)s.textContent=m.text||"";return;}
    if(m.type==="ready"){const s=document.getElementById("aiStatus");if(s)s.textContent="Qwen is ready.";return;}
    const p=pending.get(m.id);
    if(!p)return;
    pending.delete(m.id);
    if(m.type==="result")p.resolve(m.spec);
    else if(m.type==="error")p.reject(new Error(m.message||"Qwen worker failed."));
  });
  worker.addEventListener("error",e=>{
    const msg=e?.message||"Qwen worker could not start.";
    worker?.terminate();worker=null;
    for(const [id,p] of pending){pending.delete(id);p.reject(new Error(msg));}
  });
  return worker;
}
function preloadQwen(status){
  const w=ensureWorker();
  if(status)status.textContent="Loading Qwen in the background…";
  try{w.postMessage({type:"preload"});}catch(e){if(status)status.textContent="Qwen could not start: "+(e?.message||e);}
}
async function qwenToSpec(prevSpec,userText,status){
  const fast=fastPrimitiveSpec(userText,prevSpec);
  if(fast){
    if(status)status.textContent="Building exact primitive locally…";
    return fast;
  }
  const id=++seq;
  if(status)status.textContent="Qwen is interpreting your request…";
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject});
    try{ensureWorker().postMessage({type:"generate",id,prevSpec:prevSpec||null,userText:String(userText||"")});}
    catch(e){pending.delete(id);reject(e);}
  });
}
window.g3dQwenToSpec=qwenToSpec;
window.g3dQwenPreload=preloadQwen;
window.g3dQwenModel=MODEL;
