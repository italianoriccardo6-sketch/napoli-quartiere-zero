import './photoreal.css';
import {NAPOLI_QUARTIERI} from './napoli-sectors';
import {configuredPhotoKey,PHOTO_START,movePhotoCamera,photoCameraAt} from './photoreal-config';
import {createPhotorealCity} from './photoreal-city';
const get=<T extends HTMLElement>(id:string)=>document.getElementById(id) as T;
const open=get<HTMLButtonElement>('photo-open'),district=get<HTMLSelectElement>('photo-district'),go=get<HTMLButtonElement>('photo-go'),quality=get<HTMLSelectElement>('photo-quality'),status=get('photo-status'),host=get('photo-map');
const key=configuredPhotoKey(import.meta.env.VITE_GOOGLE_MAPS_API_KEY),geocodingEnabled=import.meta.env.VITE_GOOGLE_MAPS_GEOCODING_ENABLED==='true';
let city:Awaited<ReturnType<typeof createPhotorealCity>>|undefined;
for(const name of NAPOLI_QUARTIERI){const option=document.createElement('option');option.value=option.textContent=name;district.append(option);}
if(key){open.disabled=false;get('photo-setup-text').textContent='Servizio configurato. L’apertura utilizza Google Maps secondo il piano e le quote dell’account collegato.';}
else get('photo-setup-text').textContent='Il servizio fotografico non è ancora collegato. Sono disponibili costi e istruzioni; non sono state caricate immagini o attivati servizi a pagamento.';
open.onclick=async()=>{
  if(!key||city)return;
  open.disabled=true;status.textContent='Collegamento alla città fotografica…';
  try{
    city=await createPhotorealCity(host,{apiKey:key,geocodingEnabled,onStatus:message=>status.textContent=message});
    city.map.qualityMode=quality.value as 'FIDELITY'|'PERFORMANCE';
    get('photo-empty').hidden=true;get('photo-controls').hidden=false;open.hidden=true;get('photo-setup').hidden=true;
    district.disabled=!geocodingEnabled;
    status.textContent=geocodingEnabled?'Esplora con il mouse oppure scegli un quartiere.':'Esplora con mouse e tastiera. La ricerca dei quartieri non è attiva in questa configurazione.';
    host.focus();
  }catch{status.textContent='La città fotografica non si è collegata. Verifica configurazione e accesso al servizio.';open.disabled=false;}
};
district.onchange=()=>go.disabled=!city||!district.value||district.disabled;
go.onclick=async()=>{
  if(!city||!district.value)return;
  go.disabled=true;
  try{await city.goToDistrict(district.value);}catch(error){status.textContent=error instanceof Error?error.message:'Il quartiere non è disponibile.';}
  finally{go.disabled=false;}
};
quality.onchange=()=>{if(city)city.map.qualityMode=quality.value as 'FIDELITY'|'PERFORMANCE';};
get<HTMLButtonElement>('photo-home').onclick=()=>city?.setCamera(PHOTO_START,true);
const keys=new Set<string>(),owned=new Set(['KeyW','KeyA','KeyS','KeyD','KeyQ','KeyE','Equal','Minus','NumpadAdd','NumpadSubtract']);
addEventListener('keydown',event=>{
  const target=event.target as HTMLElement|null;
  if(!city||!owned.has(event.code)||event.ctrlKey||event.metaKey||event.altKey||target?.closest('button,input,select,textarea,[contenteditable]'))return;
  keys.add(event.code);event.preventDefault();event.stopPropagation();
},true);
addEventListener('keyup',event=>keys.delete(event.code),true);
addEventListener('blur',()=>keys.clear());document.addEventListener('visibilitychange',()=>{if(document.hidden)keys.clear();});
let previous=0,frame=0;
function update(time:number){
  const dt=previous?Math.min(.05,(time-previous)/1000):0;previous=time;
  if(city&&keys.size&&dt){
    try{
      const camera=city.getCamera(),f=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),r=Number(keys.has('KeyD'))-Number(keys.has('KeyA'));
      let next=movePhotoCamera(camera,f,r,dt*90);
      next=photoCameraAt(next.center,{...next,heading:next.heading+(Number(keys.has('KeyE'))-Number(keys.has('KeyQ')))*dt*50,range:Math.max(50,Math.min(10000,next.range*Math.exp((Number(keys.has('Minus')||keys.has('NumpadSubtract'))-Number(keys.has('Equal')||keys.has('NumpadAdd')))*dt)))});
      city.setCamera(next);
    }catch{keys.clear();status.textContent='Usa il mouse per riportare la visuale nell’area di Napoli.';}
  }
  frame=requestAnimationFrame(update);
}
frame=requestAnimationFrame(update);
let suspended=false;
addEventListener('pagehide',(event:PageTransitionEvent)=>{
  cancelAnimationFrame(frame);keys.clear();previous=0;suspended=true;
  // A cached document keeps its existing native map. Recreating it on Back would
  // discard state and could generate another billable map load.
  if(!event.persisted)city?.dispose();
});
addEventListener('pageshow',(event:PageTransitionEvent)=>{
  if(!event.persisted||!suspended)return;
  keys.clear();previous=0;suspended=false;frame=requestAnimationFrame(update);
});
