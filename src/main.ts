import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/libre-caslon-display/latin-400.css';
import './style.css';
import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {createWorld} from './world';
import {createCharacter} from './character';
import {createScooter,stepVelocity} from './vehicle';
import {createCamera} from './camera';
import {Input} from './input';
import {Audio} from './audio';
import {loadSave,storeSave,defaults,type Save} from './save';
import {PICKUP,DELIVERY} from './mission';
import {initialStory,reduceStory,decodeStory,storyDialogue,STORY_SAVE_KEY,type StoryState,type StoryLine} from './story';
import {el,show,toast,updateHUD} from './ui';
import type {MapData} from './geo';
async function boot(){
  const response=await fetch(`${import.meta.env.BASE_URL}data/map.json`);if(!response.ok)throw Error('I dati della scena non sono disponibili. Ricarica la pagina.');
  const map=await response.json() as MapData;
  const canvas=el<HTMLCanvasElement>('game');
  if(!Engine.isSupported())throw Error('Il browser non supporta WebGL. Prova un browser aggiornato con accelerazione grafica attiva.');
  const engine=new Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true,powerPreference:'high-performance'});
  const scene=new Scene(engine),world=createWorld(scene,map),character=createCharacter(scene),scooter=createScooter(scene),cam=createCamera(scene),input=new Input(canvas),audio=new Audio();
  character.root.getChildMeshes().forEach(m=>world.shadows.addShadowCaster(m));scooter.root.getChildMeshes().forEach(m=>world.shadows.addShadowCaster(m));
  character.root.position.set(20,0,58);character.root.rotation.y=Math.PI;
  let story:StoryState;try{story=decodeStory(localStorage.getItem(STORY_SAVE_KEY));}catch{story=initialStory();}
  let dialogueOpen=false,dialogueLines:StoryLine[]=[],dialogueIndex=0,dialogueChoice=false;
  let save:Save=loadSave(),started=false,paused=false,riding=false,credits=false,time=0,hudTime=0,lastMove=false,lastInteraction=0;
  function persist(){if(!storeSave(save))toast('Salvataggio non disponibile in questo browser. La partita continua in memoria.');}
  function persistStory(){try{localStorage.setItem(STORY_SAVE_KEY,JSON.stringify(story));}catch{toast('Il prologo continuerà in memoria: salvataggio non disponibile.');}}
  function quality(){engine.setHardwareScalingLevel(1/Math.min(devicePixelRatio||1,save.quality==='alta'?1.5:1));scene.shadowsEnabled=save.quality==='alta';}
  quality();
  el<HTMLInputElement>('volume').value=String(save.volume*100);el<HTMLSelectElement>('quality').value=save.quality;
  function pause(value:boolean){if(!started||credits)return;paused=value;input.clear();show('pause',value);if(value&&document.pointerLockElement)document.exitPointerLock();}
  async function resume(){paused=false;show('pause',false);audio.start();canvas.focus();await input.lock();}
  function distance(p:[number,number]){return Math.hypot(character.root.position.x-p[0],character.root.position.z-p[1]);}
  function nextAction():string {
    if(story.phase==='available'&&distance(PICKUP)<3.5)return riding?'Scendi per parlare con Teresa':'Parla con Teresa';
    if(story.phase==='carrying'&&distance(DELIVERY)<3.5)return riding?'Scendi e controlla il telefono':'Controlla il telefono alla banchina';
    if(story.phase==='return'&&distance(PICKUP)<3.5)return riding?'Scendi e torna da Teresa':story.choice?'Conferma la decisione con Teresa':'Decidi di chi fidarti';
    if(riding)return Math.abs(scooter.velocity)<1?'Scendi dal motorino':'Frena per scendere';
    if(Vector3.Distance(character.root.position,scooter.root.position)<2.7)return 'Sali sul motorino';
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
    for(const angle of [Math.PI/2,-Math.PI/2,Math.PI,0]){
      const p=scooter.root.position.add(new Vector3(Math.sin(scooter.heading+angle)*1.7,0,Math.cos(scooter.heading+angle)*1.7));
      if(world.canStand(p.x,p.z,.55)){riding=false;scooter.velocity=0;character.root.position.copyFrom(p);character.root.position.y=0;character.root.rotation.y=scooter.heading;return;}
    }toast('Qui non c’è spazio per scendere. Sposta il motorino o premi R.');
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
    if(Vector3.Distance(character.root.position,scooter.root.position)<2.7){riding=true;scooter.velocity=0;scooter.heading=scooter.root.rotation.y;toast('W accelera · S frena / retromarcia · A/D sterza · E scendi');}
  };
  function recover(){
    if(!started||paused||credits||dialogueOpen)return;
    if(riding){scooter.root.position.copyFrom(scooter.spawn);scooter.heading=Math.PI;scooter.root.rotation.y=Math.PI;character.root.position.copyFrom(scooter.spawn);scooter.velocity=0;cam.snap(character.root.position);}
    else {let found=false;for(let radius=2;radius<=5&&!found;radius++)for(let a=0;a<Math.PI*2;a+=Math.PI/4){const p=character.root.position.add(new Vector3(Math.sin(a)*radius,0,Math.cos(a)*radius));if(world.canStand(p.x,p.z,1)){scooter.root.position.set(p.x,0,p.z);scooter.velocity=0;found=true;break;}}if(!found){scooter.root.position.copyFrom(scooter.spawn);scooter.velocity=0;}}
    toast('Motorino recuperato in un punto sicuro.');
  }
  input.onRecover=recover;input.onPause=()=>{if(dialogueOpen)return;if(credits){closeCredits();return;}pause(!paused);};input.onBlur=()=>{if(started&&!paused&&!credits&&!dialogueOpen)pause(true);};input.onLook=(x,y)=>{if(started&&!paused&&!credits&&!dialogueOpen)cam.rotate(x,y);};
  // Drag to orbit if pointer lock is unavailable or declined.
  let dragging=false;canvas.addEventListener('pointerdown',()=>{dragging=true;if(started&&!paused&&!document.pointerLockElement)toast('Trascina il mouse per ruotare la visuale.');});addEventListener('pointerup',()=>dragging=false);canvas.addEventListener('pointermove',e=>{if(dragging&&!document.pointerLockElement&&started&&!paused&&!dialogueOpen)cam.rotate(e.movementX,e.movementY);});
  el('play').onclick=()=>{started=true;document.body.classList.add('playing');show('start',false);show('hud',true);show('pause-button',true);cam.snap(character.root.position);void resume();toast('Luca, Teresa ti aspetta al bar. Segui il segnale sulla mappa.');};
  el('pause-button').onclick=()=>{if(!dialogueOpen)pause(true);};el('resume').onclick=()=>void resume();
  el<HTMLInputElement>('volume').oninput=e=>{save.volume=Number((e.target as HTMLInputElement).value)/100;persist();};
  el<HTMLSelectElement>('quality').onchange=e=>{save.quality=(e.target as HTMLSelectElement).value as Save['quality'];quality();persist();};
  let resetArmed=false;
  el('reset').onclick=()=>{if(!resetArmed){resetArmed=true;el('reset').textContent='Conferma ripristino: azzera consegna e monete';return;}save=defaults();persist();story=initialStory();persistStory();riding=false;scooter.velocity=0;scooter.root.position.copyFrom(scooter.spawn);scooter.root.rotation.y=scooter.heading=Math.PI;character.root.position.set(20,0,58);cam.snap(character.root.position);quality();el<HTMLInputElement>('volume').value='25';el<HTMLSelectElement>('quality').value='alta';el('reset').textContent='Ripristina partita';resetArmed=false;toast('Partita ripristinata.');};
  function closeCredits(){credits=false;show('credits',false);if(started){paused=true;show('pause',true);}}
  el('credits-button').onclick=()=>{if(dialogueOpen)return;if(started)pause(true);credits=true;show('pause',false);show('credits',true);};el('close-credits').onclick=closeCredits;
  function move(delta:Vector3,radius:number):boolean {
    const pos=riding?scooter.root.position:character.root.position;
    const n=Math.max(1,Math.ceil(delta.length()/.2));const d=delta.scale(1/n);let collision=false;
    for(let i=0;i<n;i++){
      if(world.canStand(pos.x+d.x,pos.z+d.z,radius)){pos.x+=d.x;pos.z+=d.z;}
      else {collision=true;if(!riding){if(world.canStand(pos.x+d.x,pos.z,radius))pos.x+=d.x;if(world.canStand(pos.x,pos.z+d.z,radius))pos.z+=d.z;}else break;}
    }return collision;
  }
  engine.runRenderLoop(()=>{
    const dt=Math.min(engine.getDeltaTime()/1000,.04);time+=dt;
    if(started&&!paused&&!credits&&!dialogueOpen){
      const forward=input.axis(['KeyW','ArrowUp'],['KeyS','ArrowDown']);const turn=input.axis(['KeyD','ArrowRight'],['KeyA','ArrowLeft']);
      if(riding){
        scooter.velocity=stepVelocity(scooter.velocity,forward,dt);
        const proposed=scooter.heading+turn*dt*1.65*Math.min(Math.abs(scooter.velocity)/2,1)*Math.sign(scooter.velocity);
        scooter.heading=proposed;scooter.root.rotation.y=proposed;
        const d=new Vector3(Math.sin(proposed)*scooter.velocity*dt,0,Math.cos(proposed)*scooter.velocity*dt);
        if(move(d,.93))scooter.velocity=0;
        scooter.wheels.forEach(w=>w.rotation.x+=scooter.velocity*dt*3.5);
        character.root.position.copyFrom(scooter.root.position);character.root.position.y=.45;character.root.rotation.y=proposed;
        lastMove=Math.abs(scooter.velocity)>.1;
      }else {
        const f=cam.yaw+Math.PI;const d=new Vector3(Math.sin(f)*forward-Math.cos(f)*turn,0,Math.cos(f)*forward+Math.sin(f)*turn);
        lastMove=d.lengthSquared()>0;
        if(lastMove){d.normalize().scaleInPlace((input.keys.has('ShiftLeft')||input.keys.has('ShiftRight')?5.5:3.1)*dt);move(d,.5);character.root.rotation.y=Math.atan2(d.x,d.z);}character.root.position.y=0;
      }
      if(!Number.isFinite(character.root.position.x)||!world.canStand(character.root.position.x,character.root.position.z,.1)){
        character.root.position.set(20,0,58);riding=false;scooter.velocity=0;cam.snap(character.root.position);toast('Sei tornato sulla banchina in sicurezza.');
      }
      character.animate(time,lastMove,riding);cam.update(character.root.position,dt,riding);
    }
    character.parcel.setEnabled(story.phase==='carrying'||story.phase==='return');
    world.beacons.forEach((b,i)=>{b.setEnabled(i===0?(story.phase==='available'||story.phase==='return'):story.phase==='carrying');b.position.y=3.6+Math.sin(time*2)*.2;b.rotation.y=time*.6;});
    world.sea.setFloat('time',time);
    audio.update(save.volume,riding,scooter.velocity,paused||!started||credits||dialogueOpen);
    if(started&&(hudTime+=dt)>.08){hudTime=0;updateHUD(save,character.root.position.x,character.root.position.z,character.root.rotation.y,riding,scooter.velocity,nextAction(),map,story);}
    scene.render();
  });
  addEventListener('resize',()=>engine.resize());
  engine.onContextLostObservable.add(()=>{pause(true);toast('La grafica è stata interrotta. Attendi il ripristino o ricarica la pagina.');});
  await scene.whenReadyAsync();show('loading',false);show('start',true);
  // Read-only diagnostics help verify the actual scene without a gameplay bypass.
  if(import.meta.env.DEV)(window as unknown as {__napoli:unknown}).__napoli={scene,world,character,scooter,get save(){return save;},get story(){return story;},get riding(){return riding;},get paused(){return paused;}};
}
boot().catch(error=>{console.error(error);show('loading',false);show('error',true);el('error-text').textContent=error instanceof Error?error.message:'Si è verificato un errore. Ricarica la pagina.';});
