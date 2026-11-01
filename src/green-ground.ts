import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Vector3,Matrix} from '@babylonjs/core/Maths/math.vector';
import type {Scene} from '@babylonjs/core/scene';
import type {Material} from '@babylonjs/core/Materials/material';
import clipping from 'polygon-clipping';
import earcut from 'earcut';
import type {MapData,Point} from './geo';

export interface GreenGroundArea {id:string;name?:string;kind:'park'|'wood'|'forest';polygons:Point[][][]}
export interface GreenGroundData {
  version:1;
  source:{license:'ODbL-1.0';rawSha256:string;bounds:[number,number,number,number];[key:string]:unknown};
  areas:GreenGroundArea[];
  /** Union of the source areas, already clipped to the real city land and viewport. */
  coverage:Point[][][];
}
export interface GreenGroundSourceGeometry {positions:ArrayLike<number>;indices:ArrayLike<number>;normals?:ArrayLike<number>}
export interface GreenGroundOptions {material:Material;groundMeshes?:readonly Mesh[];offset?:number;tileSize?:number;maxTriangles?:number}
export interface GreenGroundBatch {key:string;positions:number[];indices:number[];normals:number[];uvs:number[]}
export interface GreenGroundStats {sourceAreas:number;coveragePolygons:number;sourceTriangles:number;testedTriangles:number;coveredSourceTriangles:number;triangles:number;batches:number;vertexCount:number;geography:'source-area-polygons-only';surface:'original-ground-triangle-interpolation';landCover:'grass-like artistic material for mapped parks/wood/forest'}
type Bounds=[number,number,number,number];type V3=[number,number,number];
const EPS=1e-8,CELL=64;
function bounds(ring:readonly Point[]):Bounds{return[Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))];}
const overlaps=(a:Bounds,b:Bounds)=>a[0]<=b[2]+EPS&&a[2]>=b[0]-EPS&&a[1]<=b[3]+EPS&&a[3]>=b[1]-EPS;
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function ringArea(ring:Point[]){let sum=0;for(let i=0;i<ring.length;i++){const p=ring[i],q=ring[(i+1)%ring.length];sum+=p[0]*q[1]-q[0]*p[1];}return sum/2;}

export function validateGreenGround(raw:unknown):GreenGroundData {
  if(!raw||typeof raw!=='object')throw new Error('Dati aree verdi mancanti.');
  const data=raw as GreenGroundData,b=data.source?.bounds;
  if(data.version!==1||data.source?.license!=='ODbL-1.0'||!/^([a-f0-9]{64})$/i.test(data.source.rawSha256??'')||!Array.isArray(b)||b.length!==4||!b.every(Number.isFinite)||b[0]>=b[2]||b[1]>=b[3])throw new Error('Provenienza aree verdi non valida.');
  if(!Array.isArray(data.areas)||data.areas.length>100||data.areas.some(a=>!/^((way|relation)\/\d+)$/.test(a.id)||!['park','wood','forest'].includes(a.kind))||new Set(data.areas.map(a=>a.id)).size!==data.areas.length)throw new Error('Identità delle aree verdi non valida.');
  if(!Array.isArray(data.coverage)||data.coverage.length>200)throw new Error('Numero aree verdi non valido.');
  let vertices=0;
  for(const polygon of data.coverage){
    if(!Array.isArray(polygon)||!polygon.length||polygon.length>1000)throw new Error('Poligono verde non valido.');
    for(const ring of polygon){
      if(!Array.isArray(ring)||ring.length<3)throw new Error('Anello verde non valido.');
      for(const p of ring){vertices++;if(vertices>50000||!Array.isArray(p)||p.length!==2||!p.every(Number.isFinite)||p[0]<b[0]-EPS||p[0]>b[2]+EPS||p[1]<b[1]-EPS||p[1]>b[3]+EPS)throw new Error('Geometria verde fuori dal perimetro verificato.');}
      if(Math.abs(ringArea(ring))<EPS)throw new Error('Anello verde degenere.');
    }
  }
  return data;
}

