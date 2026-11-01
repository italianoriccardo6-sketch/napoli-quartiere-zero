import earcut,{deviation} from 'earcut';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import type {Material} from '@babylonjs/core/Materials/material';
import type {Scene} from '@babylonjs/core/scene';
import {inside,type Point} from './geo';
import {partitionGroundMaterials} from './ground-material-partition';
import {GROUND_PROJECTED_AREA_EPSILON} from './ground-numerics';

export interface ElevatedGroundOptions {
  maxEdge?:number;
  maxTriangles?:number;
  tileSize?:number;
  maxVerticesPerBatch?:number;
  uvMetres?:number;
  /** Optional finer spacing on steep or curved source terrain; omitted means disabled. */
  adaptiveMinEdge?:number;
  steepGrade?:number;
  midpointError?:number;
  /** Adaptive requests require supported endpoints/midpoint; conforming neighbours use heightAt. */
  adaptiveMask?:(x:number,z:number)=>boolean;
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
  adaptiveEnabled:boolean;adaptiveMinEdge:number|null;adaptiveSteepGrade:number|null;adaptiveMidpointError:number|null;
  adaptiveRefinementSplits:number;adaptiveConformitySplits:number;adaptiveProbeEdges:number;adaptiveMaskRejectedEdges:number;remainingAdaptiveEdges:number;
  /** Requested splits which cannot preserve positive faces at floating precision. */
  numericallyLimitedEdges:number;
  /** All unique source-height queries, including midpoint probes not inserted as vertices. */
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
 * budget is exhausted. Heights and optional midpoint probes are cached by their
 * exact XY coordinate. This is geometry only: the caller must establish the
 * height source, vertical origin and any adaptive source-support mask.
 */
export function buildElevatedGroundGeometry(input:Point[][][],heightAt:(x:number,z:number)=>number,options:ElevatedGroundOptions={}):ElevatedGroundGeometry {
  if(typeof heightAt!=='function')throw new TypeError('A terrain height sampler is required.');
  const maxEdge=bounded(options.maxEdge,20,.1,1000,'maximum edge'),maxTriangles=bounded(options.maxTriangles,160000,1,200000,'triangle budget',true);
  const tileSize=bounded(options.tileSize,128,1,4096,'tile size'),maxVertices=bounded(options.maxVerticesPerBatch,60000,3,60000,'batch vertex budget',true),uvMetres=bounded(options.uvMetres,2,.01,1000,'UV scale');
  const adaptiveEnabled=options.adaptiveMinEdge!==undefined||options.steepGrade!==undefined||options.midpointError!==undefined;
  const adaptiveMinEdge=adaptiveEnabled?bounded(options.adaptiveMinEdge,Math.min(5,maxEdge),.1,maxEdge,'adaptive minimum edge'):null;
  const steepGrade=adaptiveEnabled?bounded(options.steepGrade,.6,0,1000,'adaptive steep grade'):null,midpointError=adaptiveEnabled?bounded(options.midpointError,.75,0,10000,'adaptive midpoint error'):null;
  if(options.adaptiveMask!==undefined&&typeof options.adaptiveMask!=='function')throw new TypeError('Invalid adaptive terrain support mask.');
  const land=prepareLand(input),points:Point[]=[],heights:number[]=[],pointIds=new Map<string,number>(),heightCache=new Map<string,number>(),supportCache=new Map<string,boolean>();
  const sample=(p:Point)=>{
    const coordinate=p[0]+','+p[1],known=heightCache.get(coordinate);if(known!==undefined)return known;
    const height=heightAt(p[0],p[1]);if(!Number.isFinite(height)||!Number.isFinite(Math.fround(height)))throw new Error('The terrain sampler returned a nonfinite height.');
    heightCache.set(coordinate,height);return height;
  };
  const supported=(p:Point)=>{
    if(!options.adaptiveMask)return true;
    const coordinate=p[0]+','+p[1],known=supportCache.get(coordinate);if(known!==undefined)return known;
    const allowed=options.adaptiveMask(p[0],p[1])===true;supportCache.set(coordinate,allowed);return allowed;
  };
  const vertex=(p:Point)=>{
    const coordinate=p[0]+','+p[1],existing=pointIds.get(coordinate);if(existing!==undefined)return existing;
    const height=sample(p);
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
      edge.triangles.add(id);if(edge.triangles.size>2)throw new Error('Nonmanifold or duplicate terrain faces.',{cause:{edge:k,points:[points[edge.a],points[edge.b]],faces:[...edge.triangles].map(face=>triangles[face]!.map(v=>({id:v,point:points[v]})))}});
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
  const sourceVertices=points.length,midpointIds=new Map<string,number>(),numericalLimits=new Set<string>(),budgetLimits=new Set<string>();
  const split=(k:string,m:number,mandatory:boolean)=>{
    const edge=edges.get(k);if(!edge)return false;
    const incident=[...edge.triangles];
    if(count+incident.length>maxTriangles){if(mandatory)throw new Error('Triangle budget cannot conform the source boundary.');budgetLimits.add(k);return false;}
    const old=incident.map(id=>triangles[id]!);
    const children:Triangle[]=[];
    for(const triangle of old){
      const i=triangle.findIndex((v,i)=>key(v,triangle[(i+1)%3])===k),a=triangle[i],b=triangle[(i+1)%3],opposite=triangle[(i+2)%3];
      children.push([a,m,opposite],[m,b,opposite]);
    }
    // Preserve parent winding. A midpoint rounded outside an extremely thin
    // source face must not be made positive by reversing its child: that would
    // overlap its neighbour. Leave that edge intact and report the precision
    // limit instead. All other incident faces remain intact with it.
    const invalid=children.some(t=>cross(points[t[0]],points[t[1]],points[t[2]])<=0);
    const adjacency=new Map<string,number>();
    for(const t of children)for(let i=0;i<3;i++){const childKey=key(t[i],t[(i+1)%3]);adjacency.set(childKey,(adjacency.get(childKey)??0)+1);}
    for(const [childKey,added] of adjacency){const current=edges.get(childKey);if(added+(current?[...current.triangles].filter(id=>!incident.includes(id)).length:0)>2){if(mandatory)throw new Error('The source boundary cannot form a conforming triangulation.');numericalLimits.add(k);return false;}}
    if(invalid){if(mandatory)throw new Error('The source boundary cannot form positive terrain faces.');numericalLimits.add(k);return false;}
    incident.forEach(remove);
    for(const triangle of children)add(...triangle);
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
  const probedEdges=new Set<string>(),maskedEdges=new Set<string>();
  const adaptiveRequired=(k:string,edge:Edge,length:number)=>{
    if(!adaptiveEnabled||length<=adaptiveMinEdge!*(1+1e-12))return false;
    const a=points[edge.a],b=points[edge.b],midpoint:Point=[(a[0]+b[0])/2,(a[1]+b[1])/2];
    if(!supported(a)||!supported(b)||!supported(midpoint)){maskedEdges.add(k);return false;}
    probedEdges.add(k);
    const middleHeight=sample(midpoint);
    return Math.abs(heights[edge.b]-heights[edge.a])/length>steepGrade!||Math.abs(middleHeight-(heights[edge.a]+heights[edge.b])/2)>midpointError!;
  };
  let refinementSplits=0,adaptiveRefinementSplits=0,adaptiveConformitySplits=0;
  const refine=(root:string,adaptive:boolean)=>{
    const pending:Array<{key:string;conformity:boolean}>=[{key:root,conformity:false}];
    while(pending.length){
      const request=pending.at(-1)!,edge=edges.get(request.key);if(!edge){pending.pop();continue;}
      if(count+edge.triangles.size>maxTriangles){for(const entry of pending)budgetLimits.add(entry.key);return;}
      if(adaptive){
        const length=distance(points[edge.a],points[edge.b]);let longer:string|undefined,longest=length;
        for(const id of edge.triangles){
          const t=triangles[id]!,a=points[t[0]],b=points[t[1]],c=points[t[2]],sides=t.map((v,i)=>distance(points[v],points[t[(i+1)%3]])),maximum=Math.max(...sides);
          if(cross(a,b,c)/maximum<=EPS){for(const entry of pending)numericalLimits.add(entry.key);return;}
          for(let i=0;i<3;i++)if(sides[i]>longest*(1+1e-12)){longest=sides[i];longer=key(t[i],t[(i+1)%3]);}
        }
        // Adaptive selection does not imply that the selected edge is the
        // longest in its faces. Bisect those longer neighbours first so an
        // unrefined edge cannot attract infinitely thinner source-height fans.
        if(longer){pending.push({key:longer,conformity:true});continue;}
      }
      let midpoint=midpointIds.get(request.key);
      if(midpoint===undefined){const a=points[edge.a],b=points[edge.b];midpoint=vertex([(a[0]+b[0])/2,(a[1]+b[1])/2]);midpointIds.set(request.key,midpoint);}
      if(!split(request.key,midpoint,false)){for(const entry of pending)numericalLimits.add(entry.key);return;}
      refinementSplits++;if(adaptive){if(request.conformity)adaptiveConformitySplits++;else adaptiveRefinementSplits++;}pending.pop();
    }
  };
  while(heap.length){
    const item=pop(),k=item.key,edge=edges.get(k);if(!edge)continue;
    const long=item.length>maxEdge*(1+1e-12),adapt=!long&&adaptiveRequired(k,edge,item.length);
    if(!long&&!adapt)continue;
    refine(k,adapt);
  }
  let largestEdge=0,remainingLongEdges=0,remainingAdaptiveEdges=0,boundaryEdges=0,internalEdges=0;
  for(const [k,edge] of edges){
    const length=distance(points[edge.a],points[edge.b]);largestEdge=Math.max(largestEdge,length);
    if(length>maxEdge*(1+1e-12))remainingLongEdges++;else if(adaptiveRequired(k,edge,length))remainingAdaptiveEdges++;
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
  return {positions,indices,normals,uvs,batches,stats:{polygons:land.length,sourceVertices,initialTriangles,sourceConformitySplits:conformitySplits,refinementSplits,triangles:count,vertices:used.size,batches:batches.length,maxEdge,largestEdge,remainingLongEdges,budgetReached:[...budgetLimits].some(k=>edges.has(k)),adaptiveEnabled,adaptiveMinEdge,adaptiveSteepGrade:steepGrade,adaptiveMidpointError:midpointError,adaptiveRefinementSplits,adaptiveConformitySplits,adaptiveProbeEdges:probedEdges.size,adaptiveMaskRejectedEdges:maskedEdges.size,remainingAdaptiveEdges,numericallyLimitedEdges:[...numericalLimits].filter(k=>edges.has(k)).length,heightSamples:heightCache.size,boundaryEdges,internalEdges,geography:'original-land-polygons-and-holes',topology:'shared-edge-conforming'}};
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
    let boundaryFallback:number|undefined;
    for(const offset of [candidates,large])for(const i of offset){
      const a=indices[i]*3,b=indices[i+1]*3,c=indices[i+2]*3,ax=positions[a],az=positions[a+2],bx=positions[b],bz=positions[b+2],cx=positions[c],cz=positions[c+2];
      // Match the projected-face cutoff used by conformSurfaceToGround.
      const denominator=(bx-ax)*(cz-az)-(bz-az)*(cx-ax);if(Math.abs(denominator)<=GROUND_PROJECTED_AREA_EPSILON)continue;
      const u=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/denominator,v=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/denominator,w=1-u-v;
      // A tolerant hit just outside a broad face must not hide a genuinely
      // containing skinny neighbour. Such faces can carry steep source detail
      // even when their projected separation is only a few floating units.
      const height=positions[c+1]+u*(positions[a+1]-positions[c+1])+v*(positions[b+1]-positions[c+1]);
      if(u>=0&&v>=0&&w>=0)return height;
      if(boundaryFallback===undefined&&u>=-1e-9&&v>=-1e-9&&w>=-1e-9)boundaryFallback=height;
    }
    return boundaryFallback;
  };
}

/** Attach the pure geometry without introducing any new land or gameplay elevation policy. */
export function addElevatedGround(scene:Scene,land:Point[][][],heightAt:(x:number,z:number)=>number,material:Material,options:ElevatedGroundOptions&{steepMaterial?:Material;steepSlopeDegrees?:number}={}){
  const geometry=buildElevatedGroundGeometry(land,heightAt,options),sample=createElevatedGroundSampler(geometry);let disposed=false;
  const partition=options.steepMaterial?partitionGroundMaterials(geometry.batches,options.steepSlopeDegrees??45,options.uvMetres??2):undefined;
  const meshes=(partition?.batches??geometry.batches).map(batch=>{
    const mesh=new Mesh('terreno quotato '+batch.key,scene),data=new VertexData();data.positions=batch.positions;data.indices=batch.indices;data.normals=batch.normals;data.uvs=batch.uvs;data.applyToMesh(mesh,false);
    const steep='surface' in batch&&batch.surface==='steep-stone';mesh.material=steep?options.steepMaterial??material:material;mesh.receiveShadows=true;mesh.isPickable=true;mesh.checkCollisions=false;mesh.metadata={solid:true,geography:'land',heightSource:'caller-supplied',topology:geometry.stats.topology,surface:steep?'steep-stone':'paving',materialClassification:partition?'artistic-slope-based-not-measured-geology':'caller-supplied',uvProjection:'projection' in batch?batch.projection:'xz'};return mesh;
  });
  return {geometry,meshes,stats:geometry.stats,surfaceStats:partition?.stats,heightAt(x:number,z:number){return disposed?undefined:sample(x,z);},dispose(){disposed=true;meshes.forEach(mesh=>mesh.dispose(false,false));}};
}
