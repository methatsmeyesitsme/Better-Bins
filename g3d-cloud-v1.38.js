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
    return (Array.isArray(history)?history:[]).slice(-12).map(m=>({
      role:m.role==='assistant'?'assistant':'user',
      content:String(m.text||'').slice(0,5000)
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
      "All dimensions are millimeters. Maximum 24 parts and 48 polygon points.",
      "Current design: "+JSON.stringify(prevSpec||null),
      "Recent conversation: "+JSON.stringify(historyMessages(history))
    ].join("\n");
  }
  function chatSystem(history){
    return [
      "You are G3D AI, a helpful general-purpose conversational assistant.",
      "You are not required to make 3D models. Talk naturally unless the user explicitly asks to create or modify one.",
      "Answer directly, conversationally, and use the recent conversation for context.",
      "Do not output geometry JSON in normal chat.",
      "Recent conversation: "+JSON.stringify(historyMessages(history))
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
  async function geminiRequest(model,apiKey,system,contents,maxTokens){
    const url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(model)+':generateContent';
    const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':apiKey},
      body:JSON.stringify({systemInstruction:{parts:[{text:system}]},contents,generationConfig:{maxOutputTokens:maxTokens}})});
    let data=null;try{data=await res.json();}catch(e){}
    return {res,data,text:extractGemini(data)};
  }
  async function callProvider(p,apiKey,system,history,userText,maxTokens){
    const historyText=historyMessages(history);
    let res,data,text='';
    if(p.kind==='gemini'){
      const contents=[...historyText,{role:'user',content:String(userText||'')}].map(m=>({
        role:m.role==='assistant'?'model':'user',
        parts:[{text:String(m.content||'')}]
      }));
      let result=await geminiRequest(p.model,apiKey,system,contents,maxTokens);
      if(!result.res.ok && result.res.status===503){
        await new Promise(r=>setTimeout(r,450));
        result=await geminiRequest(p.model,apiKey,system,contents,maxTokens);
      }
      if(!result.res.ok && result.res.status===503){
        const fallback='gemini-3.7-flash';
        result=await geminiRequest(fallback,apiKey,system,contents,maxTokens);
        if(result.res.ok){
          text=result.text;
        }else{
          const msg=result.data&&result.data.error&&(result.data.error.message||result.data.error.type);
          throw new Error('Google Gemini is temporarily busy on both models (last error '+result.res.status+'): '+(msg||'Request failed.'));
        }
      }else{
        res=result.res;data=result.data;text=result.text;
      }
      res=result.res;data=result.data;
    }else if(p.kind==='anthropic'){
      res=await fetch(p.url,{method:'POST',headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
        body:JSON.stringify({model:p.model,max_tokens:maxTokens,system,messages:[...historyText,{role:'user',content:String(userText||'')}].map(m=>({role:m.role,content:m.content}))})});
      data=await res.json();text=extractAnthropic(data);
    }else{
      if(!p.url)throw new Error('Custom providers need a custom endpoint.');
      res=await fetch(p.url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+apiKey},
        body:JSON.stringify({model:p.model,messages:[{role:'system',content:system},...historyText,{role:'user',content:String(userText||'')}],max_completion_tokens:maxTokens})});
      data=await res.json();text=extractOpenAI(data);
    }
    if(!res.ok){
      const msg=data&&data.error&&(data.error.message||data.error.type);
      throw new Error((p.label||'AI provider')+' error ('+res.status+'): '+(msg||'Request failed.'));
    }
    if(!text.trim())throw new Error((p.label||'AI provider')+' returned an empty response.');
    return text;
  }
  async function respond({prevSpec,userText,history,status}){
    const auth=window.g3dAuth,vault=auth&&auth.apiVaultStatus?auth.apiVaultStatus():null;
    if(!vault||!vault.key)throw new Error('Save and unlock your API key in Settings first.');
    const p=info();
    if(vault.provider!==p.id)throw new Error('The saved key is for '+String(vault.provider||'another provider')+'. Select the matching provider in Settings.');
    const build=wantsModel(userText,prevSpec);
    if(status)status.textContent=p.label+' is thinking…';
    if(build){
      const raw=await callProvider(p,vault.key,modelSystem(prevSpec,history),history,userText,1200);
      const parsed=parseModelJSON(raw);
      if(parsed.mode!=='model')throw new Error('The provider did not return a valid model response.');
      return {mode:'model',reply:String(parsed.reply||'I’ll build that.'),spec:parsed.spec||parsed};
    }
    const raw=await callProvider(p,vault.key,chatSystem(history),history,userText,900);
    return {mode:'chat',reply:raw.trim()};
  }
  window.g3dCloud={respond,info,providerConfig:PROVIDERS};
})();