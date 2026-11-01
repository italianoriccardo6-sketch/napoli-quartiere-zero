import test from 'node:test';
import assert from 'node:assert/strict';
import {buildElevatedGroundGeometry} from '../src/elevated-ground';
import {addElevatedGround} from '../src/elevated-ground';
import {partitionGroundMaterials} from '../src/ground-material-partition';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';

test('steep stone partitions original faces without altering terrain heights, normals, borders or triangle coverage',()=>{
  const ground=buildElevatedGroundGeometry([[[[0,0],[16,0],[16,8],[0,8]]]],(x,z)=>Math.max(0,x-8)*2+z*.02,{maxEdge:2,tileSize:8}),before=JSON.stringify(ground),partition=partitionGroundMaterials(ground.batches);
  assert.ok(partition.stats.steepTriangles>0&&partition.stats.pavingTriangles>0);assert.equal(partition.stats.steepTriangles+partition.stats.pavingTriangles,ground.stats.triangles);
  const faces=(batches:typeof ground.batches)=>batches.flatMap(batch=>Array.from({length:batch.indices.length/3},(_,i)=>batch.indices.slice(i*3,i*3+3).map(id=>batch.positions.slice(id*3,id*3+3).join(',')).join('|'))).sort();
  assert.deepEqual(faces(partition.batches),faces(ground.batches));assert.equal(JSON.stringify(ground),before);
  for(const batch of partition.batches){assert.ok(batch.positions.length/3<=60000&&batch.indices.every(id=>id<60000));if(batch.surface==='steep-stone')for(let i=0;i<batch.positions.length/3;i++)assert.equal(batch.uvs[i*2+1],batch.positions[i*3+1]/2);}
});
test('steep vertical projection changes with the dominant normal axis while flat paving retains source UVs',()=>{
  for(const [height,projection]of [[(x:number,z:number)=>x*2,'zy'],[(x:number,z:number)=>z*2,'xy']] as const){
    const ground=buildElevatedGroundGeometry([[[[0,0],[8,0],[8,8],[0,8]]]],height,{maxEdge:2}),partition=partitionGroundMaterials(ground.batches,45,2);
    assert.equal(partition.stats.pavingTriangles,0);assert.ok(partition.batches.every(b=>b.projection===projection));
  }
  const flat=buildElevatedGroundGeometry([[[[0,0],[8,0],[8,8],[0,8]]]],()=>-3,{maxEdge:2}),partition=partitionGroundMaterials(flat.batches);
  assert.equal(partition.stats.steepTriangles,0);assert.deepEqual(partition.batches[0].uvs,flat.batches[0].uvs);
  assert.throws(()=>partitionGroundMaterials(flat.batches,90));
});
test('scene assigns caller-owned steep stone while the full rendered height field stays unchanged',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),paving=new StandardMaterial('paving',scene),stone=new StandardMaterial('stone',scene);
  try{
    const ground=addElevatedGround(scene,[[[[0,0],[16,0],[16,8],[0,8]]]],(x,z)=>Math.max(0,x-8)*2+z*.02,paving,{maxEdge:2,steepMaterial:stone});
    assert.ok(ground.meshes.some(m=>m.material===paving)&&ground.meshes.some(m=>m.material===stone));
    assert.ok(ground.meshes.filter(m=>m.material===stone).every(m=>m.metadata.surface==='steep-stone'&&m.metadata.uvProjection!=='xz'&&m.getTotalVertices()<=60000));
    assert.ok(Math.abs(ground.heightAt(12,4)!-8.08)<1e-8);ground.dispose();assert.ok(scene.materials.includes(paving)&&scene.materials.includes(stone));
  }finally{scene.dispose();engine.dispose();}
});
