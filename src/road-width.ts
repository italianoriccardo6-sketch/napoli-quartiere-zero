/** Estimated visual width in metres when OSM has no explicit width; never changes collision geometry. */
export function cityRoadWidth(road:{highway:string;width?:number}):number {
  if(Number.isFinite(road.width)&&road.width!>0)return Math.min(30,road.width!);
  const widths:Record<string,number>={motorway:13,trunk:11,primary:10,secondary:8,tertiary:7,residential:6,unclassified:5.5,living_street:5,pedestrian:5,service:4.5,footway:2.8,path:2.4,steps:2,track:3.5,cycleway:2.4};
  return widths[road.highway]??4;
}