/** Clip real ground faces, rather than draping a separate coarse park mesh over them. */
export function buildGreenGroundGeometry(raw:unknown,ground:readonly GreenGroundSourceGeometry[],options:{offset?:number;tileSize?:number;maxTriangles?:number}={}){
  const data=validateGreenGround(raw),offset=options.offset??.012,tileSize=options.tileSize??256,maxTriangles=options.maxTriangles??100000;
  if(!Number.isFinite(offset)||offset<0||offset>.05||!Number.isFinite(tileSize)||tileSize<32||tileSize>512||!Number.isInteger(maxTriangles)||maxTriangles<1||maxTriangles>200000)throw new RangeError('Limiti superficie verde non validi.');
  const stats:GreenGroundStats={sourceAreas:data.areas.length,coveragePolygons:data.coverage.length,sourceTriangles:0,testedTriangles:0,coveredSourceTriangles:0,triangles:0,batches:0,vertexCount:0,geography:'source-area-polygons-only',surface:'original-ground-triangle-interpolation',landCover:'grass-like artistic material for mapped parks/wood/forest'};
  const polygonBounds=data.coverage.map(p=>bounds(p[0])),cells=new Map<string,Set<number>>();
  for(let i=0;i<data.coverage.length;i++){const b=polygonBounds[i];for(let x=Math.floor(b[0]/CELL);x<=Math.floor(b[2]/CELL);x++)for(let z=Math.floor(b[1]/CELL);z<=Math.floor(b[3]/CELL);z++){const key=x+','+z,set=cells.get(key)??new Set<number>();set.add(i);cells.set(key,set);}}
  const batches:GreenGroundBatch[]=[],lookup=new Map<string,GreenGroundBatch>();
  const getBatch=(p:Point,vertices:number)=>{if(vertices>60000)throw new Error('Un poligono verde supera il budget vertici.');const base=Math.floor(p[0]/tileSize)+','+Math.floor(p[1]/tileSize);let key=base,n=0;while((lookup.get(key)?.positions.length??0)/3+vertices>60000)key=base+':'+(++n);let batch=lookup.get(key);if(!batch){batch={key,positions:[],indices:[],normals:[],uvs:[]};lookup.set(key,batch);batches.push(batch);}return batch;};
  for(const source of ground){
    const p=source.positions,ids=source.indices,normals=source.normals;
    if(p.length%3||ids.length%3||p.length>1500000||ids.length>1200000)throw new Error('Geometria terreno non valida.');
    for(let i=0;i<ids.length;i+=3){
      const vertices=Array.from({length:3},(_,k)=>{const id=ids[i+k];if(!Number.isInteger(id)||id<0||id*3+2>=p.length)throw new Error('Indice terreno non valido.');const v:V3=[p[id*3],p[id*3+1],p[id*3+2]];if(!v.every(Number.isFinite))throw new Error('Vertice terreno non finito.');return v;});
      const [a,b,c]=vertices,tri:Point[]=[[a[0],a[2]],[b[0],b[2]],[c[0],c[2]]],denominator=cross(tri[0],tri[1],tri[2]);
      // Babylon's upward top faces have positive projected X/Z winding.
      if(denominator<=EPS)continue;stats.sourceTriangles++;
      const box=bounds(tri),nearby=new Set<number>(),sourceBounds=data.source.bounds;
      // Query only the source viewport, even if a caller supplies a very large ground face.
      const query:Bounds=[Math.max(box[0],sourceBounds[0]),Math.max(box[1],sourceBounds[1]),Math.min(box[2],sourceBounds[2]),Math.min(box[3],sourceBounds[3])];
      if(query[0]>query[2]||query[1]>query[3])continue;
      for(let x=Math.floor(query[0]/CELL);x<=Math.floor(query[2]/CELL);x++)for(let z=Math.floor(query[1]/CELL);z<=Math.floor(query[3]/CELL);z++)for(const candidate of cells.get(x+','+z)??[])if(overlaps(box,polygonBounds[candidate]))nearby.add(candidate);
      if(!nearby.size)continue;stats.testedTriangles++;
      const candidates=[...nearby].map(id=>data.coverage[id]),cover=candidates.length===1?candidates[0]:clipping.union(candidates[0],...candidates.slice(1));
      const clipped=clipping.intersection([tri],cover);
      let covered=false;
      const weights=(point:Point)=>{const wb=((point[0]-a[0])*(c[2]-a[2])-(point[1]-a[2])*(c[0]-a[0]))/denominator,wc=((b[0]-a[0])*(point[1]-a[2])-(b[2]-a[2])*(point[0]-a[0]))/denominator;return[1-wb-wc,wb,wc];};
      const fallback=new Vector3((b[2]-a[2])*(c[1]-a[1])-(b[1]-a[1])*(c[2]-a[2]),denominator,(b[1]-a[1])*(c[0]-a[0])-(b[0]-a[0])*(c[1]-a[1])).normalize();
      for(const polygon of clipped){
        const rings=polygon.map(ring=>{const out=ring.map(q=>[q[0],q[1]] as Point);if(out.length>1&&Math.hypot(out[0][0]-out.at(-1)![0],out[0][1]-out.at(-1)![1])<EPS)out.pop();return out;}).filter(r=>r.length>=3&&Math.abs(ringArea(r))>EPS);
        if(!rings.length)continue;
        const flat:number[]=[],holes:number[]=[],points:Point[]=[];for(let r=0;r<rings.length;r++){if(r)holes.push(points.length);for(const point of rings[r]){points.push(point);flat.push(...point);}}
        const triangles=earcut(flat,holes,2);if(!triangles.length)continue;
        if(stats.triangles+triangles.length/3>maxTriangles)throw new Error('La superficie verde supera il budget triangoli.');
        const batch=getBatch(tri[0],points.length),start=batch.positions.length/3;
        for(const point of points){
          const w=weights(point),y=w[0]*a[1]+w[1]*b[1]+w[2]*c[1];
          batch.positions.push(point[0],y+offset,point[1]);batch.uvs.push(point[0]/2,point[1]/2);
          const normal=normals?new Vector3(...[0,1,2].map(axis=>w.reduce((sum,value,k)=>sum+value*normals[ids[i+k]*3+axis],0)) as V3).normalize():fallback;
          if(![normal.x,normal.y,normal.z].every(Number.isFinite)||normal.lengthSquared()<.5)throw new Error('Normale terreno non valida.');
          batch.normals.push(normal.x,normal.y,normal.z);
        }
        for(let t=0;t<triangles.length;t+=3){const indices=triangles.slice(t,t+3);if(cross(points[indices[0]],points[indices[1]],points[indices[2]])<0)[indices[1],indices[2]]=[indices[2],indices[1]];batch.indices.push(...indices.map(id=>start+id));}
        stats.triangles+=triangles.length/3;covered=true;
      }
      if(covered)stats.coveredSourceTriangles++;
    }
  }
  stats.batches=batches.length;stats.vertexCount=batches.reduce((sum,b)=>sum+b.positions.length/3,0);return{batches,stats};
}

