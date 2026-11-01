import type {CityMapData} from './city-data';
import type {Point} from './geo';
import {createPhotoDrivingSimulation,createPhotoSourceCollision,localToPhotoCoordinate,photoHeadingDegrees,photoGroundFollow} from './photo-driving';
import {createPhotoTraffic} from './photo-traffic';
import {planEncounterPoint,createEncounterSimulation} from './encounter-simulation';
import {initialStory,decodeStory,reduceStory,storyDialogue,storyObjective,STORY_SAVE_KEY,type StoryState,type StoryLine,type StoryChoice} from './story';
import {buildCampaign,initialCampaign,decodeCampaign,advanceCampaign,campaignReward,CAMPAIGN_SAVE_KEY} from './campaign';
import type {createPhotorealCity,PhotoModel} from './photoreal-city';

export interface PhotoGameModel {file:string;path:string;bytes:number;sha256:string;scale:number;dimensions?:{width:number;height:number;length?:number}}
export interface PhotoDistrict {name:string;position:Point;drive:{position:Point;heading:number;footPosition:Point;roadName?:string};source:{label:string;referenceKind?:string}}
export interface PhotoGameResources {map:CityMapData;models:PhotoGameModel[];districts?:PhotoDistrict[]}
export interface PhotoGameView {mode:'car'|'foot';paused:boolean;speed:number;coins:number;objective:string;distance:number;bearing:number|null;hint:string;wanted:number;message:string;dialogue:{speaker:string;text:string;choice:boolean}|null;completed:boolean;health:number;stamina:number;opponentHealth:number|null}
const CAR='car-white-core.glb',PERSON='civilian-standing-core.glb',LIGHT='patrol-beacon-core.glb',MARKER='mission-marker-core.glb',HAND='hand-core.glb';
const files=[CAR,PERSON,LIGHT,MARKER,HAND];
// Maps uses East/North/Up; core GLB uses +Y up and +Z forward. Tilt 270
// maps +Y to Up and +Z to South, so the model needs a further heading 180.
// Verified against Google's Y-up windmill (mast node quaternion -.5,.5,.5,.5)
// and native sample tilt 270: https://developers.google.com/maps/documentation/javascript/3d/models
// Axis definitions: https://developers.google.com/maps/documentation/javascript/reference/coordinates#Orientation3D
function nativeModelOrientation(heading:number,visualTilt=0){return {heading:photoHeadingDegrees(heading+Math.PI),tilt:270+visualTilt,roll:0};}
export function validatePhotoGameManifest(raw:unknown):PhotoGameModel[]{
  const m=raw as {version?:number;format?:string;outputs?:PhotoGameModel[]};
  if(m?.version!==1||m.format!=='glTF-2.0-binary-core-no-extensions'||!Array.isArray(m.outputs))throw Error('Manifesto modelli della partita non valido.');
  return files.map(file=>{const matches=m.outputs!.filter(o=>o.file===file),o=matches[0];if(matches.length!==1||o.path!==`assets/photo-models/${file}`||!Number.isSafeInteger(o.bytes)||o.bytes<32||o.bytes>24*1024*1024||!/^[a-f0-9]{64}$/.test(o.sha256)||o.scale!==1)throw Error('Modello della partita non verificato.');return o;});
}
export async function validatePhotoGameModelBytes(bytes:ArrayBuffer,model:PhotoGameModel){
  const header=new DataView(bytes);if(bytes.byteLength!==model.bytes||bytes.byteLength<20||header.getUint32(0,true)!==0x46546c67||header.getUint32(4,true)!==2||header.getUint32(8,true)!==bytes.byteLength)throw Error('Il modello della partita è incompleto.');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');if(hash!==model.sha256)throw Error('Il modello della partita non corrisponde al manifesto.');
}
export async function preparePhotoGame(base:string,onProgress:(message:string)=>void=()=>{}):Promise<PhotoGameResources>{
  async function json(path:string,limit:number){const response=await fetch(base+path,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Dati della partita non disponibili.');const bytes=await boundedBody(response,limit);return JSON.parse(new TextDecoder().decode(bytes));}
  onProgress('Caricamento della geografia della partita…');
  let map:CityMapData,worldHash:string|undefined;
  const expanded=await fetch(base+'data/photo-world.json',{signal:AbortSignal.timeout(30000)});
  if(expanded.ok){const bytes=await boundedBody(expanded,40*1024*1024);map=JSON.parse(new TextDecoder().decode(bytes));worldHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');}
  else if(expanded.status===404)map=await json('data/map.json',12*1024*1024);
  else throw Error('La geografia estesa non è disponibile.');
  if(map.provenance!=='osm'||!map.city)throw Error('Geografia della partita non verificata.');
  const models=validatePhotoGameManifest(await json('assets/photo-models/manifest.json',128*1024));
  onProgress('Caricamento dell’auto e del personaggio…');
  await Promise.all(models.map(async model=>{const response=await fetch(base+model.path+'?v='+model.sha256,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Un modello della partita non è disponibile.');await validatePhotoGameModelBytes(await boundedBody(response,model.bytes),model);}));
  let districts:PhotoDistrict[]=[];
  const districtResponse=await fetch(base+'data/photo-districts.json',{signal:AbortSignal.timeout(15000)});
  if(districtResponse.ok){const data=JSON.parse(new TextDecoder().decode(await boundedBody(districtResponse,256*1024)));if(data.version!==1||!worldHash||data.worldSha256!==worldHash||!Array.isArray(data.districts)||data.districts.length!==30)throw Error('Le destinazioni non corrispondono alla mappa.');const seen=new Set<string>();for(const d of data.districts){if(!d||typeof d.name!=='string'||seen.has(d.name)||!Array.isArray(d.position)||d.position.length!==2||!d.position.every(Number.isFinite)||!Array.isArray(d.drive?.position)||d.drive.position.length!==2||!d.drive.position.every(Number.isFinite)||!Number.isFinite(d.drive.heading))throw Error('Destinazione non verificata.');seen.add(d.name);}districts=data.districts;}
  else if(districtResponse.status!==404)throw Error('Le destinazioni della città non sono disponibili.');
  return {map,models,districts};
}
async function boundedBody(response:Response,limit:number):Promise<ArrayBuffer>{
  if(!response.body)throw Error('Risposta vuota.');const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('Dati della partita oltre il limite.');chunks.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}return bytes.buffer;
}
export function createPhotoGame(city:Awaited<ReturnType<typeof createPhotorealCity>>,resources:PhotoGameResources,options:{base:string;storage?:Pick<Storage,'getItem'|'setItem'>;onMessage?:(text:string)=>void}){
  const map=resources.map;if(!map.city)throw Error('Geografia della partita mancante.');
  const source=createPhotoSourceCollision(map);let encounter:ReturnType<typeof createEncounterSimulation>|undefined;let traffic:ReturnType<typeof createPhotoTraffic>|undefined;
  const carInfo=resources.models.find(m=>m.file===CAR)!,width=carInfo.dimensions?.width??2.5670086,length=carInfo.dimensions?.length??4.4;
  const driver=createPhotoDrivingSimulation(map,{carRadius:width/2+.025,carHalfLength:length/2+.025,canStand:(x,z,r)=>encounter?.canStand(x,z,r)??traffic?.canStand(x,z,r)??true});
  let story:StoryState=initialStory();try{story=decodeStory(options.storage?.getItem(STORY_SAVE_KEY)??null);}catch{}
  const campaignStops=buildCampaign(map.city,source.canStand);let campaign=initialCampaign();try{if(story.phase==='completed')campaign=decodeCampaign(options.storage?.getItem(CAMPAIGN_SAVE_KEY)??null,campaignStops.length);}catch{}
  let paused=false,dialogueLines:StoryLine[]|null=null,dialogueIndex=0,dialogueChoice=false,message='',disposed=false,playing=true,elapsed=0,cameraClock=0,footSpeed=0,cameraOrbit=0,range=12,footThirdPerson=false;
  const owned:PhotoModel[]=[],visible=new Set<PhotoModel>();
  function tell(text:string){message=text;options.onMessage?.(text);}
  function persist(){try{options.storage?.setItem(STORY_SAVE_KEY,JSON.stringify(story));options.storage?.setItem(CAMPAIGN_SAVE_KEY,JSON.stringify(campaign));}catch{tell('La storia continua in memoria.');}}
  function model(file:string,position:Point,heading=0,height=0){const record=resources.models.find(m=>m.file===file)!;const object=city.addOriginalModel({src:options.base+record.path+'?v='+record.sha256,position:localToPhotoCoordinate(position,height),orientation:nativeModelOrientation(heading),scale:record.scale,altitudeMode:'RELATIVE_TO_GROUND'});owned.push(object);visible.add(object);return object;}
  function show(object:PhotoModel,value:boolean){if(value&&!visible.has(object)){city.map.append(object);visible.add(object);}else if(!value&&visible.delete(object))object.remove();}
  function pose(object:PhotoModel,position:Point,heading:number,height=0){object.position=localToPhotoCoordinate(position,height);object.orientation=nativeModelOrientation(heading);}
  const car=model(CAR,driver.state.car.position,driver.state.car.heading),person=model(PERSON,driver.state.player.position,driver.state.player.heading);show(person,false);
  traffic=createPhotoTraffic(map.city,source.canStand,{anchor:driver.state.car.position,maxVehicles:4,obstacles:()=>encounter&&['idle','active'].includes(encounter.state.phase)?[{position:encounter.state.position,heading:encounter.state.heading,radius:.45,halfLength:.45}]:[],player:()=>({position:driver.activePosition,heading:driver.state.mode==='car'?driver.state.car.heading:driver.state.player.heading,radius:driver.state.mode==='car'?driver.size.radius:.5,halfLength:driver.state.mode==='car'?driver.size.halfLength:.5,riding:driver.state.mode==='car',speed:driver.state.mode==='car'?driver.state.car.speed:footSpeed}),onEvent:event=>{if(event==='alert')tell('Allerta: una pattuglia ti cerca.');if(event==='searching')tell('La pattuglia ha perso il contatto.');if(event==='escaped')tell('Hai seminato la pattuglia.');if(event==='caught'){driver.state.car.speed=0;tell('La pattuglia ti ha fermato. Inseguimento concluso.');}}});
  const hand=model(HAND,driver.state.player.position,driver.state.player.heading,1.2);show(hand,false);
  const encounterPosition=planEncounterPoint(map.city,traffic.canStand,driver.state.car.position);
  let opponent:PhotoModel|undefined;
  if(encounterPosition){
    opponent=model(PERSON,encounterPosition);
    encounter=createEncounterSimulation(encounterPosition,traffic.canStand,{animationAvailable:true,protectedPoints:[map.city.pickup,map.city.delivery],player:()=>({position:driver.activePosition,heading:driver.state.viewHeading,riding:driver.state.mode==='car'}),onIncident:()=>traffic!.reportIncident('assault'),onEvent:event=>{
      if(event==='started')tell('Scontro · F colpisce. Puoi allontanarti.');
      if(event==='defeated')tell('Scontro concluso. Puoi proseguire.');
      if(event==='knocked-out'){driver.recover();tell('Sei stato messo fuori combattimento. La storia è conservata.');}
    }});
  }
  // One model per traffic slot, bound by index: relocating traffic replaces the
  // actors, so slots are re-posed or hidden rather than re-created on the map.
  const fleet=Array.from({length:traffic.maxVehicles},(_,slot)=>{const actor=traffic!.actors[slot],at=actor?.position??driver.state.car.position,heading=actor?.heading??0,item={car:model(CAR,at,heading),light:model(LIGHT,at,heading,1.18)};show(item.car,!!actor);show(item.light,actor?.role==='patrol');return item;});
  const marker=model(MARKER,map.city.pickup,0,2.2);
  function destination():Point|null{if(story.phase==='completed')return campaignStops[campaign.checkpoint]?.position??null;return story.phase==='carrying'?map.city!.delivery:map.city!.pickup;}
  function view():PhotoGameView{
    const target=destination(),distance=target?Math.hypot(target[0]-driver.activePosition[0],target[1]-driver.activePosition[1]):0,stop=story.phase==='completed'?campaignStops[campaign.checkpoint]:undefined;
    let hint=driver.state.mode==='car'?'Segui la freccia · E · scendi':'E · sali in auto';
    if(target&&distance<3.5)hint=driver.state.mode==='car'?'Fermati e premi E per scendere':'E · continua la storia';
    else if(driver.state.mode==='foot'&&Math.hypot(driver.state.player.position[0]-driver.state.car.position[0],driver.state.player.position[1]-driver.state.car.position[1])>4)hint='Shift · corri · R · recupera';
    const line=dialogueLines?.[dialogueIndex];
    const heading=(driver.state.mode==='car'?driver.state.car.heading:driver.state.viewHeading)+cameraOrbit;
    const bearing=target?(Math.atan2(target[0]-driver.activePosition[0],target[1]-driver.activePosition[1])-heading)*180/Math.PI:null;
    return {mode:driver.state.mode,paused:paused||!playing,speed:driver.state.car.speed,coins:story.coins+campaignReward(campaign,campaignStops),objective:stop?.objective??storyObjective(story),distance,bearing,hint,wanted:traffic!.pursuit.state.level,message,dialogue:dialogueLines?{speaker:line?.speaker??'La tua decisione',text:line?.text??'A chi affidi il telefono di Ada?',choice:!line&&dialogueChoice}:null,completed:!target,health:encounter?.state.playerHealth??100,stamina:encounter?.state.stamina??100,opponentHealth:encounter?.state.phase==='active'?encounter.state.opponentHealth:null};
  }
  function talk(lines:StoryLine[],choice=false){dialogueLines=lines;dialogueIndex=0;dialogueChoice=choice;driver.state.car.speed=0;}
  function interact(){
    if(!playing||paused)return;
    if(dialogueLines){if(dialogueIndex+1<dialogueLines.length)dialogueIndex++;else if(dialogueChoice)dialogueIndex=dialogueLines.length;else dialogueLines=null;return;}
    if(driver.state.mode==='car'){const result=driver.interact();if(!result.changed)tell(result.reason==='moving'?'Frena prima di scendere.':'Sposta l’auto: qui non c’è spazio per scendere.');else{cameraOrbit=0;show(person,false);}return;}
    const target=destination();if(target&&Math.hypot(target[0]-driver.state.player.position[0],target[1]-driver.state.player.position[1])<3.5){
      if(story.phase==='completed'){const stop=campaignStops[campaign.checkpoint],next=advanceCampaign(campaign,campaignStops,driver.state.player.position,false);if(next!==campaign){campaign=next;persist();talk(stop.dialogue);if(stop.reward)tell(`Incarico completato · +${stop.reward} €`);}return;}
      const before=story;
      if(story.phase==='available'){story=reduceStory(story,'interact-bar');talk([...storyDialogue(before),...storyDialogue(story)]);}
      else if(story.phase==='carrying'){story=reduceStory(story,'interact-quay');talk(storyDialogue(story),true);}
      else if(story.phase==='return'){if(!story.choice)talk(storyDialogue(story),true);else{story=reduceStory(story,'interact-bar');talk(storyDialogue(story));tell(`Prologo completato · +${story.coins} €`);}}
      persist();return;
    }
    const result=driver.interact();if(!result.changed&&result.reason==='far')tell('Avvicinati alla tua auto per salire.');
  }
  function choose(choice:StoryChoice){if(!playing||paused||!dialogueLines||!dialogueChoice||dialogueIndex<dialogueLines.length)return;story=reduceStory(story,choice==='protect'?'choose-protect':'choose-negotiate');persist();dialogueLines=null;dialogueChoice=false;if(choice==='negotiate')traffic!.reportIncident('mission');}
  function sync(){
    pose(car,driver.state.car.position,driver.state.car.heading);pose(person,driver.state.player.position,driver.state.player.heading);show(person,driver.state.mode==='foot'&&footThirdPerson);
    for(const [slot,item]of fleet.entries()){const actor=traffic!.actors[slot];show(item.car,!!actor);show(item.light,actor?.role==='patrol');if(!actor)continue;pose(item.car,actor.position,actor.heading);if(actor.role==='patrol')pose(item.light,actor.position,actor.heading,1.18);}
    const target=destination();show(marker,!!target);if(target)pose(marker,target,elapsed*.8,2.2);
    if(opponent&&encounter){const fight=encounter.state;show(opponent,fight.phase!=='defeated'&&fight.phase!=='knocked-out');pose(opponent,fight.position,fight.heading);if(fight.opponentPunch>=0)opponent.orientation=nativeModelOrientation(fight.heading,Math.sin(fight.opponentPunch/.5*Math.PI)*12);}
    const fight=encounter?.state,age=fight?.playerPunch??-1,strike=age>=0&&age<=.45&&driver.state.mode==='foot';show(hand,strike);
    if(strike){const heading=driver.state.viewHeading,p=driver.state.player.position,reach=.35+Math.sin(age/.45*Math.PI)*.55;pose(hand,[p[0]+Math.sin(heading)*reach+Math.cos(heading)*.18,p[1]+Math.cos(heading)*reach-Math.sin(heading)*.18],heading,1.25);}
    if(!playing)return;
    const heading=(driver.state.mode==='car'?driver.state.car.heading:driver.state.viewHeading)+cameraOrbit;
    if(driver.state.mode==='foot'&&!footThirdPerson){const p=driver.activePosition,look:Point=[p[0]+Math.sin(heading)*3,p[1]+Math.cos(heading)*3];city.setCamera({center:localToPhotoCoordinate(look,1.5),heading:photoHeadingDegrees(heading),range:3,tilt:85,altitudeMode:'RELATIVE_TO_GROUND'});}
    else{const camera=photoGroundFollow(driver.activePosition,heading,0,{mode:driver.state.mode,range:driver.state.mode==='foot'?5.5:range});city.setCamera({...camera,altitudeMode:'RELATIVE_TO_GROUND'});}

  }
  function update(dt:number,input:{forward:number;turn:number;run?:boolean;orbit?:number;zoom?:number}){
    if(disposed||!Number.isFinite(dt)||dt<=0||dt>.25)return;
    if(!playing||paused||dialogueLines)return;
    elapsed+=dt;
    if(playing&&!paused&&!dialogueLines){
      if(driver.state.mode==='car')cameraOrbit+=(input.orbit??0)*dt*1.2;else cameraOrbit=0;range=Math.max(3,Math.min(30,range*Math.exp((input.zoom??0)*dt)));
      const before=driver.activePosition,impact=Math.abs(driver.state.car.speed);
      driver.update(dt,{forward:input.forward,turn:input.turn,run:input.run,viewHeading:driver.state.mode==='foot'?driver.state.viewHeading+(input.orbit??0)*dt*1.2:undefined});
      footSpeed=driver.state.mode==='foot'?Math.hypot(driver.activePosition[0]-before[0],driver.activePosition[1]-before[1])/dt:0;
      if(driver.state.collision&&impact>3)traffic!.reportPlayerCollision(impact);
      traffic!.update(dt);traffic!.follow();encounter?.update(dt);
    }
    cameraClock+=dt;if(cameraClock>=1/30){cameraClock%=1/30;sync();}
  }
  function recover(){if(!playing||paused||dialogueLines)return;if(driver.recover()){cameraOrbit=0;sync();tell('Auto recuperata in un punto libero.');}else tell('Il punto di recupero è occupato. Attendi il traffico.');}
  sync();
  return {driver,traffic,encounter,districts:resources.districts??[],travelTo(name:string){if(dialogueLines||traffic!.pursuit.state.level>0){tell('Concludi il dialogo o semina la pattuglia prima del viaggio rapido.');return false;}const district=resources.districts?.find(d=>d.name===name);if(!district||!driver.travelTo(district.drive.position,district.drive.heading)){tell('Non c’è spazio libero per arrivare qui.');return false;}traffic!.relocate(district.drive.position);cameraOrbit=0;sync();tell(`${district.name} · ${district.drive.roadName??'arrivo sulla strada'}`);return true;},update,interact,choose,recover,view,sync,attack(){if(playing&&!paused&&!dialogueLines&&driver.state.mode==='foot')return encounter?.attack()??false;return false;},toggleView(){footThirdPerson=!footThirdPerson;sync();},setPaused(value:boolean){paused=value;driver.state.car.speed=0;},get paused(){return paused;},setPlaying(value:boolean){playing=value;driver.state.car.speed=0;if(value)sync();},dispose(){if(disposed)return;disposed=true;for(const object of owned)object.remove();visible.clear();}};
}
