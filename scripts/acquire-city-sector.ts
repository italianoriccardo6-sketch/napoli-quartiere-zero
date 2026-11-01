import {mkdir,writeFile,rename,rm,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {planNapoliSectors,sectorQuery,NAPOLI_QUARTIERI,NAPOLI_ACQUISITION_BBOX} from '../src/napoli-sectors';
import {extractRealGeography} from '../src/real-geography';
const sectors=planNapoliSectors(),requested=process.argv.find(a=>a.startsWith('--sector='))?.slice(9),execute=process.argv.includes('--execute');
if(!requested){
  if(execute)throw Error('Specificare un solo --sector=ID. Nessuna acquisizione massiva automatica.');
  console.log(JSON.stringify({status:'planned-not-installed',license:'ODbL-1.0',targetQuartieri:NAPOLI_QUARTIERI,acquisitionEnvelope:NAPOLI_ACQUISITION_BBOX,administrativeBoundaryVerified:false,sectors},null,2));
  process.exit(0);
}
const sector=sectors.find(s=>s.id===requested);if(!sector)throw Error('Settore non previsto dal piano.');
const query=sectorQuery(sector);
if(!execute){console.log(query);process.exit(0);}
// One bounded sector per invocation. Staging never overwrites the active map.
const root='data/city-sectors',destination=`${root}/${sector.id}`,temporary=`${root}/.${sector.id}-${process.pid}`;
await mkdir(root,{recursive:true});
try{await readFile(`${destination}/source.json`);throw Error('Settore già acquisito: conservarlo e revisionare una nuova acquisizione separatamente.');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
await mkdir(temporary);
try{
  const endpoint='https://overpass-api.de/api/interpreter';
  const response=await fetch(endpoint,{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(55000),headers:{'User-Agent':'NapoliQuartiereZero/0.5 (single bounded OSM sector; offline staging)'}});
  if(!response.ok)throw Error(`Overpass HTTP ${response.status}. Nessun retry automatico o cambio endpoint.`);
  if(!response.body)throw Error('Risposta vuota.');
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>16*1024*1024)throw Error('Risposta oltre 16 MiB.');parts.push(value);}}finally{await reader.cancel();}
  const bytes=Buffer.concat(parts),raw=JSON.parse(bytes.toString('utf8'));
  if(!Array.isArray(raw.elements)||raw.remark||!raw.elements.length)throw Error(raw.remark??'Risposta OSM incompleta o vuota.');
  const identities=new Set(raw.elements.map((element:{type:string;id:number})=>`${element.type}/${element.id}`));
  for(const element of raw.elements){
    if(element.type==='way'&&(!Array.isArray(element.nodes)||element.nodes.some((id:number)=>!identities.has(`node/${id}`))))throw Error('Way con riferimenti mancanti: settore respinto.');
    if(element.type==='relation'&&element.tags?.building&&(!Array.isArray(element.members)||element.members.some((member:{type:string;ref:number})=>!identities.has(`${member.type}/${member.ref}`))))throw Error('Edificio multipoligono incompleto: settore respinto.');
  }
  const geography=extractRealGeography(raw);
  if(geography.diagnostics.incompleteWays.length||geography.diagnostics.ambiguousCoastNodes.length)throw Error('Geometrie incomplete/ambigue: settore respinto.');
  await writeFile(`${temporary}/source.osm.json`,bytes);
  await writeFile(`${temporary}/query.overpassql`,query+'\n');
  await writeFile(`${temporary}/source.json`,JSON.stringify({version:1,status:'acquired-not-activated',sector,source:endpoint,date:new Date().toISOString(),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:length,elements:raw.elements.length,buildings:geography.map.buildings.length,roads:geography.roads.length,license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',copyright:'https://www.openstreetmap.org/copyright',administrativeBoundaryVerified:false,terrainInstalled:false,photographicCoverageVerified:false},null,2));
  await writeFile(`${temporary}/LICENSE-NOTICE.md`,'© OpenStreetMap contributors — https://www.openstreetmap.org/copyright\nOpen Database License 1.0: https://opendatacommons.org/licenses/odbl/1-0/\nSource and derived geographic data are not MIT. Preserve source, attribution and ODbL obligations.\n');
  await rename(temporary,destination);console.log(`Settore acquisito in ${destination}. Non è stato attivato nella mappa giocabile.`);
}catch(error){await rm(temporary,{recursive:true,force:true});throw error;}