/** Caller supplies the licensed grass material; geometry remains non-colliding decoration. */
export function addGreenGround(scene:Scene,_map:MapData,data:unknown,options:GreenGroundOptions){
  const ground=options.groundMeshes??scene.meshes.filter((m):m is Mesh=>m instanceof Mesh&&m.metadata?.geography==='land'&&!m.metadata?.greenGround);
  const source:GreenGroundSourceGeometry[]=ground.map(mesh=>{
    const positions=mesh.getVerticesData('position'),indices=mesh.getIndices();if(!positions||!indices)return{positions:[],indices:[]};
    const world=mesh.computeWorldMatrix(true),normalMatrix=Matrix.Transpose(Matrix.Invert(world)),localNormals=mesh.getVerticesData('normal'),p:number[]=[],n:number[]=[];
    for(let i=0;i<positions.length;i+=3){const point=Vector3.TransformCoordinates(new Vector3(positions[i],positions[i+1],positions[i+2]),world);p.push(point.x,point.y,point.z);if(localNormals){const normal=Vector3.TransformNormal(new Vector3(localNormals[i],localNormals[i+1],localNormals[i+2]),normalMatrix).normalize();n.push(normal.x,normal.y,normal.z);}}
    return{positions:p,indices,normals:localNormals?n:undefined};
  });
  const geometry=buildGreenGroundGeometry(data,source,options),meshes=geometry.batches.map(batch=>{const mesh=new Mesh('suolo verde OSM '+batch.key,scene),vertices=new VertexData();vertices.positions=batch.positions;vertices.indices=batch.indices;vertices.normals=batch.normals;vertices.uvs=batch.uvs;vertices.applyToMesh(mesh);mesh.material=options.material;mesh.receiveShadows=true;mesh.isPickable=false;mesh.checkCollisions=false;mesh.metadata={solid:false,greenGround:true,source:'OSM park/wood/forest polygons; artistic grass cover',height:'original ground triangles',offsetMetres:options.offset??.012};return mesh;});
  scene.metadata={...(scene.metadata??{}),greenGround:geometry.stats};return{meshes,stats:geometry.stats,dispose(){for(const mesh of meshes)mesh.dispose(false,false);}};
}
