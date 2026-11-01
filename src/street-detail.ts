import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Material} from '@babylonjs/core/Materials/material';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {inside,type MapData,type Point,type Footprint} from './geo';
import {cityRoadWidth,type CityRoad} from './city-world';
import type {CityRuntime} from './city-data';
import {joinedStreetSections,offsetStreetSection as offset,interpolateStreetSection as interpolate,type StreetSection as Section} from './street-sections';
import {createTriangleSurfaceSampler} from './triangle-surface';
import {conformSurfaceToGround} from './ground-surface-overlay';
export {joinedStreetSections} from './street-sections';

export type StreetSurface='pavement'|'curb'|'paint';
export interface StreetDetailOptions {
  corridorRadius?:number;
  sidewalkWidth?:number;
  curbHeight?:number;
  maxRoads?:number;
  maxSpans?:number;
  materials?:Partial<Record<StreetSurface,Material>>;
  groundHeight?:(x:number,z:number)=>number;
  groundGeometry?:{positions:ArrayLike<number>;indices:ArrayLike<number>;normals?:ArrayLike<number>};
}
export interface StreetDetailStats {
  roadsConsidered:number;roadsDetailed:number;sidewalkSpans:number;curbSpans:number;
  paintStrips:number;junctionGaps:number;rejectedRaisedSpans:number;meshCount:number;vertexCount:number;
  estimatedWidths:true;inferredMarkings:true;collisionGeometryAdded:false;
}
export interface StreetGeometryBatch {
  key:string;surface:StreetSurface;positions:number[];indices:number[];uvs:number[];supportIndices:number[];normals?:number[];
}
export interface StreetDetailGeometry {batches:StreetGeometryBatch[];stats:StreetDetailStats}
type Bounds=[number,number,number,number];
const ROAD_TYPES=new Set(['primary','secondary','tertiary','residential','living_street','unclassified','service']);
const CELL=32,EPS=1e-7;
const finite=(p:Point)=>p.every(Number.isFinite);
const length=(a:Point,b:Point)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
function bounds(points:Point[]):Bounds {
  let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
  for(const [x,z]of points){x0=Math.min(x0,x);z0=Math.min(z0,z);x1=Math.max(x1,x);z1=Math.max(z1,z);}
  return [x0,z0,x1,z1];
}
function squareDistance(point:Point,a:Point,b:Point){
  const dx=b[0]-a[0],dz=b[1]-a[1],n=dx*dx+dz*dz;
  const t=n?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dz)/n)):0;
  return (point[0]-a[0]-dx*t)**2+(point[1]-a[1]-dz*t)**2;
}
function pathDistanceSquared(point:Point,path:Point[]){
  let best=Infinity;for(let i=1;i<path.length;i++)best=Math.min(best,squareDistance(point,path[i-1],path[i]));return best;
}
function lineDistanceSquared(a:Point,b:Point,c:Point,d:Point){
  const cross=(p:Point,q:Point,r:Point)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
  if(abC*abD<=0&&cdA*cdB<=0&&Math.max(a[0],b[0])+EPS>=Math.min(c[0],d[0])&&Math.max(c[0],d[0])+EPS>=Math.min(a[0],b[0])&&Math.max(a[1],b[1])+EPS>=Math.min(c[1],d[1])&&Math.max(c[1],d[1])+EPS>=Math.min(a[1],b[1]))return 0;
  return Math.min(squareDistance(a,c,d),squareDistance(b,c,d),squareDistance(c,a,b),squareDistance(d,a,b));
}
function limitedRoute(input:Point[]):Point[]{
  const result:Point[]=[];let remaining=600;
  for(const p of input){
    if(!finite(p))return [];
    const last=result.at(-1);if(!last){result.push([...p]);continue;}
    const distance=length(last,p);if(distance<EPS)continue;
    if(distance>remaining){const t=remaining/distance;result.push([last[0]+(p[0]-last[0])*t,last[1]+(p[1]-last[1])*t]);break;}
    result.push([...p]);remaining-=distance;if(remaining<=EPS)break;
  }
  return result;
}
function spatialBuildings(buildings:Footprint[]){
  const cells=new Map<string,Footprint[]>();
  for(const building of buildings){
    if(!building.rings[0]?.length)continue;
    const b=bounds(building.rings[0]);
    for(let x=Math.floor(b[0]/CELL);x<=Math.floor(b[2]/CELL);x++)for(let z=Math.floor(b[1]/CELL);z<=Math.floor(b[3]/CELL);z++){
      const key=x+','+z;const values=cells.get(key)??[];values.push(building);cells.set(key,values);
    }
  }
  return (point:Point)=>{
    for(const building of cells.get(Math.floor(point[0]/CELL)+','+Math.floor(point[1]/CELL))??[]){
      if(inside(point,building.rings[0])&&!building.rings.slice(1).some(hole=>inside(point,hole)))return false;
      for(const ring of building.rings)for(let i=0;i<ring.length;i++)if(squareDistance(point,ring[i],ring[(i+1)%ring.length])<.03**2)return false;
    }
    return true;
  };
}
/** Junctions come from shared source vertices with at least three distinct outgoing legs. */
function junctionPoints(roads:CityRoad[]):Point[]{
  const nodes=new Map<string,{point:Point;directions:Point[]}>();
  for(const road of roads){
    for(let i=0;i<road.points.length;i++){
      const p=road.points[i];if(!finite(p))continue;
      const key=Math.round(p[0]*10)+','+Math.round(p[1]*10),node=nodes.get(key)??{point:p,directions:[]};
      for(const neighbour of [road.points[i-1],road.points[i+1]]){
        if(!neighbour||!finite(neighbour))continue;const distance=length(p,neighbour);if(distance<.1)continue;
        const direction:Point=[(neighbour[0]-p[0])/distance,(neighbour[1]-p[1])/distance];
        if(!node.directions.some(d=>d[0]*direction[0]+d[1]*direction[1]>.94))node.directions.push(direction);
      }
      nodes.set(key,node);
    }
  }
  return [...nodes.values()].filter(node=>node.directions.length>=3).map(node=>node.point);
}
function option(value:number|undefined,fallback:number,minimum:number,maximum:number){
  const result=value??fallback;if(!Number.isFinite(result)||result<minimum||result>maximum)throw new RangeError('Limite del dettaglio stradale non valido.');return result;
}

