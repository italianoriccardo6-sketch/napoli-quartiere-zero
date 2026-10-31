import type {MapData} from './geo';
import type {CityMapData} from './city-data';
import {segmentDistance} from './geo';
import {target} from './mission';
import {storyDestination,storyObjective,type StoryState} from './story';
import type {Save} from './save';
export const GAME_UI_IDS=[
  'game','loading','error','error-text','start','play','hud','pause-button','credits-button',
  'mission-phase','objective','distance','direction','coins','speed','mode-info','hint','toast','minimap','world-note',
  'pause','resume','volume','quality','reset','credits','close-credits','dialogue','dialogue-speaker','dialogue-text',
  'dialogue-choices','choose-protect','choose-negotiate','dialogue-next',
] as const;
export function validateGameUI(root:Pick<Document,'getElementById'>=document){
  const missing=GAME_UI_IDS.filter(id=>!root.getElementById(id));
  if(missing.length)throw new Error('L’interfaccia di gioco non si è caricata correttamente. Ricarica la pagina.',{cause:{missingElements:missing}});
}
export function el<T extends HTMLElement=HTMLElement>(id:string):T {
  const element=document.getElementById(id);
  if(!element)throw new Error('L’interfaccia di gioco non è pronta. Ricarica la pagina.',{cause:{missingElement:id}});
  return element as T;
}
export function show(id:string,value:boolean){el(id).classList.toggle('hidden',!value);}
let toastTimer:ReturnType<typeof setTimeout>;
export function toast(message:string){el('toast').textContent=message;show('toast',true);clearTimeout(toastTimer);toastTimer=setTimeout(()=>show('toast',false),4500);}
export function updateHUD(save:Save,x:number,z:number,heading:number,riding:boolean,speed:number,hint:string,data:MapData,story?:StoryState){
  const t=story?(storyDestination(story)??[27,59]):target(save),dist=Math.hypot(t[0]-x,t[1]-z);
  el('coins').textContent=String(save.coins+(story?.coins??0));
  const completed=story?story.phase==='completed':save.mission==='completed';
  el('mission-phase').textContent=completed?'PROLOGO COMPLETATO':story?.phase==='return'?'LA TUA DECISIONE':'PROLOGO 01';
  el('objective').textContent=story?storyObjective(story):'Raggiungi Teresa al bar.';
  el('distance').textContent=completed?`+${story?.coins??25} ✧`:`${Math.round(dist)} m`;
  const angle=Math.atan2(t[0]-x,t[1]-z)-heading;const arrow=Math.abs(Math.sin(angle))<.3?(Math.cos(angle)>0?'↑':'↓'):Math.sin(angle)>0?'→':'←';
  el('direction').textContent=completed?(story?.choice==='negotiate'?'TRATTATIVA APERTA':'PROVA AL SICURO'):`${story?.phase==='carrying'?'BANCHINA':'TERESA'} ${arrow}`;
  el('speed').textContent=riding?`${Math.round(Math.abs(speed)*3.6)} km/h`:'A PIEDI';
  el('mode-info').textContent=riding?'E SCENDI · S FRENA / RETROMARCIA':'SHIFT PER CORRERE';
  show('hint',!!hint);el('hint').innerHTML=hint?`<kbd>E</kbd> ${hint}`:'';
  const c=el<HTMLCanvasElement>('minimap').getContext('2d')!;c.clearRect(0,0,210,210);c.save();c.translate(105,105);
  const city=(data as CityMapData).city;
  if(city){
    c.scale(.38,-.38);c.translate(-x,-z);
    c.fillStyle='#8d998b';for(const ring of data.land){c.beginPath();ring.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill();}
    c.fillStyle='#455c55';for(const b of data.buildings){if(!b.rings[0].some(p=>Math.abs(p[0]-x)<330&&Math.abs(p[1]-z)<330))continue;c.beginPath();for(const ring of b.rings){ring.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();}c.fill('evenodd');}
    c.strokeStyle='#c5c5ac';c.lineWidth=3;for(const road of city.roads){if(!road.points.some(p=>Math.abs(p[0]-x)<330&&Math.abs(p[1]-z)<330))continue;c.beginPath();road.points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke();}
    c.strokeStyle='#e7b774';c.lineWidth=5;c.setLineDash([7,7]);c.beginPath();city.route.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.stroke();c.setLineDash([]);
    let street:string|undefined,closest=90;for(const road of city.roads){if(!road.name)continue;for(let i=1;i<road.points.length;i++){const d=segmentDistance([x,z],road.points[i-1],road.points[i]);if(d<closest){closest=d;street=road.name;}}}
    el('world-note').textContent='NAPOLI · '+(street??'CENTRO');
  }else{
    c.scale(.85,-.85);c.translate(0,-15);
    c.fillStyle='#aaac92';for(const ring of data.land){c.beginPath();ring.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill();}
    c.fillStyle='#6b7e71';for(const b of data.buildings){c.beginPath();b.rings[0].forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill();}c.fillRect(-48,-80,36,90);
    c.strokeStyle='#e3d3ac';c.lineWidth=3;c.setLineDash([3,3]);c.beginPath();c.moveTo(27,59);c.lineTo(47,59);c.lineTo(47,-47);c.stroke();c.setLineDash([]);
  }
  if(!completed){c.fillStyle='#f6c47b';c.beginPath();c.arc(t[0],t[1],city?9:4,0,Math.PI*2);c.fill();}
  c.translate(x,z);if(city)c.scale(2.2,2.2);c.rotate(-heading);c.fillStyle='#fbf1d2';c.strokeStyle='#234943';c.lineWidth=1.5;c.beginPath();c.moveTo(0,7);c.lineTo(-4,-4);c.lineTo(4,-4);c.closePath();c.fill();c.stroke();c.restore();c.fillStyle='#e6dac1';c.font='10px Arial';c.fillText('N',101,17);
}
