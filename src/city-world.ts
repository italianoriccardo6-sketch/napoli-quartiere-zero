import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Effect} from '@babylonjs/core/Materials/effect';
import {ImageProcessingConfiguration} from '@babylonjs/core/Materials/imageProcessingConfiguration';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import earcut from 'earcut';
import {inside,segmentDistance,type MapData,type Point,type Footprint} from './geo';
import {createSurface} from './surfaces';
import type {World} from './world';
import type {VisualMaterials} from './visual-materials';
import {joinedStreetSections,offsetStreetSection} from './street-sections';

export interface CityRoad {id:string;name?:string;highway:string;points:Point[];width?:number}
export interface CityWorldDetail {
  roads:CityRoad[];
  /** Each land polygon contains its outer ring followed by any water/terrain holes. */
  landPolygons?:Point[][][];
  coastlines?:{points:Point[];closed:boolean}[];
  /** Local metres: west, south, east, north. */
  bounds:[number,number,number,number];
}
type Bounds=[number,number,number,number];
const CELL=48;
function boundsOf(ring:Point[]):Bounds {
  let x0=Infinity,z0=Infinity,x1=-Infinity,z1=-Infinity;
  for(const [x,z] of ring){x0=Math.min(x0,x);z0=Math.min(z0,z);x1=Math.max(x1,x);z1=Math.max(z1,z);}
  return [x0,z0,x1,z1];
}
function overlaps(a:Bounds,b:Bounds){return a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];}
function distanceToBounds(x:number,z:number,b:Bounds){return Math.hypot(Math.max(b[0]-x,0,x-b[2]),Math.max(b[1]-z,0,z-b[3]));}
function cleanRing(ring:Point[]):Point[]{
  const output:Point[]=[];
  for(const p of ring){if(!Number.isFinite(p[0])||!Number.isFinite(p[1]))return [];const last=output.at(-1);if(!last||Math.hypot(p[0]-last[0],p[1]-last[1])>1e-6)output.push([p[0],p[1]]);}
  if(output.length>1&&Math.hypot(output[0][0]-output.at(-1)![0],output[0][1]-output.at(-1)![1])<1e-6)output.pop();
  return output;
}
/** A uniform grid stores geometry references, not copies, for nearby collision queries. */
class Grid<T>{
  private cells=new Map<string,Set<T>>();
  insert(value:T,b:Bounds){
    for(let x=Math.floor(b[0]/CELL);x<=Math.floor(b[2]/CELL);x++)for(let z=Math.floor(b[1]/CELL);z<=Math.floor(b[3]/CELL);z++){
      const key=x+','+z;let cell=this.cells.get(key);if(!cell){cell=new Set<T>();this.cells.set(key,cell);}cell.add(value);
    }
  }
  query(b:Bounds):Set<T>{
    const result=new Set<T>();
    for(let x=Math.floor(b[0]/CELL);x<=Math.floor(b[2]/CELL);x++)for(let z=Math.floor(b[1]/CELL);z<=Math.floor(b[3]/CELL);z++)for(const value of this.cells.get(x+','+z)??[])result.add(value);
    return result;
  }
}
interface Boundary {a:Point;b:Point;bounds:Bounds}
interface IndexedBuilding {footprint:Footprint;bounds:Bounds}
/** Estimated visual width in metres when OSM has no explicit width; never changes collision geometry. */
export function cityRoadWidth(road:Pick<CityRoad,'highway'|'width'>):number {
  if(Number.isFinite(road.width)&&road.width!>0)return Math.min(30,road.width!);
  const widths:Record<string,number>={motorway:13,trunk:11,primary:10,secondary:8,tertiary:7,residential:6,unclassified:5.5,living_street:5,pedestrian:5,service:4.5,footway:2.8,path:2.4,steps:2,track:3.5,cycleway:2.4};
  return widths[road.highway]??4;
}

/**
 * Render OSM cartographic footprint/road geometry as generic flat-terrain volumes.
 * Material detail, road widths without a tag and flat roofs are visual estimates.
 * No invented landmark model, island, street layout, or map tile is added here.
 */
