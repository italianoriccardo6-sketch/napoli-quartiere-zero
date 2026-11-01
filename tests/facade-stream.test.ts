import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {createFacadeStream} from '../src/facade-stream';
import type {MapData} from '../src/geo';

test('long retained facade chunks regenerate near the new view without changing source geometry',()=>{
  const engine=new NullEngine({renderWidth:640,renderHeight:480,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
  const map:MapData={provenance:'osm',notice:'synthetic fixture',paths:[],land:[],buildings:[{id:'long-fixture',height:12,estimated:false,rings:[[[0,0],[1200,0],[1200,30],[0,30]]]}]},before=JSON.stringify(map);
  const stream=createFacadeStream(scene,map,{focus:[[20,-10]],radius:300,quality:'alta'});
  const glass=()=>scene.meshes.filter((m):m is Mesh=>m instanceof Mesh&&m.metadata?.facadeRole==='glass');
  const xPositions=()=>glass().flatMap(m=>m.thinInstanceGetWorldMatrices().map(matrix=>matrix.m[12]));
  try{
    const old=glass();assert.ok(old.length>0);assert.ok(Math.max(...xPositions())<400);
    stream.update([850,-10],'alta');
    assert.equal(stream.stats.residentChunks,1);assert.equal(stream.stats.regeneratedChunks,1);
    assert.ok(old.every(m=>m.isDisposed()),'old GPU facade batches are released');
    assert.ok(Math.min(...xPositions())>500,'the newly approached section has windows');
    assert.equal(JSON.stringify(map),before,'geographic source and collision footprint remain intact');
    stream.update([860,-10],'alta');assert.equal(stream.stats.regeneratedChunks,1,'small movements reuse the refreshed batches');
  }finally{stream.dispose();scene.dispose();engine.dispose();}
});
