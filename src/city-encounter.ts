import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {createDetailedCharacter} from './character-model';
import type {CityRuntime} from './city-data';
import {segmentDistance,type Point} from './geo';
import {moveOnGround,type GroundCheck} from './movement';

export interface EncounterPlayer {position:Point;heading:number;riding:boolean}
export type EncounterEvent='started'|'player-hit'|'opponent-hit'|'defeated'|'knocked-out';
export interface EncounterOptions {
  player:()=>EncounterPlayer;
  /** The real licensed model root; required for an actual visible player strike. */
  playerRoot?:TransformNode;
  surfaceHeightAt?:(x:number,z:number)=>number;
  onIncident?:()=>void;
  onEvent?:(event:EncounterEvent)=>void;
}
export interface EncounterState {
  phase:'idle'|'active'|'defeated'|'knocked-out';position:Point;heading:number;
  playerHealth:number;opponentHealth:number;stamina:number;playerPunch:number;opponentPunch:number;
  punchesThrown:number;hits:number;opponentHits:number;travelled:number;playerAnimationAvailable:boolean;
}
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const canonical=(value:string)=>value.replace(/[^a-z0-9]/gi,'').toLowerCase();
const finitePlayer=(player:EncounterPlayer)=>player.position.length===2&&player.position.every(Number.isFinite)&&Number.isFinite(player.heading);
const routeDistance=(point:Point,route:Point[])=>{let d=Infinity;for(let i=1;i<route.length;i++)d=Math.min(d,segmentDistance(point,route[i-1],route[i]));return d;};
/** Select a free point on a source walking street, outside all quest interaction zones. */
export function planEncounterPoint(city:CityRuntime,ground:GroundCheck,anchor:Point):Point|undefined {
  const points:Point[]=[];
  for(const road of city.roads){
    if(!['footway','pedestrian','living_street'].includes(road.highway))continue;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],span=distance(a,b),count=Math.max(1,Math.ceil(span/4));
      for(let k=0;k<=count;k++){
        const point:Point=[a[0]+(b[0]-a[0])*k/count,a[1]+(b[1]-a[1])*k/count],d=distance(point,anchor);
        if(d<15||d>90||[city.pickup,city.delivery,city.spawn].some(p=>distance(p,point)<12)||routeDistance(point,city.route)<2.2)continue;
        if(ground(...point,.55)&&ground(point[0]+.8,point[1],.5)&&ground(point[0]-.8,point[1],.5)&&ground(point[0],point[1]+.8,.5)&&ground(point[0],point[1]-.8,.5))points.push(point);
      }
    }
  }
  points.sort((a,b)=>Math.abs(distance(a,anchor)-35)-Math.abs(distance(b,anchor)-35)||a[0]-b[0]||a[1]-b[1]);
  return points[0];
}
export function encounterLineClear(a:Point,b:Point,ground:GroundCheck):boolean {
  const count=Math.max(1,Math.ceil(distance(a,b)/.2));
  for(let i=1;i<count;i++){const t=i/count;if(!ground(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.12))return false;}
  return true;
}
export function encounterStrikeHits(origin:Point,heading:number,target:Point,ground:GroundCheck):boolean {
  const d=distance(origin,target);if(d>1.65||d<.15)return false;
  const dot=(Math.sin(heading)*(target[0]-origin[0])+Math.cos(heading)*(target[1]-origin[1]))/d;
  return dot>=.5&&encounterLineClear(origin,target,ground);
}

