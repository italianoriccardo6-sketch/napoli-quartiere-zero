import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Canvas} from '@napi-rs/canvas';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {RawTexture} from '@babylonjs/core/Materials/Textures/rawTexture';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {Vector3,Matrix,Quaternion} from '@babylonjs/core/Maths/math.vector';
import {inside,toLocal,segmentDistance} from '../src/geo';
import type {CityMapData} from '../src/city-data';
import {planFacadeDetail} from '../src/facade-detail';
import {createCityWorld} from '../src/city-world';
import {SANTA_LUCIA_FRONT,SANTA_LUCIA_PHOTO,SANTA_LUCIA_ENTRANCE_PROXY,visualReplacementBuildingIds,planSantaLuciaFacade,addSantaLuciaFacade,validateSantaLuciaProjection} from '../src/santa-lucia-facade';

(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;

const actual=()=>JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
test('Santa Lucia: replacing the generic entrance volume preserves its source collision footprint',()=>{
  const map=actual(),before=JSON.stringify(map),ids=visualReplacementBuildingIds(map),proxy=map.buildings.find(b=>b.id===SANTA_LUCIA_ENTRANCE_PROXY.buildingId)!;
  assert.equal(ids.size,1);const center=proxy.rings[0].reduce((p,v)=>[p[0]+v[0]/proxy.rings[0].length,p[1]+v[1]/proxy.rings[0].length],[0,0]);
  const engine=new NullEngine(),scene=new Scene(engine);
  try{const world=createCityWorld(scene,map,map.city!,{visualReplacementBuildingIds:ids});assert.equal(world.canStand(center[0],center[1],.1),false);assert.ok(scene.meshes.every(m=>!m.metadata?.sourceIds?.includes(proxy.id)));assert.deepEqual(scene.metadata.cityWorld.visualReplacementBuildingIds,[proxy.id]);assert.equal(JSON.stringify(map),before);}finally{scene.dispose();engine.dispose();}
});
test('Santa Lucia: hotel identity, source wall geometry and calibrated photo remain distinct from Excelsior',()=>{
  const map=actual(),before=JSON.stringify(map),plan=planSantaLuciaFacade(map),source=SANTA_LUCIA_FRONT,building=map.buildings.find(b=>b.id===source.buildingId)!;
  assert.ok(plan.wall);assert.equal(building.height,19.200000000000003);
  assert.ok(inside(toLocal(source.corroboratingLocation.longitude,source.corroboratingLocation.latitude),building.rings[0]));
  assert.equal(inside(toLocal(source.corroboratingLocation.longitude,source.corroboratingLocation.latitude),building.rings[1]),false);
  assert.match(source.identitySource,/santalucia\.it/);assert.equal(source.corroboratingLocation.primary,false);
  assert.deepEqual([...plan.excludedEdges.keys()],['relation/1191265:0']);assert.deepEqual([...plan.excludedEdges.get(building.id)!],[1,2,3]);
  assert.ok(!plan.excludedEdges.has('relation/1191262:0'),'Excelsior/eastern source volume is not relabelled or removed');
  for(let i=0;i<plan.wall.positions.length;i+=3){const p:[number,number]=[plan.wall.positions[i],plan.wall.positions[i+2]],d=Math.min(...source.edges.map(edge=>segmentDistance(p,building.rings[0][edge],building.rings[0][(edge+1)%building.rings[0].length])));assert.ok(Math.abs(d-.04)<1e-5);assert.ok(plan.wall.positions[i+1]>=1.4-1e-8);assert.ok(plan.wall.positions[i+1]<=building.height+1e-8);}
  assert.ok(plan.wall.uvs.every(v=>v>=0&&v<=1));assert.equal(plan.wall.uvs.length,plan.wall.positions.length/3*2);
  assert.equal(JSON.stringify(map),before,'source footprint, source height and map remain unchanged');
});
test('Santa Lucia: a revised source front fails closed and does not hide generic architecture',()=>{
  const map=actual(),b=map.buildings.find(b=>b.id===SANTA_LUCIA_FRONT.buildingId)!;b.rings[0][2][0]+=.10;
  const plan=planSantaLuciaFacade(map);assert.equal(plan.wall,null);assert.equal(plan.parts.length,0);assert.equal(plan.excludedEdges.size,0);
});
test('Santa Lucia: observed iron upper guards and lower stone terrace replace the generic shutter overlay',()=>{
  const map=actual(),plan=planSantaLuciaFacade(map);assert.ok(plan.wall);
  assert.equal(plan.parts.filter(p=>p.feature==='window-pane').length,60,'five observed upper registers have twelve openings in ten architectural bays');
  assert.equal(plan.parts.filter(p=>p.feature==='stone-baluster').length,70,'individual stone guards are restricted to the lowest terrace row');
  assert.ok(plan.parts.some(p=>p.feature==='decorative-iron-loop'&&p.role==='iron'));assert.ok(plan.parts.some(p=>p.feature==='long-terrace-stone-cap'&&p.role==='frame'));
  assert.ok(plan.parts.filter(p=>p.feature==='balcony-corbel').length>=60);
  assert.ok(plan.parts.length<1500);assert.ok(plan.parts.every(p=>[p.x,p.y,p.z,p.width,p.height,p.depth,p.yaw].every(Number.isFinite)&&p.width>0&&p.height>0&&p.depth>0));
  const focus:[number,number][]=[[45.16974265235783,194.86476863362407]],baseline=planFacadeDetail(map,{focus,radius:95,quality:'alta'}),replaced=planFacadeDetail(map,{focus,radius:95,quality:'alta',excludeEdges:plan.excludedEdges});
  const frontShutters=(parts:typeof baseline.parts)=>parts.filter(p=>p.buildingId===SANTA_LUCIA_FRONT.buildingId&&p.feature==='shutter'&&p.z<210&&p.x>23&&p.x<63);
  assert.ok(frontShutters(baseline.parts).length>20,'regression fixture genuinely has the wrong generic shutter overlay');
  assert.equal(frontShutters(replaced.parts).length,0,'photographic pale stone facade is not double-drawn with invented hinged shutters');
  assert.ok(replaced.parts.some(p=>p.buildingId===SANTA_LUCIA_FRONT.buildingId&&p.z>220),'unconfirmed side faces keep their existing detail');
});
test('Santa Lucia: shared negative/high foundations move every wall/profile together without changing source dimensions',()=>{
  const map=actual(),before=JSON.stringify(map),low=planSantaLuciaFacade(map,{buildingBaseHeight:()=>-8.25}),high=planSantaLuciaFacade(map,{buildingBaseHeight:()=>24.75});
  assert.ok(low.wall&&high.wall);assert.equal(low.parts.length,high.parts.length);
  for(let i=0;i<low.wall.positions.length;i++){assert.ok(Math.abs(high.wall.positions[i]-low.wall.positions[i]-(i%3===1?33:0))<1e-8);}
  for(let i=0;i<low.parts.length;i++){assert.ok(Math.abs(high.parts[i].y-low.parts[i].y-33)<1e-8);for(const key of['x','z','width','height','depth','yaw']as const)assert.equal(low.parts[i][key],high.parts[i][key]);}
  assert.equal(JSON.stringify(map),before);
  assert.throws(()=>planSantaLuciaFacade(map,{buildingBaseHeight:()=>Infinity}),RangeError);
});
test('Santa Lucia: only the exact untagged entrance proxy can be replaced visually; source and collision footprints remain intact',()=>{
  const map=actual(),before=JSON.stringify(map),ids=visualReplacementBuildingIds(map),plan=planSantaLuciaFacade(map),proxy=map.buildings.find(b=>b.id===SANTA_LUCIA_ENTRANCE_PROXY.buildingId)!;
  assert.deepEqual([...ids],['way/338157976:0']);assert.ok(plan.portico);assert.equal(proxy.height,10);assert.equal(proxy.estimated,true);
  assert.ok(Math.abs(plan.portico.slabTop-3.84)<1e-10);assert.ok(Math.abs(plan.portico.cap-3.84)<1e-10);
  for(let i=0;i<plan.portico.positions.length;i+=3){const p:[number,number]=[plan.portico.positions[i],plan.portico.positions[i+2]];assert.ok(proxy.rings[0].some(q=>Math.hypot(q[0]-p[0],q[1]-p[1])<1e-8),'slab uses the actual source corners without expanding its footprint');}
  const centre:[number,number]=[42.75,206.85];assert.equal(inside(centre,proxy.rings[0]),true,'source polygon remains present for the world collision layer');assert.equal(JSON.stringify(map),before);
  proxy.estimated=false;assert.equal(visualReplacementBuildingIds(map).size,0,'new measured height evidence must not be silently discarded');assert.equal(planSantaLuciaFacade(map).portico,null);
  proxy.estimated=true;proxy.rings[0][0][0]+=.03;assert.equal(visualReplacementBuildingIds(map).size,0,'a revised source footprint invalidates the architectural replacement');
  const missing=actual();missing.buildings=missing.buildings.filter(b=>b.id!==SANTA_LUCIA_FRONT.buildingId);assert.equal(visualReplacementBuildingIds(missing).size,0,'proxy cannot be removed without the confirmed parent hotel');
});
test('Santa Lucia: four confirmed entry openings and flat coping remain inside the unchanged entrance footprint',()=>{
  const map=actual(),plan=planSantaLuciaFacade(map,{buildingBaseHeight:()=>-6.25}),ring=map.buildings.find(b=>b.id===SANTA_LUCIA_ENTRANCE_PROXY.buildingId)!.rings[0];assert.ok(plan.portico);
  const parts=plan.parts.filter(p=>p.feature.startsWith('portico-'));assert.ok(parts.length>=68);assert.equal(parts.filter(p=>p.feature==='portico-arch-moulding').length,48);assert.ok(parts.every(p=>!p.feature.includes('balustrade')&&!p.feature.includes('baluster')),'the photograph supports a flat canopy, not a new stone roof guard');
  const insideOrBoundary=(p:[number,number])=>inside(p,ring)||ring.some((a,i)=>segmentDistance(p,a,ring[(i+1)%ring.length])<1e-6);
  for(const p of parts){const transform=Matrix.Compose(new Vector3(p.width,p.height,p.depth),Quaternion.RotationYawPitchRoll(p.yaw,0,p.roll),new Vector3(p.x,p.y,p.z));for(const x of[-.5,.5])for(const y of[-.5,.5])for(const z of[-.5,.5]){const corner=Vector3.TransformCoordinates(new Vector3(x,y,z),transform);assert.ok(insideOrBoundary([corner.x,corner.z]),p.feature+' footprint must not invent additional land or a wider canopy');}assert.ok(p.y+p.height*.55<=plan.portico.cap+.1);}
  assert.ok(Math.abs(plan.portico.slabTop-(-6.25+3.84))<1e-9);assert.ok(Math.abs(plan.portico.cap-(-6.25+3.84))<1e-9);
});
test('Santa Lucia: borrowed photo/materials survive cleanup and original architectural depth casts real scene shadows',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),photo=new PBRMaterial('borrowed original CC0 panorama',scene),frame=new PBRMaterial('borrowed trim',scene),glass=new PBRMaterial('borrowed glass',scene),iron=new PBRMaterial('borrowed iron',scene),light=new DirectionalLight('test sun',new Vector3(.65,-.8,.5),scene),shadows=new ShadowGenerator(256,light);
  try{
    const result=addSantaLuciaFacade(scene,actual(),{photoMaterial:photo,materials:{frame,glass,iron},buildingBaseHeight:()=>-3.5,shadows});
    assert.equal(result.stats.walls,1);assert.equal(result.meshes[0].material,photo);assert.ok(result.profileMeshes.length<=6);assert.ok(result.stats.profileInstances>600);
    assert.ok(result.profileMeshes.every(m=>m.metadata.role!=='glass'),'photo curtains and roller variations are preserved instead of covered by new dark panes');
    const renderList=shadows.getShadowMap()!.renderList!;assert.ok(result.profileMeshes.every(m=>renderList.includes(m)));
    for(const mesh of result.meshes){assert.equal(mesh.isPickable,false);assert.equal(mesh.checkCollisions,false);assert.equal(mesh.metadata.solid,false);}
    result.dispose();assert.equal(scene.meshes.length,0);assert.ok(result.profileMeshes.every(m=>!renderList.includes(m)));for(const material of[photo,frame,glass,iron])assert.ok(scene.materials.includes(material));
    assert.throws(()=>addSantaLuciaFacade(scene,actual(),{buildingBaseHeight:()=>NaN}),RangeError);assert.equal(scene.meshes.length,0,'nonfinite foundation is rejected before allocating geometry');
  }finally{shadows.dispose();scene.dispose();engine.dispose();}
});
test('Santa Lucia: original photo and separately accessible FAL calibration retain provenance and source identity',()=>{
  const base='public/assets/santa-lucia-pitrou-2011/',image=readFileSync(base+'source.jpg'),metadata=JSON.parse(readFileSync(base+'source-metadata.json','utf8')),raw=JSON.parse(readFileSync(base+'projection.json','utf8'));
  assert.equal(image.length,1236557);assert.equal(createHash('sha256').update(image).digest('hex'),SANTA_LUCIA_PHOTO.sha256);assert.equal(metadata.author,'Antoine Pitrou');assert.equal(metadata.sourceYear,2011);assert.equal(metadata.originalBytesUnchanged,true);assert.equal(validateSantaLuciaProjection(raw).license,'FAL-1.3');
  assert.match(readFileSync(base+'LICENSE-FAL-1.3.txt','utf8'),/4\. INCORPORATION OF THE WORK/);assert.match(readFileSync(base+'NOTICE.txt','utf8'),/projection\.json/);
  const wrong=structuredClone(raw);wrong.photo.sha256='0'.repeat(64);assert.throws(()=>validateSantaLuciaProjection(wrong),/non valida/);const changed=structuredClone(raw);changed.wall.sourcePoints[0][0]+=.1;assert.throws(()=>validateSantaLuciaProjection(changed),/parete Santa Lucia/);
});
test('Santa Lucia: ready waits for the owned original photo and cleanup preserves borrowed materials',async()=>{
  const engine=new NullEngine(),scene=new Scene(engine),borrowed=new PBRMaterial('old borrowed photograph',scene),frame=new PBRMaterial('borrowed frame',scene),glass=new PBRMaterial('borrowed glass',scene),iron=new PBRMaterial('borrowed iron',scene),texture=RawTexture.CreateRGBATexture(new Uint8Array([255,255,255,255]),1,1,scene,false,false,Texture.NEAREST_SAMPLINGMODE);
  let resolve!:()=>void,url='';const loaded=new Promise<void>(yes=>resolve=yes);
  try{
    const result=addSantaLuciaFacade(scene,actual(),{loadPhoto:true,photoMaterial:borrowed,materials:{frame,glass,iron},photoTextureLoader:value=>{url=value;return{texture,ready:loaded};}}),material=result.meshes[0].material as PBRMaterial;
    let ready=false;void result.ready.then(()=>ready=true);await Promise.resolve();assert.equal(ready,false);assert.notEqual(material,borrowed,'the playable scene must own its new photograph rather than accidentally retaining the old CC0 panorama');assert.equal(material.albedoTexture,texture);assert.equal(texture.gammaSpace,true);assert.match(url,/santa-lucia-pitrou-2011\/source\.jpg$/);
    resolve();await result.ready;assert.equal(ready,true);assert.equal(material.metadata.assetLicense,'FAL-1.3');result.dispose();assert.equal(scene.meshes.length,0);assert.ok(!scene.materials.includes(material));assert.ok(!scene.textures.includes(texture));for(const m of[borrowed,frame,glass,iron])assert.ok(scene.materials.includes(m));
    const failedTexture=RawTexture.CreateRGBATexture(new Uint8Array([0,0,0,255]),1,1,scene,false,false),failed=addSantaLuciaFacade(scene,actual(),{loadPhoto:true,photoTextureLoader:()=>({texture:failedTexture,ready:Promise.reject(new Error('photo unavailable'))})});await assert.rejects(failed.ready,/photo unavailable/);failed.dispose();assert.equal(scene.meshes.length,0);assert.ok(!scene.textures.includes(failedTexture));
  }finally{scene.dispose();engine.dispose();}
});
