import type {CityRuntime} from './city-data';
import type {Point} from './geo';
import type {StoryLine} from './story';
export const CAMPAIGN_SAVE_KEY='napoli-quartiere-zero-campaign-v1';
export interface CampaignState {version:1;checkpoint:number}
export interface CampaignStop {id:string;act:string;objective:string;label:string;position:Point;reward:number;dialogue:StoryLine[]}
export const initialCampaign=():CampaignState=>({version:1,checkpoint:0});
export function decodeCampaign(raw:string|null,stopCount:number):CampaignState{
  try{const state=JSON.parse(raw??'null');if(state?.version===1&&Number.isSafeInteger(state.checkpoint)&&state.checkpoint>=0&&state.checkpoint<=stopCount)return{version:1,checkpoint:state.checkpoint};}catch{}
  return initialCampaign();
}
export function campaignReward(state:CampaignState,stops:readonly CampaignStop[]){return stops.slice(0,state.checkpoint).reduce((sum,stop)=>sum+stop.reward,0);}
export function advanceCampaign(state:CampaignState,stops:readonly CampaignStop[],position:Point,riding:boolean):CampaignState{
  const stop=stops[state.checkpoint];if(!stop||riding||!position.every(Number.isFinite)||Math.hypot(position[0]-stop.position[0],position[1]-stop.position[1])>=3.5)return state;
  return{version:1,checkpoint:state.checkpoint+1};
}
function along(route:readonly Point[],fraction:number):Point{
  const lengths=route.slice(1).map((p,i)=>Math.hypot(p[0]-route[i][0],p[1]-route[i][1]));let distance=lengths.reduce((s,n)=>s+n,0)*fraction;
  for(let i=0;i<lengths.length;i++){const d=lengths[i];if(d>0&&distance<=d){const t=distance/d;return[route[i][0]+(route[i+1][0]-route[i][0])*t,route[i][1]+(route[i+1][1]-route[i][1])*t];}distance-=d;}
  return [...route.at(-1)!];
}
/** Fictional follow-up on the measured, traversable route; never invents new geographic coverage. */
export function buildCampaign(city:CityRuntime,canStand:(x:number,z:number,radius:number)=>boolean):CampaignStop[]{
  if(city.route.length<2||city.route.some(p=>p.length!==2||!p.every(Number.isFinite)))return[];
  const points=[city.pickup,along(city.route,.45),city.delivery,along(city.route,.2),city.pickup,along(city.route,.72),city.delivery,along(city.route,.4),city.pickup];
  if(points.some(p=>!canStand(p[0],p[1],.55)))return[];
  const definitions:Array<Omit<CampaignStop,'position'>>=[
    {id:'nora-brief',act:'ATTO II · LA COPIA',label:'TERESA',objective:'Parla con Teresa per mettere al sicuro una copia.',reward:0,dialogue:[{speaker:'Teresa',text:'Il telefono non basta. Nora vuole una copia separata: se uno dei due sparisce, l’altro può ancora parlare.'},{speaker:'Luca',text:'Allora niente scorciatoie. Prima controllo che il percorso sia libero.'}]},
    {id:'nora-check',act:'ATTO II · LA COPIA',label:'PUNTO DI CONTROLLO',objective:'Raggiungi il punto di controllo e scendi dall’auto.',reward:0,dialogue:[{speaker:'Luca',text:'La strada è libera. Il messaggio di Nora indica la banchina: nessun nome, nessuna fotografia da inviare.'}]},
    {id:'nora-deliver',act:'ATTO II · LA COPIA',label:'BANCHINA',objective:'Consegna la copia alla banchina.',reward:40,dialogue:[{speaker:'Nora · messaggio',text:'Ricevuto. La prova è salva. Ora cerca ciò che manca: Ada ha lasciato una sequenza, non una confessione.'}]},
    {id:'signal-check',act:'ATTO III · LE TRACCE',label:'TRACCIA',objective:'Controlla il secondo messaggio lungo il percorso.',reward:0,dialogue:[{speaker:'Luca',text:'Tre orari uguali, tre destinatari diversi. Qualcuno ha duplicato i messaggi per confonderci.'}]},
    {id:'signal-return',act:'ATTO III · LE TRACCE',label:'TERESA',objective:'Torna da Teresa e confronta gli orari.',reward:35,dialogue:[{speaker:'Teresa',text:'Ada venne qui prima del messaggio. Quello che hai ricevuto dopo non poteva essere suo.'},{speaker:'Luca',text:'Quindi è ancora lei a decidere quando farsi trovare.'}]},
    {id:'last-run-check',act:'ATTO IV · IL RITORNO',label:'APPUNTAMENTO',objective:'Raggiungi il punto indicato da Ada.',reward:0,dialogue:[{speaker:'Ada · messaggio',text:'Non seguire chi ti promette una risposta subito. Passa dalla banchina e poi torna dove tutto è iniziato.'}]},
    {id:'last-run-quay',act:'ATTO IV · IL RITORNO',label:'BANCHINA',objective:'Controlla l’ultimo segnale alla banchina.',reward:30,dialogue:[{speaker:'Luca',text:'Un biglietto, scritto a mano. «Le prove non sono persone. Salva le prime, aspetta le seconde.»'}]},
    {id:'last-run-return',act:'ATTO IV · IL RITORNO',label:'RITORNO',objective:'Completa il ritorno lungo il percorso.',reward:0,dialogue:[{speaker:'Nora · messaggio',text:'La storia può uscire. Il tuo nome resterà fuori. Quello di Ada, per ora, anche.'}]},
    {id:'epilogue',act:'EPILOGO · QUARTIERE ZERO',label:'TERESA',objective:'Torna da Teresa per l’epilogo.',reward:75,dialogue:[{speaker:'Teresa',text:'Non tutto si risolve in una notte, Luca. Ma adesso sai da dove ricominciare.'},{speaker:'Luca',text:'Da qui. E questa volta il telefono lo tengo acceso.'}]}
  ];
  return definitions.map((stop,i)=>({...stop,position:[...points[i]]}));
}
