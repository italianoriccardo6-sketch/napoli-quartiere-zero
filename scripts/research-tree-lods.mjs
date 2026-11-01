import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Research artifact only: no runtime files, image edits, compressed geometry or
// external decoders. Official APIs checked at glTF-Transform4.5.1/meshoptimizer1.3.
const out='work/tree-lod-research/output',raw='work/tree-lod-research/input';
const userAgent='NapoliQuartiereZero/0.5 (https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero)';
const maxInput=300*1024*1024,maxRuntime=20*1024*1024,maxMesh=25*1024*1024;
const binBytes=95102324,binMD5='7a7019a87e6fe0d7475c0fa2e08d8962';
const toolRoot=resolve(process.env.TREE_LOD_TOOLS??'work/tree-lod-tools'),require=createRequire(toolRoot+'/package.json');
const {Document,NodeIO}=await import(pathToFileURL(require.resolve('@gltf-transform/core')).href);
const {weld}=await import(pathToFileURL(require.resolve('@gltf-transform/functions')).href);
const {MeshoptSimplifier}=await import(pathToFileURL(require.resolve('meshoptimizer')).href);
const versions={};
for(const [name,expected]of [['@gltf-transform/core','4.5.1'],['@gltf-transform/functions','4.5.1'],['meshoptimizer','1.3.0']]){
  versions[name]=JSON.parse(await readFile(toolRoot+'/node_modules/'+name+'/package.json','utf8')).version;
  if(versions[name]!==expected)throw Error('Unexpected tool version: '+name);
}
const hash=(kind,data)=>createHash(kind).update(data).digest('hex');
await MeshoptSimplifier.ready;if(!MeshoptSimplifier.supported)throw Error('Offline simplifier WebAssembly unsupported.');
const io=new NodeIO();
function makeDocument(parts,name){
  const doc=new Document(),buffer=doc.createBuffer(),mesh=doc.createMesh(name),scene=doc.createScene(name);
  for(const part of parts){
    const material=doc.createMaterial(part.role).setDoubleSided(true).setMetallicFactor(0).setRoughnessFactor(.9);
    const accessor=(name,type,array)=>doc.createAccessor(name,buffer).setType(type).setArray(array);
    const primitive=doc.createPrimitive().setMaterial(material).setIndices(accessor(part.role+' indices','SCALAR',part.indices))
      .setAttribute('POSITION',accessor(part.role+' positions','VEC3',part.positions))
      .setAttribute('NORMAL',accessor(part.role+' normals','VEC3',part.normals))
      .setAttribute('TEXCOORD_0',accessor(part.role+' UV0','VEC2',part.uvs));
    mesh.addPrimitive(primitive);
  }
  scene.addChild(doc.createNode(name).setMesh(mesh));doc.getRoot().setDefaultScene(scene);return doc;
}
function compact(indices,positions,normals,uvs){
  // compactMesh mutates indices and returns old->new vertex mapping, not inverse.
  const [remap,count]=MeshoptSimplifier.compactMesh(indices),p=new Float32Array(count*3),n=new Float32Array(count*3),uv=new Float32Array(count*2);
  for(let old=0;old<remap.length;old++){const next=remap[old];if(next===0xffffffff)continue;for(let axis=0;axis<3;axis++){p[next*3+axis]=positions[old*3+axis];n[next*3+axis]=normals[old*3+axis];}uv[next*2]=uvs[old*2];uv[next*2+1]=uvs[old*2+1];}
  return {indices:count<65535?new Uint16Array(indices):indices,positions:p,normals:n,uvs:uv};
}
// Tool/API smoke test precedes every source network transfer.
{
  const positions=[],normals=[],uvs=[],indices=[];
  for(let z=0;z<=10;z++)for(let x=0;x<=10;x++){positions.push(x/10,0,z/10);normals.push(0,1,0);uvs.push(x/10,z/10);}
  for(let z=0;z<10;z++)for(let x=0;x<10;x++){const a=z*11+x;indices.push(a,a+11,a+1,a+1,a+11,a+12);}
  const p=new Float32Array(positions),n=new Float32Array(normals),uv=new Float32Array(uvs),attributes=new Float32Array(121*5);
  for(let i=0;i<121;i++)attributes.set([0,1,0,uv[i*2],uv[i*2+1]],i*5);
  const [reduced]=MeshoptSimplifier.simplifyWithAttributes(new Uint32Array(indices),p,3,attributes,5,[1,1,1,1,1],null,120,.01,[]);
  if(!reduced.length||reduced.length>120||reduced.length%3)throw Error('Pinned simplifier synthetic smoke failed.');
  const doc=makeDocument([{role:'smoke',...compact(reduced,p,n,uv)}],'smoke');await doc.transform(weld());
  const encoded=await io.writeBinary(doc),decoded=await io.readBinary(encoded);
  if(decoded.getRoot().listMeshes().length!==1)throw Error('Pinned GLB writer/readback smoke failed.');
  const check=decoded.getRoot().listMeshes()[0].listPrimitives()[0],count=check.getAttribute('POSITION').getCount();
  for(const semantic of ['POSITION','NORMAL','TEXCOORD_0'])if(check.getAttribute(semantic).getCount()!==count||!check.getAttribute(semantic).getArray().every(Number.isFinite))throw Error('Pinned GLB attribute readback failed.');
  if(!check.getIndices().getArray().every(index=>index<count))throw Error('Pinned GLB indices readback failed.');
  console.log('PINNED_TOOL_SMOKE_PASSED '+JSON.stringify({versions,triangles:reduced.length/3,glbBytes:encoded.length}));
}
const textureManifestPath='public/assets/foliage/tree_small_02/foliage-manifest.json';
const textureManifest=JSON.parse(await readFile(textureManifestPath,'utf8'));let sharedTextureBytes=0;
for(const file of textureManifest.files){const data=await readFile('public'+file.path);if(data.length!==file.bytes||hash('md5',data)!==file.md5||hash('sha256',data)!==file.sha256)throw Error('Existing shared texture failed integrity: '+file.path);sharedTextureBytes+=data.length;}
if(sharedTextureBytes!==textureManifest.totalBytes)throw Error('Shared texture total mismatch.');
let transferred=0;
async function download(url,limit){
  const response=await fetch(url,{signal:AbortSignal.timeout(120000),headers:{'User-Agent':userAgent,'Accept':'*/*'}});
  if(!response.ok||!response.body)throw Error(`Source HTTP ${response.status}: ${new URL(url).pathname}`);
  const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>limit)throw Error('Declared input exceeds bound.');
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;transferred+=chunk.length;if(size>limit||transferred>maxInput)throw Error('Source transfer exceeds bounded input.');chunks.push(chunk);}return Buffer.concat(chunks);
}
async function verified(file,limit){
  if(!file||typeof file.url!=='string'||!Number.isSafeInteger(file.size)||file.size<=0||file.size>limit||! /^[a-f0-9]{32}$/i.test(file.md5??''))throw Error('Invalid source descriptor.');
  const url=new URL(file.url);if(url.protocol!=='https:'||url.hostname!=='dl.polyhaven.org')throw Error('Source URL outside official host.');
  const data=await download(file.url,limit);if(data.length!==file.size||hash('md5',data)!==file.md5.toLowerCase())throw Error('Source input byte/MD5 mismatch.');return data;
}
const endpoint='https://api.polyhaven.com/files/tree_small_02',tree=JSON.parse((await download(endpoint,1024*1024)).toString('utf8'));
const descriptor=tree.gltf?.['1k']?.gltf,binaryDescriptor=descriptor?.include?.['tree_small_02.bin'];
if(binaryDescriptor?.size!==binBytes||binaryDescriptor?.md5!==binMD5)throw Error('Pinned TreeSmall02 geometry changed; inspect before fetching.');
const jsonBytes=await verified(descriptor,2*1024*1024),sourceJSON=JSON.parse(jsonBytes.toString('utf8'));
if(sourceJSON.buffers?.length!==1||sourceJSON.buffers[0].uri!=='tree_small_02.bin'||sourceJSON.buffers[0].byteLength!==binBytes||sourceJSON.meshes?.length!==1||sourceJSON.meshes[0].primitives.length!==3||sourceJSON.nodes?.length!==1)throw Error('Unexpected source geometry structure.');
if(sourceJSON.skins?.length||['matrix','translation','rotation','scale','skin','children'].some(key=>sourceJSON.nodes[0][key]!==undefined))throw Error('Source node now has transforms or skinning that this geometry-only exporter does not retain.');
for(const primitive of sourceJSON.meshes[0].primitives)if(primitive.mode!==undefined&&primitive.mode!==4||primitive.targets)throw Error('Unsupported source primitive.');
for(const [i,name]of ['tree_small_02_branches','tree_small_02_leaves','tree_small_02_trunk'].entries())if(sourceJSON.materials?.[sourceJSON.meshes[0].primitives[i].material]?.name!==name)throw Error('Source primitive material order changed; inspect before fetching.');
const binary=await verified(binaryDescriptor,binBytes);
await mkdir(raw,{recursive:true});await writeFile(raw+'/source.gltf',jsonBytes);await writeFile(raw+'/tree_small_02.bin',binary);
await mkdir(out,{recursive:true});
const sourceProvenance={gltf:{url:descriptor.url,bytes:jsonBytes.length,md5:hash('md5',jsonBytes),sha256:hash('sha256',jsonBytes)},binary:{url:binaryDescriptor.url,bytes:binary.length,md5:hash('md5',binary),sha256:hash('sha256',binary)},totalTransferredBytes:transferred,maximumInputBytes:maxInput};
await writeFile(out+'/source-inspection.json',JSON.stringify({tools:versions,source:sourceProvenance,status:'input-verified-awaiting-simplification'},null,2)+'\n');
const geometryJSON=structuredClone(sourceJSON);delete geometryJSON.images;delete geometryJSON.textures;delete geometryJSON.samplers;delete geometryJSON.materials;delete geometryJSON.extensionsUsed;delete geometryJSON.extensionsRequired;
for(const primitive of geometryJSON.meshes[0].primitives)delete primitive.material;
const doc=await io.readJSON({json:geometryJSON,resources:{'tree_small_02.bin':new Uint8Array(binary)}}),primitives=doc.getRoot().listMeshes()[0].listPrimitives();
const roles=['bark_branches','leaves','bark_trunk'],uvPolicies=[];
for(let i=0;i<primitives.length;i++){
  const primitive=primitives[i],material=sourceJSON.materials[sourceJSON.meshes[0].primitives[i].material];
  const binding=material.pbrMetallicRoughness.baseColorTexture,transform=binding.extensions?.KHR_texture_transform??{},texCoord=transform.texCoord??binding.texCoord??0;
  for(const other of [material.normalTexture,material.pbrMetallicRoughness.metallicRoughnessTexture])if(other&&JSON.stringify({texCoord:other.extensions?.KHR_texture_transform?.texCoord??other.texCoord??0,transform:other.extensions?.KHR_texture_transform??{}})!==JSON.stringify({texCoord,transform}))throw Error('Source texture slots use differing UV transforms.');
  const source=primitive.getAttribute('TEXCOORD_'+texCoord);if(!source||transform.rotation)throw Error('Unsupported source UV binding.');
  const scale=transform.scale??[1,1],offset=transform.offset??[0,0],array=source.getArray(),baked=new Float32Array(source.getCount()*2);
  for(let vertex=0;vertex<source.getCount();vertex++){baked[vertex*2]=array[vertex*2]*scale[0]+offset[0];baked[vertex*2+1]=array[vertex*2+1]*scale[1]+offset[1];}
  primitive.setAttribute('TEXCOORD_0',doc.createAccessor(roles[i]+' baked UV0',doc.getRoot().listBuffers()[0]).setType('VEC2').setArray(baked));primitive.setAttribute('TEXCOORD_1',null);
  uvPolicies.push({role:roles[i],sourceTexCoord:texCoord,sourceScale:scale,sourceOffset:offset,bakedInto:'TEXCOORD_0',materialSubstitution:i===1?'unchanged leaf atlas with separate existing PNG alpha':'existing seamless Bark Brown01, original used UV mapping retained'});
}
await doc.transform(weld());
function bounds(positions){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<positions.length;i++){const a=i%3;min[a]=Math.min(min[a],positions[i]);max[a]=Math.max(max[a],positions[i]);}return {min,max,span:min.map((v,a)=>max[a]-v)};}
function topology(indices,count){
  const parent=new Uint32Array(count);for(let i=0;i<count;i++)parent[i]=i;
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const join=(a,b)=>{a=find(a);b=find(b);if(a!==b)parent[b]=a;};
  for(let i=0;i<indices.length;i+=3){join(indices[i],indices[i+1]);join(indices[i],indices[i+2]);}
  const seen=new Uint8Array(count);let components=0;for(const index of indices){const root=find(index);if(!seen[root]){seen[root]=1;components++;}}
  return {components,retained(output){const seen=new Uint8Array(count);let value=0;for(const index of output){const root=find(index);if(!seen[root]){seen[root]=1;value++;}}return value;}};
}
function occupancy(positions,box){const cells=new Set();for(let i=0;i<positions.length;i+=3){const cell=[0,1,2].map(a=>Math.max(0,Math.min(11,Math.floor((positions[i+a]-box.min[a])/Math.max(box.span[a],1e-8)*12))));cells.add(cell[0]+12*cell[1]+144*cell[2]);}return cells;}
const sources=primitives.map((primitive,i)=>{
  const positions=new Float32Array(primitive.getAttribute('POSITION').getArray()),normals=new Float32Array(primitive.getAttribute('NORMAL').getArray()),uvs=new Float32Array(primitive.getAttribute('TEXCOORD_0').getArray()),indices=new Uint32Array(primitive.getIndices().getArray());
  if(!positions.every(Number.isFinite)||!normals.every(Number.isFinite)||!uvs.every(Number.isFinite))throw Error('Nonfinite source attributes.');
  const attributes=new Float32Array(positions.length/3*5);for(let v=0;v<positions.length/3;v++)attributes.set([normals[v*3],normals[v*3+1],normals[v*3+2],uvs[v*2],uvs[v*2+1]],v*5);
  const box=bounds(positions),components=topology(indices,positions.length/3),cells=occupancy(positions,box);
  return {role:roles[i],positions,normals,uvs,indices,attributes,box,components,cells};
});
const sourceGeometry=sources.map(source=>{const uvMin=[Infinity,Infinity],uvMax=[-Infinity,-Infinity];for(let i=0;i<source.uvs.length;i++){const axis=i%2;uvMin[axis]=Math.min(uvMin[axis],source.uvs[i]);uvMax[axis]=Math.max(uvMax[axis],source.uvs[i]);}return {role:source.role,triangles:source.indices.length/3,vertices:source.positions.length/3,components:source.components.components,bounds:source.box,bakedUV0Range:{min:uvMin,max:uvMax}};});
await writeFile(out+'/source-inspection.json',JSON.stringify({tools:versions,source:sourceProvenance,uvPolicies,sourceGeometry,status:'input-and-UV-mapping-verified-awaiting-simplification'},null,2)+'\n');
const results=[],writes=[];
for(const lod of [{name:'near',budgets:[11000,65000,4000],errors:[.005,.01,.02]},{name:'far',budgets:[3000,10000,2000],errors:[.02,.04,.08]}]){
  const parts=[],metrics=[];
  for(let i=0;i<sources.length;i++){
    const source=sources[i],budget=lod.budgets[i];let chosen;
    for(const flags of [[],['Prune'],['Prune','Permissive']]){
      for(const errorLimit of lod.errors){
        const [indices,error]=MeshoptSimplifier.simplifyWithAttributes(source.indices,source.positions,3,source.attributes,5,[1,1,1,.5,.5],null,budget*3,errorLimit,flags);
        if(!chosen||indices.length<chosen.indices.length)chosen={indices,error,errorLimit,flags};
        if(indices.length<=budget*3&&indices.length>0)break;
      }
      if(chosen.indices.length<=budget*3&&chosen.indices.length>0)break;
    }
    if(!chosen?.indices.length)throw Error('Simplification erased a material primitive.');
    const triangles=chosen.indices.length/3,retainedComponents=source.components.retained(chosen.indices),part=compact(chosen.indices,source.positions,source.normals,source.uvs),box=bounds(part.positions),cells=occupancy(part.positions,source.box);
    if(triangles>budget)throw Error(`Topology did not reach the requested ${lod.name}/${source.role} budget: ${triangles}>${budget}`);
    parts.push({role:source.role,...part});metrics.push({role:source.role,sourceTriangles:source.indices.length/3,triangles,ratio:triangles/(source.indices.length/3),vertices:part.positions.length/3,targetTriangles:budget,reportedAttributeError:chosen.error,errorLimit:chosen.errorLimit,flags:chosen.flags,sourceBounds:source.box,bounds:box,sourceComponents:source.components.components,retainedSourceComponents:retainedComponents,sourceOccupiedCanopyCells:source.cells.size,retainedOccupiedCanopyCells:[...cells].filter(cell=>source.cells.has(cell)).length,canopyGrid:12});
  }
  const output=await io.writeBinary(makeDocument(parts,'tree_small_02_'+lod.name));if(output.length>maxMesh)throw Error('One model exceeds 25 MiB.');
  const check=await io.readBinary(output);if(check.getRoot().listTextures().length||check.getRoot().listExtensionsUsed().length)throw Error('Output unexpectedly needs textures or runtime extensions.');
  const path='tree_small_02-'+lod.name+'.glb';writes.push({path,data:output});results.push({lod:lod.name,path,bytes:output.length,sha256:hash('sha256',output),triangles:metrics.reduce((sum,m)=>sum+m.triangles,0),primitives:metrics});console.log('TREE_LOD_RESULT '+JSON.stringify(results.at(-1)));
}
const runtimeBytes=results.reduce((sum,result)=>sum+result.bytes,sharedTextureBytes);if(runtimeBytes+65536>maxRuntime)throw Error('Both LODs plus shared textures and 64KiB provenance reserve exceed 20 MiB.');
await mkdir(out,{recursive:true});for(const file of writes)await writeFile(out+'/'+file.path,file.data);
const manifest={version:1,status:'offline-research-requires-rendered-review',retrievedAt:new Date().toISOString(),asset:'tree_small_02',author:'Rico Cilliers',license:'CC0-1.0',sourcePage:'https://polyhaven.com/a/tree_small_02',licensePage:'https://polyhaven.com/license',tools:versions,source:sourceProvenance,sourceGeometry,uvPolicies,sharedTextures:{manifestPath:textureManifestPath,manifestSHA256:hash('sha256',await readFile(textureManifestPath)),bytes:sharedTextureBytes,files:textureManifest.files},outputs:results,totalRuntimeBytes:runtimeBytes,maximumRuntimeBytes:maxRuntime,materialRoles:roles,notes:['Offline simplification is a lossy CC0 adaptation, not a newly measured Naples tree. Existing OSM tree-node positions are not part of, or altered by, this research.','Source branch UV1 and its exact used KHR_texture_transform are baked into UV0 before UV1 is removed. Leaf atlas UV0 and trunk UV0 are retained.','Geometry-only uncompressed GLBs require no Draco, meshopt decoder, images or external runtime fetch. Bind existing bark/leaf PBR materials by the stable role names.','The JPEG leaf diffuse has no alpha channel. Attach the unchanged separate PNG alpha through the existing Babylon material factory. No image pixels are edited or packed.','Prune/Permissive may remove leaf components or relax attribute seams; actual flags, retained component counts and coarse canopy occupancy are recorded per primitive.','Reported simplifier error, bounds and occupancy are diagnostics, not a silhouette or perceptual-quality guarantee. Near/far render review with the actual alpha material is required before runtime approval.','No claim of GTA-equivalent or photographic tree quality follows from triangle reduction alone.']};
await writeFile(out+'/tree-lod-manifest.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile(out+'/LICENSE.txt',['Derived geometry: Tree Small 02 — Rico Cilliers, Poly Haven, CC0 1.0.','https://polyhaven.com/a/tree_small_02','https://polyhaven.com/license','Offline simplification performed with glTF-Transform and meshoptimizer (MIT tools, not included in runtime).','Shared unchanged photographic maps remain credited in the existing foliage manifest (Rico Cilliers leaves; Rob Tuytel Bark Brown01).','No original 95MB input binary, preview renders or API source code is redistributed.',''].join('\n'));
console.log('VERIFIED_TREE_LODS '+JSON.stringify({runtimeBytes,sharedTextureBytes,outputs:results.map(({lod,bytes,triangles})=>({lod,bytes,triangles}))}));
