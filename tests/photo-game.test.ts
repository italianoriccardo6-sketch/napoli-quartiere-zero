import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {CityMapData} from '../src/city-data';
import type {Point} from '../src/geo';
import {createPhotoGame,validatePhotoGameManifest,type PhotoGameResources} from '../src/photo-game';
import {createPhotorealCity,type PhotoLibrary} from '../src/photoreal-city';
import type {PhotoCamera,PhotoCoordinate} from '../src/photoreal-config';
import {createPhotoDrivingSimulation,localToPhotoCoordinate,photoHeadingDegrees} from '../src/photo-driving';
import {STORY_SAVE_KEY,type StoryState} from '../src/story';

// This double exercises the native SDK boundary; it does not pretend to render
// Google's imagery. All positions, physics, models and story below are real.
class ElementDouble extends EventTarget {
  style:Record<string,string>={};
  children=new Set<ElementDouble>();
  parent:ElementDouble|null=null;
  append(element:ElementDouble){element.remove();this.children.add(element);element.parent=this;}
  remove(){this.parent?.children.delete(this);this.parent=null;}
}
class MapDouble extends ElementDouble {
  center:PhotoCoordinate;heading:number;tilt:number;range:number;qualityMode='FIDELITY';
  cameras:{endCamera:PhotoCamera;durationMillis:number}[]=[];
  stops=0;
  constructor(options:Record<string,unknown>){super();this.center=options.center as PhotoCoordinate;this.heading=options.heading as number;this.tilt=options.tilt as number;this.range=options.range as number;}
  flyCameraTo(options:{endCamera:PhotoCamera;durationMillis:number}){this.cameras.push(structuredClone(options));Object.assign(this,options.endCamera);}
  stopCameraAnimation(){this.stops++;}
}
class ModelDouble extends ElementDouble {
  static created:ModelDouble[]=[];
  src:string;position:PhotoCoordinate;orientation:{heading:number;tilt:number;roll:number};initialOrientation:{heading:number;tilt:number;roll:number};altitudeMode:string;
  constructor(options:Record<string,unknown>){super();this.src=options.src as string;this.position=options.position as PhotoCoordinate;this.orientation=options.orientation as ModelDouble['orientation'];this.initialOrientation=structuredClone(this.orientation);this.altitudeMode=options.altitudeMode as string;ModelDouble.created.push(this);}
}
const library={Map3DElement:MapDouble,Model3DElement:ModelDouble} as unknown as PhotoLibrary;
const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
const resources:PhotoGameResources={map,models:validatePhotoGameManifest(JSON.parse(readFileSync('public/assets/photo-models/manifest.json','utf8')))};
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const still={forward:0,turn:0};

async function fixture(story?:StoryState,data:PhotoGameResources=resources){
  const previous=['document','location'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)] as const);
  Object.defineProperty(globalThis,'document',{configurable:true,value:{baseURI:'https://napoli.test/game/photoreal.html'}});
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'https://napoli.test'}});
  const restore=()=>{for(const [key,descriptor]of previous)if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);};
  ModelDouble.created=[];
  const storage=new Map<string,string>();if(story)storage.set(STORY_SAVE_KEY,JSON.stringify(story));
  try{
    const host=new ElementDouble();
    const city=await createPhotorealCity(host as unknown as HTMLElement,{apiKey:'AIza'+'a'.repeat(35),loadLibrary:async()=>library});
    const game=createPhotoGame(city,data,{base:'/game/',storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{storage.set(key,value);}}});
    return {city,game,host,native:city.map as unknown as MapDouble,models:[...ModelDouble.created],storage,close(){game.dispose();city.dispose();restore();}};
  }catch(error){restore();throw error;}
}

