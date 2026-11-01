import './photoreal.css';
import {NAPOLI_QUARTIERI} from './napoli-sectors';
import {configuredPhotoKey,selectedPhotoKey,PHOTO_START,movePhotoCamera,photoCameraAt} from './photoreal-config';
import {createPhotorealCity} from './photoreal-city';
import {preparePhotoGame,createPhotoGame} from './photo-game';
const get=<T extends HTMLElement>(id:string)=>{const element=document.getElementById(id);if(!element)throw Error('Interfaccia della partita incompleta. Ricarica la pagina.');return element as T;};
const open=get<HTMLButtonElement>('photo-open'),district=get<HTMLSelectElement>('photo-district'),go=get<HTMLButtonElement>('photo-go'),quality=get<HTMLSelectElement>('photo-quality'),status=get('photo-status'),host=get('photo-map'),modeButton=get<HTMLButtonElement>('photo-mode'),pauseButton=get<HTMLButtonElement>('photo-pause');
const buildKey=configuredPhotoKey(import.meta.env.VITE_GOOGLE_MAPS_API_KEY),geocodingEnabled=import.meta.env.VITE_GOOGLE_MAPS_GEOCODING_ENABLED==='true';
const base=import.meta.env.BASE_URL;
let city:Awaited<ReturnType<typeof createPhotorealCity>>|undefined,game:ReturnType<typeof createPhotoGame>|undefined,playing=false;
for(const name of NAPOLI_QUARTIERI){const option=document.createElement('option');option.value=option.textContent=name;district.append(option);}
const keyInput=get<HTMLInputElement>('photo-api-key');get('photo-key-config').hidden=!!buildKey;
const keys=new Set<string>();
function refreshConnection(){
  const key=selectedPhotoKey(buildKey,keyInput.value);open.disabled=!key;
  get('photo-setup-text').textContent=key?'Chiave pronta. «Gioca a Napoli» avvia la partita nella città fotografica usando il tuo account Google.':'Incolla la chiave Google Maps, poi premi «Gioca a Napoli». Non servono altre configurazioni.';
  status.textContent=keyInput.value.trim()&&!key?'Controlla di aver copiato la chiave per intero.':'La partita non è ancora avviata.';
}
keyInput.addEventListener('input',refreshConnection);refreshConnection();
function draw(){
  if(!game)return;const view=game.view();
  get('photo-game-hud').hidden=!playing;get('photo-objective').textContent=view.objective;get('photo-distance').textContent=view.completed?'Storia completata':`${Math.round(view.distance)} m`;
  get('photo-speed').textContent=view.mode==='car'?`${Math.round(Math.abs(view.speed)*3.6)} km/h`:'A PIEDI';get('photo-coins').textContent=`${view.coins} €`;get('photo-hint').textContent=view.paused?'PARTITA IN PAUSA':view.hint;
  get('photo-bearing').hidden=view.bearing===null;get('photo-bearing').style.transform=`rotate(${view.bearing??0}deg)`;
  get('photo-wanted').textContent=view.wanted?'★'.repeat(view.wanted)+' RICERCATO':'';
  get('photo-health').textContent=view.opponentHealth!==null?`SALUTE ${view.health} · FIATO ${Math.round(view.stamina)} · RIVALE ${view.opponentHealth}`:'';
  pauseButton.textContent=game.paused?'Riprendi':'Pausa';
  const dialog=get('photo-dialogue');dialog.hidden=!playing||!view.dialogue;
  if(view.dialogue){get('photo-dialogue-speaker').textContent=view.dialogue.speaker;get('photo-dialogue-text').textContent=view.dialogue.text;get('photo-dialogue-choices').hidden=!view.dialogue.choice;get('photo-dialogue-next').hidden=view.dialogue.choice;}
}
function focusGame(){if(!game?.view().dialogue)host.focus();}
function setPlaying(value:boolean){if(!game||!city)return;keys.clear();playing=value;game.setPlaying(value);modeButton.textContent=value?'Vista libera':'Torna alla partita';pauseButton.hidden=!value;get('photo-controls-game').hidden=!value;get('photo-controls-free').hidden=value;district.disabled=!(game.districts.length||(!value&&geocodingEnabled));go.disabled=district.disabled||!district.value;
  if(!value)city.setCamera({...PHOTO_START,center:{...city.getCamera().center,altitude:30},altitudeMode:'RELATIVE_TO_GROUND'},true);else focusGame();draw();}
