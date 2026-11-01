import {readFile,readdir,mkdir,writeFile,rename,rm,stat} from 'node:fs/promises';
import {resolve,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {mergeOSMSectors,geometryForSector,validateCitySectorManifest,validateSectorGeometry,type CitySectorManifest,type OSMSectorInput} from '../src/city-sector-data';
import {planNapoliSectors} from '../src/napoli-sectors';
import {ORIGIN,toLocal} from '../src/geo';
import {extractRealGeography} from '../src/real-geography';
const flags=process.argv.slice(2),argument=(name:string)=>flags.find(v=>v.startsWith(name+'='))?.slice(name.length+1);
const output=resolve(argument('--output')??'work/city-sector-pack'),allowedRoot=resolve('work');
if(output===allowedRoot||isAbsolute(relative(allowedRoot,output))||relative(allowedRoot,output).startsWith('..'))throw Error('Packaging output must be a new directory under work/.');
try{await stat(output);throw Error('Output already exists; preserve it and use a new --output.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const inputs:OSMSectorInput[]=[],sources:CitySectorManifest['sources']=[],sourceBounds:number[][]=[];
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
async function add(id:string,path:string,metadataPath:string,seed=false){
  const info=await stat(path);if(info.size>16*1024*1024)throw Error('Source exceeds 16 MiB: '+id);
  const metadataInfo=await stat(metadataPath);if(metadataInfo.size>128*1024)throw Error('Excessive source metadata.');
  const bytes=await readFile(path),metadata=JSON.parse(await readFile(metadataPath,'utf8'));
  if(bytes.byteLength>16*1024*1024)throw Error('Source exceeds 16 MiB: '+id);
  const expected=metadata.sha256,bbox=seed?metadata.bbox:metadata.sector?.bbox;
  if((!seed&&expected!==hash(bytes))||!Array.isArray(bbox)||bbox.length!==4||!bbox.every(Number.isFinite)||bbox[0]>=bbox[2]||bbox[1]>=bbox[3]||metadata.license!=='ODbL-1.0')throw Error('Invalid source provenance: '+id);
  const date=metadata.date;if(typeof date!=='string'||!Number.isFinite(Date.parse(date)))throw Error('Missing source date: '+id);
  inputs.push({id,raw:JSON.parse(bytes.toString('utf8'))});sources.push({id,sha256:hash(bytes),bytes:bytes.byteLength,date,bbox});
  const sw=toLocal(bbox[1],bbox[0]),ne=toLocal(bbox[3],bbox[2]);sourceBounds.push([...sw,...ne]);
}
if(flags.includes('--seed-existing'))await add('napoli-centro-verified','data/napoli-centro.osm.json','data/source.json',true);
const staging=resolve(argument('--input')??'data/city-sectors');
try{
  for(const directory of(await readdir(staging,{withFileTypes:true})).filter(d=>d.isDirectory()&&/^napoli-[ew]\d+-[ns]\d+$/.test(d.name)).sort((a,b)=>a.name.localeCompare(b.name)))await add(directory.name,`${staging}/${directory.name}/source.osm.json`,`${staging}/${directory.name}/source.json`);
}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const merged=mergeOSMSectors(inputs),geography=extractRealGeography(merged.raw);
if(geography.diagnostics.incompleteWays.length||geography.diagnostics.ambiguousCoastNodes.length)throw Error('Merged geography incomplete or ambiguous.');
const manifest:CitySectorManifest={version:1,status:'geography-only-not-activated',origin:ORIGIN,license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',administrativeBoundaryVerified:false,terrainInstalled:false,landSurfaceInstalled:false,sources,sectors:[]};
const temporary=output+'-partial-'+process.pid;await mkdir(temporary,{recursive:true});
try{
  for(const sector of planNapoliSectors()){
    if(!sourceBounds.some(b=>sector.bounds[0]<b[2]&&sector.bounds[2]>b[0]&&sector.bounds[1]<b[3]&&sector.bounds[3]>b[1]))continue;
    const geometry=validateSectorGeometry(geometryForSector(geography,sector)),bytes=Buffer.from(JSON.stringify(geometry));
    if(bytes.byteLength>8*1024*1024)throw Error('Prepared sector exceeds 8 MiB: '+sector.id);
    await writeFile(`${temporary}/${sector.id}.json`,bytes);
    manifest.sectors.push({id:sector.id,bounds:sector.bounds,path:`${sector.id}.json`,bytes:bytes.byteLength,sha256:hash(bytes),buildings:geometry.buildings.length,roads:geometry.roads.length});
  }
  validateCitySectorManifest(manifest);
  await writeFile(`${temporary}/manifest.json`,JSON.stringify(manifest,null,2));
  await writeFile(`${temporary}/LICENSE-NOTICE.txt`,'© OpenStreetMap contributors — https://www.openstreetmap.org/copyright\nODbL 1.0: https://opendatacommons.org/licenses/odbl/1-0/\nPrepared geometry retains source identities and is not MIT. Original source bytes remain in the source directories recorded by manifest.json. This is geographic staging, not certified playable/fotographic coverage.\n');
  await rename(temporary,output);console.log(JSON.stringify({output,sectors:manifest.sectors.length,...merged.summary,status:manifest.status,activeMapModified:false},null,2));
}catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
