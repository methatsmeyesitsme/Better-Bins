import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.2/+esm";

const MODEL = "onnx-community/Qwen2.5-0.5B-Instruct";
let pipe = null;
let loading = null;

async function getPipe() {
  if (pipe) return pipe;
  if (loading) return loading;
  loading = (async () => {
    const device = navigator.gpu ? "webgpu" : "wasm";
    try {
      pipe = await pipeline("text-generation", MODEL, { dtype: "q4", device });
    } catch (err) {
      if (device !== "webgpu") throw err;
      pipe = await pipeline("text-generation", MODEL, { dtype: "q4", device: "wasm" });
    }
    return pipe;
  })();
  try { return await loading; } finally { loading = null; }
}

function outputText(result) {
  const item = Array.isArray(result) ? result[0] : result;
  const generated = item && item.generated_text;
  if (Array.isArray(generated)) {
    const last = generated[generated.length - 1];
    return typeof last === "string" ? last : ((last && last.content) || "");
  }
  return typeof generated === "string" ? generated : "";
}

function parseJSON(text) {
  const cleaned = text
    .replace(/\u0060\u0060\u0060json/gi, "")
    .replace(/\u0060\u0060\u0060/g, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("Qwen returned no JSON object.");
  let depth = 0, quote = false, escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') quote = false;
      continue;
    }
    if (ch === '"') quote = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1));
    }
  }
  throw new Error("Qwen returned incomplete JSON.");
}

async function qwenToSpec(prevSpec, userText, status) {
  status.textContent = pipe
    ? "Qwen is interpreting your request..."
    : "Loading Qwen locally (first run may take a little while)...";

  const generator = await getPipe();
  const current = JSON.stringify(prevSpec || {
    primary: { shape:"cube", size:40, diameter:40, height:40, outerDiameter:50, tubeDiameter:14, rounded:true, cornerRadius:5 },
    secondary: null, pattern:"gyroid", periods:2.5, thickness:1.5, quality:44
  });

  const system = [
    "You are G3D's local 3D geometry planner.",
    "Return ONLY one valid JSON object. No explanation and no markdown.",
    "Build arbitrary designs from multiple real solids using CSG.",
    'Schema: {"parts":[{"type":"box|roundedBox|sphere|cylinder|tube|cone|torus|capsule|prism","op":"union|subtract|intersect","position":[x,y,z],"rotation":[xDeg,yDeg,zDeg],"scale":[x,y,z],"size":[x,y,z],"radius":number,"radius2":number,"height":number,"outerRadius":number,"innerRadius":number,"majorRadius":number,"minorRadius":number,"length":number,"depth":number,"points":[[x,y],...]}],"pattern":"none|gyroid|schwarzp|diamond","periods":number,"thickness":number,"quality":number}',
    "Use multiple parts for complex objects. Use prism for custom 2D outlines. Use subtract parts for holes and cutouts. Use rotation and position to place features.",
    "Do not force an unknown design into a cube, sphere, cylinder, or ring. Keep the requested structure.",
    "Current design: " + current
  ].join("\n");

  const result = await generator([
    { role:"system", content:system },
    { role:"user", content:userText }
  ], {
    max_new_tokens:180,
    do_sample:false,
    return_full_text:false
  });

  return parseJSON(outputText(result));
}

window.g3dQwenToSpec = qwenToSpec;
window.g3dQwenModel = MODEL;
