import {Scene} from '@babylonjs/core/scene';import {Mesh} from '@babylonjs/core/Meshes/mesh';import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Material} from '@babylonjs/core/Materials/material';import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';import {Color3} from '@babylonjs/core/Maths/math.color';import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import earcut from 'earcut';import {inside,segmentDistance,type MapData,type Point,type Footprint} from './geo';import type {CityRuntime} from './city-data';
import {joinedStreetSections,offsetStreetSection,type StreetSection} from './street-sections';
export interface CoastDetailOptions {radius?:number;height?:number;width?:number;maxSpans?:number;material?:Material;materials?:{stone?:Material};shadows?:ShadowGenerator;groundHeight?:(x:number,z:number)=>number}
export interface CoastDetailStats {sourceCoastlines:number;sourceVertices:number;spans:number;lengthMetres:number;outsideBounds:number;outsideCorridor:number;routeConflicts:number;buildingConflicts:number;meshCount:number;vertexCount:number;sourcePositionPolicy:'actual-coastline-only';profileDimensions:'inferred';wallExistence:'visual-assumption';collisionGeometryAdded:false}
export interface CoastBatch {key:string;positions:number[];indices:number[];uvs:number[]}
export interface CoastSpan {a:Point;b:Point;coastlineIndex:number}
export interface CoastDetailGeometry {batches:CoastBatch[];spans:CoastSpan[];stats:CoastDetailStats}
type V3=[number,number,number];const EPS=1e-7;
function limit(value:number|undefined,fallback:number,min:number,max:number){const result=value??fallback;if(!Number.isFinite(result)||result<min||result>max)throw new RangeError('Limite del dettaglio costiero non valido.');return result;}
function distanceToPaths(point:Point,paths:Point[][]){let distance=Infinity;for(const path of paths)for(let i=1;i<path.length;i++)distance=Math.min(distance,segmentDistance(point,path[i-1],path[i]));return distance;}
function lineDistance(a:Point,b:Point,c:Point,d:Point){const cross=(p:Point,q:Point,r:Point)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);if(cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0&&Math.max(a[0],b[0])+EPS>=Math.min(c[0],d[0])&&Math.max(c[0],d[0])+EPS>=Math.min(a[0],b[0])&&Math.max(a[1],b[1])+EPS>=Math.min(c[1],d[1])&&Math.max(c[1],d[1])+EPS>=Math.min(a[1],b[1]))return 0;return Math.min(segmentDistance(a,c,d),segmentDistance(b,c,d),segmentDistance(c,a,b),segmentDistance(d,a,b));}
function nearBuildings(buildings:Footprint[]){
 const grid=new Map<string,Set<Footprint>>(),cell=32;
 for(const building of buildings){const ring=building.rings[0];if(!ring?.length)continue;const xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/cell);x<=Math.floor(Math.max(...xs)/cell);x++)for(let z=Math.floor(Math.min(...zs)/cell);z<=Math.floor(Math.max(...zs)/cell);z++){const key=x+','+z,values=grid.get(key)??new Set<Footprint>();values.add(building);grid.set(key,values);}}
 return (point:Point)=>{for(const building of grid.get(Math.floor(point[0]/cell)+','+Math.floor(point[1]/cell))??[]){if(inside(point,building.rings[0])&&!building.rings.slice(1).some(h=>inside(point,h)))return true;for(const ring of building.rings)for(let i=0;i<ring.length;i++)if(segmentDistance(point,ring[i],ring[(i+1)%ring.length])<.03)return true;}return false;};
}
/**
 * An original low quay profile follows the real source shoreline. The reference
 * photograph supports stone parapets on the waterfront, not a surveyed wall at
 * every shoreline edge. Width, height and continuous wall presence are inferred.
 * Source: acquired Partenope photograph, DimiTalen (2010), public-domain CC0:
 * https://commons.wikimedia.org/wiki/File:View_of_Via_Partenope_and_the_marina_from_Castel_dell%27Ovo,_Naples,_2010.jpg
 */
