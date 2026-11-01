import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Verified primary page: https://polyhaven.com/a/leafy_grass .
// One fixed 1k trio; no fallback asset or procedural substitute is acquired.
const assetId='leafy_grass',root='public/assets/materials/'+assetId,research='work/grass-ground-research';
const maxTotal=4*1024*1024,userAgent='NapoliQuartiereZero/0.5 (https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero)';
const hash=(kind,data)=>createHash(kind).update(data).digest('hex');
async function bytes(url,limit){
  const response=await fetch(url,{signal:AbortSignal.timeout(40000),headers:{'User-Agent':userAgent,'Accept':'*/*'}});
  if(!response.ok||!response.body)throw Error(`Source unavailable: HTTP ${response.status} for ${new URL(url).pathname}`);
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>limit)throw Error('Source exceeds the bounded byte limit.');
  const chunks=[];let count=0;
  for await(const chunk of response.body){count+=chunk.length;if(count>limit)throw Error('Source exceeds the bounded byte limit.');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
const endpoint=`https://api.polyhaven.com/files/${assetId}`;
const tree=JSON.parse((await bytes(endpoint,1024*1024)).toString('utf8'));
await mkdir(research,{recursive:true});await writeFile(research+'/source-files.json',JSON.stringify(tree,null,2)+'\n');
const aliases={diff:['diff','Diffuse'],nor_gl:['nor_gl'],rough:['rough','Rough']};
const plans=Object.entries(aliases).map(([map,keys])=>{
  const sourceMapKey=keys.find(key=>Object.hasOwn(tree,key)),file=tree[sourceMapKey]?.['1k']?.jpg;
  if(!file||typeof file.url!=='string'||!Number.isSafeInteger(file.size)||file.size<=0||file.size>maxTotal||! /^[a-f0-9]{32}$/i.test(file.md5??''))throw Error('Invalid 1k JPG descriptor: '+JSON.stringify({assetId,map,sourceMapKey,treeKeys:Object.keys(tree),size:file?.size,md5:file?.md5}));
  const url=new URL(file.url);if(url.protocol!=='https:'||url.hostname!=='dl.polyhaven.org')throw Error('Source URL is outside the official download host.');
  return {map,sourceMapKey,file};
});
if(plans.reduce((sum,plan)=>sum+plan.file.size,0)>maxTotal)throw Error('The selected grass trio exceeds 4 MiB; no files downloaded.');
const writes=[],files={};let totalBytes=0;
for(const {map,sourceMapKey,file}of plans){
  const data=await bytes(file.url,maxTotal),md5=hash('md5',data);
  if(data.length!==file.size||md5!==file.md5.toLowerCase())throw Error('Source byte/MD5 mismatch: '+assetId+'/'+map);
  totalBytes+=data.length;if(totalBytes>maxTotal)throw Error('The selected grass trio exceeds 4 MiB.');
  const path=`/assets/materials/${assetId}/${map}.jpg`;files[map]={path,url:file.url,bytes:data.length,md5,sha256:hash('sha256',data),resolution:'1k',format:'jpg',sourceMapKey};writes.push({path:map+'.jpg',data});
  console.log(`${assetId}/${map}/1k: ${data.length} bytes, MD5 verified`);
}
// All three original files must pass before any public asset is written.
await mkdir(root,{recursive:true});for(const file of writes)await writeFile(root+'/'+file.path,file.data);
const manifest={version:1,retrievedAt:new Date().toISOString(),provider:'Poly Haven',assetId,sourcePage:'https://polyhaven.com/a/leafy_grass',filesEndpoint:endpoint,author:'Charlotte Baglioni',license:'CC0-1.0',licensePage:'https://polyhaven.com/license',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',apiTerms:'https://github.com/Poly-Haven/Public-API/blob/master/ToS.md',apiUserAgent:userAgent,tileMetres:2,seamless:true,resolution:'1k',totalBytes,maximumTotalBytes:maxTotal,files,notes:['Original photographic grass ground maps, unchanged bytes; preview renders and website copy are excluded.','Generic scanned grass, leaves and twigs; not a photographic survey of Naples ground.','Application is limited to separately sourced real OpenStreetMap green-area polygons. This asset does not create planting positions or invented parks.','Diffuse uses sRGB; OpenGL normals and grayscale roughness use linear colour space.','No authentication, external runtime decoder or live API is needed.']};
await writeFile(root+'/ground-manifest.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile(root+'/LICENSE.txt',['Leafy Grass photographic ground maps — Charlotte Baglioni, Poly Haven.','https://polyhaven.com/a/leafy_grass','CC0 1.0 Universal: redistribution and commercial use allowed.','https://polyhaven.com/license','https://creativecommons.org/publicdomain/zero/1.0/','Original diffuse, OpenGL normal and roughness files; source tile width 2m.','Generic material applied only to separately sourced geographic green areas.',''].join('\n'));
console.log(`Verified grass ground: 3 original maps, ${totalBytes} bytes, 2m tile.`);
