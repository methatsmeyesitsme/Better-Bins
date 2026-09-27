/* G3D BYOK cloud AI bridge.
   Uses the provider selected in Settings and the user's saved/unlocked API key.
   Requests are made directly from the browser to the selected provider. */
(function(){
  'use strict';
  const PROVIDERS={
    gemini:{label:'Google Gemini',model:'gemini-3.8-flash',kind:'gemini',url:'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'},
    openai:{label:'OpenAI',model:'gpt-5',kind:'openai',url:'https://api.openai.com/v1/chat/completions'},
    anthropic:{label:'Anthropic',model:'claude-sonnet-5',kind:'anthropic',url:'https://api.anthropic.com/v1/messages'},
    groq:{label:'Groq',model:'openai/gpt-oss-120b',kind:'openai',url:'https://api.groq.com/openai/v1/chat/completions'},
    deepseek:{label:'DeepSeek',model:'deepseek-v4-flash',kind:'openai',url:'https://api.deepseek.com/chat/completions'},
    custom:{label:'Custom provider',model:'',kind:'openai',url:''}
  };

  function providerId(){
    const el=document.getElementById('apiProvider');
    return el&&PROVIDERS[el.value]?el.value:'gemini';
  }
  function info(){
    const id=providerId(),p=PROVIDERS[id]||PROVIDERS.gemini;
    return {id,...p};
  }
  function historyMessages(history){
    return (Array.isArray(history)?history:[]).slice(-4).map(m=>({
      role:m.role==='assistant'?'assistant':'user',
      content:String(m.text||'').slice(0,700)
    }));
  }
  function wantsModel(text,prevSpec){
    const s=String(text||'').toLowerCase().trim();
    if(/\b(make|create|build|design|generate|model|mesh|stl|3d print|print this|prototype|part|shape|geometry|hollow|lattice|gyroid|phone stand|keychain)\b/i.test(s))return true;
    return !!prevSpec &&
      /\b(this|that|it|model|design)\b/i.test(s) &&
      /\b(change|modify|edit|add|remove|move|rotate|resize|make it|turn it|taller|shorter|wider|narrower|thicker|thinner|bigger|smaller)\b/i.test(s);
  }
  function modelSystem(prevSpec,history){
    return [
      "You are G3D AI, a conversational 3D design assistant.",
      "You are an AI first: normal conversation is allowed and should stay normal conversation.",
      "Only return a model plan when G3D explicitly asks you to build or modify a 3D model.",
      "When model mode is requested, return ONLY compact JSON with keys mode,reply,spec.",
      "mode must be model. reply is a short natural sentence.",
      'spec parts use type box|roundedBox|sphere|cylinder|tube|cone|torus|capsule|prism and op union|subtract|intersect.',
      'Each part may use position, rotation, scale, size, radius, radius2, height, outerRadius, innerRadius, majorRadius, minorRadius, length, depth, points.',
      'pattern is none|gyroid|schwarzp|diamond; periods, thickness, quality are numbers.',
      "Use multiple solids for real features, subtract for holes/cutouts, and prism for custom outlines.",
      "Preserve the current design when modifying it. Do not replace custom designs with unrelated primitives.",
      "All dimensions are millimeters. Maximum 24 parts and 48 polygon points. Be concise.",
      "Current design: "+JSON.stringify(prevSpec||null),
    ].join("\n");
  }
  function chatSystem(history){
    return [
      "You are G3D AI, a helpful general-purpose conversational assistant.",
      "You are not required to make 3D models. Talk naturally unless the user explicitly asks to create or modify one.",
      "Answer directly and concisely. Use the supplied conversation for context.",
      "Do not output geometry JSON in normal chat.",
      "Recent conversation: "+JSON.stringify(historyMessages(history)),
    ].join("\n");
  }
  function parseModelJSON(text){
    const fence=String.fromCharCode(96)+String.fromCharCode(96)+String.fromCharCode(96);
    const cleaned=String(text||'').replaceAll(fence+'json','').replaceAll(fence,'').trim();
    const start=cleaned.indexOf('{');
    if(start<0)throw new Error('The cloud AI returned no model JSON.');
    let depth=0,quote=false,escaped=false;
    for(let i=start;i<cleaned.length;i++){
      const ch=cleaned[i];
      if(quote){
        if(escaped)escaped=false;
        else if(ch==='\\')escaped=true;
        else if(ch==='"')quote=false;
        continue;
      }
      if(ch==='"')quote=true;
      else if(ch==='{')depth++;
      else if(ch==='}'&&--depth===0)return JSON.parse(cleaned.slice(start,i+1));
    }
    throw new Error('The cloud AI returned incomplete model JSON.');
  }
  function extractGemini(data){
    return data&&data.candidates&&data.candidates[0]&&data.candidates[0].content&&Array.isArray(data.candidates[0].content.parts)
      ?data.candidates[0].content.parts.map(x=>x.text||'').join(''):'';
  }
  function extractOpenAI(data){
    return data&&data.choices&&data.choices[0]&&data.choices[0].message?String(data.choices[0].message.content||''):'';
  }
  function extractAnthropic(data){
    return Array.isArray(data&&data.content)?data.content.map(x=>x.text||'').join(''):'';
  }
  function sleep(ms,signal){
    return new Promise((resolve,reject)=>{
      const t=setTimeout(resolve,ms);
      if(signal)signal.addEventListener('abort',()=>{clearTimeout(t);reject(new DOMException('Aborted','AbortError'));},{once:true});
    });
  }
  function extractUsage(data){
  const u=data&&(
    data.usage||data.usageMetadata||
    (data.response&&data.response.usageMetadata)||
    (data.candidates&&data.candidates[0]&&data.candidates[0].usageMetadata)
  );
  if(!u)return null;
  const input=Number(u.promptTokenCount??u.input_tokens??u.inputTokens??u.prompt_tokens??0);
  const output=Number(u.candidatesTokenCount??u.output_tokens??u.outputTokens??u.completion_tokens??0);
  const total=Number(u.totalTokenCount??u.total_tokens??u.totalTokens??(input+output));
  return {inputTokens:Number.isFinite(input)?input:0,outputTokens:Number.isFinite(output)?output:0,totalTokens:Number.isFinite(total)?total:(input+output),requests:1};
}
function extractMonthlyLimit(data){
  const sources=[
    data,
    data&&data.error,
    data&&data.usage,
    data&&data.usageMetadata,
    data&&data.metadata,
    data&&data.limits,
    data&&data.quota,
    data&&data.response&&data.response.usageMetadata
  ].filter(Boolean);
  const names=['monthlyLimit','monthly_limit','monthlyQuota','monthly_quota','monthLimit','month_limit','monthlyCap','monthly_cap'];
  for(const src of sources){
    for(const name of names){
      const n=Number(src[name]);
      if(Number.isFinite(n)&&n>=0)return n;
    }
    const nested=src.limits||src.quota||src.billing;
    if(nested){
      for(const name of names){
        const n=Number(nested[name]);
        if(Number.isFinite(n)&&n>=0)return n;
      }
    }
  }
  return null;
}
function rateLimitInfo(res){
  if(!res||!res.headers)return null;
  const get=n=>res.headers.get(n);
  const limit=Number(get('x-ratelimit-limit-requests'));
  const remaining=Number(get('x-ratelimit-remaining-requests'));
  const reset=get('x-ratelimit-reset-requests');
  const monthlyHeaders=['x-monthly-limit','x-ratelimit-limit-month','x-quota-limit-month','x-billing-limit-month'];
  let monthlyLimit=null;
  for(const name of monthlyHeaders){
    const n=Number(get(name));if(Number.isFinite(n)&&n>=0){monthlyLimit=n;break;}
  }
  return (Number.isFinite(limit)&&Number.isFinite(remaining))||monthlyLimit!==null
    ?{window:'request',limit,remaining,reset,monthlyLimit}:null;
}
function quotaExhausted(res,data){
  const msg=String(data&&data.error&&(data.error.message||data.error.type||data.error.code)||'').toLowerCase();
  const code=String(data&&data.error&&data.error.code||'').toLowerCase();
  if(code==='insufficient_quota'||code==='blocked_api_access')return true;
  if(/monthly (limit|cap|spend)|spend (limit|cap)|billing (limit|cap)|credits? remaining|no credits|quota.*exceeded|exceeded.*quota/.test(msg))return true;
  return false;
}
async function readSSE(res,onDelta,signal,onMeta){
  if(!res.body)return '';
  const reader=res.body.getReader(),decoder=new TextDecoder(),parts=[];let buffer='';
  const processLine=(line)=>{
    const raw=line.trim();
    if(!raw||raw.startsWith(':'))return;
    const dataLine=raw.startsWith('data:')?raw.slice(5).trim():raw;
    if(!dataLine||dataLine==='[DONE]')return;
    try{
      const data=JSON.parse(dataLine);if(onMeta)onMeta(data);
      let delta='';
      if(data.candidates&&data.candidates[0]&&data.candidates[0].content&&Array.isArray(data.candidates[0].content.parts)){
        delta=data.candidates[0].content.parts.filter(function(p){return p&&!p.thought;}).map(function(p){return p.text||'';}).join('');
      }else if(data.choices&&data.choices[0]&&data.choices[0].delta){delta=String(data.choices[0].delta.content||'');}
      else if(data.type==='content_block_delta'&&data.delta){delta=String(data.delta.text||'');}
      else if(data.event_type==='step.delta'&&data.delta&&data.delta.type==='text'){delta=String(data.delta.text||'');}
      if(delta){parts.push(delta);if(onDelta)onDelta(delta);}
    }catch(e){}
  };
  while(true){
    if(signal&&signal.aborted)throw new DOMException('Aborted','AbortError');
    const result=await reader.read();if(result.done)break;
    buffer+=decoder.decode(result.value,{stream:false});
    const lines=buffer.split(/\r?\n/);buffer=lines.pop()||'';
    for(const line of lines)processLine(line);
  }
  buffer+=decoder.decode();if(buffer.trim())processLine(buffer);
  return parts.join('');
}
async function geminiRequest(model,apiKey,system,contents,maxTokens,{signal,stream=false,onDelta,onUsage}={}){
    const endpoint=stream?'streamGenerateContent?alt=sse':'generateContent';
    const url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':'+endpoint;
    const generationConfig={maxOutputTokens:maxTokens};
    if(model==='gemini-3.8-flash'||model==='gemini-3.7-flash')generationConfig.thinkingConfig={thinkingLevel:'low'};
    const res=await fetch(url,{method:'POST',signal,headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
      body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,generationConfig})});
    let data=null,text='';
    if(stream && res.ok){let streamUsage=null,streamMonthlyLimit=null;text=await readSSE(res,onDelta,signal,d=>{const u=extractUsage(d);if(u)streamUsage=u;const ml=extractMonthlyLimit(d);if(ml!==null)streamMonthlyLimit=ml;});if(streamUsage&&onUsage){const rl=rateLimitInfo(res)||{};if(streamMonthlyLimit!==null)rl.monthlyLimit=streamMonthlyLimit;onUsage(streamUsage,rl);}}
    else{try{data=await res.json();}catch(e){}text=extractGemini(data);const u=extractUsage(data);if(u&&onUsage){const rl=rateLimitInfo(res)||{},ml=extractMonthlyLimit(data);if(ml!==null)rl.monthlyLimit=ml;onUsage(u,rl);}}
    return {res,data,text};
  }
  async function callProvider(p,apiKey,system,history,userText,maxTokens,{signal,onDelta,onUsage}={}){
    const historyText=historyMessages(history);
    let res,data,text='';
    if(p.kind==='gemini'){
      const contents=[...historyText,{role:'user',content:String(userText||'')}].map(m=>({
        role:m.role==='assistant'?'model':'user',parts:[{text:String(m.content||'')}]
      }));
      let result=await geminiRequest(p.model,apiKey,system,contents,maxTokens,{signal,stream:true,onDelta,onUsage});
      if(result.res.ok&&!result.text.trim())result=await geminiRequest(p.model,apiKey,system,contents,maxTokens,{signal,stream:false,onDelta:null,onUsage});
      if(!result.res.ok && result.res.status===503){
        await sleep(250,signal);
        result=await geminiRequest(p.model,apiKey,system,contents,maxTokens,{signal,stream:true,onDelta});
      }
      if(!result.res.ok && result.res.status===503){
        const fallback='gemini-3.7-flash';
        result=await geminiRequest(fallback,apiKey,system,contents,maxTokens,{signal,stream:true,onDelta,onUsage});
      }
      res=result.res;data=result.data;text=result.text;
    }else if(p.kind==='anthropic'){
      res=await fetch(p.url,{method:'POST',signal,headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model:p.model,max_tokens:maxTokens,stream:true,system,messages:[...historyText,{role:'user',content:String(userText||'')}].map(m=>({role:m.role,content:m.content}))})});
      if(res.ok){let streamUsage=null;text=await readSSE(res,onDelta,signal,d=>{const u=extractUsage(d);if(u)streamUsage=u;});if(streamUsage&&onUsage)onUsage(streamUsage,rateLimitInfo(res));}else{try{data=await res.json();}catch(e){}}
    }else{
      if(!p.url)throw new Error('Custom providers need a custom endpoint.');
      res=await fetch(p.url,{method:'POST',signal,headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
        body:JSON.stringify({model:p.model,messages:[{role:'system',content:system},...historyText,{role:'user',content:String(userText||'')}],max_completion_tokens:maxTokens,stream:true,stream_options:{include_usage:true}})});
      if(res.ok)text=await readSSE(res,onDelta,signal);else{try{data=await res.json();}catch(e){}}
    }
    if(!res.ok){
      const msg=data&&data.error&&(data.error.message||data.error.type);
      const err=new Error((p.label||'AI provider')+' error ('+res.status+'): '+(msg||'Request failed.'));
      err.providerStatus=res.status;err.providerQuotaExhausted=quotaExhausted(res,data);err.providerRateLimit=rateLimitInfo(res);err.providerError=data&&data.error||null;throw err;
    }
    if(!text.trim())throw new Error((p.label||'AI provider')+' returned an empty response.');
    return text;
  }
  async function respond({prevSpec,userText,history,status,signal,onDelta,onUsage}){
    const auth=window.g3dAuth;
    let vault=auth&&auth.apiVaultStatus?auth.apiVaultStatus():null;
    if(vault&&vault.saved&&!vault.key&&auth&&auth.unlockApiKey){
      try{vault=await auth.unlockApiKey();}catch(e){}
    }
    if(!vault||!vault.key)throw new Error('Save your API key in Settings first.');
    const p=info();
    if(vault.provider!==p.id)throw new Error('The saved key is for '+String(vault.provider||'another provider')+'. Select the matching provider in Settings.');
    const build=wantsModel(userText,prevSpec);
    if(status)status.textContent=p.label+' is thinking…';
    if(build){
      const raw=await callProvider(p,vault.key,modelSystem(prevSpec,history),history,userText,420,{signal,onDelta:null,onUsage});
      const parsed=parseModelJSON(raw);
      if(parsed.mode!=='model')throw new Error('The provider did not return a valid model response.');
      return {mode:'model',reply:String(parsed.reply||'I’ll build that.'),spec:parsed.spec||parsed};
    }
    const raw=await callProvider(p,vault.key,chatSystem(history),history,userText,180,{signal,onDelta,onUsage});
    return {mode:'chat',reply:raw.trim()};
  }
  window.g3dCloud={respond,info,providerConfig:PROVIDERS};
})();