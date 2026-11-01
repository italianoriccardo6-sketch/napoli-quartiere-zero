import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/libre-caslon-display/latin-400.css';
import './style.css';
import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {createWorld} from './world';
import {createDetailedCity} from './city-visuals';
import {loadCityTerrain} from './city-terrain';
import {vehicleSurfacePose} from './vehicle-surface';
import {createAmbientCity} from './ambient-city';
import {createCityTraffic} from './city-traffic';
import {createCityEncounter} from './city-encounter';
import {trafficCapsulesOverlap} from './traffic-network';
import {buildCampaign,decodeCampaign,initialCampaign,advanceCampaign,campaignReward,CAMPAIGN_SAVE_KEY} from './campaign';
import {createNarration} from './narration';
import {createCar,canStandForCar} from './car';
import {placeVehicleOnStreet,vehicleBlocksPoint,findPlayerBesideVehicle,openingStreetData} from './vehicle-placement';
import type {CityMapData} from './city-data';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {createCharacter} from './character';
import {createDetailedCharacter} from './character-model';
import {createScooter,stepVelocity} from './vehicle';
import {createCamera} from './camera';
import {walkingDirection,moveOnGround} from './movement';
import {Input} from './input';
import {Audio} from './audio';
import {loadSave,storeSave,defaults,type Save} from './save';
import {PICKUP,DELIVERY} from './mission';
import {initialStory,reduceStory,decodeStory,storyDialogue,STORY_SAVE_KEY,type StoryState,type StoryLine} from './story';
import {el,show,toast,updateHUD,validateGameUI} from './ui';
import type {MapData,Point} from './geo';
async function boot(){
  validateGameUI();
  const response=await fetch(`${import.meta.env.BASE_URL}data/map.json`);if(!response.ok)throw Error('I dati della scena non sono disponibili. Ricarica la pagina.');
  const map=await response.json() as CityMapData;
  const terrain=map.city?await loadCityTerrain(map.city):undefined;
  if(map.city){PICKUP.splice(0,2,...map.city.pickup);DELIVERY.splice(0,2,...map.city.delivery);}
  const canvas=el<HTMLCanvasElement>('game');
  if(!Engine.isSupported())throw Error('Il browser non supporta WebGL. Prova un browser aggiornato con accelerazione grafica attiva.');
  const engine=new Engine(canvas,true,{preserveDrawingBuffer:false,stencil:true,powerPreference:'high-performance'});
  const scene=new Scene(engine),cityVisuals=map.city?createDetailedCity(scene,map,map.city,{terrain}):undefined,world=cityVisuals??createWorld(scene,map),character=map.city?createDetailedCharacter(scene):createCharacter(scene),scooter=map.city?createCar(scene):createScooter(scene),cam=createCamera(scene),input=new Input(canvas),audio=new Audio();
  await Promise.all([cityVisuals?.ready??Promise.resolve(),'ready' in scooter?scooter.ready:Promise.resolve(),'ready' in character?character.ready:Promise.resolve()]);
  const carRadius='radius' in scooter?scooter.radius:.93,carHalfLength='halfLength' in scooter?scooter.halfLength:1.1;
  const surfaceHeightAt=(x:number,z:number)=>world.surfaceHeightAt?.(x,z)??0;
  function settleCar(){
    const pose=vehicleSurfacePose(scooter.root.position.x,scooter.root.position.z,scooter.heading,{halfLength:carHalfLength,halfWidth:carRadius},surfaceHeightAt);
    scooter.root.position.y=pose.height;scooter.root.rotation.set(pose.pitch,scooter.heading,pose.roll);
  }
  const placement=map.city?placeVehicleOnStreet(openingStreetData(map.city),world.canStand,{radius:carRadius,halfLength:carHalfLength}):undefined;
  character.root.getChildMeshes().forEach(m=>world.shadows.addShadowCaster(m));scooter.root.getChildMeshes().forEach(m=>world.shadows.addShadowCaster(m));
  const spawn:Point=placement?.player??[20,58],scooterPoint:Point=placement?.car??[18,60];
  scooter.spawn.set(scooterPoint[0],surfaceHeightAt(...scooterPoint),scooterPoint[1]);scooter.root.position.copyFrom(scooter.spawn);
  character.root.position.set(spawn[0],surfaceHeightAt(...spawn),spawn[1]);
  const initialHeading=placement?.heading??Math.atan2(PICKUP[0]-spawn[0],PICKUP[1]-spawn[1]);
  character.root.rotation.y=initialHeading;scooter.root.rotation.y=scooter.heading=initialHeading;
  settleCar();scooter.spawn.copyFrom(scooter.root.position);
  let encounter:ReturnType<typeof createCityEncounter>|undefined;
  let traffic:ReturnType<typeof createCityTraffic>|undefined;
  const ambient=map.city?createAmbientCity(scene,map.city,world,{anchor:scooterPoint,protectedPoints:[spawn,scooterPoint],surfaceHeightAt:cityVisuals?.surfaceHeightAt,walkerCanStand:(x,z,r)=>(encounter?.canStand(x,z,r)??traffic?.canStand(x,z,r)??world.canStand(x,z,r))&&!vehicleBlocksPoint({x,z},scooter.root.position,scooter.heading,carRadius,carHalfLength,r)&&Math.hypot(x-character.root.position.x,z-character.root.position.z)>r+.5}):undefined;
  await ambient?.ready;
  scene.metadata={...(scene.metadata??{}),ambientPopulation:{pedestrians:ambient?.plan.walkers.length??0,parkedCars:ambient?.plan.cars.length??0,representation:'Generic licensed models; inferred parking offsets and walkers on source OSM paths.'}};
  if(map.city){
    cam.orient(initialHeading);cam.snap(character.root.position);
    for(const [i,p]of[PICKUP,DELIVERY].entries()){
      const material=new StandardMaterial('segnale missione '+i,scene);material.diffuseColor=Color3.FromHexString('#dfbd7f');material.emissiveColor=material.diffuseColor.scale(.3);
      const marker=MeshBuilder.CreateCylinder('punto di interazione '+i,{diameterTop:0,diameterBottom:.7,height:1.3,tessellation:4},scene);marker.position.set(p[0],surfaceHeightAt(...p)+3.6,p[1]);marker.rotation.z=Math.PI;marker.material=material;marker.isPickable=false;world.beacons.push(marker);
    }
  }
  let story:StoryState;try{story=decodeStory(localStorage.getItem(STORY_SAVE_KEY));}catch{story=initialStory();}
  const campaignStops=map.city?buildCampaign(map.city,world.canStand):[];
  let campaign=initialCampaign();try{if(story.phase==='completed')campaign=decodeCampaign(localStorage.getItem(CAMPAIGN_SAVE_KEY),campaignStops.length);}catch{}
  const narration=createNarration();
  const narrationInput=el<HTMLInputElement>('narration');narrationInput.disabled=!narration.available;narrationInput.onchange=()=>narration.setEnabled(narrationInput.checked);
  scene.onDisposeObservable.addOnce(()=>narration.stop());
  const campaignMarker=MeshBuilder.CreateCylinder('punto campagna',{diameterTop:0,diameterBottom:.75,height:1.3,tessellation:4},scene);
  const campaignMaterial=new StandardMaterial('segnale campagna',scene);campaignMaterial.diffuseColor=Color3.FromHexString('#64d8be');campaignMaterial.emissiveColor=campaignMaterial.diffuseColor.scale(.3);campaignMarker.material=campaignMaterial;campaignMarker.isPickable=false;campaignMarker.setEnabled(false);
  let dialogueOpen=false,dialogueLines:StoryLine[]=[],dialogueIndex=0,dialogueChoice=false;
  let save:Save=loadSave(),started=false,paused=false,riding=!!map.city,credits=false,time=0,hudTime=0,lastMove=false,lastInteraction=0,footSpeed=0;
  if(map.city){traffic=createCityTraffic(scene,map.city,{canStand:ambient?.canStand??world.canStand,shadows:world.shadows},{anchor:scooterPoint,surfaceHeightAt,maxVehicles:4,obstacles:()=>encounter?.state&&['idle','active'].includes(encounter.state.phase)?[{position:encounter.state.position,heading:encounter.state.heading,radius:.45,halfLength:.45}]:[],player:()=>({position:[(riding?scooter.root:character.root).position.x,(riding?scooter.root:character.root).position.z],heading:riding?scooter.heading:character.root.rotation.y,radius:riding?carRadius:.5,halfLength:riding?carHalfLength:.5,riding,speed:riding?scooter.velocity:footSpeed}),onEvent:event=>{if(event==='alert')toast('Allerta · una pattuglia fittizia ti cerca.');if(event==='searching')toast('La pattuglia ha perso il contatto.');if(event==='escaped')toast('Hai seminato la pattuglia.');if(event==='caught'){scooter.velocity=0;toast('La pattuglia ti ha fermato. Inseguimento concluso.');}}});await traffic.ready;}
  if(map.city){encounter=createCityEncounter(scene,map.city,{canStand:traffic?.canStand??ambient?.canStand??world.canStand,shadows:world.shadows},{player:()=>({position:[character.root.position.x,character.root.position.z],heading:character.root.rotation.y,riding}),playerRoot:character.root,surfaceHeightAt,onIncident:()=>traffic?.reportIncident('assault'),onEvent:event=>{
    if(event==='started')toast('Scontro facoltativo · F colpisce. Puoi allontanarti.');
    if(event==='defeated')toast('Scontro concluso. Puoi continuare la storia.');
    if(event==='knocked-out'){if(restoreOpening())cam.snap(character.root.position,false);toast('Sei stato messo fuori combattimento. La storia è conservata.');}
  }});await encounter.ready;}
  addEventListener('keydown',event=>{
    const target=event.target as HTMLElement|null;
    if(event.code!=='KeyF'||event.repeat||event.ctrlKey||event.metaKey||event.altKey||target?.closest('input,select,textarea,[contenteditable]')||!started||paused||credits||dialogueOpen||riding)return;
    event.preventDefault();encounter?.attack();
  });
  if(riding){character.root.position.copyFrom(scooter.root.position);character.root.setEnabled(false);cam.snap(character.root.position,true);cam.update(character.root.position,1,true);}
  function persist(){if(!storeSave(save))toast('Salvataggio non disponibile in questo browser. La partita continua in memoria.');}
  function persistStory(){try{localStorage.setItem(STORY_SAVE_KEY,JSON.stringify(story));}catch{toast('Il prologo continuerà in memoria: salvataggio non disponibile.');}}
  function quality(){engine.setHardwareScalingLevel(1/Math.min(devicePixelRatio||1,save.quality==='alta'?1.5:1));scene.shadowsEnabled=save.quality==='alta';cam.effects.setQuality(save.quality);cityVisuals?.updateDetail([character.root.position.x,character.root.position.z],save.quality);}
  quality();
  el<HTMLInputElement>('volume').value=String(save.volume*100);el<HTMLSelectElement>('quality').value=save.quality;
  function pause(value:boolean){if(!started||credits)return;paused=value;if(value)narration.stop();input.clear();show('pause',value);if(value&&document.pointerLockElement)document.exitPointerLock();}
  async function resume(){paused=false;show('pause',false);audio.start();canvas.focus();await input.lock();}
  function distance(p:[number,number]){return Math.hypot(character.root.position.x-p[0],character.root.position.z-p[1]);}
  function nextAction():string {
    const stop=story.phase==='completed'?campaignStops[campaign.checkpoint]:undefined;
    if(stop&&distance(stop.position)<3.5)return riding?'Scendi per continuare la storia':'Continua la storia';
    if(story.phase==='available'&&distance(PICKUP)<3.5)return riding?'Scendi per parlare con Teresa':'Parla con Teresa';
    if(story.phase==='carrying'&&distance(DELIVERY)<3.5)return riding?'Scendi e controlla il telefono':'Controlla il telefono alla banchina';
    if(story.phase==='return'&&distance(PICKUP)<3.5)return riding?'Scendi e torna da Teresa':story.choice?'Conferma la decisione con Teresa':'Decidi di chi fidarti';
    if(riding)return Math.abs(scooter.velocity)<1?'Scendi dall’auto':'Frena per scendere';
    if(Vector3.Distance(character.root.position,scooter.root.position)<Math.max(2.7,carHalfLength+.9))return 'Sali in auto';
    return '';
  }
  function drawDialogue(){
    const line=dialogueLines[dialogueIndex];
    el('dialogue-speaker').textContent=line?.speaker??'La tua decisione';
    el('dialogue-text').textContent=line?.text??'A chi affidi il telefono di Ada? La scelta cambia il tuo contatto e la ricompensa del prologo.';
    if(line)narration.speak(line.speaker,line.text);else narration.stop();
    show('dialogue-choices',!line&&dialogueChoice);show('dialogue-next',!!line||!dialogueChoice);
    el('dialogue-next').firstChild!.textContent=line?'Continua ':'Torna al borgo ';
  }
  function openDialogue(lines:StoryLine[],choice=false){
    dialogueOpen=true;dialogueLines=lines;dialogueIndex=0;dialogueChoice=choice;input.clear();show('dialogue',true);drawDialogue();
    if(document.pointerLockElement)document.exitPointerLock();
  }
  function closeDialogue(){narration.stop();dialogueOpen=false;show('dialogue',false);void resume();}
  el('dialogue-next').onclick=()=>{if(dialogueIndex+1<dialogueLines.length){dialogueIndex++;drawDialogue();}else if(dialogueChoice&&dialogueIndex<dialogueLines.length){dialogueIndex=dialogueLines.length;drawDialogue();}else closeDialogue();};
  el('choose-protect').onclick=()=>{story=reduceStory(story,'choose-protect');persistStory();closeDialogue();toast('Hai scelto di proteggere la prova. Torna da Teresa.');};
  el('choose-negotiate').onclick=()=>{story=reduceStory(story,'choose-negotiate');persistStory();traffic?.reportIncident('mission');closeDialogue();toast('Hai aperto una trattativa. Torna da Teresa.');};
  function exitScooter(){
    if(Math.abs(scooter.velocity)>1){toast('Fermati prima di scendere.');return;}
    const point=findPlayerBesideVehicle(scooter.root.position,scooter.heading,{radius:carRadius,halfLength:carHalfLength},encounter?.canStand??traffic?.canStand??ambient?.canStand??world.canStand,undefined,.55);
    if(point){riding=false;character.root.setEnabled(true);scooter.velocity=0;character.root.position.set(point[0],surfaceHeightAt(...point),point[1]);character.root.rotation.y=scooter.heading;return;}
    toast('Qui non c’è spazio per scendere. Sposta l’auto o premi R.');
  }
  input.onInteract=()=>{
    if(!started||paused||credits||dialogueOpen||performance.now()-lastInteraction<200)return;lastInteraction=performance.now();
    if(riding){exitScooter();return;}
    if(story.phase==='completed'){const stop=campaignStops[campaign.checkpoint];const next=advanceCampaign(campaign,campaignStops,[character.root.position.x,character.root.position.z],false);if(next!==campaign&&stop){campaign=next;try{localStorage.setItem(CAMPAIGN_SAVE_KEY,JSON.stringify(campaign));}catch{toast('La campagna continua in memoria.');}openDialogue(stop.dialogue);if(stop.reward)toast(`Incarico completato · +${stop.reward} €`);return;}}
    const oldStory=story;
    if(story.phase==='available'&&distance(PICKUP)<3.5){
      story=reduceStory(story,'interact-bar');persistStory();openDialogue([...storyDialogue(oldStory),...storyDialogue(story)]);return;
    }
    if(story.phase==='carrying'&&distance(DELIVERY)<3.5){story=reduceStory(story,'interact-quay');persistStory();openDialogue(storyDialogue(story),true);return;}
    if(story.phase==='return'&&distance(PICKUP)<3.5){
      if(!story.choice){openDialogue(storyDialogue(story),true);return;}
      story=reduceStory(story,'interact-bar');persistStory();openDialogue(storyDialogue(story));toast(`Prologo completato · +${story.coins} €`);return;
    }
    if(Vector3.Distance(character.root.position,scooter.root.position)<Math.max(2.7,carHalfLength+.9)){riding=true;scooter.velocity=0;scooter.heading=scooter.root.rotation.y;toast('W accelera · S frena / retromarcia · A/D sterza · E scendi');}
  };
  function restoreOpening(){
    const ground=encounter?.canStand??traffic?.canStand??ambient?.canStand??world.canStand;
    try{
      const clear=map.city?placeVehicleOnStreet(openingStreetData(map.city),ground,{radius:carRadius,halfLength:carHalfLength}):{car:scooterPoint,player:spawn,heading:initialHeading};
      if(!ground(clear.player[0],clear.player[1],.55)||!canStandForCar({x:clear.car[0],z:clear.car[1]},clear.heading,ground,carRadius,carHalfLength))return false;
      scooter.root.position.set(clear.car[0],surfaceHeightAt(...clear.car),clear.car[1]);scooter.heading=clear.heading;scooter.velocity=0;settleCar();
      character.root.position.set(clear.player[0],surfaceHeightAt(...clear.player),clear.player[1]);character.root.rotation.y=clear.heading;return true;
    }catch{return false;}
  }
  function recover(){
    if(!started||paused||credits||dialogueOpen)return;
    if(riding){if(!restoreOpening()){toast('Il punto di recupero è occupato. Attendi che il traffico passi.');return;}character.root.position.copyFrom(scooter.root.position);cam.snap(character.root.position,riding);}
    else {let found=false;for(let radius=2;radius<=5&&!found;radius++)for(let a=0;a<Math.PI*2;a+=Math.PI/4){const p=character.root.position.add(new Vector3(Math.sin(a)*radius,0,Math.cos(a)*radius));if(carCanStand(p.x,p.z,scooter.heading)&&!vehicleBlocksPoint(character.root.position,p,scooter.heading,carRadius,carHalfLength,.55)){scooter.root.position.set(p.x,surfaceHeightAt(p.x,p.z),p.z);scooter.velocity=0;found=true;break;}}if(!found){if(!restoreOpening()){toast('Non c’è un punto libero per il recupero. Attendi il traffico.');return;}cam.snap(character.root.position,false);}}
    settleCar();toast('Auto recuperata in un punto sicuro.');
  }
  input.onRecover=recover;input.onPause=()=>{if(dialogueOpen)return;if(credits){closeCredits();return;}pause(!paused);};input.onBlur=()=>{if(started&&!paused&&!credits&&!dialogueOpen)pause(true);};input.onLook=(x,y)=>{if(started&&!paused&&!credits&&!dialogueOpen)cam.rotate(x,y);};
  // Drag to orbit if pointer lock is unavailable or declined.
  let dragging=false;canvas.addEventListener('pointerdown',()=>{dragging=true;if(started&&!paused&&!document.pointerLockElement)toast('Trascina il mouse per ruotare la visuale.');});addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointermove',e=>{if(dragging&&!document.pointerLockElement&&started&&!paused&&!dialogueOpen)cam.rotate(e.movementX,e.movementY);});
  el('play').onclick=()=>{started=true;document.body.classList.add('playing');show('start',false);show('hud',true);show('pause-button',true);cam.snap(character.root.position,riding);void resume();toast(map.city?'WASD guida · E scendi dall’auto. Teresa ti aspetta al bar.':'Luca, Teresa ti aspetta al bar. Segui il segnale sulla mappa.');};
  el('pause-button').onclick=()=>{if(!dialogueOpen)pause(true);};el('resume').onclick=()=>void resume();
  el<HTMLInputElement>('volume').oninput=e=>{save.volume=Number((e.target as HTMLInputElement).value)/100;persist();};
  el<HTMLSelectElement>('quality').onchange=e=>{save.quality=(e.target as HTMLSelectElement).value as Save['quality'];quality();persist();};
  let resetArmed=false;
  el('reset').onclick=()=>{if(!resetArmed){resetArmed=true;el('reset').textContent='Conferma: azzera storia e monete';return;}if(!restoreOpening()){toast('Il punto iniziale è occupato. Attendi il traffico prima del ripristino.');return;}save=defaults();persist();story=initialStory();persistStory();campaign=initialCampaign();try{localStorage.removeItem(CAMPAIGN_SAVE_KEY);}catch{}traffic?.pursuit.reset();narration.stop();riding=false;character.root.setEnabled(true);scooter.velocity=0;settleCar();cam.snap(character.root.position,riding);quality();el<HTMLInputElement>('volume').value='25';el<HTMLSelectElement>('quality').value='alta';el('reset').textContent='Ripristina partita';resetArmed=false;toast('Partita ripristinata.');};
  function closeCredits(){credits=false;show('credits',false);if(started){paused=true;show('pause',true);}}
  el('credits-button').onclick=()=>{if(dialogueOpen)return;if(started)pause(true);credits=true;show('pause',false);show('credits',true);};el('close-credits').onclick=closeCredits;
  function carCanStand(x:number,z:number,heading:number){const ground=encounter?.canStand??traffic?.canStand??ambient?.canStand??world.canStand;return map.city?canStandForCar({x,z},heading,ground,carRadius,carHalfLength):ground(x,z,carRadius);}
  function canWalk(x:number,z:number,radius:number){return (encounter?.canStand(x,z,radius)??traffic?.canStand(x,z,radius)??ambient?.canStand(x,z,radius)??world.canStand(x,z,radius))&&!vehicleBlocksPoint({x,z},scooter.root.position,scooter.heading,carRadius,carHalfLength,radius);}
  function move(delta:Vector3,radius:number):boolean {
    const pos=riding?scooter.root.position:character.root.position;
    return moveOnGround(pos,{x:delta.x,z:delta.z},radius,riding?((x,z)=>carCanStand(x,z,scooter.heading)):canWalk,!riding).collision;
  }
  engine.runRenderLoop(()=>{
    const dt=Math.min(engine.getDeltaTime()/1000,.04);time+=dt;
    if(started&&!paused&&!credits&&!dialogueOpen){
      const forward=input.axis(['KeyW','ArrowUp'],['KeyS','ArrowDown']);const turn=input.axis(['KeyD','ArrowRight'],['KeyA','ArrowLeft']);
      if(riding){
        scooter.velocity=stepVelocity(scooter.velocity,forward,dt);
        const proposed=scooter.heading+turn*dt*1.65*Math.min(Math.abs(scooter.velocity)/2,1)*Math.sign(scooter.velocity);
        if(carCanStand(scooter.root.position.x,scooter.root.position.z,proposed)){scooter.heading=proposed;scooter.root.rotation.y=proposed;}
        const d=new Vector3(Math.sin(scooter.heading)*scooter.velocity*dt,0,Math.cos(scooter.heading)*scooter.velocity*dt);
        const impactSpeed=Math.abs(scooter.velocity);
        if(move(d,carRadius)){if(impactSpeed>3&&traffic?.actors.some(actor=>trafficCapsulesOverlap({position:[scooter.root.position.x,scooter.root.position.z],heading:scooter.heading,radius:carRadius,halfLength:carHalfLength},actor,.35)))traffic.reportIncident('collision');scooter.velocity=0;}
        settleCar();
        scooter.wheels.forEach(w=>w.rotation.x+=scooter.velocity*dt*3.5);
        character.root.position.copyFrom(scooter.root.position);character.root.rotation.y=scooter.heading;character.root.setEnabled(false);
        lastMove=Math.abs(scooter.velocity)>.1;
      }else {
        character.root.setEnabled(true);const footBefore=character.root.position.clone();
        const direction=walkingDirection(cam.yaw,forward,turn);const d=new Vector3(direction.x,0,direction.z);
        lastMove=d.lengthSquared()>0;
        if(lastMove){d.normalize().scaleInPlace((input.keys.has('ShiftLeft')||input.keys.has('ShiftRight')?5.5:3.1)*dt);move(d,.5);character.root.rotation.y=Math.atan2(d.x,d.z);}character.root.position.y=surfaceHeightAt(character.root.position.x,character.root.position.z);footSpeed=Math.hypot(character.root.position.x-footBefore.x,character.root.position.z-footBefore.z)/Math.max(dt,.001);
      }
      if(!Number.isFinite(character.root.position.x)||!world.canStand(character.root.position.x,character.root.position.z,.1)){
        character.root.position.set(spawn[0],surfaceHeightAt(...spawn),spawn[1]);riding=false;character.root.setEnabled(true);scooter.velocity=0;cam.snap(character.root.position,riding);toast('Sei tornato sulla banchina in sicurezza.');
      }
      character.animate(time,lastMove,riding);cam.update(character.root.position,dt,riding);ambient?.update(dt,time);traffic?.update(dt,time);encounter?.update(dt,time);
    }
    const stop=story.phase==='completed'?campaignStops[campaign.checkpoint]:undefined;
    campaignMarker.setEnabled(!!stop);if(stop){campaignMarker.position.set(stop.position[0],surfaceHeightAt(...stop.position)+3.6+Math.sin(time*2)*.2,stop.position[1]);campaignMarker.rotation.y=time*.6;}
    const wanted=traffic?.pursuit.state;const alert=el('traffic-alert');alert.classList.toggle('hidden',!wanted?.level);alert.textContent=wanted?.level?`${'★'.repeat(wanted.level)} ${wanted.mode==='search'?'RICERCA':'INSEGUIMENTO'}`:'';
    const fight=encounter?.state,combat=el('encounter-status');combat.classList.toggle('hidden',!fight||fight.phase!=='active');combat.textContent=fight?.phase==='active'?`SALUTE ${fight.playerHealth} · FIATO ${Math.round(fight.stamina)} · RIVALE ${fight.opponentHealth} · F COLPISCE`:'';
    character.parcel.setEnabled(story.phase==='carrying'||story.phase==='return');
    world.beacons.forEach((b,i)=>{b.setEnabled(i===0?(story.phase==='available'||story.phase==='return'):story.phase==='carrying');b.position.y=surfaceHeightAt(b.position.x,b.position.z)+3.6+Math.sin(time*2)*.2;b.rotation.y=time*.6;});
    world.sea.setFloat('time',time);
    audio.update(save.volume,riding,scooter.velocity,paused||!started||credits||dialogueOpen);
    if(started&&(hudTime+=dt)>.08){hudTime=0;updateHUD({...save,coins:save.coins+campaignReward(campaign,campaignStops)},character.root.position.x,character.root.position.z,character.root.rotation.y,riding,scooter.velocity,nextAction(),map,story,stop?{title:stop.act,objective:stop.objective,target:stop.position,label:stop.label}:undefined);}
    cityVisuals?.updateDetail([cam.camera.position.x,cam.camera.position.z],save.quality);
    scene.render();
  });
  addEventListener('resize',()=>engine.resize());
  engine.onContextLostObservable.add(()=>{pause(true);toast('La grafica è stata interrotta. Attendi il ripristino o ricarica la pagina.');});
  await scene.whenReadyAsync();show('loading',false);show('start',true);
  // Read-only diagnostics help verify the actual scene without a gameplay bypass.
  if(import.meta.env.DEV)(window as unknown as {__napoli:unknown}).__napoli={scene,world,character,scooter,traffic,encounter,campaignStops,get campaign(){return campaign;},get save(){return save;},get story(){return story;},get riding(){return riding;},get paused(){return paused;}};
}
boot().catch(error=>{console.error(error);show('loading',false);show('error',true);el('error-text').textContent=error instanceof Error?error.message:'Si è verificato un errore. Ricarica la pagina.';});
