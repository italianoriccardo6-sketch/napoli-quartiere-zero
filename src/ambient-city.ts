import {Scene} from '@babylonjs/core/scene';
import type {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {createDetailedCharacter} from './character-model';
import {createCar,canStandForCar} from './car';
import {cityRoadWidth} from './city-world';
import {openingStreetData,vehicleBlocksPoint,type VehicleSize} from './vehicle-placement';
import {segmentDistance,type Point} from './geo';
import type {CityRuntime} from './city-data';
import type {GroundCheck} from './movement';

export interface AmbientCarPlacement {
  id:string;roadId:string;segmentIndex:number;sourcePoint:Point;offset:number;position:Point;heading:number;size:VehicleSize;
}
export interface AmbientWalkerPath {id:string;roadId:string;points:Point[];speed:number;phase:number}
export interface AmbientPlan {anchor:Point;protectedPoints:Point[];cars:AmbientCarPlacement[];walkers:AmbientWalkerPath[]}
export interface AmbientOptions {
  anchor?:Point;protectedPoints?:Point[];maxPedestrians?:number;maxCars?:number;carSize?:VehicleSize;
  surfaceHeightAt?:(x:number,z:number)=>number;
  /** Return false around the live player/car if pedestrians should give them space. */
  walkerCanStand?:GroundCheck;
}
const DEFAULT_SIZE:VehicleSize={radius:1.3085043,halfLength:2.225};
const finitePoint=(p:Point)=>p.length===2&&p.every(Number.isFinite);
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
function hash(text:string){let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619);return h>>>0;}
function length(points:Point[]){let total=0;for(let i=1;i<points.length;i++)total+=distance(points[i-1],points[i]);return total;}
function distanceToPath(p:Point,points:Point[]){let best=Infinity;for(let i=1;i<points.length;i++)best=Math.min(best,segmentDistance(p,points[i-1],points[i]));return best;}
function clean(points:Point[]){const out:Point[]=[];for(const p of points){if(!finitePoint(p))return [];if(!out.length||distance(p,out[out.length-1])>1e-5)out.push([...p]);}return out;}

/** Interpolate only between consecutive source path points. */
export function pointOnAmbientPath(points:Point[],travel:number):{point:Point;heading:number} {
  if(points.length<2||!Number.isFinite(travel))throw Error('Percorso ambientale non valido.');
  let remaining=Math.max(0,Math.min(length(points),travel));
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],span=distance(a,b);if(span<1e-8)continue;
    if(remaining<=span||i===points.length-1){const t=Math.min(1,remaining/span);return {point:[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t],heading:Math.atan2(b[0]-a[0],b[1]-a[1])};}
    remaining-=span;
  }
  throw Error('Percorso ambientale privo di lunghezza.');
}
function windowAroundClosest(points:Point[],anchor:Point,maxLength=26):Point[] {
  const cumulative=[0];for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+distance(points[i-1],points[i]));
  const total=cumulative[cumulative.length-1];if(total<=maxLength)return points.map(p=>[...p]);
  let closest=0;for(let i=1;i<points.length;i++)if(distance(points[i],anchor)<distance(points[closest],anchor))closest=i;
  const start=Math.max(0,Math.min(total-maxLength,cumulative[closest]-maxLength/2)),end=start+maxLength;
  return [pointOnAmbientPath(points,start).point,...points.filter((_,i)=>cumulative[i]>start+1e-6&&cumulative[i]<end-1e-6).map(p=>[...p] as Point),pointOnAmbientPath(points,end).point];
}
function parkingGuard(city:CityRuntime,protectedPoints:Point[],worldCheck:GroundCheck,others:AmbientCarPlacement[]):GroundCheck {
  return (x,z,r)=>{
    if(!worldCheck(x,z,r)||protectedPoints.some(p=>Math.hypot(x-p[0],z-p[1])<7+r))return false;
    // Leave room for the playable car along the complete source mission centerline.
    if(distanceToPath([x,z],city.route)<r+1.4)return false;
    return !others.some(car=>vehicleBlocksPoint({x,z},{x:car.position[0],z:car.position[1]},car.heading,car.size.radius,car.size.halfLength,r+.2));
  };
}
export function ambientCarsAllow(plan:AmbientPlan,x:number,z:number,radius:number,ignore?:string):boolean {
  if(![x,z,radius].every(Number.isFinite)||radius<0)return false;
  return !plan.cars.some(car=>car.id!==ignore&&vehicleBlocksPoint({x,z},{x:car.position[0],z:car.position[1]},car.heading,car.size.radius,car.size.halfLength,radius));
}

