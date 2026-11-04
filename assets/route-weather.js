(function (root) {
  'use strict';
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const HOUR = 3600000;
  const placeCache = new Map();
  function placeError(message) { const error=new Error(message); error.userMessage=message; return error; }
  function placeCandidates(data) {
    const rows=Array.isArray(data?.features)?data.features.map(f=>{
      const p=f.properties||{},xy=f.geometry?.type==='Point'?f.geometry.coordinates:[];
      return {lat:xy?.[1],lon:xy?.[0],name:p.name||p.street||'',admin:[p.city,p.state,p.country].filter(Boolean).join(' · '),source:'Photon / OpenStreetMap'};
    }):(data?.results||[]).map(p=>({lat:p.latitude,lon:p.longitude,name:p.name,timezone:p.timezone,admin:[p.admin1,p.country].filter(Boolean).join(' · '),source:'Open-Meteo / GeoNames'}));
    return rows.filter(p=>p.name&&finite(p.lat)&&finite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180);
  }
  function choosePlace(text,rows) {
    const key=s=>String(s).normalize('NFKC').replace(/\s/g,'').toLowerCase();
    const exact=rows.filter(p=>key(p.name)===key(text));
    const choices=exact.length?exact:rows;
    if(!choices.length)return null;
    // A station building and its station node may represent the same place.
    // Never silently choose the first of distant namesakes.
    const first=choices[0];
    if(choices.some(p=>distance([first.lon,first.lat],[p.lon,p.lat])>250))
      throw placeError('找到多个“'+text+'”，请补充城市/地区，或直接在地图上选点。');
    return first;
  }
  async function geocode(text,request) {
    text=String(text||'').trim();
    if(!text)return null;
    if(placeCache.has(text))return {...placeCache.get(text)};
    let failed=false;
    const urls=['https://photon.komoot.io/api/?limit=5&q='+encodeURIComponent(text),
      'https://geocoding-api.open-meteo.com/v1/search?count=5&language=zh&format=json&name='+encodeURIComponent(text)];
    for(const url of urls){
      let data;
      try { data=await request(url,{timeoutMs:12000}); } catch(_){failed=true;continue;}
      const point=choosePlace(text,placeCandidates(data));
      if(point){
        if(placeCache.size>=100)placeCache.delete(placeCache.keys().next().value);
        placeCache.set(text,point);return {...point};
      }
    }
    throw placeError(failed?'地点搜索服务暂时不可达，请稍后重试，或在地图上选点。':'未找到“'+text+'”，请补充城市和完整地点名称，或在地图上选点。');
  }
  function wallTime(ms, timezone) {
    if (!finite(ms) || !timezone) return '';
    try {
      const p = {};
      new Intl.DateTimeFormat('en-CA', {timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).forEach(x=>p[x.type]=x.value);
      return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
    } catch (_) { return ''; }
  }
  function timeLabel(ms, timezone) {
    const local=wallTime(ms,timezone);
    if(!local)return finite(ms) ? new Date(ms).toISOString()+' UTC' : '暂无';
    const minutes=Math.round((Date.parse(local+'Z')-Math.floor(ms/60000)*60000)/60000);
    const absolute=Math.abs(minutes), sign=minutes<0?'-':'+';
    const offset=sign+String(Math.floor(absolute/60)).padStart(2,'0')+':'+String(absolute%60).padStart(2,'0');
    return local.replace('T',' ')+'（'+timezone+' · UTC'+offset+'）';
  }
  // User-entered wall time must not silently resolve a DST gap or repeated hour.
  function departure(text, timezone, fold='reject') {
    if (typeof text === 'number') return finite(text) ? {ok:true,time:text} : {ok:false,reason:'出发时间无效'};
    if (/Z$|[+-]\d\d:\d\d$/.test(text || '')) {
      const time=Date.parse(text); return {ok:finite(time),time,reason:'出发时间无效'};
    }
    const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text || '');
    if (!m || !timezone) return {ok:false,reason:'请填写出发地当地时间，等待时区确认'};
    const wall=Date.UTC(+m[1],+m[2]-1,+m[3],+m[4],+m[5]);
    if (new Date(wall).toISOString().slice(0,16)!==text) return {ok:false,reason:'出发日期或时间无效'};
    const offsets=new Set(), candidates=[];
    for (let h=-36;h<=36;h+=3) {
      const stamp=wall+h*HOUR, local=wallTime(stamp,timezone);
      if (!local) return {ok:false,reason:'无法确认出发地时区'};
      offsets.add(Date.parse(local+'Z')-stamp);
    }
    for (const offset of offsets) { const stamp=wall-offset; if(wallTime(stamp,timezone)===text)candidates.push(stamp); }
    candidates.sort((a,b)=>a-b);
    if (!candidates.length) return {ok:false,reason:'该当地时间不存在（夏令时跳时），请选择其他时间'};
    if (candidates.length>1 && !['earlier','later'].includes(fold)) return {ok:false,reason:'该时间因夏令时重复，请选择较早或较晚的一次',ambiguous:true};
    return {ok:true,time:fold==='later'?candidates.at(-1):candidates[0],ambiguous:candidates.length>1};
  }
  function distance(a,b) {
    const rad=Math.PI/180, p=(b[1]-a[1])*rad, q=(b[0]-a[0])*rad;
    return 12742000*Math.asin(Math.min(1,Math.sqrt(Math.sin(p/2)**2+Math.cos(a[1]*rad)*Math.cos(b[1]*rad)*Math.sin(q/2)**2)));
  }
  // Full OSRM geometry + per-edge durations. Fall back to explicitly labelled
  // distance-proportional ETA only if the server omits valid annotations.
  function samples(route, maximum=12) {
    const coords=route?.geometry?.coordinates || [], duration=route?.duration;
    if(coords.length<2 || !finite(duration) || duration<=0)throw Error('路线缺少有效几何或行程耗时');
    if(coords.some(p=>!Array.isArray(p)||!finite(p[0])||!finite(p[1])||Math.abs(p[0])>180||Math.abs(p[1])>90))throw Error('路线坐标无效');
    let weights=(route.legs||[]).flatMap(l=>l.annotation?.duration || []);
    const annotated=weights.length===coords.length-1 && weights.every(x=>finite(x)&&x>=0) && weights.some(x=>x>0);
    if(!annotated)weights=coords.slice(1).map((p,i)=>distance(coords[i],p));
    const total=weights.reduce((a,b)=>a+b,0);
    if(!total)throw Error('路线长度无效');
    const cumulative=[0]; weights.forEach(w=>cumulative.push(cumulative.at(-1)+w*duration/total));
    const count=Math.min(Math.max(2,maximum),Math.max(2,Math.ceil(duration/1800)+1));
    const out=[]; let edge=1;
    for(let i=0;i<count;i++) {
      const elapsed=duration*i/(count-1);
      while(edge<coords.length-1 && cumulative[edge]<elapsed)edge++;
      const span=cumulative[edge]-cumulative[edge-1], ratio=span?Math.max(0,Math.min(1,(elapsed-cumulative[edge-1])/span)):0;
      const a=coords[edge-1],b=coords[edge];let dlon=b[0]-a[0];if(dlon>180)dlon-=360;if(dlon< -180)dlon+=360;
      const lon=((a[0]+dlon*ratio+540)%360)-180;
      out.push({point:i===0?coords[0]:i===count-1?coords.at(-1):[lon,a[1]+(b[1]-a[1])*ratio],elapsedSeconds:elapsed,etaMethod:annotated?'分段行程耗时':'按距离估算（非实时路况）'});
    }
    return out;
  }
  function windMs(value,unit) {
    if(!finite(value)||value<0)return null;
    if(unit==='m/s')return value;
    if(unit==='km/h'||unit==='kmh')return value/3.6;
    if(unit==='mph')return value*.44704;
    if(unit==='kn'||unit==='knots')return value*.514444;
    return null;
  }
  function weather(data,target,epoch) {
    const empty={available:false,complete:false,time:null,timezone:data?.timezone||'',code:null,temp:null,pop:null,mm:null,wind:null,gust:null,reason:'暂无可用天气数据'};
    const h=data?.hourly, times=h?.time;
    if(!Array.isArray(times)||!times.length||!finite(target))return empty;
    const stamps=times.map(t=>typeof t==='number'?t*1000:epoch(t,data));
    if(stamps.some((t,i)=>!finite(t)||(i&&t<=stamps[i-1])))return {...empty,reason:'预报时间存在缺失或歧义'};
    if(target<stamps[0]||target>stamps.at(-1))return {...empty,reason:'到达时间超出预报覆盖范围'};
    const i=stamps.findIndex(t=>t>=target);
    if(stamps[i]!==target && (i===0||stamps[i]-stamps[i-1]>HOUR+1000))return {...empty,reason:'到达时段预报缺失'};
    const val=k=>finite(h[k]?.[i])?h[k][i]:null;
    const pop=val('precipitation_probability'),mm=val('precipitation'),code=val('weather_code');
    const validCode=[0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99].includes(code)?code:null;
    const row={...empty,available:true,time:times[i],stamp:stamps[i],code:validCode,temp:val('temperature_2m'),pop:pop!==null&&pop>=0&&pop<=100?pop:null,mm:mm!==null&&mm>=0?mm:null,wind:windMs(val('wind_speed_10m'),data.hourly_units?.wind_speed_10m),gust:windMs(val('wind_gusts_10m'),data.hourly_units?.wind_gusts_10m)};
    row.complete=['code','temp','pop','mm','wind','gust'].every(k=>finite(row[k]));
    row.reason=row.complete?'模型参考，非道路安全保证':'部分指标缺失，无法完整判断风险';
    return row;
  }
  function color(row) {
    // Known danger still stands out even when another variable is missing.
    if((finite(row.code)&&row.code>=95)||(finite(row.mm)&&row.mm>=10)||(finite(row.gust)&&row.gust>=24.5))return '#ef4444';
    if(!row.complete)return '#94a3b8';
    if(row.code>=51||row.pop>=40||row.mm>0||row.wind>=10.8||row.gust>=17.2)return '#fbbf24';
    return '#4ade80';
  }
  function failure(stage,error={}) {
    let code=error.httpStatus===429?'RATE_LIMIT':Number.isInteger(error.httpStatus)&&error.httpStatus>=400?'HTTP_'+error.httpStatus:error.name==='AbortError'||error.name==='TimeoutError'?'TIMEOUT':'UNAVAILABLE';
    let hint='服务暂时不可用，请稍后重试；保留已填地点，无需重新输入。';
    if(stage==='起点搜索'||stage==='终点搜索')hint=error.userMessage||'地点搜索服务未返回有效结果；请稍后重试，或在地图上选择'+(stage==='起点搜索'?'起点':'终点')+'。';
    if(stage==='出发地时区查询')hint='无法确认出发地时区。可将出发时间留空按现在查询，或稍后重试。';
    if(stage==='道路规划'){
      if(error.roadCode==='NoRoute'){code='NO_ROUTE';hint='未找到连通的驾车路线。试试在车站入口附近的道路上选点。';}
      else if(error.roadCode==='NoSegment'){code='NO_SEGMENT';hint='起点或终点未匹配到可驾车道路，请在附近道路上重新选点。';}
      else if(code==='RATE_LIMIT')hint='道路服务请求过多，请稍后重试，无需修改站名。';
      else if(code==='TIMEOUT')hint='等待道路服务响应超时，请稍后重试，无需修改站名。';
      else hint='未取得有效的道路服务响应，请稍后重试，无需修改站名。';
    }
    return {code,hint};
  }
  root.RouteWeather={wallTime,timeLabel,departure,samples,weather,color,windMs,placeCandidates,choosePlace,geocode,failure};
})(typeof window!=='undefined'?window:globalThis);
