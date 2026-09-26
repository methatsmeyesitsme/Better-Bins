const MODEL="onnx-community/Qwen2.5-0.5B-Instruct";
const WORKER_URL="./g3d-model-worker-v1.35.js";
let worker=null,seq=0;
const pending=new Map();
const MODEL_PREF_KEY="g3d_ai_model_v1";
const MODEL_CONFIGS={
  ai1:{id:"onnx-community/SmolLM2-360M-ONNX",name:"SmolLM2 360M",label:"AI 1 · SmolLM2 360M"},
  ai2:{id:"onnx-community/gemma-3-270m-it-ONNX",name:"Gemma 3 270M IT",label:"AI 2 · Gemma 3 270M IT"},
  ai3:{id:"onnx-community/Qwen2.5-0.5B-Instruct",name:"Qwen2.5 0.5B",label:"AI 3 · Qwen2.5 0.5B"}
};
let selectedModelId="ai1";
try{
  const saved=localStorage.getItem(MODEL_PREF_KEY);
  if(MODEL_CONFIGS[saved])selectedModelId=saved;
}catch(e){}

function modelLoadStart(id){
  try{window.dispatchEvent(new CustomEvent("g3d-model-loading",{detail:{id,name:MODEL_CONFIGS[id]?.name||id}}));}catch(e){}
}
function modelLoadReady(id,elapsed){
  try{window.dispatchEvent(new CustomEvent("g3d-model-ready",{detail:{id,name:MODEL_CONFIGS[id]?.name||id,elapsed}}));}catch(e){}
}
function modelInfo(){return MODEL_CONFIGS[selectedModelId];}
function notifyModelChange(){try{window.dispatchEvent(new CustomEvent("g3d-model-change",{detail:modelInfo()}));}catch(e){}}
function rejectPending(message){
  const err=new Error(message);
  for(const [id,p] of pending){pending.delete(id);p.reject(err);}
}

const specCache=new Map();
const SPEC_CACHE_MAX=16;
function cacheKey(prevSpec,text){return JSON.stringify([prevSpec||null,String(text||"").trim().toLowerCase()]);}
function cacheGet(k){if(!specCache.has(k))return null;const v=specCache.get(k);specCache.delete(k);specCache.set(k,v);return JSON.parse(JSON.stringify(v));}
function cachePut(k,v){specCache.set(k,JSON.parse(JSON.stringify(v)));if(specCache.size>SPEC_CACHE_MAX)specCache.delete(specCache.keys().next().value);}


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
  if(has("rectangular prism","rectangular block","cuboid")||((has("prism")||has("block"))&&mm.length>=3)){
    const x=n(0,40),y=n(1,40),z=n(2,20);
    return {...base,parts:[{type:"box",size:[x,y,z],position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}]};
  }
  if(has("cone")&&!complex){
    const diameter=n(0,40),height=n(1,40);
    return {...base,parts:[{type:"cone",radius:diameter/2,radius2:1,height,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}]};
  }
  if((has("tube","hollow cylinder"))&&!complex){
    const outer=n(0,40),inner=n(1,30),height=n(2,40);
    return {...base,parts:[{type:"tube",outerRadius:outer/2,innerRadius:Math.min(inner/2,outer/2-0.3),height,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}]};
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
    if(m.type==="ready"){
  const s=document.getElementById("aiStatus");if(s)s.textContent=modelInfo().name+" is ready.";
  const readyId=m.modelId||selectedModelId;
  if(readyId===selectedModelId)modelLoadReady(readyId,Number(m.elapsed)||0);
  return;
}
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
  if(status)status.textContent="Loading "+modelInfo().name+" in the background…";
  try{w.postMessage({type:"preload",modelId:selectedModelId});}catch(e){if(status)status.textContent="Model could not start: "+(e?.message||e);}
}
function setG3DModel(id){
  if(!MODEL_CONFIGS[id]||id===selectedModelId)return;
  rejectPending("Model changed.");
  if(worker){worker.terminate();worker=null;}
  selectedModelId=id;
  try{localStorage.setItem(MODEL_PREF_KEY,id);}catch(e){}
  notifyModelChange();
  modelLoadStart(id);
  preloadQwen(document.getElementById("aiStatus"));
}
async function isModelRequest(text,prevSpec){
  const s=String(text||"").toLowerCase().trim();
  if(/\b(make|create|build|design|generate|model|mesh|stl|3d print|print this|prototype|part|shape|geometry|hollow|lattice|gyroid|phone stand|keychain)\b/i.test(s))return true;
  return !!prevSpec &&
    /\b(this|that|it|model|design)\b/i.test(s) &&
    /\b(change|modify|edit|add|remove|move|rotate|resize|make it|turn it|taller|shorter|wider|narrower|thicker|thinner|bigger|smaller)\b/i.test(s);
}
async function qwenToSpec(prevSpec,userText,status,history){
  const shouldBuild=isModelRequest(userText,prevSpec);
  if(shouldBuild){
    const fast=fastPrimitiveSpec(userText,prevSpec);
    if(fast){
      if(status)status.textContent="Building the model…";
      return {mode:"model",reply:"Got it — I’ll build that.",spec:fast};
    }
  }
  const cacheKeyValue=shouldBuild
    ? cacheKey(prevSpec,userText)
    : "chat:"+String(userText||"").trim().toLowerCase()+":"+JSON.stringify((history||[]).slice(-4));
  if(shouldBuild){
    const cached=cacheGet(cacheKeyValue);
    if(cached)return cached;
  }
  const id=++seq;
  if(status)status.textContent=modelInfo().name+" is thinking…";
  return new Promise((resolve,reject)=>{
    pending.set(id,{
      resolve:(response)=>{
        const out=response&&typeof response==="object"
          ?response
          :{mode:"chat",reply:String(response||"")};
        if(out.mode==="model"&&out.spec)cachePut(cacheKeyValue,out);
        resolve(out);
      },
      reject
    });
    try{
      ensureWorker().postMessage({
        type:"respond",
        id,
        modelId:selectedModelId,
        prevSpec:prevSpec||null,
        userText:String(userText||""),
        history:Array.isArray(history)?history.slice(-7):[],
        wantsModel:shouldBuild
      });
    }catch(e){
      pending.delete(id);
      reject(e);
    }
  });
}
window.g3dQwenToSpec=qwenToSpec;
window.g3dQwenPreload=preloadQwen;
window.g3dSetModel=setG3DModel;
window.g3dGetModelInfo=modelInfo;
window.g3dQwenModels=MODEL_CONFIGS;
notifyModelChange();
