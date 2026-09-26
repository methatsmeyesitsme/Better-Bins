import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
env.useBrowserCache = true;
env.useWasmCache = true;
env.backends.onnx.wasm.simd = true;
env.logLevel = 50;
const MODEL="onnx-community/Qwen2.5-0.5B-Instruct";
let pipe=null,loading=null;
function send(type,id,data={}){self.postMessage({type,id,...data});}
async function getPipe(id){
  if(pipe)return pipe;if(loading)return loading;
  send("status",id,{text:"Loading Qwen locally…"});
  loading=(async()=>{
    const hasGPU=typeof navigator!=="undefined" && !!navigator.gpu;
    const device=hasGPU?"webgpu":"wasm";
    try{
      pipe=await pipeline("text-generation",MODEL,{dtype:device==="webgpu"?"q4f16":"q4",device});
    }catch(err){
      if(device!=="webgpu")throw err;
      pipe=await pipeline("text-generation",MODEL,{dtype:"q4",device:"wasm"});
    }
    return pipe;
  })();
  try{return await loading;}finally{loading=null;}
}
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
async function qwenToSpec(id,prevSpec,userText){
  send("status",id,{text:pipe?"Qwen is interpreting your request…":"Loading Qwen locally…"});
  const generator=await getPipe(id);
  const current=JSON.stringify(prevSpec||{parts:[{type:"roundedBox",size:[40,40,40],radius:5,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}],pattern:"none",periods:2.5,thickness:1.5,quality:28});
  const system=[
    "G3D geometry planner. Output ONLY one valid JSON object.",
    'Schema: {"parts":[{"type":"box|roundedBox|sphere|cylinder|tube|cone|torus|capsule|prism","op":"union|subtract|intersect","position":[x,y,z],"rotation":[x,y,z],"scale":[x,y,z],"size":[x,y,z],"radius":n,"radius2":n,"height":n,"majorRadius":n,"minorRadius":n,"length":n,"depth":n,"points":[[x,y],...]}],"pattern":"none|gyroid|schwarzp|diamond","periods":n,"thickness":n,"quality":n}',
    "Use real solids and CSG. Multiple parts for multiple features. Prism for custom outlines. Subtract for holes/cutouts. Preserve requested dimensions/features.",
    "Never replace an unknown/custom design with an unrelated primitive.",
    "For modifications, preserve the current design and change only the requested part. New requests build the complete design.",
    "Max 10 parts, max 32 polygon points. Dimensions are mm. Rotation is degrees. Omit unused fields.",
    "Current design: "+current
  ].join("\n");
  const result=await generator([{role:"system",content:system},{role:"user",content:String(userText||"")}],{max_new_tokens:112,do_sample:false,num_beams:1,return_full_text:false});
  return parseJSON(outputText(result));
}
self.onmessage=async e=>{
  const m=e.data||{};
  try{
    if(m.type==="preload"){
      const generator=await getPipe("preload");
      try{await generator("JSON",{max_new_tokens:1,do_sample:false,return_full_text:false});}catch(e){}
      send("ready","preload",{text:"Qwen is ready."});
      return;
    }
    if(m.type==="generate"){
      const spec=await qwenToSpec(m.id,m.prevSpec||null,String(m.userText||""));
      send("result",m.id,{spec});
    }
  }catch(err){send("error",m.id,{message:err?.message||String(err)});}
};
