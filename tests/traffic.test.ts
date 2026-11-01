import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Canvas} from '@napi-rs/canvas';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {createCityWorld} from '../src/city-world';
import type {CityMapData,CityRuntime} from '../src/city-data';
import type {Point} from '../src/geo';
import {buildTrafficNetwork,routeTraffic,trafficCapsulesOverlap,onTrafficRoad} from '../src/traffic-network';
import {createTrafficSimulation,planTrafficActors,type TrafficActor,type TrafficPlayer} from '../src/city-traffic';
import {createPursuitController} from '../src/pursuit';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const city=(roads:CityRuntime['roads']):CityRuntime=>({roads,bounds:[-200,-200,200,200],landPolygons:[[ [[-200,-200],[200,-200],[200,200],[-200,200]] ]],spawn:[0,-80],scooter:[0,-75],pickup:[0,-70],delivery:[80,0],route:[[0,-70],[0,0],[80,0]],routeNames:[],sourceDate:'fixture',estimatedHeights:0,heightStatus:'fixture'});
const player=(position:Point):TrafficPlayer=>({position,heading:0,radius:.5,halfLength:.5,riding:false,speed:0});
function actor(id:string,position:Point,route:Point[],heading=0):TrafficActor{return{id,position:[...position],heading,radius:1,halfLength:2,role:'civilian',route,target:1,speed:0,maximumSpeed:5,wait:0,travelled:0,blockedSeconds:0};}

