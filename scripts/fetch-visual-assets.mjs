import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Asset pages and this API shape were verified against Poly Haven's own pages
// and https://github.com/Poly-Haven/Public-API/blob/master/swagger.yml .
// Downloads happen during preparation only. No provider API is used at runtime.
const root='public/assets';
const diagnosticsRoot='work/visual-asset-diagnostics';
const userAgent='NapoliQuartiereZero/0.4 (https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero)';
const maxTotal=35*1024*1024,maxTexture=3*1024*1024,maxHDR=10*1024*1024;
const selected=[
  {id:'asphalt_02',key:'asphalt',kind:'texture',metres:3,authors:['Rob Tuytel']},
  {id:'painted_plaster_wall',key:'plaster',kind:'texture',metres:2,authors:['Amal Kumar']},
  {id:'stone_wall',key:'stone',kind:'texture',metres:2,authors:['Charlotte Baglioni','Dario Barresi']},
  {id:'kloofendal_43d_clear_puresky',key:'sky',kind:'hdri',authors:['Greg Zaal']},
];
let totalBytes=0;
async function bytes(url,limit){
  const response=await fetch(url,{signal:AbortSignal.timeout(40000),headers:{'User-Agent':userAgent,'Accept':'*/*'}});
  if(!response.ok)throw Error(`HTTP ${response.status} for ${new URL(url).pathname}`);
  if(!response.body)throw Error('Empty asset response');
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>limit)throw Error('Declared asset exceeds bounded download limit');
  const parts=[];let size=0;
  for await(const part of response.body){size+=part.length;if(size>limit)throw Error('Asset exceeds bounded download limit');parts.push(part);}
  return Buffer.concat(parts);
}
function descriptor(tree,map,format,limit,assetId){
  // The live asphalt_02 response uses Diffuse and Rough although other asset
  // documents use diff and rough. Preserve the actual selected key in credits.
  const aliases={diff:['diff','Diffuse'],rough:['rough','Rough']};
  const sourceMapKey=(aliases[map]??[map]).find(key=>Object.hasOwn(tree??{},key));
  const sourceMap=tree[sourceMapKey];
  const file=sourceMap?.['1k']?.[format];
  if(!file||typeof file.url!=='string'||!Number.isSafeInteger(file.size)||file.size<=0||file.size>limit||! /^[a-f0-9]{32}$/i.test(file.md5??'')){
    // Keep the actual public descriptor visible when the API's documented shape
    // differs. Diagnostics are CI artifacts only, never redistributed game data.
    const keys=value=>Object.keys(value??{}).slice(0,30);
    const scalar=value=>typeof value==='string'?value.slice(0,250):typeof value==='number'?value:null;
    console.error('Poly Haven descriptor diagnostics:',JSON.stringify({assetId,map,sourceMapKey:sourceMapKey??null,resolution:'1k',format,limit,treeKeys:keys(tree),resolutionKeys:keys(sourceMap),formatKeys:keys(sourceMap?.['1k']),descriptorKeys:keys(file),size:scalar(file?.size),sizeType:typeof file?.size,md5:scalar(file?.md5),md5Type:typeof file?.md5,url:scalar(file?.url)}));
    throw Error(`Verified descriptor failed for ${assetId}/1k/${map}/${format}; inspect the bounded descriptor diagnostics`);
  }
  const url=new URL(file.url);
  if(url.protocol!=='https:'||url.hostname!=='dl.polyhaven.org')throw Error('Asset URL is outside the official download host');
  return {...file,sourceMapKey};
}
const files=[],assets=[],plans=[],descriptorErrors=[];
// Check the entire selection before transferring image files. If the upstream
// document shape changes, one CI diagnostic run reports every affected map.
for(const asset of selected){
  const endpoint=`https://api.polyhaven.com/files/${asset.id}`;
  const tree=JSON.parse((await bytes(endpoint,1024*1024)).toString('utf8'));
  await mkdir(diagnosticsRoot,{recursive:true});
  await writeFile(`${diagnosticsRoot}/${asset.id}.json`,JSON.stringify(tree,null,2)+'\n');
  const maps=asset.kind==='hdri'?[['hdri','hdr','environment/daylight.hdr']]:['diff','nor_gl','rough'].map(map=>[map,'jpg',`materials/${asset.id}/${map}.jpg`]);
  const descriptors=[];
  for(const [map,format,path]of maps){
    try{descriptors.push({map,format,path,file:descriptor(tree,map,format,asset.kind==='hdri'?maxHDR:maxTexture,asset.id)});}
    catch(error){descriptorErrors.push(error.message);}
  }
  plans.push({asset,endpoint,descriptors});
}
if(descriptorErrors.length)throw Error(`Visual asset preflight failed: ${descriptorErrors.join('; ')}`);
const plannedBytes=plans.reduce((sum,plan)=>sum+plan.descriptors.reduce((subtotal,item)=>subtotal+item.file.size,0),0);
if(plannedBytes>maxTotal)throw Error('Selected asset pack exceeds 35 MiB budget');
for(const {asset,endpoint,descriptors}of plans){
  const records={};
  for(const {map,format,path,file}of descriptors){
    if(totalBytes+file.size>maxTotal)throw Error('Selected asset pack exceeds 35 MiB budget');
    const data=await bytes(file.url,asset.kind==='hdri'?maxHDR:maxTexture);
    const md5=createHash('md5').update(data).digest('hex');
    if(data.length!==file.size||md5.toLowerCase()!==file.md5.toLowerCase())throw Error(`Integrity mismatch for ${asset.id}/${map}`);
    totalBytes+=data.length;if(totalBytes>maxTotal)throw Error('Asset pack exceeds 35 MiB budget');
    files.push({path,data});records[map]={path:'/assets/'+path,url:file.url,bytes:data.length,md5,sha256:createHash('sha256').update(data).digest('hex'),resolution:'1k',format,sourceMapKey:file.sourceMapKey};
    console.log(`${asset.key}/${map}: ${data.length} bytes, MD5 verified`);
  }
  assets.push({...asset,license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',page:`https://polyhaven.com/a/${asset.id}`,filesEndpoint:endpoint,files:records});
}
// Commit assets only after the entire bounded selection passed integrity checks.
for(const file of files){const target=root+'/'+file.path;await mkdir(target.slice(0,target.lastIndexOf('/')),{recursive:true});await writeFile(target,file.data);}
await mkdir(root,{recursive:true});
const manifest={version:1,retrievedAt:new Date().toISOString(),provider:'Poly Haven',providerLicensePage:'https://polyhaven.com/license',apiTerms:'https://github.com/Poly-Haven/Public-API/blob/master/ToS.md',apiUserAgent:userAgent,resolution:'1k',totalBytes,assetCount:assets.length,assets,notes:['Only original CC0 download assets are redistributed; no preview renders or API source code.','Generic scanned materials and a South African pure sky, not photographs or a survey of Naples.','Original maps are preserved. Runtime colour tint or UV scale is an artistic adaptation.','OpenGL tangent-space normal maps; normal convention must be handled by the renderer.','No live API or remote texture fetch during gameplay.']};
await writeFile(root+'/visual-manifest.json',JSON.stringify(manifest,null,2)+'\n');
await writeFile(root+'/VISUAL-ASSETS-LICENSE.txt',[
  'Photographic material maps and daylight environment: Poly Haven.',
  'All selected asset download files are CC0 1.0 Universal. They may be used and redistributed, including commercially.',
  'https://polyhaven.com/license',
  'https://creativecommons.org/publicdomain/zero/1.0/',
  '',
  ...selected.map(a=>`${a.id}: ${a.authors.join(', ')} — https://polyhaven.com/a/${a.id}`),
  '',
  'Preparation uses the official public API with a project-specific User-Agent. API access terms: https://github.com/Poly-Haven/Public-API/blob/master/ToS.md',
  'The shipped game uses self-hosted files, not the live API. Credits are supplied voluntarily for the CC0 assets; no endorsement is implied.',
  'Preview images, logos, website copy, author avatars and API implementation code are not included.',
  'These are generic materials, not photogrammetric evidence of the actual buildings or sky of Naples.',
  '',
].join('\n'));
console.log(`Verified CC0 visual pack: ${files.length} files, ${totalBytes} bytes. Manifest: ${root}/visual-manifest.json`);
