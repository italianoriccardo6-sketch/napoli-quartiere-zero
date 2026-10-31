import {canStandForCar} from './car';
import type {GroundCheck,GroundPoint} from './movement';
import type {Point} from './geo';

export interface VehicleSize {radius:number;halfLength:number}
export interface VehicleStreetData {
  spawn:Point;
  scooter:Point;
  pickup:Point;
  route?:Point[];
  roads?:Array<{highway:string;points:Point[]}>;
}
export interface VehiclePlacement {car:Point;player:Point;heading:number}
const finite=(...values:number[])=>values.every(Number.isFinite);
const validSize=({radius,halfLength}:VehicleSize)=>finite(radius,halfLength)&&radius>0&&halfLength>=radius;

/** Collision with the same full-body capsule used by canStandForCar. */
export function vehicleBlocksPoint(position:GroundPoint,carCenter:GroundPoint,heading:number,radius:number,halfLength:number,playerRadius:number):boolean {
  if(!finite(position.x,position.z,carCenter.x,carCenter.z,heading,playerRadius)||playerRadius<0||!validSize({radius,halfLength}))return true;
  const extent=halfLength-radius,dx=Math.sin(heading),dz=Math.cos(heading);
  const along=Math.max(-extent,Math.min(extent,(position.x-carCenter.x)*dx+(position.z-carCenter.z)*dz));
  return Math.hypot(position.x-carCenter.x-dx*along,position.z-carCenter.z-dz*along)<radius+playerRadius;
}

/** Find a free disembark/start position beside either side or end of the car. */
export function findPlayerBesideVehicle(carCenter:GroundPoint,heading:number,size:VehicleSize,worldCheck:GroundCheck,preferred?:GroundPoint,playerRadius=.5):Point|null {
  if(!validSize(size)||!finite(carCenter.x,carCenter.z,heading,playerRadius)||playerRadius<0)return null;
  const free=(p:GroundPoint)=>worldCheck(p.x,p.z,playerRadius)&&!vehicleBlocksPoint(p,carCenter,heading,size.radius,size.halfLength,playerRadius);
  if(preferred&&finite(preferred.x,preferred.z)&&Math.hypot(preferred.x-carCenter.x,preferred.z-carCenter.z)<=size.halfLength+1.5&&free(preferred))return[preferred.x,preferred.z];
  const forward={x:Math.sin(heading),z:Math.cos(heading)},right={x:Math.cos(heading),z:-Math.sin(heading)};
  // Clearance includes the person's radius and a visible gap; never use the
  // old fixed 1.7m offset, which sits inside this model's wider body.
  for(const gap of [.25,.5,.75]){
    const side=size.radius+playerRadius+gap;
    for(const along of [0,-.6,.6])for(const sign of [1,-1]){
      const p={x:carCenter.x+right.x*side*sign+forward.x*along,z:carCenter.z+right.z*side*sign+forward.z*along};
      if(free(p))return[p.x,p.z];
    }
    for(const sign of [-1,1]){
      const end=size.halfLength+playerRadius+gap,p={x:carCenter.x+forward.x*end*sign,z:carCenter.z+forward.z*end*sign};
      if(free(p))return[p.x,p.z];
    }
  }
  return null;
}

/**
 * Preserve the preferred street location when the whole real car fits. If it
 * does not, search nearby source-route/road points, never an arbitrary sea or
 * off-map coordinate. Failure is explicit instead of spawning an overlapping car.
 */
export function placeVehicleOnStreet(city:VehicleStreetData,worldCheck:GroundCheck,size:VehicleSize):VehiclePlacement {
  if(!validSize(size)||![...city.spawn,...city.scooter,...city.pickup].every(Number.isFinite))throw new Error('Dimensioni o punti iniziali dell’auto non validi.');
  const preferred={x:city.scooter[0],z:city.scooter[1]};
  const targetHeading=(p:Point)=>Math.atan2(city.pickup[0]-p[0],city.pickup[1]-p[1]);
  const candidates:Array<{p:Point;heading:number;distance:number}>=[];
  const seen=new Set<string>();
  function add(p:Point,heading:number){
    if(!finite(p[0],p[1],heading))return;
    const distance=Math.hypot(p[0]-preferred.x,p[1]-preferred.z);if(distance>60)return;
    const key=Math.round(p[0]*10)+','+Math.round(p[1]*10)+','+Math.round(heading*1000);if(seen.has(key))return;seen.add(key);candidates.push({p:[...p],heading,distance});
  }
  add(city.scooter,targetHeading(city.scooter));
  function addStreet(points:Point[]){
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i];if(![...a,...b].every(Number.isFinite))continue;
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.01)continue;
      const t=Math.max(0,Math.min(1,((preferred.x-a[0])*dx+(preferred.z-a[1])*dz)/(length*length)));
      const projected:Point=[a[0]+dx*t,a[1]+dz*t];
      let heading=Math.atan2(dx,dz);if(Math.cos(heading-targetHeading(projected))<0)heading+=Math.PI;
      add(projected,heading);
      const n=Math.min(100,Math.max(1,Math.ceil(length/3)));
      for(let k=0;k<=n;k++)add([a[0]+dx*k/n,a[1]+dz*k/n],heading);
    }
  }
  addStreet(city.route??[]);
  const allowed=new Set(['residential','tertiary','secondary','primary','service','pedestrian','living_street','unclassified']);
  for(const road of city.roads??[])if(allowed.has(road.highway))addStreet(road.points);
  // The first item is the exact preferred point; the remainder are ordered by
  // their actual metric distance so a failed placement stays close to the start.
  const first=candidates.shift();candidates.sort((a,b)=>a.distance-b.distance);if(first)candidates.unshift(first);
  for(const candidate of candidates){
    const center={x:candidate.p[0],z:candidate.p[1]};
    if(!canStandForCar(center,candidate.heading,worldCheck,size.radius,size.halfLength))continue;
    const player=findPlayerBesideVehicle(center,candidate.heading,size,worldCheck,{x:city.spawn[0],z:city.spawn[1]});
    if(player)return {car:[...candidate.p],player,heading:candidate.heading};
  }
  throw new Error('Non è stato trovato un punto libero sulla strada per l’auto e il personaggio.');
}
