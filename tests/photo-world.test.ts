import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {inside,toLocal,type Point} from '../src/geo';
import {NAPOLI_QUARTIERI} from '../src/napoli-sectors';
import type {CityMapData} from '../src/city-data';
import {createPhotoSourceCollision,photoCarCanStand,photoCarBlocksPoint} from '../src/photo-driving';

const read=(name:string)=>readFileSync(name,'utf8');
const base=JSON.parse(read('public/data/map.json')) as CityMapData;
const bytes=read('public/data/photo-world.json');
const world=JSON.parse(bytes) as CityMapData&{photoWorld:{stats:{tilesRead:number;tilesVisited:number;missingTiles:string[];buildingHoles:number};limitations:string[];snapshot:string}};
const provenance=JSON.parse(read('data/photo-world/source.json'));
const collision=createPhotoSourceCollision(world);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const normal=(name:string)=>name.toLowerCase().replaceAll('’',"'");
const land=(p:Point)=>world.city!.landPolygons!.some(a=>inside(p,a[0])&&!a.slice(1).some(h=>inside(p,h)));
const bounds=(ring:Point[])=>ring.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity]);
const area=(ring:Point[])=>Math.abs(ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0))/2;

test('municipal photo world: pinned source/output checksums, complete tile acquisition and honest source resolution',()=>{
 assert.equal(hash(bytes),provenance.output.sha256);
 assert.equal(hash(read('public/data/map.json')),provenance.base.sha256);
 assert.equal(hash(read('public/data/napoli-boundary.json')),provenance.municipalBoundary.sha256);
 assert.equal(hash(read('scripts/prepare-photo-world.mjs')),provenance.generatorSha256);
 assert.equal(provenance.source.zipSha256,'57ef9036fdf84348dd7ce2a72c7c348144873f4c09a9d65e8c36a280fe0df4df');
 assert.equal(provenance.source.memberSha256,'2d2ed152842145a52b16d42210a434350e43f5e014b991dd970662c4272a00b9');
 assert.equal(provenance.license.geometry,'ODbL-1.0');assert.equal(provenance.license.municipalBoundary,'CC-BY-4.0');
 assert.equal(world.photoWorld.stats.tilesRead,world.photoWorld.stats.tilesVisited);assert.deepEqual(world.photoWorld.stats.missingTiles,[]);
 assert.ok(world.photoWorld.stats.tilesRead>=190);assert.ok(world.buildings.length>55000);assert.ok(world.city!.roads.length>20000);
 assert.ok(world.photoWorld.stats.buildingHoles>1700);assert.equal(provenance.coordinateEncodingMetres,.001);
 assert.ok(world.photoWorld.limitations.some((x:string)=>x.includes('not advertised as native OSM element IDs')));
 assert.ok(bytes.length<25*1024*1024,'Municipal collision artifact stays within its measured load budget.');
});

test('municipal photo world: central source IDs, courtyards, exact geometry and mission remain intact',()=>{
 assert.deepEqual(world.buildings.slice(0,base.buildings.length),base.buildings);
 assert.deepEqual(world.city!.landPolygons!.slice(0,base.city!.landPolygons!.length),base.city!.landPolygons);
 assert.deepEqual(world.city!.roads.slice(0,base.city!.roads.length),base.city!.roads);
 for(const field of ['spawn','scooter','pickup','delivery','route','routeNames'] as const)assert.deepEqual(world.city![field],base.city![field]);
 const central=base.city!.bounds;
 for(const building of world.buildings.slice(base.buildings.length)){
  const b=bounds(building.rings[0]);assert.ok(!(b[0]<=central[2]&&b[2]>=central[0]&&b[1]<=central[3]&&b[3]>=central[1]),`New footprint enters the reviewed centre: ${building.id}`);
  assert.equal(building.height,10);assert.equal(building.estimated,true);assert.ok(building.id.startsWith('mvt-building/'));
 }
 const original=createPhotoSourceCollision(base);let checked=0;
 for(let x=central[0]+10;x<central[2]-10;x+=97)for(let z=central[1]+10;z<central[3]-10;z+=97){assert.equal(collision.canStand(x,z,.55),original.canStand(x,z,.55),`Central collision changed at ${x},${z}`);checked++;}
 assert.ok(checked>350);
});

