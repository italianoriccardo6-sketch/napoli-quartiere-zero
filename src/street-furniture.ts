import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Material} from '@babylonjs/core/Materials/material';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {inside,segmentDistance,toLocal,type MapData,type Point,type Footprint} from './geo';

export interface FurnitureSourceNode {id:string;lon:number;lat:number;tags:Record<string,string>}
export interface FurnitureData {version:1;source:{bbox:number[];license:string;retrieved_at:string;[key:string]:unknown};nodes:FurnitureSourceNode[]}
export type FurnitureKind='lamp'|'bench'|'bin'|'bollard'|'fountain'|'stop'|'give_way';
export type FurnitureMaterial='metal'|'stone'|'wood'|'sign'|'glass'|'signRed'|'signWhite'|'signInk';
export interface FurnitureOptions {focus?:Point[];radius?:number;maxItems?:number;groundHeight?:(x:number,z:number)=>number;materials?:Partial<Record<FurnitureMaterial,Material>>;shadows?:ShadowGenerator}
export interface FurniturePlacement {id:string;kind:FurnitureKind;point:Point;ground:number;yaw:number;height:number;width:number;backrest:boolean;stone:boolean;estimatedDimensions:boolean;estimatedOrientation:boolean}
export interface FurnitureStats {sourceNodes:number;rendered:number;invalidSource:number;unsupported:number;outsideLand:number;insideBuildings:number;routeClearance:number;outsideCorridor:number;budgetClipped:number;estimatedDimensions:number;estimatedOrientations:number;meshCount:number;vertexCount:number;positionsInvented:false;dimensions:'tagged-or-original-visual-estimates';collisionGeometryAdded:false}
export interface FurnitureGeometryBatch {key:string;material:FurnitureMaterial;positions:number[];indices:number[];uvs:number[]}
export interface FurniturePlan {placements:FurniturePlacement[];batches:FurnitureGeometryBatch[];stats:FurnitureStats}
type XYZ=[number,number,number];
const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
const finitePoint=(p:unknown):p is Point=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
function metres(raw:unknown){if(typeof raw!=='string'||!/^\s*\d+(?:[.,]\d+)?\s*(?:m|metres?|meters?)?\s*$/i.test(raw))return null;const value=Number.parseFloat(raw.replace(',','.'));return Number.isFinite(value)&&value>0?value:null;}
function kindOf(tags:Record<string,string>):FurnitureKind|null {
  if(tags.highway==='street_lamp'&&tags.lamp_mount!=='wall')return 'lamp';
  if(tags.amenity==='bench')return 'bench';if(tags.amenity==='waste_basket')return 'bin';if(tags.amenity==='drinking_water')return 'fountain';if(tags.barrier==='bollard')return 'bollard';
  // Literal, explicit sign meanings only. Unknown national figure codes are not guessed.
  if(tags.traffic_sign==='stop')return 'stop';if(tags.traffic_sign==='give_way')return 'give_way';return null;
}
function nearestToPath(p:Point,path:Point[]){let distance=Infinity,point:Point=p;for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],dx=b[0]-a[0],dz=b[1]-a[1],den=dx*dx+dz*dz,t=den?clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/den,0,1):0,q:Point=[a[0]+dx*t,a[1]+dz*t],d=Math.hypot(q[0]-p[0],q[1]-p[1]);if(d<distance){distance=d;point=q;}}if(path.length===1){point=path[0];distance=Math.hypot(p[0]-point[0],p[1]-point[1]);}return {point,distance};}
function buildingIndex(buildings:Footprint[]){const cells=new Map<string,Footprint[]>();for(const building of buildings){if(!building.rings[0]?.length)continue;const ring=building.rings[0],xs=ring.map(p=>p[0]),zs=ring.map(p=>p[1]);for(let x=Math.floor(Math.min(...xs)/32);x<=Math.floor(Math.max(...xs)/32);x++)for(let z=Math.floor(Math.min(...zs)/32);z<=Math.floor(Math.max(...zs)/32);z++){const key=x+','+z,list=cells.get(key)??[];list.push(building);cells.set(key,list);}}return(p:Point)=>!(cells.get(Math.floor(p[0]/32)+','+Math.floor(p[1]/32))??[]).some(b=>inside(p,b.rings[0])&&!b.rings.slice(1).some(h=>inside(p,h)));}
function direction(raw:unknown):number|null{if(typeof raw!=='string')return null;const compass:Record<string,number>={N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315};if(raw in compass)return compass[raw]*Math.PI/180;if(!/^\d+(?:\.\d+)?$/.test(raw))return null;const degrees=Number(raw);return degrees>=0&&degrees<=360?degrees*Math.PI/180:null;}

