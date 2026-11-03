(function (root) {
  'use strict';
  const HOUR = 3600000;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const timeCache = new Map();
  const formatters = new Map();
  // Open-Meteo ISO values are city-local wall times, not browser-local times.
  function epoch(iso, w) {
    if (!iso) return NaN;
    if (/Z$|[+-]\d\d:\d\d$/.test(iso)) return Date.parse(iso);
    const key = [iso, w && w.timezone, w && w.utc_offset_seconds].join('|');
    if (timeCache.has(key)) return timeCache.get(key);
    const wall = Date.parse(iso + 'Z');
    let result = wall - ((w && w.utc_offset_seconds) || 0) * 1000;
    try {
      if (w && w.timezone) {
        let fmt = formatters.get(w.timezone);
        if (!fmt) {
          fmt = new Intl.DateTimeFormat('en-CA', {timeZone:w.timezone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
          if(formatters.size>=32)formatters.delete(formatters.keys().next().value);
          formatters.set(w.timezone,fmt);
        }
        for (let i=0;i<3;i++) {
          const p = {};
          fmt.formatToParts(new Date(result)).forEach(x => {p[x.type]=x.value;});
          const actualWall = Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
          const delta = wall-actualWall;
          result += delta;
          if (!delta) break;
        }
      }
    } catch (_) {}
    if (timeCache.size > 12000) timeCache.clear();
    timeCache.set(key,result);
    return result;
  }
  function freshness(w, now=Date.now()) {
    const stamp = epoch(w && w.current && w.current.time,w);
    const age = (now-stamp)/HOUR;
    return {age, stale:!Number.isFinite(age) || age>3 || age< -1};
  }
  function covers(obj,w,start,end) {
    const t=obj && obj.time || [];
    return t.length>1 && epoch(t[0],w)<=start && epoch(t[t.length-1],w)>=end;
  }
  function sample(obj,w,field,target,minutes=60) {
    const t=obj.time || [], v=obj[field] || [];
    if (!covers(obj,w,target,target)) return null;
    let r=t.findIndex(x => epoch(x,w)>=target);
    const l=Math.max(0,r-1);
    if (r<0 || !finite(v[r])) return null;
    const at=epoch(t[r],w),before=epoch(t[l],w);
    if (at!==target && (at-before<=0 || at-before>minutes*60000)) return null;
    if ((field==='precipitation'||field==='wind_gusts_10m')&&v[r]<0) return null;
    if (field==='precipitation_probability'&&(v[r]<0||v[r]>100)) return null;
    // Precipitation is an interval total; categorical weather codes must not
    // be numerically interpolated. Nulls must never become clear weather.
    if (['precipitation','weather_code','wind_gusts_10m','precipitation_probability'].includes(field)) return v[r];
    if (epoch(t[r],w)===target) return v[r];
    if (!finite(v[l])) return null;
    const span=epoch(t[r],w)-epoch(t[l],w);
    return span ? v[l]+(v[r]-v[l])*(target-epoch(t[l],w))/span : v[r];
  }
  function rainTotal(obj,w,start,end,minutes) {
    const times=obj.time || [], values=obj.precipitation || [];
    let total=0, covered=0, lastEnd=start;
    for (let i=0;i<times.length;i++) {
      const stop=epoch(times[i],w), begin=stop-minutes*60000;
      if(!finite(stop) || (i && stop<=epoch(times[i-1],w)))return null;
      const overlap=Math.max(0,Math.min(stop,end)-Math.max(begin,start));
      if (!overlap) continue;
      // Overlapping intervals must not fill a separate missing interval by
      // double-counting duration. Require contiguous, non-overlapping coverage.
      if (Math.abs(Math.max(begin,start)-lastEnd)>1) return null;
      if (!finite(values[i]) || values[i]<0) return null;
      total+=values[i]*overlap/(minutes*60000); covered+=overlap;
      lastEnd=Math.min(stop,end);
    }
    return covered>=end-start-1 ? total : null;
  }
  function nextTwo(w,now=Date.now()) {
    if (!w || freshness(w,now).stale) return {available:false,reason:'天气数据已过期，更新后再查看短临风险'};
    const end=now+2*HOUR, hourly=w.hourly||{};
    const minute=w.minutely_15||{};
    const minutes=covers(minute,w,now,end) && rainTotal(minute,w,now,end,15)!==null ? 15 : 60;
    const source=minutes===15 ? minute : hourly;
    const fullWindow=covers(source,w,now,end);
    let clock,slotZone=w.timezone||'UTC';
    try{clock=new Intl.DateTimeFormat('en-GB',{timeZone:slotZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}
    catch(_){slotZone='UTC';clock=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});}
    const stops=(source.time||[]).map(t=>epoch(t,w));
    const rows=[10,15,30,60,90,120].map(offset => {
      const target=now+offset*60000;
      const stop=stops.find(t=>t>=target),mm=sample(source,w,'precipitation',target,minutes);
      return {offset,clock:clock.format(target),rainPeriod:finite(mm)&&finite(stop)?clock.format(stop-minutes*60000)+'–'+clock.format(stop):null,temp:sample(source,w,'temperature_2m',target,minutes),pop:sample(hourly,w,'precipitation_probability',target),mm,code:sample(source,w,'weather_code',target,minutes),gust:sample(source,w,'wind_gusts_10m',target,minutes)};
    });
    const total=fullWindow?rainTotal(source,w,now,end,minutes):null;
    const values=(field)=>rows.map(r=>r[field]).filter(finite);
    const peak=field=>values(field).length ? Math.max(...values(field)) : null;
    // Include every source interval, so a brief storm between display slots
    // cannot disappear just because the six cards did not sample it.
    const intervalRows=(source.time||[]).map((t,i)=>({time:epoch(t,w),code:(source.weather_code||[])[i],gust:(source.wind_gusts_10m||[])[i]})).filter(r=>r.time>now && r.time-minutes*60000<end);
    // A missing rain amount invalidates a rain sum, not an independent hazard signal.
    const extraHazards=[];
    const alternate=minutes===60?minute:hourly,altMinutes=minutes===60?15:60;
    for(let i=1;i<(alternate.time||[]).length;i++){
      const stop=epoch(alternate.time[i],w),begin=epoch(alternate.time[i-1],w);
      if(stop-begin!==altMinutes*60000||stop<=now||begin>=end)continue;
      const code=alternate.weather_code?.[i],gust=alternate.wind_gusts_10m?.[i],amount=alternate.precipitation?.[i];
      const rate=finite(amount)&&amount>=0?amount*60/altMinutes:null;
      if([95,96,99,82,65].includes(code)||(finite(gust)&&gust>=17.2)||rate>=10)
        extraHazards.push({start:Math.max(0,(begin-now)/60000),end:Math.min(120,(stop-now)/60000),code,gust,rate,minutes:altMinutes});
    }
    const storm=intervalRows.concat(extraHazards).some(r=>[95,96,99].includes(r.code));
    const gusts=intervalRows.map(r=>r.gust).filter(v=>finite(v)&&v>=0);
    for(const r of extraHazards)if(finite(r.gust)&&r.gust>=0)gusts.push(r.gust);
    const maxGust=gusts.length ? Math.max(...gusts) : peak('gust');
    const complete=total!==null && rows.every(r=>finite(r.code)&&finite(r.gust)&&finite(r.mm)) && intervalRows.every(r=>finite(r.code)&&finite(r.gust)&&r.gust>=0);
    const probabilities=(hourly.time||[]).map((t,i)=>({time:epoch(t,w),value:hourly.precipitation_probability?.[i]})).filter(r=>r.time>now&&r.time-HOUR<end);
    const popComplete=rainTotal({time:hourly.time,precipitation:(hourly.precipitation_probability||[]).map(v=>finite(v)&&v>=0&&v<=100?0:null)},w,now,end,60)!==null;
    const pops=probabilities.map(r=>r.value).filter(v=>finite(v)&&v>=0&&v<=100);
    const intervals=(source.time||[]).map((t,i)=>{
      const stop=epoch(t,w),start=stop-minutes*60000,mm=source.precipitation?.[i];
      return {start:Math.max(0,(start-now)/60000),end:Math.min(120,(stop-now)/60000),rate:finite(mm)&&mm>=0?mm*60/minutes:null,iso:t,code:source.weather_code?.[i],gust:source.wind_gusts_10m?.[i]};
    }).filter(r=>r.end>r.start&&r.end>0&&r.start<120);
    const heavy=intervals.concat(extraHazards).some(r=>r.rate>=10||[65,82].includes(r.code));
    const signals=intervals.concat(extraHazards).map(r=>{
      const kind=[95,96,99].includes(r.code)?'雷暴':r.gust>=17.2?'强阵风':r.rate>=10||[65,82].includes(r.code)?'较强降水':'';
      return {...r,kind,step:r.minutes||minutes};
    }).filter(r=>r.kind).sort((a,b)=>a.start-b.start||Number(b.kind==='雷暴')-Number(a.kind==='雷暴')||a.step-b.step);
    const first=signals[0];
    if(!fullWindow&&!first)return {available:false,reason:'预报未覆盖未来两小时，暂无法判断风险'};
    const firstEvent=first?{kind:first.kind,step:first.step,windowLabel:first.start<1?'未来'+Math.ceil(first.end)+'分钟内':'约'+Math.floor(first.start)+'–'+Math.ceil(first.end)+'分钟后'}:null;
    return {available:true,rows,slotZone,intervals,extraHazards,firstEvent,minutes,total,complete,storm,heavy,maxGust,popComplete,maxPop:pops.length?Math.max(...pops):null,maxMm:peak('mm')};
  }
  const activities={walk:{name:'散步',min:5,max:32,gust:12,uv:8},run:{name:'跑步',min:5,max:28,gust:10,uv:6},cycle:{name:'骑行',min:5,max:30,gust:8,uv:7}};
  function outdoor(w,activity='walk',now=Date.now()) {
    if (!w || freshness(w,now).stale) return {available:false,reason:'等待新鲜天气数据后推荐出行时段'};
    const cfg=activities[activity]||activities.walk, h=w.hourly||{}, times=h.time||[], reasons=new Map(), candidates=[];
    const issue=i=>{
      const get=k=>(h[k]||[])[i];
      if (!['temperature_2m','apparent_temperature','precipitation','precipitation_probability','wind_gusts_10m','weather_code','uv_index'].every(k=>finite(get(k)))) return '数据不完整';
      if (get('weather_code')>=95) return '雷暴风险';
      if ([66,67,71,73,75,77,85,86].includes(get('weather_code'))) return '雨雪或结冰风险';
      if (get('precipitation')>=0.2 || get('precipitation_probability')>=40) return '降水风险';
      if (get('wind_gusts_10m')>=cfg.gust) return '阵风偏强';
      if (get('apparent_temperature')<cfg.min || get('apparent_temperature')>cfg.max) return '体感不舒适';
      if (get('uv_index')>=cfg.uv) return '紫外线偏强';
      const day=times[i].slice(0,10), di=(w.daily && w.daily.time||[]).indexOf(day);
      const rise=epoch((w.daily && w.daily.sunrise||[])[di],w), set=epoch((w.daily && w.daily.sunset||[])[di],w);
      if (!Number.isFinite(rise)||!Number.isFinite(set)) return '日照数据不足';
      const time=epoch(times[i],w);
      if (time<rise||time>set) return '非白天时段';
      return '';
    };
    // Evaluate the full two-hour window, including rain accumulated at its end.
    for(let i=0;i<times.length-2;i++) {
      const start=epoch(times[i],w),end=epoch(times[i+2],w);
      if (start<now || end>now+24*HOUR || end-start!==2*HOUR) continue;
      const issues=[issue(i),issue(i+1),issue(i+2)].filter(Boolean);
      if(issues.length) {issues.forEach(x=>reasons.set(x,(reasons.get(x)||0)+1));continue;}
      const ts=[i,i+1,i+2].map(j=>h.temperature_2m[j]);
      candidates.push({start,end,label:times[i].slice(5,16).replace('T',' ')+'–'+times[i+2].slice(11,16),min:Math.min(...ts),max:Math.max(...ts),pop:Math.max(...[i,i+1,i+2].map(j=>h.precipitation_probability[j]))});
    }
    const windows=[];
    for(const c of candidates) {if(!windows.length||c.start>=windows[windows.length-1].end) windows.push(c);if(windows.length===3)break;}
    return {available:true,windows,cfg,reason:[...reasons].sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>x[0]).join('、')||'预报覆盖不足'};
  }
  function risk(w, now=Date.now()) {
    if(!w || freshness(w,now).stale)return {status:'stale',complete:false,event:null};
    const h=w.hourly||{},fields=['temperature_2m','weather_code','precipitation','wind_speed_10m','wind_gusts_10m'];
    const rows=(h.time||[]).map((iso,i)=>({iso,time:epoch(iso,w),i})).filter(r=>finite(r.time)&&r.time>=now-30*60000&&r.time<=now+16*24*HOUR);
    const near=rows.filter(r=>r.time<=now+49*HOUR);
    const complete=near.length>=48 && near[0].time<=now+HOUR && near.at(-1).time>=now+48*HOUR && near.every((r,i)=>fields.every(k=>finite(h[k]?.[r.i]))&&(!i||r.time<=near[i-1].time+HOUR+1000&&r.time>near[i-1].time));
    const hits=[];
    for(const r of rows) {
      const value=k=>finite(h[k]?.[r.i])?h[k][r.i]:NaN;
      const code=value('weather_code'),rain=value('precipitation'),wind=value('wind_speed_10m'),gust=value('wind_gusts_10m'),temp=value('temperature_2m');
      let title='',detail='',level='warn';
      if(code>=95){title=code>=96?'雷暴伴冰雹':'雷暴';detail='可能出现雷电活动';level='danger';}
      else if(code===82||rain>=10){title='强降雨';detail='留意短时积水';level='danger';}
      else if(code===75||code===86){title='强降雪';detail='留意道路积雪';level='danger';}
      else if(code===66||code===67){title='冻雨';detail='留意道路结冰';level='danger';}
      else if(gust>=24.5||wind>=20.8){title='强风';detail='留意高空坠物';level='danger';}
      else if(gust>=17.2||wind>=17.2){title='大风';detail='减少高处和沿海活动';}
      else if(temp>=37){title='高温';detail='减少正午户外停留';}
      else if(temp<=-10){title='低温';detail='注意防寒防冻';}
      if(title)hits.push({...r,title,detail,level,tier:r.time<=now+48*HOUR?'near':r.time<=now+7*24*HOUR?'trend':'outlook'});
    }
    // The overview must not issue an all-clear when a valid sub-hourly
    // thunderstorm or gust falls between two unremarkable hourly records.
    const m=w.minutely_15||{};
    for(let i=1;i<(m.time||[]).length;i++){
      const begin=epoch(m.time[i-1],w),stop=epoch(m.time[i],w);
      if(stop-begin!==900000||stop<=now||begin>=now+2*HOUR)continue;
      const code=m.weather_code?.[i],gust=m.wind_gusts_10m?.[i],thunder=[95,96,99].includes(code);
      const amount=m.precipitation?.[i],heavy=[65,82].includes(code)||(finite(amount)&&amount>=2.5);
      if(!thunder&&!heavy&&!(finite(gust)&&gust>=17.2))continue;
      const startMin=Math.max(0,Math.floor((begin-now)/60000)),endMin=Math.min(120,Math.ceil((stop-now)/60000));
      hits.push({time:Math.max(begin,now),iso:m.time[i-1],windowLabel:startMin?'约'+startMin+'–'+endMin+'分钟后':'未来'+endMin+'分钟内',
        title:thunder?(code===95?'雷暴':'雷暴伴冰雹'):heavy?'较强降水':(gust>=24.5?'强风':'大风'),detail:thunder?'可能出现雷电活动':heavy?'留意短时降水对出行的影响':'留意高空坠物',
        level:thunder||heavy||gust>=24.5?'danger':'warn',tier:'near'});
    }
    hits.sort((a,b)=>a.time-b.time||Number(b.level==='danger')-Number(a.level==='danger'));
    return {status:complete?'available':'partial',complete,event:hits[0]||null,horizon:near.at(-1)?.iso||null};
  }
  function daylight(w, now=Date.now()) {
    w=w||{};
    let today='',format;
    const local=ms=>{const p={};format.formatToParts(new Date(ms)).forEach(x=>p[x.type]=x.value);return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute;};
    try {
      if(typeof w.timezone!=='string'||!w.timezone)throw Error('City timezone missing');
      format=new Intl.DateTimeFormat('en-CA',{timeZone:w.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
      today=local(now).slice(0,10);
    } catch (_) {}
    const d=w.daily||{},i=(d.time||[]).indexOf(today),value=k=>i>=0?d[k]?.[i]:null;
    const event=k=>{const raw=value(k),ms=typeof raw==='string'?epoch(raw,w):NaN;if(!today||!finite(ms))return null;const iso=local(ms);return iso.slice(0,10)===today?{iso,ms}:null;};
    let rise=event('sunrise'),set=event('sunset');
    const length=value('daylight_duration'),shine=value('sunshine_duration');
    const supplied=finite(length)&&length>=0&&length<=86400;
    const polar=supplied&&length===0?'极夜':supplied&&length===86400?'极昼':'';
    // Identical placeholders are not evidence of polar night. Only an explicit
    // valid duration can classify polar conditions; malformed events stay unknown.
    if(polar||(rise&&set&&set.ms<=rise.ms)){rise=null;set=null;}
    const seconds=supplied?length:rise&&set?(set.ms-rise.ms)/1000:null;
    return {date:today,rise:rise?.iso||null,set:set?.iso||null,seconds,shine:finite(shine)&&shine>=0&&shine<=86400?shine:null,polar};
  }
  const api={epoch,freshness,covers,sample,rainTotal,nextTwo,outdoor,activities,risk,daylight};
  if(typeof module!=='undefined' && module.exports) module.exports=api;
  else root.WeatherInsights=api;
})(typeof window!=='undefined'?window:globalThis);
