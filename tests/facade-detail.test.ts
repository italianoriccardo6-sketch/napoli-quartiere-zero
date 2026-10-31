import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';
import {inside,type MapData,type Point} from '../src/geo';import {planFacadeDetail,addFacadeDetail} from '../src/facade-detail';
import type {CityMapData} from '../src/city-data';
const building=(id:string,ring:Point[])=>({id,rings:[ring],height:13,estimated:true});
const ring:Point[]=[[0,0],[18,0],[18,14],[0,14]];
function fixture():MapData{return{provenance:'osm',notice:'synthetic test',land:[[[-50,-50],[50,-50],[50,50],[-50,50]]],paths:[],buildings:[{...building('house',ring),rings:[ring,[[5,4],[13,4],[13,10],[5,10]]]}]};}
const options={focus:[[8,-8] as Point],radius:50,quality:'alta' as const,maxInstances:6000};
test('facciate: kit esterno deterministico, con finestre e balconi senza modificare sagome/cortili',()=>{
  const map=fixture(),before=JSON.stringify(map),a=planFacadeDetail(map,options),b=planFacadeDetail(map,options);
  assert.deepEqual(a,b);assert.equal(JSON.stringify(map),before);assert.ok(a.stats.windows>20);assert.ok(a.stats.balconies>0);assert.ok(a.parts.some(p=>p.feature==='shopfront'||p.feature==='door'));assert.ok(a.parts.some(p=>p.feature==='parapet'));
  for(const part of a.parts){assert.equal(inside([part.x,part.z],ring),false,part.feature+' entered footprint');assert.ok(part.width>0&&part.height>0&&part.depth>0);if(part.feature==='balcony'||part.feature==='rail')assert.ok(part.y>3);}
});
test('facciate: normale esterna valida anche con l’ordine dei vertici invertito',()=>{
  const map=fixture();map.buildings[0].rings[0]=[...ring].reverse();const plan=planFacadeDetail(map,options);assert.ok(plan.stats.windows>0);for(const p of plan.parts)assert.equal(inside([p.x,p.z],ring),false);
});
test('facciate: muri condivisi e monumenti riconoscibili non ricevono dettagli arbitrari',()=>{
  const map=fixture();map.buildings.push(building('neighbor',[[18,0],[30,0],[30,14],[18,14]]));map.buildings.push({...building('castle',[[-30,0],[-20,0],[-20,10],[-30,10]]),name:'Castel dell’Ovo'});
  const plan=planFacadeDetail(map,options);assert.equal(plan.stats.skippedLandmarks,1);assert.ok(!plan.parts.some(p=>p.buildingId==='castle'));assert.ok(!plan.parts.some(p=>p.buildingId==='house'&&p.x>18&&p.x<19&&p.z>0&&p.z<14),'details penetrate party-wall neighbor');
});
test('facciate: limiti di distanza, edifici e istanze mantengono il costo finito',()=>{
  const map=fixture();for(let i=0;i<50;i++)map.buildings.push(building('extra'+i,ring.map(([x,z])=>[x+100+i*25,z] as Point)));
  const plan=planFacadeDetail(map,{...options,maxBuildings:2,maxInstances:200});assert.ok(plan.parts.length<=200);assert.ok(plan.stats.selectedBuildings<=2);assert.ok(plan.stats.budgetReached);assert.equal(plan.stats.detailedBuildings,1);
  assert.equal(planFacadeDetail(map,{...options,focus:[[10000,10000]],radius:10}).parts.length,0);
});
test('facciate: thin instances a gruppi, senza picking/collisioni, con culling e dispose',()=>{
  const engine=new NullEngine({renderWidth:640,renderHeight:480,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
  try{const detail=addFacadeDetail(scene,fixture(),options);assert.ok(detail.stats.instances>200);assert.ok(detail.meshes.length<=32);assert.ok(detail.meshes.length<detail.stats.instances/10);let instances=0;for(const mesh of detail.meshes){assert.equal(mesh.isPickable,false);assert.equal(mesh.checkCollisions,false);assert.equal(mesh.metadata.solid,false);instances+=mesh.thinInstanceCount;}assert.equal(instances,detail.stats.instances);detail.update([8,-8],'bassa');assert.ok(detail.meshes.filter(m=>m.metadata.fine).every(m=>!m.isEnabled()));detail.update([10000,10000]);assert.ok(detail.meshes.every(m=>!m.isEnabled()));detail.update([8,-8]);assert.ok(detail.meshes.some(m=>m.isEnabled()));detail.dispose();assert.ok(detail.meshes.every(m=>m.isDisposed()));}finally{scene.dispose();engine.dispose();}
});

test('facciate: una lastra non attraversa un ostacolo vicino al bordo del suo ingombro',()=>{
  const map=fixture(),baseline=planFacadeDetail(map,options),balcony=baseline.parts.find(p=>p.feature==='balcony')!;
  const tx=Math.cos(balcony.yaw),tz=-Math.sin(balcony.yaw),nx=-tz,nz=tx;
  const cx=balcony.x+tx*balcony.width*.42+nx*balcony.depth*.35,cz=balcony.z+tz*balcony.width*.42+nz*balcony.depth*.35;
  map.buildings.push({id:'small-overhang-obstacle',height:.5,estimated:false,rings:[[[cx-.04,cz-.04],[cx+.04,cz-.04],[cx+.04,cz+.04],[cx-.04,cz+.04]]]});
  const after=planFacadeDetail(map,options);
  assert.ok(!after.parts.some(p=>p.feature==='balcony'&&Math.abs(p.x-balcony.x)<1e-8&&Math.abs(p.z-balcony.z)<1e-8&&p.y===balcony.y));
});

test('facciate: il punto iniziale e il muro davanti al giocatore precedono gli edifici lungo il resto del percorso',()=>{
  const map=fixture();map.buildings[0].rings[0]=[...ring.slice(2),...ring.slice(0,2)];
  map.buildings.push(building('distant-large-hotel',[[80,0],[180,0],[180,30],[80,30]]));
  const plan=planFacadeDetail(map,{...options,focus:[[8,-8],[95,-1]],maxBuildings:1,maxInstances:200});
  assert.ok(plan.parts.some(p=>p.role==='glass'));assert.ok(plan.parts.every(p=>p.buildingId==='house'),'un hotel vicino a un altro punto del percorso non esaurisce il budget iniziale');
  assert.ok(plan.parts.find(p=>p.role==='glass')!.z<0,'il muro più vicino viene dettagliato prima del retro, indipendentemente dal primo vertice OSM');
});

test('Napoli reale: entrambe le facciate iniziali ricevono finestre e i grandi edifici condividono il budget',()=>{
  const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData,before=JSON.stringify(map),city=map.city!;
  const plan=planFacadeDetail(map,{focus:[city.spawn,...city.route],radius:95,quality:'alta'}),counts=new Map<string,number>();
  for(const part of plan.parts)counts.set(part.buildingId,(counts.get(part.buildingId)??0)+1);
  for(const id of ['relation/1191261:0','way/310938477:0'])assert.ok(plan.parts.some(p=>p.buildingId===id&&p.role==='glass'),'finestre sul lato iniziale '+id);
  assert.ok(plan.stats.detailedBuildings>40,'il dettaglio raggiunge più di pochi hotel sul percorso');
  assert.ok([...counts.values()].every(count=>count<=4000),'nessuna facciata lunga assorbe il budget delle altre');
  assert.ok(plan.parts.length<=60000);assert.equal(JSON.stringify(map),before,'sagome, altezze e percorso originali preservati');
});