test('native map waits for SDK readiness and drives real car, first-person walking and rendered strikes',async()=>{
  const f=await fixture();
  try{
    let ready=false;const pending=f.city.whenSteady(1000).then(()=>{ready=true;});
    f.native.dispatchEvent(Object.assign(new Event('gmp-steadychange'),{isSteady:false}));await Promise.resolve();assert.equal(ready,false);
    f.native.dispatchEvent(Object.assign(new Event('gmp-steadychange'),{isSteady:true}));await pending;await f.city.whenSteady();
    assert.equal(f.host.children.has(f.native),true);
    const car=f.models.find(m=>new URL(m.src).pathname.endsWith('/car-white-core.glb'))!;
    const person=f.models.find(m=>new URL(m.src).pathname.endsWith('/civilian-standing-core.glb'))!;
    const hand=f.models.find(m=>new URL(m.src).pathname.endsWith('/hand-core.glb'))!;
    assert.ok(car&&person&&hand);assert.equal(car.parent,f.native);assert.equal(person.parent,null);assert.equal(hand.parent,null);
    for(const model of f.models){assert.equal(model.initialOrientation.tilt,270,'the native constructor receives the conversion from GLB Y-up to map Up');assert.equal(model.initialOrientation.roll,0);}
    const openingHeading=photoHeadingDegrees(f.game.driver.state.car.heading);assert.ok(Math.abs(car.initialOrientation.heading-(openingHeading+180)%360)<1e-8);assert.equal(f.native.cameras.at(-1)!.endCamera.heading,openingHeading,'the camera retains the simulation compass heading');
    assert.ok(f.game.traffic.actors.length>=2,'actual moving traffic is installed in the native scene');
    assert.equal(f.game.traffic.actors.filter(a=>a.role==='patrol').length,1);
    const start=f.game.driver.activePosition,carStart={...car.position},calls=f.native.cameras.length;
    for(let i=0;i<100;i++)f.game.update(.01,{forward:1,turn:0});
    assert.ok(distance(start,f.game.driver.activePosition)>1,'W moves the actual source-constrained controller');
    assert.notDeepEqual(car.position,carStart,'the native car follows the controller');
    assert.equal(f.game.view().speed,f.game.driver.state.car.speed);
    const sent=f.native.cameras.slice(calls);assert.ok(sent.length>=29&&sent.length<=30,`ground following is capped at 30 camera updates per second; got ${sent.length}`);
    for(const camera of sent){assert.equal(camera.endCamera.altitudeMode,'RELATIVE_TO_GROUND');assert.equal(camera.durationMillis,0);assert.equal(camera.endCamera.range,12);}
    assert.deepEqual(car.position,localToPhotoCoordinate(f.game.driver.state.car.position,0));
    const beforeTurn=f.game.driver.state.car.heading;for(let i=0;i<20;i++)f.game.update(.01,{forward:1,turn:.5});
    assert.ok(Math.abs(f.game.driver.state.car.heading-beforeTurn)>.02,'actual steering changes the car orientation');
    assert.equal(car.orientation.tilt,270);assert.equal(car.orientation.roll,0);assert.ok(Math.abs(((car.orientation.heading-f.native.cameras.at(-1)!.endCamera.heading+360)%360)-180)<1e-8,'later model poses preserve the frame correction without rotating the camera');
    f.game.interact();assert.equal(f.game.view().mode,'car','E cannot exit a moving vehicle');
    f.game.setPaused(true);const parked=f.game.driver.activePosition;
    for(let i=0;i<10;i++)f.game.update(.05,{forward:1,turn:1});assert.deepEqual(f.game.driver.activePosition,parked);
    f.game.setPaused(false);f.game.interact();assert.equal(f.game.view().mode,'foot');
    f.game.update(.05,still);assert.equal(person.parent,null,'the first person view does not place the player mesh over the camera');
    assert.equal(f.native.cameras.at(-1)!.endCamera.range,3);assert.equal(f.native.cameras.at(-1)!.endCamera.center.altitude,1.5);
    const beforeHeading=f.game.driver.state.viewHeading;f.game.update(.1,{...still,orbit:1});
    const expected=photoHeadingDegrees(beforeHeading+.12);assert.ok(Math.abs(f.native.cameras.at(-1)!.endCamera.heading-expected)<1e-8,'foot camera orbit is applied once');
    assert.equal(f.game.attack(),true);f.game.update(.05,still);assert.equal(hand.parent,f.native,'F shows the actual manifest hand model');
    const firstHand={...hand.position};f.game.update(.1,still);assert.notDeepEqual(hand.position,firstHand,'strike animation changes the native hand pose');
    for(let i=0;i<5;i++)f.game.update(.1,still);assert.equal(hand.parent,null,'finished strikes remove the hand from the native map');
    f.game.toggleView();assert.equal(person.parent,f.native);assert.equal(f.native.cameras.at(-1)!.endCamera.range,5.5);
    const frozen=f.game.driver.activePosition;f.game.setPlaying(false);const freeCalls=f.native.cameras.length;
    f.game.update(.1,{forward:1,turn:1});assert.deepEqual(f.game.driver.activePosition,frozen);assert.equal(f.native.cameras.length,freeCalls,'free exploration does not fight a second camera controller');
    f.game.dispose();assert.equal(f.native.children.size,0,'all owned models are removed');f.city.dispose();assert.equal(f.host.children.size,0);
  }finally{f.close();}
});

