import type {CityRuntime} from './city-data';
import type {GroundCheck} from './movement';
import type {Point} from './geo';
import {buildTrafficNetwork,trafficCapsulesOverlap} from './traffic-network';
import {createTrafficSimulation,planTrafficActors,type TrafficSimulationOptions} from './traffic-simulation';

export interface PhotoTrafficOptions extends TrafficSimulationOptions {anchor:Point;maxVehicles?:number}
/** Pure traffic/pursuit reused by the native photographic map; owns no renderers or Google data. */
export function createPhotoTraffic(city:CityRuntime,sourceGround:GroundCheck,options:PhotoTrafficOptions){
  const network=buildTrafficNetwork(city,sourceGround,{anchor:options.anchor}),actors=planTrafficActors(network,sourceGround,{anchor:options.anchor,maxVehicles:options.maxVehicles??4,protectedPoints:[city.spawn,city.pickup,city.delivery,options.player().position]});
  const simulation=createTrafficSimulation(network,sourceGround,actors,options);
  function reportPlayerCollision(impactSpeed:number){
    if(!Number.isFinite(impactSpeed)||Math.abs(impactSpeed)<=3)return false;
    const player=options.player();if(!player.riding)return false;
    if(!actors.some(actor=>trafficCapsulesOverlap(player,actor,.35)))return false;
    simulation.reportIncident('collision');return true;
  }
  return {...simulation,network,reportPlayerCollision};
}
export type {TrafficPlayer,TrafficActor,TrafficSimulationOptions} from './traffic-simulation';
