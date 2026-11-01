import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import convert from 'osmtogeojson';
import clipping from 'polygon-clipping';
import {ORIGIN,toLocal,type Point} from '../src/geo';
import type {CityMapData} from '../src/city-data';
import {validateGreenGround,type GreenGroundArea,type GreenGroundData} from '../src/green-ground';

const clean=(polygons:Point[][][]):Point[][][]=>polygons.map(p=>p.map(r=>{const ring=r.map(q=>[q[0],q[1]] as Point);if(ring.length>1&&ring[0][0]===ring.at(-1)![0]&&ring[0][1]===ring.at(-1)![1])ring.pop();return ring;}));
/** Only mapped park/wood/forest polygons are retained; trees do not create grass areas. */
export function prepareGreenGroundData(rawBytes:Uint8Array,map:CityMapData,source:Record<string,unknown>):GreenGroundData {
  if(source.license!=='ODbL-1.0')throw new Error('Expected the ODbL source extract.');
  const raw=JSON.parse(Buffer.from(rawBytes).toString('utf8')),geo=convert(raw,{flatProperties:true});
  const land=map.city?.landPolygons??map.land.map(r=>[r]);
  if(!land.length)throw new Error('The actual city land is required.');
  const points=land.flatMap(p=>p[0]),bounds=map.city?.bounds??[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))] as [number,number,number,number];
  const [west,south,east,north]=bounds,viewport:Point[][]=[[[west,south],[east,south],[east,north],[west,north]]];
  const areas:GreenGroundArea[]=[];
  for(const feature of geo.features){
    const tags=feature.properties,kind=tags.leisure==='park'?'park':tags.natural==='wood'?'wood':tags.landuse==='forest'?'forest':undefined;
    if(!kind||!/^((way|relation)\/\d+)$/.test(feature.id))continue;
    const coordinates=feature.geometry.type==='Polygon'?[feature.geometry.coordinates as number[][][]]:feature.geometry.type==='MultiPolygon'?feature.geometry.coordinates as number[][][][]:[];
    if(!coordinates.length)continue;
    const local=coordinates.map(p=>p.map(r=>r.map(point=>{
      if(point.length<2||![point[0],point[1]].every(Number.isFinite)||Math.abs(point[0])>180||Math.abs(point[1])>90)throw new Error('Invalid source area coordinate.');
      return toLocal(point[0],point[1]);
    })));
    const clipped=clean(clipping.intersection(local,land,viewport));
    if(clipped.length)areas.push({id:feature.id,...(tags.name?{name:tags.name}:{}),kind,polygons:clipped});
  }
  areas.sort((a,b)=>a.id.localeCompare(b.id));
  const polygons=areas.flatMap(a=>a.polygons),coverage=polygons.length?clean(clipping.union(polygons[0],...polygons.slice(1))):[];
  const data:GreenGroundData={version:1,source:{provider:'OpenStreetMap contributors',license:'ODbL-1.0',copyright:'https://www.openstreetmap.org/copyright',rawPath:'data/napoli-green/source.raw.json',rawSha256:createHash('sha256').update(rawBytes).digest('hex'),retrievedAt:source.retrieved_at??null,bbox:source.bbox??null,bounds:[...bounds],origin:ORIGIN,geometry:'Actual source polygons and inner rings, intersected with city land and viewport; dissolved overlap.',landCover:'Mapped parks, woods and forests use an artistic grass-like surface; no vegetation density or measured plant cover is inferred.'},areas,coverage};
  return validateGreenGround(data);
}

async function main(){
  const [raw,mapText,sourceText]=await Promise.all([readFile('data/napoli-green/source.raw.json'),readFile('public/data/map.json','utf8'),readFile('data/napoli-green/source.json','utf8')]);
  const result=prepareGreenGroundData(raw,JSON.parse(mapText),JSON.parse(sourceText));
  await mkdir('public/data',{recursive:true});await writeFile('public/data/green-ground.json',JSON.stringify(result)+'\n');
  console.log(JSON.stringify({sourceAreas:result.areas.length,coveragePolygons:result.coverage.length,sourceIds:result.areas.map(a=>a.id),rawSha256:result.source.rawSha256}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
