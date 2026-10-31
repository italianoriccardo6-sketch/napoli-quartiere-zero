import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import {registerBuiltInLoaders} from '@babylonjs/loaders/dynamic';
import type {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';

const canonical=(name:string)=>name.replace(/^mixamorig[:_]?/i,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
function update(pivot:TransformNode){pivot.computeWorldMatrix(true);for(const node of pivot.getDescendants(false))node.computeWorldMatrix(true);for(const mesh of pivot.getChildMeshes(false))mesh.skeleton?.prepare();}
function bounds(pivot:TransformNode){
  const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity),local=Vector3.Zero(),world=Vector3.Zero();
  for(const mesh of pivot.getChildMeshes(false)){
    const data=mesh.getPositionData(true,true);if(!data)continue;
    const matrix=mesh.computeWorldMatrix(true);
    for(let i=0;i<data.length;i+=3){local.set(data[i],data[i+1],data[i+2]);Vector3.TransformCoordinatesToRef(local,matrix,world);min.minimizeInPlace(world);max.maximizeInPlace(world);}
  }return {min,max};
}
function average(nodes:TransformNode[]){const p=Vector3.Zero();for(const n of nodes)p.addInPlace(n.getAbsolutePosition());return p.scaleInPlace(1/nodes.length);}

/** Measure the actual skinned/rest-pose vertices, not an inflated scene or global animation box. */
export function normalizeHumanModel(pivot:TransformNode,feet:TransformNode[],toes:TransformNode[],height=1.8){
  if(pivot.parent||feet.length!==2||toes.length!==2||!Number.isFinite(height)||height<=0)throw Error('Normalizzazione del personaggio non valida.');
  update(pivot);const forward=average(toes).subtract(average(feet));forward.y=0;
  if(forward.lengthSquared()<1e-8)throw Error('Direzione dei piedi del personaggio non valida.');
  pivot.rotationQuaternion=null;pivot.rotation.y-=Math.atan2(forward.x,forward.z);update(pivot);
  let box=bounds(pivot),size=box.max.subtract(box.min);
  if(!Number.isFinite(size.y)||size.y<=0)throw Error('Geometria del personaggio non valida.');
  pivot.scaling.scaleInPlace(height/size.y);update(pivot);box=bounds(pivot);
  // Center on the feet so the animation stays over the controller's ground position.
  const footCenter=average(feet);pivot.position.x-=footCenter.x;pivot.position.z-=footCenter.z;pivot.position.y-=box.min.y;update(pivot);
  box=bounds(pivot);size=box.max.subtract(box.min);
  if(![size.x,size.y,size.z].every(Number.isFinite)||size.x<=0||size.z<=0||size.x>height*2||size.z>height)throw Error('Proporzioni del personaggio non valide.');
  return {width:size.x,height:size.y,depth:size.z,ground:box.min.y};
}

/** A controller owns travel. Keep only vertical hip motion from the authored walking cycle. */
export function removeHorizontalRootMotion(groups:AnimationGroup[]):number {
  let changed=0;
  for(const group of groups)for(const {target,animation}of group.targetedAnimations){
    if(animation.targetProperty!=='position'||!['hips','armature','root'].includes(canonical(target.name??''))||!target.position)continue;
    animation.setKeys(animation.getKeys().map(key=>{
      const copy={...key,value:key.value.clone() as Vector3};copy.value.x=target.position.x;copy.value.z=target.position.z;
      if(key.inTangent){copy.inTangent=key.inTangent.clone();copy.inTangent.x=0;copy.inTangent.z=0;}
      if(key.outTangent){copy.outTangent=key.outTangent.clone();copy.outTangent.x=0;copy.outTangent.z=0;}
      return copy;
    }));changed++;
  }return changed;
}

/** Integrate motion speed; a changed speed or a gap while paused must not jump the pose. */
export function advanceMotionFrame(frame:number,dt:number,fps:number,speedRatio:number,range:number):number {
  if(![frame,dt,fps,speedRatio,range].every(Number.isFinite)||dt<=0||dt>.25||fps<=0||speedRatio<0||range<=0)return frame;
  return (frame+dt*fps*speedRatio)%range;
}

export function createDetailedCharacter(scene:Scene){
  const root=new TransformNode('Luca Serra',scene);root.setEnabled(false);
  const pivot=new TransformNode('personaggio CC0 normalizzato',scene);pivot.setEnabled(false);
  const material=new StandardMaterial('custodia di Luca',scene);material.diffuseColor=Color3.FromHexString('#3b2f29');material.specularColor.setAll(.07);
  const parcel=MeshBuilder.CreateBox('custodia del telefono',{width:.26,height:.30,depth:.07},scene);parcel.material=material;parcel.parent=root;parcel.position.set(0,1.10,-.20);parcel.isPickable=false;parcel.setEnabled(false);
  let walk:AnimationGroup|undefined,run:AnimationGroup|undefined,active:AnimationGroup|undefined,frameAdvance=0,loaded=false;
  let lastTime:number|undefined,lastPosition=Vector3.Zero();
  let stand=()=>{};
  const ready=(async()=>{
    try{
      const folder=`${import.meta.env?.BASE_URL??'/'}assets/characters/civilian/`;
      const response=await fetch(folder+'source-manifest.json');if(!response.ok)throw Error('Manifesto del personaggio non disponibile.');
      const manifest=await response.json();if(manifest.asset!=='CamperCivilian'||manifest.license!=='CC0-1.0'||manifest.scene!=='civilian.glb')throw Error('Provenienza del personaggio non valida.');
      registerBuiltInLoaders();
      const result=await ImportMeshAsync(folder+'civilian.glb',scene,{pluginOptions:{gltf:{animationStartMode:0}}});
      const nodes=[...result.meshes,...result.transformNodes],imported=new Set<TransformNode>(nodes);
      for(const node of nodes)if(!node.parent||!imported.has(node.parent as TransformNode))node.parent=pivot;
      const find=(name:string)=>{const n=nodes.find(n=>canonical(n.name)===name);if(!n)throw Error('Scheletro del personaggio incompleto.');return n;};
      const dimensions=normalizeHumanModel(pivot,[find('leftfoot'),find('rightfoot')],[find('lefttoebase'),find('righttoebase')]);
      const groups=result.animationGroups;
      walk=groups.find(g=>/walk/i.test(g.name));run=groups.find(g=>/run/i.test(g.name));
      if(!walk)throw Error('Animazione di camminata assente.');
      const removed=removeHorizontalRootMotion(groups);
      const rest=nodes.map(node=>({node,position:node.position.clone(),rotation:node.rotation.clone(),quaternion:node.rotationQuaternion?.clone(),scaling:node.scaling.clone()}));
      const arms=walk.targetedAnimations.filter(({target,animation})=>/shoulder|arm|hand/i.test(target.name??'')&&animation.targetProperty==='rotationQuaternion').map(({target,animation})=>({
        target,rotation:Quaternion.Slerp(animation.evaluate(walk!.from+(walk!.to-walk!.from)*.25),animation.evaluate(walk!.from+(walk!.to-walk!.from)*.75),.5),
      }));
      stand=()=>{
        for(const pose of rest){pose.node.position.copyFrom(pose.position);pose.node.scaling.copyFrom(pose.scaling);pose.node.rotation.copyFrom(pose.rotation);pose.node.rotationQuaternion=pose.quaternion?.clone()??null;}
        for(const pose of arms)pose.target.rotationQuaternion=pose.rotation.clone();
      };
      for(const mesh of result.meshes){mesh.isPickable=false;mesh.receiveShadows=true;mesh.metadata={...(mesh.metadata??{}),asset:'CamperCivilian',license:'CC0-1.0'};}
      stand();pivot.parent=root;pivot.setEnabled(true);root.setEnabled(true);loaded=true;
      root.metadata={asset:'CamperCivilian',license:'CC0-1.0',source:manifest.source,dimensions,motions:groups.map(g=>g.name),horizontalRootChannelsRemoved:removed,
        runtimeModification:'Uniformly scaled to1.8m, feet centered at ground and toes oriented +Z; horizontal hip travel removed; standing pose combines rest legs and averaged walk arm rotations.'};
    }catch(error){pivot.dispose(false,true);root.dispose(false,true);throw new Error('Impossibile caricare il personaggio. Ricarica la pagina.',{cause:error});}
  })();
  function animate(time:number,moving:boolean,riding:boolean){
    if(!loaded||!Number.isFinite(time))return;
    const dt=lastTime===undefined?0:time-lastTime,distance=Vector3.Distance(root.position,lastPosition);
    const measured=dt>0&&dt<.25?distance/dt:undefined;
    const speed=measured!==undefined&&measured<12?measured:moving?1.8:0;
    lastTime=time;lastPosition.copyFrom(root.position);
    const chosen=moving&&!riding&&(measured===undefined||speed>.05)?(run&&speed>4.2?run:walk):undefined;
    const changed=chosen!==active;
    if(changed){active?.stop();active=chosen;frameAdvance=0;stand();if(active){active.start(true);active.pause();}}
    if(active){
      active.speedRatio=Math.max(.7,Math.min(1.65,speed/(active===run?3.5:1.8)));
      const fps=active.targetedAnimations[0]?.animation.framePerSecond??30,range=active.to-active.from;
      if(range>0){if(!changed)frameAdvance=advanceMotionFrame(frameAdvance,dt,fps,active.speedRatio,range);active.goToFrame(active.from+frameAdvance);}
    }
  }
  return {root,parcel,animate,ready};
}
