import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';
import {inside,toLocal,segmentDistance,type Point} from '../src/geo';import type {CityMapData} from '../src/city-data';
import {photoProjection,planNaplesFacades,planNaplesFacadeProfiles,addNaplesFacades,NAPLES_PHOTO_FACES,NAPLES_FACADE_PHOTO} from '../src/naples-facades';
import {planFacadeDetail} from '../src/facade-detail';
const map=()=>JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
test('foto: omografia proiettiva conserva tutti i vertici nativi e orientamento top-left',()=>{
  const quad:[Point,Point,Point,Point]=[[10,20],[180,30],[150,170],[30,160]],project=photoProjection(quad,200,200);
  for(const[i,[s,t]]of([[0,0],[1,0],[1,1],[0,1]] as Point[]).entries()){const uv=project(s,t);assert.ok(Math.abs(uv[0]-quad[i][0]/200)<1e-10);assert.ok(Math.abs(uv[1]-quad[i][1]/200)<1e-10);}
  assert.ok(project(.5,0)[1]<project(.5,1)[1]);assert.ok(Math.abs(project(.5,.5)[0]-.4625)>.001,'la prospettiva non è una semplice media affine dei quattro UV');
  assert.throws(()=>photoProjection([[0,0],[1,1],[1,0],[0,1]],2,2),RangeError);
});
test('Napoli: due fronti identificati su impronte originali, senza alterare sagome o altezze',()=>{
  const source=map(),before=JSON.stringify(source),plan=planNaplesFacades(source),point=toLocal(14.2481853,40.830084),vesuvio=source.buildings.find(b=>b.id==='way/337012555:0')!;
  assert.ok(inside(point,vesuvio.rings[0]),'il punto pubblicato dal sito ufficiale del Vesuvio cade in questa impronta');assert.equal(plan.walls.length,2);assert.equal(plan.skipped.length,0);
  for(const wall of plan.walls){const b=source.buildings.find(b=>b.id===wall.buildingId)!;assert.equal(wall.height,b.height);assert.equal(Math.max(...wall.positions.filter((_,i)=>i%3===1)),b.height);assert.ok(wall.positions.length/3<1000);assert.equal(wall.uvs2.length,wall.uvs.length);
    for(let i=0;i<wall.positions.length;i+=3){const p:Point=[wall.positions[i],wall.positions[i+2]],distance=Math.min(...wall.sourceEdges.map(edge=>segmentDistance(p,b.rings[0][edge],b.rings[0][(edge+1)%b.rings[0].length])));assert.ok(Math.abs(distance-.04)<1e-5,'i segmenti OSM quasi collineari restano entro10micrometri dall’offset previsto');assert.equal(inside(p,b.rings[0]),false);assert.ok(wall.positions[i+1]>=1.4-1e-8);}
    assert.ok(wall.uvs.every(n=>n>=0&&n<=1));
  }
  assert.equal(JSON.stringify(source),before);assert.equal(NAPLES_FACADE_PHOTO.license,'CC0-1.0');assert.match(plan.calibration,/not surveyed/);
});
test('foto: un cambiamento della geografia impedisce di attribuire la foto al muro sbagliato',()=>{
  const source=map(),face=NAPLES_PHOTO_FACES[0],b=source.buildings.find(b=>b.id===face.buildingId)!;b.rings[0][29][0]+=1;
  const plan=planNaplesFacades(source);assert.ok(plan.skipped.includes(face.buildingId));assert.ok(!plan.excludedBuildingIds.has(face.buildingId));assert.equal(plan.walls.length,1);
});
test('architettura: griglia moderna senza persiane, sette colonne di archi e balconi curvi',()=>{
  const source=map(),plan=planNaplesFacades(source),parts=planNaplesFacadeProfiles(source,plan.excludedBuildingIds),royal=parts.filter(p=>p.buildingId==='relation/4779351:1'),vesuvio=parts.filter(p=>p.buildingId==='way/337012555:0');
  assert.equal(royal.filter(p=>p.role==='glass').length,100,'90vetri delle nove fasce e10vetri del registro superiore');assert.ok(royal.every(p=>p.kind==='box'));assert.equal(vesuvio.filter(p=>p.kind==='arch').length,7*4);assert.equal(vesuvio.filter(p=>p.kind==='curved-slab').length,7*4);
  assert.ok(royal.length<3500&&vesuvio.length<3500);assert.ok(parts.every(p=>[p.x,p.y,p.z,p.width,p.height,p.depth,p.yaw,p.roll].every(Number.isFinite)&&p.width>0&&p.height>0&&p.depth>0));
  const generic=planFacadeDetail(source,{focus:[source.city!.spawn,...source.city!.route],radius:95,quality:'alta',excludeBuildingIds:plan.excludedBuildingIds});assert.ok(generic.parts.every(p=>!plan.excludedBuildingIds.has(p.buildingId)));assert.ok(generic.parts.some(p=>p.buildingId==='relation/1191261:0'),'PalazzoSantaLucia non viene eliminato dal kit generale');
});
test('scene: foto e profondità in pochi batch, senza collider, con rilascio completo',async()=>{
  const engine=new NullEngine({renderWidth:640,renderHeight:480,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
  try{const result=addNaplesFacades(scene,map(),{loadTexture:false});await result.ready;assert.equal(result.photoMeshes.length,2);assert.ok(result.profileMeshes.length<=6);assert.ok(result.stats.profileInstances>1000);assert.equal(result.profileMeshes.reduce((n,m)=>n+m.thinInstanceCount,0),result.stats.profileInstances);for(const mesh of result.meshes){assert.equal(mesh.isPickable,false);assert.equal(mesh.checkCollisions,false);assert.equal(mesh.metadata.solid,false);}result.dispose();assert.equal(scene.meshes.length,0);assert.equal(scene.materials.length,0);}finally{scene.dispose();engine.dispose();}
});

test('quote: i due hotel conservano foto, altezza e impronta su basi negative e rialzate',()=>{
  const source=map(),before=JSON.stringify(source),baseById=new Map([['relation/4779351:1',-5.75],['way/337012555:0',24.125]]),options={buildingBaseHeight:(id:string)=>baseById.get(id)??0};
  const flat=planNaplesFacades(source),raised=planNaplesFacades(source,options),flatParts=planNaplesFacadeProfiles(source,flat.excludedBuildingIds),raisedParts=planNaplesFacadeProfiles(source,raised.excludedBuildingIds,options);
  assert.deepEqual(raised.excludedBuildingIds,flat.excludedBuildingIds);assert.deepEqual(raised.skipped,flat.skipped);
  for(let w=0;w<flat.walls.length;w++){
    const a=flat.walls[w],b=raised.walls[w],base=baseById.get(a.buildingId)!;
    assert.equal(b.height,a.height,'source height is relative to its foundation, not absolute roof elevation');assert.deepEqual(b.bounds,a.bounds);assert.deepEqual(b.sourceEdges,a.sourceEdges);assert.deepEqual(b.uvs,a.uvs);assert.deepEqual(b.uvs2,a.uvs2);assert.deepEqual(b.indices,a.indices);assert.deepEqual(b.normals,a.normals);
    for(let i=0;i<a.positions.length;i++){if(i%3===1)assert.ok(Math.abs(b.positions[i]-a.positions[i]-base)<1e-10);else assert.equal(b.positions[i],a.positions[i]);}
    const ys=b.positions.filter((_,i)=>i%3===1);assert.ok(Math.abs(Math.min(...ys)-(base+1.4))<1e-10);assert.ok(Math.abs(Math.max(...ys)-(base+a.height))<1e-10);
  }
  assert.equal(raisedParts.length,flatParts.length);
  for(let i=0;i<flatParts.length;i++){const a=flatParts[i],b=raisedParts[i];assert.ok(Math.abs(b.y-a.y-baseById.get(a.buildingId)!)<1e-10);assert.deepEqual({...b,y:a.y},a,'shape, rotation, materials and source X/Z stay unchanged');}
  assert.ok(raisedParts.some(p=>p.buildingId==='relation/4779351:1'&&p.y<0),'a low foundation does not clamp the lower profiles to zero');assert.equal(JSON.stringify(source),before);
});

test('scene: a single foundation value moves the photo and every profile instance without retinting',async()=>{
  const source=map(),before=JSON.stringify(source),engine=new NullEngine(),flatScene=new Scene(engine),raisedScene=new Scene(engine),baseById=new Map([['relation/4779351:1',-5.75],['way/337012555:0',24.125]]),calls=new Map<string,number>();
  try{
    const flat=addNaplesFacades(flatScene,source,{loadTexture:false}),raised=addNaplesFacades(raisedScene,source,{loadTexture:false,buildingBaseHeight:id=>{const count=(calls.get(id)??0)+1;calls.set(id,count);return baseById.get(id)!+(count-1)*100;}});await Promise.all([flat.ready,raised.ready]);
    assert.deepEqual([...calls.values()],[1,1],'photo and profile share one cached base per building');
    for(let w=0;w<flat.photoMeshes.length;w++){const a=flat.photoMeshes[w],b=raised.photoMeshes[w],ap=a.getVerticesData('position')!,bp=b.getVerticesData('position')!,base=baseById.get(a.metadata.buildingId)!;for(let i=0;i<ap.length;i++){if(i%3===1)assert.ok(Math.abs(bp[i]-ap[i]-base)<1e-5);else assert.equal(bp[i],ap[i]);}for(const attribute of ['uv','uv2','normal'])assert.deepEqual(b.getVerticesData(attribute),a.getVerticesData(attribute));}
    const plan=planNaplesFacades(source),parts=planNaplesFacadeProfiles(source,plan.excludedBuildingIds),groups=new Map<string,typeof parts>();for(const p of parts){const key=p.role+':'+p.kind,list=groups.get(key)??[];list.push(p);groups.set(key,list);}
    for(let m=0;m<flat.profileMeshes.length;m++){
      const a=flat.profileMeshes[m],b=raised.profileMeshes[m],key=a.name.split(' · ').at(-1)!,group=groups.get(key)!,am=a.thinInstanceGetWorldMatrices(),bm=b.thinInstanceGetWorldMatrices();assert.equal(am.length,group.length);assert.equal(bm.length,am.length);
      const appearanceA=a.material!.serialize(),appearanceB=b.material!.serialize();delete appearanceA.uniqueId;delete appearanceB.uniqueId;assert.deepEqual(appearanceB,appearanceA,'foundation offsets keep the established profile material colours and PBR values');
      for(let i=0;i<am.length;i++)for(let axis=0;axis<16;axis++){if(axis===13)assert.ok(Math.abs(bm[i].m[axis]-am[i].m[axis]-baseById.get(group[i].buildingId)!)<1e-5);else assert.equal(bm[i].m[axis],am[i].m[axis]);}
    }
    assert.equal(JSON.stringify(source),before);flat.dispose();raised.dispose();
  }finally{flatScene.dispose();raisedScene.dispose();engine.dispose();}
});

test('quote: una base non finita fallisce prima di creare foto, materiali o istanze',()=>{
  const source=map(),plan=planNaplesFacades(source),engine=new NullEngine(),scene=new Scene(engine);
  try{for(const base of [NaN,Infinity,-Infinity]){
    const options={buildingBaseHeight:()=>base};assert.throws(()=>planNaplesFacades(source,options),/base facciata non finita/);assert.throws(()=>planNaplesFacadeProfiles(source,plan.excludedBuildingIds,options),/base facciata non finita/);
    const before=[scene.meshes.length,scene.materials.length,scene.textures.length];assert.throws(()=>addNaplesFacades(scene,source,{...options,loadTexture:false}),/base facciata non finita/);assert.deepEqual([scene.meshes.length,scene.materials.length,scene.textures.length],before);
  }}finally{scene.dispose();engine.dispose();}
});
