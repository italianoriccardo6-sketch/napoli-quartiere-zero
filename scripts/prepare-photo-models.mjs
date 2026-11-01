import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Canvas,loadImage} from '@napi-rs/canvas';
import {MeshoptSimplifier} from 'meshoptimizer/simplifier';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine.js';
import {Scene} from '@babylonjs/core/scene.js';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode.js';
import {Vector3,Quaternion} from '@babylonjs/core/Maths/math.vector.js';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader.js';
import {registerBuiltInLoaders} from '@babylonjs/loaders/dynamic.js';
import {normalizeHumanModel} from '../src/character-model.ts';

const out='public/assets/photo-models',carFolder='public/assets/vehicles/car-concept',humanFolder='public/assets/characters/civilian';
// GLB geometry remains standard +Y-up/+Z-forward. Maps applies rotations in its
// east/north/up frame; the official native windmill example establishes this
// correction. The bridge applies it once, independently of the camera heading.
const mapsOrientation={heading:180,tilt:270,roll:0};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const multiply=(a,b)=>Array.from({length:16},(_,i)=>{const row=i%4,col=Math.floor(i/4);let n=0;for(let k=0;k<4;k++)n+=a[k*4+row]*b[col*4+k];return n;});
const transform=(m,p)=>[m[0]*p[0]+m[4]*p[1]+m[8]*p[2]+m[12],m[1]*p[0]+m[5]*p[1]+m[9]*p[2]+m[13],m[2]*p[0]+m[6]*p[1]+m[10]*p[2]+m[14]];
function localMatrix(node){
  if(node.matrix)return node.matrix;
  const [x,y,z,w]=node.rotation??[0,0,0,1],s=node.scale??[1,1,1],t=node.translation??[0,0,0];
  return[(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,(2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,(2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,...t,1];
}
function matrices(g){const result=new Map();function visit(id,parent){const m=multiply(parent,localMatrix(g.nodes[id]));result.set(id,m);for(const child of g.nodes[id].children??[])visit(child,m);}for(const id of g.scenes[g.scene??0].nodes)visit(id,identity());return result;}
const components={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16},sizes={5121:1,5123:2,5125:4,5126:4};
function values(g,bin,index){
  const a=g.accessors[index],view=g.bufferViews[a.bufferView],count=components[a.type],size=sizes[a.componentType],stride=view.byteStride??count*size,offset=(view.byteOffset??0)+(a.byteOffset??0),rows=[];
  if(a.sparse||!size||!count)throw Error('Unsupported source accessor.');
  for(let i=0;i<a.count;i++){const row=[];for(let c=0;c<count;c++){const at=offset+i*stride+c*size;let v=a.componentType===5126?bin.readFloatLE(at):a.componentType===5125?bin.readUInt32LE(at):a.componentType===5123?bin.readUInt16LE(at):bin.readUInt8(at);if(a.normalized&&a.componentType!==5126)v/=a.componentType===5121?255:65535;if(!Number.isFinite(v))throw Error('Nonfinite source geometry.');row.push(v);}rows.push(row);}return rows;
}
function append(g,parts,data,target){const length=parts.reduce((n,b)=>n+b.length,0),padding=(4-length%4)%4;if(padding)parts.push(Buffer.alloc(padding));const view=g.bufferViews.length;g.bufferViews.push({buffer:0,byteOffset:length+padding,byteLength:data.length,...(target?{target}:{})});parts.push(data);return view;}
function floatAccessor(g,parts,rows,type){const array=new Float32Array(rows.flat()),view=append(g,parts,Buffer.from(array.buffer),34962),n=components[type],min=Array(n).fill(Infinity),max=Array(n).fill(-Infinity);for(const row of rows)row.forEach((v,i)=>{min[i]=Math.min(min[i],v);max[i]=Math.max(max[i],v);});const index=g.accessors.length;g.accessors.push({bufferView:view,componentType:5126,count:rows.length,type,min,max});return index;}
function recursiveNoExtensions(value){if(!value||typeof value!=='object')return;delete value.extensions;for(const child of Object.values(value))recursiveNoExtensions(child);}
function glb(g,bin){
  delete g.extensionsUsed;delete g.extensionsRequired;recursiveNoExtensions(g);for(const key of ['images','textures','samplers','animations','skins'])if(Array.isArray(g[key])&&!g[key].length)delete g[key];g.buffers=[{byteLength:bin.length}];
  const json=Buffer.from(JSON.stringify(g)),jp=(4-json.length%4)%4,bp=(4-bin.length%4)%4,length=12+8+json.length+jp+8+bin.length+bp,buffer=Buffer.alloc(length);buffer.writeUInt32LE(0x46546c67,0);buffer.writeUInt32LE(2,4);buffer.writeUInt32LE(length,8);buffer.writeUInt32LE(json.length+jp,12);buffer.writeUInt32LE(0x4e4f534a,16);json.copy(buffer,20);buffer.fill(32,20+json.length,20+json.length+jp);const at=20+json.length+jp;buffer.writeUInt32LE(bin.length+bp,at);buffer.writeUInt32LE(0x004e4942,at+4);bin.copy(buffer,at+8);return buffer;
}
function compact(g,bin){
  const usedMeshes=new Set(g.nodes.map(n=>n.mesh).filter(Number.isInteger));const meshIds=[...usedMeshes].sort((a,b)=>a-b),meshMap=new Map(meshIds.map((id,i)=>[id,i]));g.meshes=meshIds.map(id=>g.meshes[id]);for(const node of g.nodes)if(node.mesh!==undefined)node.mesh=meshMap.get(node.mesh);
  const materials=[...new Set(g.meshes.flatMap(m=>m.primitives.map(p=>p.material)).filter(Number.isInteger))].sort((a,b)=>a-b),materialMap=new Map(materials.map((id,i)=>[id,i]));g.materials=materials.map(id=>g.materials[id]);for(const mesh of g.meshes)for(const primitive of mesh.primitives)if(primitive.material!==undefined)primitive.material=materialMap.get(primitive.material);
  const usedAccessors=new Set(g.meshes.flatMap(m=>m.primitives.flatMap(p=>[...Object.values(p.attributes),p.indices,...(p.targets??[]).flatMap(t=>Object.values(t))])).filter(Number.isInteger));for(const animation of g.animations??[])for(const sampler of animation.samplers){usedAccessors.add(sampler.input);usedAccessors.add(sampler.output);}for(const skin of g.skins??[])if(skin.inverseBindMatrices!==undefined)usedAccessors.add(skin.inverseBindMatrices);
  const accessorIds=[...usedAccessors].sort((a,b)=>a-b),accessorMap=new Map(accessorIds.map((id,i)=>[id,i]));g.accessors=accessorIds.map(id=>g.accessors[id]);for(const mesh of g.meshes)for(const primitive of mesh.primitives){for(const key of Object.keys(primitive.attributes))primitive.attributes[key]=accessorMap.get(primitive.attributes[key]);if(primitive.indices!==undefined)primitive.indices=accessorMap.get(primitive.indices);for(const target of primitive.targets??[])for(const key of Object.keys(target))target[key]=accessorMap.get(target[key]);}for(const animation of g.animations??[])for(const sampler of animation.samplers){sampler.input=accessorMap.get(sampler.input);sampler.output=accessorMap.get(sampler.output);}for(const skin of g.skins??[])if(skin.inverseBindMatrices!==undefined)skin.inverseBindMatrices=accessorMap.get(skin.inverseBindMatrices);
  const views=[...new Set([...g.accessors.map(a=>a.bufferView),...(g.images??[]).map(i=>i.bufferView)].filter(Number.isInteger))].sort((a,b)=>a-b),viewMap=new Map(),parts=[],oldViews=g.bufferViews;g.bufferViews=[];
  for(const id of views){const view=oldViews[id],copied=append(g,parts,bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength),view.target);Object.assign(g.bufferViews[copied],{...(view.byteStride?{byteStride:view.byteStride}:{})});viewMap.set(id,copied);}
  for(const a of g.accessors)if(a.bufferView!==undefined)a.bufferView=viewMap.get(a.bufferView);for(const image of g.images??[])if(image.bufferView!==undefined)image.bufferView=viewMap.get(image.bufferView);return Buffer.concat(parts);
}
function textureInfos(material){const output=[];for(const key of ['normalTexture','occlusionTexture','emissiveTexture'])if(material[key])output.push(material[key]);for(const key of ['baseColorTexture','metallicRoughnessTexture'])if(material.pbrMetallicRoughness?.[key])output.push(material.pbrMetallicRoughness[key]);return output;}
function uvSpec(info){const t=info.extensions?.KHR_texture_transform??{};return{coordinate:t.texCoord??info.texCoord??0,scale:t.scale??[1,1],offset:t.offset??[0,0],rotation:t.rotation??0};}
function uvRows(rows,t){const c=Math.cos(t.rotation),s=Math.sin(t.rotation);return rows.map(([u,v])=>[t.offset[0]+c*t.scale[0]*u-s*t.scale[1]*v,t.offset[1]+s*t.scale[0]*u+c*t.scale[1]*v]);}
async function simplifyCar(g,parts){
  await MeshoptSimplifier.ready;
  const bin=Buffer.concat(parts),active=new Set(g.nodes.map(node=>node.mesh).filter(Number.isInteger)),world=matrices(g),instances=new Map();
  for(const [node,matrix]of world){const mesh=g.nodes[node].mesh;if(mesh!==undefined){if(!instances.has(mesh))instances.set(mesh,[]);instances.get(mesh).push(matrix);}}
  let sourceTriangles=0,triangles=0,maxRelativeError=0;
  for(const id of active)for(const primitive of g.meshes[id].primitives){
    if((primitive.mode??4)!==4||primitive.targets)throw Error('Unsupported car topology.');
    const names=Object.keys(primitive.attributes).filter(name=>name!=='TANGENT'),types=new Map(names.map(name=>[name,g.accessors[primitive.attributes[name]].type])),streams=new Map(names.map(name=>[name,values(g,bin,primitive.attributes[name])])),positions=streams.get('POSITION'),indices=new Uint32Array(primitive.indices===undefined?positions.map((_,index)=>index):values(g,bin,primitive.indices).flat());
    sourceTriangles+=indices.length/3;
    const positionData=new Float32Array(positions.flat()),attributeNames=names.filter(name=>name!=='POSITION'),attributeWeights=[],attributeRows=positions.map(()=>[]),lock=new Uint8Array(positions.length);
    // Retain original extrema so simplification cannot move the measured body
    // dimensions, road contact or wheel alignment. Material primitives remain separate.
    for(const matrix of instances.get(id)){
      const transformed=positions.map(position=>transform(matrix,position));
      for(let axis=0;axis<3;axis++){let low=indices[0],high=low;for(const index of indices){if(transformed[index][axis]<transformed[low][axis])low=index;if(transformed[index][axis]>transformed[high][axis])high=index;}lock[low]=lock[high]=1;}
    }
    for(const name of attributeNames){const rows=streams.get(name),count=rows[0].length;let weight=.2;if(name.startsWith('TEXCOORD_')){let extent=1;for(let axis=0;axis<count;axis++){let low=Infinity,high=-Infinity;for(const row of rows){low=Math.min(low,row[axis]);high=Math.max(high,row[axis]);}extent=Math.max(extent,high-low);}weight=.05/extent;}attributeWeights.push(...Array(count).fill(weight));for(let i=0;i<rows.length;i++)attributeRows[i].push(...rows[i]);}
    const target=Math.max(12,Math.floor(indices.length*.3/3)*3),[reduced,error]=indices.length>target?MeshoptSimplifier.simplifyWithAttributes(indices,positionData,3,new Float32Array(attributeRows.flat()),attributeWeights.length,attributeWeights,lock,target,.015,['Permissive','PreserveFolds']):[indices,0];
    maxRelativeError=Math.max(maxRelativeError,error);triangles+=reduced.length/3;
    const used=[...new Set(reduced)],remap=new Map(used.map((index,mapped)=>[index,mapped]));
    primitive.attributes={};for(const name of names)primitive.attributes[name]=floatAccessor(g,parts,used.map(index=>streams.get(name)[index]),types.get(name));
    const IndexArray=used.length<=65535?Uint16Array:Uint32Array,indexData=new IndexArray(Array.from(reduced,index=>remap.get(index))),view=append(g,parts,Buffer.from(indexData.buffer),34963);primitive.indices=g.accessors.length;g.accessors.push({bufferView:view,componentType:IndexArray===Uint16Array?5123:5125,count:reduced.length,type:'SCALAR'});
  }
  return{tool:'meshoptimizer',version:'1.3.0',sourceTriangles,triangles,targetTriangleRatio:.3,maximumRelativeSimplificationError:.015,achievedMaximumRelativeError:maxRelativeError,retained:'Original vertex positions, normals, UV streams, primitive/material assignments, per-primitive extrema and node transforms',runtimeCompression:false};
}
async function car(){
  const original=await readFile(`${carFolder}/CarConcept.gltf`),g=JSON.parse(original.toString('utf8')),source=await readFile(`${carFolder}/${g.buffers[0].uri}`),parts=[source],variant=g.extensions.KHR_materials_variants.variants.findIndex(v=>v.name==='Pearly Swirly');
  if(variant<0||g.buffers.length!==1||g.skins?.length)throw Error('Unsupported car source layout.');
  for(const mesh of g.meshes)for(const primitive of mesh.primitives){for(const mapping of primitive.extensions?.KHR_materials_variants?.mappings??[])if(mapping.variants.includes(variant))primitive.material=mapping.material;delete primitive.extensions;}
  for(const node of g.nodes)if(node.name==='License Plate')delete node.mesh;
  const materialGroups=new Map();
  for(const [id,material]of g.materials.entries()){
    const strength=material.extensions?.KHR_materials_emissive_strength?.emissiveStrength??1;if(material.emissiveFactor)material.emissiveFactor=material.emissiveFactor.map(v=>Math.min(1,v*strength));
    if(material.name==='Glass'){material.pbrMetallicRoughness={baseColorFactor:[.28,.38,.43,.28],metallicFactor:0,roughnessFactor:.08};material.alphaMode='BLEND';material.doubleSided=true;}
    if(material.name==='Paint 1 Pearl'){material.pbrMetallicRoughness??={};Object.assign(material.pbrMetallicRoughness,{baseColorFactor:[231,229,222].map(c=>Math.pow((c/255+.055)/1.055,2.4)).concat(1),metallicFactor:.08,roughnessFactor:.28});}
    const groups=[];for(const info of textureInfos(material)){const spec=uvSpec(info),signature=JSON.stringify(spec);let index=groups.findIndex(g=>g.signature===signature);if(index<0){index=groups.length;groups.push({signature,spec});}if(index>1)throw Error('More than two required UV streams.');info.texCoord=index;delete info.extensions;}
    materialGroups.set(id,groups);delete material.extensions;
  }
  for(const mesh of g.meshes)for(const primitive of mesh.primitives){const old={...primitive.attributes};for(const key of Object.keys(primitive.attributes))if(key.startsWith('TEXCOORD_'))delete primitive.attributes[key];for(const [index,group]of(materialGroups.get(primitive.material)??[]).entries()){const accessor=old['TEXCOORD_'+group.spec.coordinate];if(accessor===undefined)throw Error('Source UV stream absent.');primitive.attributes['TEXCOORD_'+index]=floatAccessor(g,parts,uvRows(values(g,source,accessor),group.spec),'VEC2');}}
  const activeMeshes=new Set(g.nodes.map(node=>node.mesh).filter(Number.isInteger)),activeMaterials=new Set([...activeMeshes].flatMap(id=>g.meshes[id].primitives.map(p=>p.material)));
  const usedTextures=[...new Set(g.materials.filter((_,i)=>activeMaterials.has(i)).flatMap(m=>textureInfos(m).map(i=>i.index)))].sort((a,b)=>a-b),textureMap=new Map(usedTextures.map((id,i)=>[id,i])),images=[],textures=[],converted=[];
  for(const id of usedTextures){const texture=g.textures[id],image=g.images[texture.extensions?.EXT_texture_webp?.source??texture.source],bytes=await readFile(`${carFolder}/${image.uri}`),decoded=await loadImage(bytes),factor=Math.min(1,1024/Math.max(decoded.width,decoded.height)),width=Math.max(1,Math.round(decoded.width*factor)),height=Math.max(1,Math.round(decoded.height*factor)),canvas=new Canvas(width,height);canvas.getContext('2d').drawImage(decoded,0,0,width,height);const png=canvas.toBuffer('image/png'),view=append(g,parts,png);textures.push({source:images.length,...(texture.sampler!==undefined?{sampler:texture.sampler}:{})});images.push({bufferView:view,mimeType:'image/png',name:image.uri.replace(/\.webp$/i,'.png')});converted.push({source:image.uri,sourceSHA256:hash(bytes),pngSHA256:hash(png),sourceWidth:decoded.width,sourceHeight:decoded.height,width,height,resampled:factor<1});}
  for(const material of g.materials)for(const info of textureInfos(material))info.index=textureMap.get(info.index);g.images=images;g.textures=textures;
  const world=matrices(g),find=name=>{const id=g.nodes.findIndex(n=>n.name===name);if(id<0)throw Error('Missing wheel node.');return transform(world.get(id),[0,0,0]);},front=[find('WheelFrontL'),find('WheelFrontR')],rear=[find('WheelRearL'),find('WheelRearR')];
  const axis=[(front[0][0]+front[1][0]-rear[0][0]-rear[1][0])/2,0,(front[0][2]+front[1][2]-rear[0][2]-rear[1][2])/2],yaw=-Math.atan2(axis[0],axis[2]),rotation=[Math.cos(yaw),0,-Math.sin(yaw),0,0,1,0,0,Math.sin(yaw),0,Math.cos(yaw),0,0,0,0,1],min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const [id,matrix]of world){const node=g.nodes[id];if(node.mesh===undefined)continue;const combined=multiply(rotation,matrix);for(const primitive of g.meshes[node.mesh].primitives)for(const point of values(g,source,primitive.attributes.POSITION)){const p=transform(combined,point);p.forEach((v,i)=>{min[i]=Math.min(min[i],v);max[i]=Math.max(max[i],v);});}}
  const scale=4.4/(max[2]-min[2]),normal=rotation.map((v,i)=>i%4===3?v:v*scale);normal[15]=1;normal[12]=-(min[0]+max[0])/2*scale;normal[13]=-min[1]*scale;normal[14]=-(min[2]+max[2])/2*scale;
  const roots=g.scenes[g.scene??0].nodes;g.nodes.push({name:'Photo car · metres · front +Z',matrix:normal,children:roots});g.scenes=[{nodes:[g.nodes.length-1]}];g.scene=0;g.asset={...g.asset,generator:'Napoli prepare-photo-models.mjs (core glTF adaptation)',copyright:'© 2024 Darmstadt Graphics Group GmbH; model/textures Eric Chadwick, CC BY 4.0; adapted by Napoli Quartiere Zero'};
  const optimization=await simplifyCar(g,parts),bin=compact(g,Buffer.concat(parts)),output=glb(g,bin),file='car-white-core.glb';await writeFile(`${out}/${file}`,output);
  const normalizedFront=front.map(p=>transform(normal,p)),normalizedRear=rear.map(p=>transform(normal,p));
  return{file,path:`assets/photo-models/${file}`,license:'CC-BY-4.0',bytes:output.length,sha256:hash(output),dimensions:{width:(max[0]-min[0])*scale,height:(max[1]-min[1])*scale,length:4.4},upAxis:'+Y',forwardAxis:'+Z',groundY:0,scale:1,orientationOffset:mapsOrientation,normalizedWheelCenters:{front:normalizedFront,rear:normalizedRear},materialVariant:'Pearly Swirly',changes:['Original material variant baked; primary body adjusted to artistic white','KHR texture transforms baked to ordinary UV accessors','WebP source images decoded to embedded PNG and resampled to at most 1024px on the longest edge; depicted texture content retained at reduced detail','Clearcoat/iridescence removed; transmission approximated with core alpha blending; emissive strength clamped to core range','Trademark license plate node removed from rendering; original source bytes unchanged','Uniform metre normalization from actual wheel axis and transformed geometry','Offline attribute-aware mesh simplification retains original vertex attributes and extrema; unreferenced vertices removed; explicit tangents omitted so core-glTF viewers derive normal-map tangents'],optimization,convertedTextures:converted,triangles:optimization.triangles};
}
async function civilian(){
  const bytes=await readFile(`${humanFolder}/civilian.glb`),jsonSize=bytes.readUInt32LE(12),source=JSON.parse(bytes.subarray(20,20+jsonSize).toString('utf8')),binStart=20+jsonSize+8,sourceBin=bytes.subarray(binStart,binStart+bytes.readUInt32LE(20+jsonSize));
  const engine=new NullEngine({renderWidth:1,renderHeight:1,textureSize:16,deterministicLockstep:true,lockstepMaxSteps:1}),scene=new Scene(engine);
  try{
    registerBuiltInLoaders();const result=await ImportMeshAsync(new Uint8Array(bytes),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true,animationStartMode:0}}}),nodes=[...result.meshes,...result.transformNodes],owned=new Set(nodes),pivot=new TransformNode('baked civilian',scene);
    for(const node of nodes)if(!node.parent||!owned.has(node.parent))node.parent=pivot;
    const canonical=name=>name.replace(/^mixamorig[:_]?/i,'').replace(/[^a-z0-9]/gi,'').toLowerCase(),find=name=>{const node=nodes.find(n=>canonical(n.name)===name);if(!node)throw Error('Missing source human joint.');return node;};
    normalizeHumanModel(pivot,[find('leftfoot'),find('rightfoot')],[find('lefttoebase'),find('righttoebase')]);
    const walk=result.animationGroups.find(g=>/walk/i.test(g.name));if(!walk)throw Error('Missing source walking pose.');
    for(const {target,animation}of walk.targetedAnimations)if(/shoulder|arm|hand/i.test(target.name??'')&&animation.targetProperty==='rotationQuaternion')target.rotationQuaternion=Quaternion.Slerp(animation.evaluate(walk.from+(walk.to-walk.from)*.25),animation.evaluate(walk.from+(walk.to-walk.from)*.75),.5);
    pivot.computeWorldMatrix(true);for(const node of pivot.getDescendants(false))node.computeWorldMatrix(true);for(const skeleton of result.skeletons)skeleton.prepare(true);
    const g={asset:{version:'2.0',generator:'Napoli prepare-photo-models.mjs · static posed core civilian',copyright:'Vibeassets / Meshy civilian, CC0; standing pose and metre normalization adapted by Napoli Quartiere Zero'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Civilian standing · metres · front +Z',mesh:0}],meshes:[{primitives:[]}],accessors:[],bufferViews:[],materials:clone(source.materials??[]),textures:clone(source.textures??[]),samplers:clone(source.samplers??[]),images:[]},parts=[];
    const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
    for(const mesh of result.meshes.filter(m=>m.getTotalVertices()>0)){
      const positions=mesh.getPositionData(true,true),normals=mesh.getNormalsData(true,true),uvs=mesh.getVerticesData('uv'),matrix=mesh.computeWorldMatrix(true),rows=[],normalRows=[],uvRows=[];
      for(let i=0;i<positions.length;i+=3){const p=Vector3.TransformCoordinates(new Vector3(positions[i],positions[i+1],positions[i+2]),matrix),n=Vector3.TransformNormal(new Vector3(normals[i],normals[i+1],normals[i+2]),matrix).normalize(),row=[-p.x,p.y,p.z];rows.push(row);normalRows.push([-n.x,n.y,n.z]);uvRows.push([uvs[i/3*2],uvs[i/3*2+1]]);row.forEach((v,k)=>{min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);});}
      const indices=Array.from(mesh.getIndices());for(let i=0;i<indices.length;i+=3)[indices[i+1],indices[i+2]]=[indices[i+2],indices[i+1]];
      const indexData=new Uint32Array(indices),indexView=append(g,parts,Buffer.from(indexData.buffer),34963),index=g.accessors.length;g.accessors.push({bufferView:indexView,componentType:5125,count:indices.length,type:'SCALAR'});
      g.meshes[0].primitives.push({attributes:{POSITION:floatAccessor(g,parts,rows,'VEC3'),NORMAL:floatAccessor(g,parts,normalRows,'VEC3'),TEXCOORD_0:floatAccessor(g,parts,uvRows,'VEC2')},indices:index,material:0,mode:4});
    }
    for(const image of source.images??[]){if(image.uri)throw Error('Civilian image not embedded.');const view=source.bufferViews[image.bufferView],imageBytes=sourceBin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength);g.images.push({bufferView:append(g,parts,imageBytes),mimeType:image.mimeType});}
    const output=glb(g,Buffer.concat(parts)),file='civilian-standing-core.glb';await writeFile(`${out}/${file}`,output);
    return{rightArmPose:{elbow:(()=>{const p=find('rightforearm').getAbsolutePosition();return[-p.x,p.y,p.z];})(),wrist:(()=>{const p=find('righthand').getAbsolutePosition();return[-p.x,p.y,p.z];})()},file,path:`assets/photo-models/${file}`,license:'CC0-1.0',bytes:output.length,sha256:hash(output),dimensions:{width:max[0]-min[0],height:max[1]-min[1],depth:max[2]-min[2]},upAxis:'+Y',forwardAxis:'+Z',groundY:min[1],scale:1,orientationOffset:mapsOrientation,changes:['Source skinned rest legs and averaged authored walk arm rotations baked offline into ordinary static geometry','Uniform 1.8 m height, feet centred at ground, forward +Z','Right-handed GLB output reflects the Babylon normalized pose along X and reverses triangle winding','No runtime skeleton or animation; this is a standing model translated by the game controller, not a walking animation','Original source JPG and source material preserved; source asset bytes unchanged']};
  }finally{scene.dispose();engine.dispose();}
}
function parseBinaryGLB(bytes){const length=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+length).toString('utf8')),at=20+length;return{json,bin:bytes.subarray(at+8,at+8+bytes.readUInt32LE(at))};}
async function hand(civilianRecord){
  const sourceBytes=await readFile(`${humanFolder}/civilian.glb`),source=parseBinaryGLB(sourceBytes),body=parseBinaryGLB(await readFile(`${out}/civilian-standing-core.glb`));
  if(source.json.meshes.length!==1||source.json.meshes[0].primitives.length!==1||body.json.meshes[0].primitives.length!==1)throw Error('Unexpected human geometry layout.');
  const sourcePrimitive=source.json.meshes[0].primitives[0],skin=source.json.skins[0],selectedJointIds=new Set(skin.joints.map((node,i)=>['RightHand','RightForeArm'].includes(source.json.nodes[node].name)?i:-1).filter(i=>i>=0));
  if(selectedJointIds.size!==2)throw Error('Missing source hand/forearm joints.');
  const joints=values(source.json,source.bin,sourcePrimitive.attributes.JOINTS_0),weights=values(source.json,source.bin,sourcePrimitive.attributes.WEIGHTS_0),primitive=body.json.meshes[0].primitives[0];
  const positions=values(body.json,body.bin,primitive.attributes.POSITION),normals=values(body.json,body.bin,primitive.attributes.NORMAL),uvs=values(body.json,body.bin,primitive.attributes.TEXCOORD_0),indices=values(body.json,body.bin,primitive.indices).flat();
  if(positions.length!==joints.length||positions.length!==weights.length)throw Error('Baked and source vertices differ.');
  const membership=joints.map((row,index)=>row.reduce((sum,joint,c)=>sum+(selectedJointIds.has(joint)?weights[index][c]:0),0)>=.5),selected=[];
  for(let i=0;i<indices.length;i+=3)if(indices.slice(i,i+3).every(index=>membership[index]))selected.push(indices.slice(i,i+3));
  if(selected.length<100||selected.length>indices.length/6)throw Error('Unexpected hand selection size.');
  const elbow=civilianRecord.rightArmPose.elbow,wrist=civilianRecord.rightArmPose.wrist,normalize=v=>{const length=Math.hypot(...v);if(length<1e-8)throw Error('Invalid source arm axis.');return v.map(n=>n/length);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((n,v,i)=>n+v*b[i],0),z=normalize(wrist.map((v,i)=>v-elbow[i])),up=Math.abs(z[1])>.98?[0,0,1]:[0,1,0],x=normalize(cross(up,z)),y=normalize(cross(z,x));
  const ids=[...new Set(selected.flat())],remap=new Map(ids.map((id,index)=>[id,index])),rows=ids.map(id=>{const p=positions[id].map((v,i)=>v-wrist[i]);return[dot(p,x),dot(p,y),dot(p,z)];}),normalRows=ids.map(id=>[dot(normals[id],x),dot(normals[id],y),dot(normals[id],z)]),min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const row of rows)row.forEach((v,i)=>{min[i]=Math.min(min[i],v);max[i]=Math.max(max[i],v);});
  const g={asset:{version:'2.0',generator:'Napoli prepare-photo-models.mjs · source-weighted actual hand excerpt',copyright:'Vibeassets / Meshy civilian, CC0; skin-weight selection and wrist normalization adapted by Napoli Quartiere Zero'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'Actual source right hand and forearm · origin wrist · forward +Z',mesh:0}],meshes:[{primitives:[]}],accessors:[],bufferViews:[],materials:clone(body.json.materials),textures:clone(body.json.textures),samplers:clone(body.json.samplers??[]),images:[]},parts=[];
  const indexData=new Uint32Array(selected.flatMap(triangle=>triangle.map(id=>remap.get(id)))),indexView=append(g,parts,Buffer.from(indexData.buffer),34963),index=g.accessors.length;g.accessors.push({bufferView:indexView,componentType:5125,count:indexData.length,type:'SCALAR'});
  g.meshes[0].primitives.push({attributes:{POSITION:floatAccessor(g,parts,rows,'VEC3'),NORMAL:floatAccessor(g,parts,normalRows,'VEC3'),TEXCOORD_0:floatAccessor(g,parts,ids.map(id=>uvs[id]),'VEC2')},indices:index,material:0,mode:4});
  for(const image of body.json.images){const view=body.json.bufferViews[image.bufferView];g.images.push({bufferView:append(g,parts,body.bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength)),mimeType:image.mimeType});}
  const output=glb(g,Buffer.concat(parts)),file='hand-core.glb';await writeFile(`${out}/${file}`,output);
  return{file,path:`assets/photo-models/${file}`,license:'CC0-1.0',bytes:output.length,sha256:hash(output),dimensions:{width:max[0]-min[0],height:max[1]-min[1],depth:max[2]-min[2]},bounds:{min,max},origin:'Measured source RightHand wrist pivot',wrist:[0,0,0],sourceSelectedJoints:['RightForeArm','RightHand'],selectionMinimumCombinedWeight:.5,selectedSourceVertices:ids.length,triangles:selected.length,upAxis:'+Y',forwardAxis:'+Z',groundY:min[1],scale:1,orientationOffset:mapsOrientation,changes:['Selected actual triangles whose vertices have combined source RightForeArm/RightHand skin weight at least0.5','Reused the actual baked civilian pose, original UVs and original embedded source JPG; no synthetic hand geometry or substituted texture','Origin is measured wrist; forearm extends behind wrist along -Z, hand points forward along +Z','A static hand/forearm excerpt, with an open cut at the rear sleeve; no closed fist or finger articulation is claimed','Whole-model translation/rotation may animate a first-person strike; no runtime skeletal or Google mesh extraction']};
}
async function originalMarker(kind){
  const g={asset:{version:'2.0',generator:'Napoli prepare-photo-models.mjs · original geometric game marker',copyright:'Original Napoli Quartiere Zero geometry, MIT'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:kind,mesh:0}],meshes:[{primitives:[]}],accessors:[],bufferViews:[],materials:[]},parts=[];
  function emit(triangles,material){
    const positions=[],normals=[];
    for(const [a,b,c]of triangles){const ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]),n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],length=Math.hypot(...n);if(length<1e-9)throw Error('Degenerate marker face.');for(const p of[a,b,c]){positions.push(p);normals.push(n.map(v=>v/length));}}
    const materialIndex=g.materials.length;g.materials.push(material);g.meshes[0].primitives.push({attributes:{POSITION:floatAccessor(g,parts,positions,'VEC3'),NORMAL:floatAccessor(g,parts,normals,'VEC3')},material:materialIndex,mode:4});
  }
  if(kind==='patrol-beacon'){
    for(const [x,width,color]of [[-.225,.35,[.02,.14,.9]],[0,.1,[.9,.93,1]],[.225,.35,[.02,.14,.9]]]){
      const x0=x-width/2,x1=x+width/2,y0=0,y1=.12,z0=-.125,z1=.125,p=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],faces=[[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[0,1,5,4],[3,7,6,2]],triangles=[];
      for(const [a,b,c,d]of faces)triangles.push([p[a],p[b],p[c]],[p[a],p[c],p[d]]);
      emit(triangles,{name:'Original fictional patrol light',pbrMetallicRoughness:{baseColorFactor:[...color,1],metallicFactor:0,roughnessFactor:.3},emissiveFactor:color});
    }
  }else{
    const triangles=[],count=16;for(let i=0;i<count;i++){const angle=i/count*Math.PI*2,next=(i+1)/count*Math.PI*2,a=[Math.cos(angle)*.3,0,Math.sin(angle)*.3],b=[Math.cos(next)*.3,0,Math.sin(next)*.3];triangles.push([a,[0,1.2,0],b],[[0,0,0],a,b]);}
    emit(triangles,{name:'Original gold quest marker',pbrMetallicRoughness:{baseColorFactor:[.8,.5,.1,1],metallicFactor:.15,roughnessFactor:.5},emissiveFactor:[.25,.12,.01]});
  }
  const file=kind+'-core.glb',output=glb(g,Buffer.concat(parts));await writeFile(`${out}/${file}`,output);
  return{file,path:`assets/photo-models/${file}`,license:'MIT',bytes:output.length,sha256:hash(output),dimensions:kind==='patrol-beacon'?{width:.8,height:.12,depth:.25}:{width:.6,height:1.2,depth:.6},upAxis:'+Y',forwardAxis:'+Z',groundY:0,scale:1,orientationOffset:mapsOrientation,triangles:g.meshes[0].primitives.reduce((n,p)=>n+g.accessors[p.attributes.POSITION].count/3,0),changes:[kind==='patrol-beacon'?'Original static blue/white roof-light geometry for a fictional patrol; no flashing or real-police identity claim':'Original gold geometric objective marker; no geographic structure or measured position claim']};
}
await mkdir(out,{recursive:true});
const carManifest=JSON.parse(await readFile(`${carFolder}/source-manifest.json`,'utf8')),humanManifest=JSON.parse(await readFile(`${humanFolder}/source-manifest.json`,'utf8'));
for(const file of carManifest.files){const bytes=await readFile(`${carFolder}/${file.path}`);if(hash(bytes)!==file.sha256)throw Error('Source changed: '+file.path);}
const civilianRecord=await civilian();
const outputs=[await car(),civilianRecord,await originalMarker('patrol-beacon'),await originalMarker('mission-marker'),await hand(civilianRecord)];
for(const [from,to]of [[`${carFolder}/LICENSE-CC-BY-4.0.txt`,'LICENSE-car-CC-BY-4.0.txt'],[`${carFolder}/LicenseRef-LegalMark-Khronos.txt`,'LicenseRef-LegalMark-Khronos.txt'],[`${humanFolder}/ATTRIBUTION.md`,'ATTRIBUTION-civilian.md'],[`${humanFolder}/LICENSE-CC0-1.0.html.txt`,'LICENSE-civilian-CC0-1.0.html.txt'],['LICENSE','LICENSE-markers-MIT.txt']])await copyFile(from,`${out}/${to}`);
await writeFile(`${out}/manifest.json`,JSON.stringify({version:1,format:'glTF-2.0-binary-core-no-extensions',generatedBy:'scripts/prepare-photo-models.mjs',runtimeConversion:false,googleImageryIncluded:false,coordinateConvention:'right-handed glTF, metres, +Y up, +Z physical forward; native Maps ENU convention uses heading+180deg, tilt270deg, roll0deg, derived from the documented rotation frame and official windmill sample; live visual alignment still requires SDK verification',sources:[{path:'assets/vehicles/car-concept/CarConcept.gltf',sha256:carManifest.files.find(f=>f.path==='CarConcept.gltf').sha256,revision:carManifest.revision,license:'CC-BY-4.0',author:carManifest.author,copyright:carManifest.copyright},{path:'assets/characters/civilian/civilian.glb',sha256:hash(await readFile(`${humanFolder}/civilian.glb`)),license:'CC0-1.0',source:humanManifest.source}],outputs,limitations:'Core-PBR adaptation is lossy. Google Maps live rendering, model axis mapping, transparent glass and fit against its archived photographic surfaces require native SDK verification; no visual equivalence or photogrammetric vehicle/character claim.'},null,2)+'\n');
await writeFile(`${out}/ATTRIBUTION.txt`,'CarConcept © 2024 Darmstadt Graphics Group GmbH. Model and textures by Eric Chadwick, distributed by Khronos glTF Sample Assets under CC BY 4.0. Source revision 8f492390ddc7a2ae221a1369ef560589cf8c70fb.\nDerivative car: baked Pearly Swirly variant, white artistic paint, embedded PNGs and baked UV transforms, core-PBR approximations, ground/metre/forward-axis normalization, trademark license plate omitted from rendered graph. Offline meshoptimizer1.3.0 simplification retains original selected vertex attributes and locked extrema; textures resampled to at most1024px and embedded as PNG; explicit tangents omitted for core viewer derivation. See manifest.json and LICENSE-car-CC-BY-4.0.txt.\nCivilian and first-person hand: Vibeassets / Meshy, CC0 1.0. Static posed geometry baked and normalized from the installed model; the actual right hand/forearm is selected by original skin weights, preserving UVs and source JPG. See ATTRIBUTION-civilian.md and LICENSE-civilian-CC0-1.0.html.txt.\nRoof lights and gold mission marker are original simple geometry under the project MIT license; see LICENSE-markers-MIT.txt.\nThese GLBs contain original licensed models only; no Google imagery, mesh or other Google content is included.\n');
console.log(JSON.stringify(outputs.map(({file,bytes,dimensions,triangles})=>({file,bytes,dimensions,triangles})),null,2));
