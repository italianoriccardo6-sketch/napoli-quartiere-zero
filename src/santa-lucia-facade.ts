import '@babylonjs/core/Meshes/thinInstanceMesh';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Material} from '@babylonjs/core/Materials/material';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type {MapData,Point} from './geo';
import {NAPLES_FACADE_PHOTO,photoProjection,type PixelQuad} from './naples-facades';

/** The near-car building is Santa Lucia (46), not the neighbouring Excelsior (48). */
export const SANTA_LUCIA_FRONT={
  buildingId:'relation/1191265:0',name:'Grand Hotel Santa Lucia · fronte su Via Partenope',edges:[1,2,3],
  points:[[19.82835882592767,208.50140625617365],[38.64592620774627,207.9336768528212],[46.89229973812468,207.80009346389016],[65.17077834981164,207.23236406053772]] as Point[],
  pixels:[[1448,786],[1889,783],[1911,1108],[1469,1112]] as PixelQuad,
  identitySource:'https://www.santalucia.it/location-e-contatti/ — Via Partenope46; SANTA LUCIA nameplate in the original2010 CC0 photograph.',
  corroboratingLocation:{latitude:40.83017085,longitude:14.249301312737819,source:'https://www.travelprofy.com/napoli-centrale-station/grand-hotel-santa-lucia-naples',primary:false},
  observedLayout:'Ten glazed stacks: eight central stacks and two outer wing stacks with wider separating piers; four upper registers including the shorter attic, two rusticated base registers, projecting cornices and pale stone balustrades. Inferred dimensions, not a measured architectural survey.',
  photo:NAPLES_FACADE_PHOTO,
} as const;
export const SANTA_LUCIA_ENTRANCE_PROXY={
  buildingId:'way/338157976:0',
  points:[[46.85860668989793,205.7963426299244],[46.89229973812468,207.80009346389016],[38.64592620774627,207.9336768528212],[38.612233159519526,205.92992601885544]] as Point[],
  slabTopRatio:.20,balustradeCapRatio:.23,
  modelPolicy:'Original four-arch entrance/portico inferred from the daylight photograph, constrained to the unchanged source footprint. Its current10m height is only the untagged OSM fallback; inferred slab and cap heights are not measured. Source/collision geometry remains unchanged.',
} as const;
type Role='frame'|'glass'|'iron';
type Kind='box'|'baluster'|'corbel';
export interface SantaLuciaPart {role:Role;kind:Kind;feature:string;x:number;y:number;z:number;width:number;height:number;depth:number;yaw:number;roll:number}
export interface SantaLuciaOptions {
  /** Existing CC0 panorama material; no additional photo or texture is downloaded. */
  photoMaterial?:Material;
  materials?:Partial<Record<Role,Material>>;
  buildingBaseHeight?:(id:string)=>number;
  shadows?:ShadowGenerator;
}

function confirmedHotel(map:MapData){
  const source=SANTA_LUCIA_FRONT,building=map.buildings.find(b=>b.id===source.buildingId),ring=building?.rings[0];
  if(!building||!ring||!Number.isFinite(building.height)||building.height<8||source.edges.some((edge,i)=>!ring[edge]||Math.hypot(ring[edge][0]-source.points[i][0],ring[edge][1]-source.points[i][1])>.02||Math.hypot(ring[(edge+1)%ring.length][0]-source.points[i+1][0],ring[(edge+1)%ring.length][1]-source.points[i+1][1])>.02))return null;
  return building;
}
/** Pre-world visual eligibility only: never removes or edits collision/source footprints. */
export function visualReplacementBuildingIds(map:MapData):ReadonlySet<string>{
  if(!confirmedHotel(map))return new Set();
  const source=SANTA_LUCIA_ENTRANCE_PROXY,proxy=map.buildings.find(b=>b.id===source.buildingId),ring=proxy?.rings[0];
  const eligible=proxy?.estimated===true&&proxy.height===10&&proxy.rings.length===1&&ring?.length===source.points.length&&source.points.every((p,i)=>Math.hypot(p[0]-ring[i][0],p[1]-ring[i][1])<=.02);
  return new Set(eligible?[source.buildingId]:[]);
}