export function buildCoastDetailGeometry(map:MapData,detail:CityRuntime,options:CoastDetailOptions={}):CoastDetailGeometry {
 const radius=limit(options.radius,100,1,100),height=limit(options.height,.78,.65,.9),width=limit(options.width,.25,.2,.35),maxSpans=Math.floor(limit(options.maxSpans,800,0,1600));
 const groundHeight=options.groundHeight??(()=>0),sectionHeights=new WeakMap<StreetSection,number>();
 if(typeof groundHeight!=='function')throw new TypeError('Campionatore del terreno costiero non valido.');
 const coastlines=detail.coastlines??[],stats:CoastDetailStats={sourceCoastlines:coastlines.length,sourceVertices:coastlines.reduce((n,c)=>n+c.points.length,0),spans:0,lengthMetres:0,outsideBounds:0,outsideCorridor:0,routeConflicts:0,buildingConflicts:0,meshCount:0,vertexCount:0,sourcePositionPolicy:'actual-coastline-only',profileDimensions:'inferred',wallExistence:'visual-assumption',collisionGeometryAdded:false};
 const batches:CoastBatch[]=[],spans:CoastSpan[]=[],lookup=new Map<string,CoastBatch>();if(!maxSpans)return {batches,spans,stats};
 const [west,south,east,north]=detail.bounds;if(![west,south,east,north].every(Number.isFinite)||west>=east||south>=north)throw new Error('Perimetro costiero non valido.');
 const validPath=(p:Point[])=>p.length>1&&p.every(v=>v.length===2&&v.every(Number.isFinite)),route=validPath(detail.route)?detail.route:[],paths=[...detail.roads.filter(r=>/\bpartenope\b/i.test(r.name??'')&&validPath(r.points)).map(r=>r.points),...(route.length?[route]:[])];if(!paths.length)return {batches,spans,stats};
 const half=width/2,profile:Array<[number,number]>=[[-half,.025],[-half,height-.065],[-half-.025,height-.045],[-half-.025,height],[half+.025,height],[half+.025,height-.045],[half,height-.065],[half,.025]],profileDistances=[0];
 for(let i=1;i<=profile.length;i++){const a=profile[(i-1)%profile.length],b=profile[i%profile.length];profileDistances.push(profileDistances.at(-1)!+Math.hypot(b[0]-a[0],b[1]-a[1]));}
 const occupied=nearBuildings(map.buildings),inBounds=(p:Point)=>p[0]>west+.01&&p[0]<east-.01&&p[1]>south+.01&&p[1]<north-.01;
 // Sample the real shoreline centre once per section. Every profile and cap
 // vertex shares that base, including the width that projects over water.
 const sectionHeight=(section:StreetSection)=>{const known=sectionHeights.get(section);if(known!==undefined)return known;const base=groundHeight(section.point[0],section.point[1]);if(!Number.isFinite(base))throw new TypeError('Quota del terreno costiero non finita.');sectionHeights.set(section,base);return base;};
 const vertex=(section:StreetSection,p:[number,number]):V3=>{const point=offsetStreetSection(section,p[0]);return [point[0],sectionHeight(section)+p[1],point[1]];};
 function batch(mid:Point){const base=Math.floor(mid[0]/128)+','+Math.floor(mid[1]/128);let key=base,part=0;while((lookup.get(key)?.positions.length??0)>170000)key=base+':'+(++part);let result=lookup.get(key);if(!result){result={key,positions:[],indices:[],uvs:[]};lookup.set(key,result);batches.push(result);}return result;}
 function triangle(target:CoastBatch,index:number,a:V3,b:V3,c:V3,desired:V3){const u=a.map((n,i)=>n-b[i]),v=c.map((n,i)=>n-b[i]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(normal[0]*desired[0]+normal[1]*desired[1]+normal[2]*desired[2]<0)target.indices.push(index,index+2,index+1);else target.indices.push(index,index+1,index+2);}
 function quad(target:CoastBatch,vertices:V3[],uvs:number[],desired:V3){const start=target.positions.length/3;target.positions.push(...vertices.flat());target.uvs.push(...uvs);triangle(target,start,vertices[0],vertices[1],vertices[2],desired);const a=vertices[0],b=vertices[2],c=vertices[3],u=a.map((n,i)=>n-b[i]),v=c.map((n,i)=>n-b[i]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(normal[0]*desired[0]+normal[1]*desired[1]+normal[2]*desired[2]<0)target.indices.push(start,start+3,start+2);else target.indices.push(start,start+2,start+3);}
 function cap(section:StreetSection,tangent:Point,atEnd:boolean){const target=batch(section.point),offset=target.positions.length/3,vertices=profile.map(p=>vertex(section,p));target.positions.push(...vertices.flat());target.uvs.push(...profile.flat());const indices=earcut(profile.flat()),desired:V3=[tangent[0]*(atEnd?1:-1),0,tangent[1]*(atEnd?1:-1)];for(let i=0;i<indices.length;i+=3){const [ia,ib,ic]=indices.slice(i,i+3),a=vertices[ia],b=vertices[ib],c=vertices[ic],u=a.map((n,j)=>n-b[j]),v=c.map((n,j)=>n-b[j]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];if(normal[0]*desired[0]+normal[2]*desired[2]<0)target.indices.push(offset+ia,offset+ic,offset+ib);else target.indices.push(offset+ia,offset+ib,offset+ic);}}
 for(let coastIndex=0;coastIndex<coastlines.length&&stats.spans<maxSpans;coastIndex++){
  const source=coastlines[coastIndex],points=source.closed&&source.points.length>2?[...source.points,source.points[0]]:source.points,sections=joinedStreetSections(points,2.5);let previous:StreetSection|null=null,previousDirection:Point=[1,0];
  for(let i=1;i<sections.length&&stats.spans<maxSpans;i++){
   const a=sections[i-1],b=sections[i],mid:Point=[(a.point[0]+b.point[0])/2,(a.point[1]+b.point[1])/2],spanLength=Math.hypot(b.point[0]-a.point[0],b.point[1]-a.point[1]);if(spanLength<EPS)continue;
   const tangent:Point=[(b.point[0]-a.point[0])/spanLength,(b.point[1]-a.point[1])/spanLength],edgePoints=[...profile.map(p=>offsetStreetSection(a,p[0])),...profile.map(p=>offsetStreetSection(b,p[0]))],samplePoints=[a.point,mid,b.point,...edgePoints];let accepted=true;
   if(samplePoints.some(p=>!inBounds(p))){stats.outsideBounds++;accepted=false;}
   else if([a.point,mid,b.point].some(p=>distanceToPaths(p,paths)>radius)){stats.outsideCorridor++;accepted=false;}
   else if(profile.some(p=>{const edgeA=offsetStreetSection(a,p[0]),edgeB=offsetStreetSection(b,p[0]);return route.some((v,j)=>j>0&&lineDistance(edgeA,edgeB,route[j-1],v)<1.1);})){stats.routeConflicts++;accepted=false;}
   else if(samplePoints.some(occupied)){stats.buildingConflicts++;accepted=false;}
   if(!accepted){if(previous){cap(previous,previousDirection,true);previous=null;}continue;}
   if(!previous)cap(a,tangent,false);
   const target=batch(mid),normal:Point=[-tangent[1],tangent[0]];
   for(let j=0;j<profile.length;j++){const p=profile[j],q=profile[(j+1)%profile.length],desired:V3=[normal[0]*(p[1]-q[1]),q[0]-p[0],normal[1]*(p[1]-q[1])];quad(target,[vertex(a,p),vertex(a,q),vertex(b,q),vertex(b,p)],[a.distance,profileDistances[j],a.distance,profileDistances[j+1],b.distance,profileDistances[j+1],b.distance,profileDistances[j]],desired);}
   spans.push({a:[...a.point],b:[...b.point],coastlineIndex:coastIndex});stats.spans++;stats.lengthMetres+=spanLength;previous=b;previousDirection=tangent;
  }
  if(previous)cap(previous,previousDirection,true);
 }
 stats.meshCount=batches.length;stats.vertexCount=batches.reduce((n,b)=>n+b.positions.length/3,0);return {batches,spans,stats};
}
export function addCoastDetail(scene:Scene,map:MapData,detail:CityRuntime,options:CoastDetailOptions={}){
 const geometry=buildCoastDetailGeometry(map,detail,options),supplied=options.material??options.materials?.stone,material=supplied??new StandardMaterial('pietra parapetto costiero stimato',scene);
 if(!supplied){const stone=material as StandardMaterial;stone.diffuseColor=Color3.FromHexString('#827b69');stone.specularColor.set(.025,.025,.02);}
 const meshes=geometry.batches.map(batch=>{const mesh=new Mesh('profilo costa reale '+batch.key,scene),vertices=new VertexData(),normals:number[]=[];vertices.positions=batch.positions;vertices.indices=batch.indices;vertices.uvs=batch.uvs;VertexData.ComputeNormals(batch.positions,batch.indices,normals);vertices.normals=normals;vertices.applyToMesh(mesh);mesh.material=material;mesh.receiveShadows=true;mesh.isPickable=false;mesh.checkCollisions=false;mesh.metadata={solid:false,source:'OSM coastline',profile:'original inferred low quay wall',surveyedWall:false};options.shadows?.addShadowCaster(mesh,false);return mesh;});
 scene.metadata={...(scene.metadata??{}),coastDetail:{...geometry.stats}};return {stats:geometry.stats,meshes,dispose(){for(const mesh of meshes){options.shadows?.removeShadowCaster(mesh,false);mesh.dispose();}if(!supplied)material.dispose();}};
}