/**
 * Inferred street furniture on real centerlines, limited to the first 600 m of
 * mission route. This is visual geometry only: no collider or real marking claim.
 */
export function buildStreetDetailGeometry(map:MapData,detail:CityRuntime,options:StreetDetailOptions={}):StreetDetailGeometry {
  const radius=option(options.corridorRadius,90,1,180),requestedWidth=option(options.sidewalkWidth,1.45,.65,2.5),height=option(options.curbHeight,.12,.06,.18);
  const maxRoads=Math.floor(option(options.maxRoads,75,0,160)),maxSpans=Math.floor(option(options.maxSpans,2200,0,5000));
  const stats:StreetDetailStats={roadsConsidered:0,roadsDetailed:0,sidewalkSpans:0,curbSpans:0,paintStrips:0,junctionGaps:0,rejectedRaisedSpans:0,meshCount:0,vertexCount:0,estimatedWidths:true,inferredMarkings:true,collisionGeometryAdded:false};
  const route=limitedRoute(detail.route),batches:StreetGeometryBatch[]=[];
  if(route.length<2||!maxRoads||!maxSpans)return {batches,stats};
  const land=detail.landPolygons??map.land.map(ring=>[ring]);
  const insideLand=(p:Point)=>land.some(polygon=>inside(p,polygon[0])&&!polygon.slice(1).some(hole=>inside(p,hole)));
  const outsideBuildings=spatialBuildings(map.buildings),junctions=junctionPoints(detail.roads);
  const raisedClear=(p:Point)=>insideLand(p)&&outsideBuildings(p)&&pathDistanceSquared(p,route)>=1.1**2;
  const routeBox=bounds(route);
  const candidates=detail.roads.filter(road=>ROAD_TYPES.has(road.highway)&&cityRoadWidth(road)>=5&&road.points.length>1)
    .map(road=>{
      const box=bounds(road.points);let distance=Infinity;
      if(box[0]>routeBox[2]+radius||box[2]<routeBox[0]-radius||box[1]>routeBox[3]+radius||box[3]<routeBox[1]-radius)return {road,distance};
      for(let i=1;i<road.points.length;i++)for(let j=1;j<route.length;j++)distance=Math.min(distance,lineDistanceSquared(road.points[i-1],road.points[i],route[j-1],route[j]));
      return {road,distance};
    })
    .filter(candidate=>candidate.distance<=radius*radius).sort((a,b)=>a.distance-b.distance||a.road.id.localeCompare(b.road.id));
  stats.roadsConsidered=candidates.length;
  const bucket=new Map<string,StreetGeometryBatch>(),profileOffsets=new WeakMap<StreetGeometryBatch,number[]>();
  function batch(surface:StreetSurface,mid:Point):StreetGeometryBatch {
    const base=surface+':'+Math.floor(mid[0]/128)+','+Math.floor(mid[1]/128);let part=0,key=base;
    while((bucket.get(key)?.positions.length??0)/3>59980)key=base+':'+(++part);
    let value=bucket.get(key);if(!value){value={key,surface,positions:[],indices:[],uvs:[],supportIndices:[]};bucket.set(key,value);profileOffsets.set(value,[]);batches.push(value);}return value;
  }
  function quad(surface:StreetSurface,vertices:Array<[number,number,number]>,uvs:number[],mid:Point,reverse=false){
    const target=batch(surface,mid),n=target.positions.length/3;
    for(const p of vertices){const ground=options.groundHeight?.(p[0],p[2])??0;if(!Number.isFinite(ground))throw new TypeError('Quota del dettaglio stradale non finita.');target.positions.push(p[0],p[1]+ground,p[2]);profileOffsets.get(target)!.push(p[1]);}target.uvs.push(...uvs);
    const triangles=reverse?[[0,2,1],[0,3,2]]:[[0,1,2],[0,2,3]];
    const horizontal=vertices.every(p=>Math.abs(p[1]-vertices[0][1])<EPS);
    for(const triangle of triangles){
      if(horizontal){const [a,b,c]=triangle.map(i=>vertices[i]),normalY=(a[2]-b[2])*(c[0]-b[0])-(a[0]-b[0])*(c[2]-b[2]);if(normalY<0)[triangle[1],triangle[2]]=[triangle[2],triangle[1]];}
      target.indices.push(...triangle.map(i=>n+i));
      if(horizontal&&surface!=='paint')target.supportIndices.push(...triangle.map(i=>n+i));
    }
  }
  function strip(surface:StreetSurface,a:Section,b:Section,left:number,right:number,y:number,mid:Point){
    const ai=offset(a,left),ao=offset(a,right),bi=offset(b,left),bo=offset(b,right);
    quad(surface,[[ai[0],y,ai[1]],[ao[0],y,ao[1]],[bo[0],y,bo[1]],[bi[0],y,bi[1]]],[a.distance/2,left/2,a.distance/2,right/2,b.distance/2,right/2,b.distance/2,left/2],mid);
  }
  let emittedSpans=0;
  for(const {road}of candidates.slice(0,maxRoads)){
    const sections=joinedStreetSections(road.points),half=cityRoadWidth(road)/2;let detailed=false;
    for(let i=1;i<sections.length;i++){
      if(emittedSpans>=maxSpans)break;
      const a=sections[i-1],b=sections[i],mid:Point=[(a.point[0]+b.point[0])/2,(a.point[1]+b.point[1])/2];
      if(pathDistanceSquared(mid,route)>radius*radius)continue;
      const junction=junctions.some(p=>squareDistance(p,a.point,b.point)<(half+requestedWidth+1.25)**2);
      if(junction){stats.junctionGaps++;continue;}
      let thisSpan=false;
      for(const side of [-1,1]){
        let width=requestedWidth,clear=false;
        while(width>=.64){
          clear=true;const lengthAB=length(a.point,b.point),steps=Math.max(1,Math.ceil(lengthAB/.9));
          for(let step=0;step<=steps&&clear;step++){
            const section=interpolate(a,b,step/steps);
            for(const d of [half,half+.17,half+.17+width/2,half+.17+width])if(!raisedClear(offset(section,side*d))){clear=false;break;}
          }
          if(clear)break;width-=.25;
        }
        if(!clear){stats.rejectedRaisedSpans++;continue;}
        const inner=side*(half+.17),outer=side*(half+.17+width);
        strip('pavement',a,b,Math.min(inner,outer),Math.max(inner,outer),height+.005,mid);stats.sidewalkSpans++;
        const profile:Array<[number,number]>=[[half,.025],[half+.035,height],[half+.16,height],[half+.17,height+.005]];
        for(let j=1;j<profile.length;j++){
          const [d0,y0]=profile[j-1],[d1,y1]=profile[j],a0=offset(a,side*d0),a1=offset(a,side*d1),b0=offset(b,side*d0),b1=offset(b,side*d1);
          quad('curb',[[a0[0],y0,a0[1]],[a1[0],y1,a1[1]],[b1[0],y1,b1[1]],[b0[0],y0,b0[1]]],[a.distance/.8,y0/.25,a.distance/.8,y1/.25,b.distance/.8,y1/.25,b.distance/.8,y0/.25],mid,side<0);
        }
        stats.curbSpans++;thisSpan=true;
      }
      // Italian-style white paint, explicitly inferred: no US double-yellow or invented crossings.
      if(half>=3&&insideLand(mid)&&outsideBuildings(mid)){
        for(const side of [-1,1]){const edge=side*(half-.23);strip('paint',a,b,edge-.045,edge+.045,.052,mid);stats.paintStrips++;thisSpan=true;}
        if(['primary','secondary','tertiary'].includes(road.highway)&&half>=3.5){
          const d0=a.distance,d1=b.distance;
          for(let cycle=Math.floor(d0/9);cycle<=Math.floor(d1/9);cycle++){
            const start=Math.max(d0,cycle*9),end=Math.min(d1,cycle*9+3);if(end-start<.1)continue;
            strip('paint',interpolate(a,b,(start-d0)/(d1-d0)),interpolate(a,b,(end-d0)/(d1-d0)),-.06,.06,.053,mid);stats.paintStrips++;thisSpan=true;
          }
        }
      }
      if(thisSpan){emittedSpans++;detailed=true;}
    }
    if(detailed)stats.roadsDetailed++;
    if(emittedSpans>=maxSpans)break;
  }
  if(options.groundGeometry)for(const batch of batches){
    const supportingFaces=new Set<string>();for(let i=0;i<batch.supportIndices.length;i+=3)supportingFaces.add(batch.supportIndices.slice(i,i+3).join(','));
    const supportingOrdinals=new Set<number>();for(let i=0;i<batch.indices.length;i+=3)if(supportingFaces.has(batch.indices.slice(i,i+3).join(',')))supportingOrdinals.add(i/3);
    const conformed=conformSurfaceToGround(batch,options.groundGeometry,{offset:0,uvMetres:2,vertexOffsets:profileOffsets.get(batch)!});
    batch.positions=conformed.positions;batch.indices=conformed.indices;batch.uvs=conformed.uvs;batch.normals=conformed.normals;batch.supportIndices=[];
    for(let i=0;i<conformed.sourceTriangles.length;i++)if(supportingOrdinals.has(conformed.sourceTriangles[i]))batch.supportIndices.push(...conformed.indices.slice(i*3,i*3+3));
  }
  stats.meshCount=batches.length;stats.vertexCount=batches.reduce((n,b)=>n+b.positions.length/3,0);
  return {batches,stats};
}

