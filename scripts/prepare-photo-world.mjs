/**
 * Rebuild the photographic game's municipal collision world from a pinned,
 * public, OSM-derived Protomaps archive. This never modifies map.json.
 *
 * Extraction tooling (development dependencies only):
 * npm install --save-dev --save-exact pmtiles@4.5.0 @mapbox/vector-tile@3.0.0 pbf@5.1.2
 * node scripts/prepare-photo-world.mjs
 *
 * --source path/to/NAP.zip --tools path/to/tooling can use an existing download.
 * All archive/member hashes are checked before geometry is read. Source tile
 * geometry is cartographic, quantized at z15; it is not survey-quality geometry.
 */
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const URL='https://github.com/Maximilian284/subwaybuilder-it-maps/releases/download/1.4.0/NAP.zip';
const ZIP_SHA='57ef9036fdf84348dd7ce2a72c7c348144873f4c09a9d65e8c36a280fe0df4df';
const PMTILES_SHA='2d2ed152842145a52b16d42210a434350e43f5e014b991dd970662c4272a00b9';
const args=process.argv.slice(2),option=(key,fallback)=>{const i=args.indexOf(key);return i<0?fallback:args[i+1];};
const source=path.resolve(ROOT,option('--source','work/cache/photo-world/NAP.zip'));
const toolsPath=path.resolve(ROOT,option('--tools','.'));
const output=path.resolve(ROOT,option('--output','public/data/photo-world.json'));
const provenancePath=path.resolve(ROOT,option('--provenance','data/photo-world/source.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const generatorSha256=hash(await readFile(fileURLToPath(import.meta.url)));
const baseBytes=await readFile(path.join(ROOT,'public/data/map.json'));
const boundaryBytes=await readFile(path.join(ROOT,'public/data/napoli-boundary.json'));
if(!args.includes('--force'))try {
  const prior=JSON.parse(await readFile(provenancePath,'utf8'));
  if(prior.source?.zipSha256===ZIP_SHA&&prior.source?.memberSha256===PMTILES_SHA&&prior.base?.sha256===hash(baseBytes)&&prior.municipalBoundary?.sha256===hash(boundaryBytes)&&prior.generatorSha256===generatorSha256){
    const bytes=await readFile(output);
    if(prior.output?.sha256===hash(bytes)){console.log(`Photographic world verified from cache (${bytes.length} bytes).`);process.exit(0);}
  }
}catch{/* Cache is optional. A missing/mismatched artifact is rebuilt below. */}
const finitePoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite);
const ORIGIN={lat:40.8281,lon:14.2486},R=6378137,rad=Math.PI/180;
// Millimetre encoding keeps every source vertex and adds less than 0.001 m
// error, far below the vector tile's approximately 0.25 m quantization.
const mm=value=>Math.round(value*1000)/1000;
const local=([lon,lat])=>[mm((lon-ORIGIN.lon)*rad*R*Math.cos(ORIGIN.lat*rad)),mm((lat-ORIGIN.lat)*rad*R)];
const localRing=ring=>ring.map(local);
const boundsOf=points=>points.reduce((b,[x,z])=>[Math.min(b[0],x),Math.min(b[1],z),Math.max(b[2],x),Math.max(b[3],z)],[Infinity,Infinity,-Infinity,-Infinity]);
const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
const rect=([a,b,c,d])=>[[[a,b],[c,b],[c,d],[a,d],[a,b]]];
const polygons=g=>g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
const lineStrings=g=>g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
const lonX=(lon,z)=>Math.floor((lon+180)/360*2**z);
const latY=(lat,z)=>Math.floor((1-Math.asinh(Math.tan(lat*rad))/Math.PI)/2*2**z);
const tileBox=(x,y,z)=>[x/2**z*360-180,Math.atan(Math.sinh(Math.PI*(1-2*(y+1)/2**z)))/rad,(x+1)/2**z*360-180,Math.atan(Math.sinh(Math.PI*(1-2*y/2**z)))/rad];

try {await stat(source);} catch {
  await mkdir(path.dirname(source),{recursive:true});
  // curl honors the environment's configured proxy/CA policy. Never retry
  // through alternate hosts or an unapproved proxy.
  execFileSync('curl',['-fsSL','--retry','2','--max-time','180','--output',source,URL],{stdio:'inherit'});
}
const zip=await readFile(source);if(hash(zip)!==ZIP_SHA)throw Error('Pinned NAP.zip checksum does not match; refusing unreviewed geography.');
const archive=execFileSync('unzip',['-p',source,'NAP.pmtiles'],{maxBuffer:64*1024*1024});
if(hash(archive)!==PMTILES_SHA)throw Error('NAP.pmtiles checksum does not match.');
const requireTools=createRequire(path.join(toolsPath,'package.json'));
const dependency=async name=>import(pathToFileURL(requireTools.resolve(name)).href);
let PMTiles,VectorTile,PbfReader,clip;
try {
  ({PMTiles}=await dependency('pmtiles'));({VectorTile}=await dependency('@mapbox/vector-tile'));
  ({PbfReader}=await dependency('pbf'));clip=(await dependency('polygon-clipping')).default;
} catch(error){throw Error(`Install the documented extraction tooling under ${toolsPath}: ${error.message}`);}
const pm=new PMTiles({getKey:()=>PMTILES_SHA,getBytes:async(offset,length)=>({data:archive.buffer.slice(archive.byteOffset+offset,archive.byteOffset+offset+length)})});
const header=await pm.getHeader(),metadata=await pm.getMetadata();
if(header.maxZoom<15||header.tileType!==1)throw Error('Required z15 vector tiles are not available.');
const base=JSON.parse(baseBytes),boundary=JSON.parse(boundaryBytes);
if(!base.city||base.provenance!=='osm'||boundary.geometry?.type!=='MultiPolygon')throw Error('Expected the reviewed central OSM map and municipal MultiPolygon.');
const municipal=boundary.geometry.coordinates.map(p=>p.map(localRing));
const geoBounds=boundsOf(boundary.geometry.coordinates.flat(2));
const municipalityBounds=boundsOf(municipal.flat(2));
if((municipalityBounds[2]-municipalityBounds[0])*(municipalityBounds[3]-municipalityBounds[1])>500000000)throw Error('Municipality extent exceeds collision budget.');
const central=[...base.city.bounds],centralRect=rect(central),z=15;
const extendedLand=[],extendedBuildings=[],extendedRoads=[];
const placeLabels=new Map();
const stats={tilesVisited:0,tilesRead:0,missingTiles:[],landPatches:0,waterPolygons:0,buildingFeatures:0,buildingPolygons:0,buildingHoles:0,excludedCentralBuildings:0,roads:0,bridgeRoadParts:0,tunnelRoadParts:0};
const tileLineage=[];
function linesInBox(points,box){
  const parts=[];let current=[];
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dz=b[1]-a[1];let first=0,last=1,visible=true;
    for(const [p,q]of [[-dx,a[0]-box[0]],[dx,box[2]-a[0]],[-dz,a[1]-box[1]],[dz,box[3]-a[1]]]){
      if(p===0){if(q<0)visible=false;continue;}
      const t=q/p;if(p<0)first=Math.max(first,t);else last=Math.min(last,t);
    }
    if(!visible||first>last){if(current.length>1)parts.push(current);current=[];continue;}
    const start=[mm(a[0]+first*dx),mm(a[1]+first*dz)],end=[mm(a[0]+last*dx),mm(a[1]+last*dz)];
    if(current.length&&Math.hypot(current.at(-1)[0]-start[0],current.at(-1)[1]-start[1])>.002){if(current.length>1)parts.push(current);current=[];}
    if(!current.length)current.push(start);if(Math.hypot(end[0]-start[0],end[1]-start[1])>.0001)current.push(end);
  }
  if(current.length>1)parts.push(current);return parts;
}
function cleanPolygon(p){
  if(!p[0]||p[0].length<4||p.some(r=>r.some(q=>!finitePoint(q))))return null;
  return [p[0],...p.slice(1).filter(r=>r.length>=4)];
}
function insideRing(point,ring){let result=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])result=!result;}return result;}
const insideMunicipality=point=>municipal.some(p=>insideRing(point,p[0])&&!p.slice(1).some(h=>insideRing(point,h)));
function addRoad(points,feature,tileKey,featureIndex,part){
  if(points.length<2||points.some(p=>!finitePoint(p)))return;
  const box=boundsOf(points);
  if(!overlaps(box,municipalityBounds)||overlaps(box,central))return;
  // Roads retain their supplied interior tile vertices and are used as
  // cartographic guidance, never as a certificate of road clearance.
  const p=feature.properties,kind=p.kind_detail;
  if(typeof kind!=='string'||!['motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary','tertiary_link','residential','living_street','unclassified','service','road','track','pedestrian','footway','steps','path','cycleway'].includes(kind))return;
  const id=`mvt-road/${feature.id??'no-id'}/${tileKey}/${featureIndex}/${part}`;
  extendedRoads.push({id,name:typeof p.name==='string'?p.name:undefined,highway:kind,points,
    ...(typeof p.access==='string'?{access:p.access}:{}),...(p.is_bridge===true?{bridge:'yes'}:{}),...(p.is_tunnel===true?{tunnel:'yes'}:{}),
    ...(typeof p.oneway==='string'?{oneway:p.oneway}:{})});
  stats.roads++;if(p.is_bridge===true)stats.bridgeRoadParts++;if(p.is_tunnel===true)stats.tunnelRoadParts++;
}
for(let x=lonX(geoBounds[0],z);x<=lonX(geoBounds[2],z);x++)for(let y=latY(geoBounds[3],z);y<=latY(geoBounds[1],z);y++){
  const tileKey=`${z}/${x}/${y}`,geoTile=tileBox(x,y,z),tileRect=rect([local([geoTile[0],geoTile[1]])[0],local([geoTile[0],geoTile[1]])[1],local([geoTile[2],geoTile[3]])[0],local([geoTile[2],geoTile[3]])[1]]);
  const coverage=clip.intersection(municipal,tileRect);if(!coverage.length)continue;
  const tileLocalBounds=boundsOf(tileRect[0]);
  stats.tilesVisited++;
  const result=await pm.getZxy(z,x,y);if(!result){stats.missingTiles.push(tileKey);continue;}
  stats.tilesRead++;
  const bytes=new Uint8Array(result.data),tile=new VectorTile(new PbfReader(bytes));
  tileLineage.push({tile:tileKey,sha256:hash(bytes)});
  const places=tile.layers.places;
  for(let i=0;i<(places?.length??0);i++){
    const feature=places.feature(i),p=feature.properties;if(feature.type!==1||typeof p.name!=='string')continue;
    const coordinate=feature.toGeoJSON(x,y,z).geometry.coordinates;
    if(!finitePoint(coordinate))continue;const point=local(coordinate);if(!insideMunicipality(point))continue;
    const id=String(feature.id??`${tileKey}/${i}`);if(placeLabels.has(id))continue;
    placeLabels.set(id,{name:p.name,kind:p.kind,detail:p.kind_detail,point,coordinate,sourceTile:tileKey,sourceFeatureId:feature.id??null});
  }
  const earth=[],water=[];
  for(const layerName of ['earth','water']){
    const layer=tile.layers[layerName];if(!layer)continue;
    for(let i=0;i<layer.length;i++){
      const feature=layer.feature(i);if(feature.type!==3||layerName==='earth'&&feature.properties.kind!=='earth')continue;
      const geometry=feature.toGeoJSON(x,y,z).geometry;
      for(const poly of polygons(geometry)){
        const p=cleanPolygon(poly.map(localRing));if(!p)continue;
        if(layerName==='earth')earth.push(p);else water.push(p);
      }
    }
  }
  // Actual OSM land/coast is mandatory. No municipal/admin polygon is ever
  // promoted to land. A missing earth tile remains unsupported and blocked.
  if(earth.length){
    let land=clip.intersection(earth,coverage);
    if(water.length){land=clip.difference(land,...water);stats.waterPolygons+=water.length;}
    if(land.length){land=clip.difference(land,centralRect);extendedLand.push(...land);stats.landPatches+=land.length;}
  }
  const buildings=tile.layers.buildings;
  for(let i=0;i<(buildings?.length??0);i++){
    const feature=buildings.feature(i);if(feature.type!==3||feature.properties.kind!=='building')continue;
    stats.buildingFeatures++;
    const geometry=feature.toGeoJSON(x,y,z).geometry;
    for(const [part,polygon]of polygons(geometry).entries()){
      const p=cleanPolygon(polygon.map(localRing));if(!p)continue;
      if(overlaps(boundsOf(p[0]),central)){stats.excludedCentralBuildings++;continue;}
      // Clip the tile buffer away. Do not merge holes, simplify rings, or infer
      // absent heights/facades; full supplied rings survive inside coverage.
      const portions=clip.intersection([p],coverage);
      for(const [slice,rings]of portions.entries()){
        if(!cleanPolygon(rings))continue;
        const id=`mvt-building/${feature.id??'no-id'}/${tileKey}/${i}/${part}/${slice}`;
        extendedBuildings.push({id,rings,height:10,estimated:true});
        stats.buildingPolygons++;stats.buildingHoles+=rings.length-1;
      }
    }
  }
  const roads=tile.layers.roads;
  for(let i=0;i<(roads?.length??0);i++){
    const feature=roads.feature(i);if(feature.type!==2)continue;
    const geometry=feature.toGeoJSON(x,y,z).geometry;
    for(const [part,line]of lineStrings(geometry).entries())for(const [slice,points]of linesInBox(line.map(local),tileLocalBounds).entries())addRoad(points,feature,tileKey,i,`${part}-${slice}`);
  }
}
if(stats.tilesRead<150||stats.buildingPolygons<20000||stats.roads<3000||stats.buildingHoles<20||!extendedLand.length)throw Error(`Municipal source extraction failed its coverage checks: ${JSON.stringify(stats)}`);
const landPolygons=[...(base.city.landPolygons??base.land.map(r=>[r])),...extendedLand];
const limitations=[
  'Extended geometry is a derived z15 vector basemap, quantized to approximately 0.23–0.30 m in Naples, then encoded in local millimetres; source map generalization and omissions remain.',
  'MVT feature IDs and source tile references are retained. Output IDs identify derived tile parts and are not advertised as native OSM element IDs.',
  'Municipal border limits supported coverage; it is not treated as a coastline. Actual earth and water polygons determine land.',
  'Roads are cartographic guidance. Bridge/tunnel/access tags are retained where present; missing tags, heights, widths and grade separation are not certified.',
  'All extended building heights are placeholders of 10 m for schema compatibility; collision uses only the measured horizontal rings.',
  'The reviewed central map, its original source IDs, land, mission points and route remain unchanged; extended footprints intersecting its original bounds are excluded.',
  'This covers the municipal dataset extent, not a certification that every street or building is mapped or safe to traverse.'
];
const provenance={
  schemaVersion:1,generatorSha256,source:{url:URL,release:'1.4.0',cityVersion:'1.1.0',releaseDate:'2026-07-18',zipSha256:ZIP_SHA,member:'NAP.pmtiles',memberSha256:PMTILES_SHA,project:'https://github.com/Maximilian284/subwaybuilder-it-maps',manifest:'https://github.com/Maximilian284/subwaybuilder-it-maps/blob/f594a8b63ab7d989d164364e0b1ebcea0b04da04/releases/NAP.json'},
  license:{geometry:'ODbL-1.0',attribution:'© OpenStreetMap contributors',copyright:'https://www.openstreetmap.org/copyright',openDataCommons:'https://opendatacommons.org/licenses/odbl/1-0/',packaging:'MIT, © 2026 Massimiliano Prandi',naturalEarth:'Public domain; source basemap metadata lists Natural Earth for low zoom layers. Extraction uses z15.',municipalBoundary:'CC-BY-4.0',boundaryAttribution:'Fonte: Istat, confini amministrativi non generalizzati al 1 gennaio 2026; conversione CRS e distribuzione l1n00/confini-comuni-istat; ritaglio cartografico al confine di Napoli.'},
  origin:ORIGIN,zoom:z,coordinateEncodingMetres:.001,snapshot:metadata['planetiler:osm:osmosisreplicationtime']??null,
  metadata,base:{path:'public/data/map.json',sha256:hash(baseBytes),bounds:central},municipalBoundary:{path:'public/data/napoli-boundary.json',sha256:hash(boundaryBytes)},
  supportedBbox:geoBounds,localBounds:municipalityBounds,limitations,stats,tiles:tileLineage,placeLabels:[...placeLabels.values()].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0),
  derivation:'Decode checked PMTiles z15; select original municipal coverage; clip tile buffers; preserve polygon holes; subtract mapped water from earth; exclude central rectangle from new land and intersecting new buildings; retain central world exactly. Local coordinates use the unchanged geo.ts origin. No source geometry is synthesized.'
};
const world={...base,buildings:[...base.buildings,...extendedBuildings],paths:base.paths,land:landPolygons.map(p=>p[0]),notice:'Napoli: geografia OSM derivata per collisioni · fotografia Google separata · quote esterne non certificate',city:{...base.city,roads:[...base.city.roads,...extendedRoads],landPolygons,bounds:municipalityBounds,estimatedHeights:base.city.estimatedHeights+extendedBuildings.length,heightStatus:'Dati fotografici esterni; sagome cartografiche OSM. Le altezze degli edifici estesi sono segnaposto e non quote reali.'},photoWorld:{schemaVersion:1,source:provenance.source,license:provenance.license,snapshot:provenance.snapshot,supportedBbox:geoBounds,centralBounds:central,mixedSource:true,stats,limitations,placeLabels:provenance.placeLabels,provenance:'data/photo-world/source.json'}};
await mkdir(path.dirname(output),{recursive:true});await mkdir(path.dirname(provenancePath),{recursive:true});
await writeFile(output,JSON.stringify(world));await writeFile(provenancePath,JSON.stringify({...provenance,output:{path:path.relative(ROOT,output),sha256:hash(await readFile(output)),bytes:(await stat(output)).size}},null,2)+'\n');
console.log(JSON.stringify({output:path.relative(ROOT,output),bytes:(await stat(output)).size,stats,buildings:world.buildings.length,roads:world.city.roads.length,landPolygons:landPolygons.length},null,2));