test('first person strikes aim where the rendered hand faces after actual sideways walking',async()=>{
  const f=await fixture();
  try{
    const encounter=f.game.encounter;assert.ok(encounter,'a real source-clear encounter is present');
    let heading=0,start:Point|undefined;
    for(let i=0;i<8;i++){
      heading=i*Math.PI/4;
      const candidate:Point=[encounter.state.position[0]-Math.sin(heading)*1.5,encounter.state.position[1]-Math.cos(heading)*1.5];
      if(f.game.driver.canWalk(...candidate,.5)){start=candidate;break;}
    }
    assert.ok(start);f.game.driver.state.mode='foot';f.game.driver.state.player.position=start;f.game.driver.state.player.heading=heading;f.game.driver.state.viewHeading=heading;
    f.game.update(.02,{forward:0,turn:1});
    assert.ok(distance(start,f.game.driver.activePosition)>.04,'the actual controller strafes before the punch');
    assert.ok(Math.abs(f.game.driver.state.player.heading-heading)>1,'movement now faces sideways while the camera stays aimed at the opponent');
    assert.equal(f.game.attack(),true);for(let i=0;i<5;i++)f.game.update(.04,still);
    assert.equal(encounter.state.opponentHealth,75,'the visible forward strike hits the opponent in front of the camera');
    assert.ok(f.game.view().wanted>0,'a real successful strike starts the real patrol incident');
  }finally{f.close();}
});

test('native scene readiness resets after travel and disposal cancels pending SDK waits',async()=>{
  const f=await fixture();
  try{
    f.native.dispatchEvent(Object.assign(new Event('gmp-steadychange'),{isSteady:true}));await f.city.whenSteady();
    f.city.markSceneChanging();let status='pending';
    const ready=f.city.whenSteady(1000).then(()=>{status='ready';});await Promise.resolve();assert.equal(status,'pending','the previous scene cannot certify a new destination');
    f.native.dispatchEvent(Object.assign(new Event('gmp-steadychange'),{isSteady:false}));await Promise.resolve();assert.equal(status,'pending');
    f.native.dispatchEvent(Object.assign(new Event('gmp-steadychange'),{isSteady:true}));await ready;assert.equal(status,'ready');
    f.city.markSceneChanging();let cancelled=false;
    const closed=f.city.whenSteady(100).then(()=>{throw Error('A disposed scene cannot become ready.');},()=>{cancelled=true;});
    f.city.dispose();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(cancelled,true,'disposal cancels pending readiness without waiting for the network timeout');await closed;
    await assert.rejects(f.city.whenSteady(100),'a disposed map refuses new readiness waits');
  }finally{f.close();}
});

/** Begin with an existing save and walk the actual final source route segment. */
function walkToInteraction(game:ReturnType<typeof createPhotoGame>,target:Point,previous:Point){
  const span=distance(previous,target),start:Point=[target[0]+(previous[0]-target[0])*8/span,target[1]+(previous[1]-target[1])*8/span];
  game.driver.state.mode='foot';game.driver.state.player.position=start;game.driver.state.viewHeading=0;game.driver.state.player.heading=Math.atan2(target[0]-start[0],target[1]-start[1]);
  assert.equal(game.driver.canWalk(...start,.5),true,'saved route approach is source clear');
  const before=game.driver.state.travelled;
  for(let i=0;i<120&&distance(game.driver.activePosition,target)>.2;i++){
    const point=game.driver.activePosition,dx=target[0]-point[0],dz=target[1]-point[1],remaining=Math.hypot(dx,dz);
    game.update(Math.min(.04,remaining/5.5),{forward:dz/remaining,turn:dx/remaining,run:true});
  }
  assert.ok(distance(game.driver.activePosition,target)<.3,'the controller reaches the real interaction point on foot');assert.ok(game.driver.state.travelled-before>7.5);
}

