import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Verified primary pages: polyhaven.com/a/tree_small_02 and /a/jacaranda_tree.
// Inspect original glTF packages before choosing a runtime model; acquire only
// the bounded photographic broadleaf/bark fallback, never a huge source mesh.
const root='public/assets/foliage/tree_small_02',research='work/tree-visual-research';
const maxPack=20*1024*1024,maxMap=8*1024*1024,maxDocument=2*1024*1024;
const userAgent='NapoliQuartiereZero/0.5 (https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero)';
const hash=(type,data)=>createHash(type).update(data).digest('hex');
async function bytes(url,limit){
  const response=await fetch(url,{signal:AbortSignal.timeout(40000),headers:{'User-Agent':userAgent,'Accept':'*/*'}});
  if(!response.ok)throw Error(`HTTP ${response.status} for ${new URL(url).pathname}`);
  if(!response.body)throw Error('Empty source response.');
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>limit)throw Error('Source exceeds the bounded download size.');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('Source exceeds the bounded download size.');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
function verifyDescriptor(file,limit,label){
  if(!file||typeof file.url!=='string'||!Number.isSafeInteger(file.size)||file.size<=0||file.size>limit||! /^[a-f0-9]{32}$/i.test(file.md5??''))throw Error('Invalid verified source descriptor: '+label+' '+JSON.stringify({keys:Object.keys(file??{}).slice(0,20),size:file?.size,md5:file?.md5}));
  const url=new URL(file.url);if(url.protocol!=='https:'||url.hostname!=='dl.polyhaven.org')throw Error('Source URL is outside the official download host.');
  return file;
}
async function verifiedBytes(file,limit,label){
  verifyDescriptor(file,limit,label);const data=await bytes(file.url,limit);
  if(data.length!==file.size||hash('md5',data)!==file.md5.toLowerCase())throw Error('Source byte/MD5 mismatch: '+label);
  return data;
}
await mkdir(research,{recursive:true});
const documents=new Map(),candidates=[];
for(const id of ['tree_small_02','jacaranda_tree']){
  const tree=JSON.parse((await bytes(`https://api.polyhaven.com/files/${id}`,maxDocument)).toString('utf8'));
  documents.set(id,tree);await writeFile(`${research}/${id}-files.json`,JSON.stringify(tree,null,2)+'\n');
  const file=tree.gltf?.['1k']?.gltf;
  const record={id,page:`https://polyhaven.com/a/${id}`,topLevelMapKeys:Object.keys(tree),gltfResolutionKeys:Object.keys(tree.gltf??{}),availableGltf:Boolean(file)};
  if(file){
    record.gltfBytes=file.size;record.includes=Object.entries(file.include??{}).map(([path,item])=>({path,bytes:item.size,md5:item.md5,url:item.url}));
    record.sourcePackBytes=file.size+record.includes.reduce((sum,item)=>sum+(Number.isSafeInteger(item.bytes)?item.bytes:0),0);
    try{
      const data=await verifiedBytes(file,maxDocument,id+'/1k/gltf');
      const gltf=JSON.parse(data.toString('utf8'));await writeFile(`${research}/${id}.gltf`,data);
      const triangles=(primitive)=>primitive.mode!==undefined&&primitive.mode!==4?null:gltf.accessors?.[primitive.indices??primitive.attributes?.POSITION]?.count/(primitive.indices===undefined?3:3);
      record.meshes=(gltf.meshes??[]).map((mesh,index)=>({index,name:mesh.name,triangles:mesh.primitives.reduce((sum,p)=>sum+(triangles(p)??0),0),primitiveCount:mesh.primitives.length}));
      record.nodes=(gltf.nodes??[]).map((node,index)=>({index,name:node.name,mesh:node.mesh,children:node.children,lod:node.extensions?.MSFT_lod}));
      record.defaultScene=gltf.scene??0;record.scenes=gltf.scenes;record.extensionsUsed=gltf.extensionsUsed??[];record.extensionsRequired=gltf.extensionsRequired??[];
      const visited=new Set(),meshes=new Set();
      const visit=index=>{if(visited.has(index))return;visited.add(index);const node=gltf.nodes?.[index];if(node?.mesh!==undefined)meshes.add(node.mesh);for(const child of node?.children??[])visit(child);};
      for(const index of gltf.scenes?.[record.defaultScene]?.nodes??[])visit(index);
      record.defaultSceneTriangles=[...meshes].reduce((sum,index)=>sum+(record.meshes[index]?.triangles??0),0);
      record.sourceFitsRuntimeBounds=record.sourcePackBytes<=maxPack&&record.defaultSceneTriangles<=150000&&record.defaultSceneTriangles>0&&!record.extensionsUsed.some(ext=>['KHR_draco_mesh_compression','EXT_meshopt_compression','KHR_texture_basisu'].includes(ext));
    }catch(error){record.inspectionError=error.message;}
  }
  candidates.push(record);
  console.log('TREE_MODEL_INSPECTION '+JSON.stringify({...record,meshes:record.meshes?.slice(0,30),nodes:record.nodes?.slice(0,60)}));
}
await writeFile(research+'/model-inspection.json',JSON.stringify(candidates,null,2)+'\n');
const tree=documents.get('tree_small_02');
const selection=[
  ['leaves_diff','jpg','leaves-diff.jpg','leaf colour'],['leaves_alpha','png','leaves-alpha.png','leaf alpha mask'],
  ['leaves_nor_gl','jpg','leaves-normal.jpg','leaf OpenGL normal'],['leaves_rough','jpg','leaves-rough.jpg','leaf roughness'],
  ['diff','jpg','bark-diff.jpg','bark colour'],['nor_gl','jpg','bark-normal.jpg','bark OpenGL normal'],['rough','jpg','bark-rough.jpg','bark roughness'],
];
const aliases={diff:['diff','Diffuse'],rough:['rough','Rough']};
const plans=selection.map(([map,format,path,usage])=>{
  const sourceMapKey=(aliases[map]??[map]).find(key=>Object.hasOwn(tree,key));
  const file=verifyDescriptor(tree[sourceMapKey]?.['1k']?.[format],maxMap,'tree_small_02/'+map+'/1k/'+format);
  return {map,format,path,usage,sourceMapKey,file};
});
if(plans.reduce((sum,plan)=>sum+plan.file.size,0)>maxPack)throw Error('Photographic foliage pack exceeds 20 MiB.');
const files=[],writes=[];let totalBytes=0;
for(const plan of plans){
  const data=await verifiedBytes(plan.file,maxMap,'tree_small_02/'+plan.map);totalBytes+=data.length;if(totalBytes>maxPack)throw Error('Photographic foliage pack exceeds 20 MiB.');
  files.push({usage:plan.usage,path:'/assets/foliage/tree_small_02/'+plan.path,url:plan.file.url,bytes:data.length,md5:hash('md5',data),sha256:hash('sha256',data),resolution:'1k',format:plan.format,sourceMapKey:plan.sourceMapKey});writes.push({path:plan.path,data});
  console.log(`${plan.map}/1k/${plan.format}: ${data.length} bytes, MD5 verified`);
}
await mkdir(root,{recursive:true});for(const file of writes)await writeFile(root+'/'+file.path,file.data);
const manifest={version:1,retrievedAt:new Date().toISOString(),kind:'photographic_leaf_atlas_and_bark',geometryIncluded:false,provider:'Poly Haven',assetId:'tree_small_02',sourcePage:'https://polyhaven.com/a/tree_small_02',filesEndpoint:'https://api.polyhaven.com/files/tree_small_02',author:'Rico Cilliers',license:'CC0-1.0',licensePage:'https://polyhaven.com/license',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',apiTerms:'https://github.com/Poly-Haven/Public-API/blob/master/ToS.md',apiUserAgent:userAgent,totalBytes,maximumPackBytes:maxPack,files,modelResearch:candidates.map(({id,page,sourcePackBytes,defaultSceneTriangles,sourceFitsRuntimeBounds,extensionsUsed})=>({id,page,sourcePackBytes,defaultSceneTriangles,sourceFitsRuntimeBounds,extensionsUsed})),notes:['Only original CC0 asset maps are redistributed, without preview renders or website copy.','Photographic alpha atlas and PBR maps for generic broadleaf geometry; this package does not contain the original multi-million-polygon tree.','The source asset identifies Burkea africana (wild syringa); this is not a botanical survey or an assertion of the species of Naples street trees.','Planting positions remain the separate OpenStreetMap geographic data; the tree shape and species are an artistic approximation.','Alpha is supplied as a separate grayscale PNG mask. Normal and roughness maps use linear colour space.','Use OpenGL tangent-space normals and a cutout material; no Draco, KTX, external decoder, authentication or live API is needed at runtime.']};
await writeFile(root+'/foliage-manifest.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile(root+'/LICENSE.txt',['Tree Small 02 photographic leaves and bark maps — Rico Cilliers, Poly Haven.','https://polyhaven.com/a/tree_small_02','License: CC0 1.0 Universal; redistribution and commercial use allowed.','https://polyhaven.com/license','https://creativecommons.org/publicdomain/zero/1.0/','','Original map files, not preview renders or website copy.','Generic broadleaf visual material, not measured species or geometry of Naples trees.','API preparation terms: https://github.com/Poly-Haven/Public-API/blob/master/ToS.md',''].join('\n'));
console.log(`Verified photographic foliage fallback: ${files.length} files, ${totalBytes} bytes. Full model inspection saved separately under ${research}.`);
