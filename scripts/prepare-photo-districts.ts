/** Source-backed fast-travel anchors, using the same full collision capsule as gameplay. */
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import type {CityMapData} from '../src/city-data';
import type {Point} from '../src/geo';
import {NAPOLI_QUARTIERI} from '../src/napoli-sectors';
import {createPhotoSourceCollision,photoCarCanStand,photoCarBlocksPoint} from '../src/photo-driving';

type Label={name:string;kind:string;detail:string;point:Point;coordinate:Point;sourceTile:string;sourceFeatureId:number|null};
type Road=NonNullable<CityMapData['city']>['roads'][number]&{access?:string;bridge?:string;tunnel?:string};
interface Candidate {point:Point;heading:number;distance:number;road:Road;segment:number;t:number}
const sha=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
const sourcePath='data/photo-world/source.json',output='public/data/photo-districts.json';
const worldBytes=await readFile('public/data/photo-world.json'),world=JSON.parse(worldBytes.toString()) as CityMapData;
const source=JSON.parse(await readFile(sourcePath,'utf8'));
const worldSha256=sha(worldBytes),generatorSha256=sha(await readFile(fileURLToPath(import.meta.url)));
if(source.output.sha256!==worldSha256||!world.city)throw Error('Photo world differs from its source review. Rebuild it first.');
const collision=createPhotoSourceCollision(world),size={radius:1.3085043,halfLength:2.225},footRadius=.5;
const normal=(value:string)=>value.toLowerCase().replaceAll('’',"'");
const drivable=(r:Road)=>['primary','secondary','tertiary','residential','living_street','unclassified','service','pedestrian'].includes(r.highway)&&r.bridge!=='yes'&&r.tunnel!=='yes'&&!['private','no'].includes(r.access??'');
const roads=world.city.roads.filter(drivable) as Road[];
const labels=source.placeLabels as Label[];
function beside(point:Point,heading:number):Point|null {
 const right:Point=[Math.cos(heading),-Math.sin(heading)],forward:Point=[Math.sin(heading),Math.cos(heading)];
 for(const gap of [.25,.5,.75])for(const along of [0,-.6,.6])for(const sign of [1,-1]){
  const distance=size.radius+footRadius+gap,p:Point=[point[0]+right[0]*distance*sign+forward[0]*along,point[1]+right[1]*distance*sign+forward[1]*along];
  if(collision.canStand(...p,footRadius)&&!photoCarBlocksPoint(p,point,heading,size,footRadius))return p;
 }
 for(const sign of [-1,1]){
  const distance=size.halfLength+footRadius+.25,p:Point=[point[0]+forward[0]*distance*sign,point[1]+forward[1]*distance*sign];
  if(collision.canStand(...p,footRadius)&&!photoCarBlocksPoint(p,point,heading,size,footRadius))return p;
 }
 return null;
}
function clearPlacement(reference:Point,onlyRoad?:string){
 const candidates:Candidate[]=[];
 for(const road of roads){
  if(onlyRoad&&road.name!==onlyRoad)continue;
  for(let i=1;i<road.points.length;i++){
   const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],d2=dx*dx+dz*dz;if(d2<.01)continue;
   const projection=Math.max(0,Math.min(1,((reference[0]-a[0])*dx+(reference[1]-a[1])*dz)/d2));
   for(const t of [projection,.5,.25,.75]){
    const point:Point=[a[0]+dx*t,a[1]+dz*t],distance=Math.hypot(point[0]-reference[0],point[1]-reference[1]);if(distance>500)continue;
    candidates.push({point,heading:Math.atan2(dx,dz),distance,road,segment:i-1,t});
   }
  }
 }
 candidates.sort((a,b)=>a.distance-b.distance||(a.road.id<b.road.id?-1:a.road.id>b.road.id?1:0)||a.segment-b.segment||a.t-b.t);
 for(const candidate of candidates){
  if(!photoCarCanStand(candidate.point,candidate.heading,collision.canStand,size))continue;
  const foot=beside(candidate.point,candidate.heading);if(foot)return {candidate,foot};
 }
 return null;
}
const districts=[];
for(const name of NAPOLI_QUARTIERI){
 const label=labels.find(p=>normal(p.name)===normal(name));
 let reference:Point,origin:{layer:string;tile:string|null;id:number|string|null;label:string;coordinate?:Point;referenceKind:string};
 if(label){
  reference=[...label.point];origin={layer:'places',tile:label.sourceTile,id:label.sourceFeatureId,label:label.name,coordinate:label.coordinate,referenceKind:'OSM place label, not district boundary or guaranteed road position'};
 }else if(name==='Zona Industriale'){
  const road=roads.filter(r=>r.name==='Via Emanuele Gianturco').sort((a,b)=>Math.min(...a.points.map(p=>p[1]))-Math.min(...b.points.map(p=>p[1]))||(a.id<b.id?-1:1))[0];
  if(!road)throw Error('Zona Industriale requires its actual Gianturco source road.');
  reference=[...road.points.reduce((a,b)=>a[1]<b[1]?a:b)];
  const parts=road.id.split('/');origin={layer:'roads',tile:parts[0]==='mvt-road'?parts.slice(2,5).join('/'):null,id:parts[0]==='mvt-road'?Number(parts[1]):road.id,label:'Via Emanuele Gianturco',referenceKind:'Explicit street reference for Zona Industriale; not an administrative centroid'};
 }else throw Error(`Missing source-backed district reference: ${name}`);
 const placement=clearPlacement(reference,label?undefined:'Via Emanuele Gianturco');
 if(!placement)throw Error(`No full-car and adjacent-pedestrian clear placement within 500 m of ${name}.`);
 const {candidate,foot}=placement,parts=candidate.road.id.split('/');
 districts.push({name,position:reference,source:origin,drive:{position:candidate.point,heading:candidate.heading,footPosition:foot,roadName:candidate.road.name??null,source:{roadId:candidate.road.id,layer:'roads',tile:parts[0]==='mvt-road'?parts.slice(2,5).join('/'):null,id:parts[0]==='mvt-road'?Number(parts[1]):candidate.road.id,segment:candidate.segment,fraction:candidate.t}},distanceFromReference:candidate.distance});
}
if(districts.length!==30)throw Error('Expected one source-backed anchor for each of 30 quartieri.');
const manifest={version:1,worldSha256,sourceSnapshot:source.snapshot,vehicle:{...size,footRadius},notice:'Place-label and explicit street references, not administrative district boundaries. Drive placements and adjacent foot positions are checked against the published source collision world.',districts};
const encoded=JSON.stringify(manifest,null,2)+'\n';await writeFile(output,encoded);
source.districtAnchors={path:output,sha256:sha(encoded),worldSha256,generatorSha256,count:districts.length};
await writeFile(sourcePath,JSON.stringify(source,null,2)+'\n');
console.log(`Prepared ${districts.length} source-backed district anchors with complete-car and adjacent-foot clearance.`);
