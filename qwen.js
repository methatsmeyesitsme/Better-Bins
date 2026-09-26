const MODEL="onnx-community/Qwen2.5-0.5B-Instruct";
const WORKER_URL="./qwen-worker-v1.18.js";
let worker=null,seq=0;
const pending=new Map();

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
function qwenToSpec(prevSpec,userText,status){
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
