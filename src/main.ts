import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/libre-caslon-display/latin-400.css';
import './style.css';
import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {createWorld} from './world';
import {createDetailedCity} from './city-visuals';
import {createCar,canStandForCar} from './car';
import {placeVehicleOnStreet,vehicleBlocksPoint,findPlayerBesideVehicle} from './vehicle-placement';
import type {CityMapData} from './city-data';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {createCharacter} from './character';
import {createScooter,stepVelocity} from './vehicle';
import {createCamera} from './camera';
import {walkingDirection,moveOnGround} from './movement';
import {Input} from './input';
import {Audio} from './audio';
import {loadSave,storeSave,defaults,type Save} from './save';
import {PICKUP,DELIVERY} from './mission';
import {initialStory,reduceStory,decodeStory,storyDialogue,STORY_SAVE_KEY,type StoryState,type StoryLine} from './story';
import {el,show,toast,updateHUD,validateGameUI} from './ui';
import type {MapData} from './geo';
async function boot(){
  validateGameUI();
  const response=await fetch(`${import.meta.env.BASE_URL}data/map.json`);if(!response.ok)throw Error('I dati della scena non sono disponibili. Ricarica la pagina.');
  const map=await response.json() as CityMapData;
  if(map.city){PICKUP.splice(0,2,...map.city.pickup);DELIVERY.splice(0,2,...map.city.delivery);}
  const canvas=el<HTMLCanvasElement>('game');
  if(!Engine.isSupported())throw Error('Il browser non supporta WebGL. Prova un browser aggiornato con accelerazione grafica attiva.');
  const engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true,powerPreference:'high-performance'});
  const scene=new Scene(engine),cityVisuals=map.city?createDetailedCity(scene,map,map.city):undefined,world=cityVisuals??createWorld(scene,map),character=createCharacter(scene),scooter=map.city?createCar(scene):createScooter(scene),cam=createCamera(scene),input=new Input(canvas),audio=new Audio();
  await Promise.all([cityVisuals?.ready??Promise.resolve(),'ready' in scooter?scooter.ready:Promise.resolve()]);
  const carRadius='radius' in scooter?scooter.radius:.93,carHalfLength='halfLength' in scooter?scooter.halfLength:1.1;
  const placement=map.city?placeVehicleOnStreet(map.city,world.canStand,{radius:carRadius,halfLength:carHalfLength}):undefined;
  character.root.getChildMeshes().forEach(m=>world.shadows.addShadowCaster(m));scooter.root.getChildMeshes().forEach(m=>world.shadows.addShadowCaster(m));
  const spawn=placement?.player??[20,58],scooterPoint=placement?.car??[18,60];
  scooter.spawn.set(scooterPoint[0],0,scooterPoint[1]);scooter.root.position.copyFrom(scooter.spawn);
  character.root.position.set(spawn[0],0,spawn[1]);
  const initialHeading=placement?.heading??Math.atan2(PICKUP[0]-spawn[0],PICKUP[1]-spawn[1]);
  character.root.rotation.y=initialHeading;scooter.root.rotation.y=scooter.heading=initialHeading;
  if(map.city){
    cam.orient(initialHeading);cam.snap(character.root.position);
    for(const [i,p]of[PICKUP,DELIVERY].entries()){
      const material=new StandardMaterial('segnale missione '+i,scene);material.diffuseColor=Color3.FromHexString('#dfbd7f');material.emissiveColor=material.diffuseColor.scale(.3);
      const marker=MeshBuilder.CreateCylinder('punto di interazione '+i,{diameterTop:0,diameterBottom:.7,height:1.3,tessellation:4},scene);marker.position.set(p[0],3.6,p[1]);marker.rotation.z=Math.PI;marker.material=material;marker.isPickable=false;world.beacons.push(marker);
    }
  }
  let story:StoryState;try{story=decodeStory(localStorage.getItem(STORY_SAVE_KEY));}catch{story=initialStory();}
  let dialogueOpen=false,dialogueLines:StoryLine[]=[],dialogueIndex=0,dialogueChoice=false;
  let save:Save=loadSave(),started=false,paused=false,riding=false,credits=false,time=0,hudTime=0,lastMove=false,lastInteraction=0;
  function persist(){if(!storeSave(save))toast('Salvataggio non disponibile in questo browser. La partita continua in memoria.');}
  function persistStory(){try{localStorage.setItem(STORY_SAVE_KEY,JSON.stringify(story));}catch{toast('Il prologo continuerà in memoria: salvataggio non disponibile.');}}
  function quality(){engine.setHardwareScalingLevel(1/Math.min(devicePixelRatio||1,save.quality==='alta'?1.5:1));scene.shadowsEnabled=save.quality==='alta';cityVisuals?.updateDetail([character.root.position.x,character.root.position.z],save.quality);}
  quality();
  el<HTMLInputElement>('volume').value=String(save.volume*100);el<HTMLSelectElement>('quality').value=save.quality;
  function pause(value:boolean){if(!started||credits)return;paused=value;input.clear();show('pause',value);if(value&&document.pointerLockElement)document.exitPointerLock();}
  async function resume(){paused=false;show('pause',false);audio.start();canvas.focus();await input.lock();}
  function distance(p:[number,number]){return Math.hypot(character.root.position.x-p[0],character.root.position.z-p[1]);}
  function nextAction():string {
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
    show('dialogue-choices',!line&&dialogueChoice);show('dialogue-next',!!line||!dialogueChoice);
    el('dialogue-next').firstChild!.textContent=line?'Continua ':'Torna al borgo ';
  }
  function openDialogue(lines:StoryLine[],choice=false){
    dialogueOpen=true;dialogueLines=lines;dialogueIndex=0;dialogueChoice=choice;input.clear();show('dialogue',true);drawDialogue();
    if(document.pointerLockElement)document.exitPointerLock();
  }
  function closeDialogue(){dialogueOpen=false;show('dialogue',false);void resume();}
  el('dialogue-next').onclick=()=>{if(dialogueIndex<dialogueLines.length){dialogueIndex++;drawDialogue();}else closeDialogue();};
  el('choose-protect').onclick=()=>{story=reduceStory(story,'choose-protect');persistStory();closeDialogue();toast('Hai scelto di proteggere la prova. Torna da Teresa.');};
  el('choose-negotiate').onclick=()=>{story=reduceStory(story,'choose-negotiate');persistStory();closeDialogue();toast('Hai aperto una trattativa. Torna da Teresa.');};
  function exitScooter(){
    if(Math.abs(scooter.velocity)>1){toast('Fermati prima di scendere.');return;}
    const point=findPlayerBesideVehicle(scooter.root.position,scooter.heading,{radius:carRadius,halfLength:carHalfLength},world.canStand,undefined,.55);
    if(point){riding=false;character.root.setEnabled(true);scooter.velocity=0;character.root.position.set(point[0],0,point[1]);character.root.rotation.y=scooter.heading;return;}
    toast('Qui non c’è spazio per scendere. Sposta l’auto o premi R.');
  }
  input.onInteract=()=>{
    if(!started||paused||credits||dialogueOpen||performance.now()-lastInteraction<200)return;lastInteraction=performance.now();
    if(riding){exitScooter();return;}
    const oldStory=story;
    if(story.phase==='available'&&distance(PICKUP)<3.5){
      story=reduceStory(story,'interact-bar');persistStory();openDialogue([...storyDialogue(oldStory),...storyDialogue(story)]);return;
    }
    if(story.phase==='carrying'&&distance(DELIVERY)<3.5){story=reduceStory(story,'interact-quay');persistStory();openDialogue(storyDialogue(story),true);return;}
    if(story.phase==='return'&&distance(PICKUP)<3.5){
      if(!story.choice){openDialogue(storyDialogue(story),true);return;}
      story=reduceStory(story,'interact-bar');persistStory();openDialogue(storyDialogue(story));toast(`Prologo completato · +${story.coins} monete`);return;
    }
    if(Vector3.Distance(character.root.position,scooter.root.position)<Math.max(2.7,carHalfLength+.9)){riding=true;scooter.velocity=0;scooter.heading=scooter.root.rotation.y;toast('W accelera · S frena / retromarcia · A/D sterza · E scendi');}
  };
  function recover(){
    if(!started||paused||credits||dialogueOpen)return;
    if(riding){scooter.root.position.copyFrom(scooter.spawn);scooter.heading=initialHeading;scooter.root.rotation.y=initialHeading;character.root.position.copyFrom(scooter.spawn);scooter.velocity=0;cam.snap(character.root.position);}
    else {let found=false;for(let radius=2;radius<=5&&!found;radius++)for(let a=0;a<Math.PI*2;a+=Math.PI/4){const p=character.root.position.add(new Vector3(Math.sin(a)*radius,0,Math.cos(a)*radius));if(carCanStand(p.x,p.z,scooter.heading)&&!vehicleBlocksPoint(character.root.position,p,scooter.heading,carRadius,carHalfLength,.55)){scooter.root.position.set(p.x,0,p.z);scooter.velocity=0;found=true;break;}}if(!found){scooter.root.position.copyFrom(scooter.spawn);scooter.root.rotation.y=scooter.heading=initialHeading;scooter.velocity=0;if(!canWalk(character.root.position.x,character.root.position.z,.5))character.root.position.set(spawn[0],0,spawn[1]);}}
    toast('Auto recuperata in un punto sicuro.');
  }
  input.onRecover=recover;input.onPause=()=>{if(dialogueOpen)return;if(credits){closeCredits();return;}pause(!paused);};input.onBlur=()=>{if(started&&!paused&&!credits&&!dialogueOpen)pause(true);};input.onLook=(x,y)=>{if(started&&!paused&&!credits&&!dialogueOpen)cam.rotate(x,y);};
  // Drag to orbit if pointer lock is unavailable or declined.
  let dragging=false;canvas.addEventListener('pointerdown',()=>{dragging=true;if(started&&!paused&&!document.pointerLockElement)toast('Trascina il mouse per ruotare la visuale.');});addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointermove',e=>{if(dragging&&!document.pointerLockElement&&started&&!paused&&!dialogueOpen)cam.rotate(e.movementX,e.movementY);});
  el('play').onclick=()=>{started=true;document.body.classList.add('playing');show('start',false);show('hud',true);show('pause-button',true);cam.snap(character.root.position);void resume();toast('Luca, Teresa ti aspetta al bar. Segui il segnale sulla mappa.');};
  el('pause-button').onclick=()=>{if(!dialogueOpen)pause(true);};el('resume').onclick=()=>void resume();
  el<HTMLInputElement>('volume').oninput=e=>{save.volume=Number((e.target as HTMLInputElement).value)/100;persist();};
  el<HTMLSelectElement>('quality').onchange=e=>{save.quality=(e.target as HTMLSelectElement).value as Save['quality'];quality();persist();};
  let resetArmed=false;
  el('reset').onclick=()=>{if(!resetArmed){resetArmed=true;el('reset').textContent='Conferma ripristino: azzera consegna e monete';return;}save=defaults();persist();story=initialStory();persistStory();riding=false;character.root.setEnabled(true);scooter.velocity=0;scooter.root.position.copyFrom(scooter.spawn);scooter.root.rotation.y=scooter.heading=initialHeading;character.root.position.set(spawn[0],0,spawn[1]);cam.snap(character.root.position);quality();el<HTMLInputElement>('volume').value='25';el<HTMLSelectElement>('quality').value='alta';el('reset').textContent='Ripristina partita';resetArmed=false;toast('Partita ripristinata.');};
  function closeCredits(){credits=false;show('credits',false);if(started){paused=true;show('pause',true);}}
  el('credits-button').onclick=()=>{if(dialogueOpen)return;if(started)pause(true);credits=true;show('pause',false);show('credits',true);};el('close-credits').onclick=closeCredits;
  function carCanStand(x:number,z:number,heading:number){return map.city?canStandForCar({x,z},heading,world.canStand,carRadius,carHalfLength):world.canStand(x,z,carRadius);}
  function canWalk(x:number,z:number,radius:number){return world.canStand(x,z,radius)&&!vehicleBlocksPoint({x,z},scooter.root.position,scooter.heading,carRadius,carHalfLength,radius);}
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
        if(move(d,carRadius))scooter.velocity=0;
        scooter.wheels.forEach(w=>w.rotation.x+=scooter.velocity*dt*3.5);
        character.root.position.copyFrom(scooter.root.position);character.root.position.y=0;character.root.rotation.y=scooter.heading;character.root.setEnabled(false);
        lastMove=Math.abs(scooter.velocity)>.1;
      }else {
        character.root.setEnabled(true);
        const direction=walkingDirection(cam.yaw,forward,turn);const d=new Vector3(direction.x,0,direction.z);
        lastMove=d.lengthSquared()>0;
        if(lastMove){d.normalize().scaleInPlace((input.keys.has('ShiftLeft')||input.keys.has('ShiftRight')?5.5:3.1)*dt);move(d,.5);character.root.rotation.y=Math.atan2(d.x,d.z);}character.root.position.y=0;
      }
      if(!Number.isFinite(character.root.position.x)||!world.canStand(character.root.position.x,character.root.position.z,.1)){
        character.root.position.set(spawn[0],0,spawn[1]);riding=false;character.root.setEnabled(true);scooter.velocity=0;cam.snap(character.root.position);toast('Sei tornato sulla banchina in sicurezza.');
      }
      character.animate(time,lastMove,riding);cam.update(character.root.position,dt,riding);
    }
    character.parcel.setEnabled(story.phase==='carrying'||story.phase==='return');
    world.beacons.forEach((b,i)=>{b.setEnabled(i===0?(story.phase==='available'||story.phase==='return'):story.phase==='carrying');b.position.y=3.6+Math.sin(time*2)*.2;b.rotation.y=time*.6;});
    world.sea.setFloat('time',time);
    audio.update(save.volume,riding,scooter.velocity,paused||!started||credits||dialogueOpen);
    if(started&&(hudTime+=dt)>.08){hudTime=0;updateHUD(save,character.root.position.x,character.root.position.z,character.root.rotation.y,riding,scooter.velocity,nextAction(),map,story);}
    cityVisuals?.updateDetail([cam.camera.position.x,cam.camera.position.z],save.quality);
    scene.render();
  });
  addEventListener('resize',()=>engine.resize());
  engine.onContextLostObservable.add(()=>{pause(true);toast('La grafica è stata interrotta. Attendi il ripristino o ricarica la pagina.');});
  await scene.whenReadyAsync();show('loading',false);show('start',true);
  // Read-only diagnostics help verify the actual scene without a gameplay bypass.
  if(import.meta.env.DEV)(window as unknown as {__napoli:unknown}).__napoli={scene,world,character,scooter,get save(){return save;},get story(){return story;},get riding(){return riding;},get paused(){return paused;}};
}
boot().catch(error=>{console.error(error);show('loading',false);show('error',true);el('error-text').textContent=error instanceof Error?error.message:'Si è verificato un errore. Ricarica la pagina.';});