open.onclick=async()=>{
  const key=selectedPhotoKey(buildKey,keyInput.value);if(!key||city)return;open.disabled=true;keyInput.disabled=true;
  let nextCity:Awaited<ReturnType<typeof createPhotorealCity>>|undefined;
  try{
    const resources=await preparePhotoGame(base,text=>status.textContent=text);status.textContent='Collegamento alla città fotografica…';
    nextCity=await createPhotorealCity(host,{apiKey:key,geocodingEnabled,onStatus:message=>{if(!game)status.textContent=message;}});nextCity.map.qualityMode=quality.value as 'FIDELITY'|'PERFORMANCE';
    await nextCity.whenSteady();
    let storage:Storage|undefined;try{storage=localStorage;}catch{}
    game=createPhotoGame(nextCity,resources,{base,storage,onMessage:text=>status.textContent=text});city=nextCity;
    keyInput.value='';get('photo-key-config').hidden=true;get('photo-empty').hidden=true;get('photo-controls').hidden=false;open.hidden=true;get('photo-setup').hidden=true;modeButton.hidden=false;pauseButton.hidden=false;
    status.textContent='Segui la freccia verso l’obiettivo. WASD guida, fermati e premi E per scendere; poi E vicino al segnale per parlare.';setPlaying(true);
  }catch(error){game?.dispose();game=undefined;nextCity?.dispose();city=undefined;playing=false;status.textContent=error instanceof Error?error.message:'La partita non si è collegata. Verifica chiave e servizio.';keyInput.disabled=false;open.disabled=!selectedPhotoKey(buildKey,keyInput.value);}
};
modeButton.onclick=()=>setPlaying(!playing);
pauseButton.onclick=()=>{if(game){keys.clear();game.setPaused(!game.paused);draw();if(!game.paused)focusGame();}};
district.onchange=()=>go.disabled=!city||!district.value||district.disabled;
go.onclick=async()=>{
  if(!city||!game||!district.value)return;go.disabled=true;let restorePause:boolean|undefined;
  try{
    const destination=game.districts.find(d=>d.name===district.value);
    if(destination&&playing){restorePause=game.paused;game.setPaused(true);keys.clear();city.markSceneChanging();if(game.travelTo(destination.name)){status.textContent=`Arrivo a ${destination.name}…`;await city.whenSteady();status.textContent=`${destination.name} · viaggio rapido completato.`;}}
    else if(destination){city.setCamera(photoCameraAt({lat:40.8281+destination.position[1]/6378137*180/Math.PI,lng:14.2486+destination.position[0]/(6378137*Math.cos(40.8281*Math.PI/180))*180/Math.PI,altitude:30},{tilt:60,range:1400,altitudeMode:'RELATIVE_TO_GROUND'}),true);}
    else await city.goToDistrict(district.value);
  }catch(error){status.textContent=error instanceof Error?error.message:'Il quartiere non è disponibile.';}
  finally{if(restorePause!==undefined)game?.setPaused(restorePause);go.disabled=false;draw();focusGame();}
};
quality.onchange=()=>{if(city)city.map.qualityMode=quality.value as 'FIDELITY'|'PERFORMANCE';focusGame();};
get<HTMLButtonElement>('photo-home').onclick=()=>{if(playing)game?.recover();else city?.setCamera(PHOTO_START,true);focusGame();};
get<HTMLButtonElement>('photo-dialogue-next').onclick=()=>{game?.interact();draw();focusGame();};
for(const [id,choice]of [['photo-protect','protect'],['photo-negotiate','negotiate']] as const)get<HTMLButtonElement>(id).onclick=()=>{game?.choose(choice);draw();focusGame();};
const owned=new Set(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight','KeyQ','KeyC','Equal','Minus','NumpadAdd','NumpadSubtract','KeyE','KeyR','Escape','KeyV','KeyF']);
addEventListener('keydown',event=>{
  const target=event.target as HTMLElement|null;if(!city||!owned.has(event.code)||event.ctrlKey||event.metaKey||event.altKey||target?.closest('input,select,textarea,[contenteditable]'))return;
  event.preventDefault();event.stopPropagation();
  if(playing&&game&&!event.repeat){
    if(event.code==='KeyE'){keys.clear();game.interact();draw();focusGame();return;}
    if(event.code==='KeyR'){game.recover();return;}
    if(event.code==='KeyF'){game.attack();return;}
    if(event.code==='KeyV'){game.toggleView();return;}
    if(event.code==='Escape'){if(!game.view().dialogue){keys.clear();game.setPaused(!game.paused);draw();}return;}
  }
  keys.add(event.code);
},true);
addEventListener('keyup',event=>keys.delete(event.code),true);
function lostFocus(){keys.clear();if(playing&&game){game.setPaused(true);draw();}}
addEventListener('blur',lostFocus);document.addEventListener('visibilitychange',()=>{if(document.hidden)lostFocus();});
const axis=(positive:string[],negative:string[])=>Number(positive.some(k=>keys.has(k)))-Number(negative.some(k=>keys.has(k)));
let previous=0,frame=0,hudClock=0;
function update(time:number){
  const dt=previous?Math.min(.05,(time-previous)/1000):0;previous=time;
  if(city&&dt){
    if(game&&playing){game.update(dt,{forward:axis(['KeyW','ArrowUp'],['KeyS','ArrowDown']),turn:axis(['KeyD','ArrowRight'],['KeyA','ArrowLeft']),run:keys.has('ShiftLeft')||keys.has('ShiftRight'),orbit:axis(['KeyC'],['KeyQ']),zoom:axis(['Minus','NumpadSubtract'],['Equal','NumpadAdd'])});if((hudClock+=dt)>.08){hudClock=0;draw();}}
    else if(keys.size){try{const camera=city.getCamera();const next=movePhotoCamera(camera,axis(['KeyW','ArrowUp'],['KeyS','ArrowDown']),axis(['KeyD','ArrowRight'],['KeyA','ArrowLeft']),dt*90);city.setCamera(photoCameraAt(next.center,{...next,heading:next.heading+axis(['KeyC'],['KeyQ'])*dt*50,range:Math.max(50,Math.min(10000,next.range*Math.exp(axis(['Minus','NumpadSubtract'],['Equal','NumpadAdd'])*dt)))}));}catch{keys.clear();}}
  }
  frame=requestAnimationFrame(update);
}
frame=requestAnimationFrame(update);let suspended=false;
addEventListener('pagehide',(event:PageTransitionEvent)=>{cancelAnimationFrame(frame);keys.clear();previous=0;suspended=true;if(!event.persisted){game?.dispose();city?.dispose();}});
addEventListener('pageshow',(event:PageTransitionEvent)=>{if(!event.persisted||!suspended)return;keys.clear();previous=0;suspended=false;frame=requestAnimationFrame(update);});
