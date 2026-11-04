(function(root){
 'use strict';
 const instant=s=>typeof s==='string'&&/(?:Z|[+-]\d{2}:?\d{2})$/i.test(s)?Date.parse(s):NaN;
 function endpoint(city){
  if(String(city?.country_code||'').toUpperCase()!=='US'||!Number.isFinite(city?.lat)||!Number.isFinite(city?.lon)||Math.abs(city.lat)>90||Math.abs(city.lon)>180)return null;
  return 'https://api.weather.gov/alerts/active?point='+city.lat.toFixed(2)+','+city.lon.toFixed(2);
 }
 function normalize(data,now=Date.now()){
  if(data?.type!=='FeatureCollection'||!Array.isArray(data.features))throw Error('Invalid official alert collection');
  const alerts=[],seen=new Set();let rejected=0;
  for(const f of data.features){
   const p=f?.properties;
   if(!p||p.status!=='Actual'||!['Alert','Update'].includes(p.messageType)){rejected++;continue;}
   const sent=instant(p.sent),effective=instant(p.effective),expires=instant(p.expires),ends=instant(p.ends);
   if(!Number.isFinite(sent)||!Number.isFinite(effective)||!Number.isFinite(expires)||sent>now+3600000||expires<=effective||Number.isFinite(ends)&&ends<effective||typeof p.event!=='string'||!p.event.trim()){rejected++;continue;}
   if(Math.min(expires,Number.isFinite(ends)?ends:expires)<=now)continue;
   const id=typeof f.id==='string'?f.id:typeof p.id==='string'?p.id:null;
   if(!id){rejected++;continue;}if(seen.has(id))continue;seen.add(id);
   alerts.push({id,event:p.event,headline:String(p.headline||''),description:String(p.description||''),instruction:String(p.instruction||''),sender:String(p.senderName||'NWS'),severity:String(p.severity||'Unknown'),sent:new Date(sent).toISOString(),effective:new Date(effective).toISOString(),expires:new Date(expires).toISOString(),validUntil:Math.min(expires,Number.isFinite(ends)?ends:expires),upcoming:effective>now});
  }
  alerts.sort((a,b)=>instant(a.effective)-instant(b.effective));
  return {alerts,partial:rejected>0||!!data.pagination?.next,rejected};
 }
 function create(options={}){
  const request=options.fetch||root.fetch.bind(root),notify=options.onChange||(()=>{}),clock=options.now||Date.now;
  let value={status:'uncovered',key:null,at:0,alerts:[]},seq=0,controller=null;
  async function load(city,force=false){
   const url=endpoint(city),key=url||'uncovered';
   if(!force&&value.key===key&&(value.status==='loading'||clock()-value.at<300000))return value;
   const token=++seq;if(controller)controller.abort();
   if(!url){value={status:'uncovered',key,at:clock(),alerts:[]};notify();return value;}
   controller=new AbortController();const own=controller;
   value={status:'loading',key,at:clock(),alerts:[]};notify();
   const timer=setTimeout(()=>own.abort(),12000);
   try{
    const response=await request(url,{signal:own.signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/geo+json'}});
    if(!response.ok)throw Error('Official alert HTTP '+response.status);
    const parsed=normalize(await response.json(),clock());
    if(token!==seq)return value;
    value={...parsed,status:parsed.partial?'partial':'ready',key,at:clock()};
   }catch(e){if(token!==seq)return value;value={status:'error',key,at:clock(),alerts:[]};}
   finally{clearTimeout(timer);}
   if(token===seq)notify();return value;
  }
  return {load,get:()=>{
   const alerts=value.alerts.filter(a=>a.validUntil>clock()).map(a=>({...a,upcoming:instant(a.effective)>clock()}));
   return {...value,alerts,status:alerts.length===value.alerts.length?value.status:'partial'};
  }};
 }
 root.OfficialAlerts={endpoint,normalize,create};
})(typeof window!=='undefined'?window:globalThis);