test('traffic graph: source junctions connect, overpasses/private/pedestrian roads and blocked bodies are excluded',()=>{
  const roads=[{id:'a',highway:'residential',points:[[0,-100],[0,0],[0,100]]},{id:'b',highway:'residential',points:[[0,0],[100,0]]},{id:'pedestrian',highway:'pedestrian',points:[[-100,0],[0,0]]},{id:'bridge',highway:'primary',bridge:'yes',points:[[0,-10],[100,-10]]},{id:'private',highway:'service',access:'private',points:[[0,10],[100,10]]}] as CityRuntime['roads'];
  const before=JSON.stringify(roads),network=buildTrafficNetwork(city(roads),(x,z,r)=>!(x>35-r&&x<45+r&&z>-3-r&&z<3+r),{anchor:[0,0],carRadius:1,carHalfLength:2});
  assert.equal(network.validatedEdges,2);assert.equal(network.excludedRoads,3);assert.equal(network.nodes.size,3);
  const nodes=[...network.nodes.values()],start=nodes.find(n=>n.point[1]===-100)!,end=nodes.find(n=>n.point[1]===100)!;
  assert.deepEqual(routeTraffic(network,start.id,end.id),[[0,-100],[0,0],[0,100]]);assert.equal(JSON.stringify(roads),before);
  assert.equal(onTrafficRoad(network,[0,60],1),true);assert.equal(onTrafficRoad(network,[20,60],1),false);
});
test('capsule traffic collisions include perpendicular middle crossings and full body overhangs',()=>{
  const a={position:[0,0] as Point,heading:0,radius:1,halfLength:4};
  assert.equal(trafficCapsulesOverlap(a,{...a,heading:Math.PI/2}),true);
  assert.equal(trafficCapsulesOverlap(a,{...a,position:[0,7.5]}),true);
  assert.equal(trafficCapsulesOverlap(a,{...a,position:[3,0]}),false);
});
test('physical traffic: moves on the real supplied path and stops before a player or another full car',()=>{
  const network=buildTrafficNetwork(city([{id:'road',highway:'residential',width:10,points:[[0,-100],[0,0],[0,100]]}]),()=>true,{anchor:[0,0],carRadius:1,carHalfLength:2});
  const cars=[actor('one',[0,-40],[[0,-40],[0,80]]),actor('two',[0,-12],[[0,-12],[0,80]])],p=player([0,7]);
  const sim=createTrafficSimulation(network,()=>true,cars,{player:()=>p});
  for(let i=0;i<1000;i++){
    sim.update(.04);
    assert.equal(trafficCapsulesOverlap(cars[0],cars[1]),false);for(const car of cars)assert.equal(trafficCapsulesOverlap(car,p),false);
  }
  assert.ok(cars[0].travelled>2);assert.ok(cars[1].travelled>2);assert.ok(cars[1].position[1]<5);
  assert.equal(sim.canStand(cars[0].position[0],cars[0].position[1],.5),false);assert.equal(sim.canStand(30,30,.5),true);
  const before=JSON.stringify(cars);sim.update(NaN);sim.update(1);assert.equal(JSON.stringify(cars),before);
});
test('physical traffic: each substep stays below 0.2 m and refuses a late obstacle',()=>{
  const network=buildTrafficNetwork(city([{id:'road',highway:'residential',width:10,points:[[0,-100],[0,100]]}]),()=>true,{anchor:[0,0],carRadius:1,carHalfLength:2});
  const car=actor('one',[0,-25],[[0,-25],[0,80]]);let barrier=Infinity;
  const sim=createTrafficSimulation(network,(x,z,r)=>z+r<barrier,[car],{player:()=>player([100,100])});
  for(let i=0;i<200;i++)sim.update(.04);assert.ok(car.travelled>4);barrier=car.position[1]+8;
  for(let i=0;i<100;i++)sim.update(.04);
  assert.ok(car.position[1]+car.halfLength<barrier+.01);assert.equal(trafficCapsulesOverlap(car,player([0,barrier+1])),false);
});
test('pursuit: alerts, physical stationary capture and loss of sight produce distinct outcomes',()=>{
  const events:string[]=[],chase=createPursuitController(event=>events.push(event));
  chase.reportIncident('mission');assert.equal(chase.state.level,2);
  for(let i=0;i<200;i++)chase.update(.04,{nearestPatrol:5,visible:true,playerSpeed:3});assert.equal(chase.state.captures,0,'driving past a patrol cannot capture a moving player');
  for(let i=0;i<151;i++)chase.update(.04,{nearestPatrol:5,visible:true,playerSpeed:0});assert.equal(chase.state.captures,1);assert.equal(chase.state.mode,'clear');assert.ok(events.includes('caught'));
  chase.reportIncident('collision');for(let i=0;i<500;i++)chase.update(.04,{nearestPatrol:Infinity,visible:false,playerSpeed:0});assert.equal(chase.state.escapes,1);assert.ok(events.includes('searching'));assert.ok(events.includes('escaped'));
});
test('actual Naples network: bounded moving cars retain source routes and full-body clearance',()=>{
  const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData,source=map.city!,e=new NullEngine({renderWidth:640,renderHeight:480,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(e);
  try{
    const world=createCityWorld(scene,map,source),anchor:Point=[-324.0176206259376,251.2814865680662],network=buildTrafficNetwork(source,world.canStand,{anchor}),actors=planTrafficActors(network,world.canStand,{anchor,maxVehicles:5});
    assert.ok(network.validatedEdges>10);assert.ok(actors.length>=2,'actual map must supply usable physical traffic');assert.ok(actors.length<=5);
    const before=JSON.stringify(map),sim=createTrafficSimulation(network,world.canStand,actors,{player:()=>player(anchor)});
    for(let i=0;i<200;i++)sim.update(.04);
    assert.ok(actors.some(a=>a.travelled>1),'at least one real-source car actually drives');
    for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++)assert.equal(trafficCapsulesOverlap(actors[i],actors[j]),false);
    assert.equal(JSON.stringify(map),before);assert.equal(actors.filter(a=>a.role==='patrol').length,1);
  }finally{scene.dispose();e.dispose();}
});


test('traffic: live NPC obstacles block movement without entering public player collision callbacks',()=>{
  const network=buildTrafficNetwork(city([{id:'road',highway:'residential',width:10,points:[[0,-100],[0,100]]}]),()=>true,{anchor:[0,0],carRadius:1,carHalfLength:2});
  const car=actor('car',[0,-20],[[0,-20],[0,80]]),npc={position:[0,0] as Point,heading:0,radius:.45,halfLength:.45};let obstacleCalls=0;
  const sim=createTrafficSimulation(network,()=>true,[car],{player:()=>player([100,100]),obstacles:()=>{obstacleCalls++;return[npc];}});
  for(let i=0;i<500;i++){sim.update(.04);assert.equal(trafficCapsulesOverlap(car,npc),false);}
  assert.ok(car.travelled>2);assert.ok(car.position[1]<-2);const calls=obstacleCalls;assert.equal(sim.canStand(50,50,.5),true);assert.equal(obstacleCalls,calls,'public canStand must not recurse through NPC obstacles');
});
