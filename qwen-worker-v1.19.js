import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/+esm";
env.useBrowserCache = true;
env.useWasmCache = true;
env.backends.onnx.wasm.simd = true;
env.logLevel = 50;
const MODEL="onnx-community/Qwen2.5-0.5B-Instruct";
const DEFAULT_SPEC={parts:[{type:"roundedBox",size:[40,40,40],radius:5,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}],pattern:"none",periods:2.5,thickness:1.5,quality:18};
let pipe=null,loading=null;
function send(type,id,data={}){self.postMessage({type,id,...data});}
async function getPipe(id){
  if(pipe)return pipe;if(loading)return loading;
  send("status",id,{text:"Loading Qwen locally…"});
  loading=(async()=>{
    const hasGPU=typeof navigator!=="undefined" && !!navigator.gpu;
    const device=hasGPU?"webgpu":"wasm";
    try{
      pipe=await pipeline("text-generation",MODEL,{dtype:device==="webgpu"?"q4f16":"q4",device,session_options:{graphOptimizationLevel:"all",enableMemPattern:true,enableCpuMemArena:true}});
    }catch(err){
      if(device!=="webgpu")throw err;
      pipe=await pipeline("text-generation",MODEL,{dtype:"q4",device:"wasm"});
    }
    return pipe;
  })();
  try{return await loading;}finally{loading=null;}
}
function compactSpecForPrompt(spec){
  if(!spec||!Array.isArray(spec.parts))return null;
  return {
    parts:spec.parts.slice(0,10).map(p=>{
      const q={type:p.type,op:p.op||"union",position:Array.isArray(p.position)?p.position.slice(0,3):[0,0,0],rotation:Array.isArray(p.rotation)?p.rotation.slice(0,3).map(v=>Number(v||0)*180/Math.PI):[0,0,0],scale:Array.isArray(p.scale)?p.scale.slice(0,3):[1,1,1]};
      const keys=["size","radius","radius2","height","outerRadius","innerRadius","majorRadius","minorRadius","length","depth","points"];
      for(const k of keys)if(p[k]!==undefined)q[k]=p[k];
      return q;
    }),
    pattern:["none","gyroid","schwarzp","diamond"].includes(spec.pattern)?spec.pattern:"none",
    periods:Number(spec.periods)||2.5,
    thickness:Number(spec.thickness)||1.5
  };
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
  const current=JSON.stringify(compactSpecForPrompt(prevSpec)||DEFAULT_SPEC);
  const system=[
    "G3D geometry planner. Output ONLY compact one-line JSON.",
    'Use short keys: t=type,o=op,p=position,r=rotation,s=scale,d=size,R=radius,R2=radius2,h=height,OR=outerRadius,IR=innerRadius,M=majorRadius,m=minorRadius,l=length,z=depth,P=points; top keys pattern,periods,thickness,quality.',
    'Example: {"parts":[{"t":"box","d":[40,40,40]}],"pattern":"none","periods":2.5,"thickness":1.5,"quality":18}',

    "Use real solids and CSG. Multiple parts for multiple features. Prism for custom outlines. Subtract for holes/cutouts. Preserve requested dimensions/features.",
    "Never replace an unknown/custom design with an unrelated primitive.",
    "For modifications, preserve the current design and change only the requested part. New requests build the complete design.",
    "Max 10 parts, max 32 polygon points. Dimensions are mm. Rotation is degrees. Omit all unused fields. First part normally uses o=u. Do not write spaces outside strings.",
    "Current design: "+current
  ].join("\n");
  const result=await generator([{role:"system",content:system},{role:"user",content:String(userText||"")}],{max_new_tokens:104,do_sample:false,num_beams:1,return_full_text:false});
  return expandCompactSpec(parseJSON(outputText(result)));
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

function expandCompactSpec(raw){
  if(!raw||typeof raw!=="object") return raw;
  const mapPart=(p)=>{
    if(!p||typeof p!=="object")return p;
    const q={};
    const pairs={t:"type",o:"op",p:"position",r:"rotation",s:"scale",d:"size",R:"radius",R2:"radius2",h:"height",OR:"outerRadius",IR:"innerRadius",M:"majorRadius",m:"minorRadius",l:"length",z:"depth",P:"points"};
    for(const k in pairs)if(p[k]!==undefined)q[pairs[k]]=p[k];
    for(const k of Object.keys(p)){if(!(k in pairs))q[k]=p[k];}
    return q;
  };
  return {...raw,parts:Array.isArray(raw.parts)?raw.parts.map(mapPart):raw.parts};
}
