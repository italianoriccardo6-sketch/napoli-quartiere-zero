import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import {registerBuiltInLoaders} from '@babylonjs/loaders/dynamic';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Canvas} from '@napi-rs/canvas';
import {normalizeHumanModel} from '../src/character-model';
import {createEncounterSimulation,createEncounterPunchRig,encounterStrikeHits,planEncounterPoint,type EncounterPlayer} from '../src/city-encounter';
import {createCityWorld} from '../src/city-world';
import type {CityMapData} from '../src/city-data';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const engine=()=>new NullEngine({renderWidth:640,renderHeight:480,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4});

test('encounter strikes: facing, range and real wall clearance are required',()=>{
  assert.equal(encounterStrikeHits([0,0],0,[0,1.4],()=>true),true);
  assert.equal(encounterStrikeHits([0,0],Math.PI,[0,1.4],()=>true),false);
  assert.equal(encounterStrikeHits([0,0],0,[0,2],()=>true),false);
  assert.equal(encounterStrikeHits([0,0],0,[0,1.4],(x,z)=>z<.5||z>.7),false);
});
test('encounter: real-time cooldown and stamina reject spam and strikes cannot be thrown while driving',()=>{
  let player:EncounterPlayer={position:[0,0],heading:0,riding:false};
  const simulation=createEncounterSimulation([0,1.5],()=>true,{player:()=>player,animationAvailable:true});
  assert.equal(simulation.attack(),true);assert.equal(simulation.attack(),false);assert.equal(simulation.state.stamina,75);
  for(let i=0;i<10;i++)simulation.update(.04);assert.equal(simulation.state.hits,1);assert.equal(simulation.state.opponentHealth,75);
  player.riding=true;for(let i=0;i<20;i++)simulation.update(.04);assert.equal(simulation.attack(),false);
  const unanimated=createEncounterSimulation([0,1.5],()=>true,{player:()=>({...player,riding:false})});assert.equal(unanimated.attack(),false,'no fake invisible punch without an actual arm rig');
});
test('encounter: bounded chasing respects a wall and protected quest zones',()=>{
  const player:EncounterPlayer={position:[0,0],heading:0,riding:false},wall=(x:number,z:number,r:number)=>z-r>3||z+r<2;
  const simulation=createEncounterSimulation([0,6],wall,{player:()=>player,animationAvailable:true});
  for(let i=0;i<300;i++)simulation.update(.04);
  assert.ok(simulation.state.position[1]>3.4);assert.equal(simulation.state.opponentHits,0);
  const protectedFight=createEncounterSimulation([0,7],()=>true,{player:()=>player,protectedPoints:[[0,0]],animationAvailable:true});
  for(let i=0;i<300;i++)protectedFight.update(.04);assert.equal(protectedFight.state.travelled,0);
});
test('encounter: defeating a fictional opponent is finite, and a player knockout is emitted once',()=>{
  const events:string[]=[],p:EncounterPlayer={position:[0,0],heading:0,riding:false},sim=createEncounterSimulation([0,1.5],()=>true,{player:()=>p,animationAvailable:true,onEvent:event=>events.push(event)});
  for(let punch=0;punch<4;punch++){assert.equal(sim.attack(),true);for(let i=0;i<19;i++)sim.update(.04);}
  assert.equal(sim.state.opponentHealth,0);assert.equal(sim.state.phase,'defeated');assert.equal(events.filter(e=>e==='defeated').length,1);assert.equal(sim.attack(),false);assert.equal(sim.canStand(...sim.state.position,.5),true,'defeated opponent cannot block the quest');
  const knockouts:string[]=[],other=createEncounterSimulation([0,1.4],()=>true,{player:()=>p,animationAvailable:true,onEvent:event=>knockouts.push(event)});
  for(let i=0;i<1500;i++)other.update(.04);
  assert.equal(other.state.playerHealth,0);assert.equal(other.state.phase,'knocked-out');assert.equal(knockouts.filter(e=>e==='knocked-out').length,1);
});
test('actual licensed rig: original punch visibly changes the hand and skinned mesh, then restores the pose',async()=>{
  const e=engine(),scene=new Scene(e);
  try{
    registerBuiltInLoaders();const bytes=readFileSync('public/assets/characters/civilian/civilian.glb'),result=await ImportMeshAsync(bytes,scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true,animationStartMode:0}}});
    const nodes=[...result.meshes,...result.transformNodes],imported=new Set(nodes),root=new TransformNode('test punch',scene);
    for(const node of nodes)if(!node.parent||!imported.has(node.parent as TransformNode))node.parent=root;
    const find=(name:string)=>nodes.find(n=>n.name===name)!;normalizeHumanModel(root,[find('LeftFoot'),find('RightFoot')],[find('LeftToeBase'),find('RightToeBase')]);
    const rig=createEncounterPunchRig(root);assert.ok(rig);
    const hand=find('RightHand'),mesh=result.meshes.find(m=>m.getTotalVertices()>0)!;hand.computeWorldMatrix(true);const original=hand.getAbsolutePosition().clone();result.skeletons[0].prepare(true);const before=Array.from(mesh.getPositionData(true,true)!);
    rig.apply(.225,0);for(const node of root.getDescendants(false))node.computeWorldMatrix(true);result.skeletons[0].prepare(true);const punched=hand.getAbsolutePosition().clone(),after=mesh.getPositionData(true,true)!;
    assert.ok(Vector3.Distance(original,punched)>.1,'the actual hand must visibly move');assert.ok(punched.z>original.z+.1,'the strike extends in front of the +Z-facing model');assert.ok(before.some((value,i)=>Math.abs(value-after[i])>.01),'the real skinned mesh deforms; this is not a text-only attack');
    rig.restore();for(const node of root.getDescendants(false))node.computeWorldMatrix(true);assert.ok(Vector3.Distance(hand.getAbsolutePosition(),original)<1e-5,'recovery restores the original rig pose');
  }finally{scene.dispose();e.dispose();}
});
test('actual Napoli encounter: free source walking point does not occupy route or interactions',()=>{
  const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData,e=engine(),scene=new Scene(e);
  try{
    const city=map.city!,world=createCityWorld(scene,map,city),before=JSON.stringify(map),point=planEncounterPoint(city,world.canStand,[-324.0176206259376,251.2814865680662]);
    assert.ok(point,'real city has a suitable optional encounter point');assert.equal(world.canStand(...point,.55),true);
    assert.ok(Math.hypot(point[0]-city.pickup[0],point[1]-city.pickup[1])>=12);assert.ok(Math.hypot(point[0]-city.delivery[0],point[1]-city.delivery[1])>=12);assert.equal(JSON.stringify(map),before);
  }finally{scene.dispose();e.dispose();}
});
