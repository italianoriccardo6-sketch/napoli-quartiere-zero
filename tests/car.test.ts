import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';import {TransformNode} from '@babylonjs/core/Meshes/transformNode';import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';import {registerBuiltInLoaders} from '@babylonjs/loaders/dynamic';
import {normalizeCarModel,canStandForCar,createWheelSpinPivot} from '../src/car';
const engine=()=>new NullEngine({renderWidth:800,renderHeight:600,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4});
test('normalizzazione auto: usa gli assi ruota reali, centra la carrozzeria e posa a terra',()=>{
  const e=engine(),scene=new Scene(e);
  try{
    const model=new TransformNode('modello',scene),body=MeshBuilder.CreateBox('carrozzeria',{width:6,height:1.5,depth:2.4},scene);body.parent=model;body.position.set(8,3,-4);
    const axle=(name:string,x:number,z:number)=>{const n=new TransformNode(name,scene);n.parent=model;n.position.set(x,2.5,z);return n;};
    const front=[axle('FL',10,-3.1),axle('FR',10,-4.9)],rear=[axle('RL',6,-3.1),axle('RR',6,-4.9)];
    const size=normalizeCarModel(model,front,rear),bounds=model.getHierarchyBoundingVectors(true,m=>typeof m.getTotalVertices==='function'&&m.getTotalVertices()>0);
    assert.ok(Math.abs(size.length-4.4)<1e-6);assert.ok(Math.abs(bounds.min.y)<1e-6);assert.ok(Math.abs(bounds.min.x+bounds.max.x)<1e-6);assert.ok(Math.abs(bounds.min.z+bounds.max.z)<1e-6);
    const f=front[0].getAbsolutePosition().add(front[1].getAbsolutePosition()).scale(.5),r=rear[0].getAbsolutePosition().add(rear[1].getAbsolutePosition()).scale(.5),axis=f.subtract(r);
    assert.ok(axis.z>0);assert.ok(Math.abs(axis.x)<1e-6);assert.ok(size.radius>size.width/2);assert.ok(size.halfLength>size.length/2);
  }finally{scene.dispose();e.dispose();}
});
test('ingombro auto: controlla muso e coda, non soltanto il punto centrale',()=>{
  const at={x:0,z:0},clearance=(x:number,z:number,r:number)=>Math.abs(x)+r<4&&Math.abs(z)+r<2;
  assert.equal(clearance(0,0,.98),true);assert.equal(canStandForCar(at,0,clearance,.98,2.225),false);assert.equal(canStandForCar(at,Math.PI/2,clearance,.98,2.225),true);
  const queries:Vector3[]=[];assert.equal(canStandForCar(at,0,(x,z,r)=>{queries.push(new Vector3(x,r,z));return true;}),true);assert.ok(queries.some(p=>p.z>1));assert.ok(queries.some(p=>p.z< -1));assert.ok(queries.length>=8);
  assert.equal(canStandForCar({x:NaN,z:0},0,()=>true),false);assert.equal(canStandForCar(at,0,()=>true,2,1),false);
});
test('CarConcept reale: import locale, proporzioni, direzione e assi ruota conservati',async()=>{
  const e=engine(),scene=new Scene(e);
  try{
    const folder=new URL('../public/assets/vehicles/car-concept/',import.meta.url);
    const source=JSON.parse(readFileSync(new URL('CarConcept.gltf',folder),'utf8'));
    source.buffers[0].uri='data:application/octet-stream;base64,'+readFileSync(new URL('CarConcept.data.bin',folder)).toString('base64');
    registerBuiltInLoaders();
    // CPU geometry check: material/texture rendering still requires a browser GPU.
    const result=await ImportMeshAsync('data:'+JSON.stringify(source),scene,{pluginExtension:'.gltf',pluginOptions:{gltf:{skipMaterials:true}}});
    const nodes=[...result.meshes,...result.transformNodes],imported=new Set<TransformNode>(nodes),pivot=new TransformNode('asset reale',scene);
    for(const node of nodes)if(!node.parent||!imported.has(node.parent as TransformNode))node.parent=pivot;
    const find=(name:string)=>{const node=nodes.find(n=>n.name===name);assert.ok(node,`Manca ${name}`);return node as TransformNode;};
    const front=[find('WheelFrontL'),find('WheelFrontR')],rear=[find('WheelRearL'),find('WheelRearR')],size=normalizeCarModel(pivot,front,rear);
    assert.ok(Math.abs(size.length-4.4)<1e-5);assert.ok(size.width>2.55&&size.width<2.58);assert.ok(size.height>1.15&&size.height<1.17);
    assert.ok(size.radius>1.30&&size.radius<1.32);assert.ok(size.halfLength>2.22&&size.halfLength<2.23);
    const direction=front[0].getAbsolutePosition().add(front[1].getAbsolutePosition()).subtract(rear[0].getAbsolutePosition()).subtract(rear[1].getAbsolutePosition());
    assert.ok(direction.z>0);assert.ok(Math.abs(direction.x)<1e-5);
    for(const wheel of [...front,...rear]){
      const before=wheel.computeWorldMatrix(true).clone(),spin=createWheelSpinPivot(wheel);
      spin.parent?.computeWorldMatrix(true);spin.computeWorldMatrix(true);const after=wheel.computeWorldMatrix(true);
      assert.ok(before.equalsWithEpsilon(after,1e-5),'L’asse deve mantenere la posa sorgente');assert.equal(spin.rotationQuaternion,null);assert.ok(spin.rotation.equals(Vector3.Zero()));
      const originalAxle=Vector3.TransformNormal(Vector3.Right(),before).normalize(),spinAxle=Vector3.TransformNormal(Vector3.Right(),spin.getWorldMatrix()).normalize();
      assert.ok(Vector3.Dot(originalAxle,spinAxle)>.9999,'La rotazione locale X deve seguire l’asse ruota reale');
    }
  }finally{scene.dispose();e.dispose();}
});