export function createCityWorld(scene:Scene,map:MapData,detail?:CityWorldDetail,options:{materials?:VisualMaterials}={}):World {
  const land=(detail?.landPolygons??map.land.map(r=>[r])).map(p=>p.map(cleanRing)).filter(p=>p[0]?.length>=3).map(p=>[p[0],...p.slice(1).filter(r=>r.length>=3)]);
  if(!land.length)throw Error('La superficie di terra della mappa reale non è disponibile.');
  const landBounds=land.map(p=>boundsOf(p[0])),landGrid=new Grid<number>(),boundaries=new Grid<Boundary>();
  for(let i=0;i<land.length;i++){
    landGrid.insert(i,landBounds[i]);
    for(const ring of land[i])ring.forEach((a,j)=>{const b=ring[(j+1)%ring.length],edge={a,b,bounds:boundsOf([a,b])};boundaries.insert(edge,edge.bounds);});
  }
  const terrainBounds:Bounds=[Math.min(...landBounds.map(b=>b[0])),Math.min(...landBounds.map(b=>b[1])),Math.max(...landBounds.map(b=>b[2])),Math.max(...landBounds.map(b=>b[3]))];
  const insideLand=(p:Point)=>[...landGrid.query([p[0],p[1],p[0],p[1]])].some(i=>inside(p,land[i][0])&&!land[i].slice(1).some(hole=>inside(p,hole)));
  const buildingGrid=new Grid<IndexedBuilding>();
  const buildings:IndexedBuilding[]=[];
  let invalidFootprints=0;
  for(const source of map.buildings){
    const prepared=source.rings.map(cleanRing);
    if(!prepared[0]||prepared[0].length<3){invalidFootprints++;continue;}
    const rings=[prepared[0],...prepared.slice(1).filter(r=>r.length>=3)];
    const footprint={...source,rings},entry={footprint,bounds:boundsOf(rings[0])};buildings.push(entry);buildingGrid.insert(entry,entry.bounds);
  }
  function canStand(x:number,z:number,radius=.55){
    if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(radius)||radius<0)return false;
    const p:Point=[x,z],area:Bounds=[x-radius,z-radius,x+radius,z+radius];
    if(!insideLand(p))return false;
    // Shared edges between adjacent land patches are not invisible walls.
    for(const edge of boundaries.query(area)){
      if(!overlaps(area,edge.bounds)||segmentDistance(p,edge.a,edge.b)>=radius)continue;
      const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],length2=dx*dx+dz*dz;if(!length2)continue;
      const t=Math.max(0,Math.min(1,((x-edge.a[0])*dx+(z-edge.a[1])*dz)/length2));
      const q:Point=[edge.a[0]+t*dx,edge.a[1]+t*dz],length=Math.sqrt(length2),epsilon=.025;
      const plus:Point=[q[0]-dz/length*epsilon,q[1]+dx/length*epsilon],minus:Point=[q[0]+dz/length*epsilon,q[1]-dx/length*epsilon];
      if(!(insideLand(plus)&&insideLand(minus)))return false;
    }
    for(const {footprint:b,bounds} of buildingGrid.query(area)){
      if(!overlaps(area,bounds))continue;
      if(inside(p,b.rings[0])&&!b.rings.slice(1).some(h=>inside(p,h)))return false;
      for(const ring of b.rings)for(let j=0;j<ring.length;j++)if(segmentDistance(p,ring[j],ring[(j+1)%ring.length])<radius)return false;
    }
    return true;
  }

  scene.clearColor.set(.69,.79,.83,1);scene.fogMode=Scene.FOGMODE_EXP2;scene.fogColor=new Color3(.69,.79,.83);scene.fogDensity=.0004;
  scene.imageProcessingConfiguration.toneMappingEnabled=true;scene.imageProcessingConfiguration.toneMappingType=ImageProcessingConfiguration.TONEMAPPING_ACES;scene.imageProcessingConfiguration.exposure=1.05;scene.imageProcessingConfiguration.contrast=options.materials?1.12:1.05;
  const skyLight=new HemisphericLight('luce cielo città',new Vector3(0,1,0),scene);skyLight.intensity=options.materials?0.18:0.65;skyLight.diffuse=Color3.FromHexString('#d8e5ee');skyLight.groundColor=Color3.FromHexString('#6c665a');
  const sun=new DirectionalLight('sole pomeridiano città',new Vector3(-.8,-.72,-.38),scene);sun.position.set(200*.8/.72,200,200*.38/.72);sun.intensity=options.materials?2.4:1.8;sun.diffuse=Color3.FromHexString('#fff0d7');sun.shadowMinZ=1;sun.shadowMaxZ=650;sun.autoUpdateExtends=false;sun.orthoLeft=-100;sun.orthoRight=100;sun.orthoTop=100;sun.orthoBottom=-100;
  const shadows=new ShadowGenerator(2048,sun);shadows.usePercentageCloserFiltering=true;shadows.bias=.00008;shadows.normalBias=.02;shadows.setDarkness(.15);
  const visuals=options.materials;
  const terrain=visuals?.terrain??createSurface(scene,'terreno urbano generico','paving','#99988d',87).material;
  const asphalt=visuals?.asphalt??createSurface(scene,'manto stradale generico','plaster','#656b6a',43).material;
  const footway=visuals?.footway??createSurface(scene,'pavimentazione pedonale generica','paving','#828780',74).material;
  const facades=visuals?.facades??['#c5b49b','#bcb3a1','#c6bba8','#baac96'].map((c,i)=>createSurface(scene,'volume geografico '+i,'plaster',c,100+i).material);
  for(const [i,polygon] of land.entries()){
    const ground=MeshBuilder.ExtrudePolygon('terra OSM '+i,{shape:polygon[0].map(p=>new Vector3(p[0],0,p[1])),holes:polygon.slice(1).map(r=>r.map(p=>new Vector3(p[0],0,p[1]))),depth:2,sideOrientation:Mesh.DOUBLESIDE},scene,earcut);
    ground.material=terrain;ground.receiveShadows=true;ground.metadata={solid:true,geography:'land'};
    const positions=ground.getVerticesData('position')!,uvs=ground.getVerticesData('uv')!;
    for(let v=0;v<positions.length/3;v++){uvs[v*2]=positions[v*3]/3.2;uvs[v*2+1]=positions[v*3+2]/4;}ground.setVerticesData('uv',uvs);
  }

  // Build original footprint rings and holes, then merge by material and local tile.
  const batches=new Map<string,Mesh[]>();
  for(const {footprint:b,bounds} of buildings){
    const height=Number.isFinite(b.height)&&b.height>0?b.height:10;
    const volume=MeshBuilder.ExtrudePolygon('sagoma '+b.id,{shape:b.rings[0].map(p=>new Vector3(p[0],0,p[1])),holes:b.rings.slice(1).map(r=>r.map(p=>new Vector3(p[0],0,p[1]))),depth:height,sideOrientation:Mesh.DOUBLESIDE},scene,earcut);
    volume.position.y=height;
    const positions=volume.getVerticesData('position')!,normals=volume.getVerticesData('normal')!,uvs=volume.getVerticesData('uv')!;
    for(let v=0;v<positions.length/3;v++){const x=positions[v*3],y=positions[v*3+1],z=positions[v*3+2];uvs[v*2]=Math.abs(normals[v*3+1])>.7?x/2:(Math.abs(normals[v*3])>.7?z/2:x/2);uvs[v*2+1]=Math.abs(normals[v*3+1])>.7?z/2:y/2;}volume.setVerticesData('uv',uvs);
    let hash=0;for(const c of b.id)hash=(Math.imul(hash,31)+c.charCodeAt(0))>>>0;
    const material=hash%facades.length;volume.material=facades[material];volume.metadata={sourceId:b.id,solid:true};
    const key=Math.floor((bounds[0]+bounds[2])/256)+','+Math.floor((bounds[1]+bounds[3])/256)+','+material;
    const batch=batches.get(key)??[];batch.push(volume);batches.set(key,batch);
  }
  const chunks:Array<{mesh:Mesh;bounds:Bounds}>=[];
  for(const [key,meshes] of batches){
    const sourceIds=meshes.map(m=>m.metadata.sourceId as string),merged=meshes.length===1?meshes[0]:Mesh.MergeMeshes(meshes,true,true);
    if(!merged)throw Error('Impossibile assemblare i volumi geografici.');
    merged.name='volumi OSM '+key;merged.metadata={solid:true,sourceIds,representation:'generic-footprint-extrusion'};merged.receiveShadows=true;merged.computeWorldMatrix(true);
    const b=merged.getBoundingInfo().boundingBox;chunks.push({mesh:merged,bounds:[b.minimumWorld.x,b.minimumWorld.z,b.maximumWorld.x,b.maximumWorld.z]});
  }

  // Ribbons follow the supplied OSM centerlines. Widths without a tag are visual estimates.
  const roadBatches=new Map<boolean,{positions:number[];indices:number[];uvs:number[];ids:string[]}>();
  let renderedRoads=0;
  for(const road of detail?.roads??[]){
    // Keep the original centerline spans/land checks; only their shared edge joins change.
    const sections=joinedStreetSections(road.points,Number.MAX_VALUE);if(sections.length<2)continue;
    const pedestrian=['footway','path','steps','pedestrian','cycleway'].includes(road.highway),width=cityRoadWidth(road);
    const batch=roadBatches.get(pedestrian)??{positions:[],indices:[],uvs:[],ids:[]};let emitted=false;
    for(let j=1;j<sections.length;j++){
      const a=sections[j-1],b=sections[j],mid:Point=[(a.point[0]+b.point[0])/2,(a.point[1]+b.point[1])/2];
      if(!insideLand(mid))continue;
      const index=batch.positions.length/3,vertices=[offsetStreetSection(a,width/2),offsetStreetSection(a,-width/2),offsetStreetSection(b,width/2),offsetStreetSection(b,-width/2)];
      // Walkway ribbons cross roads in OSM; separate their depth to prevent
      // coplanar asphalt/paving fragments flickering through each other.
      for(const p of vertices){batch.positions.push(p[0],pedestrian?.025:.04,p[1]);batch.uvs.push(p[0]/(pedestrian?2:3),p[1]/(pedestrian?2:3));}
      // Babylon's left-handed normal convention needs this winding for +Y.
      // Sharp/short joined spans can reverse a triangle; orient each face upward.
      for(const triangle of [[0,1,2],[1,3,2]]){
        const [p,q,r]=triangle.map(i=>vertices[i]),normalY=(p[1]-q[1])*(r[0]-q[0])-(p[0]-q[0])*(r[1]-q[1]);
        if(normalY<0)[triangle[1],triangle[2]]=[triangle[2],triangle[1]];
        batch.indices.push(...triangle.map(i=>index+i));
      }
      emitted=true;
    }
    if(emitted){batch.ids.push(road.id);renderedRoads++;}roadBatches.set(pedestrian,batch);
  }
  for(const [pedestrian,batch] of roadBatches){
    if(!batch.indices.length)continue;
    const mesh=new Mesh(pedestrian?'percorsi pedonali OSM':'strade OSM',scene),v=new VertexData();v.positions=batch.positions;v.indices=batch.indices;v.uvs=batch.uvs;const normals:number[]=[];VertexData.ComputeNormals(batch.positions,batch.indices,normals);v.normals=normals;v.applyToMesh(mesh);mesh.material=pedestrian?footway:asphalt;mesh.material.backFaceCulling=false;mesh.receiveShadows=true;mesh.isPickable=false;mesh.metadata={sourceIds:batch.ids,estimatedWidths:true};
  }

  // Analytic water/sky only; no photographic sky, distant fabricated buildings or landmarks.
  Effect.ShadersStore['citySkyVertexShader']=`precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;varying vec3 d;void main(){d=normalize(position);gl_Position=worldViewProjection*vec4(position,1.);}`;
  Effect.ShadersStore['citySkyFragmentShader']=`precision highp float;varying vec3 d;void main(){vec3 n=normalize(d);vec3 c=mix(vec3(.73,.8,.81),vec3(.29,.49,.64),pow(max(n.y,0.),.55));float glow=pow(max(dot(n,normalize(vec3(.8,.72,.38))),0.),24.);c+=vec3(.23,.16,.07)*glow;gl_FragColor=vec4(c,1.);}`;
  const skyMaterial=new ShaderMaterial('cielo analitico città',scene,{vertex:'citySky',fragment:'citySky'},{attributes:['position'],uniforms:['worldViewProjection']});skyMaterial.backFaceCulling=false;skyMaterial.disableDepthWrite=true;
  const sky=MeshBuilder.CreateSphere('cielo città',{diameter:4000,segments:20},scene);sky.infiniteDistance=true;sky.material=skyMaterial;sky.isPickable=false;
  Effect.ShadersStore['citySeaVertexShader']=`precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;uniform mat4 world;uniform float time;varying vec3 p;varying vec3 worldP;void main(){p=position;p.y+=sin(p.x*.075+time*.65)*.1+cos(p.z*.11-time*.48)*.075;worldP=(world*vec4(p,1.)).xyz;gl_Position=worldViewProjection*vec4(p,1.);}`;
  Effect.ShadersStore['citySeaFragmentShader']=`precision highp float;varying vec3 p;varying vec3 worldP;uniform float time;uniform vec3 cameraPosition;void main(){float nx=cos(p.x*.075+time*.65)*.03+sin(p.x*.81+p.z*.56+time*1.2)*.08;float nz=-sin(p.z*.11-time*.48)*.035+cos(p.x*.39-p.z*.91-time*.8)*.065;vec3 n=normalize(vec3(-nx,1.,-nz));vec3 v=normalize(cameraPosition-worldP);float f=.035+.965*pow(1.-max(dot(n,v),0.),5.);vec3 reflected=reflect(-v,n);vec3 sky=mix(vec3(.68,.76,.76),vec3(.3,.5,.61),max(reflected.y,0.));vec3 c=mix(vec3(.075,.285,.32),sky,f);c+=vec3(.8,.62,.33)*pow(max(dot(reflect(-normalize(vec3(.8,.72,.38)),n),v),0.),100.)*.65;float fog=1.-exp(-length(cameraPosition-worldP)*.0004);gl_FragColor=vec4(mix(c,vec3(.69,.79,.83),fog),1.);}`;
  const sea=new ShaderMaterial('mare città',scene,{vertex:'citySea',fragment:'citySea'},{attributes:['position'],uniforms:['worldViewProjection','world','time','cameraPosition']});sea.setFloat('time',0);sea.setVector3('cameraPosition',new Vector3(0,3,0));sea.backFaceCulling=false;
  const span=Math.max(terrainBounds[2]-terrainBounds[0],terrainBounds[3]-terrainBounds[1]);
  const water=MeshBuilder.CreateGround('mare attorno alla costa',{width:span+6000,height:span+6000,subdivisions:100},scene);water.position.set((terrainBounds[0]+terrainBounds[2])/2,-1.3,(terrainBounds[1]+terrainBounds[3])/2);water.material=sea;water.isPickable=false;
  const activeShadows=new Set<Mesh>();let lastShadowUpdate=-Infinity;
  scene.onBeforeRenderObservable.add(()=>{
    const camera=scene.activeCamera;if(!camera)return;
    const position=camera.globalPosition;sea.setVector3('cameraPosition',position);
    const time=performance.now();if(time-lastShadowUpdate<700)return;lastShadowUpdate=time;sun.position.set(position.x+200*.8/.72,200,position.z+200*.38/.72);
    for(const chunk of chunks){const nearby=distanceToBounds(position.x,position.z,chunk.bounds)<300;
      if(nearby&&!activeShadows.has(chunk.mesh)){shadows.addShadowCaster(chunk.mesh,false);activeShadows.add(chunk.mesh);}
      else if(!nearby&&activeShadows.has(chunk.mesh)){shadows.removeShadowCaster(chunk.mesh,false);activeShadows.delete(chunk.mesh);}
    }
  });
  scene.metadata={...(scene.metadata??{}),cityWorld:{provenance:map.provenance,footprints:buildings.length,invalidFootprints,buildingChunks:chunks.length,renderedRoads,bounds:terrainBounds,terrainElevation:'flat-estimate',representation:'OSM footprint extrusions; procedural surface detail, not photorealism'}};
  return {canStand,shadows,sea,beacons:[]};
}
