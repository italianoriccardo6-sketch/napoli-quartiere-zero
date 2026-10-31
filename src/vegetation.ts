import '@babylonjs/core/Meshes/thinInstanceMesh';
import {Scene} from '@babylonjs/core/scene';import {Mesh} from '@babylonjs/core/Meshes/mesh';import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {Material} from '@babylonjs/core/Materials/material';import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {Color3} from '@babylonjs/core/Maths/math.color';import {Vector3,Matrix,Quaternion} from '@babylonjs/core/Maths/math.vector';import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {inside,segmentDistance,toLocal,type MapData,type Point,type Footprint} from './geo';

export interface SourceTree {id:string;lon:number;lat:number;tags:Record<string,string>}
export interface GreenData {version:1;source:{bbox:number[];license:string;retrieved_at:string;[key:string]:unknown};trees:SourceTree[];treeRows?:unknown[];areas?:unknown[]}
export type TreeForm='broadleaf'|'umbrella'|'conifer'|'palm';
export interface VegetationOptions {focus?:Point[];radius?:number;maxTrees?:number;quality?:'alta'|'bassa';groundHeight?:(x:number,z:number)=>number;materials?:{bark?:Material};shadows?:ShadowGenerator}
export interface TreePlacement {id:string;point:Point;ground:number;form:TreeForm;height:number;crownDiameter:number;trunkDiameter:number;estimatedHeight:boolean;estimatedCrown:boolean;crownLimitedByClearance:boolean}
export interface VegetationStats {sourceTrees:number;treesRendered:number;estimatedDimensions:number;invalidSource:number;outsideLand:number;insideBuildings:number;outsideCorridor:number;budgetClipped:number;branchInstances:number;leafInstances:number;meshCount:number;placement:'source-tree-nodes-only';individualTreesInvented:false}
export interface VegetationBatch {key:string;kind:'bark'|'broadleaf'|'palm';matrices:number[]}
export interface VegetationPlan {placements:TreePlacement[];batches:VegetationBatch[];stats:VegetationStats}
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
function metres(text:unknown):number|null{if(typeof text!=='string'||!/^\s*\d+(?:[.,]\d+)?\s*(?:m|metres?|meters?)?\s*$/i.test(text))return null;const n=Number.parseFloat(text.replace(',','.'));return Number.isFinite(n)&&n>0?n:null;}
function seedOf(value:string){let hash=2166136261;for(const c of value)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;return hash;}
function randomGenerator(seed:number){return()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};}
function treeForm(tags:Record<string,string>):TreeForm {const taxon=[tags.genus,tags.species,tags.taxon,tags['species:it']].filter(v=>typeof v==='string').join(' ').toLowerCase();if(/phoenix|washingtonia|trachycarpus|chamaerops|arecaceae|palma|palm\b/.test(taxon))return 'palm';if(/pinus\s+pinea|pino\s+domestico/.test(taxon))return 'umbrella';if(tags.leaf_type==='needleleaved'||/pinus|cupressus|cedrus|picea|abies/.test(taxon))return 'conifer';return 'broadleaf';}
function focusDistance(p:Point,focus:Point[]){if(!focus.length)return 0;if(focus.length===1)return Math.hypot(p[0]-focus[0][0],p[1]-focus[0][1]);let nearest=Infinity;for(let i=1;i<focus.length;i++)nearest=Math.min(nearest,segmentDistance(p,focus[i-1],focus[i]));return nearest;}
function buildingIndex(buildings:Footprint[]){const cells=new Map<string,Set<Footprint>>(),size=32;
 for(const b of buildings){if(!b.rings[0]?.length)continue;const x0=Math.floor(Math.min(...b.rings[0].map(p=>p[0]))/size),x1=Math.floor(Math.max(...b.rings[0].map(p=>p[0]))/size),z0=Math.floor(Math.min(...b.rings[0].map(p=>p[1]))/size),z1=Math.floor(Math.max(...b.rings[0].map(p=>p[1]))/size);for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z,c=cells.get(key)??new Set<Footprint>();c.add(b);cells.set(key,c);}}
 return (p:Point,radius:number)=>{let nearest=Infinity;const candidates=new Set<Footprint>();for(let x=Math.floor((p[0]-radius)/size);x<=Math.floor((p[0]+radius)/size);x++)for(let z=Math.floor((p[1]-radius)/size);z<=Math.floor((p[1]+radius)/size);z++)for(const b of cells.get(x+','+z)??[])candidates.add(b);
  for(const b of candidates){if(inside(p,b.rings[0])&&!b.rings.slice(1).some(h=>inside(p,h)))return -1;for(const ring of b.rings)for(let i=0;i<ring.length;i++)nearest=Math.min(nearest,segmentDistance(p,ring[i],ring[(i+1)%ring.length]));}return nearest;};
}

