(function(root){
  'use strict';
  // A time without an explicit offset is not a UTC instant. Do not let
  // the viewer's device zone change how old a cyclone position appears.
  function instant(stamp){return typeof stamp==='string'&&/(?:Z|[+-]\d{2}:?\d{2})$/i.test(stamp)?Date.parse(stamp):NaN;}
  function utcLabel(stamp){const t=instant(stamp);return Number.isFinite(t)?new Date(t).toISOString().slice(0,16).replace('T',' ')+' UTC':'时间未确认';}
  function age(stamp,now){const t=instant(stamp);return Number.isFinite(t)?(now-t)/3600000:Infinity;}
  function normalizeSnapshot(raw){
    if(!raw||!Array.isArray(raw.storms)||!Array.isArray(raw.errors))return null;
    if(raw.storms.some(s=>!s||typeof s!=='object'))return null;
    if(raw.providerStatus&&raw.providerUpdated)return raw;
    // Older published files have no independent verified inventory per source.
    // Use dated, observed positives only; an empty legacy file is not an all-clear.
    if(!Array.isArray(raw.sources)||!Number.isFinite(Date.parse(raw.updated)))return null;
    const status={};
    for(const p of ['CMA','NHC'])status[p]=raw.sources.includes(p)&&!raw.errors.some(e=>String(e).startsWith(p))?'partial':'unavailable';
    return {...raw,providerStatus:status,providerUpdated:{CMA:raw.updated,NHC:raw.updated}};
  }
  function forecastPoints(storm,now=Date.now()){
    const points=[];let rejected=0;
    for(const p of Array.isArray(storm.forecast)?storm.forecast:[]){
      if(!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)||Math.abs(p.lat)>90||Math.abs(p.lon)>180){rejected++;continue;}
      const base=instant(p.baseTime),lead=p.leadH;
      const explicit=instant(p.time);
      const anchored=Number.isFinite(base)&&Number.isFinite(lead)&&lead>0&&lead<=240;
      const time=anchored?base+lead*3600000:explicit;
      // Never shift an older forecast using the latest observation time.
      if(!Number.isFinite(time)||((p.baseTime!=null||lead!=null)&&!anchored)||(anchored&&(age(p.baseTime,now)<-1||age(p.baseTime,now)>24))||
        (anchored&&Number.isFinite(explicit)&&Math.abs(explicit-time)>1000)||time>now+240*3600000){rejected++;continue;}
      if(time<=now)continue;
      points.push({...p,time:new Date(time).toISOString()});
    }
    points.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
    return {points:points.filter((p,i)=>!i||p.time!==points[i-1].time),rejected};
  }
  function merge(live,snapshot,now=Date.now()){
    const storms=[],notes=[],status={};
    const recent=stamp=>age(stamp,now)>=-1&&age(stamp,now)<=3;
    for(const provider of ['CMA','NHC']){
      const result=live[provider];
      const freshLive=Array.isArray(result);
      const partialLive=!freshLive&&result&&Array.isArray(result.storms)&&Array.isArray(result.activeIds);
      const sourceStamp=snapshot?.providerUpdated?.[provider]||snapshot?.updated;
      const snapshotOk=recent(sourceStamp)&&!(snapshot?.errors||[]).some(x=>String(x).startsWith(provider))&&(!snapshot?.providerStatus?.[provider]||snapshot.providerStatus[provider]==='available');
      const partialSnapshot=snapshot?.providerStatus?.[provider]==='partial';
      const snapshotRows=(snapshot?.storms||[]).filter(s=>s.provider===provider);
      const fallback=snapshotRows.filter(s=>(snapshotOk||partialSnapshot)&&recent(s.fetchedAt||sourceStamp));
      // An empty successful response is authoritative; never resurrect old storms.
      let rows=null;
      if(freshLive){rows=result.map(s=>({...s,dataSource:'源站'}));status[provider]='live';}
      else if(partialLive){
        const ids=new Set(result.storms.map(s=>s.id)),active=new Set(result.activeIds);
        rows=result.storms.filter(s=>active.has(s.id)).map(s=>({...s,dataSource:'源站'}));
        rows.push(...fallback.filter(s=>active.has(s.id)&&!ids.has(s.id)).map(s=>({...s,dataSource:'快照补充'})));
        status[provider]='partial';notes.push(provider+' 部分详情未更新，保留有效资料；不能据此判断全部活动状态');
      }else if(snapshotOk){
        rows=fallback.map(s=>({...s,dataSource:'快照'}));status[provider]='snapshot';
        if(fallback.length!==snapshotRows.length){status[provider]='partial';notes.push(provider+' 部分详情下载时间已过期，未作为当前资料展示');}
      }
      else if(partialSnapshot){
        const inventory=snapshot?.providerInventory?.[provider];
        rows=fallback.filter(s=>!inventory||!recent(inventory.updated)||!Array.isArray(inventory.ids)||inventory.ids.includes(s.id)).map(s=>({...s,dataSource:'部分快照'}));
        status[provider]='partial';notes.push(provider+' 快照更新不完整，仅显示仍在有效期内的资料');
      }
      if(!rows){status[provider]='unavailable';notes.push(provider+' 数据缺失或快照已过期，当前活动状态未知');continue;}
      let excluded=0;
      for(const s of rows){
        const hours=age(s.time,now);
        if(hours< -1||hours>12||!Number.isFinite(s.lat)||!Number.isFinite(s.lon)||Math.abs(s.lat)>90||Math.abs(s.lon)>180){excluded++;continue;}
        if(s.status && s.status!=='start')continue;
        const forecast=forecastPoints(s,now);
        storms.push({...s,ageHours:hours,forecast:forecast.points,forecastNote:forecast.rejected?'部分预报缺少可靠起报时间或已失效，未展示对应路径':''});
        if(forecast.rejected)notes.push(provider+' '+(s.nameZh||s.nameEn||s.id||'气旋')+' 的部分未来路径时效无法确认');
      }
      if(excluded){status[provider]='partial';notes.push(provider+' 有'+excluded+'条过期/无有效时空信息的资料，未作为当前台风展示');}
    }
    return {storms,notes,status,complete:Object.values(status).every(s=>s==='live'||s==='snapshot')};
  }
  const coverageNote='台风资料源为 CMA / NHC，尚非全球所有洋区完整覆盖；未接入或缺失资料不能理解为没有台风。';
  root.StormQuality={merge,age,utcLabel,forecastPoints,coverageNote,normalizeSnapshot};
})(typeof window!=='undefined'?window:globalThis);
