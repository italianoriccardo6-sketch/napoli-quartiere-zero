import {ORIGIN,type Footprint,type Point} from './geo';
import type {RealRoad,CoastlineChain,RealGeography} from './real-geography';
import type {AcquisitionSector} from './napoli-sectors';

export type OSMElement={type:'node'|'way'|'relation';id:number;[key:string]:unknown};
export interface OSMSectorInput {id:string;raw:unknown}
export interface SectorGeometry {
  version:1;id:string;bounds:[number,number,number,number];
  representation:'OSM-planimetry-not-photogrammetry';
  buildings:Footprint[];roads:RealRoad[];coastlines:CoastlineChain[];
}
export interface SectorDescriptor {id:string;bounds:[number,number,number,number];path:string;bytes:number;sha256:string;buildings:number;roads:number}
export interface CitySectorManifest {
  version:1;status:'geography-only-not-activated';origin:{lat:number;lon:number};
  license:'ODbL-1.0';attribution:'© OpenStreetMap contributors';
  administrativeBoundaryVerified:false;terrainInstalled:false;landSurfaceInstalled:false;
  sources:Array<{id:string;sha256:string;bytes:number;date:string;bbox:number[]}>;
  sectors:SectorDescriptor[];
}
const validBounds=(b:unknown):b is [number,number,number,number]=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<b[2]&&b[1]<b[3];
const validPoint=(p:unknown):p is Point=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
function stable(value:unknown):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable((value as Record<string,unknown>)[key])).join(',')+'}';
}
/** OSM identities are global. Never duplicate a cross-sector road/building or pick an arbitrary conflicting revision. */
export function mergeOSMSectors(inputs:readonly OSMSectorInput[]){
  const elements=new Map<string,OSMElement>(),owners=new Map<string,string>();let duplicates=0;
  if(!inputs.length||inputs.length>1024)throw Error('Expected 1–1024 acquired sources.');
  const sourceIds=new Set<string>();
  for(const input of inputs){
    if(!input.id||sourceIds.has(input.id))throw Error('Duplicate or empty sector source ID.');sourceIds.add(input.id);
    const raw=input.raw as {elements?:unknown[];remark?:unknown};
    if(!raw||!Array.isArray(raw.elements)||raw.remark||raw.elements.length>500000)throw Error('Incomplete or excessive OSM source: '+input.id);
    for(const candidate of raw.elements){
      const e=candidate as OSMElement;
      if(!e||!['node','way','relation'].includes(e.type)||!Number.isSafeInteger(e.id)||e.id<=0)throw Error('Invalid OSM identity in '+input.id);
      const identity=e.type+'/'+e.id,previous=elements.get(identity);
      if(previous){
        for(const key of Object.keys(e))if(key in previous&&stable(previous[key])!==stable(e[key]))throw Error('Conflicting OSM object '+identity+' in '+owners.get(identity)+' and '+input.id);
        elements.set(identity,{...previous,...e});duplicates++;
      }
      else {elements.set(identity,e);owners.set(identity,input.id);}
    }
  }
  for(const e of elements.values()){
    if(e.type==='node'&&(!Number.isFinite(e.lat)||!Number.isFinite(e.lon)||Number(e.lat)<-90||Number(e.lat)>90||Number(e.lon)<-180||Number(e.lon)>180))throw Error('Invalid coordinate: node/'+e.id);
    if(e.type==='way'&&(!Array.isArray(e.nodes)||e.nodes.length<2||e.nodes.some(id=>!Number.isSafeInteger(id)||!elements.has('node/'+id))))throw Error('Incomplete way/'+e.id);
    if(e.type==='relation'){
      if(!Array.isArray(e.members))throw Error('Incomplete relation/'+e.id);
      for(const raw of e.members){const member=raw as {type?:string;ref?:number};if(!member||!['node','way','relation'].includes(member.type??'')||!Number.isSafeInteger(member.ref)||!elements.has(member.type+'/'+member.ref))throw Error('Incomplete relation/'+e.id);}
    }
  }
  const order={node:0,way:1,relation:2};
  return {raw:{version:0.6,elements:[...elements.values()].sort((a,b)=>order[a.type]-order[b.type]||a.id-b.id).map(e=>JSON.parse(stable(e)) as OSMElement)},summary:{sources:inputs.length,uniqueElements:elements.size,duplicateObjects:duplicates}};
}
function intersects(points:Point[],box:readonly number[]){
  return points.length>0&&Math.min(...points.map(p=>p[0]))<=box[2]&&Math.max(...points.map(p=>p[0]))>=box[0]&&Math.min(...points.map(p=>p[1]))<=box[3]&&Math.max(...points.map(p=>p[1]))>=box[1];
}
/** Keep full source geometry/IDs across boundaries; neighbouring payloads can share the same object. */
export function geometryForSector(geography:RealGeography,sector:AcquisitionSector):SectorGeometry {
  return {version:1,id:sector.id,bounds:[...sector.bounds],representation:'OSM-planimetry-not-photogrammetry',buildings:geography.map.buildings.filter(b=>intersects(b.rings[0],sector.bounds)),roads:geography.roads.filter(r=>intersects(r.points,sector.bounds)),coastlines:geography.coastlines.filter(c=>intersects(c.points,sector.bounds))};
}
export function validateSectorGeometry(raw:unknown):SectorGeometry {
  const s=raw as SectorGeometry;
  if(!s||s.version!==1||!/^napoli-[ew]\d+-[ns]\d+$/.test(s.id)||!validBounds(s.bounds)||s.representation!=='OSM-planimetry-not-photogrammetry'||!Array.isArray(s.buildings)||!Array.isArray(s.roads)||!Array.isArray(s.coastlines)||s.buildings.length+s.roads.length+s.coastlines.length>100000)throw Error('Invalid geographic sector.');
  const ids=new Set<string>();
  for(const b of s.buildings){
    if(!b||typeof b.id!=='string'||ids.has(b.id)||!Number.isFinite(b.height)||b.height<=0||typeof b.estimated!=='boolean'||!Array.isArray(b.rings)||!b.rings.length||b.rings.some(r=>!Array.isArray(r)||r.length<3||!r.every(validPoint)))throw Error('Invalid sector building.');ids.add(b.id);
  }
  const roadIds=new Set<string>();
  for(const r of s.roads){if(!r||typeof r.id!=='string'||roadIds.has(r.id)||typeof r.highway!=='string'||!Array.isArray(r.points)||r.points.length<2||!r.points.every(validPoint)||!Array.isArray(r.nodeIds)||r.nodeIds.length!==r.points.length)throw Error('Invalid sector road.');roadIds.add(r.id);}
  for(const c of s.coastlines)if(!c||!Array.isArray(c.points)||c.points.length<2||!c.points.every(validPoint)||!Array.isArray(c.nodeIds)||c.nodeIds.length!==c.points.length||!Array.isArray(c.sourceIds)||typeof c.closed!=='boolean'||c.ambiguous!==false)throw Error('Invalid sector coast.');
  return s;
}
export function validateCitySectorManifest(raw:unknown):CitySectorManifest {
  const m=raw as CitySectorManifest;
  if(!m||m.version!==1||m.status!=='geography-only-not-activated'||m.license!=='ODbL-1.0'||m.attribution!=='© OpenStreetMap contributors'||m.origin?.lat!==ORIGIN.lat||m.origin?.lon!==ORIGIN.lon||m.administrativeBoundaryVerified!==false||m.terrainInstalled!==false||m.landSurfaceInstalled!==false||!Array.isArray(m.sources)||!m.sources.length||!Array.isArray(m.sectors)||m.sectors.length>1024)throw Error('Invalid sector manifest.');
  const ids=new Set<string>();
  for(const s of m.sectors){if(!s||!/^napoli-[ew]\d+-[ns]\d+$/.test(s.id)||ids.has(s.id)||!validBounds(s.bounds)||s.path!==`${s.id}.json`||!Number.isSafeInteger(s.bytes)||s.bytes<=0||s.bytes>8*1024*1024||! /^[a-f0-9]{64}$/.test(s.sha256)||!Number.isSafeInteger(s.buildings)||s.buildings<0||!Number.isSafeInteger(s.roads)||s.roads<0)throw Error('Invalid sector descriptor.');ids.add(s.id);}
  for(const source of m.sources)if(!source||typeof source.id!=='string'||! /^[a-f0-9]{64}$/.test(source.sha256)||!Number.isSafeInteger(source.bytes)||source.bytes<=0||typeof source.date!=='string'||!Number.isFinite(Date.parse(source.date))||!validBounds(source.bbox))throw Error('Invalid geographic source provenance.');
  return m;
}
