import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import type {BaseTexture} from '@babylonjs/core/Materials/Textures/baseTexture';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {MapData,Point} from './geo';

export type PixelQuad=readonly [Point,Point,Point,Point];
export const NAPLES_FACADE_PHOTO={
  path:'assets/naples-facade-research/partenope-dimitalen-2010/source.jpg',width:2939,height:1954,
  author:'DimiTalen',license:'CC0-1.0',captured:'2010-07-08',
  source:'https://commons.wikimedia.org/wiki/File:View_of_Via_Partenope_and_the_marina_from_Castel_dell%27Ovo,_Naples,_2010.jpg',
  sha256:'63d316b36f987dbb39e0b96d0a88518d80eac76b94baa9e099ecec7f9defced6',
} as const;
interface ConfirmedFace {buildingId:string;name:string;edges:number[];points:Point[];pixels:PixelQuad;observedLayout:string;identitySource:string}
/** Actual facade photographs, hand-calibrated to actual OSM walls: not photogrammetry. */
export const NAPLES_PHOTO_FACES:readonly ConfirmedFace[]=[
  {buildingId:'relation/4779351:1',name:'Hotel Royal Continental · ala moderna',edges:[29],points:[[-103.00807140236044,215.31415909244825],[-64.19367995392933,213.17682486955144]],pixels:[[95,683],[537,694],[537,1109],[84,1118]],observedLayout:'About 10 bays, 9 regular glazed strips, a short upper band and ground lobby; observed from the 2010 photograph, not measured floors.',identitySource:'Named Hotel Royal Continental in the active OSM relation/4779351 multipolygon.'},
  {buildingId:'way/337012555:0',name:'Grand Hotel Vesuvio · fronte su Via Partenope',edges:[20,21,22],points:[[-64.19367995392933,213.17682486955144],[-43.92731150240063,212.47551207726795],[-28.420086099508005,211.96344241917163],[-7.176619252096986,211.09515039111974]],pixels:[[538,738],[1177,745],[1178,1107],[538,1112]],observedLayout:'13 bays (7 arched central stacks and 3 rectangular stacks each side), 4 balcony rows, 1 small-window row, 1 loggia row and 2 stone base levels. Recessed rooftop structures are excluded.',identitySource:'Official hotel contact page https://www.vesuvio.it/contatti/ links its Via Partenope 45 location at 40.830084,14.2481853, inside this OSM footprint.'},
];

