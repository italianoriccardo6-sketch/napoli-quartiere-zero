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
import type {Point} from './geo';
import type {GroundCheck} from './movement';

import {planEncounterPoint,createEncounterSimulation,type EncounterSimulationOptions} from './encounter-simulation';
export {planEncounterPoint,encounterLineClear,encounterStrikeHits,createEncounterSimulation} from './encounter-simulation';
export type {EncounterPlayer,EncounterEvent,EncounterState,EncounterSimulationOptions} from './encounter-simulation';
export interface EncounterOptions extends EncounterSimulationOptions {
  /** The real licensed model root; required for an actual visible player strike. */
  playerRoot?:TransformNode;
  surfaceHeightAt?:(x:number,z:number)=>number;
}
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const canonical=(value:string)=>value.replace(/[^a-z0-9]/gi,'').toLowerCase();

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