test('municipal photo world: 29 source-labelled quartieri and Gianturco have actual full-car clear street probes',()=>{
 const names=new Set<string>();
 for(const name of NAPOLI_QUARTIERI){
  const label=provenance.placeLabels.find((p:{name:string;point:Point})=>normal(p.name)===normal(name));
  // The basemap has no official Zona Industriale label. Its real Gianturco
  // corridor is a coverage probe, not an invented administrative centroid.
  const industrial=name==='Zona Industriale';assert.ok(label||industrial,`No source-backed probe for ${name}`);
  if(label)assert.ok(land(label.point),`The source place label is outside measured land: ${name}`);
  let found=false;
  for(const road of world.city!.roads){
   const r=road as typeof road&{bridge?:string;tunnel?:string;access?:string};
   if(!['primary','secondary','tertiary','residential','living_street','unclassified','service','pedestrian'].includes(r.highway)||r.bridge==='yes'||r.tunnel==='yes'||r.access==='private')continue;
   if(industrial&&r.name!=='Via Emanuele Gianturco')continue;
   for(let i=1;i<r.points.length;i++){
    const a=r.points[i-1],b=r.points[i],p:Point=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    if(label&&Math.hypot(p[0]-label.point[0],p[1]-label.point[1])>500)continue;
    const heading=Math.atan2(b[0]-a[0],b[1]-a[1]);if(photoCarCanStand(p,heading,collision.canStand)){found=true;break;}
   }
   if(found)break;
  }
  assert.ok(found,`No actual street with full-car clearance near the source probe: ${name}`);names.add(name);
 }
 assert.equal(names.size,30);
});

test('municipal photo world: Gulf, Bagnoli, Posillipo, eastern coast and port water stay blocked',()=>{
 for(const [lon,lat]of [[14.25,40.80],[14.15,40.81],[14.20,40.79],[14.30,40.82],[14.27,40.835]]){
  const p=toLocal(lon,lat);assert.equal(land(p),false,`Water promoted to land at ${lon},${lat}`);assert.equal(collision.canStand(...p,.55),false);
 }
 const municipal=JSON.parse(read('public/data/napoli-boundary.json')).geometry.coordinates.map((p:Point[][])=>p.map(r=>r.map(([lon,lat])=>toLocal(lon,lat)))) as Point[][][];
 const insideMunicipality=(p:Point)=>municipal.some(a=>inside(p,a[0])&&!a.slice(1).some(h=>inside(p,h)));
 // Water holes inside the administrative border prove that the border was
 // never used as a filled land polygon. They also exercise shoreline clearance.
 let checked=0;
 for(const polygon of world.city!.landPolygons!)for(const hole of polygon.slice(1)){
  if(area(hole)<1000)continue;
  const p=hole.reduce((sum,q)=>[sum[0]+q[0]/hole.length,sum[1]+q[1]/hole.length] as Point,[0,0] as Point);
  if(!inside(p,hole)||!insideMunicipality(p)||land(p))continue;
  assert.equal(collision.canStand(...p,.55),false);checked++;
 }
 assert.ok(checked>=10,'Mapped inland water remains separate from municipal coverage.');
 assert.equal(collision.canStand(-50000,0,.55),false);
});

test('district fast travel: all 30 anchors have source lineage, a clear full car and a clear pedestrian beside it',()=>{
 const bytes=read('public/data/photo-districts.json'),manifest=JSON.parse(bytes),review=provenance.districtAnchors;
 assert.equal(hash(bytes),review.sha256);assert.equal(manifest.worldSha256,provenance.output.sha256);
 assert.equal(hash(read('scripts/prepare-photo-districts.ts')),review.generatorSha256);
 assert.deepEqual(manifest.districts.map((p:{name:string})=>p.name),[...NAPOLI_QUARTIERI]);
 for(const anchor of manifest.districts){
  const {position,heading,footPosition,source}=anchor.drive;
  assert.ok(photoCarCanStand(position,heading,collision.canStand,manifest.vehicle),`Full car blocked at ${anchor.name}`);
  assert.ok(collision.canStand(...footPosition as Point,manifest.vehicle.footRadius),`Adjacent pedestrian blocked at ${anchor.name}`);
  assert.equal(photoCarBlocksPoint(footPosition,position,heading,manifest.vehicle,manifest.vehicle.footRadius),false);
  assert.ok(Math.hypot(footPosition[0]-position[0],footPosition[1]-position[1])<4);
  const road=world.city!.roads.find(r=>r.id===source.roadId);assert.ok(road,`Unknown source road for ${anchor.name}`);
  const a=road.points[source.segment],b=road.points[source.segment+1];assert.ok(a&&b);
  assert.ok(Math.hypot(position[0]-a[0]-(b[0]-a[0])*source.fraction,position[1]-a[1]-(b[1]-a[1])*source.fraction)<1e-6,'Placement remains on its documented source centreline.');
  if(anchor.name==='Zona Industriale'){assert.equal(anchor.source.layer,'roads');assert.equal(anchor.source.label,'Via Emanuele Gianturco');}
  else {
   const label=provenance.placeLabels.find((p:{name:string})=>normal(p.name)===normal(anchor.name));
   assert.ok(label);assert.deepEqual(anchor.position,label.point);assert.deepEqual(anchor.source.coordinate,label.coordinate);assert.equal(anchor.source.id,label.sourceFeatureId);
  }
 }
});