export function createEncounterSimulation(position:Point,ground:GroundCheck,options:EncounterOptions&{protectedPoints?:Point[];animationAvailable?:boolean}){
  const state:EncounterState={phase:'idle',position:[...position],heading:0,playerHealth:100,opponentHealth:100,stamina:100,playerPunch:-1,opponentPunch:-1,punchesThrown:0,hits:0,opponentHits:0,travelled:0,playerAnimationAvailable:options.animationAvailable??false};
  let playerCooldown=0,opponentCooldown=1.5,age=0,startedAt=0,playerStruck=false,opponentStruck=false;
  function start(){if(state.phase==='idle'){state.phase='active';startedAt=age;options.onEvent?.('started');}}
  function attack(){
    const player=options.player();
    if(!state.playerAnimationAvailable||!finitePlayer(player)||player.riding||state.phase==='defeated'||state.phase==='knocked-out'||playerCooldown>0||state.stamina<25)return false;
    state.stamina-=25;state.playerPunch=0;state.punchesThrown++;playerCooldown=.7;playerStruck=false;return true;
  }
  function update(dt:number){
    if(!Number.isFinite(dt)||dt<=0||dt>.25)return;
    const player=options.player();if(!finitePlayer(player))return;age+=dt;
    playerCooldown=Math.max(0,playerCooldown-dt);opponentCooldown=Math.max(0,opponentCooldown-dt);state.stamina=Math.min(100,state.stamina+dt*14);
    if(state.phase==='defeated'||state.phase==='knocked-out'){state.playerPunch=-1;state.opponentPunch=-1;return;}
    if(!player.riding&&distance(player.position,state.position)<8&&encounterLineClear(state.position,player.position,ground))start();
    if(state.playerPunch>=0){
      state.playerPunch+=dt;
      if(!playerStruck&&state.playerPunch>=.17){
        playerStruck=true;
        if(!player.riding&&encounterStrikeHits(player.position,player.heading,state.position,ground)){
          start();state.opponentHealth=Math.max(0,state.opponentHealth-25);state.hits++;options.onIncident?.();options.onEvent?.('opponent-hit');
          if(state.opponentHealth===0){state.phase='defeated';options.onEvent?.('defeated');return;}
        }
      }
      if(state.playerPunch>.45)state.playerPunch=-1;
    }
    if(state.phase!=='active'||player.riding)return;
    const d=distance(state.position,player.position);
    state.heading=Math.atan2(player.position[0]-state.position[0],player.position[1]-state.position[1]);
    if(d>1.35&&d<24&&state.opponentPunch<0){
      const step=Math.min(d-1.3,dt*1.65),unit:Point=[(player.position[0]-state.position[0])/d,(player.position[1]-state.position[1])/d],p={x:state.position[0],z:state.position[1]};
      const permitted:GroundCheck=(x,z,r)=>ground(x,z,r)&&distance([x,z],player.position)>r+.52&&!(options.protectedPoints??[]).some(target=>distance([x,z],target)<10);
      const moved=moveOnGround(p,{x:unit[0]*step,z:unit[1]*step},.45,permitted,true,.15);state.position=[p.x,p.z];state.travelled+=moved.distance;
    }
    if(age-startedAt>2&&opponentCooldown<=0&&state.opponentPunch<0&&encounterStrikeHits(state.position,state.heading,player.position,ground)){
      state.opponentPunch=0;opponentStruck=false;opponentCooldown=1.5;
    }
    if(state.opponentPunch>=0){
      state.opponentPunch+=dt;
      if(!opponentStruck&&state.opponentPunch>=.22){
        opponentStruck=true;
        if(!player.riding&&encounterStrikeHits(state.position,state.heading,player.position,ground)){
          state.playerHealth=Math.max(0,state.playerHealth-12);state.opponentHits++;options.onEvent?.('player-hit');
          if(state.playerHealth===0){state.phase='knocked-out';options.onEvent?.('knocked-out');}
        }
      }
      if(state.opponentPunch>.5)state.opponentPunch=-1;
    }
  }
  function canStand(x:number,z:number,radius=.5){
    if(!ground(x,z,radius))return false;
    return state.phase==='defeated'||state.phase==='knocked-out'||distance([x,z],state.position)>=radius+.45;
  }
  return {state,attack,update,canStand};
}

/** Two actual rig joints receive an original forward strike and recover to their captured pose. */
export function createEncounterPunchRig(root:TransformNode){
  const nodes=root.getDescendants(false),arm=nodes.find(n=>canonical(n.name)==='rightarm') as TransformNode|undefined,forearm=nodes.find(n=>canonical(n.name)==='rightforearm') as TransformNode|undefined;
  if(!arm||!forearm||!(arm.parent instanceof TransformNode)||!(forearm.parent instanceof TransformNode))return undefined;
  let captured=false;
  const poses=[{node:arm,base:Quaternion.Identity()},{node:forearm,base:Quaternion.Identity()}];
  function restore(){if(!captured)return;for(const pose of poses)pose.node.rotationQuaternion=pose.base.clone();captured=false;}
  function apply(age:number,heading:number){
    if(age<0||age>.5){restore();return;}
    if(!captured){for(const pose of poses)pose.base=pose.node.rotationQuaternion?.clone()??Quaternion.FromEulerAngles(pose.node.rotation.x,pose.node.rotation.y,pose.node.rotation.z);captured=true;}
    const amount=Math.max(0,Math.sin(Math.min(1,age/.45)*Math.PI)),worldDirection=new Vector3(Math.sin(heading),.08,Math.cos(heading)).normalize();
    for(const pose of poses){
      const parent=pose.node.parent as TransformNode,parentMatrix=parent.computeWorldMatrix(true),inverse=Matrix.Invert(parentMatrix),desired=Vector3.TransformNormal(worldDirection,inverse).normalize();
      const initial=Vector3.Up().rotateByQuaternionToRef(pose.base,new Vector3()).normalize(),delta=Quaternion.Identity();Quaternion.FromUnitVectorsToRef(initial,desired,delta);
      pose.node.rotationQuaternion=Quaternion.Slerp(pose.base,delta.multiply(pose.base),amount);pose.node.computeWorldMatrix(true);
    }
  }
  return {apply,restore};
}

