import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';import {Vector3} from '@babylonjs/core/Maths/math.vector';import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
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

test('ombre facciate: soltanto gruppi strutturali vicini in alta qualità, con rimozione al cambio distanza e dispose',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),sun=new DirectionalLight('test sun',new Vector3(.6,-1,.4),scene),shadows=new ShadowGenerator(128,sun);
  try{
    const unrelated=MeshBuilder.CreateBox('other shadow caster',{},scene);shadows.addShadowCaster(unrelated,false);
    const detail=addFacadeDetail(scene,fixture(),{...options,shadows});
    const renderList=()=>shadows.getShadowMap()!.renderList!,facadeCasters=()=>renderList().filter(mesh=>mesh.metadata?.facadeDetail);
    assert.ok(detail.meshes.some(mesh=>mesh.metadata.fine),'la fixture comprende lamelle fini');assert.ok(detail.meshes.some(mesh=>mesh.metadata.facadeRole==='glass'),'la fixture comprende vetri');
    const initial=facadeCasters();assert.ok(initial.length>0);assert.ok(initial.every(mesh=>!mesh.metadata.fine&&mesh.metadata.facadeRole!=='glass'));
    detail.update([8,-8],'alta');assert.equal(facadeCasters().length,initial.length,'aggiornamenti ripetuti non duplicano i caster');
    detail.update([130,-8],'alta');assert.ok(detail.meshes.some(mesh=>mesh.isEnabled()),'i dettagli restano visibili oltre il raggio delle ombre');assert.equal(facadeCasters().length,0);
    detail.update([8,-8],'bassa');assert.equal(facadeCasters().length,0);assert.ok(renderList().includes(unrelated));
    detail.update([8,-8],'alta');assert.equal(facadeCasters().length,initial.length);
    detail.dispose();assert.ok(detail.meshes.every(mesh=>mesh.isDisposed()));assert.equal(renderList().length,1,'dispose rimuove solo i caster di questo kit');assert.equal(renderList()[0],unrelated);
  }finally{scene.dispose();engine.dispose();}
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

function elevatedFixture():MapData{
  return {provenance:'osm',notice:'synthetic separated building bases',land:[[[-50,-50],[150,-50],[150,80],[-50,80]]],paths:[],buildings:[building('house',ring.map(p=>[...p] as Point)),building('hill-house',ring.map(([x,z])=>[x+60,z] as Point))]};
}
const elevatedOptions={focus:[[8,-8],[68,-8]] as Point[],radius:90,quality:'alta' as const,maxBuildings:2,maxInstances:16000};
const buildingBases:Record<string,number>={house:-8.5,'hill-house':124.25};

test('facciate quotate: ogni elemento, comprese lamelle differite e ingressi, segue la base del proprio edificio',()=>{
  const map=elevatedFixture(),before=structuredClone(map),zero=planFacadeDetail(map,elevatedOptions),explicitZero=planFacadeDetail(map,{...elevatedOptions,buildingBaseHeight:()=>0});
  const elevated=planFacadeDetail(map,{...elevatedOptions,buildingBaseHeight:id=>buildingBases[id]});
  assert.deepEqual(explicitZero,zero,'la quota predefinita resta zero');assert.deepEqual(elevated.stats,zero.stats);assert.equal(elevated.parts.length,zero.parts.length);
  for(const id of Object.keys(buildingBases)){
    const parts=elevated.parts.filter(p=>p.buildingId===id);assert.ok(parts.length>100,'entrambi gli edifici hanno dettagli');
    assert.ok(parts.some(p=>p.feature==='door'||p.feature==='shopfront'),'ingressi alla stessa quota dell’edificio');
    assert.ok(parts.some(p=>p.feature==='balcony'),'balconi rialzati per entrambi gli edifici');
    assert.ok(parts.some(p=>p.feature==='shutter'&&p.role==='iron'&&p.height===.037),'lamelle fini accodate dopo gli elementi strutturali');
  }
  for(let i=0;i<zero.parts.length;i++){
    const base=zero.parts[i],part=elevated.parts[i];assert.ok(Math.abs(part.y-base.y-buildingBases[base.buildingId])<1e-12,'quota applicata una sola volta a '+base.buildingId+' / '+base.feature+' / '+base.role);
    assert.deepEqual({...part,y:base.y},base,'XZ, dimensioni, stile e identità rimangono invariati');
  }
  assert.deepEqual(map,before,'sagome, cortili e altezza sorgente non vengono modificati');
});

test('facciate quotate: tutte le matrici thin-instance conservano la traslazione Y pianificata, anche nei gruppi fini',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),map=elevatedFixture(),opts={...elevatedOptions,buildingBaseHeight:(id:string)=>buildingBases[id]};
  try{
    const plan=planFacadeDetail(map,opts),detail=addFacadeDetail(scene,map,opts),actual:Array<[number,number,number]>=[];
    assert.ok(detail.meshes.some(m=>m.metadata.fine));assert.ok(detail.meshes.some(m=>!m.metadata.fine));
    for(const mesh of detail.meshes)for(const matrix of mesh.thinInstanceGetWorldMatrices())actual.push([matrix.m[12],matrix.m[13],matrix.m[14]]);
    const expected=plan.parts.map(p=>[Math.fround(p.x),Math.fround(p.y),Math.fround(p.z)] as [number,number,number]);
    const order=(a:readonly number[],b:readonly number[])=>a[0]-b[0]||a[2]-b[2]||a[1]-b[1];
    assert.equal(actual.length,plan.parts.length);assert.deepEqual(actual.sort(order),expected.sort(order),'ogni traslazione delle istanze corrisponde alla quota del piano');
    assert.ok(actual.some(p=>p[1]<0),'la base negativa non viene appiattita a zero');assert.ok(actual.some(p=>p[1]>124),'la base alta non viene persa nella costruzione dei buffer');detail.dispose();
  }finally{scene.dispose();engine.dispose();}
});

test('facciate quotate: una base non finita viene respinta prima di creare mesh o materiali',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),map=elevatedFixture(),before=structuredClone(map);
  try{
    const meshCount=scene.meshes.length,materialCount=scene.materials.length;
    for(const invalid of [NaN,Infinity,-Infinity]){
      const opts={...elevatedOptions,buildingBaseHeight:(id:string)=>id==='hill-house'?invalid:buildingBases[id]};
      assert.throws(()=>planFacadeDetail(map,opts),'il planner deve respingere la seconda base non finita');
      assert.throws(()=>addFacadeDetail(scene,map,opts),'l’attachment deve respingere la base prima delle allocazioni');
      assert.equal(scene.meshes.length,meshCount);assert.equal(scene.materials.length,materialCount);assert.deepEqual(map,before);
    }
  }finally{scene.dispose();engine.dispose();}
});
