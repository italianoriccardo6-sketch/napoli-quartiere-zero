import {ORIGIN,toLocal,type Point} from './geo';
export const NAPOLI_QUARTIERI=[
  'San Ferdinando','Chiaia','Posillipo','San Giuseppe','Montecalvario','Avvocata','Mercato','Pendino','Porto','San Lorenzo',
  'Stella','San Carlo all’Arena','Vomero','Arenella','Bagnoli','Fuorigrotta','Soccavo','Pianura','Chiaiano','Piscinola',
  'Vicaria','Scampia','Miano','Secondigliano','San Pietro a Patierno','Poggioreale','Zona Industriale','San Giovanni a Teduccio','Barra','Ponticelli'
] as const;
/** Acquisition envelope, NOT an administrative boundary or a claim of installed coverage. */
export const NAPOLI_ACQUISITION_BBOX=[40.785,14.125,40.925,14.385] as const;
export interface AcquisitionSector {id:string;bounds:[number,number,number,number];bbox:[number,number,number,number]}
export function fromLocal([x,z]:Point):Point{return [ORIGIN.lon+x/(Math.PI/180*6378137*Math.cos(ORIGIN.lat*Math.PI/180)),ORIGIN.lat+z/(Math.PI/180*6378137)];}
/** Fixed local-metre grid: adjacent sectors share exact edges and original OSM IDs. */
export function planNapoliSectors():AcquisitionSector[]{
  const [south,west,north,east]=NAPOLI_ACQUISITION_BBOX,sw=toLocal(west,south),ne=toLocal(east,north),sectors:AcquisitionSector[]=[];
  for(let z=Math.floor(sw[1]/1000);z<Math.ceil(ne[1]/1000);z++)for(let x=Math.floor(sw[0]/1000);x<Math.ceil(ne[0]/1000);x++){
    const bounds:[number,number,number,number]=[Math.max(sw[0],x*1000),Math.max(sw[1],z*1000),Math.min(ne[0],(x+1)*1000),Math.min(ne[1],(z+1)*1000)],a=fromLocal([bounds[0],bounds[1]]),b=fromLocal([bounds[2],bounds[3]]);
    sectors.push({id:`napoli-${x<0?'w':'e'}${Math.abs(x)}-${z<0?'s':'n'}${Math.abs(z)}`,bounds,bbox:[a[1],a[0],b[1],b[0]]});
  }
  return sectors;
}
export function sectorQuery(sector:AcquisitionSector):string{
  const box=sector.bbox.join(',');
  return `[out:json][timeout:35][maxsize:16777216];(way[building](${box});relation[building](${box});way[highway](${box});way[natural=coastline](${box});node[natural=tree](${box});way[landuse](${box});relation[landuse](${box});way[leisure=park](${box});relation[leisure=park](${box});node[highway=street_lamp](${box});node[amenity~"^(bench|waste_basket|drinking_water)$"](${box}););out body;>;out skel qt;`;
}
