import {Scene} from '@babylonjs/core/scene';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import type {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import type {CityRuntime} from './city-data';
import type {Point} from './geo';
import type {GroundCheck} from './movement';
import {createCar} from './car';
import {vehicleSurfacePose} from './vehicle-surface';
import {buildTrafficNetwork} from './traffic-network';

import {createTrafficSimulation,planTrafficActors,type TrafficSimulationOptions} from './traffic-simulation';
export {createTrafficSimulation,planTrafficActors} from './traffic-simulation';
export type {TrafficPlayer,TrafficActor} from './traffic-simulation';
export interface TrafficOptions extends TrafficSimulationOptions {
  anchor:Point;surfaceHeightAt?:(x:number,z:number)=>number;maxVehicles?:number;
}

/** Licensed detailed cars on measured source roads, with original fictional patrol lights. */
export function createCityTraffic(scene:Scene,city:CityRuntime,world:{canStand:GroundCheck;shadows?:Pick<ShadowGenerator,'addShadowCaster'|'removeShadowCaster'>},options:TrafficOptions){
  const network=buildTrafficNetwork(city,world.canStand,{anchor:options.anchor}),actors=planTrafficActors(network,world.canStand,{anchor:options.anchor,maxVehicles:options.maxVehicles,protectedPoints:[city.spawn,city.pickup,city.delivery,options.player().position]});
  const simulation=createTrafficSimulation(network,world.canStand,actors,options);
  const models=actors.map((actor,index)=>({actor,car:createCar(scene,{variant:actor.role==='patrol'?'Pearly Swirly':index%2?'Torched Graphite':'Carmine Candy'}),lights:[] as StandardMaterial[]}));
  let disposed=false,loaded=false;
  const surface=options.surfaceHeightAt??(()=>0);
  function place(){for(const {actor,car,lights}of models){
    const pose=vehicleSurfacePose(...actor.position,actor.heading,{halfLength:actor.halfLength,halfWidth:actor.radius},surface);car.root.position.set(actor.position[0],pose.height,actor.position[1]);car.root.rotation.set(pose.pitch,actor.heading,pose.roll);car.heading=actor.heading;car.velocity=actor.speed;
    for(const [i,material]of lights.entries())material.emissiveColor=simulation.pursuit.state.level>0&&Math.floor(performance.now()/180)%2===i?new Color3(.05,.3,1):Color3.Black();
  }}
  function cleanup(){for(const {car}of models){for(const mesh of car.root.getChildMeshes(false))world.shadows?.removeShadowCaster(mesh,false);car.root.dispose(false,true);}}
  const ready=Promise.allSettled(models.map(async({actor,car,lights})=>{
    await car.ready;car.root.setEnabled(false);actor.radius=car.radius;actor.halfLength=car.halfLength;
    car.root.name=actor.role==='patrol'?'pattuglia fittizia su strada OSM':'traffico su strada OSM';car.root.metadata={...(car.root.metadata??{}),trafficId:actor.id,fictionalPatrol:actor.role==='patrol',routePolicy:'Source OSM centrelines; inferred widths; no real-world traffic or police presence claim.'};
    if(actor.role==='patrol')for(let i=0;i<2;i++){
      const light=MeshBuilder.CreateBox('lampeggiante fittizio '+i,{width:.42,height:.12,depth:.23},scene),material=new StandardMaterial('luce pattuglia '+i,scene);material.diffuseColor=new Color3(.03,.12,.4);material.emissiveColor=Color3.Black();light.material=material;light.parent=car.root;light.position.set(i?-.3:.3,(car.root.metadata?.dimensions?.height??1.16)+.06,0);light.isPickable=false;lights.push(material);
    }
    for(const mesh of car.root.getChildMeshes(false))world.shadows?.addShadowCaster(mesh,false);
  })).then(results=>{
    loaded=true;if(disposed){cleanup();return;}const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected'){disposed=true;cleanup();throw new Error('Impossibile caricare il traffico.',{cause:failed.reason});}place();for(const {car}of models)car.root.setEnabled(true);
  });
  function update(dt:number,time:number){if(!loaded||disposed)return;simulation.update(dt);place();for(const {car,actor}of models)for(const wheel of car.wheels)wheel.rotation.x+=actor.speed*dt*3.5;scene.metadata={...(scene.metadata??{}),movingTraffic:{...simulation.stats,wanted:{...simulation.pursuit.state},representation:'Fictional moving traffic and patrols on original OSM centrelines; horizontal kinematic collisions, not a vehicle dynamics simulator.'}};}
  function dispose(){if(disposed)return;disposed=true;for(const {car}of models)car.root.setEnabled(false);if(loaded)cleanup();}
  scene.onDisposeObservable.addOnce(dispose);
  return {ready,update,dispose,canStand:simulation.canStand,reportIncident:simulation.reportIncident,pursuit:simulation.pursuit,stats:simulation.stats,actors,network};
}