export function createCityEncounter(scene:Scene,city:CityRuntime,world:{canStand:GroundCheck;shadows?:Pick<ShadowGenerator,'addShadowCaster'|'removeShadowCaster'>},options:EncounterOptions){
  const position=planEncounterPoint(city,world.canStand,options.player().position),playerRig=options.playerRoot?createEncounterPunchRig(options.playerRoot):undefined;
  const simulation=position?createEncounterSimulation(position,world.canStand,{...options,animationAvailable:!!playerRig,protectedPoints:[city.pickup,city.delivery]}):undefined;
  const model=position?createDetailedCharacter(scene):undefined;let rig:ReturnType<typeof createEncounterPunchRig>,loaded=false,disposed=false,finished=false;
  const stats={available:!!position,fictional:true,adultGenericModel:true,playerAnimationAvailable:!!playerRig,defeated:false};
  const ready=(model?.ready??Promise.resolve()).then(()=>{
    finished=true;if(!model||!simulation)return;
    if(disposed){model.root.dispose(false,true);return;}
    rig=createEncounterPunchRig(model.root);if(!rig)throw Error('Il modello dello scontro non ha le articolazioni necessarie.');
    model.root.name='personaggio adulto fittizio dello scontro';model.root.metadata={...(model.root.metadata??{}),fictionalEncounter:true,realPerson:false,location:'Game fiction on a free source walking street, not a real crime location.'};
    model.parcel.setEnabled(false);
    const label=MeshBuilder.CreatePlane('scontro fittizio · segnale',{width:1.55,height:.35},scene),material=new StandardMaterial('segnale scontro fittizio',scene),texture=new DynamicTexture('testo scontro fittizio',{width:512,height:128},scene,false);
    texture.hasAlpha=true;texture.drawText('SFIDA FACOLTATIVA',null,83,'bold 42px sans-serif','#fff4e6','#842f2f',true);material.diffuseTexture=texture;material.emissiveColor.set(.65,.65,.65);material.backFaceCulling=false;label.material=material;label.parent=model.root;label.position.y=2.15;label.billboardMode=Mesh.BILLBOARDMODE_Y;label.isPickable=false;
    for(const mesh of model.root.getChildMeshes(false))world.shadows?.addShadowCaster(mesh,false);
    loaded=true;model.root.position.set(simulation.state.position[0],options.surfaceHeightAt?.(...simulation.state.position)??0,simulation.state.position[1]);
  });
  function attack(){return !!loaded&&!disposed&&!!simulation?.attack();}
  function update(dt:number,time:number){
    if(!loaded||disposed||!simulation||!model)return;
    const before=[...simulation.state.position] as Point;simulation.update(dt);const state=simulation.state;
    if(state.phase==='defeated'){stats.defeated=true;model.root.setEnabled(false);playerRig?.restore();return;}
    if(state.phase==='knocked-out'){model.root.setEnabled(false);playerRig?.restore();rig?.restore();return;}
    model.root.position.set(state.position[0],options.surfaceHeightAt?.(...state.position)??0,state.position[1]);model.root.rotation.y=state.heading;
    model.animate(time,distance(before,state.position)>.001,false);rig?.apply(state.opponentPunch,state.heading);playerRig?.apply(state.playerPunch,options.player().heading);
  }
  function dispose(){if(disposed)return;disposed=true;playerRig?.restore();rig?.restore();if(model){model.root.setEnabled(false);if(finished){for(const mesh of model.root.getChildMeshes(false))world.shadows?.removeShadowCaster(mesh,false);model.root.dispose(false,true);}}}
  scene.onDisposeObservable.addOnce(dispose);
  return {ready,attack,update,dispose,stats,get state(){return simulation?.state;},canStand:(x:number,z:number,r=.5)=>simulation?.canStand(x,z,r)??world.canStand(x,z,r)};
}
