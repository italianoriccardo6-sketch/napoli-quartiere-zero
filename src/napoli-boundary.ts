import polygonClipping from 'polygon-clipping';
import {toLocal,type Point} from './geo';
import {fromLocal,type AcquisitionSector} from './napoli-sectors';
export interface NapoliBoundary {type:'Feature';geometry:{type:'MultiPolygon';coordinates:number[][][][]};properties:{name:string;com_istat_code?:string;code?:string;[key:string]:unknown}}
export interface MunicipalSector extends AcquisitionSector {administrativePolygons:Point[][][];administrativeAreaM2:number}
/** Validate identity and finite WGS84 geometry, without treating a statistical polygon as a surveyed coast. */
export function parseNapoliBoundary(raw:unknown):NapoliBoundary {
  const f=raw as NapoliBoundary;
  if(!f||f.type!=='Feature'||f.properties?.name!=='Napoli'||(f.properties.com_istat_code??f.properties.code)!=='063049'||f.geometry?.type!=='MultiPolygon'||!Array.isArray(f.geometry.coordinates)||!f.geometry.coordinates.length)throw Error('Expected the Napoli ISTAT 063049 MultiPolygon.');
  let count=0;
  for(const polygon of f.geometry.coordinates){
    if(!Array.isArray(polygon)||!polygon.length)throw Error('Invalid boundary polygon.');
    for(const ring of polygon){
      if(!Array.isArray(ring)||ring.length<4)throw Error('Invalid boundary ring.');
      for(const p of ring){if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<14||p[0]>14.5||p[1]<40.7||p[1]>41)throw Error('Invalid Napoli boundary coordinate.');if(++count>100000)throw Error('Excessive boundary geometry.');}
      if(ring[0][0]!==ring.at(-1)![0]||ring[0][1]!==ring.at(-1)![1])throw Error('Boundary ring is not closed.');
    }
  }
  return f;
}
const ringArea=(ring:Point[])=>Math.abs(ring.reduce((n,p,i)=>{const q=ring[(i+1)%ring.length];return n+p[0]*q[1]-q[0]*p[1];},0)/2);
/** A measured administrative footprint selects the city extent. These polygons never create land/collisions. */
export function planMunicipalSectors(rawBoundary:unknown):MunicipalSector[]{
  const boundary=parseNapoliBoundary(rawBoundary),polygons=boundary.geometry.coordinates.map(p=>p.map(r=>r.map(q=>toLocal(q[0],q[1])))),points=polygons.flat(2);
  const west=Math.min(...points.map(p=>p[0])),south=Math.min(...points.map(p=>p[1])),east=Math.max(...points.map(p=>p[0])),north=Math.max(...points.map(p=>p[1])),result:MunicipalSector[]=[];
  for(let z=Math.floor(south/1000);z<Math.ceil(north/1000);z++)for(let x=Math.floor(west/1000);x<Math.ceil(east/1000);x++){
    const bounds:[number,number,number,number]=[x*1000,z*1000,(x+1)*1000,(z+1)*1000],rect:Point[]=[[bounds[0],bounds[1]],[bounds[2],bounds[1]],[bounds[2],bounds[3]],[bounds[0],bounds[3]],[bounds[0],bounds[1]]];
    const administrativePolygons=polygonClipping.intersection(polygons,[rect]) as Point[][][];
    const administrativeAreaM2=administrativePolygons.reduce((n,p)=>n+ringArea(p[0])-p.slice(1).reduce((m,r)=>m+ringArea(r),0),0);if(administrativeAreaM2<1e-4)continue;
    const sw=fromLocal([bounds[0],bounds[1]]),ne=fromLocal([bounds[2],bounds[3]]);
    result.push({id:`napoli-${x<0?'w':'e'}${Math.abs(x)}-${z<0?'s':'n'}${Math.abs(z)}`,bounds,bbox:[sw[1],sw[0],ne[1],ne[0]],administrativePolygons,administrativeAreaM2});
  }
  return result;
}
