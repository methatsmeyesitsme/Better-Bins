import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm";
const MODEL="onnx-community/Qwen2.5-0.5B-Instruct";
let pipe=null,loading=null;
function send(type,id,data={}){self.postMessage({type,id,...data});}
async function getPipe(id){
  if(pipe)return pipe;if(loading)return loading;
  send("status",id,{text:"Loading Qwen locally…"});
  loading=(async()=>{
    const device=(typeof navigator!=="undefined"&&navigator.gpu)?"webgpu":"wasm";
    try{pipe=await pipeline("text-generation",MODEL,{dtype:"q4",device});}
    catch(err){if(device!=="webgpu")throw err;pipe=await pipeline("text-generation",MODEL,{dtype:"q4",device:"wasm"});}
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
  const cleaned=String(text).replace(/```json/gi,"").replace(/```/g,"").replace(/<think>[sS]*?</think>/gi,"").trim();
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
    "You are G3D's local 3D geometry planner.",
    "Return ONLY one valid JSON object. No explanation and no markdown.",
    "Build arbitrary designs from multiple real solids using CSG.",
    'Schema: {"parts":[{"type":"box|roundedBox|sphere|cylinder|tube|cone|torus|capsule|prism","op":"union|subtract|intersect","position":[x,y,z],"rotation":[xDeg,yDeg,zDeg],"scale":[x,y,z],"size":[x,y,z],"radius":number,"radius2":number,"height":number,"outerRadius":number,"innerRadius":number,"majorRadius":number,"minorRadius":number,"length":number,"depth":number,"points":[[x,y],...]}],"pattern":"none|gyroid|schwarzp|diamond","periods":number,"thickness":number,"quality":number}',
    "Use multiple parts for complex objects. Use prism for custom 2D outlines. Use subtract parts for holes and cutouts. Use rotation and position to place features.",
    "Do not force an unknown design into a cube, sphere, cylinder, or ring. Keep the requested structure.",
    "Keep the number of parts <= 24 and polygon points <= 48.",
    "All dimensions are millimeters. Rotation is degrees.",
    "Current design: "+current
  ].join("\n");
  const result=await generator([{role:"system",content:system},{role:"user",content:String(userText||"")}],{max_new_tokens:180,do_sample:false,return_full_text:false});
  return parseJSON(outputText(result));
}
self.onmessage=async e=>{
  const m=e.data||{};
  try{
    if(m.type==="generate"){const spec=await qwenToSpec(m.id,m.prevSpec||null,String(m.userText||""));send("result",m.id,{spec});}
  }catch(err){send("error",m.id,{message:err?.message||String(err)});}
};