export function planSantaLuciaFacade(map:MapData,options:Pick<SantaLuciaOptions,'buildingBaseHeight'>={}){
  const source=SANTA_LUCIA_FRONT,building=confirmedHotel(map),ring=building?.rings[0];
  const empty={wall:null,portico:null,parts:[] as SantaLuciaPart[],excludedEdges:new Map<string,ReadonlySet<number>>(),visualReplacementBuildingIds:new Set<string>() as ReadonlySet<string>,calibration:'original photo and source walls; inferred manual alignment and profile depths, not photogrammetry' as const};
  if(!building||!ring)return empty;
  const base=options.buildingBaseHeight?.(source.buildingId)??0;if(!Number.isFinite(base))throw new RangeError('Quota della base Santa Lucia non finita.');
  const orientation=Math.sign(ring.reduce((n,p,i)=>n+p[0]*ring[(i+1)%ring.length][1]-ring[(i+1)%ring.length][0]*p[1],0));if(!orientation)return empty;
  const spans=source.edges.map(edge=>{const a=ring[edge],b=ring[(edge+1)%ring.length];return{a,b,length:Math.hypot(b[0]-a[0],b[1]-a[1])};}),total=spans.reduce((n,s)=>n+s.length,0),parts:SantaLuciaPart[]=[],height=building.height;
  const position=(s:number,out:number)=>{
    let travelled=0,span=spans.at(-1)!;for(const candidate of spans){span=candidate;if(s*total<=travelled+span.length)break;travelled+=span.length;}
    const t=(s*total-travelled)/span.length,tx=(span.b[0]-span.a[0])/span.length,tz=(span.b[1]-span.a[1])/span.length;
    return{x:span.a[0]+(span.b[0]-span.a[0])*t+orientation*tz*out,z:span.a[1]+(span.b[1]-span.a[1])*t-orientation*tx*out,yaw:-Math.atan2(tz,tx)};
  };
  const emit=(s:number,y:number,out:number,width:number,h:number,depth:number,role:Role,feature:string,kind:Kind='box')=>parts.push({...position(s,out),y:base+y,width,height:h,depth,role,feature,kind,roll:0});
  const bays=[.115,.251,.334,.417,.500,.583,.666,.749,.832,.945];
  // Ratios are calibrated from the daylight photograph, not from the adjacent
  // Excelsior's ornate night facade. There are no hinged green side shutters.
  for(const [row,ratio]of [.470,.625,.778,.918].entries())for(const [bay,s]of bays.entries()){
    const attic=row===3,wing=bay===0||bay===bays.length-1,y=height*ratio,windowHeight=height*(attic?.083:.132),width=wing?1.65:1.57,bottom=y-windowHeight/2;
    emit(s,y,.065,width,windowHeight,.025,'glass','window-pane');
    for(const side of[-1,1])emit(s+side*(width/2+.065)/total,y,.12,.13,windowHeight+.14,.20,'frame','window-jamb');
    emit(s,y+windowHeight/2+.10,.20,width+.34,.15,.32,'frame','window-head');
    emit(s,bottom-.06,.23,width+.38,.12,.40,'frame','window-sill');
    const balconyWidth=attic?width+.28:width+.68,projection=attic?.34:.70,slabY=bottom-.15;
    emit(s,slabY,projection*.52,balconyWidth,.17,projection+.22,'frame','balcony-slab');
    if(attic){
      emit(s,slabY+.69,projection,.04+balconyWidth,.035,.035,'iron','attic-rail');
      for(let post=0;post<8;post++)emit(s+(post/7-.5)*balconyWidth/total,slabY+.36,projection,.025,.64,.025,'iron','attic-post');
    }else{
      emit(s,slabY+.77,projection,balconyWidth,.13,.20,'frame','balustrade-cap');
      for(let post=0;post<7;post++)emit(s+(post/6-.5)*(balconyWidth-.13)/total,slabY+.42,projection,.105,.61,.105,'frame','stone-baluster','baluster');
      for(const side of[-1,1]){emit(s+side*(balconyWidth/2-.06)/total,slabY+.41,projection*.52,.12,.64,projection+.09,'frame','balustrade-return');emit(s+side*width*.32/total,slabY-.34,projection*.40,.23,.54,projection*.9,'frame','balcony-corbel','corbel');}
    }
  }
  for(const ratio of [.37,.56,.71,.865,.985]){
    const y=height*ratio;emit(.5,y,.16,total,.17,.32,'frame','continuous-cornice');emit(.5,y+.115,.24,total+.12,.09,.48,'frame','cornice-lip');
  }
  for(const s of[.025,.194,.891,.978]){
    emit(s,height*.61,.085,.38,height*.50,.16,'frame','facade-pilaster');
    for(const ratio of[.385,.86])emit(s,height*ratio,.17,.61,.24,.33,'frame','pilaster-capital');
  }
  // The lower two registers remain rusticated; the centre entry is retained in
  // the photograph instead of inventing a current measured door/canopy layout.
  for(const s of bays)for(const ratio of[.105,.285]){
    if(s>.38&&s<.70&&ratio===.105)continue;
    const y=height*ratio;emit(s,y,.055,1.33,height*.083,.025,'glass','base-window');
    for(const side of[-1,1])emit(s+side*.76/total,y,.13,.14,height*.10,.20,'frame','base-window-jamb');
    emit(s,y+height*.05,.16,1.66,.14,.26,'frame','base-window-head');
  }
  for(let row=0;row<14;row++)emit(.5,height*.37*row/14,.07,total,.035,.085,'frame','rusticated-base-course');
  const positions:number[]=[],indices:number[]=[],normals:number[]=[],uvs:number[]=[],project=photoProjection(source.pixels,NAPLES_FACADE_PHOTO.width,NAPLES_FACADE_PHOTO.height);let travelled=0;
  for(const span of spans){
    const columns=Math.max(2,Math.ceil(span.length/2)),rows=16,start=positions.length/3,tx=(span.b[0]-span.a[0])/span.length,tz=(span.b[1]-span.a[1])/span.length,nx=orientation*tz,nz=-orientation*tx;
    for(let row=0;row<=rows;row++)for(let col=0;col<=columns;col++){
      const t=col/columns,y=height-(height-1.4)*row/rows,s=(travelled+t*span.length)/total,uv=project(s,1-y/height);
      positions.push(span.a[0]+(span.b[0]-span.a[0])*t+nx*.04,y+base,span.a[1]+(span.b[1]-span.a[1])*t+nz*.04);normals.push(nx,0,nz);uvs.push(...uv);
    }
    for(let row=0;row<rows;row++)for(let col=0;col<columns;col++){const i=start+row*(columns+1)+col;indices.push(i,i+1,i+columns+1,i+1,i+columns+2,i+columns+1);}travelled+=span.length;
  }
  const replacementIds=visualReplacementBuildingIds(map);
  const portico=replacementIds.size?planPortico(map,parts,base,height):null;
  return{wall:{positions,indices,normals,uvs,height,base},portico,parts,excludedEdges:new Map<string,ReadonlySet<number>>([[source.buildingId,new Set(source.edges)]]),visualReplacementBuildingIds:replacementIds,calibration:empty.calibration};
}

