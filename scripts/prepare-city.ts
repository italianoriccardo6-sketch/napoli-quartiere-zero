import {readFile,writeFile} from 'node:fs/promises';
import {Canvas} from '@napi-rs/canvas';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {extractRealGeography,type RealRoad} from '../src/real-geography';
import {buildNaplesLand} from '../src/land-from-coast';
import {createCityWorld} from '../src/city-world';
import {toLocal,type Point} from '../src/geo';
import type {CityMapData,CityRuntime} from '../src/city-data';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const raw=JSON.parse(await readFile('data/napoli-centro.osm.json','utf8'));
const source=JSON.parse(await readFile('data/source.json','utf8'));
const extracted=extractRealGeography(raw);
if(extracted.diagnostics.incompleteWays.length||extracted.diagnostics.ambiguousCoastNodes.length)throw Error('Geometrie incomplete: revisione necessaria.');
const sw=toLocal(source.bbox[1],source.bbox[0]),ne=toLocal(source.bbox[3],source.bbox[2]);
const bounds:[number,number,number,number]=[...sw,...ne];
const land=buildNaplesLand(extracted.coastlines,bounds);
const buildings=extracted.map.buildings.filter(b=>b.rings[0].some(p=>p[0]>=bounds[0]&&p[0]<=bounds[2]&&p[1]>=bounds[1]&&p[1]<=bounds[3]));
const sourceRoads=extracted.roads;
const roads=sourceRoads.filter(r=>!((r.tunnel&&!['no','false','0'].includes(r.tunnel))||(r.covered&&!['no','false','0'].includes(r.covered))||(r.bridge&&!['no','false','0'].includes(r.bridge))||(r.layer!==undefined&&Number(r.layer)!==0))).filter(r=>r.points.some(p=>p[0]>=bounds[0]&&p[0]<=bounds[2]&&p[1]>=bounds[1]&&p[1]<=bounds[3]));
const detail={roads,coastlines:extracted.coastlines,landPolygons:land.polygons,bounds};
const map:CityMapData={...extracted.map,buildings,paths:roads.map(r=>r.points),land:land.polygons.map(p=>p[0]),notice:'Planimetria e costa OpenStreetMap · volumi generici · terreno piano provvisorio'};
const engine=new NullEngine({renderWidth:800,renderHeight:600,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4});
const scene=new Scene(engine);
try {
  const world=createCityWorld(scene,map,detail);
  const allowed=new Set(['residential','tertiary','secondary','primary','service','pedestrian','living_street','footway','path','cycleway','unclassified']);
  type Node={p:Point;edges:Map<string,{distance:number;road:RealRoad}>};
  const graph=new Map<string,Node>();
  const node=(id:string,p:Point)=>{if(!graph.has(id))graph.set(id,{p,edges:new Map()});return graph.get(id)!;};
  const invalidWays=new Set(raw.elements.filter((e:any)=>e.type==='way'&&(e.tags?.tunnel==='yes'||e.tags?.access==='private')).map((e:any)=>'way/'+e.id));
  for(const road of roads){
    if(!allowed.has(road.highway)||road.access==='private'||invalidWays.has(road.id))continue;
    for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i];
      if(!world.canStand(a[0],a[1],1)||!world.canStand(b[0],b[1],1))continue;
      const distance=Math.hypot(b[0]-a[0],b[1]-a[1]);if(distance<.1)continue;
      let clear=true;const n=Math.ceil(distance/1.5);
      for(let k=1;k<n;k++){const t=k/n;if(!world.canStand(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,1)){clear=false;break;}}
      if(!clear)continue;
      node(road.nodeIds[i-1],a).edges.set(road.nodeIds[i],{distance,road});node(road.nodeIds[i],b).edges.set(road.nodeIds[i-1],{distance,road});
    }
  }
  function candidate(name:string,near:Point){
    let winner:string|undefined,distance=Infinity;
    for(const r of roads.filter(r=>r.name===name))for(const id of r.nodeIds){const n=graph.get(id);if(!n?.edges.size)continue;const d=Math.hypot(n.p[0]-near[0],n.p[1]-near[1]);if(d<distance){distance=d;winner=id;}}
    if(!winner)throw Error('Nessun punto libero verificato su '+name);return winner;
  }
  const start=candidate('Via Santa Lucia',[120,420]),end=candidate('Via Partenope',[-280,290]);
  const costs=new Map([[start,0]]),prev=new Map<string,string>(),open=new Set([start]);
  while(open.size){
    let current=[...open].reduce((a,b)=>costs.get(a)!<costs.get(b)!?a:b);open.delete(current);if(current===end)break;
    for(const [id,edge]of graph.get(current)!.edges){const next=costs.get(current)!+edge.distance;if(next<(costs.get(id)??Infinity)){costs.set(id,next);prev.set(id,current);open.add(id);}}
  }
  if(!prev.has(end))throw Error('Percorso continuo non trovato: nessuna mappa attivata.');
  const ids=[end];while(ids[0]!==start){const p=prev.get(ids[0]);if(!p)throw Error('Percorso incompleto');ids.unshift(p);}
  const route=ids.map(id=>graph.get(id)!.p),routeNames=[...new Set(ids.slice(1).map((id,i)=>graph.get(ids[i])!.edges.get(id)!.road.name).filter((n):n is string=>!!n))];
  function along(distance:number):Point{for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],d=Math.hypot(b[0]-a[0],b[1]-a[1]);if(distance<=d){const t=distance/d;return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}distance-=d;}return route.at(-1)!;}
  const city:CityRuntime={...detail,spawn:along(8),scooter:along(10.2),pickup:route[0],delivery:route.at(-1)!,route,routeNames,sourceDate:source.date,estimatedHeights:buildings.filter(b=>b.estimated).length,heightStatus:'Terreno piano provvisorio; quote regionali non attivate'};
  for(const p of[city.spawn,city.scooter,city.pickup,city.delivery])if(!world.canStand(p[0],p[1],.95))throw Error('Punto missione non libero');
  map.city=city;
  await writeFile('public/data/map.json',JSON.stringify(map));
  await writeFile('public/data/source.json',JSON.stringify(source,null,2));
  await writeFile('data/land-preparation.json',JSON.stringify(land.provenance,null,2));
  await writeFile('data/city-summary.json',JSON.stringify({sourceDate:source.date,source:source.source,bounds,buildings:buildings.length,courtyards:buildings.filter(b=>b.rings.length>1).length,estimatedHeights:city.estimatedHeights,roads:roads.length,sourceRoads:sourceRoads.length,surfaceRoadsExcluded:sourceRoads.length-roads.length,coastlineSourceWays:extracted.coastlines.flatMap(c=>c.sourceIds),coastlinePoints:extracted.coastlines.reduce((n,c)=>n+c.points.length,0),routeMetres:costs.get(end),routeNames,spawn:city.spawn,scooter:city.scooter,pickup:city.pickup,delivery:city.delivery,land:land.provenance,heightStatus:city.heightStatus,representation:'Geometria OSM reale, edifici estrusi generici; non fotorealismo'},null,2));
  console.log(JSON.stringify({buildings:buildings.length,roads:roads.length,routeMetres:Math.round(costs.get(end)!),routeNames,spawn:city.spawn,pickup:city.pickup,delivery:city.delivery},null,2));
}finally{scene.dispose();engine.dispose();}
