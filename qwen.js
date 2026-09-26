const MODEL="onnx-community/Qwen2.5-0.5B-Instruct";
let worker=null,seq=0;const pending=new Map();
function ensureWorker(){
  if(worker)return worker;
  worker=new Worker("./qwen-worker.js",{type:"module"});
  worker.addEventListener("message",e=>{const m=e.data||{};if(m.type==="status"){const s=document.getElementById("aiStatus");if(s)s.textContent=m.text||"";return;}const p=pending.get(m.id);if(!p)return;pending.delete(m.id);if(m.type==="result")p.resolve(m.spec);else p.reject(new Error(m.message||"Qwen worker failed."));});
  return worker;
}
function qwenToSpec(prevSpec,userText,status){
  const id=++seq;if(status)status.textContent="Starting local Qwen…";
  return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});ensureWorker().postMessage({type:"generate",id,prevSpec:prevSpec||null,userText:String(userText||"")});});
}
window.g3dQwenToSpec=qwenToSpec;window.g3dQwenModel=MODEL;