function planPortico(map:MapData,parts:SantaLuciaPart[],base:number,hotelHeight:number){
  const source=SANTA_LUCIA_ENTRANCE_PROXY,ring=map.buildings.find(b=>b.id===source.buildingId)!.rings[0],a=ring[3],b=ring[0],back=ring[2],length=Math.hypot(b[0]-a[0],b[1]-a[1]),depth=Math.hypot(back[0]-a[0],back[1]-a[1]),yaw=-Math.atan2(b[1]-a[1],b[0]-a[0]),slabTop=hotelHeight*source.slabTopRatio,cap=hotelHeight*source.balustradeCapRatio,slabBottom=slabTop-.22;
  const emit=(s:number,y:number,t:number,width:number,h:number,d:number,feature:string,kind:Kind='box',roll=0)=>parts.push({x:a[0]+(b[0]-a[0])*s+(back[0]-a[0])*t,z:a[1]+(b[1]-a[1])*s+(back[1]-a[1])*t,y:base+y,width,height:h,depth:d,yaw,roll,role:'frame',feature,kind});
  const pierHeight=slabBottom-.08,pierWidth=.27,pierDepth=.33;
  for(const t of[.14,.85])for(let pier=0;pier<=4;pier++){
    const along=.22+(length-.44)*pier/4;emit(along/length,pierHeight/2,t,pierWidth,pierHeight,pierDepth,'portico-pier');
    emit(along/length,pierHeight-.055,t,.39,.13,.39,'portico-pier-capital');
  }
  const pitch=(length-.44)/4,archWidth=pitch-.34,rise=.69,spring=slabBottom-.14-rise;
  for(let arch=0;arch<4;arch++){
    const centre=.22+pitch*(arch+.5);
    for(let segment=0;segment<12;segment++){
      const u=segment*Math.PI/12,v=(segment+1)*Math.PI/12,x0=Math.cos(u)*archWidth/2,x1=Math.cos(v)*archWidth/2,y0=spring+Math.sin(u)*rise,y1=spring+Math.sin(v)*rise;
      emit((centre+(x0+x1)/2)/length,(y0+y1)/2,.14,Math.hypot(x1-x0,y1-y0)+.008,.12,.20,'portico-arch-moulding','box',Math.atan2(y1-y0,x1-x0));
    }
  }
  const railHeight=cap-slabTop-.12,railCentre=slabTop+railHeight/2+.015;
  for(let post=0;post<21;post++)emit((.22+(length-.44)*post/20)/length,railCentre,.14,.10,railHeight,.10,'portico-stone-baluster','baluster');
  emit(.5,cap-.06,.14,length-.24,.12,.18,'portico-balustrade-cap');
  for(const s of[.025,.975])emit(s,cap-.06,.53,.13,.12,depth-.32,'portico-balustrade-return');
  const positions:number[]=[],indices:number[]=[],normals:number[]=[],uvs:number[]=[];
  for(const y of[base+slabBottom,base+slabTop])for(const[x,z]of ring){positions.push(x,y,z);uvs.push(x/2,z/2);}
  indices.push(0,2,1,0,3,2,4,5,6,4,6,7);
  for(let i=0;i<4;i++){const j=(i+1)%4;indices.push(i,j,4+j,i,4+j,4+i);}
  VertexData.ComputeNormals(positions,indices,normals);
  return{positions,indices,normals,uvs,slabTop:base+slabTop,cap:base+cap,sourceId:source.buildingId,modelPolicy:source.modelPolicy};
}

