import type {MapData} from './geo';
import {target} from './mission';
import type {Save} from './save';
export const el=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
export function show(id:string,value:boolean){el(id).classList.toggle('hidden',!value);}
let toastTimer:ReturnType<typeof setTimeout>;
export function toast(message:string){el('toast').textContent=message;show('toast',true);clearTimeout(toastTimer);toastTimer=setTimeout(()=>show('toast',false),4500);}
export function updateHUD(save:Save,x:number,z:number,heading:number,riding:boolean,speed:number,hint:string,data:MapData){
  const t=target(save),dist=Math.hypot(t[0]-x,t[1]-z);
  el('coins').textContent=String(save.coins);
  el('mission-phase').textContent=save.mission==='completed'?'CONSEGNA COMPLETATA':save.mission==='active'?'CONSEGNA IN CORSO':'CONSEGNA DISPONIBILE';
  el('objective').textContent=save.mission==='completed'?'Grazie! Il caffè è arrivato caldo. Esplora il borgo.':save.mission==='active'?'Porta il caffè al pescatore sulla banchina.':'Passa al bar e ritira il caffè. Il motorino ti aspetta.';
  el('distance').textContent=save.mission==='completed'?'+25 ✧':`${Math.round(dist)} m`;
  const angle=Math.atan2(t[0]-x,t[1]-z)-heading;const arrow=Math.abs(Math.sin(angle))<.3?(Math.cos(angle)>0?'↑':'↓'):Math.sin(angle)>0?'→':'←';
  el('direction').textContent=save.mission==='completed'?'GRAZIE, GUAGLIÒ!':`${save.mission==='active'?'BANCHINA':'BAR'} ${arrow}`;
  el('speed').textContent=riding?`${Math.round(Math.abs(speed)*3.6)} km/h`:'A PIEDI';
  el('mode-info').textContent=riding?'E SCENDI · S FRENA / RETROMARCIA':'SHIFT PER CORRERE';
  show('hint',!!hint);el('hint').innerHTML=hint?`<kbd>E</kbd> ${hint}`:'';
  const c=el<HTMLCanvasElement>('minimap').getContext('2d')!;c.clearRect(0,0,210,210);c.save();c.translate(105,105);c.scale(.85,-.85);c.translate(0,-15);
  c.fillStyle='#aaac92';for(const ring of data.land){c.beginPath();ring.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill();}
  c.fillStyle='#6b7e71';for(const b of data.buildings){c.beginPath();b.rings[0].forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fill();}c.fillRect(-48,-80,36,90);
  c.strokeStyle='#e3d3ac';c.lineWidth=3;c.setLineDash([3,3]);c.beginPath();c.moveTo(27,59);c.lineTo(47,59);c.lineTo(47,-47);c.stroke();c.setLineDash([]);
  if(save.mission!=='completed'){c.fillStyle='#f6c47b';c.beginPath();c.arc(t[0],t[1],4,0,Math.PI*2);c.fill();}
  c.translate(x,z);c.rotate(-heading);c.fillStyle='#fbf1d2';c.strokeStyle='#234943';c.lineWidth=1.5;c.beginPath();c.moveTo(0,7);c.lineTo(-4,-4);c.lineTo(4,-4);c.closePath();c.fill();c.stroke();c.restore();c.fillStyle='#e6dac1';c.font='10px Arial';c.fillText('N',101,17);
}
