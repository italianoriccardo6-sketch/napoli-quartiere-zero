import {mkdir,writeFile} from 'node:fs/promises';
const bbox=[40.8260,14.2410,40.8420,14.2660];
const query=`[out:json][timeout:25];(node[natural=tree](${bbox});way[natural=tree_row](${bbox});way[leisure=park](${bbox});relation[leisure=park](${bbox});way[natural=wood](${bbox});relation[natural=wood](${bbox});way[landuse=forest](${bbox});relation[landuse=forest](${bbox}););out body geom;`;
const failures=[];
for(const endpoint of ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter']){
 try{
  const response=await fetch(endpoint,{method:'POST',body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(40000),headers:{'User-Agent':'NapoliQuartiereZero/0.4 (bounded public vegetation extract)'}});
  if(!response.ok)throw new Error('HTTP '+response.status);
  if(!response.body)throw new Error('Risposta vuota');
  const chunks=[];let bytes=0;
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>8*1024*1024)throw new Error('Estratto oltre8MiB');chunks.push(chunk);}
  const text=Buffer.concat(chunks).toString('utf8'),raw=JSON.parse(text);
  if(!Array.isArray(raw.elements)||raw.remark)throw new Error(raw.remark??'Formato non valido');
  if(raw.elements.length>10000)throw new Error('Troppi elementi per la piccola estrazione');
  const inBounds=(lon,lat)=>Number.isFinite(lon)&&Number.isFinite(lat)&&lon>=bbox[1]&&lon<=bbox[3]&&lat>=bbox[0]&&lat<=bbox[2];
  const trees=raw.elements.filter(e=>e.type==='node'&&e.tags?.natural==='tree').map(e=>{
   if(!Number.isSafeInteger(e.id)||!inBounds(e.lon,e.lat))throw new Error('Nodo albero non valido o fuori perimetro');
   return {id:'node/'+e.id,lon:e.lon,lat:e.lat,tags:e.tags};
  });
  if(trees.length>4000||new Set(trees.map(t=>t.id)).size!==trees.length)throw new Error('Numero o identificatori alberi non validi');
  const treeRows=raw.elements.filter(e=>e.type==='way'&&e.tags?.natural==='tree_row').map(e=>({id:'way/'+e.id,tags:e.tags,geometry:e.geometry,nodes:e.nodes}));
  const areas=raw.elements.filter(e=>['way','relation'].includes(e.type)&&(e.tags?.leisure==='park'||e.tags?.natural==='wood'||e.tags?.landuse==='forest')).map(e=>({id:e.type+'/'+e.id,name:e.tags?.name,kind:e.tags?.leisure??e.tags?.natural??e.tags?.landuse}));
  const source={provider:'OpenStreetMap contributors',endpoint,retrieved_at:new Date().toISOString(),bbox,origin:{lat:40.8281,lon:14.2486},query,license:'ODbL-1.0',copyright:'https://www.openstreetmap.org/copyright',rawElements:raw.elements.length,treeNodes:trees.length,treeRows:treeRows.length,areas:areas.length,placementPolicy:'Render individual tree nodes only at source coordinates. Tree rows and park polygons do not invent individual planting positions.',modelPolicy:'Tree geometry, absent dimensions and species-dependent crown shape remain original visual approximations.'};
  await mkdir('data/napoli-green',{recursive:true});await mkdir('public/data',{recursive:true});
  await writeFile('data/napoli-green/source.raw.json',text);await writeFile('data/napoli-green/source.json',JSON.stringify(source,null,2)+'\n');
  await writeFile('data/napoli-green/query.overpassql',query+'\n');
  await writeFile('data/napoli-green/LICENSE-NOTICE.md','# Vegetazione OpenStreetMap\n\n© OpenStreetMap contributors — https://www.openstreetmap.org/copyright\nDati originali e derivati sotto ODbL1.0: https://opendatacommons.org/licenses/odbl/1-0/ .\nConservare attribuzione, avvisi e gli obblighi di disponibilità dei dati derivati.\nLa licenza MIT dei modelli procedurali non si applica alle posizioni o agli attributi OSM.\n');
  await writeFile('public/data/green.json',JSON.stringify({version:1,source,trees,treeRows,areas}));
  console.log(JSON.stringify({treeNodes:trees.length,treeRows:treeRows.length,areas:areas.length,bytes,policy:source.placementPolicy},null,2));process.exit(0);
 }catch(error){failures.push(endpoint+': '+error.message);}
}
console.error('Nessuna posizione vegetale è stata inventata.\n'+failures.join('\n'));process.exitCode=1;