function template(scene:Scene,kind:Kind){
  if(kind==='box')return MeshBuilder.CreateBox('profilo Santa Lucia',{size:1},scene);
  if(kind==='baluster')return MeshBuilder.CreateLathe('balaustro Santa Lucia',{shape:[new Vector3(.40,-.5,0),new Vector3(.44,-.34,0),new Vector3(.23,-.23,0),new Vector3(.48,-.02,0),new Vector3(.37,.19,0),new Vector3(.20,.32,0),new Vector3(.38,.5,0)],tessellation:8,cap:Mesh.CAP_ALL},scene);
  const mesh=new Mesh('mensola Santa Lucia',scene),data=new VertexData(),positions:number[]=[],indices:number[]=[],normals:number[]=[],outline=[[-.5,.5],[-.5,.29],[-.12,.05],[.13,-.24],[.28,-.5],[.5,-.5],[.5,.5]];
  // Convex side profile: X extrusion, local -Z projects away from this wall.
  for(const x of[-.5,.5])for(const[z,y]of outline)positions.push(x,y,z);
  for(let i=1;i<outline.length-1;i++){indices.push(0,i+1,i,outline.length,outline.length+i,outline.length+i+1);}
  for(let i=0;i<outline.length;i++){const j=(i+1)%outline.length;indices.push(i,j,outline.length+j,i,outline.length+j,outline.length+i);}
  VertexData.ComputeNormals(positions,indices,normals);data.positions=positions;data.indices=indices;data.normals=normals;data.applyToMesh(mesh);return mesh;
}

