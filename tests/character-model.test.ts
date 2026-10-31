import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';import {TransformNode} from '@babylonjs/core/Meshes/transformNode';import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Animation} from '@babylonjs/core/Animations/animation';import {AnimationGroup} from '@babylonjs/core/Animations/animationGroup';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';import {registerBuiltInLoaders} from '@babylonjs/loaders/dynamic';
import {normalizeHumanModel,removeHorizontalRootMotion,advanceMotionFrame} from '../src/character-model';
const engine=()=>new NullEngine({renderWidth:800,renderHeight:600,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4});
test('personaggio: usa i piedi per orientare +Z, scala i vertici a1.8m e posa a terra',()=>{
  const e=engine(),scene=new Scene(e);
  try{
    const pivot=new TransformNode('asset',scene),body=MeshBuilder.CreateBox('corpo',{width:1,height:3.6,depth:1},scene);body.parent=pivot;body.position.set(4,5,-3);
    const point=(name:string,x:number,z:number)=>{const n=new TransformNode(name,scene);n.parent=pivot;n.position.set(x,3.2,z);return n;};
    const feet=[point('LF',4,-2.8),point('RF',4,-3.2)],toes=[point('LT',4.4,-2.8),point('RT',4.4,-3.2)];
    const size=normalizeHumanModel(pivot,feet,toes),axis=toes[0].getAbsolutePosition().subtract(feet[0].getAbsolutePosition());
    assert.ok(Math.abs(size.height-1.8)<1e-6);assert.ok(Math.abs(size.ground)<1e-6);assert.ok(axis.z>0);assert.ok(Math.abs(axis.x)<1e-6);
    const center=feet[0].getAbsolutePosition().add(feet[1].getAbsolutePosition());assert.ok(Math.abs(center.x)<1e-6);assert.ok(Math.abs(center.z)<1e-6);
  }finally{scene.dispose();e.dispose();}
});
test('animazione: rimuove solo viaggio orizzontale delle anche, conserva il passo verticale',()=>{
  const e=engine(),scene=new Scene(e);
  try{
    const hips=new TransformNode('Hips',scene);hips.position.set(.2,1,.3);
    const motion=new Animation('root motion','position',30,Animation.ANIMATIONTYPE_VECTOR3,Animation.ANIMATIONLOOPMODE_CYCLE);
    motion.setKeys([{frame:0,value:new Vector3(0,1,0)},{frame:30,value:new Vector3(3,1.1,4)}]);
    const group=new AnimationGroup('Walk',scene);group.addTargetedAnimation(motion,hips);
    assert.equal(removeHorizontalRootMotion([group]),1);
    const keys=motion.getKeys();assert.equal(keys[1].value.x,.2);assert.equal(keys[1].value.z,.3);assert.equal(keys[1].value.y,1.1);
  }finally{scene.dispose();e.dispose();}
});
test('passo: cambiare velocità conserva la fase, la pausa non fa avanzare la posa',()=>{
  let frame=advanceMotionFrame(0,.06,30,1,100);frame=advanceMotionFrame(frame,.06,30,2,100);
  assert.ok(Math.abs(frame-5.4)<1e-8);
  assert.equal(advanceMotionFrame(frame,0,30,8,100),frame);
  assert.equal(advanceMotionFrame(frame,20,30,2,100),frame);
  assert.ok(Math.abs(advanceMotionFrame(99,.1,30,1,100)-2)<1e-8);
});
test('civile reale: scheletro, camminata/corsa e normalizzazione geometrica CPU',async()=>{
  const e=engine(),scene=new Scene(e);
  try{
    registerBuiltInLoaders();
    const bytes=readFileSync(new URL('../public/assets/characters/civilian/civilian.glb',import.meta.url));
    const result=await ImportMeshAsync(bytes,scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true,animationStartMode:0}}});
    const nodes=[...result.meshes,...result.transformNodes],imported=new Set<TransformNode>(nodes),pivot=new TransformNode('civile reale',scene);
    for(const node of nodes)if(!node.parent||!imported.has(node.parent as TransformNode))node.parent=pivot;
    const find=(name:string)=>{const node=nodes.find(n=>n.name===name);assert.ok(node,`Manca ${name}`);return node;};
    const feet=[find('LeftFoot'),find('RightFoot')],toes=[find('LeftToeBase'),find('RightToeBase')];
    const size=normalizeHumanModel(pivot,feet,toes);
    assert.ok(Math.abs(size.height-1.8)<1e-5);assert.ok(Math.abs(size.ground)<1e-5);assert.ok(size.width>.3&&size.width<1.8);assert.ok(size.depth>.1&&size.depth<.8);
    const facing=toes[0].getAbsolutePosition().add(toes[1].getAbsolutePosition()).subtract(feet[0].getAbsolutePosition()).subtract(feet[1].getAbsolutePosition());
    assert.ok(facing.z>0);assert.ok(Math.abs(facing.x)<1e-5);
    assert.equal(result.skeletons[0].bones.length,24);assert.deepEqual(result.animationGroups.map(g=>g.name),['Walk','Run']);assert.equal(removeHorizontalRootMotion(result.animationGroups),2);
    const walk=result.animationGroups[0],hip=find('Hips'),hipStart=hip.position.clone();walk.start(true);walk.pause();walk.goToFrame((walk.from+walk.to)/2);
    assert.ok(Math.abs(hip.position.x-hipStart.x)<1e-6);assert.ok(Math.abs(hip.position.z-hipStart.z)<1e-6);
    const mesh=result.meshes.find(m=>m.getTotalVertices()>0);assert.ok(mesh);
    result.skeletons[0].prepare(true);const first=Array.from(mesh.getPositionData(true,true)!);
    walk.goToFrame(walk.from+(walk.to-walk.from)*.25);result.skeletons[0].prepare(true);const second=mesh.getPositionData(true,true)!;
    assert.ok(first.some((value,i)=>Math.abs(value-second[i])>.01),'La camminata deve deformare la mesh reale');
    let minY=Infinity;const p=Vector3.Zero(),q=Vector3.Zero(),matrix=mesh.computeWorldMatrix(true);
    for(let i=0;i<second.length;i+=3){p.set(second[i],second[i+1],second[i+2]);Vector3.TransformCoordinatesToRef(p,matrix,q);minY=Math.min(minY,q.y);}
    assert.ok(minY>-.05&&minY<.1,'Il piede di appoggio deve restare vicino al terreno');
  }finally{scene.dispose();e.dispose();}
});
