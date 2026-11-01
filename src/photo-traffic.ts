import type {CityRuntime} from './city-data';
import type {GroundCheck} from './movement';
import type {Point} from './geo';
import {buildTrafficNetwork,onTrafficRoad,trafficCapsulesOverlap,type TrafficNetwork} from './traffic-network';
import {createTrafficSimulation,nextRoute,planTrafficActors,type TrafficActor,type TrafficSimulationOptions} from './traffic-simulation';

export interface PhotoTrafficOptions extends TrafficSimulationOptions {
  anchor:Point;maxVehicles?:number;
  /** Distance from the current anchor beyond which `follow` moves traffic to the player. */
  followDistance?:number;
}
/** Cars kept across a relocation must be this close to the new anchor. */
const KEEP_RADIUS=180;
/** Cars added while the player drives appear at least this far away. */
const RESPAWN_MIN_DISTANCE=70;
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const finitePoint=(p:Point)=>p.length===2&&p.every(Number.isFinite);

/** Pure traffic/pursuit reused by the native photographic map; owns no renderers or Google data. */
export function createPhotoTraffic(city:CityRuntime,sourceGround:GroundCheck,options:PhotoTrafficOptions){
  if(!finitePoint(options.anchor))throw Error('Invalid traffic anchor or budget.');
  const maxVehicles=Math.max(0,Math.min(6,Math.floor(options.maxVehicles??4))),followDistance=options.followDistance??250;
  if(!Number.isFinite(followDistance)||followDistance<50||followDistance>450)throw Error('Invalid traffic follow distance.');
  // Source ground never changes during a session, so validated street segments are reused.
  const edgeCache=new Map<string,boolean>();
  const build=(anchor:Point)=>buildTrafficNetwork(city,sourceGround,{anchor,edgeCache});
  const fixedPoints=()=>[city.spawn,city.pickup,city.delivery,options.player().position];
  let anchor:Point=[...options.anchor],relocations=0;
  const initialNetwork=build(anchor);
  const actors=planTrafficActors(initialNetwork,sourceGround,{anchor,maxVehicles,protectedPoints:fixedPoints()});
  const simulation=createTrafficSimulation(initialNetwork,sourceGround,actors,options);

  /**
   * Rebuilds the street graph around `point`. Cars still near it keep position,
   * heading and speed with a new route on the new graph; free slots are filled
   * with cars placed `minDistance` away. Refused during an alert, so the
   * patrol never vanishes in the middle of a pursuit.
   */
  function relocate(point:Point,{minDistance=30}:{minDistance?:number}={}){
    if(!finitePoint(point)||simulation.pursuit.state.level>0)return false;
    const network:TrafficNetwork=build(point),player=options.player();
    const permitted:GroundCheck=(x,z,r)=>sourceGround(x,z,r)&&onTrafficRoad(network,[x,z],r);
    const kept:TrafficActor[]=[];
    for(const actor of simulation.actors){
      if(distance(actor.position,point)>KEEP_RADIUS||!permitted(actor.position[0],actor.position[1],actor.radius))continue;
      const route=nextRoute(network,actor.position,kept.length+relocations);if(route.length<2)continue;
      kept.push({...actor,route,target:distance(actor.position,route[0])<1.5?1:0,wait:0,blockedSeconds:0});
    }
    const added=planTrafficActors(network,sourceGround,{anchor:point,maxVehicles:maxVehicles-kept.length,minDistance,occupied:kept.map(a=>a.position),ordinalOffset:kept.length+relocations,protectedPoints:fixedPoints()})
      .filter(candidate=>!trafficCapsulesOverlap(candidate,player,1)&&!kept.some(other=>trafficCapsulesOverlap(candidate,other,1)));
    const next=[...kept,...added];
    // Exactly one patrol whenever any car exists; a kept patrol keeps its role.
    const patrol=next.find(a=>a.role==='patrol')??next.at(-1);
    for(const actor of next)actor.role=actor===patrol?'patrol':'civilian';
    if(!simulation.relocate(network,next))return false;
    anchor=[...point];relocations++;return true;
  }
  /** Moves traffic with the player once they have left the current area. */
  function follow(){
    const position=options.player().position;
    if(!finitePoint(position)||distance(position,anchor)<=followDistance)return false;
    return relocate(position,{minDistance:RESPAWN_MIN_DISTANCE});
  }
  function reportPlayerCollision(impactSpeed:number){
    if(!Number.isFinite(impactSpeed)||Math.abs(impactSpeed)<=3)return false;
    const player=options.player();if(!player.riding)return false;
    if(!simulation.actors.some(actor=>trafficCapsulesOverlap(player,actor,.35)))return false;
    simulation.reportIncident('collision');return true;
  }
  return {...simulation,get network(){return simulation.currentNetwork();},get anchor():Point{return [...anchor];},get relocations(){return relocations;},maxVehicles,relocate,follow,reportPlayerCollision};
}
export type {TrafficPlayer,TrafficActor,TrafficSimulationOptions} from './traffic-simulation';
