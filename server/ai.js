export async function callAI(system,userText){
 if(!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured');
 const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),30000);
 try{const r=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:process.env.ANTHROPIC_MODEL||'claude-sonnet-4-6',max_tokens:1200,system,messages:[{role:'user',content:userText}]}),signal:controller.signal});
 const j=await r.json().catch(()=>({})); if(!r.ok) throw new Error(j?.error?.message||`AI request failed (${r.status})`); return (j.content||[]).map(x=>x.text||'').join('\n');
 }finally{clearTimeout(timer);}
}
export function jsonFromAI(text){const s=text.replace(/```json|```/g,'').trim();try{return JSON.parse(s)}catch{const m=s.match(/\{[\s\S]*\}/);return m?JSON.parse(m[0]):null}}
