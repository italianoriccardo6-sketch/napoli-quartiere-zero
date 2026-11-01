import earcut,{deviation} from 'earcut';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Material} from '@babylonjs/core/Materials/material';
import type {Scene} from '@babylonjs/core/scene';
import {inside,type Point} from './geo';

export interface ElevatedGroundOptions {
  maxEdge?:number;
  maxTriangles?:number;
  tileSize?:number;
  maxVerticesPerBatch?:number;
  uvMetres?:number;
}
export interface ElevatedGroundBatch {
  key:string;
  positions:number[];
  indices:number[];
  normals:number[];
  uvs:number[];
}
export interface ElevatedGroundStats {
  polygons:number;sourceVertices:number;initialTriangles:number;sourceConformitySplits:number;
  refinementSplits:number;triangles:number;vertices:number;batches:number;
  maxEdge:number;largestEdge:number;remainingLongEdges:number;budgetReached:boolean;
  heightSamples:number;boundaryEdges:number;internalEdges:number;
  geography:'original-land-polygons-and-holes';
  topology:'shared-edge-conforming';
}
export interface ElevatedGroundGeometry {
  positions:number[];indices:number[];normals:number[];uvs:number[];
  batches:ElevatedGroundBatch[];stats:ElevatedGroundStats;
}
type Triangle=[number,number,number];
interface Edge {a:number;b:number;triangles:Set<number>}
const EPS=1e-8;
const key=(a:number,b:number)=>a<b?a+','+b:b+','+a;
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const distance=(a:Point,b:Point)=>Math.hypot(b[0]-a[0],b[1]-a[1]);
function area(ring:Point[]){const a=ring[0];let sum=0;for(let i=1;i<ring.length-1;i++)sum+=cross(a,ring[i],ring[i+1]);return sum/2;}
function onSegment(p:Point,a:Point,b:Point){
  const length=distance(a,b);if(!length)return distance(p,a)<=EPS;
  return Math.abs(cross(a,b,p))<=EPS*length&&p[0]>=Math.min(a[0],b[0])-EPS&&p[0]<=Math.max(a[0],b[0])+EPS&&p[1]>=Math.min(a[1],b[1])-EPS&&p[1]<=Math.max(a[1],b[1])+EPS;
}
function properCrossing(a:Point,b:Point,c:Point,d:Point){
  const ab=EPS*Math.max(1,distance(a,b)),cd=EPS*Math.max(1,distance(c,d));
  const side=(value:number,tolerance:number)=>value>tolerance?1:value< -tolerance?-1:0;
  return side(cross(a,b,c),ab)*side(cross(a,b,d),ab)<0&&side(cross(c,d,a),cd)*side(cross(c,d,b),cd)<0;
}
function bounded(value:number|undefined,fallback:number,min:number,max:number,name:string,integer=false){
  const result=value??fallback;
  if(!Number.isFinite(result)||result<min||result>max||(integer&&!Number.isInteger(result)))throw new RangeError('Invalid elevated ground '+name+'.');
  return result;
}
function prepareLand(input:Point[][][]):Point[][][]{
  if(!Array.isArray(input)||!input.length||input.length>1000)throw new Error('Elevated ground needs bounded land polygons.');
  let vertices=0;
  const land=input.map(polygon=>{
    if(!Array.isArray(polygon)||!polygon.length)throw new Error('Missing outer land ring.');
    return polygon.map(ring=>{
      if(!Array.isArray(ring))throw new Error('Invalid land ring.');
      const clean:Point[]=[];
      for(const p of ring){
        if(!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||!p.every(n=>Number.isFinite(Math.fround(n))))throw new Error('Nonfinite land coordinate.');
        if(!clean.length||p[0]!==clean.at(-1)![0]||p[1]!==clean.at(-1)![1])clean.push([p[0],p[1]]);
      }
      if(clean.length>1&&clean[0][0]===clean.at(-1)![0]&&clean[0][1]===clean.at(-1)![1])clean.pop();
      if(clean.length<3||!Number.isFinite(area(clean))||Math.abs(area(clean))<1e-12)throw new Error('Degenerate land ring.');
      vertices+=clean.length;if(vertices>12000)throw new Error('Too many source land vertices.');
      return clean;
    });
  });
  const segments:Array<{a:Point;b:Point;polygon:number;ring:number;edge:number;count:number}>=[];
  land.forEach((polygon,p)=>polygon.forEach((ring,r)=>ring.forEach((a,i)=>segments.push({a,b:ring[(i+1)%ring.length],polygon:p,ring:r,edge:i,count:ring.length}))));
  for(let i=0;i<segments.length;i++)for(let j=i+1;j<segments.length;j++){
    const a=segments[i],b=segments[j];
    if(a.polygon===b.polygon&&a.ring===b.ring&&(Math.abs(a.edge-b.edge)===1||Math.abs(a.edge-b.edge)===a.count-1))continue;
    if(properCrossing(a.a,a.b,b.a,b.b))throw new Error('Crossing land boundaries are not supported.');
  }
  const strictlyInside=(p:Point,polygon:Point[][])=>inside(p,polygon[0])&&!polygon.slice(1).some(r=>inside(p,r))&&!polygon.some(r=>r.some((a,i)=>onSegment(p,a,r[(i+1)%r.length])));
  for(let p=0;p<land.length;p++){
    for(const hole of land[p].slice(1))if(hole.some(v=>!inside(v,land[p][0])&&!land[p][0].some((a,i)=>onSegment(v,a,land[p][0][(i+1)%land[p][0].length]))))throw new Error('A terrain hole lies outside its outer ring.');
    for(let q=p+1;q<land.length;q++)if(land[p].some(r=>r.some(v=>strictlyInside(v,land[q])))||land[q].some(r=>r.some(v=>strictlyInside(v,land[p]))))throw new Error('Overlapping land polygons are not supported.');
  }
  return land;
}