test('photographic controller completes a saved phone delivery and persists the actual story choice and reward',async()=>{
  const f=await fixture({version:1,phase:'carrying',choice:null,coins:0});
  try{
    assert.match(f.game.view().objective,/telefono/);const route=map.city!.route;
    walkToInteraction(f.game,map.city!.delivery,route.at(-2)!);f.game.interact();
    assert.equal(JSON.parse(f.storage.get(STORY_SAVE_KEY)!).phase,'return');assert.ok(f.game.view().dialogue);
    for(let i=0;i<10&&!f.game.view().dialogue?.choice;i++)f.game.interact();assert.equal(f.game.view().dialogue?.choice,true);
    const held=f.game.driver.activePosition;f.game.update(.1,{forward:1,turn:0});assert.deepEqual(f.game.driver.activePosition,held,'dialogue holds movement');
    f.game.choose('protect');assert.equal(f.game.view().dialogue,null);assert.equal(JSON.parse(f.storage.get(STORY_SAVE_KEY)!).choice,'protect');assert.equal(f.game.view().coins,0,'payment waits for the return to Teresa');
    walkToInteraction(f.game,map.city!.pickup,route[1]);f.game.interact();
    const saved=JSON.parse(f.storage.get(STORY_SAVE_KEY)!);assert.equal(saved.phase,'completed');assert.equal(saved.coins,25);assert.equal(f.game.view().coins,25);
    for(let i=0;i<6;i++)f.game.interact();assert.equal(f.game.view().coins,25,'repeat interactions do not duplicate the story reward');
    const restored=JSON.parse(f.storage.get(STORY_SAVE_KEY)!);assert.equal(restored.phase,'completed');assert.equal(restored.choice,'protect');
  }finally{f.close();}
});

test('explicit travel preserves story and respects dialogue and pursuit while pause freezes active controls',async()=>{
  const opening=createPhotoDrivingSimulation(map),heading=opening.state.car.heading,start=opening.state.car.position;
  const arrival:Point=[start[0]+Math.sin(heading)*4,start[1]+Math.cos(heading)*4];
  const district={name:'Source route test arrival',position:arrival,drive:{position:arrival,heading,footPosition:arrival,roadName:'Via Partenope'},source:{label:'actual central OSM, test-only destination'}};
  const f=await fixture({version:1,phase:'carrying',choice:null,coins:0},{...resources,districts:[district]});
  try{
    f.game.setPaused(true);const paused=JSON.stringify(f.game.driver.state);f.game.interact();f.game.recover();assert.equal(f.game.attack(),false);
    f.game.update(.1,{forward:1,turn:1});assert.equal(JSON.stringify(f.game.driver.state),paused);
    assert.equal(f.game.travelTo(district.name),true,'a deliberate travel request can place the car while the scene loader holds pause');
    assert.deepEqual(f.game.driver.state.car.position,arrival);assert.equal(f.game.driver.state.travelled,0);assert.equal(f.game.view().paused,true);assert.equal(f.game.view().coins,0);
    assert.equal(JSON.parse(f.storage.get(STORY_SAVE_KEY)!).phase,'carrying');
    f.game.setPaused(false);walkToInteraction(f.game,map.city!.delivery,map.city!.route.at(-2)!);f.game.interact();
    const dialoguePosition=JSON.stringify(f.game.driver.state);assert.equal(f.game.travelTo(district.name),false);assert.equal(JSON.stringify(f.game.driver.state),dialoguePosition);assert.equal(f.game.attack(),false);
    for(let i=0;i<10&&!f.game.view().dialogue?.choice;i++)f.game.interact();
    f.game.setPaused(true);f.game.choose('negotiate');assert.equal(JSON.parse(f.storage.get(STORY_SAVE_KEY)!).choice,null,'a paused choice cannot silently commit');
    f.game.setPaused(false);f.game.setPlaying(false);f.game.choose('negotiate');assert.equal(JSON.parse(f.storage.get(STORY_SAVE_KEY)!).choice,null,'free exploration cannot commit a hidden dialogue choice');
    f.game.setPlaying(true);f.game.choose('negotiate');assert.equal(JSON.parse(f.storage.get(STORY_SAVE_KEY)!).choice,'negotiate');assert.ok(f.game.view().wanted>0);
    const pursued=JSON.stringify(f.game.driver.state);assert.equal(f.game.travelTo(district.name),false);assert.equal(JSON.stringify(f.game.driver.state),pursued,'travel cannot evade an active patrol or alter placement on refusal');
  }finally{f.close();}
});
