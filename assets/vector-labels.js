(function(root) {
  'use strict';
  function text() {
    const local=['coalesce',['get','name:nonlatin'],['get','name'],''];
    const english=['coalesce',['get','name:en'],['get','name_en'],local];
    const bilingual=['case',['all',['!=',local,english],['!=',local,'']],['concat',english,' · ',local],english];
    const zh=['coalesce',['get','name:zh-Hans'],['get','name:zh'],['get','name_zh'],local];
    // Only infer a language when explicit locale metadata is missing.
    // A selected weather city is not evidence about a distant feature.
    const locale=root.WeatherLabelLocale;
    // Some city anchors lie in estuaries outside generalized land polygons.
    // Verified OpenMapTiles place id at 120.205536,30.248391 (Hangzhou).
    // Match the local anchor and class/name, not renderer-dependent feature IDs.
    const estuaryCity=['all',['==',['get','class'],'city'],['==',['get','name'],'杭州市'],['within',{type:'Polygon',coordinates:[[[120.18,30.22],[120.23,30.22],[120.23,30.28],[120.18,30.28],[120.18,30.22]]]}]];
    const inferred=['any',estuaryCity,locale?['within',locale]:false];
    return ['case',['match',['coalesce',['get','iso_a2'],['get','country_code'],''],['CN','HK','MO','TW'],true,'',inferred,false],zh,bilingual];
  }
  function style({chinese=false,focus=null,density='simple'}={}) {
    const detailed=density==='detail', layers=[];
    // MapLibre zoom is Leaflet zoom - 1 in the official bridge.
    // Neutral road geometry is context, not administrative classification.
    for(const [id,classes,minzoom,width] of [
      ['main',['motorway','trunk','primary','secondary','tertiary'],5,1.2],
      ['local',['minor','street','street_limited','unclassified','residential','living_street'],12,0.7],
      ['small',['service','track','path','cycleway','footway','bridleway'],14,0.5]
    ])layers.push({id:'context-road-'+id,type:'line',source:'openmaptiles','source-layer':'transportation',minzoom,
      filter:['match',['get','class'],classes,true,false],paint:{'line-color':'#e3dbbc','line-opacity':.55,'line-width':['interpolate',['linear'],['zoom'],minzoom,width,18,width*2]}});
    const label=(id,sourceLayer,classes,minzoom,size)=>({id,type:'symbol',source:'openmaptiles','source-layer':sourceLayer,minzoom,
      ...(classes?{filter:['match',['get','class'],classes,true,false]}:{}),
      layout:{'text-field':text(chinese,focus),'text-font':['Noto Sans Regular'],'text-size':size,'text-max-width':10,
        'text-padding':detailed?3:12,'text-allow-overlap':false,'text-ignore-placement':false,'symbol-sort-key':['coalesce',['get','rank'],100]},
      paint:{'text-color':'#ffffff','text-halo-color':'#17242c','text-halo-width':1.6,'text-halo-blur':.4}});
    const country=label('label-country','place',['country'],1,13);country.maxzoom=6;layers.push(country);
    layers.push(label('label-city','place',['city'],3,16));
    layers.push(label('label-town','place',['town'],7,14));
    layers.push(label('label-village','place',['village'],detailed?9:11,13));
    layers.push(label('label-small','place',['hamlet','suburb','quarter','neighbourhood','isolated_dwelling'],detailed?11:13,12));
    const street=label('label-street','transportation_name',null,detailed?12:14,12);
    street.layout['symbol-placement']='line';street.layout['symbol-spacing']=detailed?350:650;
    street.layout['text-max-angle']=30;layers.push(street);
    return {version:8,name:'Weather context labels',glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
      sources:{openmaptiles:{type:'vector',url:'https://tiles.openfreemap.org/planet'}},layers};
  }
  function apply(map, options) {
    if (!map?.getLayer) return;
    for (const layer of style(options).layers) {
      if (!map.getLayer(layer.id) || layer.type!=='symbol') continue;
      map.setLayerZoomRange(layer.id,layer.minzoom,layer.maxzoom ?? 24);
      for(const key of ['text-field','text-padding','symbol-spacing'])if(layer.layout[key]!=null)map.setLayoutProperty(layer.id,key,layer.layout[key]);
    }
  }
  root.VectorLabels={text,style,apply};
})(typeof globalThis !== 'undefined' ? globalThis : window);
