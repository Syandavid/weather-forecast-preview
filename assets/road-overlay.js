(function(root) {
  'use strict';
  const kinds = {G:'national', S:'provincial', X:'county', Y:'town', C:'village'};
  const order = Object.values(kinds);
  // Administrative route class is NOT OSM highway/class (physical importance).
  // Require a CN route network or explicit CN country tag on that object.
  // References: Jiangmen road authority post_1887373; OSM Relation:route.
  function category(tags = {}) {
    const network = String(tags.network || '').trim().toUpperCase();
    const country = String(tags['addr:country'] || tags['ISO3166-1:alpha2'] || '').trim().toUpperCase();
    if (network && !/^CN(?::|$)/.test(network)) return null;
    if (country && country !== 'CN') return null;
    if (!/^CN(?::|$)/.test(network) && country !== 'CN') return null;
    const found = String(tags.ref || '').toUpperCase().split(/[;,；]/).map(ref => {
      const m = ref.trim().match(/^([GSXYC])\s*(\d{1,4})$/);
      if (!m || ('XYC'.includes(m[1]) && m[2].length !== 3)) return null;
      if (/^CN:(NATIONAL|EXPRESSWAY)$/.test(network) && m[1] !== 'G') return null;
      return kinds[m[1]];
    }).filter(Boolean);
    return order.find(kind => found.includes(kind)) || null;
  }
  function features(data) {
    if (!data || !Array.isArray(data.elements) || data.remark) throw Error('Incomplete road response');
    const memberships = new Map();
    for (const relation of data.elements) {
      if (relation.type !== 'relation' || relation.tags?.route !== 'road') continue;
      const kind = category(relation.tags);
      if (!kind) continue;
      for (const member of relation.members || []) {
        if (member.type !== 'way') continue;
        if (!memberships.has(member.ref)) memberships.set(member.ref, []);
        memberships.get(member.ref).push(kind);
      }
    }
    const result = [], seen = new Set();
    for (const way of data.elements) {
      if (way.type !== 'way' || !way.tags?.highway || seen.has(way.id)) continue;
      seen.add(way.id);
      const candidates = [category(way.tags), ...(memberships.get(way.id) || [])];
      const kind = order.find(k => candidates.includes(k));
      if (!kind || !Array.isArray(way.geometry) || way.geometry.length < 2) continue;
      // Reject a broken line rather than bridging missing vertices.
      if (way.geometry.some(p => !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || Math.abs(p.lat)>90 || Math.abs(p.lon)>180)) continue;
      result.push({type:'Feature', id:way.id, properties:{kind}, geometry:{type:'LineString', coordinates:way.geometry.map(p=>[p.lon,p.lat])}});
    }
    return {type:'FeatureCollection', features:result};
  }
  function query(bounds) {
    const [south,west,north,east] = bounds;
    if (!bounds.every(Number.isFinite) || south < -85 || north > 85 || west < -180 || east > 180 ||
        south >= north || west >= east || north-south > 2.2 || east-west > 3.2) return null;
    const box=bounds.map(n=>n.toFixed(5)).join(',');
    // Route members stay within the viewport; never download entire national routes.
    return '[out:json][timeout:10][maxsize:8388608];way[highway]('+box+')->.roads;'+
      'rel(bw.roads)[route=road][network~"^CN(:|$)"]->.routes;.routes out body;'+
      '(way.roads[ref];way(r.routes)('+box+'););out geom;';
  }
  root.RoadOverlay = {category, features, query};
})(typeof globalThis !== 'undefined' ? globalThis : window);