/** Original tree shape at a measured source node; no planting along unmeasured park/row geometry. */
export function buildVegetationPlan(map:MapData,data:GreenData,options:VegetationOptions={}):VegetationPlan {
 if(data.version!==1||!Array.isArray(data.trees)||data.source?.license!=='ODbL-1.0'||!Array.isArray(data.source.bbox)||data.source.bbox.length!==4||!data.source.bbox.every(Number.isFinite)||data.source.bbox[0]>=data.source.bbox[2]||data.source.bbox[1]>=data.source.bbox[3])throw new Error('Dati della vegetazione non validi.');
 const radius=options.radius??180,maxTrees=options.maxTrees??140,focus=options.focus??[];
 if(!Number.isFinite(radius)||radius<=0||radius>500||!Number.isInteger(maxTrees)||maxTrees<0||maxTrees>400||focus.some(p=>!p.every(Number.isFinite)))throw new RangeError('Limiti della vegetazione non validi.');
 const stats:VegetationStats={sourceTrees:data.trees.length,treesRendered:0,estimatedDimensions:0,invalidSource:0,outsideLand:0,insideBuildings:0,outsideCorridor:0,budgetClipped:0,branchInstances:0,leafInstances:0,meshCount:0,placement:'source-tree-nodes-only',individualTreesInvented:false};
 const candidateTrees:Array<{source:SourceTree;point:Point;distance:number}>=[],ids=new Set<string>();
 for(const source of data.trees){if(!source||typeof source.id!=='string'||!/^node\/\d+$/.test(source.id)||ids.has(source.id)||![source.lon,source.lat].every(Number.isFinite)||!source.tags||source.tags.natural!=='tree'){stats.invalidSource++;continue;}ids.add(source.id);const [south,west,north,east]=data.source.bbox??[];if(!(source.lon>=west&&source.lon<=east&&source.lat>=south&&source.lat<=north)){stats.invalidSource++;continue;}const point=toLocal(source.lon,source.lat),distance=focusDistance(point,focus);if(distance>radius){stats.outsideCorridor++;continue;}candidateTrees.push({source,point,distance});}
 candidateTrees.sort((a,b)=>a.distance-b.distance||a.source.id.localeCompare(b.source.id));
 const rawLand=(map as MapData&{city?:{landPolygons?:Point[][][]}}).city?.landPolygons??map.land.map(r=>[r]);
 const land=(p:Point)=>rawLand.some(polygon=>inside(p,polygon[0])&&!polygon.slice(1).some(h=>inside(p,h))),clearance=buildingIndex(map.buildings),placements:TreePlacement[]=[];
 for(const {source,point}of candidateTrees){
  if(!land(point)){stats.outsideLand++;continue;}
  const tags=source.tags,random=randomGenerator(seedOf(source.id)),heightTag=metres(tags.height),crownTag=metres(tags.crown_diameter),circumference=metres(tags.circumference);
  const height=heightTag&&heightTag>=1&&heightTag<=60?heightTag:7.5+random()*2.5,estimatedHeight=heightTag===null||heightTag<1||heightTag>60;
  let crown=crownTag&&crownTag>=.4&&crownTag<=30?crownTag:height*(.5+random()*.18);const estimatedCrown=crownTag===null||crownTag<.4||crownTag>30;
  const trunkDiameter=circumference?clamp(circumference/Math.PI,.1,1.6):clamp(height*.04,.18,.8),space=clearance(point,crown/2+1);
  if(space<Math.max(.15,trunkDiameter/2+.03)){stats.insideBuildings++;continue;}
  const originalCrown=crown;if(estimatedCrown&&Number.isFinite(space))crown=Math.max(.5,Math.min(crown,space*2-.3));
  const ground=options.groundHeight?.(point[0],point[1])??0;if(!Number.isFinite(ground)){stats.invalidSource++;continue;}
  if(placements.length>=maxTrees){stats.budgetClipped++;continue;}
  placements.push({id:source.id,point,ground,form:treeForm(tags),height,crownDiameter:crown,trunkDiameter,estimatedHeight,estimatedCrown,crownLimitedByClearance:crown<originalCrown});
  if(estimatedHeight||estimatedCrown)stats.estimatedDimensions++;
 }
 const batches:VegetationBatch[]=[],lookup=new Map<string,VegetationBatch>();
 function add(kind:VegetationBatch['kind'],tree:TreePlacement,matrix:Matrix){const key=kind+':'+Math.floor(tree.point[0]/128)+','+Math.floor(tree.point[1]/128);let batch=lookup.get(key);if(!batch){batch={key,kind,matrices:[]};lookup.set(key,batch);batches.push(batch);}batch.matrices.push(...matrix.asArray());if(kind==='bark')stats.branchInstances++;else stats.leafInstances++;}
 function segment(tree:TreePlacement,a:Vector3,b:Vector3,diameter:number){const direction=b.subtract(a),distance=direction.length();if(distance<.001)return;direction.scaleInPlace(1/distance);const rotation=Quaternion.Identity();Quaternion.FromUnitVectorsToRef(Vector3.Up(),direction,rotation);add('bark',tree,Matrix.Compose(new Vector3(diameter,distance,diameter),rotation,a.add(b).scale(.5)));}
 function card(tree:TreePlacement,kind:'broadleaf'|'palm',p:Vector3,width:number,height:number,rotation:Quaternion){add(kind,tree,Matrix.Compose(new Vector3(width,height,1),rotation,p));}
 const leafCount=options.quality==='bassa'?5:8;
 for(const tree of placements){
  const random=randomGenerator(seedOf(tree.id)),[x,z]=tree.point,h=tree.height,r=tree.crownDiameter/2,y=tree.ground;
  if(tree.form==='palm'){
   const base=new Vector3(x,y,z),crown=new Vector3(x+r*.035,y+h*.86,z-r*.025);for(let i=0;i<5;i++){const a=Vector3.Lerp(base,crown,i/5),b=Vector3.Lerp(base,crown,(i+1)/5);segment(tree,a,b,tree.trunkDiameter*(1-i*.045));}
   for(let f=0;f<13;f++){const angle=f*Math.PI*2/13+random()*.22,tip=new Vector3(x+Math.cos(angle)*r,y+h*(.72+random()*.1),z+Math.sin(angle)*r),arch=new Vector3(x+Math.cos(angle)*r*.4,y+h*.98,z+Math.sin(angle)*r*.4);segment(tree,crown,arch,.035);segment(tree,arch,tip,.018);const direction=tip.subtract(crown).normalize(),rotation=Quaternion.Identity();Quaternion.FromUnitVectorsToRef(Vector3.Up(),direction,rotation);card(tree,'palm',Vector3.Lerp(crown,tip,.58),Math.max(.35,r*.42),Math.max(.8,Vector3.Distance(crown,tip)*1.15),rotation);}
   continue;
  }
  const umbrella=tree.form==='umbrella',conifer=tree.form==='conifer',crownY=y+h*(umbrella?.84:.71),stemTop=y+h*(umbrella?.8:.67);
  segment(tree,new Vector3(x,y,z),new Vector3(x+.03,stemTop,z-.02),tree.trunkDiameter);
  const clusters=conifer?15:12;
  for(let cluster=0;cluster<clusters;cluster++){
   const ring=cluster%3,angle=cluster*2.3999632297+random()*.3;
   const spread=conifer?r*(1-ring*.3):r*(.55+random()*.28),branchY=conifer?y+h*(.42+ring*.18):crownY+(random()-.5)*h*(umbrella?.13:.25);
   const end=new Vector3(x+Math.cos(angle)*spread,branchY,z+Math.sin(angle)*spread),start=new Vector3(x,Math.min(stemTop,branchY-h*.16),z),middle=Vector3.Lerp(start,end,.55);middle.y+=h*.05;
   segment(tree,start,middle,tree.trunkDiameter*(.26-ring*.04));segment(tree,middle,end,tree.trunkDiameter*.12);
   for(let leaf=0;leaf<leafCount;leaf++){
    const w=Math.max(.23,tree.crownDiameter*(.14+random()*.055)),cardHeight=w*(.8+random()*.3),p=end.add(new Vector3((random()-.5)*r*.48,(random()-.5)*h*(umbrella?.08:.16),(random()-.5)*r*.48));p.y=clamp(p.y,y+h*.3+cardHeight/2,y+h-cardHeight/2);
    const rotation=Quaternion.RotationYawPitchRoll(random()*Math.PI*2,(random()-.5)*1.9,(random()-.5)*Math.PI);card(tree,'broadleaf',p,w,cardHeight,rotation);
   }
  }
  for(let leaf=0;leaf<leafCount*2;leaf++){const w=Math.max(.25,tree.crownDiameter*.18),p=new Vector3(x+(random()-.5)*r*.8,crownY+(random()-.5)*h*(umbrella?.07:.18),z+(random()-.5)*r*.8);card(tree,'broadleaf',p,w,w,Quaternion.RotationYawPitchRoll(random()*Math.PI*2,random()*1.5,random()));}
 }
 stats.treesRendered=placements.length;stats.meshCount=batches.length;return {placements,batches,stats};
}