/**
 * Refine the original polygon triangulation without moving its coastline.
 * Every edge split updates all incident faces atomically, including when the
 * budget is exhausted. Heights are sampled once per shared vertex. This is
 * geometry only: the caller must establish the height source and vertical origin.
 */
export function buildElevatedGroundGeometry(input:Point[][][],heightAt:(x:number,z:number)=>number,options:ElevatedGroundOptions={}):ElevatedGroundGeometry {
  if(typeof heightAt!=='function')throw new TypeError('A terrain height sampler is required.');
  const maxEdge=bounded(options.maxEdge,20,.1,1000,'maximum edge'),maxTriangles=bounded(options.maxTriangles,160000,1,200000,'triangle budget',true);
  const tileSize=bounded(options.tileSize,128,1,4096,'tile size'),maxVertices=bounded(options.maxVerticesPerBatch,60000,3,60000,'batch vertex budget',true),uvMetres=bounded(options.uvMetres,2,.01,1000,'UV scale');
  const land=prepareLand(input),points:Point[]=[],heights:number[]=[],pointIds=new Map<string,number>();
  const vertex=(p:Point)=>{
    const coordinate=p[0]+','+p[1],existing=pointIds.get(coordinate);if(existing!==undefined)return existing;
    const height=heightAt(p[0],p[1]);if(!Number.isFinite(height)||!Number.isFinite(Math.fround(height)))throw new Error('The terrain sampler returned a nonfinite height.');
    const id=points.length;points.push([p[0],p[1]]);heights.push(height);pointIds.set(coordinate,id);return id;
  };
  const triangles:Array<Triangle|null>=[],edges=new Map<string,Edge>();let count=0;
  let edgeCreated:(edgeKey:string)=>void=()=>{};
  const add=(aa:number,bb:number,cc:number)=>{
    const sign=cross(points[aa],points[bb],points[cc]);if(!sign)return;
    const triangle:Triangle=sign>0?[aa,bb,cc]:[aa,cc,bb],id=triangles.length;triangles.push(triangle);count++;
    for(let i=0;i<3;i++){
      const a=triangle[i],b=triangle[(i+1)%3],k=key(a,b);let edge=edges.get(k);
      if(!edge){edge={a:Math.min(a,b),b:Math.max(a,b),triangles:new Set()};edges.set(k,edge);edgeCreated(k);}
      edge.triangles.add(id);if(edge.triangles.size>2)throw new Error('Nonmanifold or duplicate terrain faces.');
    }
  };
  const remove=(id:number)=>{
    const triangle=triangles[id];if(!triangle)throw new Error('Missing active terrain triangle.');
    for(let i=0;i<3;i++){const k=key(triangle[i],triangle[(i+1)%3]),edge=edges.get(k)!;edge.triangles.delete(id);if(!edge.triangles.size)edges.delete(k);}
    triangles[id]=null;count--;
  };
  for(const polygon of land){
    const flat:number[]=[],holes:number[]=[],ids:number[]=[];
    polygon.forEach((ring,r)=>{if(r)holes.push(ids.length);for(const p of ring){flat.push(...p);ids.push(vertex(p));}});
    const indices=earcut(flat,holes,2);
    if(deviation(flat,holes,2,indices)>1e-7)throw new Error('Land triangulation did not preserve polygon area.');
    for(let i=0;i<indices.length;i+=3)add(ids[indices[i]],ids[indices[i+1]],ids[indices[i+2]]);
  }
  if(!count)throw new Error('Land has no usable terrain faces.');
  if(count>maxTriangles)throw new Error('Initial terrain exceeds its triangle budget.');
  const sourceVertices=points.length,midpointIds=new Map<string,number>();
  const split=(k:string,m:number,mandatory:boolean)=>{
    const edge=edges.get(k);if(!edge)return false;
    const incident=[...edge.triangles];
    if(count+incident.length>maxTriangles){if(mandatory)throw new Error('Triangle budget cannot conform the source boundary.');return false;}
    const old=incident.map(id=>triangles[id]!);
    if(m===edge.a||m===edge.b)throw new Error('Terrain midpoint collapsed to an edge endpoint.');
    incident.forEach(remove);
    for(const triangle of old){const opposite=triangle.find(id=>id!==edge.a&&id!==edge.b)!;add(edge.a,m,opposite);add(m,edge.b,opposite);}
    return true;
  };
  // Earcut can remove a collinear source vertex. Restore it on all relevant
  // edges before refinement, including A-B versus A-M-B shared polygon borders.
  const conformQueue=[...edges.keys()];edgeCreated=k=>conformQueue.push(k);let conformitySplits=0;
  for(let cursor=0;cursor<conformQueue.length;cursor++){
    const k=conformQueue[cursor],edge=edges.get(k);if(!edge)continue;
    const a=points[edge.a],b=points[edge.b];
    for(let id=0;id<sourceVertices;id++){
      if(id===edge.a||id===edge.b)continue;
      if(onSegment(points[id],a,b)&&distance(points[id],a)>EPS&&distance(points[id],b)>EPS){split(k,id,true);conformitySplits++;break;}
    }
  }
  const initialTriangles=count,heap:Array<{key:string;length:number}>=[],queued=new Set<string>();
  const enqueue=(k:string)=>{
    if(queued.has(k))return;queued.add(k);const edge=edges.get(k)!;
    heap.push({key:k,length:distance(points[edge.a],points[edge.b])});let i=heap.length-1;
    while(i>0){const parent=(i-1)>>1;if(heap[parent].length>=heap[i].length)break;[heap[parent],heap[i]]=[heap[i],heap[parent]];i=parent;}
  };
  const pop=()=>{
    const first=heap[0],last=heap.pop()!;if(heap.length){heap[0]=last;let i=0;while(true){let child=i*2+1;if(child>=heap.length)break;if(child+1<heap.length&&heap[child+1].length>heap[child].length)child++;if(heap[i].length>=heap[child].length)break;[heap[i],heap[child]]=[heap[child],heap[i]];i=child;}}return first;
  };
  edges.forEach((_,k)=>enqueue(k));edgeCreated=enqueue;
  let refinementSplits=0;
  while(heap.length){
    const item=pop(),k=item.key,edge=edges.get(k);if(!edge||item.length<=maxEdge*(1+1e-12)||count+edge.triangles.size>maxTriangles)continue;
    let midpoint=midpointIds.get(k);
    if(midpoint===undefined){const a=points[edge.a],b=points[edge.b];midpoint=vertex([(a[0]+b[0])/2,(a[1]+b[1])/2]);midpointIds.set(k,midpoint);}
    if(split(k,midpoint,false))refinementSplits++;
  }
  let largestEdge=0,remainingLongEdges=0,boundaryEdges=0,internalEdges=0;
  for(const edge of edges.values()){
    const length=distance(points[edge.a],points[edge.b]);largestEdge=Math.max(largestEdge,length);if(length>maxEdge*(1+1e-12))remainingLongEdges++;
    if(edge.triangles.size===1)boundaryEdges++;else if(edge.triangles.size===2)internalEdges++;else throw new Error('Invalid terrain edge adjacency.');
  }
  const positions:number[]=[],indices:number[]=[],normals:number[]=[],uvs:number[]=[],used=new Map<number,number>();
  for(const triangle of triangles){if(!triangle)continue;for(const id of triangle){let compact=used.get(id);if(compact===undefined){compact=used.size;used.set(id,compact);positions.push(points[id][0],heights[id],points[id][1]);uvs.push(points[id][0]/uvMetres,points[id][1]/uvMetres);}indices.push(compact);}}
  VertexData.ComputeNormals(positions,indices,normals);
  if([...positions,...normals,...uvs].some(n=>!Number.isFinite(n)))throw new Error('Nonfinite elevated terrain output.');
  const batches:ElevatedGroundBatch[]=[],groups=new Map<string,Array<{batch:ElevatedGroundBatch;used:Map<number,number>}>>();
  for(let i=0;i<indices.length;i+=3){
    const face=indices.slice(i,i+3),x=face.reduce((n,v)=>n+positions[v*3],0)/3,z=face.reduce((n,v)=>n+positions[v*3+2],0)/3,k=Math.floor(x/tileSize)+','+Math.floor(z/tileSize);
    let list=groups.get(k);if(!list){list=[];groups.set(k,list);}let part=list.at(-1);
    if(!part||part.used.size+face.filter(v=>!part!.used.has(v)).length>maxVertices){const batch:ElevatedGroundBatch={key:k+':'+list.length,positions:[],indices:[],normals:[],uvs:[]};part={batch,used:new Map()};list.push(part);batches.push(batch);}
    for(const global of face){let local=part.used.get(global);if(local===undefined){local=part.used.size;part.used.set(global,local);part.batch.positions.push(...positions.slice(global*3,global*3+3));part.batch.normals.push(...normals.slice(global*3,global*3+3));part.batch.uvs.push(...uvs.slice(global*2,global*2+2));}part.batch.indices.push(local);}
  }
  return {positions,indices,normals,uvs,batches,stats:{polygons:land.length,sourceVertices,initialTriangles,sourceConformitySplits:conformitySplits,refinementSplits,triangles:count,vertices:used.size,batches:batches.length,maxEdge,largestEdge,remainingLongEdges,budgetReached:remainingLongEdges>0,heightSamples:points.length,boundaryEdges,internalEdges,geography:'original-land-polygons-and-holes',topology:'shared-edge-conforming'}};
}

