import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {buildStreetDetailGeometry,joinedStreetSections,addStreetDetail} from '../src/street-detail';import type {CityRuntime,CityMapData} from '../src/city-data';import {inside,segmentDistance,type MapData,type Point} from '../src/geo';
const route:Point[]=[[-30,0],[30,0]];
function fixture(){
 const map:MapData={provenance:'osm',notice:'synthetic test',buildings:[],paths:[route],land:[[[-100,-100],[100,-100],[100,100],[-100,100]]]};
 const detail:CityRuntime={bounds:[-100,-100,100,100],roads:[{id:'road',name:'Strada test',highway:'residential',width:6,points:route}],route,pickup:route[0],delivery:route[1],spawn:[-20,0],scooter:[-17,0],routeNames:['Strada test'],sourceDate:'2026-10-31',estimatedHeights:0,heightStatus:'test'};
 return {map,detail};
}
test('giunti: i vertici reali restano condivisi, miter corretto a90° e cuspidi limitate',()=>{
 const sections=joinedStreetSections([[-30,0],[0,0],[0,30]],4),corner=sections.find(s=>Math.abs(s.point[0])+Math.abs(s.point[1])<1e-8)!;
 assert.ok(corner);assert.ok(Math.abs(corner.miter[0]+1)<1e-10);assert.ok(Math.abs(corner.miter[1]-1)<1e-10);assert.equal(sections[0].distance,0);assert.ok(Math.abs(sections.at(-1)!.distance-60)<1e-8);
 for(const s of joinedStreetSections([[0,0],[10,0],[.1,.01]],3))assert.ok(s.miter.every(Number.isFinite)&&Math.hypot(...s.miter)<2.23);
});
test('strada: marciapiedi e cordoli rialzati, vernice bianca separata, sorgente immutata',()=>{
 const {map,detail}=fixture(),original=JSON.stringify({map,detail}),plan=buildStreetDetailGeometry(map,detail);
 assert.ok(plan.stats.sidewalkSpans>0);assert.ok(plan.stats.curbSpans>0);assert.ok(plan.stats.paintStrips>0);assert.equal(plan.stats.collisionGeometryAdded,false);assert.ok(plan.stats.meshCount<20);
 assert.equal(JSON.stringify({map,detail}),original);
 for(const b of plan.batches.filter(b=>b.surface!=='curb')){const normals:number[]=[];VertexData.ComputeNormals(b.positions,b.indices,normals);for(let i=1;i<normals.length;i+=3)assert.ok(normals[i]>.99,'normali Babylon della superficie superiore verso alto');}
 for(const b of plan.batches){assert.ok(b.positions.every(Number.isFinite));assert.equal(b.uvs.length,b.positions.length/3*2);assert.ok(b.indices.every(i=>i>=0&&i<b.positions.length/3));if(b.surface==='pavement')for(let i=1;i<b.positions.length;i+=3)assert.ok(Math.abs(b.positions[i]-.125)<1e-8);if(b.surface==='curb')assert.ok(b.positions.filter((_,i)=>i%3===1).some(y=>y===.12));}
 assert.deepEqual(plan,buildStreetDetailGeometry(map,detail));
});
test('marciapiedi campionati fuori dai palazzi, dai buchi del terreno e dal corridoio giocabile',()=>{
 const {map,detail}=fixture();const ring:Point[]=[[-12,3.35],[12,3.35],[12,8],[-12,8]];map.buildings.push({id:'palazzo',height:10,estimated:false,rings:[ring]});detail.landPolygons=[[[[-100,-100],[100,-100],[100,100],[-100,100]],[[15,-6],[24,-6],[24,-3.2],[15,-3.2]]]];
 const plan=buildStreetDetailGeometry(map,detail);assert.ok(plan.stats.rejectedRaisedSpans>0);
 for(const b of plan.batches.filter(b=>b.surface!=='paint'))for(let i=0;i<b.positions.length;i+=3){const p:Point=[b.positions[i],b.positions[i+2]];assert.equal(inside(p,ring),false);assert.equal(inside(p,detail.landPolygons[0][1]),false);assert.ok(segmentDistance(p,route[0],route[1])>=1.09);}
});
test('giunzioni vere lasciano liberi gli incroci senza inventare strisce pedonali',()=>{
 const {map,detail}=fixture();detail.roads.push({id:'crossing',highway:'residential',width:6,points:[[0,-30],[0,0],[0,30]]});detail.roads[0].points=[[-30,0],[0,0],[30,0]];
 const plan=buildStreetDetailGeometry(map,detail);assert.ok(plan.stats.junctionGaps>0);
 for(const batch of plan.batches.filter(b=>b.surface!=='paint'))for(let i=0;i<batch.positions.length;i+=3)assert.ok(Math.hypot(batch.positions[i],batch.positions[i+2])>4);
});
test('limiti: dettaglio confinato ai primi600m del percorso e quantità limitata',()=>{
 const {map,detail}=fixture();map.land=[[[-1000,-1000],[2000,-1000],[2000,1000],[-1000,1000]]];detail.route=[[0,0],[1000,0]];detail.roads=[{id:'long',highway:'residential',width:6,points:[[-100,0],[1200,0]]}];
 const plan=buildStreetDetailGeometry(map,detail,{corridorRadius:30,maxSpans:5});assert.ok(plan.stats.curbSpans<=10);assert.ok(plan.stats.paintStrips<=10);assert.ok(plan.stats.vertexCount<500);
 const wide=buildStreetDetailGeometry(map,detail,{corridorRadius:30});for(const b of wide.batches)for(let i=0;i<b.positions.length;i+=3)assert.ok(b.positions[i]<=635);
 assert.throws(()=>buildStreetDetailGeometry(map,detail,{corridorRadius:Infinity}),RangeError);assert.equal(buildStreetDetailGeometry(map,detail,{maxRoads:0}).batches.length,0);
});
test('scene: geometria solo visiva, materiali forniti preservati e rilascio senza collider',()=>{
 const engine=new NullEngine({renderWidth:800,renderHeight:600,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
 try{const {map,detail}=fixture(),material=new StandardMaterial('materiale fornito',scene),result=addStreetDetail(scene,map,detail,{materials:{pavement:material}});assert.ok(result.meshes.length);for(const mesh of result.meshes){assert.equal(mesh.isPickable,false);assert.equal(mesh.checkCollisions,false);assert.equal(mesh.metadata.solid,false);}result.dispose();assert.ok(scene.materials.includes(material));assert.equal(scene.meshes.length,0);}finally{scene.dispose();engine.dispose();}
});
test('piedi: altezza indicizzata dei marciapiedi e cordoli, strada e vernice non rialzano',()=>{
 const engine=new NullEngine({renderWidth:800,renderHeight:600,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
 try{const {map,detail}=fixture(),result=addStreetDetail(scene,map,detail);assert.ok(Math.abs(result.heightAt(0,3.5)-.125)<1e-8);assert.ok(Math.abs(result.heightAt(0,-3.5)-.125)<1e-8);assert.ok(Math.abs(result.heightAt(0,3.1)-.12)<1e-8);assert.equal(result.heightAt(0,0),0);assert.equal(result.heightAt(0,2.77),0);assert.equal(result.heightAt(0,3.01),0);assert.equal(result.heightAt(0,6),0);assert.equal(result.heightAt(300,300),0);assert.equal(result.heightAt(NaN,Infinity),0);const paint=result.meshes.find(m=>m.metadata.surface==='paint')!;const positions=paint.getVerticesData('position')!;for(let i=1;i<positions.length;i+=3)assert.ok(positions[i]>.05);result.dispose();assert.equal(result.heightAt(0,3.5),0);}finally{scene.dispose();engine.dispose();}
});
test('piedi: query coincide con i triangoli superiori effettivamente emessi, anche ai giunti',()=>{
 const engine=new NullEngine({renderWidth:800,renderHeight:600,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
 try{const {map,detail}=fixture();detail.roads[0].points=[[-30,0],[0,0],[0,30]];detail.route=[[-30,0],[0,0],[0,30]];const plan=buildStreetDetailGeometry(map,detail),result=addStreetDetail(scene,map,detail);let count=0;
  for(const batch of plan.batches.filter(b=>b.surface!=='paint'))for(let i=0;i<batch.indices.length;i+=3){const [a,b,c]=batch.indices.slice(i,i+3).map(n=>batch.positions.slice(n*3,n*3+3));if(Math.abs(a[1]-b[1])>1e-7||Math.abs(a[1]-c[1])>1e-7)continue;const normalY=(a[2]-b[2])*(c[0]-b[0])-(a[0]-b[0])*(c[2]-b[2]);if(normalY<=1e-7)continue;assert.ok(Math.abs(result.heightAt((a[0]+b[0]+c[0])/3,(a[2]+b[2]+c[2])/3)-a[1])<1e-7);count++;}assert.ok(count>30);result.dispose();}finally{scene.dispose();engine.dispose();}
});
test('dati reali: dettaglio limitato al tragitto verificato e sorgente non alterata',()=>{
 const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;const before=JSON.stringify(map);const plan=buildStreetDetailGeometry(map,map.city!,{maxRoads:40,maxSpans:900});
 assert.ok(plan.stats.sidewalkSpans>0);assert.ok(plan.stats.vertexCount<150000);assert.ok(plan.stats.meshCount<100);assert.equal(JSON.stringify(map),before);
 for(const b of plan.batches.filter(b=>b.surface!=='paint'))for(let i=0;i<b.positions.length;i+=3){const p:Point=[b.positions[i],b.positions[i+2]];let minimum=Infinity;for(let j=1;j<map.city!.route.length;j++)minimum=Math.min(minimum,segmentDistance(p,map.city!.route[j-1],map.city!.route[j]));assert.ok(minimum>=1.09);}
});
test('piedi su pendio: marciapiedi negativi seguono i triangoli inclinati realmente emessi',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{
  const {map,detail}=fixture(),before=JSON.stringify({map,detail}),groundHeight=(x:number,z:number)=>-4+.09*x+.06*z;
  const flat=buildStreetDetailGeometry(map,detail),graded=buildStreetDetailGeometry(map,detail,{groundHeight}),result=addStreetDetail(scene,map,detail,{groundHeight});
  let count=0;
  for(const [index,batch]of graded.batches.entries()){
   const original=flat.batches[index];assert.deepEqual(batch.indices,original.indices);
   for(let i=0;i<batch.positions.length;i+=3)assert.ok(Math.abs(batch.positions[i+1]-original.positions[i+1]-groundHeight(batch.positions[i],batch.positions[i+2]))<1e-8);
   for(let i=0;i<batch.supportIndices.length;i+=3){
    const face=batch.supportIndices.slice(i,i+3).map(id=>batch.positions.slice(id*3,id*3+3)),x=face.reduce((n,p)=>n+p[0],0)/3,z=face.reduce((n,p)=>n+p[2],0)/3,y=face.reduce((n,p)=>n+p[1],0)/3;
    assert.ok(Math.abs(result.heightAt(x,z)-y)<1e-7);count++;
   }
  }
  assert.ok(count>30);assert.ok(result.heightAt(0,3.5)<0);assert.ok(Math.abs(result.heightAt(0,3.5)-(groundHeight(0,3.5)+.125))<1e-8);
  assert.equal(result.heightAt(0,0),groundHeight(0,0));assert.equal(result.supportHeightAt(0,3.01),undefined,'beveled curb front is not a walkable top');
  assert.equal(JSON.stringify({map,detail}),before);result.dispose();
 }finally{scene.dispose();engine.dispose();}
});
