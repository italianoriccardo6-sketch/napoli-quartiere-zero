import type {Point} from './geo';
import type {GroundCheck} from './movement';
import {canStandForCar} from './vehicle-clearance';
import {nearestTrafficNode,routeTraffic,onTrafficRoad,trafficCapsulesOverlap,type TrafficCapsule,type TrafficNetwork} from './traffic-network';
import {createPursuitController,type PursuitIncident,type PursuitEvent,type PursuitState} from './pursuit';

export interface TrafficPlayer extends TrafficCapsule {riding:boolean;speed:number}
export interface TrafficActor extends TrafficCapsule {id:string;role:'civilian'|'patrol';route:Point[];target:number;speed:number;maximumSpeed:number;wait:number;travelled:number;blockedSeconds:number}
export interface TrafficSimulationOptions {
  player:()=>TrafficPlayer;
  /** Other live actors, separate from public canStand to avoid recursive collision closures. */
  obstacles?:()=>TrafficCapsule[];
  onEvent?:(event:PursuitEvent,state:Readonly<PursuitState>)=>void;
}
const distance=(a:Point,b:Point)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
const angle=(value:number)=>Math.atan2(Math.sin(value),Math.cos(value));
const finitePoint=(p:Point)=>p.length===2&&p.every(Number.isFinite);
export function nextRoute(network:TrafficNetwork,point:Point,ordinal:number):Point[]{
  const start=nearestTrafficNode(network,point,20);if(!start)return [];
  const goals=[...network.nodes.values()].filter(n=>distance(start.point,n.point)>35&&distance(start.point,n.point)<300).sort((a,b)=>distance(b.point,start.point)-distance(a.point,start.point)||a.id.localeCompare(b.id));
  for(let k=0;k<Math.min(12,goals.length);k++){
    const goal=goals[(k+ordinal*3)%goals.length],route=routeTraffic(network,start.id,goal.id);if(route.length>=2)return route;
  }
  const edge=start.edges[ordinal%start.edges.length];return edge?[[...start.point],[...network.nodes.get(edge.to)!.point]]:[];
}

/**
 * `minDistance` keeps new cars out of the player's immediate surroundings, and
 * `occupied` holds cars that already exist, so a respawn keeps their spacing.
 * `ordinalOffset` keeps the route choice of new cars distinct from kept ones.
 */
export function planTrafficActors(network:TrafficNetwork,ground:GroundCheck,options:{anchor:Point;maxVehicles?:number;protectedPoints?:Point[];minDistance?:number;occupied?:Point[];ordinalOffset?:number}):TrafficActor[]{
  const limit=Math.max(0,Math.min(6,Math.floor(options.maxVehicles??5))),actors:TrafficActor[]=[],minimum=options.minDistance??30,offset=options.ordinalOffset??0;
  if(!finitePoint(options.anchor)||!Number.isFinite(limit)||!Number.isFinite(minimum)||minimum<0||minimum>=220)throw Error('Invalid traffic anchor or budget.');
  const nodes=[...network.nodes.values()].filter(n=>distance(n.point,options.anchor)>=minimum&&distance(n.point,options.anchor)<=220).sort((a,b)=>distance(a.point,options.anchor)-distance(b.point,options.anchor)||a.id.localeCompare(b.id));
  for(const node of nodes){
    if(actors.length>=limit)break;
    if(actors.some(actor=>distance(node.point,actor.position)<22)||(options.occupied??[]).some(p=>distance(p,node.point)<22)||(options.protectedPoints??[]).some(p=>distance(p,node.point)<10))continue;
    const route=nextRoute(network,node.point,actors.length+offset);if(route.length<2||distance(route[0],route[1])<4)continue;
    const heading=Math.atan2(route[1][0]-route[0][0],route[1][1]-route[0][1]),radius=1.3085043,halfLength=2.225;
    const permitted:GroundCheck=(x,z,r)=>ground(x,z,r)&&onTrafficRoad(network,[x,z],r);
    if(!canStandForCar({x:node.point[0],z:node.point[1]},heading,permitted,radius,halfLength))continue;
    actors.push({id:'traffic/'+node.id,role:'civilian',position:[...node.point],heading,radius,halfLength,route,target:1,speed:0,maximumSpeed:4.3+(actors.length%3)*.65,wait:0,travelled:0,blockedSeconds:0});
  }
  // A fictional patrol exists physically from the start, rather than teleporting
  // behind the player when an alert begins. It shares the same road/collision rules.
  if(actors.length)actors[actors.length-1].role='patrol';
  return actors;
}

