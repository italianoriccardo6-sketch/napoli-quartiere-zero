import {ORIGIN,inside,segmentDistance,type Footprint,type MapData,type Point} from './geo';
import {moveOnGround,type GroundCheck} from './movement';
import type {CityMapData,CityRuntime} from './city-data';

export interface PhotoVehicleSize {radius:number;halfLength:number}
export interface PhotoDrivingInput {forward:number;turn:number;run?:boolean;/** Radians, north=0, positive clockwise. */viewHeading?:number}
export interface PhotoDrivingActor {position:Point;heading:number;height:number|null}
export interface PhotoDrivingState {
  mode:'car'|'foot';viewHeading:number;car:PhotoDrivingActor&{speed:number};player:PhotoDrivingActor;
  collision:boolean;travelled:number;scope:'installed-source-geography';
}
export interface PhotoDrivingOptions {
  carRadius?:number;carHalfLength?:number;playerRadius?:number;
  /** Additional dynamic obstacles. Source boundaries and buildings are always enforced. */
  canStand?:GroundCheck;
  /** Caller supplies its documented vertical reference; absent data stays unknown. */
  heightAt?:(x:number,z:number)=>number|null;
  opening?:{car:Point;player?:Point;heading:number};
}
type Bounds=[number,number,number,number];
const CELL=48,finite=(...values:number[])=>values.every(Number.isFinite);
const validPoint=(point:Point)=>point.length===2&&point.every(Number.isFinite);
const boundsOf=(ring:readonly Point[]):Bounds=>{
  const bounds:Bounds=[Infinity,Infinity,-Infinity,-Infinity];for(const [x,z]of ring){bounds[0]=Math.min(bounds[0],x);bounds[1]=Math.min(bounds[1],z);bounds[2]=Math.max(bounds[2],x);bounds[3]=Math.max(bounds[3],z);}return bounds;
};
const overlap=(a:Bounds,b:Bounds)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
const clonePoint=(p:Point):Point=>[p[0],p[1]];
function cleanRing(ring:Point[]):Point[]{
  if(!Array.isArray(ring)||ring.length>100000||ring.some(p=>!Array.isArray(p)||!validPoint(p)))throw Error('Geometria geografica non valida.');
  const points=ring.filter((p,i)=>!i||Math.hypot(p[0]-ring[i-1][0],p[1]-ring[i-1][1])>1e-6).map(clonePoint);
  if(points.length>1&&Math.hypot(points[0][0]-points.at(-1)![0],points[0][1]-points.at(-1)![1])<1e-6)points.pop();return points;
}
class Grid<T>{
  private cells=new Map<string,Set<T>>();
  constructor(private bounds:Bounds){}
  insert(value:T,area:Bounds){
    if(!overlap(area,this.bounds))return;
    const a=Math.floor(Math.max(area[0],this.bounds[0])/CELL),b=Math.floor(Math.max(area[1],this.bounds[1])/CELL),c=Math.floor(Math.min(area[2],this.bounds[2])/CELL),d=Math.floor(Math.min(area[3],this.bounds[3])/CELL);
    if((c-a+1)*(d-b+1)>200000)throw Error('Indice geografico oltre il limite.');
    for(let x=a;x<=c;x++)for(let z=b;z<=d;z++){const key=x+','+z,cell=this.cells.get(key)??new Set<T>();cell.add(value);this.cells.set(key,cell);}
  }
  query(area:Bounds){
    const found=new Set<T>();for(let x=Math.floor(area[0]/CELL);x<=Math.floor(area[2]/CELL);x++)for(let z=Math.floor(area[1]/CELL);z<=Math.floor(area[3]/CELL);z++)for(const item of this.cells.get(x+','+z)??[])found.add(item);return found;
  }
}
/** Immutable source collision data, independent from Google photography and from rendering. */
export function createPhotoSourceCollision(map:CityMapData){
  if(map.provenance!=='osm')throw Error('La guida fotografica richiede geografia sorgente verificata.');
  const rawLand=map.city?.landPolygons??map.land.map(r=>[r]);
  const land=rawLand.map(p=>p.map(cleanRing)).filter(p=>p[0]?.length>=3).map(p=>[p[0],...p.slice(1).filter(r=>r.length>=3)]);
  if(!land.length)throw Error('Superficie terrestre sorgente mancante.');
  const landBounds=land.map(p=>boundsOf(p[0]));
  const bounds:Bounds=map.city?[...map.city.bounds]:[Math.min(...landBounds.map(b=>b[0])),Math.min(...landBounds.map(b=>b[1])),Math.max(...landBounds.map(b=>b[2])),Math.max(...landBounds.map(b=>b[3]))];
  if(!bounds.every(Number.isFinite)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3]||(bounds[2]-bounds[0])*(bounds[3]-bounds[1])>500000000)throw Error('Perimetro geografico non valido.');
  const polygons=new Grid<number>(bounds),edges=new Grid<{a:Point;b:Point;bounds:Bounds}>(bounds),buildings=new Grid<{footprint:Footprint;bounds:Bounds}>(bounds);
  for(const [i,polygon]of land.entries()){
    polygons.insert(i,landBounds[i]);for(const ring of polygon)ring.forEach((a,j)=>{const b=ring[(j+1)%ring.length],area=boundsOf([a,b]);edges.insert({a,b,bounds:area},area);});
  }
  for(const source of map.buildings){
    const rings=source.rings.map(cleanRing);if(rings[0]?.length<3)throw Error('Sagoma edificio non valida.');
    const footprint={...source,rings:[rings[0],...rings.slice(1).filter(r=>r.length>=3)]},area=boundsOf(rings[0]);buildings.insert({footprint,bounds:area},area);
  }
  const insideLand=(p:Point)=>[...polygons.query([p[0],p[1],p[0],p[1]])].some(i=>inside(p,land[i][0])&&!land[i].slice(1).some(h=>inside(p,h)));
  const canStand:GroundCheck=(x,z,radius=.55)=>{
    if(!finite(x,z,radius)||radius<0||radius>50||x-radius<bounds[0]||z-radius<bounds[1]||x+radius>bounds[2]||z+radius>bounds[3])return false;
    const p:Point=[x,z],area:Bounds=[x-radius,z-radius,x+radius,z+radius];if(!insideLand(p))return false;
    // A common edge between adjacent land polygons is traversable, unlike water holes.
    for(const edge of edges.query(area)){
      if(!overlap(area,edge.bounds)||segmentDistance(p,edge.a,edge.b)>=radius)continue;
      const dx=edge.b[0]-edge.a[0],dz=edge.b[1]-edge.a[1],length2=dx*dx+dz*dz;if(!length2)continue;
      const t=Math.max(0,Math.min(1,((x-edge.a[0])*dx+(z-edge.a[1])*dz)/length2)),qx=edge.a[0]+dx*t,qz=edge.a[1]+dz*t,length=Math.sqrt(length2),epsilon=.025;
      if(!(insideLand([qx-dz/length*epsilon,qz+dx/length*epsilon])&&insideLand([qx+dz/length*epsilon,qz-dx/length*epsilon])))return false;
    }
    for(const {footprint:b,bounds:box}of buildings.query(area)){
      if(!overlap(area,box))continue;if(inside(p,b.rings[0])&&!b.rings.slice(1).some(h=>inside(p,h)))return false;
      for(const ring of b.rings)for(let i=0;i<ring.length;i++)if(segmentDistance(p,ring[i],ring[(i+1)%ring.length])<radius)return false;
    }
    return true;
  };
  return {canStand,bounds,stats:{buildings:map.buildings.length,landPolygons:land.length,source:'OpenStreetMap',googleMeshUsed:false as const}};
}
/** Full normalized CarConcept capsule, sampled as overlapping source-clearance circles. */
export function photoCarCanStand(position:Point,heading:number,ground:GroundCheck,size:PhotoVehicleSize={radius:1.3085043,halfLength:2.225}){
  if(!validPoint(position)||!finite(heading,size.radius,size.halfLength)||size.radius<=0||size.radius>20||size.halfLength<size.radius||size.halfLength>30)return false;
  const extent=size.halfLength-size.radius,steps=Math.max(1,Math.ceil(extent*2/Math.min(size.radius*.45,.35))),dx=Math.sin(heading),dz=Math.cos(heading);
  for(let i=0;i<=steps;i++){const along=-extent+extent*2*i/steps;if(!ground(position[0]+dx*along,position[1]+dz*along,size.radius))return false;}return true;
}
export function photoCarBlocksPoint(point:Point,car:Point,heading:number,size:PhotoVehicleSize,radius:number){
  const extent=size.halfLength-size.radius,dx=Math.sin(heading),dz=Math.cos(heading),along=Math.max(-extent,Math.min(extent,(point[0]-car[0])*dx+(point[1]-car[1])*dz));
  return Math.hypot(point[0]-car[0]-dx*along,point[1]-car[1]-dz*along)<size.radius+radius;
}
function besideCar(car:Point,heading:number,size:PhotoVehicleSize,ground:GroundCheck,radius:number,preferred?:Point):Point|null{
  const clear=(p:Point)=>ground(...p,radius)&&!photoCarBlocksPoint(p,car,heading,size,radius);
  if(preferred&&Math.hypot(preferred[0]-car[0],preferred[1]-car[1])<size.halfLength+1.5&&clear(preferred))return clonePoint(preferred);
  const forward:Point=[Math.sin(heading),Math.cos(heading)],right:Point=[Math.cos(heading),-Math.sin(heading)];
  for(const gap of [.25,.5,.75]){
    for(const along of [0,-.6,.6])for(const sign of [1,-1]){
      const side=size.radius+radius+gap,p:Point=[car[0]+right[0]*side*sign+forward[0]*along,car[1]+right[1]*side*sign+forward[1]*along];if(clear(p))return p;
    }
    for(const sign of [-1,1]){const end=size.halfLength+radius+gap,p:Point=[car[0]+forward[0]*end*sign,car[1]+forward[1]*end*sign];if(clear(p))return p;}
  }
  return null;
}
function preferredOpening(city:CityRuntime){
  const roads=city.roads.filter(r=>r.name==='Via Partenope'&&r.highway==='residential'),fallback=city.roads.filter(r=>r.name==='Via Partenope'&&r.highway==='pedestrian');
  let best:{point:Point;heading:number;length:number}|undefined;
  for(const road of roads.length?roads:fallback)for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(length<=20||best&&length<=best.length)continue;
    const point:Point=[(a[0]+b[0])/2,(a[1]+b[1])/2];let heading=Math.atan2(b[0]-a[0],b[1]-a[1]);const toBar=Math.atan2(city.pickup[0]-point[0],city.pickup[1]-point[1]);if(Math.cos(heading-toBar)<0)heading+=Math.PI;best={point,heading,length};
  }
  return best?{car:best.point,player:city.spawn,heading:best.heading}:{car:city.scooter,player:city.spawn,heading:Math.atan2(city.pickup[0]-city.scooter[0],city.pickup[1]-city.scooter[1])};
}
function velocity(speed:number,throttle:number,dt:number){
  if(throttle>0)return Math.min(11,speed+dt*(speed<0?13:4.5));if(throttle<0)return Math.max(-3,speed-dt*(speed>0?15:3));return Math.abs(speed)<dt*1.7?0:speed-Math.sign(speed)*dt*1.7;
}
export function createPhotoDrivingSimulation(map:CityMapData,options:PhotoDrivingOptions={}){
  const source=createPhotoSourceCollision(map),size={radius:options.carRadius??1.3085043,halfLength:options.carHalfLength??2.225},playerRadius=options.playerRadius??.5;
  if(!finite(size.radius,size.halfLength,playerRadius)||size.radius<=0||size.radius>20||size.halfLength<size.radius||size.halfLength>30||playerRadius<=0||playerRadius>5)throw Error('Dimensioni di guida non valide.');
  const canStand:GroundCheck=(x,z,r)=>source.canStand(x,z,r)&&(options.canStand?.(x,z,r)??true);
  const opening=options.opening??(map.city?preferredOpening(map.city):undefined);if(!opening||!validPoint(opening.car)||!finite(opening.heading))throw Error('Partenza geografica mancante.');
  function placement(){
    const candidates:Array<{point:Point;heading:number;distance:number}>=[],seen=new Set<string>();
    function add(point:Point,heading:number){const distance=Math.hypot(point[0]-opening!.car[0],point[1]-opening!.car[1]);if(distance>60||!validPoint(point)||!Number.isFinite(heading))return;const id=point[0].toFixed(2)+','+point[1].toFixed(2)+','+heading.toFixed(3);if(seen.has(id))return;seen.add(id);candidates.push({point:clonePoint(point),heading,distance});}
    add(opening!.car,opening!.heading);
    for(const road of map.city?.roads??[])if(['residential','tertiary','secondary','primary','service','pedestrian','living_street','unclassified'].includes(road.highway))for(let i=1;i<road.points.length;i++){
      const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<.01)continue;
      const t=Math.max(0,Math.min(1,((opening!.car[0]-a[0])*dx+(opening!.car[1]-a[1])*dz)/(length*length))),projection:Point=[a[0]+dx*t,a[1]+dz*t];let heading=Math.atan2(dx,dz);if(Math.cos(heading-opening!.heading)<0)heading+=Math.PI;add(projection,heading);
      const count=Math.min(100,Math.max(1,Math.ceil(length/3)));for(let k=0;k<=count;k++)add([a[0]+dx*k/count,a[1]+dz*k/count],heading);
    }
    candidates.sort((a,b)=>a.distance-b.distance);
    for(const candidate of candidates){if(!photoCarCanStand(candidate.point,candidate.heading,canStand,size))continue;const player=besideCar(candidate.point,candidate.heading,size,canStand,playerRadius,opening!.player);if(player)return {car:candidate.point,player,heading:candidate.heading};}
    return null;
  }
  const initial=placement();if(!initial)throw Error('Non c’è una partenza libera per auto e personaggio.');
  const sample=(p:Point)=>{const height=options.heightAt?.(...p)??null;if(height!==null&&!Number.isFinite(height))throw Error('Quota non valida.');return height;};
  const state:PhotoDrivingState={mode:'car',viewHeading:initial.heading,car:{position:clonePoint(initial.car),heading:initial.heading,speed:0,height:sample(initial.car)},player:{position:clonePoint(initial.car),heading:initial.heading,height:sample(initial.car)},collision:false,travelled:0,scope:'installed-source-geography'};
  const canWalk:GroundCheck=(x,z,r)=>canStand(x,z,r)&&!photoCarBlocksPoint([x,z],state.car.position,state.car.heading,size,r);
  function update(dt:number,input:PhotoDrivingInput){
    if(!Number.isFinite(dt)||dt<=0||dt>.25)return false;
    if(!finite(input.forward,input.turn)||input.viewHeading!==undefined&&!Number.isFinite(input.viewHeading))throw Error('Comandi di guida non validi.');
    const forward=Math.max(-1,Math.min(1,input.forward)),turn=Math.max(-1,Math.min(1,input.turn)),count=Math.max(1,Math.ceil(dt/.02)),step=dt/count;state.collision=false;
    for(let i=0;i<count;i++){
      if(state.mode==='car'){
        state.car.speed=velocity(state.car.speed,forward,step);
        const proposed=state.car.heading+turn*step*1.65*Math.min(Math.abs(state.car.speed)/2,1)*Math.sign(state.car.speed);
        if(photoCarCanStand(state.car.position,proposed,canStand,size))state.car.heading=proposed;else state.collision=true;
        const p={x:state.car.position[0],z:state.car.position[1]},result=moveOnGround(p,{x:Math.sin(state.car.heading)*state.car.speed*step,z:Math.cos(state.car.heading)*state.car.speed*step},size.radius,(x,z)=>photoCarCanStand([x,z],state.car.heading,canStand,size),false,.15);
        state.car.position=[p.x,p.z];state.travelled+=result.distance;if(result.collision){state.car.speed=0;state.collision=true;}
        state.player.position=clonePoint(state.car.position);state.player.heading=state.car.heading;state.viewHeading=state.car.heading;
      }else{
        const heading=input.viewHeading??state.viewHeading;state.viewHeading=heading;const dx=Math.sin(heading)*forward+Math.cos(heading)*turn,dz=Math.cos(heading)*forward-Math.sin(heading)*turn,length=Math.hypot(dx,dz);
        if(length){const p={x:state.player.position[0],z:state.player.position[1]},speed=input.run?5.5:3.1,result=moveOnGround(p,{x:dx/length*speed*step,z:dz/length*speed*step},playerRadius,canWalk,true,.15);state.player.position=[p.x,p.z];state.player.heading=Math.atan2(dx,dz);state.travelled+=result.distance;state.collision||=result.collision;}
      }
    }
    state.car.height=sample(state.car.position);state.player.height=sample(state.player.position);return true;
  }
  function interact():{changed:boolean;reason:'exit'|'enter'|'moving'|'blocked'|'far'}{
    if(state.mode==='car'){
      if(Math.abs(state.car.speed)>=1)return {changed:false,reason:'moving'};
      const point=besideCar(state.car.position,state.car.heading,size,canStand,playerRadius);if(!point)return {changed:false,reason:'blocked'};
      state.car.speed=0;state.player.position=point;state.player.heading=state.car.heading;state.player.height=sample(point);state.viewHeading=state.car.heading;state.mode='foot';return {changed:true,reason:'exit'};
    }
    if(Math.hypot(state.player.position[0]-state.car.position[0],state.player.position[1]-state.car.position[1])>size.halfLength+1.3)return {changed:false,reason:'far'};
    const enterDistance=Math.hypot(state.player.position[0]-state.car.position[0],state.player.position[1]-state.car.position[1]),checks=Math.max(1,Math.ceil(enterDistance/.2));
    for(let i=1;i<checks;i++){const t=i/checks;if(!canStand(state.player.position[0]+(state.car.position[0]-state.player.position[0])*t,state.player.position[1]+(state.car.position[1]-state.player.position[1])*t,.1))return {changed:false,reason:'blocked'};}
    if(!photoCarCanStand(state.car.position,state.car.heading,canStand,size))return {changed:false,reason:'blocked'};
    state.mode='car';state.viewHeading=state.car.heading;state.car.speed=0;state.player.position=clonePoint(state.car.position);state.player.height=state.car.height;state.player.heading=state.car.heading;return {changed:true,reason:'enter'};
  }
  /** Explicit user fast travel. The caller owns quest/pursuit restrictions. */
  function travelTo(position:Point,heading:number):boolean{
    if(!Array.isArray(position)||!validPoint(position)||!Number.isFinite(heading)||!photoCarCanStand(position,heading,canStand,size))return false;
    const foot=besideCar(position,heading,size,canStand,playerRadius);if(!foot)return false;
    // Resolve all fallible height checks before changing any actor or progress.
    let height:number|null;try{height=sample(position);sample(foot);}catch{return false;}
    state.mode='car';state.car.position=clonePoint(position);state.car.heading=heading;state.car.speed=0;state.car.height=height;
    state.player.position=clonePoint(position);state.player.heading=heading;state.player.height=height;state.viewHeading=heading;state.collision=false;
    return true;
  }
  function recover(){const next=placement();if(!next)return false;state.car.position=clonePoint(next.car);state.car.heading=next.heading;state.viewHeading=next.heading;state.car.speed=0;state.player.position=clonePoint(state.mode==='car'?next.car:next.player);state.player.heading=next.heading;state.car.height=sample(state.car.position);state.player.height=sample(state.player.position);state.collision=false;return true;}
  return {state,update,interact,recover,travelTo,canStand,canWalk,canDrive:(position:Point,heading:number)=>photoCarCanStand(position,heading,canStand,size),sourceBounds:source.bounds,size,playerRadius,get activePosition(){return clonePoint(state.mode==='car'?state.car.position:state.player.position);}};
}
export function localToPhotoCoordinate(point:Point,altitude?:number){
  if(!validPoint(point)||altitude!==undefined&&!Number.isFinite(altitude))throw Error('Coordinate della guida non valide.');
  return {lat:ORIGIN.lat+point[1]/6378137*180/Math.PI,lng:ORIGIN.lon+point[0]/(6378137*Math.cos(ORIGIN.lat*Math.PI/180))*180/Math.PI,...(altitude===undefined?{}:{altitude})};
}
export function photoHeadingDegrees(heading:number){if(!Number.isFinite(heading))throw Error('Orientamento della guida non valido.');return ((heading*180/Math.PI)%360+360)%360;}
/** Camera altitude uses only the explicit height supplied by the caller, never guessed datum or Google geometry. */
export function photoGroundFollow(point:Point,heading:number,groundHeight:number,options:{mode?:'car'|'foot';range?:number;tilt?:number;eyeHeight?:number}={}){
  const range=options.range??(options.mode==='foot'?5.5:12),tilt=options.tilt??77,eyeHeight=options.eyeHeight??1.2;
  if(!finite(groundHeight,range,tilt,eyeHeight)||range<2||range>60||tilt<0||tilt>85||eyeHeight<0||eyeHeight>5)throw Error('Camera di guida non valida.');
  return {center:localToPhotoCoordinate(point,groundHeight+eyeHeight),heading:photoHeadingDegrees(heading),range,tilt};
}
