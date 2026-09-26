const MODEL="onnx-community/Qwen2.5-0.5B-Instruct";
const WORKER_URL="./qwen-worker-v1.10.js";
let worker=null,seq=0,workerBroken=false;
const pending=new Map();
let mainPipePromise=null;

function outputText(result){
  const item=Array.isArray(result)?result[0]:result,generated=item&&item.generated_text;
  if(Array.isArray(generated)){const last=generated[generated.length-1];return typeof last==="string"?last:((last&&last.content)||"");}
  return typeof generated==="string"?generated:"";
}
function parseJSON(text){
  const cleaned=String(text).replace(/```json/gi,"").replace(/```/g,"").replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
  const start=cleaned.indexOf("{");if(start<0)throw new Error("Qwen returned no JSON object.");
  let depth=0,quote=false,escaped=false;
  for(let i=start;i<cleaned.length;i++){
    const ch=cleaned[i];
    if(quote){if(escaped)escaped=false;else if(ch==="\\")escaped=true;else if(ch==='"')quote=false;continue;}
    if(ch==='"')quote=true;
    else if(ch==="{")depth++;
    else if(ch==="}"){depth--;if(depth===0)return JSON.parse(cleaned.slice(start,i+1));}
  }
  throw new Error("Qwen returned incomplete JSON.");
}
function buildSystem(prevSpec){
  const current=JSON.stringify(prevSpec||{parts:[{type:"roundedBox",size:[40,40,40],radius:5,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}],pattern:"none",periods:2.5,thickness:1.5,quality:28});
  return [
    "You are G3D's local 3D geometry planner.",
    "Return ONLY one valid JSON object. No explanation and no markdown.",
    'Schema: {"parts":[{"type":"box|roundedBox|sphere|cylinder|tube|cone|torus|capsule|prism","op":"union|subtract|intersect","position":[x,y,z],"rotation":[xDeg,yDeg,zDeg],"scale":[x,y,z],"size":[x,y,z],"radius":number,"radius2":number,"height":number,"outerRadius":number,"innerRadius":number,"majorRadius":number,"minorRadius":number,"length":number,"depth":number,"points":[[x,y],...]}],"pattern":"none|gyroid|schwarzp|diamond","periods":number,"thickness":number,"quality":number}',
    "Use multiple parts for complex objects. Use prism for custom 2D outlines. Use subtract parts for holes and cutouts. Use rotation and position to place features.",
    "Do not force an unknown design into a cube, sphere, cylinder, or ring. Keep the requested structure.",
    "Keep the number of parts <= 24 and polygon points <= 48.",
    "All dimensions are millimeters. Rotation is degrees.",
    "Current design: "+current
  ].join("\n");
}
function ensureWorker(){
  if(worker||workerBroken)return worker;
  worker=new Worker(WORKER_URL,{type:"module"});
  worker.addEventListener("message",e=>{
    const m=e.data||{};
    if(m.type==="status"){const s=document.getElementById("aiStatus");if(s)s.textContent=m.text||"";return;}
    const p=pending.get(m.id);if(!p)return;
    pending.delete(m.id);
    if(m.type==="result")p.resolve(m.spec);
    else p.reject(new Error(m.message||"Qwen worker failed."));
  });
  worker.addEventListener("error",e=>{
    workerBroken=true;
    const msg=e?.message||"Qwen worker could not start.";
    worker?.terminate();worker=null;
    for(const [id,p] of pending){pending.delete(id);p.reject(new Error(msg));}
  });
  return worker;
}
async function getMainPipe(status){
  if(mainPipePromise)return mainPipePromise;
  if(status)status.textContent="Starting Qwen fallback…";
  mainPipePromise=import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm").then(({pipeline})=>{
    const device=(navigator.gpu)?"webgpu":"wasm";
    return pipeline("text-generation",MODEL,{dtype:"q4",device}).catch(err=>{
      if(device!=="webgpu")throw err;
      return pipeline("text-generation",MODEL,{dtype:"q4",device:"wasm"});
    });
  });
  try{return await mainPipePromise;}catch(e){mainPipePromise=null;throw e;}
}
async function runMain(prevSpec,userText,status){
  const generator=await getMainPipe(status);
  if(status)status.textContent="Qwen is interpreting your request…";
  const result=await generator([{role:"system",content:buildSystem(prevSpec)},{role:"user",content:String(userText||"")}],{max_new_tokens:128,do_sample:false,return_full_text:false});
  return parseJSON(outputText(result));
}
async function qwenToSpec(prevSpec,userText,status){
  const id=++seq;
  if(status)status.textContent=workerBroken?"Starting local Qwen fallback…":"Starting local Qwen…";
  if(!workerBroken){
    try{
      const w=ensureWorker();
      if(w){
        const spec=await new Promise((resolve,reject)=>{
          pending.set(id,{resolve,reject});
          w.postMessage({type:"generate",id,prevSpec:prevSpec||null,userText:String(userText||"")});
        });
        return spec;
      }
    }catch(err){
      workerBroken=true;
      worker?.terminate();worker=null;
    }
  }
  return runMain(prevSpec,userText,status);
}
window.g3dQwenToSpec=qwenToSpec;
window.g3dQwenModel=MODEL;