/** Query the piecewise-linear surface actually drawn, avoiding floating feet. */
export function createElevatedGroundSampler(geometry:Pick<ElevatedGroundGeometry,'positions'|'indices'>,requestedCellSize=32){
  if(!Number.isFinite(requestedCellSize)||requestedCellSize<=0)throw new RangeError('Invalid terrain sampling grid size.');
  const {positions,indices}=geometry,cells=new Map<string,number[]>(),large:number[]=[];
  for(let i=0;i<indices.length;i+=3){
    const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3;
    const x0=Math.floor(Math.min(positions[a],positions[b],positions[c])/requestedCellSize),x1=Math.floor(Math.max(positions[a],positions[b],positions[c])/requestedCellSize),z0=Math.floor(Math.min(positions[a+2],positions[b+2],positions[c+2])/requestedCellSize),z1=Math.floor(Math.max(positions[a+2],positions[b+2],positions[c+2])/requestedCellSize);
    if((x1-x0+1)*(z1-z0+1)>4096){large.push(i);continue;}
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const k=x+','+z,list=cells.get(k)??[];list.push(i);cells.set(k,list);}
  }
  return (x:number,z:number):number|undefined=>{
    if(!Number.isFinite(x)||!Number.isFinite(z))return undefined;
    const candidates=cells.get(Math.floor(x/requestedCellSize)+','+Math.floor(z/requestedCellSize))??[];
    for(const offset of [candidates,large])for(const i of offset){
      const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,ax=positions[a],az=positions[a+2],bx=positions[b],bz=positions[b+2],cx=positions[c],cz=positions[c+2];
      const denominator=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);if(!denominator)continue;
      const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/denominator,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/denominator,w=1-u-v;
      if(u>=-1e-9&&v>=-1e-9&&w>=-1e-9)return u*positions[a+1]+v*positions[b+1]+w*positions[c+1];
    }
    return undefined;
  };
}

/** Attach the pure geometry without introducing any new land or gameplay elevation policy. */
export function addElevatedGround(scene:Scene,land:Point[][][],heightAt:(x:number,z:number)=>number,material:Material,options:ElevatedGroundOptions={}){
  const geometry=buildElevatedGroundGeometry(land,heightAt,options),sample=createElevatedGroundSampler(geometry);let disposed=false;
  const meshes=geometry.batches.map(batch=>{
    const mesh=new Mesh('terreno quotato '+batch.key,scene),data=new VertexData();data.positions=batch.positions;data.indices=batch.indices;data.normals=batch.normals;data.uvs=batch.uvs;data.applyToMesh(mesh,false);
    mesh.material=material;mesh.receiveShadows=true;mesh.isPickable=true;mesh.checkCollisions=false;mesh.metadata={solid:true,geography:'land',heightSource:'caller-supplied',topology:geometry.stats.topology};return mesh;
  });
  return {geometry,meshes,stats:geometry.stats,heightAt(x:number,z:number){return disposed?undefined:sample(x,z);},dispose(){disposed=true;meshes.forEach(mesh=>mesh.dispose(false,false));}};
}
