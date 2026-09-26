import { env, pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0/+esm";
env.useBrowserCache = true;
env.useWasmCache = true;
env.backends.onnx.wasm.simd = true;
env.logLevel = 50;
const MODEL_CONFIGS={
  ai1:{id:"onnx-community/SmolLM2-360M-ONNX",name:"SmolLM2 360M"},
  ai2:{id:"onnx-community/gemma-3-270m-it-ONNX",name:"Gemma 3 270M IT"},
  ai3:{id:"onnx-community/Qwen2.5-0.5B-Instruct",name:"Qwen2.5 0.5B"}
};
const DEFAULT_SPEC={parts:[{type:"roundedBox",size:[40,40,40],radius:5,position:[0,0,0],rotation:[0,0,0],scale:[1,1,1],op:"union"}],pattern:"none",periods:2.5,thickness:1.5,quality:18};
let pipe=null,loading=null,loadedModelId=null;
function send(type,id,data={}){self.postMessage({type,id,...data});}
async function getPipe(modelId,id){
  const cfg=MODEL_CONFIGS[modelId]||MODEL_CONFIGS.ai1;
  if(pipe&&loadedModelId===cfg.id)return pipe;
  if(loading&&loadedModelId===cfg.id)return loading;
  send("status",id,{text:"Loading "+cfg.name+" locally…"});
  loading=(async()=>{
    const hasGPU=typeof navigator!=="undefined" && !!navigator.gpu;
    const device=hasGPU?"webgpu":"wasm";
    try{
      pipe=await pipeline("text-generation",cfg.id,{dtype:device==="webgpu"?"q4f16":"q4",device,session_options:{graphOptimizationLevel:"all",enableMemPattern:true,enableCpuMemArena:true}});
    }catch(err){
      if(device!=="webgpu")throw err;
      pipe=await pipeline("text-generation",cfg.id,{dtype:"q4",device:"wasm"});
    }
    loadedModelId=cfg.id;
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
async function qwenRespond(id,modelId,prevSpec,userText,history,wantsModel){
  send("status",id,{text:pipe?"Thinking…":"Loading model locally…"});
  const generator=await getPipe(modelId,id);
  const current=JSON.stringify(compactSpecForPrompt(prevSpec)||DEFAULT_SPEC);
  const recent=Array.isArray(history)?history.slice(-6).map(m=>({role:m.role==="assistant"?"assistant":"user",content:String(m.text||"").slice(0,700)})):[];

  const system=wantsModel ? [
    "You are G3D AI, a conversational 3D design assistant.",
    "The user explicitly wants to create or modify a 3D model.",
    "Return ONLY compact one-line JSON with keys mode,reply,spec.",
    "mode must be model.",
    "reply must be a natural, useful assistant sentence about what you are doing, about 20 words or fewer.",
    'spec uses short keys: t=type,o=op,p=position,r=rotation,s=scale,d=size,R=radius,R2=radius2,h=height,OR=outerRadius,IR=innerRadius,M=majorRadius,m=minorRadius,l=length,z=depth,P=points; top keys pattern,periods,thickness,quality.',
    'Example: {"mode":"model","reply":"I’ll build that rounded cube.","spec":{"parts":[{"t":"box","d":[40,40,40]}],"pattern":"none","periods":2.5,"thickness":1.5,"quality":18}}',
    "Use real solids and CSG. Multiple parts for multiple features. Prism for custom outlines. Subtract for holes/cutouts. Preserve requested dimensions/features.",
    "Never replace an unknown/custom design with an unrelated primitive.",
    "For modifications, preserve the current design and change only the requested part. New requests build the complete design.",
    "Max 10 parts, max 32 polygon points. Dimensions are mm. Rotation is degrees. Omit unused fields. First part normally uses o=u.",
    "Recent conversation: "+JSON.stringify(recent),
    "Current design: "+current,
    "USER REQUEST: "+String(userText||"")
  ].join("\n") : [
    "You are G3D AI, a helpful general-purpose conversational assistant.",
    "The user is not asking you to make or modify a 3D model right now.",
    "Answer naturally and directly. You can discuss general topics, ideas, engineering, science, technology, 3D printing, or everyday questions.",
    "Do not output geometry JSON. Do not pretend to build a model. Do not force the conversation toward 3D modeling.",
    "Use the recent conversation to understand context.",
    "Return ONLY compact one-line JSON with keys mode and reply.",
    "mode must be chat. reply must be the complete assistant response as a string.",
    "Recent conversation: "+JSON.stringify(recent),
    "USER MESSAGE: "+String(userText||"")
  ].join("\n");

  const budget=wantsModel?160:190;
  const result=await generator([{role:"system",content:system},{role:"user",content:String(userText||"")}],{max_new_tokens:budget,do_sample:false,num_beams:1,use_cache:true,return_full_text:false});
  const parsed=parseJSON(outputText(result));
  if(!parsed||typeof parsed!=="object")throw new Error("G3D returned an invalid response.");
  if(!wantsModel)return {mode:"chat",reply:String(parsed.reply||"I'm here.")};
  return {mode:"model",reply:String(parsed.reply||"I'll build that."),spec:expandCompactSpec(parsed.spec||parsed)};
}

self.onmessage=async e=>{
  const m=e.data||{};
  try{
    if(m.type==="preload"){
      const modelId=m.modelId||"ai1";
      const started=performance.now();
      const generator=await getPipe(modelId,"preload");
      const elapsed=performance.now()-started;
      send("ready","preload",{text:(MODEL_CONFIGS[modelId]||MODEL_CONFIGS.ai1).name+" ready.",modelId,elapsed});
      setTimeout(()=>{generator("JSON",{max_new_tokens:1,do_sample:false,return_full_text:false}).catch(()=>{});},0);
      return;
    }
    if(m.type==="generate"){
      const spec=await qwenToSpec(m.id,m.modelId||"ai1",m.prevSpec||null,String(m.userText||""),Array.isArray(m.history)?m.history:[]);
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