/** Homography from a wall rectangle (s,t) to native photo pixels (top-left origin). */
export function photoProjection(quad:PixelQuad,width:number,height:number){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||quad.some(p=>!p.every(Number.isFinite)))throw new RangeError('Proiezione fotografica non valida.');
  const cross=quad.map((p,i)=>{const q=quad[(i+1)%4],r=quad[(i+2)%4];return(q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0]);});
  if(!cross.every(v=>v>1e-7)&&!cross.every(v=>v< -1e-7))throw new RangeError('Il quadrilatero fotografico deve essere convesso.');
  const rows:number[][]=[];
  for(const [i,[s,t]]of ([[0,0],[1,0],[1,1],[0,1]] as Point[]).entries()){
    const [x,y]=quad[i];rows.push([s,t,1,0,0,0,-s*x,-t*x,x],[0,0,0,s,t,1,-s*y,-t*y,y]);
  }
  for(let col=0;col<8;col++){
    let best=col;for(let row=col+1;row<8;row++)if(Math.abs(rows[row][col])>Math.abs(rows[best][col]))best=row;
    [rows[col],rows[best]]=[rows[best],rows[col]];const divisor=rows[col][col];if(Math.abs(divisor)<1e-10)throw new RangeError('Proiezione fotografica singolare.');
    for(let i=col;i<9;i++)rows[col][i]/=divisor;
    for(let row=0;row<8;row++)if(row!==col){const factor=rows[row][col];for(let i=col;i<9;i++)rows[row][i]-=factor*rows[col][i];}
  }
  const h=rows.map(row=>row[8]);
  return(s:number,t:number):Point=>{const denominator=h[6]*s+h[7]*t+1;return[(h[0]*s+h[1]*t+h[2])/denominator/width,(h[3]*s+h[4]*t+h[5])/denominator/height];};
}
export interface NaplesFacadeGeometry {buildingId:string;name:string;sourceEdges:number[];positions:number[];normals:number[];indices:number[];uvs:number[];uvs2:number[];height:number;observedLayout:string;bounds:[number,number,number,number]}
export interface NaplesFacadePart {buildingId:string;role:'glass'|'frame'|'iron';kind:'box'|'arch'|'curved-slab';x:number;y:number;z:number;width:number;height:number;depth:number;yaw:number;roll:number}
/** Layout follows the source image; recess/projection depths remain inferred estimates. */
export function planNaplesFacadeProfiles(map:MapData,enabled:ReadonlySet<string>){
  const parts:NaplesFacadePart[]=[];
  for(const face of NAPLES_PHOTO_FACES){
    if(!enabled.has(face.buildingId))continue;
    const building=map.buildings.find(b=>b.id===face.buildingId)!,ring=building.rings[0],orientation=Math.sign(ring.reduce((n,p,i)=>n+p[0]*ring[(i+1)%ring.length][1]-ring[(i+1)%ring.length][0]*p[1],0));
    const spans=face.edges.map(edge=>{const a=ring[edge],b=ring[(edge+1)%ring.length],length=Math.hypot(b[0]-a[0],b[1]-a[1]);return{a,b,length};}),total=spans.reduce((n,s)=>n+s.length,0),start=parts.length;
    const emit=(s:number,y:number,out:number,width:number,height:number,depth:number,role:NaplesFacadePart['role'],kind:NaplesFacadePart['kind']='box',roll=0,extraYaw=0)=>{
      if(parts.length-start>=3500)return;
      let travelled=0,span=spans.at(-1)!;for(const candidate of spans){span=candidate;if(s*total<=travelled+span.length)break;travelled+=span.length;}
      const t=(s*total-travelled)/span.length,tx=(span.b[0]-span.a[0])/span.length,tz=(span.b[1]-span.a[1])/span.length,nx=orientation*tz,nz=-orientation*tx;
      parts.push({buildingId:face.buildingId,role,kind,x:span.a[0]+(span.b[0]-span.a[0])*t+nx*out,y,z:span.a[1]+(span.b[1]-span.a[1])*t+nz*out,width,height,depth,yaw:-Math.atan2(tz,tx)+extraYaw,roll});
    };
    if(face.buildingId==='relation/4779351:1'){
      const bays=10,pitch=total/bays,roomHeight=building.height*.087;
      // Modern white grid and glazed strips, with no invented green shutters.
      for(let row=0;row<9;row++)for(let bay=0;bay<bays;bay++)emit((bay+.5)/bays,building.height*(1-(.145+.087*row)),.09,pitch*.86,roomHeight*.83,.045,'glass');
      for(let bay=0;bay<bays;bay++)emit((bay+.5)/bays,building.height*.947,.09,pitch*.86,.95,.045,'glass');
      for(let col=0;col<=bays;col++)emit(col/bays,building.height*.50,.16,.14,building.height*.82,.22,'frame');
      for(let row=0;row<=9;row++)emit(.5,building.height*(1-(.101+.087*row)),.20,total,.16,.34,'frame');
      emit(.5,building.height-.12,.18,total,.20,.34,'frame');
      continue;
    }
    const bays=13,pitch=total/bays,windowWidth=pitch*.47,windowHeight=2.35;
    for(let row=0;row<4;row++)for(let bay=0;bay<bays;bay++){
      const s=(bay+.5)/bays,y=building.height*(1-(.325+.125*row)),arched=bay>=3&&bay<=9,bottom=y-windowHeight/2;
      emit(s,y,.09,windowWidth,windowHeight,.04,'glass',arched?'arch':'box');
      for(const side of[-1,1])emit(s+side*(windowWidth/2+.055)/total,y-(arched?.25:0),.16,.11,windowHeight-(arched?.50:0),.20,'frame');
      if(arched){
        const radius=windowWidth/2+.055,spring=y+windowHeight*.22;
        for(let segment=0;segment<10;segment++){
          const a=segment*Math.PI/10,b=(segment+1)*Math.PI/10,x0=Math.cos(a)*radius,x1=Math.cos(b)*radius,y0=spring+Math.sin(a)*windowHeight*.28,y1=spring+Math.sin(b)*windowHeight*.28;
          emit(s+(x0+x1)/2/total,(y0+y1)/2,.16,Math.hypot(x1-x0,y1-y0)+.025,.11,.20,'frame','box',Math.atan2(y1-y0,x1-x0));
        }
      }else emit(s,y+windowHeight/2+.05,.16,windowWidth+.22,.12,.20,'frame');
      const balconyWidth=windowWidth+.48,depth=.75,slabY=bottom-.10;
      if(arched){
        emit(s,slabY,.10,balconyWidth,.14,depth*2,'frame','curved-slab');
        for(let segment=0;segment<10;segment++){
          const a=segment*Math.PI/10,b=(segment+1)*Math.PI/10,x0=Math.cos(a)*balconyWidth/2,x1=Math.cos(b)*balconyWidth/2,o0=.10+Math.sin(a)*depth,o1=.10+Math.sin(b)*depth;
          emit(s+(x0+x1)/2/total,slabY+.88,(o0+o1)/2,Math.hypot(x1-x0,o1-o0),.04,.04,'iron','box',0,orientation*Math.atan2(o1-o0,x1-x0));
        }
        for(let post=0;post<=8;post++){const a=post*Math.PI/8;emit(s+Math.cos(a)*balconyWidth/2/total,slabY+.46,.10+Math.sin(a)*depth,.028,.84,.028,'iron');}
      }else{
        emit(s,slabY,.42,balconyWidth,.14,.84,'frame');emit(s,slabY+.88,.82,balconyWidth,.04,.04,'iron');
        for(let post=0;post<7;post++)emit(s+(post/6-.5)*balconyWidth/total,slabY+.46,.82,.028,.84,.028,'iron');
        for(const side of[-1,1])emit(s+side*balconyWidth/2/total,slabY+.88,.42,.04,.04,.80,'iron');
      }
    }
    for(let bay=0;bay<bays;bay++){
      const s=(bay+.5)/bays;emit(s,building.height*.805,.09,1.12,1.08,.04,'glass');
      for(const side of[-1,1])emit(s+side*.61/total,building.height*.805,.15,.10,1.28,.18,'frame');
      emit(s,building.height*.805+.59,.15,1.32,.10,.18,'frame');
    }
    emit(.5,building.height*.875,.18,total,.18,.30,'frame');
  }
  return parts;
}
export function planNaplesFacades(map:MapData){
  const walls:NaplesFacadeGeometry[]=[],skipped:string[]=[];
  for(const face of NAPLES_PHOTO_FACES){
    const building=map.buildings.find(b=>b.id===face.buildingId),ring=building?.rings[0];
    // Fail closed if a future source-map revision changes the identified wall.
    if(!building||!ring||!Number.isFinite(building.height)||building.height<3||face.edges.some((edge,i)=>!ring[edge]||Math.hypot(ring[edge][0]-face.points[i][0],ring[edge][1]-face.points[i][1])>.02||Math.hypot(ring[(edge+1)%ring.length][0]-face.points[i+1][0],ring[(edge+1)%ring.length][1]-face.points[i+1][1])>.02)){skipped.push(face.buildingId);continue;}
    const area=ring.reduce((sum,p,i)=>sum+p[0]*ring[(i+1)%ring.length][1]-ring[(i+1)%ring.length][0]*p[1],0)/2,orientation=Math.sign(area);if(!orientation){skipped.push(face.buildingId);continue;}
    const total=face.points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p[0]-face.points[i][0],p[1]-face.points[i][1]),0),project=photoProjection(face.pixels,NAPLES_FACADE_PHOTO.width,NAPLES_FACADE_PHOTO.height);
    const wall:NaplesFacadeGeometry={buildingId:face.buildingId,name:face.name,sourceEdges:[...face.edges],positions:[],normals:[],indices:[],uvs:[],uvs2:[],height:building.height,observedLayout:face.observedLayout,bounds:[Math.min(...face.points.map(p=>p[0])),Math.min(...face.points.map(p=>p[1])),Math.max(...face.points.map(p=>p[0])),Math.max(...face.points.map(p=>p[1]))]};
    let travelled=0;
    for(const edge of face.edges){
      const a=ring[edge],b=ring[(edge+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz),nx=orientation*dz/length,nz=-orientation*dx/length,columns=Math.max(2,Math.ceil(length/2)),rows=16,start=wall.positions.length/3;
      // Original image bytes remain intact. Omit the lowest 1.4m, where traffic
      // and pedestrians occlude the photographed wall, instead of baking cars onto it.
      const bottom=1.4;
      for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
        const along=col/columns,y=building.height-(building.height-bottom)*row/rows,s=(travelled+along*length)/total,t=1-y/building.height,uv=project(s,t);
        wall.positions.push(a[0]+dx*along+nx*.04,y,a[1]+dz*along+nz*.04);wall.normals.push(nx,0,nz);wall.uvs.push(...uv);wall.uvs2.push((travelled+along*length)/2,y/2);
      }
      for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){const i=start+row*(columns+1)+col;wall.indices.push(i,i+1,i+columns+1,i+1,i+columns+2,i+columns+1);}
      travelled+=length;
    }
    walls.push(wall);
  }
  return{walls,excludedBuildingIds:new Set(walls.map(w=>w.buildingId)),skipped,calibration:'inferred manual photo alignment, not surveyed geometry or photogrammetry' as const};
}
export interface NaplesFacadeOptions {assetBase?:string;loadTexture?:boolean;textureLoader?:(url:string)=>BaseTexture}
/** Two wall surfaces only: no skyline billboard, substitute city or gameplay collider. */
export function addNaplesFacades(scene:Scene,map:MapData,options:NaplesFacadeOptions={}){
  const plan=planNaplesFacades(map),material=new PBRMaterial('facciate fotografiche autentiche di Napoli',scene);material.albedoColor=Color3.White();material.roughness=.95;material.metallic=0;material.environmentIntensity=.8;material.backFaceCulling=false;
  let texture:BaseTexture|undefined,ready=Promise.resolve();
  if(options.loadTexture??scene.getEngine().getClassName()!=='NullEngine'){
    const url=(options.assetBase??import.meta.env?.BASE_URL??'/')+NAPLES_FACADE_PHOTO.path;
    if(options.textureLoader)texture=options.textureLoader(url);
    else ready=new Promise<void>((resolve,reject)=>{texture=new Texture(url,scene,false,false,Texture.TRILINEAR_SAMPLINGMODE,resolve,message=>reject(new Error('Foto originale Napoli non disponibile: '+message)));});
    // invertY=false and native top-left UV coordinates are the same convention as glTF.
    material.albedoTexture=texture!;texture!.wrapU=texture!.wrapV=Texture.CLAMP_ADDRESSMODE;texture!.gammaSpace=true;texture!.anisotropicFilteringLevel=8;
  }
  material.metadata={photographicFacade:true,source:NAPLES_FACADE_PHOTO,calibration:plan.calibration,wallPixelsApproximately:[440,640],notPhotogrammetry:true};
  const meshes=plan.walls.map(wall=>{const mesh=new Mesh(wall.name,scene),data=new VertexData();data.positions=wall.positions;data.normals=wall.normals;data.indices=wall.indices;data.uvs=wall.uvs;data.uvs2=wall.uvs2;data.applyToMesh(mesh);mesh.material=material;mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=true;mesh.metadata={solid:false,naplesPhotoFacade:true,buildingId:wall.buildingId,sourceEdges:wall.sourceEdges,observedLayout:wall.observedLayout,calibration:plan.calibration};return mesh;});
  const profile=planNaplesFacadeProfiles(map,plan.excludedBuildingIds),profileMaterials={glass:new PBRMaterial('vetro autentiche facciate',scene),frame:new PBRMaterial('cornici autentiche facciate',scene),iron:new PBRMaterial('ringhiere autentiche facciate',scene)};
  profileMaterials.glass.albedoColor=Color3.FromHexString('#253a40').toLinearSpace();profileMaterials.glass.roughness=.14;profileMaterials.glass.metallic=.03;profileMaterials.glass.environmentIntensity=1.3;
  profileMaterials.frame.albedoColor=Color3.FromHexString('#d8d9ce').toLinearSpace();profileMaterials.frame.roughness=.85;profileMaterials.frame.metallic=0;
  profileMaterials.iron.albedoColor=Color3.FromHexString('#293430').toLinearSpace();profileMaterials.iron.roughness=.4;profileMaterials.iron.metallic=.5;
  const groups=new Map<string,NaplesFacadePart[]>();for(const part of profile){const key=part.role+':'+part.kind,list=groups.get(key)??[];list.push(part);groups.set(key,list);}
  const profileMeshes:Mesh[]=[];
  for(const[key,parts]of groups){
    const mesh=profileTemplate(scene,parts[0].kind);mesh.name='architettura da foto Napoli · '+key;mesh.material=profileMaterials[parts[0].role];mesh.material.backFaceCulling=false;mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=true;mesh.metadata={solid:false,naplesFacadeProfile:true,inferredDepth:true,instances:parts.length};
    const buffer=new Float32Array(parts.length*16),matrix=Matrix.Identity();for(let i=0;i<parts.length;i++){const p=parts[i];Matrix.ComposeToRef(new Vector3(p.width,p.height,p.depth),Quaternion.RotationYawPitchRoll(p.yaw,0,p.roll),new Vector3(p.x,p.y,p.z),matrix);matrix.copyToArray(buffer,i*16);}mesh.thinInstanceSetBuffer('matrix',buffer,16,true);mesh.thinInstanceRefreshBoundingInfo();profileMeshes.push(mesh);
  }
  return{meshes:[...meshes,...profileMeshes],photoMeshes:meshes,profileMeshes,material,ready,excludedBuildingIds:plan.excludedBuildingIds,stats:{walls:meshes.length,profileInstances:profile.length,profileBatches:profileMeshes.length,skipped:plan.skipped,vertices:plan.walls.reduce((n,w)=>n+w.positions.length/3,0),originalPhoto:NAPLES_FACADE_PHOTO,calibration:plan.calibration},dispose(){for(const mesh of [...meshes,...profileMeshes])mesh.dispose(false,false);for(const m of Object.values(profileMaterials))m.dispose();material.dispose(false,false);texture?.dispose();}};
}

