const MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";
const worker = new Worker("./qwen-worker.js", { type: "module" });
let seq=0;
const pending=new Map();
worker.addEventListener("message",e=>{
  const m=e.data||{};
  if(m.type==="status"){
    const s=document.getElementById("aiStatus");
    if(s) s.textContent=m.text||"";
    return;
  }
  if(m.type==="warmup-ready"){window.g3dQwenReady=true;return;}
  const p=pending.get(m.id);
  if(!p)return;
  pending.delete(m.id);
  if(m.type==="result")p.resolve(m.spec);
  else p.reject(new Error(m.message||"Qwen worker failed."));
});
function qwenToSpec(prevSpec,userText,status){
  const id=++seq;
  if(status)status.textContent=window.g3dQwenReady?"Qwen is interpreting your request…":"Starting local Qwen…";
  return new Promise((resolve,reject)=>{
    pending.set(id,{resolve,reject});
    worker.postMessage({type:"generate",id,prevSpec:prevSpec||null,userText:String(userText||"")});
  });
}
window.g3dQwenToSpec=qwenToSpec;
window.g3dQwenModel=MODEL;
setTimeout(()=>worker.postMessage({type:"warmup",id:0}),1500);
