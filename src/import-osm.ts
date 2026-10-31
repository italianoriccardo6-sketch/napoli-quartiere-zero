import convert from 'osmtogeojson';
import {toLocal,parseHeight,inside,type Point,type MapData} from './geo';
// osmtogeojson assembles relation member ways, multipolygons and inner rings.
export function importOSM(raw:unknown):MapData {
const geo=convert(raw,{flatProperties:true});
const map:MapData={provenance:'osm',buildings:[],paths:[],land:[],notice:'Volumi da OpenStreetMap; terreno e dettagli artistici approssimativi.'};
const ring=(r:number[][]):Point[]=>r.map(p=>toLocal(p[0],p[1]));
for(const f of geo.features){
  const tags=f.properties;
  if(tags.building&&tags.building!=='no'){
    const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates as number[][][]]:f.geometry.type==='MultiPolygon'?f.geometry.coordinates as number[][][][]:[];
    for(const [i,p] of polygons.entries()) {
      const rings=p.map(ring).map(r=>r.length>1&&r[0][0]===r.at(-1)![0]&&r[0][1]===r.at(-1)![1]?r.slice(0,-1):r);
      if(rings[0]?.length<3)continue;
      if(rings.slice(1).some(h=>!inside(h[0],rings[0])))throw Error('Cortile non contenuto: '+f.id);
      map.buildings.push({id:f.id+':'+i,rings,...parseHeight(tags),name:tags.name});
    }
  }
  if(tags.highway&&f.geometry.type==='LineString')map.paths.push(ring(f.geometry.coordinates as number[][]));
}
return map;
}
