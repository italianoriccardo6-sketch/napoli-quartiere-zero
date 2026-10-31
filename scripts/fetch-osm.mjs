import {mkdir,writeFile} from 'node:fs/promises';
const bbox=[40.8264,14.2462,40.8306,14.2506];
const query=`[out:json][timeout:25];(way[building](${bbox});relation[building](${bbox});way[highway](${bbox});way[natural=coastline](${bbox}););out body;>;out skel qt;`;
await mkdir('data',{recursive:true});
await writeFile('data/query.overpassql',query+'\n');
const failures=[];
for(const endpoint of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']) {
  try {
    const r=await fetch(endpoint,{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(40000),headers:{'User-Agent':'NapoliQuartiereZero/0.1 (small non-commercial demo extract)'}});
    if(!r.ok) throw Error(`HTTP ${r.status}`);
    const text=await r.text(),json=JSON.parse(text);
    if(!Array.isArray(json.elements)||json.remark) throw Error(json.remark??'Formato non valido');
    await writeFile('data/borgo-marinari.osm.json',text);
    await writeFile('data/source.json',JSON.stringify({source:endpoint,date:new Date().toISOString(),bbox,origin:{lat:40.8281,lon:14.2486},license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',copyright:'https://www.openstreetmap.org/copyright',query},null,2));
    console.log(`Salvati ${json.elements.length} elementi. Esegui npm run data:prepare.`); process.exit(0);
  } catch(e) {failures.push(`${endpoint}: ${e.message}`);}
}
console.error('Estrazione non riuscita. Nessun dato provvisorio è stato etichettato OSM.\n'+failures.join('\n'));process.exitCode=1;