function profileTemplate(scene:Scene,kind:NaplesFacadePart['kind']){
  if(kind==='box')return MeshBuilder.CreateBox('profilo',{size:1},scene);
  const mesh=new Mesh('profilo',scene),data=new VertexData(),positions:number[]=[],normals:number[]=[],indices:number[]=[];
  if(kind==='arch'){
    const outline:Point[]=[[-.5,-.5],[.5,-.5]];for(let i=0;i<=16;i++){const angle=i*Math.PI/16;outline.push([Math.cos(angle)*.5,.22+Math.sin(angle)*.28]);}
    positions.push(0,0,0);normals.push(0,0,-1);for(const[x,y]of outline){positions.push(x,y,0);normals.push(0,0,-1);}for(let i=0;i<outline.length;i++)indices.push(0,1+i,1+(i+1)%outline.length);
  }else{
    for(const side of[-1,1]){const start=positions.length/3;positions.push(0,side*.5,0);normals.push(0,side,0);for(let i=0;i<=16;i++){const a=i*Math.PI/16;positions.push(Math.cos(a)*.5,side*.5,-Math.sin(a)*.5);normals.push(0,side,0);}for(let i=0;i<16;i++)indices.push(start,start+i+1,start+i+2);}
    const quad=(a:number[],b:number[],c:number[],d:number[],normal:number[])=>{const start=positions.length/3;for(const p of[a,b,c,d]){positions.push(...p);normals.push(...normal);}indices.push(start,start+1,start+2,start,start+2,start+3);};
    for(let i=0;i<16;i++){const a=i*Math.PI/16,b=(i+1)*Math.PI/16,x0=Math.cos(a)*.5,x1=Math.cos(b)*.5,z0=-Math.sin(a)*.5,z1=-Math.sin(b)*.5;quad([x0,-.5,z0],[x1,-.5,z1],[x1,.5,z1],[x0,.5,z0],[Math.cos((a+b)/2),0,-Math.sin((a+b)/2)]);}quad([-.5,-.5,0],[.5,-.5,0],[.5,.5,0],[-.5,.5,0],[0,0,1]);
  }
  data.positions=positions;data.normals=normals;data.indices=indices;data.applyToMesh(mesh);return mesh;
}