/** Pure simulation used by the actual rendered cars and by collision regression tests. */
export function createTrafficSimulation(network:TrafficNetwork,ground:GroundCheck,actors:TrafficActor[],options:TrafficSimulationOptions){
  const pursuit=createPursuitController(options.onEvent);let elapsed=0,lastIncident=-Infinity,lastReroute=-Infinity;
  const stats={vehicles:actors.length,civilianVehicles:actors.filter(a=>a.role==='civilian').length,patrolVehicles:actors.filter(a=>a.role==='patrol').length,metresDriven:0,blockedVehicles:0,sourceRoadEdges:network.validatedEdges};
  const permitted:GroundCheck=(x,z,r)=>ground(x,z,r)&&onTrafficRoad(network,[x,z],r);
  const validPlayer=(player:TrafficPlayer)=>finitePoint(player.position)&&[player.heading,player.radius,player.halfLength,player.speed].every(Number.isFinite)&&player.radius>0&&player.halfLength>=player.radius;
  function permits(actor:TrafficActor,position:Point,heading:number,player:TrafficPlayer,margin=0){
    const candidate={position,heading,radius:actor.radius,halfLength:actor.halfLength};
    if(!canStandForCar({x:position[0],z:position[1]},heading,permitted,actor.radius,actor.halfLength))return false;
    if(trafficCapsulesOverlap(candidate,player,margin))return false;
    if(options.obstacles?.().some(obstacle=>trafficCapsulesOverlap(candidate,obstacle,margin)))return false;
    return !actors.some(other=>other!==actor&&trafficCapsulesOverlap(candidate,other,.25+margin));
  }
  /** Caller uses this for player collisions. It deliberately does not call player(). */
  function canStand(x:number,z:number,radius=.5){
    if(![x,z,radius].every(Number.isFinite)||radius<0||!ground(x,z,radius))return false;
    const pedestrian:TrafficCapsule={position:[x,z],heading:0,radius,halfLength:radius};
    return !actors.some(actor=>trafficCapsulesOverlap(pedestrian,actor));
  }
  function reportIncident(incident:PursuitIncident){if(elapsed-lastIncident<4)return;lastIncident=elapsed;pursuit.reportIncident(incident);}
  /**
   * Swaps in a network built around a new area. The actor array is mutated in
   * place, so collision checks and callers holding `actors` see the new cars.
   * Refused during an alert: an active patrol must never vanish or teleport.
   */
  function relocate(nextNetwork:TrafficNetwork,nextActors:TrafficActor[]){
    if(pursuit.state.level>0)return false;
    network=nextNetwork;actors.splice(0,actors.length,...nextActors);
    stats.vehicles=actors.length;stats.civilianVehicles=actors.filter(a=>a.role==='civilian').length;stats.patrolVehicles=actors.filter(a=>a.role==='patrol').length;stats.sourceRoadEdges=network.validatedEdges;stats.blockedVehicles=0;
    return true;
  }
  const currentNetwork=()=>network;
  function update(dt:number){
    if(!Number.isFinite(dt)||dt<=0||dt>.25)return;
    const player=options.player();if(!validPlayer(player))return;elapsed+=dt;
    if(pursuit.state.level>0&&elapsed-lastReroute>=1.5){
      lastReroute=elapsed;const target=nearestTrafficNode(network,player.position);
      for(const actor of actors.filter(a=>a.role==='patrol')){
        const start=nearestTrafficNode(network,actor.position,20);if(!start||!target)continue;
        const route=routeTraffic(network,start.id,target.id);if(route.length>1){actor.route=route;actor.target=distance(actor.position,route[0])<1.5?1:0;actor.wait=0;}
      }
    }
    // Bound translation to <= 0.15 m and capsule-tip rotation to <= 0.18 m
    // at each collision check; the public player controller uses <= 0.20 m.
    const steps=Math.max(1,Math.ceil(dt*8/.15)),step=dt/steps;
    for(let sub=0;sub<steps;sub++)for(const [index,actor]of actors.entries()){
      if(actor.wait>0){actor.wait=Math.max(0,actor.wait-step);actor.speed=Math.max(0,actor.speed-step*5);continue;}
      let target=actor.route[actor.target];
      while(target&&distance(actor.position,target)<1.25&&actor.target<actor.route.length-1)target=actor.route[++actor.target];
      if(!target||distance(actor.position,target)<1.2){
        actor.speed=Math.max(0,actor.speed-step*5);actor.wait=2.5;
        if(actor.role!=='patrol'||pursuit.state.level===0){const route=nextRoute(network,actor.position,index+Math.floor(elapsed/5));if(route.length>1){actor.route=route;actor.target=distance(actor.position,route[0])<1.5?1:0;}}
        continue;
      }
      const desired=Math.atan2(target[0]-actor.position[0],target[1]-actor.position[1]),difference=angle(desired-actor.heading),rotation=Math.max(-Math.min(.08,step*2.1),Math.min(Math.min(.08,step*2.1),difference));
      const heading=angle(actor.heading+rotation),distanceToTarget=distance(actor.position,target),last=actor.target===actor.route.length-1;
      const maximum=(actor.role==='patrol'&&pursuit.state.level>0?Math.min(7.5,actor.maximumSpeed+2):actor.maximumSpeed)*Math.max(.15,Math.cos(difference));
      const desiredSpeed=Math.min(maximum,last?Math.sqrt(Math.max(0,distanceToTarget-1)*5):maximum);
      actor.speed+=Math.max(-step*5,Math.min(step*2.2,desiredSpeed-actor.speed));
      if(!permits(actor,actor.position,heading,player)){actor.speed=0;actor.blockedSeconds+=step;continue;}
      actor.heading=heading;
      const travel=Math.min(actor.speed*step,distanceToTarget),position:Point=[actor.position[0]+Math.sin(heading)*travel,actor.position[1]+Math.cos(heading)*travel];
      // Extra spacing provides braking room before physical capsule contact.
      if(!permits(actor,position,heading,player,Math.min(1.4,actor.speed*.28))){actor.speed=0;actor.blockedSeconds+=step;continue;}
      actor.position=position;actor.travelled+=travel;stats.metresDriven+=travel;actor.blockedSeconds=0;
    }
    const patrols=actors.filter(a=>a.role==='patrol'),nearest=patrols.reduce((d,a)=>Math.min(d,distance(a.position,player.position)),Infinity);
    const visible=patrols.some(actor=>{
      const d=distance(actor.position,player.position);if(d>110)return false;
      const count=Math.max(1,Math.ceil(d/3));for(let i=1;i<count;i++){const t=i/count;if(!ground(actor.position[0]+(player.position[0]-actor.position[0])*t,actor.position[1]+(player.position[1]-actor.position[1])*t,.1))return false;}return true;
    });
    pursuit.update(dt,{nearestPatrol:nearest,visible,playerSpeed:player.speed});
    stats.blockedVehicles=actors.filter(a=>a.blockedSeconds>1).length;
  }
  return {actors,stats,pursuit,update,canStand,reportIncident,relocate,currentNetwork};
}