/** Deterministic decoration on supplied OSM roads; parking offsets are estimates, not mapped spaces. */
export function planAmbientCity(city:CityRuntime,worldCheck:GroundCheck,options:AmbientOptions={}):AmbientPlan {
  const opening=openingStreetData(city),anchor:Point=[...(options.anchor??opening.scooter)];
  if(!finitePoint(anchor))throw Error('Punto iniziale ambientale non valido.');
  const protectedPoints=[city.spawn,city.scooter,city.pickup,city.delivery,anchor,...(options.protectedPoints??[])].filter(finitePoint).map(p=>[...p] as Point);
  const plan:AmbientPlan={anchor,protectedPoints,cars:[],walkers:[]},size=options.carSize??DEFAULT_SIZE;
  if(!Number.isFinite(size.radius)||!Number.isFinite(size.halfLength)||size.radius<=0||size.halfLength<size.radius)throw Error('Ingombro auto ambientale non valido.');
  const budget=(value:number|undefined,fallback:number,max:number)=>Number.isFinite(value)?Math.max(0,Math.min(max,Math.floor(value!))):fallback;
  const maxCars=budget(options.maxCars,2,2),maxPeople=budget(options.maxPedestrians,3,4);
  const roadTypes=new Set(['residential','service','tertiary','secondary','unclassified']);
  const carCandidates:AmbientCarPlacement[]=[];
  for(const road of city.roads){
    if(!roadTypes.has(road.highway))continue;
    const points=clean(road.points),width=cityRoadWidth(road);
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],span=distance(a,b);if(span<8||segmentDistance(anchor,a,b)>155)continue;
      const dx=(b[0]-a[0])/span,dz=(b[1]-a[1])/span;
      const count=Math.min(18,Math.max(1,Math.floor(span/10)));
      for(let k=0;k<count;k++)for(const side of [1,-1])for(const shoulder of [false,true]){
        const t=(k+.5)/count,sourcePoint:Point=[a[0]+dx*span*t,a[1]+dz*span*t];
        const offset=side*(shoulder?width/2+size.radius+.25:Math.max(size.radius+.15,width/2-size.radius-.18));
        const position:Point=[sourcePoint[0]+dz*offset,sourcePoint[1]-dx*offset];
        if(distance(position,anchor)<18||distance(position,anchor)>155)continue;
        const id='parked/'+road.id+'/'+i+'/'+k+'/'+side+'/'+Number(shoulder),heading=Math.atan2(dx,dz)+(hash(id)%2?Math.PI:0);
        carCandidates.push({id,roadId:road.id,segmentIndex:i-1,sourcePoint,offset,position,heading,size:{...size}});
      }
    }
  }
  carCandidates.sort((a,b)=>distance(a.position,anchor)-distance(b.position,anchor)||compare(a.id,b.id));
  for(const car of carCandidates){
    if(plan.cars.length>=maxCars)break;
    if(plan.cars.some(other=>distance(car.position,other.position)<10))continue;
    if(canStandForCar({x:car.position[0],z:car.position[1]},car.heading,parkingGuard(city,protectedPoints,worldCheck,plan.cars),size.radius,size.halfLength))plan.cars.push(car);
  }
  const walkerCandidates:Array<AmbientWalkerPath&{score:number}>=[];
  for(const road of city.roads){
    if(!['footway','pedestrian'].includes(road.highway))continue;
    const points=clean(road.points);if(points.length<2||distanceToPath(anchor,points)>125)continue;
    let run:Point[]=[];
    const finish=()=>{
      if(length(run)>=14){
        const path=windowAroundClosest(run,anchor),id='walker/'+road.id+'/'+walkerCandidates.length;
        walkerCandidates.push({id,roadId:road.id,points:path,speed:.85+(hash(id)%25)/100,phase:.2+(hash(id)%50)/100,score:Math.min(...path.map(p=>distance(p,anchor)))});
      }run=[];
    };
    const add=(point:Point)=>{
      const valid=distance(point,anchor)<150&&worldCheck(point[0],point[1],.4)&&ambientCarsAllow(plan,point[0],point[1],.4)&&!protectedPoints.some(p=>distance(p,point)<6);
      if(valid){if(!run.length||distance(run[run.length-1],point)>1e-6)run.push(point);}else finish();
    };
    for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],steps=Math.max(1,Math.ceil(distance(a,b)/.5));
      for(let k=i===1?0:1;k<=steps;k++)add([a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps]);
    }finish();
  }
  walkerCandidates.sort((a,b)=>a.score-b.score||compare(a.id,b.id));
  for(const candidate of walkerCandidates){
    if(plan.walkers.length>=maxPeople)break;
    if(plan.walkers.some(other=>candidate.points.some(p=>distanceToPath(p,other.points)<5.5)))continue;
    const {score,...path}=candidate;plan.walkers.push(path);
  }
  return plan;
}

