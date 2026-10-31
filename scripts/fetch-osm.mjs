import {mkdir,writeFile} from 'node:fs/promises';
const bbox=process.env.OSM_BBOX?process.env.OSM_BBOX.split(',').map(Number):[40.8264,14.2462,40.8306,14.2506];
if(bbox.length!==4||!bbox.every(Number.isFinite)||bbox[0]>=bbox[2]||bbox[1]>=bbox[3]||bbox[2]-bbox[0]>.025||bbox[3]-bbox[1]>.035)throw new Error('Perimetro non valido o troppo ampio: estrazione limitata a un piccolo settore urbano.');
const output=process.env.OSM_OUTPUT??'data/borgo-marinari.osm.json';
if(!/^data\/[a-z0-9-]+\.osm\.json$/.test(output))throw new Error('Percorso di output non valido.');
const query=`[out:json][timeout:25];(way[building](${bbox});relation[building](${bbox});way[highway](${bbox});way[natural=coastline](${bbox});way[man_made=pier](${bbox});way[historic=castle](${bbox});relation[historic=castle](${bbox}););out body;>;out skel qt;`;
await mkdir('data',{recursive:true});
await writeFile('data/query.overpassql',query+'\n');
const failures=[];
for(const endpoint of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']) {
  try {
    const r=await fetch(endpoint,{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(40000),headers:{'User-Agent':'NapoliQuartiereZero/0.1 (small non-commercial demo extract)'}});
    if(!r.ok) throw Error(`HTTP ${r.status}`);
    const text=await r.text(),json=JSON.parse(text);
    if(!Array.isArray(json.elements)||json.remark) throw Error(json.remark??'Formato non valido');
    if(Buffer.byteLength(text)>16*1024*1024)throw Error('Estratto oltre il limite di 16 MiB');
    await writeFile(output,text);
    await writeFile('data/source.json',JSON.stringify({source:endpoint,date:new Date().toISOString(),bbox,origin:{lat:40.8281,lon:14.2486},license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',copyright:'https://www.openstreetmap.org/copyright',query},null,2));
    console.log(`Salvati ${json.elements.length} elementi in ${output}. Esegui npm run data:prepare.`); process.exit(0);
  } catch(e) {failures.push(`${endpoint}: ${e.message}`);}
}
console.error('Estrazione non riuscita. Nessun dato provvisorio è stato etichettato OSM.\n'+failures.join('\n'));process.exitCode=1;
