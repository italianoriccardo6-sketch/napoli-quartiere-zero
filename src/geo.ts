export type Point = [number, number];
export const ORIGIN = { lat: 40.8281, lon: 14.2486 };
export function toLocal(lon: number, lat: number): Point {
  return [(lon - ORIGIN.lon) * Math.PI / 180 * 6378137 * Math.cos(ORIGIN.lat * Math.PI / 180), (lat - ORIGIN.lat) * Math.PI / 180 * 6378137];
}
export function inside(p: Point, ring: Point[]): boolean {
  let result = false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if ((a[1]>p[1]) !== (b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0]) result=!result;
  }
  return result;
}
export function segmentDistance(p: Point,a: Point,b: Point): number {
  const dx=b[0]-a[0], dz=b[1]-a[1], d=dx*dx+dz*dz;
  const t=d ? Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/d)) : 0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}
export interface Footprint { id:string; rings:Point[][]; height:number; estimated:boolean; name?:string }
export interface MapData { provenance:'osm'|'provisional'; buildings:Footprint[]; paths:Point[][]; land:Point[][]; notice:string; }
export function parseHeight(tags:Record<string,string>): {height:number;estimated:boolean} {
  const raw=Number.parseFloat(tags.height ?? '');
  if(Number.isFinite(raw)&&raw>0) return {height:Math.min(raw,60),estimated:false};
  const levels=Number.parseFloat(tags['building:levels'] ?? '');
  return {height:Number.isFinite(levels)&&levels>0?Math.min(levels*3.2,60):10,estimated:!Number.isFinite(levels)||levels<=0};
}
