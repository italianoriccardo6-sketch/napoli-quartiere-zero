import type {Point} from './geo';

export interface StreetSection {point:Point;miter:Point;distance:number}
const EPS=1e-7;
const length=(a:Point,b:Point)=>Math.hypot(b[0]-a[0],b[1]-a[1]);

/** Shared road cross-sections retain actual source vertices and bound sharp miters. */
export function joinedStreetSections(points:Point[],spacing=3.5):StreetSection[]{
  if(!Number.isFinite(spacing)||spacing<=0)throw new RangeError('Passo stradale non valido.');
  const samples:Point[]=[];
  for(const point of points){
    if(!point.every(Number.isFinite))return [];
    if(!samples.length||length(samples.at(-1)!,point)>=.02)samples.push([...point]);
  }
  if(samples.length<2)return [];
  const source:StreetSection[]=[];let distance=0;
  for(let i=0;i<samples.length;i++){
    if(i)distance+=length(samples[i-1],samples[i]);
    const a=samples[Math.max(0,i-1)],p=samples[i],b=samples[Math.min(samples.length-1,i+1)];
    const before=length(a,p),after=length(p,b);
    const n0:Point=before>EPS?[-(p[1]-a[1])/before,(p[0]-a[0])/before]:[-(b[1]-p[1])/after,(b[0]-p[0])/after];
    const n1:Point=after>EPS?[-(b[1]-p[1])/after,(b[0]-p[0])/after]:n0;
    const nx=n0[0]+n1[0],nz=n0[1]+n1[1],normalLength=Math.hypot(nx,nz);
    const unit:Point=normalLength>EPS?[nx/normalLength,nz/normalLength]:n1;
    const denominator=Math.max(.45,unit[0]*n1[0]+unit[1]*n1[1]);
    source.push({point:p,miter:[unit[0]/denominator,unit[1]/denominator],distance});
  }
  // Subdivide joined edges, not the centerline before calculating the corner.
  const sections:StreetSection[]=[source[0]];
  for(let i=1;i<source.length;i++){
    const a=source[i-1],b=source[i],count=Math.max(1,Math.ceil((b.distance-a.distance)/spacing));
    for(let k=1;k<=count;k++)sections.push(interpolateStreetSection(a,b,k/count));
  }
  return sections;
}
export const offsetStreetSection=(section:StreetSection,distance:number):Point=>[section.point[0]+section.miter[0]*distance,section.point[1]+section.miter[1]*distance];
export function interpolateStreetSection(a:StreetSection,b:StreetSection,t:number):StreetSection {
  return {point:[a.point[0]+(b.point[0]-a.point[0])*t,a.point[1]+(b.point[1]-a.point[1])*t],miter:[a.miter[0]+(b.miter[0]-a.miter[0])*t,a.miter[1]+(b.miter[1]-a.miter[1])*t],distance:a.distance+(b.distance-a.distance)*t};
}