/** Original profile tops support feet after grading; paint and bevels stay excluded. */
function streetHeightIndex(geometry:StreetDetailGeometry){
  return createTriangleSurfaceSampler(geometry.batches.map(batch=>({positions:batch.positions,indices:batch.supportIndices})));
}

/** Attach visual-only buffers; callers may provide their licensed PBR materials. */
export function addStreetDetail(scene:Scene,map:MapData,detail:CityRuntime,options:StreetDetailOptions={}){
  const geometry=buildStreetDetailGeometry(map,detail,options),heights=streetHeightIndex(geometry),owned:Material[]=[],materials={} as Record<StreetSurface,Material>;
  for(const [surface,color]of [['pavement','#a39f90'],['curb','#b9b5a6'],['paint','#e2ded0']] as const){
    const supplied=options.materials?.[surface];if(supplied){materials[surface]=supplied;continue;}
    const material=new StandardMaterial('dettaglio stradale '+surface,scene);material.diffuseColor=Color3.FromHexString(color);material.specularColor.set(.035,.035,.03);materials[surface]=material;owned.push(material);
  }
  const meshes=geometry.batches.map(batch=>{
    const mesh=new Mesh('dettaglio strada '+batch.key,scene),data=new VertexData();data.positions=batch.positions;data.indices=batch.indices;data.uvs=batch.uvs;const normals:number[]=[];VertexData.ComputeNormals(batch.positions,batch.indices,normals);data.normals=batch.normals??normals;data.applyToMesh(mesh);mesh.material=materials[batch.surface];mesh.material.backFaceCulling=false;mesh.receiveShadows=true;mesh.isPickable=false;mesh.checkCollisions=false;mesh.metadata={solid:false,inferredStreetDetail:true,source:'OSM centerlines; inferred widths, curbs and white markings',surface:batch.surface};return mesh;
  });
  scene.metadata={...(scene.metadata??{}),streetDetail:{...geometry.stats}};
  const heightAt=(x:number,z:number)=>{
    if(!Number.isFinite(x)||!Number.isFinite(z))return 0;
    return Math.max(options.groundHeight?.(x,z)??0,heights.heightAt(x,z)??-Infinity);
  };
  return {geometry,stats:geometry.stats,meshes,heightAt,supportHeightAt:heights.heightAt,dispose(){heights.dispose();for(const mesh of meshes)mesh.dispose();for(const material of owned)material.dispose();}};
}