export function createAmbientCity(scene:Scene,city:CityRuntime,world:{canStand:GroundCheck;shadows?:Pick<ShadowGenerator,'addShadowCaster'|'removeShadowCaster'>},options:AmbientOptions={}){
  const plan=planAmbientCity(city,world.canStand,options),roots:TransformNode[]=[];
  const pedestrians:Array<{model:ReturnType<typeof createDetailedCharacter>;path:AmbientWalkerPath;travel:number;direction:1|-1;wait:number}>=[];
  let initialized=false,disposed=false,finished=false;
  const surface=(p:Point)=>options.surfaceHeightAt?.(p[0],p[1])??0;
  const loads:Promise<void>[]=[];
  for(const placement of plan.cars){
    const car=createCar(scene);roots.push(car.root);
    loads.push(car.ready.then(()=>{
      placement.size={radius:car.radius,halfLength:car.halfLength};
      const others=plan.cars.filter(c=>c.id!==placement.id);
      if(!canStandForCar({x:placement.position[0],z:placement.position[1]},placement.heading,parkingGuard(city,plan.protectedPoints,world.canStand,others),car.radius,car.halfLength))throw Error('Auto parcheggiata senza spazio libero.');
      car.root.name='auto parcheggiata '+placement.roadId;car.root.position.set(placement.position[0],surface(placement.position),placement.position[1]);car.root.rotation.y=car.heading=placement.heading;
      car.root.metadata={...(car.root.metadata??{}),ambient:true,osmRoadId:placement.roadId,placement:'Estimated roadside offset from original OSM centerline; not an OSM parking-space record.'};
    }));
  }
  for(const path of plan.walkers){
    const model=createDetailedCharacter(scene);roots.push(model.root);
    const entry={model,path,travel:length(path.points)*path.phase,direction:1 as 1|-1,wait:0};pedestrians.push(entry);
    loads.push(model.ready.then(()=>{
      const pose=pointOnAmbientPath(path.points,entry.travel);model.root.name='passante '+path.roadId;model.root.position.set(pose.point[0],surface(pose.point),pose.point[1]);model.root.rotation.y=pose.heading;
      model.root.metadata={...(model.root.metadata??{}),ambient:true,osmRoadId:path.roadId,representation:'Repeated licensed generic civilian model following this source OSM footway/pedestrian polyline.'};
    }));
  }
  const canStand=(x:number,z:number,radius=.5,ignore?:string)=>world.canStand(x,z,radius)&&(disposed||ambientCarsAllow(plan,x,z,radius,ignore));
  function cleanup(){for(const root of roots){for(const mesh of root.getChildMeshes(false))world.shadows?.removeShadowCaster(mesh,false);root.dispose(false,true);}}
  function dispose(){
    if(disposed)return;disposed=true;initialized=false;for(const root of roots)root.setEnabled(false);if(finished)cleanup();
  }
  const ready=Promise.allSettled(loads).then(results=>{
    finished=true;const failure=results.find(r=>r.status==='rejected');
    if(failure){disposed=true;cleanup();throw new Error('Impossibile caricare le comparse della città.',{cause:failure.status==='rejected'?failure.reason:undefined});}
    if(disposed){cleanup();return;}
    for(const root of roots)for(const mesh of root.getChildMeshes(false))if(mesh.getTotalVertices()>0)world.shadows?.addShadowCaster(mesh,false);
    initialized=true;
  });
  function update(dt:number,time:number){
    if(!initialized||disposed||!Number.isFinite(dt)||dt<=0||dt>.25||!Number.isFinite(time))return;
    for(const person of pedestrians){
      const total=length(person.path.points);
      let moving=false;
      if(person.wait>0)person.wait=Math.max(0,person.wait-dt);
      else{
        const next=Math.max(0,Math.min(total,person.travel+person.direction*person.path.speed*dt)),pose=pointOnAmbientPath(person.path.points,next);
        if(canStand(pose.point[0],pose.point[1],.4)&&(options.walkerCanStand?.(pose.point[0],pose.point[1],.4)??true)){
          person.model.root.position.set(pose.point[0],surface(pose.point),pose.point[1]);person.model.root.rotation.y=pose.heading+(person.direction<0?Math.PI:0);moving=Math.abs(next-person.travel)>1e-6;person.travel=next;
        }else person.wait=.5;
        if(next<=0||next>=total){person.direction=person.direction===1?-1:1;person.wait=.6;}
      }
      person.model.animate(time,moving,false);
    }
  }
  return {plan,roots,ready,update,canStand,dispose};
}