/** Measured OSM node positions; original shapes, missing dimensions and orientation are estimates. */
export function buildStreetFurniturePlan(map:MapData,data:FurnitureData,options:FurnitureOptions={}):FurniturePlan {
  if(data?.version!==1||!Array.isArray(data.nodes)||data.nodes.length>3000||data.source?.license!=='ODbL-1.0'||!Array.isArray(data.source.bbox)||data.source.bbox.length!==4||!data.source.bbox.every(Number.isFinite)||data.source.bbox[0]>=data.source.bbox[2]||data.source.bbox[1]>=data.source.bbox[3])throw new Error('Dati arredo stradale non validi.');
  const city=(map as MapData&{city?:{route?:Point[];landPolygons?:Point[][][];roads?:Array<{points:Point[]}>}}).city,focus=options.focus??city?.route??[],radius=options.radius??100,maxItems=options.maxItems??100;
  if(!Array.isArray(focus)||focus.some(p=>!finitePoint(p))||!Number.isFinite(radius)||radius<=0||radius>130||!Number.isInteger(maxItems)||maxItems<0||maxItems>250)throw new RangeError('Limiti arredo stradale non validi.');
  const stats:FurnitureStats={sourceNodes:data.nodes.length,rendered:0,invalidSource:0,unsupported:0,outsideLand:0,insideBuildings:0,routeClearance:0,outsideCorridor:0,budgetClipped:0,estimatedDimensions:0,estimatedOrientations:0,meshCount:0,vertexCount:0,positionsInvented:false,dimensions:'tagged-or-original-visual-estimates',collisionGeometryAdded:false};
  const ids=new Set<string>(),candidates:Array<{node:FurnitureSourceNode;kind:FurnitureKind;point:Point;distance:number}>=[],[south,west,north,east]=data.source.bbox;
  for(const node of data.nodes){if(!node||typeof node.id!=='string'||!/^node\/\d+$/.test(node.id)||ids.has(node.id)||![node.lon,node.lat].every(Number.isFinite)||node.lon<west||node.lon>east||node.lat<south||node.lat>north||!node.tags||typeof node.tags!=='object'||Array.isArray(node.tags)){stats.invalidSource++;continue;}ids.add(node.id);const kind=kindOf(node.tags);if(!kind){stats.unsupported++;continue;}const point=toLocal(node.lon,node.lat),distance=focus.length?nearestToPath(point,focus).distance:0;if(distance>radius){stats.outsideCorridor++;continue;}candidates.push({node,kind,point,distance});}
  candidates.sort((a,b)=>a.distance-b.distance||a.node.id.localeCompare(b.node.id));
  const polygons=city?.landPolygons??map.land.map(r=>[r]),onLand=(p:Point)=>polygons.some(r=>inside(p,r[0])&&!r.slice(1).some(h=>inside(p,h))),outsideBuildings=buildingIndex(map.buildings),placements:FurniturePlacement[]=[];
  for(const {node,kind,point,distance}of candidates){
    if(!onLand(point)){stats.outsideLand++;continue;}
    const heightTag=metres(node.tags.height),widthTag=metres(node.tags.width),defaultHeight=kind==='lamp'?6.6:kind==='bench'?.94:kind==='bin'?.88:kind==='bollard'?.8:kind==='fountain'?.96:2.4,defaultWidth=kind==='bench'?1.8:kind==='lamp'?.4:kind==='fountain'?.6:.5;
    const validHeight=heightTag!==null&&heightTag>=(kind==='lamp'?3:.3)&&heightTag<=(kind==='lamp'?12:kind==='stop'||kind==='give_way'?4:1.8),validWidth=kind==='bench'&&widthTag!==null&&widthTag>=.2&&widthTag<=3;
    const height=validHeight?heightTag!:defaultHeight,width=validWidth?widthTag!:defaultWidth,clearRadius=kind==='bench'?Math.hypot(width/2,.38):kind==='lamp'?.23:kind==='fountain'?.33:kind==='bollard'?.13:.3;
    if(focus.length&&distance<.8+clearRadius){stats.routeClearance++;continue;}
    const taggedDirection=direction(node.tags.direction);let yaw=taggedDirection??0;
    if(taggedDirection===null){let closest={point,distance:Infinity};for(const road of city?.roads??[]){const q=nearestToPath(point,road.points);if(q.distance<closest.distance)closest=q;}if(!Number.isFinite(closest.distance))closest=nearestToPath(point,focus);if(closest.distance>.1&&Number.isFinite(closest.distance))yaw=Math.atan2(closest.point[0]-point[0],closest.point[1]-point[1]);}
    const co=Math.cos(yaw),si=Math.sin(yaw),clearSamples:Point[]=[point];for(const x of[-clearRadius,clearRadius])for(const z of[-Math.min(clearRadius,.38),Math.min(clearRadius,.38)])clearSamples.push([point[0]+x*co+z*si,point[1]-x*si+z*co]);
    if(clearSamples.some(p=>!onLand(p))){stats.outsideLand++;continue;}
    if(clearSamples.some(p=>!outsideBuildings(p))){stats.insideBuildings++;continue;}
    const ground=options.groundHeight?.(point[0],point[1])??0;if(!Number.isFinite(ground)){stats.invalidSource++;continue;}
    if(placements.length>=maxItems){stats.budgetClipped++;continue;}
    placements.push({id:node.id,kind,point,ground,yaw,height,width,backrest:node.tags.backrest!=='no',stone:node.tags.material==='stone'||node.tags.material==='concrete',estimatedDimensions:!validHeight||!validWidth,estimatedOrientation:taggedDirection===null});if(!validHeight||!validWidth)stats.estimatedDimensions++;if(taggedDirection===null)stats.estimatedOrientations++;
  }
  const batches:FurnitureGeometryBatch[]=[],lookup=new Map<string,FurnitureGeometryBatch>();
  function batch(item:FurniturePlacement,material:FurnitureMaterial){const base=material+':'+Math.floor(item.point[0]/128)+','+Math.floor(item.point[1]/128);let key=base,part=0;while((lookup.get(key)?.positions.length??0)>178500)key=base+':'+(++part);let target=lookup.get(key);if(!target){target={key,material,positions:[],indices:[],uvs:[]};lookup.set(key,target);batches.push(target);}return target;}
  function transform(item:FurniturePlacement,p:XYZ):XYZ{const co=Math.cos(item.yaw),si=Math.sin(item.yaw),verticalScale=item.kind==='bench'?item.height/.94:1;return [item.point[0]+p[0]*co+p[2]*si,item.ground+p[1]*verticalScale,item.point[1]-p[0]*si+p[2]*co];}
  function face(item:FurniturePlacement,material:FurnitureMaterial,vertices:XYZ[],expected:XYZ,uvs?:number[]){const target=batch(item,material),n=target.positions.length/3,a=vertices[0],b=vertices[1],c=vertices[2],ab=a.map((v,i)=>v-b[i]),cb=c.map((v,i)=>v-b[i]),normal=[ab[1]*cb[2]-ab[2]*cb[1],ab[2]*cb[0]-ab[0]*cb[2],ab[0]*cb[1]-ab[1]*cb[0]],reverse=normal.reduce((sum,v,i)=>sum+v*expected[i],0)<0,axis=expected.map(Math.abs).indexOf(Math.max(...expected.map(Math.abs)));for(const vertex of vertices)target.positions.push(...transform(item,vertex));target.uvs.push(...(uvs??vertices.flatMap(p=>axis===0?[p[2],p[1]]:axis===1?[p[0],p[2]]:[p[0],p[1]])));for(let i=1;i<vertices.length-1;i++)target.indices.push(n,reverse?n+i+1:n+i,reverse?n+i:n+i+1);}
  function box(item:FurniturePlacement,material:FurnitureMaterial,center:XYZ,size:XYZ){const [x,y,z]=center,[a,b,c]=size.map(n=>n/2),p=(dx:number,dy:number,dz:number):XYZ=>[x+dx,y+dy,z+dz];face(item,material,[p(-a,-b,c),p(a,-b,c),p(a,b,c),p(-a,b,c)],[0,0,1],[0,0,size[0],0,size[0],size[1],0,size[1]]);face(item,material,[p(a,-b,-c),p(-a,-b,-c),p(-a,b,-c),p(a,b,-c)],[0,0,-1]);face(item,material,[p(a,-b,c),p(a,-b,-c),p(a,b,-c),p(a,b,c)],[1,0,0]);face(item,material,[p(-a,-b,-c),p(-a,-b,c),p(-a,b,c),p(-a,b,-c)],[-1,0,0]);face(item,material,[p(-a,b,c),p(a,b,c),p(a,b,-c),p(-a,b,-c)],[0,1,0]);face(item,material,[p(-a,-b,-c),p(a,-b,-c),p(a,-b,c),p(-a,-b,c)],[0,-1,0]);}
  function lathe(item:FurniturePlacement,material:FurnitureMaterial,profile:Array<[number,number]>,center:XYZ=[0,0,0],sides=16){for(let j=1;j<profile.length;j++){const [y0,r0]=profile[j-1],[y1,r1]=profile[j];for(let i=0;i<sides;i++){const a=i/sides*Math.PI*2,b=(i+1)/sides*Math.PI*2,p=(angle:number,r:number,y:number):XYZ=>[center[0]+Math.cos(angle)*r,center[1]+y,center[2]+Math.sin(angle)*r],expected:XYZ=[Math.cos((a+b)/2)*(y1-y0),r0-r1,Math.sin((a+b)/2)*(y1-y0)];face(item,material,[p(a,r0,y0),p(b,r0,y0),p(b,r1,y1),p(a,r1,y1)],expected,[a*r0,y0,b*r0,y0,b*r1,y1,a*r1,y1]);}}}
  function tube(item:FurniturePlacement,material:FurnitureMaterial,path:XYZ[],radius:number,sides=8){for(let s=1;s<path.length;s++){const a=path[s-1],b=path[s],d=b.map((v,i)=>v-a[i]),len=Math.hypot(...d);if(len<1e-7)continue;const unit=d.map(v=>v/len),axis=Math.abs(unit[1])<.9?[0,1,0]:[1,0,0],cross=(p:number[],q:number[])=>[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]],raw=cross(unit,axis),rl=Math.hypot(...raw),u=raw.map(v=>v/rl),v=cross(unit,u),p=(center:XYZ,angle:number):XYZ=>center.map((n,i)=>n+radius*(Math.cos(angle)*u[i]+Math.sin(angle)*v[i])) as XYZ;for(let i=0;i<sides;i++){const aa=i/sides*Math.PI*2,bb=(i+1)/sides*Math.PI*2,normal=u.map((n,j)=>Math.cos((aa+bb)/2)*n+Math.sin((aa+bb)/2)*v[j]) as XYZ;face(item,material,[p(a,aa),p(a,bb),p(b,bb),p(b,aa)],normal,[aa*radius,0,bb*radius,0,bb*radius,len,aa*radius,len]);}}}
  function disc(item:FurniturePlacement,material:FurnitureMaterial,points:Array<[number,number]>,center:XYZ){face(item,material,points.map(p=>[center[0]+p[0],center[1]+p[1],center[2]] as XYZ),[0,0,1]);}
  for(const item of placements){
    const {kind,height:h}=item;
    if(kind==='lamp'){
      lathe(item,'metal',[[0,0],[0,.2],[.035,.2],[.06,.17],[.2,.15],[.24,.12],[.42,.105],[.48,.075],[h*.79,.054]]);
      for(const y of[.18,.4,h*.79])lathe(item,'metal',[[y-.018,.056],[y-.012,.09],[y+.015,.09],[y+.025,.055]]);
      const path:XYZ[]=[];for(let i=0;i<=20;i++){const t=i/20,k=1-t;path.push([0,k*k*k*h*.79+3*k*k*t*h*.98+3*k*t*t*h+t*t*t*h*.94,3*k*t*t*.8+t*t*t*1.15]);}tube(item,'metal',path,.045,10);
      const y=h*.94;lathe(item,'metal',[[0,.03],[.035,.04],[.06,.12],[.09,.23],[.07,.27],[.035,.27],[.02,.24]],[0,y-.12,1.15]);lathe(item,'glass',[[0,0],[0,.22],[.035,.23],[.07,.14],[.08,0]],[0,y-.18,1.15]);
    }else if(kind==='bench'){
      for(let i=0;i<5;i++)box(item,item.stone?'stone':'wood',[0,.465,-.23+i*.115],[item.width,.045,.085]);
      if(item.backrest)for(let i=0;i<5;i++)box(item,item.stone?'stone':'wood',[0,.58+i*.08,-.27-i*.017],[item.width,.052,.045]);
      for(const side of[-1,1]){const x=side*item.width*.36;tube(item,'metal',[[x,.03,.22],[x,.45,.2],[x,.48,-.24],[x,item.backrest?.96:.51,item.backrest?-.36:-.24]],.027);tube(item,'metal',[[x,.03,-.2],[x,.46,-.22]],.027);tube(item,'metal',[[x,.47,.19],[x,.71,.13],[x,.72,-.17],[x,.58,-.29]],.023);box(item,'metal',[x,.035,0],[.12,.045,.53]);}tube(item,'metal',[[-item.width*.36,.29,-.15],[item.width*.36,.29,-.15]],.022);
    }else if(kind==='bin'){
      lathe(item,'metal',[[0,0],[0,.2],[.06,.23],[h-.13,.23],[h-.12,.27],[h-.08,.27],[h-.06,.23],[h,.23]]);for(let i=0;i<20;i++){const angle=i*Math.PI/10;tube(item,'metal',[[Math.cos(angle)*.235,.09,Math.sin(angle)*.235],[Math.cos(angle)*.235,h-.15,Math.sin(angle)*.235]],.012,6);}lathe(item,'signInk',[[0,0],[0,.215]],[0,h-.015,0]);
    }else if(kind==='bollard'){
      lathe(item,item.stone?'stone':'metal',[[0,0],[0,.12],[.045,.13],[.075,.105],[h-.12,.085],[h-.1,.11],[h-.065,.11],[h-.025,.08],[h,.02],[h,0]]);
    }else if(kind==='fountain'){
      box(item,'stone',[0,h*.48,-.07],[.25,h*.96,.24]);box(item,'stone',[0,h-.025,-.07],[.32,.05,.29]);lathe(item,'stone',[[0,.14],[.04,.22],[.09,.27],[.115,.27],[.115,.22]],[0,.32,.2]);lathe(item,'signInk',[[0,0],[0,.205]],[0,.421,.2]);tube(item,'metal',[[0,h*.75,.045],[0,h*.75,.24],[0,h*.69,.24]],.025,12);box(item,'metal',[0,h*.8,.1],[.13,.022,.035]);
    }else{
      lathe(item,'metal',[[0,0],[0,.065],[.05,.065],[.06,.035],[h,.035],[h,0]]);
      const y=h-.32,stop=kind==='stop',points:Array<[number,number]>=stop?Array.from({length:8},(_,i)=>[Math.cos(Math.PI/8+i*Math.PI/4)*.36,Math.sin(Math.PI/8+i*Math.PI/4)*.36] as [number,number]):[[-.37,.25],[.37,.25],[0,-.4]];
      disc(item,'sign',points,[0,y,.04]);disc(item,'signRed',points,[0,y,.048]);disc(item,'signWhite',points.map(p=>[p[0]*.88,p[1]*.88]),[0,y,.05]);if(stop){disc(item,'signRed',points.map(p=>[p[0]*.8,p[1]*.8]),[0,y,.052]);const glyphs=['11110/10000/10000/11110/00010/00010/11110','11111/00100/00100/00100/00100/00100/00100','01110/10001/10001/10001/10001/10001/01110','11110/10001/10001/11110/10000/10000/10000'];for(let g=0;g<4;g++)for(const [row,line]of glyphs[g].split('/').entries())for(let col=0;col<5;col++)if(line[col]==='1'){const x=-.231+g*.12+col*.019,yy=y+.064-row*.021;disc(item,'signWhite',[[0,0],[.019,0],[.019,.021],[0,.021]],[x,yy,.054]);}}
    }
  }
  stats.rendered=placements.length;stats.meshCount=batches.length;stats.vertexCount=batches.reduce((sum,b)=>sum+b.positions.length/3,0);return {placements,batches,stats};
}