/** Photo wall plus original inferred depth. Source image bytes stay unchanged. */
export function addSantaLuciaFacade(scene:Scene,map:MapData,options:SantaLuciaOptions={}){
  const plan=planSantaLuciaFacade(map,options),meshes:Mesh[]=[],profileMeshes:Mesh[]=[],owned:Material[]=[];
  if(!plan.wall)return{meshes,profileMeshes,excludedEdges:plan.excludedEdges,visualReplacementBuildingIds:plan.visualReplacementBuildingIds,stats:{walls:0,profileInstances:0,profileBatches:0,source:SANTA_LUCIA_FRONT,calibration:plan.calibration},dispose(){}};
  const fallback=(name:string,color:string,roughness:number,metallic=0)=>{const m=new PBRMaterial(name,scene);m.albedoColor=Color3.FromHexString(color).toLinearSpace();m.roughness=roughness;m.metallic=metallic;owned.push(m);return m;};
  const wall=new Mesh(SANTA_LUCIA_FRONT.name,scene),vertices=new VertexData();vertices.positions=plan.wall.positions;vertices.indices=plan.wall.indices;vertices.normals=plan.wall.normals;vertices.uvs=plan.wall.uvs;vertices.applyToMesh(wall);
  wall.material=options.photoMaterial??fallback('intonaco Santa Lucia inferito','#dcd4bf',.94);wall.receiveShadows=true;wall.isPickable=false;wall.checkCollisions=false;wall.metadata={solid:false,naplesPhotoFacade:true,santaLuciaFacade:true,buildingId:SANTA_LUCIA_FRONT.buildingId,sourceEdges:SANTA_LUCIA_FRONT.edges,calibration:plan.calibration};meshes.push(wall);
  const materials={frame:options.materials?.frame??fallback('cornici Santa Lucia','#d8d1bd',.85),glass:options.materials?.glass??fallback('vetro Santa Lucia','#263d43',.17,.03),iron:options.materials?.iron??fallback('ferro Santa Lucia','#293431',.43,.45)},groups=new Map<string,SantaLuciaPart[]>();
  // Preserve the photographed curtains/shutter variations where the actual
  // panorama is supplied; opaque invented panes must not cover those pixels.
  for(const part of plan.parts){if(options.photoMaterial&&part.role==='glass')continue;const key=part.role+':'+part.kind,list=groups.get(key)??[];list.push(part);groups.set(key,list);}
  for(const[key,parts]of groups){
    const mesh=template(scene,parts[0].kind);mesh.name='architettura Grand Hotel Santa Lucia · '+key;mesh.material=materials[parts[0].role];mesh.receiveShadows=true;mesh.isPickable=false;mesh.checkCollisions=false;mesh.metadata={solid:false,naplesFacadeProfile:true,santaLuciaFacadeProfile:true,inferredDepth:true,instances:parts.length,role:parts[0].role};
    const matrices=new Float32Array(parts.length*16),matrix=Matrix.Identity();for(let i=0;i<parts.length;i++){const p=parts[i];Matrix.ComposeToRef(new Vector3(p.width,p.height,p.depth),Quaternion.RotationYawPitchRoll(p.yaw,0,p.roll),new Vector3(p.x,p.y,p.z),matrix);matrix.copyToArray(matrices,i*16);}mesh.thinInstanceSetBuffer('matrix',matrices,16,true);mesh.thinInstanceRefreshBoundingInfo();if(parts[0].role!=='glass')options.shadows?.addShadowCaster(mesh,false);profileMeshes.push(mesh);meshes.push(mesh);
  }
  if(plan.portico){const mesh=new Mesh('portico Santa Lucia · sagoma sorgente invariata',scene),data=new VertexData();data.positions=plan.portico.positions;data.indices=plan.portico.indices;data.normals=plan.portico.normals;data.uvs=plan.portico.uvs;data.applyToMesh(mesh);mesh.material=materials.frame;mesh.receiveShadows=true;mesh.isPickable=false;mesh.checkCollisions=false;mesh.metadata={solid:false,naplesFacadeProfile:true,santaLuciaFacadeProfile:true,visualReplacementBuildingId:plan.portico.sourceId,inferredHeight:true,modelPolicy:plan.portico.modelPolicy};options.shadows?.addShadowCaster(mesh,false);profileMeshes.push(mesh);meshes.push(mesh);}
  return{meshes,profileMeshes,excludedEdges:plan.excludedEdges,visualReplacementBuildingIds:plan.visualReplacementBuildingIds,stats:{walls:1,profileInstances:[...groups.values()].reduce((n,p)=>n+p.length,0),profileBatches:profileMeshes.length,source:SANTA_LUCIA_FRONT,entranceProxy:plan.portico?{source:SANTA_LUCIA_ENTRANCE_PROXY,slabTop:plan.portico.slabTop,cap:plan.portico.cap}:null,calibration:plan.calibration},dispose(){for(const mesh of profileMeshes)options.shadows?.removeShadowCaster(mesh,false);for(const mesh of meshes)mesh.dispose(false,false);for(const material of owned)material.dispose();}};
}
