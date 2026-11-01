import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const bbox=[40.8260,14.2410,40.8420,14.2660];
const query=`[out:json][timeout:25];(node[highway=street_lamp](${bbox});node[amenity=bench](${bbox});node[amenity=waste_basket](${bbox});node[amenity=drinking_water](${bbox});node[barrier=bollard](${bbox});node[traffic_sign](${bbox}););out body;`;
const maxBytes=4*1024*1024,maxNodes=3000,failures=[],attempts=[];
const sha256=value=>createHash('sha256').update(value).digest('hex');
const matches=tags=>tags?.highway==='street_lamp'||['bench','waste_basket','drinking_water'].includes(tags?.amenity)||tags?.barrier==='bollard'||typeof tags?.traffic_sign==='string';
const inBounds=(lon,lat)=>Number.isFinite(lon)&&Number.isFinite(lat)&&lon>=bbox[1]&&lon<=bbox[3]&&lat>=bbox[0]&&lat<=bbox[2];
// Overpass may queue requests before executing the25s query. GET is supported
// by the same interpreter and avoids a stalled POST path; total request budget
// remains170s inside the four-minute workflow. Data limits never change.
// Current global instance list: https://wiki.openstreetmap.org/wiki/Overpass_API
// Private.coffee is the documented replacement for overpass.kumi.systems.
const requests=[
 {endpoint:'https://overpass.private.coffee/api/interpreter',method:'GET',timeout:70000},
 {endpoint:'https://overpass-api.de/api/interpreter',method:'GET',timeout:70000},
 {endpoint:'https://overpass.private.coffee/api/interpreter',method:'POST',timeout:30000}
];
for(const {endpoint,method,timeout}of requests){
 const started=Date.now(),attempt={endpoint,method,started_at:new Date().toISOString()};attempts.push(attempt);
 console.log('Acquisizione OSM '+method+' '+endpoint+' (limite'+timeout/1000+'s)');
 try{
  const url=method==='GET'?endpoint+'?'+new URLSearchParams({data:query}):endpoint;
  const response=await fetch(url,{method,...(method==='POST'?{body:new URLSearchParams({data:query})}:{}),signal:AbortSignal.timeout(timeout),headers:{'User-Agent':'NapoliQuartiereZero/0.5 (bounded public street furniture extract)'}});
  attempt.httpStatus=response.status;
  if(!response.ok)throw new Error('HTTP '+response.status);
  if(!response.body)throw new Error('Risposta vuota');
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>maxBytes)throw new Error('Estratto oltre4MiB');chunks.push(chunk);}
  const buffer=Buffer.concat(chunks),text=buffer.toString('utf8'),raw=JSON.parse(text);
  if(!Array.isArray(raw.elements)||raw.remark)throw new Error(raw.remark??'Formato non valido');
  if(raw.elements.length>maxNodes)throw new Error('Oltre3000elementi nel piccolo perimetro');
  const unique=new Map();
  for(const element of raw.elements){
   if(element.type!=='node'||!matches(element.tags))continue;
   if(!Number.isSafeInteger(element.id)||element.id<=0||!inBounds(element.lon,element.lat))throw new Error('Nodo arredo non valido o fuori perimetro');
   if(Object.values(element.tags).some(value=>typeof value!=='string'))throw new Error('Attributi OSM non validi');
   const node={id:'node/'+element.id,lon:element.lon,lat:element.lat,tags:element.tags};
   const previous=unique.get(element.id);
   if(previous&&JSON.stringify(previous)!==JSON.stringify(node))throw new Error('Identificatore OSM ripetuto con contenuto diverso');
   unique.set(element.id,node);
  }
  const nodes=[...unique.entries()].sort(([a],[b])=>a-b).map(([,node])=>node);
  if(nodes.length>maxNodes)throw new Error('Numero arredi oltre il limite');
  const counts={street_lamp:0,bench:0,waste_basket:0,drinking_water:0,bollard:0,traffic_sign:0};
  for(const {tags}of nodes){if(tags.highway==='street_lamp')counts.street_lamp++;if(['bench','waste_basket','drinking_water'].includes(tags.amenity))counts[tags.amenity]++;if(tags.barrier==='bollard')counts.bollard++;if(typeof tags.traffic_sign==='string')counts.traffic_sign++;}
  const placementPolicy='Render tagged individual OSM nodes only at their source coordinates. No interpolation, repeated planting or invented furniture locations.';
  const modelPolicy='Dimensions, orientation and detailed appearance without explicit source tags remain original visual estimates; source positions do not prove exact surveyed models.';
  const source={provider:'OpenStreetMap contributors',endpoint,method,retrieved_at:new Date().toISOString(),osm_base_timestamp:raw.osm3s?.timestamp_osm_base??null,bbox,origin:{lat:40.8281,lon:14.2486},query,license:'ODbL-1.0',copyright:'https://www.openstreetmap.org/copyright',rawSha256:sha256(buffer),rawElements:raw.elements.length,nodeCount:nodes.length,counts,placementPolicy,modelPolicy,metadata:{provider:'OpenStreetMap contributors',license:'ODbL-1.0',placementPolicy,modelPolicy}};
  const sourceText=JSON.stringify(source,null,2)+'\n',derivedText=JSON.stringify({version:1,source,nodes})+'\n',queryText=query+'\n';
  const license='# Arredi stradali OpenStreetMap\n\n© OpenStreetMap contributors — https://www.openstreetmap.org/copyright\nDati originali e derivati sotto ODbL1.0: https://opendatacommons.org/licenses/odbl/1-0/ .\nConservare attribuzione, avvisi e gli obblighi di disponibilità dei dati derivati.\nLa licenza dei modelli procedurali non si applica alle posizioni e agli attributi OSM.\n';
  await mkdir('data/napoli-furniture',{recursive:true});await mkdir('public/data',{recursive:true});
  const files=[['data/napoli-furniture/source.raw.json',buffer],['data/napoli-furniture/source.json',sourceText],['data/napoli-furniture/query.overpassql',queryText],['data/napoli-furniture/LICENSE-NOTICE.md',license],['public/data/furniture.json',derivedText]];
  for(const [path,contents]of files)await writeFile(path,contents);
  await writeFile('data/napoli-furniture/SHA256SUMS',files.map(([path,contents])=>sha256(contents)+'  '+path).join('\n')+'\n');
  Object.assign(attempt,{bytes,duration_ms:Date.now()-started,success:true});
  console.log(JSON.stringify({nodeCount:nodes.length,counts,bytes,rawSha256:source.rawSha256,policy:placementPolicy},null,2));process.exitCode=0;break;
 }catch(error){const message=error instanceof Error?error.message:String(error);Object.assign(attempt,{duration_ms:Date.now()-started,success:false,error:message});failures.push(method+' '+endpoint+': '+message);console.error(failures.at(-1));}
}
await mkdir('data/napoli-furniture',{recursive:true});
await writeFile('data/napoli-furniture/acquisition-attempts.json',JSON.stringify({bbox,query,attempts},null,2)+'\n');
if(failures.length===requests.length){console.error('Nessuna posizione di arredo è stata inventata.\n'+failures.join('\n'));process.exitCode=1;}
