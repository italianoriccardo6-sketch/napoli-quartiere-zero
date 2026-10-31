import test from 'node:test';import assert from 'node:assert/strict';
import {Canvas} from '@napi-rs/canvas';import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {buildVegetationPlan,addVegetation,type SourceTree,type GreenData} from '../src/vegetation';import {ORIGIN,toLocal,type MapData,type Point} from '../src/geo';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
function node(id:number,point:Point,tags:Record<string,string>={}):SourceTree{return {id:'node/'+id,lon:ORIGIN.lon+point[0]/(Math.PI/180*6378137*Math.cos(ORIGIN.lat*Math.PI/180)),lat:ORIGIN.lat+point[1]/(Math.PI/180*6378137),tags:{natural:'tree',...tags}};}
function fixture(trees:SourceTree[]=[node(1,[0,0])]){const map:MapData={provenance:'osm',notice:'test sintetico',paths:[],buildings:[],land:[[[-1500,-1500],[1500,-1500],[1500,1500],[-1500,1500]]]};const data:GreenData={version:1,source:{bbox:[40.81,14.23,40.85,14.27],license:'ODbL-1.0',retrieved_at:'2026-10-31'},trees};return {map,data};}
test('alberi: coordinate metriche identiche ai nodi sorgente, specie e dimensioni lette dai tag',()=>{
 const {map,data}=fixture([node(1,[4,9],{species:'Pinus pinea',height:'12 m',crown_diameter:'8',circumference:'1,2'}),node(2,[20,-5],{genus:'Phoenix',height:'9'}),node(3,[-14,7],{leaf_type:'needleleaved'}),node(4,[0,2],{genus:'Quercus'})]);
 const before=JSON.stringify({map,data}),plan=buildVegetationPlan(map,data,{focus:[[0,0]],groundHeight:()=>.13});assert.equal(plan.placements.length,4);
 for(const tree of plan.placements){const source=data.trees.find(t=>t.id===tree.id)!;assert.deepEqual(tree.point,toLocal(source.lon,source.lat));assert.equal(tree.ground,.13);}
 const pine=plan.placements.find(t=>t.id==='node/1')!;assert.equal(pine.form,'umbrella');assert.equal(pine.height,12);assert.equal(pine.crownDiameter,8);assert.ok(Math.abs(pine.trunkDiameter-1.2/Math.PI)<1e-9);assert.equal(pine.estimatedHeight,false);assert.equal(pine.estimatedCrown,false);
 assert.equal(plan.placements.find(t=>t.id==='node/2')!.form,'palm');assert.equal(plan.placements.find(t=>t.id==='node/3')!.form,'conifer');assert.equal(plan.placements.find(t=>t.id==='node/4')!.form,'broadleaf');assert.equal(JSON.stringify({map,data}),before);
 assert.deepEqual(plan,buildVegetationPlan(map,data,{focus:[[0,0]],groundHeight:()=>.13}));
});
test('provenienza: nessuna piantumazione inventata da parchi o filari, input non valido scartato',()=>{
 const {map,data}=fixture([]);data.treeRows=[{id:'way/3',geometry:[{lat:ORIGIN.lat,lon:ORIGIN.lon}]}];data.areas=[{id:'way/4',kind:'park'}];assert.equal(buildVegetationPlan(map,data).placements.length,0);
 data.trees=[node(1,[0,0]),node(1,[2,0]),{...node(2,[0,0]),lon:Infinity},{...node(3,[0,0]),tags:{natural:'scrub'}},{...node(4,[0,0]),lat:45}];const plan=buildVegetationPlan(map,data);assert.equal(plan.placements.length,1);assert.equal(plan.stats.invalidSource,4);assert.equal(plan.stats.placement,'source-tree-nodes-only');assert.equal(plan.stats.individualTreesInvented,false);
 assert.throws(()=>buildVegetationPlan(map,{...data,source:{...data.source,bbox:[0,1,2]}}));assert.throws(()=>buildVegetationPlan(map,data,{maxTrees:401}),RangeError);assert.throws(()=>buildVegetationPlan(map,data,{radius:Infinity}),RangeError);
});
test('piantumazione: edifici e buchi esclusi, distanza e budget limitano senza spostare nodi',()=>{
 const {map,data}=fixture([node(1,[0,0]),node(2,[10,0]),node(3,[25,0]),node(4,[50,0]),node(5,[400,0])]);
 map.buildings=[{id:'palazzo',rings:[[[-2,-2],[2,-2],[2,2],[-2,2]]],height:10,estimated:false}];
 (map as MapData&{city:{landPolygons:Point[][][]}}).city={landPolygons:[[map.land[0],[[8,-2],[12,-2],[12,2],[8,2]]]]};
 const plan=buildVegetationPlan(map,data,{focus:[[0,0]],radius:100,maxTrees:1});assert.equal(plan.stats.insideBuildings,1);assert.equal(plan.stats.outsideLand,1);assert.equal(plan.stats.outsideCorridor,1);assert.equal(plan.stats.budgetClipped,1);assert.deepEqual(plan.placements[0].point,toLocal(data.trees[2].lon,data.trees[2].lat));
 assert.equal(buildVegetationPlan(map,data,{maxTrees:0}).placements.length,0);
});
test('geometria: matrici finite e numero limitato, chioma stimata ridotta vicino agli edifici',()=>{
 const {map,data}=fixture([node(1,[3,0]),node(2,[30,0],{genus:'Phoenix'})]);map.buildings=[{id:'palazzo',rings:[[[-3,-3],[1,-3],[1,3],[-3,3]]],height:10,estimated:false}];
 const plan=buildVegetationPlan(map,data,{focus:[[0,0]]}),low=buildVegetationPlan(map,data,{focus:[[0,0]],quality:'bassa'});assert.equal(plan.placements.length,2);assert.equal(plan.placements[0].crownLimitedByClearance,true);assert.ok(plan.placements[0].crownDiameter<=3.71);assert.ok(low.stats.leafInstances<plan.stats.leafInstances);assert.ok(plan.stats.leafInstances<180);assert.ok(plan.stats.branchInstances<70);
 for(const b of plan.batches){assert.equal(b.matrices.length%16,0);assert.ok(b.matrices.every(Number.isFinite));assert.ok(b.matrices.filter((_,i)=>i%16===15).every(n=>n===1));}assert.equal(plan.stats.meshCount,plan.batches.length);
});
test('scene: istanze raggruppate senza collider, rilascio conserva il materiale fornito',()=>{
 const engine=new NullEngine({renderWidth:800,renderHeight:600,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
 try{const {map,data}=fixture([node(1,[0,0]),node(2,[20,0],{genus:'Phoenix'})]),bark=new StandardMaterial('corteccia fornita',scene),result=addVegetation(scene,map,data,{materials:{bark},focus:[[0,0]]});assert.equal(result.placements.length,2);assert.ok(result.meshes.length<=4);for(const mesh of result.meshes){assert.equal(mesh.isPickable,false);assert.equal(mesh.checkCollisions,false);assert.equal(mesh.metadata.solid,false);assert.ok(mesh.thinInstanceCount>0);}assert.equal(scene.metadata.vegetation.measuredPositions,true);assert.equal(scene.metadata.vegetation.measuredShapes,false);result.dispose();assert.equal(scene.meshes.length,0);assert.ok(scene.materials.includes(bark));assert.equal(scene.materials.length,1);assert.equal(scene.textures.length,0);const original=addVegetation(scene,map,data);assert.equal(scene.textures.length,4);original.dispose();assert.equal(scene.meshes.length,0);assert.equal(scene.textures.length,0);assert.equal(scene.materials.length,1);}finally{scene.dispose();engine.dispose();}
});
