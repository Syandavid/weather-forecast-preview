(function (root) {
  'use strict';
  // Common Chinese aliases supplement GeoNames' incomplete translated names.
  // They expand a query, never replace the provider's coordinates or other matches.
  const aliases = [
    ['伦敦|倫敦', 'London', 'GB'], ['纽约|紐約', 'New York', 'US'],
    ['东京|東京|东京都|東京都', 'Tokyo', 'JP'], ['巴黎', 'Paris', 'FR'],
    ['悉尼|雪梨', 'Sydney', 'AU'], ['墨尔本|墨爾本', 'Melbourne', 'AU'],
    ['奥克兰|奧克蘭', 'Auckland', 'NZ'], ['惠灵顿|惠靈頓', 'Wellington', 'NZ'],
    ['新加坡', 'Singapore', 'SG'], ['首尔|首爾|서울', 'Seoul', 'KR'],
    ['大阪', 'Osaka', 'JP'], ['京都', 'Kyoto', 'JP'],
    ['曼谷', 'Bangkok', 'TH'], ['吉隆坡', 'Kuala Lumpur', 'MY'],
    ['雅加达|雅加達', 'Jakarta', 'ID'], ['马尼拉|馬尼拉', 'Manila', 'PH'],
    ['迪拜|杜拜', 'Dubai', 'AE'], ['新德里', 'New Delhi', 'IN'],
    ['孟买|孟買', 'Mumbai', 'IN'], ['莫斯科', 'Moscow', 'RU'],
    ['柏林', 'Berlin', 'DE'], ['罗马|羅馬', 'Rome', 'IT'],
    ['马德里|馬德里', 'Madrid', 'ES'], ['阿姆斯特丹', 'Amsterdam', 'NL'],
    ['洛杉矶|洛杉磯', 'Los Angeles', 'US'], ['旧金山|舊金山', 'San Francisco', 'US'],
    ['华盛顿|華盛頓', 'Washington', 'US'], ['芝加哥', 'Chicago', 'US'],
    ['温哥华|溫哥華', 'Vancouver', 'CA'], ['多伦多|多倫多', 'Toronto', 'CA'],
    ['圣保罗|聖保羅', 'São Paulo', 'BR'], ['里约热内卢|里約熱內盧', 'Rio de Janeiro', 'BR'],
    ['布宜诺斯艾利斯|布宜諾斯艾利斯', 'Buenos Aires', 'AR'],
    ['开普敦|開普敦', 'Cape Town', 'ZA'], ['内罗毕|內羅畢', 'Nairobi', 'KE'],
    ['开罗|開羅', 'Cairo', 'EG']
  ];
  function normalize(value) { return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' '); }
  function coordinates(value) {
    const q = normalize(value);
    if (!/^[+\-\d.\s,，]+$/.test(q) || !/[,，]/.test(q)) return null;
    const parts = q.split(/[,，]/);
    const validNumber = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
    if (parts.length !== 2 || parts.some(p => !validNumber.test(p.trim()))) return {error:'请输入「纬度, 经度」，例如 35.6895, 139.6917'};
    const lat = Number(parts[0]), lon = Number(parts[1]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return {error:'纬度范围为 -90～90，经度范围为 -180～180；请检查顺序'};
    return {name:'坐标 ' + lat.toFixed(4) + ', ' + lon.toFixed(4), lat, lon, coordinate:true};
  }
  function plans(value) {
    const q = normalize(value);
    // Preserve ranking from the input language. Translated searches can rank a
    // small namesake above the intended city (e.g. York before New York).
    const languages = /^[\x00-\x7F]+$/.test(q) ? ['en','zh'] : ['zh','en'];
    const out = languages.map(language => ({q, language}));
    const [name, ...qualifier] = q.split(/[,，]/).map(s => s.trim());
    const alias = aliases.find(row => row[0].split('|').includes(name));
    if (alias) out.unshift({q:alias[1] + (qualifier.length ? ', ' + qualifier.join(', ') : ''), language:qualifier.length ? 'zh' : 'en', countryCode:qualifier.length ? '' : alias[2]});
    const native = /[\u3040-\u30ff]/.test(q) ? 'ja' : /[\uac00-\ud7af]/.test(q) ? 'ko' : /[\u0400-\u04ff]/.test(q) ? 'ru' : /[\u0600-\u06ff]/.test(q) ? 'ar' : null;
    if (native) out.push({q, language:native});
    return out.map(p => ({language:p.language, url:'https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({name:p.q, count:'20', format:'json', language:p.language, ...(p.countryCode ? {countryCode:p.countryCode} : {})})}));
  }
  function key(c) { return Number(c.lat).toFixed(4) + ',' + Number(c.lon).toFixed(4); }
  function location(c, trustedPresets = []) {
    // Map markers carry live weather too; persist only location metadata.
    const out = {};
    for (const field of ['name','lat','lon','admin','country','timezone','coordinate','englishName'])
      if (c[field] != null) out[field] = c[field];
    if (Number.isSafeInteger(c.geonameId) && c.geonameId > 0) out.geonameId = c.geonameId;
    if (Array.isArray(c.localNames)) out.localNames = c.localNames.filter(n => n && /^[a-z]{2,3}$/.test(n.language) && typeof n.name === 'string' && normalize(n.name)).slice(0, 3).map(n => ({language:n.language, name:normalize(n.name)}));
    const code = String(c.country_code || '').trim().toUpperCase();
    if (code) out.country_code = code;
    // A language preference is not a territorial assertion. Never infer a
    // country from admin suffixes (Japanese cities also contain 市).
    out.isChina = code ? code === 'CN' : ['中国','China'].includes(c.country) ? true : null;
    out.labelLanguage = code ? (['CN','HK','MO','TW'].includes(code) ? 'zh' : 'local')
      : c.labelLanguage === 'zh' || out.isChina === true ? 'zh' : 'local';
    // Old built-in selections predate language metadata. Repair the display
    // preference only, with an exact name/coordinate match; never infer a country.
    if (!code && !c.country && !c.coordinate && !c.geonameId &&
        Number.isFinite(c.lat) && Number.isFinite(c.lon) && trustedPresets.some(p =>
          p.labelLanguage === 'zh' && normalize(p.name) === normalize(c.name) &&
          Math.abs(p.lat-c.lat) < 0.000001 && Math.abs(p.lon-c.lon) < 0.000001))
      out.labelLanguage = 'zh';
    return out;
  }
  // Display-language defaults, not a claim that every resident/place in a
  // country uses one language. Multilingual regions without a safe default
  // retain the known primary name; a query language is not proof of locality.
  const nameLanguages = Object.create(null);
  for (const [language, countries] of Object.entries({
    en:'GB US AU NZ IE', ja:'JP', ko:'KR', th:'TH', vi:'VN', ru:'RU', uk:'UA',
    el:'GR', bg:'BG', tr:'TR', he:'IL', ar:'EG SA AE JO OM QA KW BH', fa:'IR',
    ne:'NP', bn:'BD', km:'KH', lo:'LA', my:'MM', mn:'MN', ka:'GE', hy:'AM',
    de:'DE AT LI', fr:'FR MC', it:'IT SM VA', es:'ES MX AR CL CO PE EC UY PY BO VE CR PA CU DO HN NI SV GT',
    pt:'PT BR', nl:'NL', da:'DK', sv:'SE', nb:'NO', fi:'FI', et:'EE', lv:'LV', lt:'LT',
    pl:'PL', cs:'CZ', sk:'SK', hu:'HU', ro:'RO', hr:'HR', sr:'RS', sl:'SI', sq:'AL', is:'IS', id:'ID', ms:'MY'
  })) countries.split(' ').forEach(code => { nameLanguages[code] = language; });
  function samePlace(c, r) {
    return !!r && !r.error && r.id === c.geonameId && r.country_code === c.country_code
      && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
      && Math.abs(r.latitude - c.lat) < 0.001 && Math.abs(r.longitude - c.lon) < 0.001
      && typeof r.name === 'string' && !!normalize(r.name);
  }
  function displayName(englishName, localNames) {
    const names = [englishName, ...(localNames || []).map(n => n.name)].filter(Boolean), seen = new Set();
    return names.filter(name => { const k=normalize(name).toLowerCase(); if(seen.has(k))return false;seen.add(k);return true; }).join(' · ');
  }
  function createNameResolver({getJson, onUpdate, now=Date.now}) {
    let generation=0, controller=null;
    const cache=new Map();
    function cancel() { generation++; if(controller)controller.abort();controller=null; }
    async function select(input) {
      cancel();
      const token=generation, c=location(input);
      if (!c.geonameId || c.coordinate || c.labelLanguage==='zh' || !/^[A-Z]{2}$/.test(c.country_code || '')) return;
      const language=nameLanguages[c.country_code], native=(c.localNames || []).filter(n=>n.language===language && !['en','zh'].includes(n.language));
      const languages=[...(!c.englishName ? ['en'] : []), ...(language && language!=='en' && !native.some(n=>n.language===language) ? [language] : [])];
      if (!languages.length) return;
      // Only selected locations are enriched: never fan out across all search rows.
      const id=c.geonameId+':'+c.country_code+':'+key(c)+':'+languages.join(','), cached=cache.get(id);
      if (cached && now()-cached.at<86400000) { onUpdate({...c,...cached.names});return; }
      const requestController=new AbortController();controller=requestController;
      const replies=await Promise.all(languages.map(async language=>{
        try {
          const r=await getJson('https://geocoding-api.open-meteo.com/v1/get?'+new URLSearchParams({id:String(c.geonameId),language}),{signal:requestController.signal,timeoutMs:8000});
          return samePlace(c,r) ? {language,name:normalize(r.name)} : null;
        } catch(e) { return null; }
      }));
      if (token!==generation) return;
      controller=null;
      const englishName=c.englishName || replies.find(r=>r && r.language==='en')?.name;
      if (!englishName) return; // Never relabel a translated search result as English.
      const localNames=[...native,...replies.filter(r=>r && r.language!=='en')]
        .filter(n=>normalize(n.name).toLowerCase()!==normalize(englishName).toLowerCase());
      const names={englishName,localNames,name:displayName(englishName,localNames)};
      // Do not cache failures: a later selection may retry a missing translation.
      if (replies.every(Boolean)) {
        cache.delete(id);cache.set(id,{names,at:now()});
        if(cache.size>64)cache.delete(cache.keys().next().value);
      }
      onUpdate({...c,...names});
    }
    return {select,cancel};
  }
  function createRenderer({host,onSelect,document=host.ownerDocument}) {
    const entries=new Map();
    return function render(rows) {
      if (!rows.length) { host.replaceChildren();entries.clear();return; }
      const wanted=new Set(rows.map(key));
      for(const [id,entry] of entries)if(!wanted.has(id)){entry.button.remove();entries.delete(id);}
      rows.forEach(c=>{
        const id=key(c);let entry=entries.get(id);
        if(!entry){
          const button=document.createElement('button'),name=document.createElement('span'),detail=document.createElement('small');
          button.className='city-row';button.type='button';button.dataset.cityKey=id;button.appendChild(name);button.appendChild(detail);
          entry={button,name,detail,city:c};entries.set(id,entry);
          button.addEventListener('click',()=>onSelect(entry.city));host.appendChild(button);
        }
        entry.city=c;entry.name.textContent=c.name;
        entry.detail.textContent=[c.admin,c.country].filter(Boolean).join(' · ')||c.lat.toFixed(4)+', '+c.lon.toFixed(4);
        entry.button.title=[c.name,c.admin,c.country,c.timezone,c.lat.toFixed(4)+', '+c.lon.toFixed(4)].filter(Boolean).join(' · ');
      });
    };
  }
  function merge(batches) {
    const groups = new Map();
    batches.forEach(batch => (batch.results || []).forEach(r => {
      if (!Number.isFinite(r.latitude) || !Number.isFinite(r.longitude) || Math.abs(r.latitude) > 90 || Math.abs(r.longitude) > 180) return;
      const id = r.id != null ? String(r.id) : key({lat:r.latitude, lon:r.longitude});
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push({r, language:batch.language});
    }));
    return Array.from(groups.values()).map(variants => {
      const first = variants[0].r, chineseLabels = ['CN','HK','MO','TW'].includes(String(first.country_code || '').toUpperCase());
      const en = variants.find(v => v.language === 'en'), zh = variants.find(v => v.language === 'zh');
      const preferred = (chineseLabels ? zh : en) || variants[0], r = preferred.r;
      const nativeLanguage = nameLanguages[String(r.country_code || '').toUpperCase()];
      const native = variants.find(v => v.language === nativeLanguage && !['zh','en'].includes(v.language));
      const name = String(r.name || '未命名地点');
      const local = !chineseLabels && native && native.r.name !== name ? native.r.name : '';
      const detail = (zh || preferred).r;
      return location({name:name + (local ? ' · ' + local : ''), geonameId:r.id,
        englishName:en ? String(en.r.name || '') : undefined,
        localNames:local ? [{language:native.language,name:local}] : [], lat:r.latitude, lon:r.longitude,
        admin:[detail.admin1, detail.admin2].filter((x,i,a) => x && a.indexOf(x) === i).join(' · '),
        country:detail.country || r.country_code || '', country_code:r.country_code || '',
        timezone:r.timezone || ''});
    }).slice(0, 40);
  }
  function create({getJson, onUpdate, now = Date.now}) {
    let generation = 0;
    const cache = new Map();
    function cancel() { generation++; }
    async function search(value) {
      const token = ++generation, q = normalize(value), coord = coordinates(q);
      const emit = state => { if (token === generation) onUpdate(state); };
      if (!q) { emit({rows:[], message:'', loading:false}); return; }
      if (coord) { emit({rows:coord.error ? [] : [coord], message:coord.error || '按此坐标查询天气（不依赖地名收录）', loading:false}); return; }
      if (Array.from(q.split(/[,，]/)[0].trim()).length < 2) { emit({rows:[], message:'城市名至少输入 2 个字符；也可以输入纬度、经度', loading:false}); return; }
      const cached = cache.get(q.toLowerCase());
      if (cached && now() - cached.at < 600000) { emit({rows:cached.rows, message:'请选择城市，注意国家和地区', loading:false}); return; }
      const requests = plans(q), batches = Array(requests.length), settled = Array(requests.length).fill(false), errors = [];
      let pending = requests.length;
      emit({rows:[], message:'正在搜索全球地名…', loading:true});
      await Promise.all(requests.map(async (p, i) => {
        try {
          const result = await getJson(p.url);
          if (!result || result.error || (result.results != null && !Array.isArray(result.results))) throw new Error('Invalid geocoding response');
          batches[i] = {language:p.language, results:result.results || []};
        } catch (e) { errors.push(i); }
        pending--;
        settled[i]=true;
        if (token !== generation) return;
        // Wait for the primary language (success or failure) before showing choices.
        // Otherwise a translated namesake can occupy the main city's row mid-tap.
        if (!settled[0]) return;
        const rows = merge(batches.filter(Boolean));
        const message = pending ? (rows.length ? '可先选择城市，正在补充其他匹配…' : '正在搜索全球地名…')
          : errors.length === requests.length ? '地名服务暂时无法连接，请重试；也可输入坐标查询天气'
          : rows.length ? (errors.length ? '部分语言查询失败，以下结果仍可选择；可重试补全' : '请选择城市，注意国家和地区')
          : '未找到匹配。请尝试英文名、完整地名（如 Tokyo），或输入纬度, 经度';
        emit({rows, message, loading:!!pending, retry:!pending && !!errors.length});
        if (!pending && !errors.length && rows.length) {
          cache.delete(q.toLowerCase()); cache.set(q.toLowerCase(), {rows, at:now()});
          if (cache.size > 30) cache.delete(cache.keys().next().value);
        }
      }));
    }
    return {cancel, search};
  }
  root.CitySearch = {normalize, coordinates, plans, merge, key, location, create, createRenderer, createNameResolver, displayName};
})(typeof globalThis !== 'undefined' ? globalThis : window);
