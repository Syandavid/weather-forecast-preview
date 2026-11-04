(function(root){
 'use strict';
 // At most two georeferenced images. Never replace a visible image's src.
 function create({map,makeLayer,active=()=>true,reduced=()=>false,onChange=()=>{},raf=requestAnimationFrame,caf=cancelAnimationFrame,later=setTimeout,cancel=clearTimeout}){
  let current=null,incoming=null,outgoing=null,frame=null,timeout=null,finish=null,sequence=0,failedKey=null;
  const remove=x=>{if(x)map.removeLayer(x.layer);};
  const notify=(failed=false)=>onChange({layer:current?.layer||null,meta:current?.meta||null,pending:!!incoming||!!outgoing,failed});
  function settle(){
   if(frame!==null)caf(frame);if(timeout!==null)cancel(timeout);if(finish!==null)cancel(finish);
   frame=timeout=finish=null;remove(incoming);remove(outgoing);incoming=outgoing=null;
   if(current){const el=current.layer.getElement();if(el)el.style.transition='none';current.layer.setOpacity(1);}
  }
  function clear(){++sequence;settle();remove(current);current=null;failedKey=null;notify();}
  function suspend(){++sequence;settle();notify();}
  function show(key,url,bounds,meta){
   if(!active())return;
   if(current?.key===key||incoming?.key===key||failedKey===key)return;
   ++sequence;settle();const own=sequence;
   const entry={key,meta,layer:makeLayer(url,bounds)};incoming=entry;failedKey=null;
   const valid=()=>own===sequence&&incoming===entry;
   const fail=()=>{if(!valid())return;settle();failedKey=key;notify(true);};
   entry.layer.once('error',fail);
   entry.layer.once('load',()=>{
    if(!valid())return;
    if(!active()){suspend();return;}
    if(timeout!==null)cancel(timeout);timeout=null;
    const old=current,el=entry.layer.getElement();
    if(el){Object.assign(el.dataset,meta);el.dataset.frameKey=key;el.classList.add('forecast-weather-frame');el.style.transition=old&&!reduced()?'opacity 220ms linear':'none';void el.offsetWidth;}
    current=entry;incoming=null;
    if(!old||reduced()){entry.layer.setOpacity(1);remove(old);notify();return;}
    outgoing=old;
    const oldEl=old.layer.getElement();if(oldEl)oldEl.style.transition='opacity 220ms linear';
    frame=raf(()=>{
     frame=null;if(own!==sequence)return;
     if(!active()){suspend();return;}
     entry.layer.setOpacity(1);old.layer.setOpacity(0);
     finish=later(()=>{finish=null;if(own!==sequence)return;remove(outgoing);outgoing=null;notify();},240);
    });
    notify();
   });
   timeout=later(fail,12000);
   entry.layer.addTo(map);notify();
  }
  return {show,clear,suspend};
 }
 root.ForecastTransition={create};
})(typeof window!=='undefined'?window:globalThis);
