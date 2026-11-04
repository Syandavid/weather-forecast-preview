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
   const age=clock()-value.at;
   if(!force&&value.key===key&&age>=0&&age<(value.status==='loading'?12000:300000))return value;
   const token=++seq;if(controller)controller.abort();
   if(!url){value={status:'uncovered',key,at:clock(),alerts:[]};notify();return value;}
   controller=new AbortController();const own=controller;
   const started=clock();
   value={status:'loading',key,at:started,alerts:[]};notify();
   const timer=setTimeout(()=>own.abort(),12000);
   try{
    const response=await request(url,{signal:own.signal,credentials:'omit',referrerPolicy:'no-referrer',headers:{Accept:'application/geo+json'}});
    if(!response.ok)throw Error('Official alert HTTP '+response.status);
    const data=await response.json();
    if(clock()<started||clock()-started>=12000)throw Error('Official alert request expired');
    const parsed=normalize(data,clock());
    if(token!==seq)return value;
    value={...parsed,status:parsed.partial?'partial':'ready',key,at:clock()};
   }catch(e){if(token!==seq)return value;value={status:'error',key,at:clock(),alerts:[]};}
   finally{clearTimeout(timer);}
   if(token===seq)notify();return value;
  }
  return {load,get:()=>{
   const age=clock()-value.at;
   if(['ready','partial'].includes(value.status)&&(age<0||age>=300000))return {...value,status:'stale',alerts:[]};
   const alerts=value.alerts.filter(a=>a.validUntil>clock()).map(a=>({...a,upcoming:instant(a.effective)>clock()}));
   return {...value,alerts,status:alerts.length===value.alerts.length?value.status:'partial'};
  }};
 }
 function summary(city,snapshot){
  const key=endpoint(city);
  if(!key)return '所选地点尚未接入官方预警；不能据此判断没有预警。';
  const prefix='已接入美国 NWS（所选坐标附近，非整个行政区）。';
  if(!snapshot||snapshot.key!==key||snapshot.status==='idle')return prefix+'尚未查询，请打开预警页。';
  if(snapshot.status==='loading')return prefix+'正在查询，当前状态未知。';
  if(snapshot.status==='stale')return prefix+'资料已过期，当前状态未知。';
  if(snapshot.status==='partial')return prefix+'部分资料无法核验，列表可能不完整。';
  if(snapshot.status!=='ready')return prefix+'查询失败或不可用，当前状态未知。';
  return prefix+(snapshot.alerts?.length?'本次查询有 '+snapshot.alerts.length+' 条有效信息，请查看预警页。':'本次查询未返回有效预警；不代表没有其他风险。');
 }
 root.OfficialAlerts={endpoint,normalize,create,summary};
})(typeof window!=='undefined'?window:globalThis);