/** Source positions only. Geometry has no collision; shape and untagged measurements are estimates. */
export function addStreetFurniture(scene:Scene,map:MapData,data:FurnitureData,options:FurnitureOptions={}){
  const plan=buildStreetFurniturePlan(map,data,options),meshes:Mesh[]=[],owned:Material[]=[],materials=new Map<FurnitureMaterial,Material>();
  const palette:Record<FurnitureMaterial,string>={metal:'#242b2c',stone:'#aaa598',wood:'#805c3b',sign:'#bfc3be',glass:'#d7d4ba',signRed:'#b52224',signWhite:'#e7e5da',signInk:'#171b1b'};
  for(const kind of new Set(plan.batches.map(b=>b.material))){let material=options.materials?.[kind];if(!material){const created=new StandardMaterial('arredo originale '+kind,scene);created.diffuseColor=Color3.FromHexString(palette[kind]);created.specularColor.set(kind==='metal'?.2:.04,kind==='metal'?.2:.04,kind==='metal'?.2:.04);created.specularPower=kind==='metal'?48:18;if(kind==='glass')created.emissiveColor=Color3.FromHexString('#11100b');material=created;owned.push(created);}materials.set(kind,material);}
  for(const batch of plan.batches){const mesh=new Mesh('arredo '+batch.key,scene),vertices=new VertexData(),normals:number[]=[];vertices.positions=batch.positions;vertices.indices=batch.indices;vertices.uvs=batch.uvs;VertexData.ComputeNormals(batch.positions,batch.indices,normals);vertices.normals=normals;vertices.applyToMesh(mesh);mesh.material=materials.get(batch.material)!;mesh.receiveShadows=true;mesh.isPickable=false;mesh.checkCollisions=false;mesh.metadata={solid:false,sourceNodePositions:true,dimensionPolicy:'tagged-or-original-visual-estimates',surface:batch.material};options.shadows?.addShadowCaster(mesh,false);meshes.push(mesh);}
  scene.metadata={...(scene.metadata??{}),streetFurniture:{...plan.stats,sourcePositions:true,measuredShapes:false}};
  return {meshes,placements:plan.placements,stats:plan.stats,dispose(){for(const mesh of meshes){options.shadows?.removeShadowCaster(mesh,false);mesh.dispose();}for(const material of owned)material.dispose();}};
}
