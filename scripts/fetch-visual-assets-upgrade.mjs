import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';

// Incremental, opt-in upgrade of the already verified pack. The existing 1k
// acquisition remains unchanged. Only asphalt may request a 2k resolution.
// Ground source: https://polyhaven.com/a/stone_tiles_02 (CC0, 2m outdoor floor).
const resolution=process.argv.find(a=>a.startsWith('--asphalt-resolution='))?.split('=')[1]??'2k';
if(!['1k','2k'].includes(resolution))throw Error('Asphalt resolution must be exactly 1k or 2k.');
const root=resolve('public/assets'),diagnosticsRoot='work/visual-asset-upgrade-diagnostics';
const maxTotal=45*1024*1024,maxMap=8*1024*1024,maxExistingFile=10*1024*1024;
const userAgent='NapoliQuartiereZero/0.5 (https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero)';
const digest=(type,data)=>createHash(type).update(data).digest('hex');
const manifest=JSON.parse(await readFile(root+'/visual-manifest.json','utf8'));
const license=await readFile(root+'/VISUAL-ASSETS-LICENSE.txt','utf8');
if(manifest.provider!=='Poly Haven'||!Array.isArray(manifest.assets)||manifest.assets.length>8||!Array.isArray(manifest.notes))throw Error('A verified bounded Poly Haven base pack is required.');
const asphalt=manifest.assets.find(asset=>asset.id==='asphalt_02');
if(!asphalt||asphalt.kind!=='texture'||asphalt.license!=='CC0-1.0')throw Error('The verified asphalt_02 base material is missing.');
let existingBytes=0;
for(const asset of manifest.assets){
  if(asset.license!=='CC0-1.0'||!asset.files||Object.keys(asset.files).length>4)throw Error('Unexpected base-pack asset metadata.');
  for(const file of Object.values(asset.files)){
    if(typeof file.path!=='string'||!file.path.startsWith('/assets/'))throw Error('Base-pack file escaped the public asset root.');
    const path=resolve('public',file.path.slice(1));
    if(!path.startsWith(root+sep))throw Error('Base-pack file escaped the public asset root.');
    const info=await stat(path);
    if(!info.isFile()||info.size>maxExistingFile||info.size!==file.bytes)throw Error('Base-pack file size mismatch: '+file.path);
    existingBytes+=info.size;if(existingBytes>maxTotal)throw Error('Base pack exceeds the 45 MiB cumulative budget.');
    const data=await readFile(path);
    if(digest('md5',data)!==file.md5||digest('sha256',data)!==file.sha256)throw Error('Base-pack integrity mismatch: '+file.path);
  }
}
if(existingBytes!==manifest.totalBytes)throw Error('Base-pack cumulative byte count does not match its manifest.');
const selection=[
  {asset:asphalt,resolution},
  {asset:{id:'stone_tiles_02',key:'paving',kind:'texture',metres:2,authors:['Charlotte Baglioni'],license:'CC0-1.0',licenseUrl:'https://creativecommons.org/publicdomain/zero/1.0/',page:'https://polyhaven.com/a/stone_tiles_02',filesEndpoint:'https://api.polyhaven.com/files/stone_tiles_02'},resolution:'1k'},
];
async function bytes(url,limit){
  const response=await fetch(url,{signal:AbortSignal.timeout(40000),headers:{'User-Agent':userAgent,'Accept':'*/*'}});
  if(!response.ok)throw Error(`HTTP ${response.status} for ${new URL(url).pathname}`);
  if(!response.body)throw Error('Empty asset response.');
  const declared=Number(response.headers.get('content-length'));
  if(Number.isFinite(declared)&&declared>limit)throw Error('Declared download size exceeds its bound.');
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('Download exceeds its byte bound.');chunks.push(chunk);}
  return Buffer.concat(chunks);
}
function descriptor(tree,map,resolution,assetId){
  const aliases={diff:['diff','Diffuse'],rough:['rough','Rough']};
  const sourceMapKey=(aliases[map]??[map]).find(key=>Object.hasOwn(tree??{},key));
  const sourceMap=tree[sourceMapKey],file=sourceMap?.[resolution]?.jpg;
  if(!file||typeof file.url!=='string'||!Number.isSafeInteger(file.size)||file.size<=0||file.size>maxMap||! /^[a-f0-9]{32}$/i.test(file.md5??'')){
    const keys=value=>Object.keys(value??{}).slice(0,30),scalar=value=>typeof value==='string'?value.slice(0,250):typeof value==='number'?value:null;
    console.error('Street-upgrade descriptor diagnostics:',JSON.stringify({assetId,map,sourceMapKey:sourceMapKey??null,resolution,format:'jpg',limit:maxMap,treeKeys:keys(tree),resolutionKeys:keys(sourceMap),formatKeys:keys(sourceMap?.[resolution]),descriptorKeys:keys(file),size:scalar(file?.size),sizeType:typeof file?.size,md5:scalar(file?.md5),md5Type:typeof file?.md5,url:scalar(file?.url)}));
    throw Error(`Invalid verified JPG descriptor: ${assetId}/${resolution}/${map}`);
  }
  const url=new URL(file.url);
  if(url.protocol!=='https:'||url.hostname!=='dl.polyhaven.org')throw Error('Asset URL is outside the official download host.');
  return {...file,sourceMapKey};
}
const plans=[],errors=[];
for(const item of selection){
  const endpoint=`https://api.polyhaven.com/files/${item.asset.id}`;
  const tree=JSON.parse((await bytes(endpoint,1024*1024)).toString('utf8'));
  await mkdir(diagnosticsRoot,{recursive:true});
  await writeFile(`${diagnosticsRoot}/${item.asset.id}.json`,JSON.stringify(tree,null,2)+'\n');
  const files=[];
  for(const map of ['diff','nor_gl','rough']){
    try{files.push({map,file:descriptor(tree,map,item.resolution,item.asset.id)});}
    catch(error){errors.push(error.message);}
  }
  plans.push({...item,endpoint,files});
}
if(errors.length)throw Error('Street-upgrade preflight failed: '+errors.join('; '));
const replacedIds=new Set(selection.map(item=>item.asset.id));
const keptAssets=manifest.assets.filter(asset=>!replacedIds.has(asset.id));
const keptBytes=keptAssets.reduce((sum,asset)=>sum+Object.values(asset.files).reduce((subtotal,file)=>subtotal+file.bytes,0),0);
const plannedBytes=plans.reduce((sum,plan)=>sum+plan.files.reduce((subtotal,item)=>subtotal+item.file.size,0),keptBytes);
if(plannedBytes>maxTotal)throw Error('Street upgrade exceeds the 45 MiB cumulative pack budget.');
const writes=[],upgraded=[];
let downloadedBytes=0;
for(const plan of plans){
  const records={};
  for(const {map,file}of plan.files){
    const data=await bytes(file.url,maxMap),md5=digest('md5',data);
    if(data.length!==file.size||md5.toLowerCase()!==file.md5.toLowerCase())throw Error(`Integrity mismatch: ${plan.asset.id}/${plan.resolution}/${map}`);
    downloadedBytes+=data.length;if(downloadedBytes>maxTotal)throw Error('Street-upgrade transfer exceeded 45 MiB.');
    const path=`materials/${plan.asset.id}/${map}.jpg`;
    records[map]={path:'/assets/'+path,url:file.url,bytes:data.length,md5,sha256:digest('sha256',data),resolution:plan.resolution,format:'jpg',sourceMapKey:file.sourceMapKey};
    writes.push({path,data});console.log(`${plan.asset.id}/${plan.resolution}/${map}: ${data.length} bytes, MD5 verified`);
  }
  upgraded.push({...plan.asset,filesEndpoint:plan.endpoint,files:records});
}
const byId=new Map(upgraded.map(asset=>[asset.id,asset]));
const assets=manifest.assets.map(asset=>byId.get(asset.id)??asset);
for(const asset of upgraded)if(!assets.some(existing=>existing.id===asset.id))assets.push(asset);
const finalBytes=assets.reduce((sum,asset)=>sum+Object.values(asset.files).reduce((subtotal,file)=>subtotal+file.bytes,0),0);
if(finalBytes!==plannedBytes||finalBytes>maxTotal)throw Error('Final upgraded byte total is inconsistent.');
// Preserve the original pack until all six downloaded maps pass integrity.
for(const file of writes){const path=root+'/'+file.path;await mkdir(path.slice(0,path.lastIndexOf('/')),{recursive:true});await writeFile(path,file.data);}
const next={...manifest,version:2,retrievedAt:new Date().toISOString(),apiUserAgent:userAgent,resolution:'mixed',totalBytes:finalBytes,assetCount:assets.length,assets,upgrade:{asphaltResolution:resolution,groundAsset:'stone_tiles_02',groundResolution:'1k',maximumCumulativeBytes:maxTotal},notes:[...new Set([...manifest.notes,'Asphalt resolution is explicitly selected for the street upgrade; all other source maps retain their individually recorded resolution.','Stone Tiles 02 is a generic scanned outdoor floor material, not measured Naples paving.'])]};
await writeFile(root+'/visual-manifest.json',JSON.stringify(next,null,2)+'\n');
const groundCredit='stone_tiles_02: Charlotte Baglioni — https://polyhaven.com/a/stone_tiles_02';
if(!license.includes(groundCredit))await writeFile(root+'/VISUAL-ASSETS-LICENSE.txt',license+'\nStreet material upgrade (same CC0 license):\n'+groundCredit+'\n');
console.log(`Verified street upgrade: ${writes.length} JPG maps downloaded; ${finalBytes} cumulative bytes; asphalt ${resolution}, ground 1k, other records preserved.`);