/** Locally generated alpha-card textures and branch geometry, not photographic tree assets. */
function leafTexture(scene:Scene,palm:boolean){
 const size=256,texture=new DynamicTexture(palm?'foglie palma originali':'foglie originali',{width:size,height:size},scene,true),context=texture.getContext(),image=context.getImageData(0,0,size,size);
 const leaves:Array<{cx:number;cy:number;angle:number;a:number;b:number;shade:number}>=[];
 if(palm){for(let i=0;i<17;i++){const t=i/17;for(const side of[-1,1])leaves.push({cx:side*(.17+.12*Math.sin(t*Math.PI)),cy:-.85+t*1.65,angle:side*(.4+t*.35),a:.34*(.35+Math.sin(t*Math.PI)*.65),b:.027,shade:i%3});}}
 else{for(let i=0;i<9;i++){const angle=i*2.399963,rad=.2+(i%3)*.16;leaves.push({cx:Math.cos(angle)*rad,cy:Math.sin(angle)*rad,angle,a:.34,b:.15,shade:i%4});}}
 for(let py=0;py<size;py++)for(let px=0;px<size;px++){
  const x=(px+.5)/size*2-1,cy=(py+.5)/size*2-1;let alpha=0,shade=0,vein=false;
  for(const leaf of leaves){const co=Math.cos(leaf.angle),si=Math.sin(leaf.angle),dx=x-leaf.cx,dy=cy-leaf.cy,u=dx*co+dy*si,v=-dx*si+dy*co,width=leaf.b*(1-(u/leaf.a)**2);if(width>0&&Math.abs(v)<width){alpha=Math.max(alpha,clamp((width-Math.abs(v))*size*.8,0,1));shade=leaf.shade;vein=Math.abs(v)<.007;}}
  const stem=palm?Math.abs(x)<.012&&Math.abs(cy)<.92:Math.abs(x*.55+cy)<.018&&Math.abs(x)<.58;if(stem){alpha=1;shade=1;}
  const index=(py*size+px)*4,grain=Math.sin(px*1.71+py*2.27)*4;
  image.data[index]=45+shade*5+grain+(vein?12:0);image.data[index+1]=76+shade*8+grain+(vein?15:0);image.data[index+2]=29+shade*3+grain;image.data[index+3]=Math.round(alpha*255);
 }
 context.putImageData(image,0,0);texture.update();texture.hasAlpha=true;texture.anisotropicFilteringLevel=4;return texture;
}
function barkTextures(scene:Scene){
 const width=128,height=256,diffuse=new DynamicTexture('corteccia originale albedo',{width,height},scene,true),normal=new DynamicTexture('corteccia originale normali',{width,height},scene,true),dc=diffuse.getContext(),nc=normal.getContext(),color=dc.getImageData(0,0,width,height),normals=nc.getImageData(0,0,width,height);
 const relief=(x:number,y:number)=>{const u=x/width*Math.PI*2,v=y/height*Math.PI*2;return Math.sin(u*13+Math.sin(v*2)*.7)*.45+Math.sin(u*29+Math.sin(v*3)*1.2)*.15+Math.sin(u*51+v*4)*.055;};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,h=relief(x,y),grain=Math.sin(x*5.31+y*2.13)*3,shade=clamp(.57+h*.48,.17,.92),nx=-(relief(x+1,y)-relief(x-1,y))*1.4,ny=-(relief(x,y+1)-relief(x,y-1))*.9,length=Math.hypot(nx,ny,1);color.data[i]=59+shade*54+grain;color.data[i+1]=48+shade*43+grain;color.data[i+2]=36+shade*33+grain;color.data[i+3]=255;normals.data[i]=(nx/length*.5+.5)*255;normals.data[i+1]=(ny/length*.5+.5)*255;normals.data[i+2]=(1/length*.5+.5)*255;normals.data[i+3]=255;}
 dc.putImageData(color,0,0);nc.putImageData(normals,0,0);for(const texture of[diffuse,normal]){texture.update();texture.anisotropicFilteringLevel=4;texture.uScale=2;texture.vScale=2;}normal.level=.45;return {diffuse,normal};
}
export function addVegetation(scene:Scene,map:MapData,data:GreenData,options:VegetationOptions={}){
 const plan=buildVegetationPlan(map,data,options),meshes:Mesh[]=[],ownedMaterials:Material[]=[],textures:DynamicTexture[]=[];
 if(!plan.placements.length)return {stats:plan.stats,placements:plan.placements,meshes,dispose(){}};
 const bark=options.materials?.bark??new StandardMaterial('corteccia originale',scene);
 if(!options.materials?.bark){const material=bark as StandardMaterial,generated=barkTextures(scene);material.diffuseColor=Color3.White();material.diffuseTexture=generated.diffuse;material.bumpTexture=generated.normal;material.specularColor.set(.035,.035,.03);textures.push(generated.diffuse,generated.normal);ownedMaterials.push(material);}
 const leaves=new Map<string,StandardMaterial>();
 for(const kind of ['broadleaf','palm'] as const){if(!plan.batches.some(b=>b.kind===kind))continue;const texture=leafTexture(scene,kind==='palm');textures.push(texture);const material=new StandardMaterial('vegetazione alpha '+kind,scene);material.diffuseTexture=texture;material.useAlphaFromDiffuseTexture=true;material.diffuseColor=Color3.White();material.specularColor.set(.025,.03,.015);material.backFaceCulling=false;material.twoSidedLighting=true;material.transparencyMode=Material.MATERIAL_ALPHATEST;material.alphaCutOff=.42;leaves.set(kind,material);ownedMaterials.push(material);}
 for(const batch of plan.batches){
  const mesh=batch.kind==='bark'?MeshBuilder.CreateCylinder('rami '+batch.key,{diameterBottom:1,diameterTop:.65,height:1,tessellation:8},scene):MeshBuilder.CreatePlane('chioma '+batch.key,{size:1},scene);
  mesh.material=batch.kind==='bark'?bark:leaves.get(batch.kind)!;mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=true;mesh.metadata={solid:false,sourceTreeNodes:true,kind:batch.kind,shape:'original procedural visual approximation'};
  mesh.thinInstanceSetBuffer('matrix',new Float32Array(batch.matrices),16,true);mesh.thinInstanceRefreshBoundingInfo(true);options.shadows?.addShadowCaster(mesh,false);meshes.push(mesh);
 }
 scene.metadata={...(scene.metadata??{}),vegetation:{...plan.stats,measuredPositions:true,measuredShapes:false}};
 return {stats:plan.stats,placements:plan.placements,meshes,dispose(){for(const mesh of meshes){options.shadows?.removeShadowCaster(mesh,false);mesh.dispose();}for(const material of ownedMaterials)material.dispose();for(const texture of textures)texture.dispose();}};
}
