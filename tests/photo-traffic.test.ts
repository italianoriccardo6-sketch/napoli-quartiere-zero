import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import type {CityMapData} from '../src/city-data';
import {createPhotoDrivingSimulation,createPhotoSourceCollision} from '../src/photo-driving';
import {createPhotoTraffic,type TrafficPlayer} from '../src/photo-traffic';
import {trafficCapsulesOverlap} from '../src/traffic-network';
import {canStandForCar} from '../src/vehicle-clearance';

const actual=()=>JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
test('photographic traffic reuses measured source physics without a Babylon scene',()=>{
  const map=actual(),before=JSON.stringify(map),source=createPhotoSourceCollision(map);
  let traffic:ReturnType<typeof createPhotoTraffic>|undefined;
  const driver=createPhotoDrivingSimulation(map,{canStand:(x,z,r)=>traffic?.canStand(x,z,r)??true});
  traffic=createPhotoTraffic(map.city!,source.canStand,{anchor:driver.state.car.position,player:()=>({position:driver.activePosition,heading:driver.state.car.heading,radius:driver.size.radius,halfLength:driver.size.halfLength,riding:true,speed:driver.state.car.speed})});
  assert.ok(traffic.actors.length>=2);assert.ok(traffic.actors.length<=4);assert.equal(traffic.actors.filter(a=>a.role==='patrol').length,1);
  for(let frame=0;frame<750;frame++){
    driver.update(.04,{forward:0,turn:0});traffic.update(.04);
    for(const [i,actor]of traffic.actors.entries()){
      assert.ok(canStandForCar({x:actor.position[0],z:actor.position[1]},actor.heading,source.canStand,actor.radius,actor.halfLength));
      for(const other of traffic.actors.slice(i+1))assert.equal(trafficCapsulesOverlap(actor,other),false);
    }
  }
  assert.ok(traffic.actors.some(a=>a.travelled>20),'native photographic traffic must actually travel on source streets');
  assert.equal(JSON.stringify(map),before);assert.ok(traffic.stats.metresDriven>40);
  assert.equal(traffic.reportPlayerCollision(0),false,'a stopped car beside traffic cannot raise an impact alert');
});
test('photographic collision incidents require a fast nearby full player car',()=>{
  const map=actual(),source=createPhotoSourceCollision(map),driver=createPhotoDrivingSimulation(map);
  let player:TrafficPlayer={position:driver.activePosition,heading:driver.state.car.heading,radius:driver.size.radius,halfLength:driver.size.halfLength,riding:true,speed:0};
  const traffic=createPhotoTraffic(map.city!,source.canStand,{anchor:driver.activePosition,player:()=>player}),actor=traffic.actors[0];assert.ok(actor);
  assert.equal(traffic.reportPlayerCollision(10),false,'a wall impact away from moving cars must not raise an alert');
  player={...player,position:[...actor.position],heading:actor.heading};
  assert.equal(traffic.reportPlayerCollision(2),false);assert.equal(traffic.pursuit.state.level,0);
  player.riding=false;assert.equal(traffic.reportPlayerCollision(8),false);assert.equal(traffic.pursuit.state.level,0);
  player.riding=true;assert.equal(traffic.reportPlayerCollision(8),true);assert.equal(traffic.pursuit.state.level,1);
  traffic.reportPlayerCollision(8);assert.equal(traffic.pursuit.state.heat,30,'existing incident cooldown is preserved');
});

test('photographic traffic and encounter dependency graphs contain no Babylon renderer or asset loader',async()=>{
  const {default:ts}=await import('typescript'),{resolve,dirname,extname}=await import('node:path');
  const visited=new Set<string>();
  function visit(path:string){
    path=resolve(path);if(visited.has(path))return;visited.add(path);
    const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.ESNext,true);
    for(const node of source.statements){
      if(!ts.isImportDeclaration(node)&&!ts.isExportDeclaration(node))continue;
      if(ts.isImportDeclaration(node)&&node.importClause?.isTypeOnly||ts.isExportDeclaration(node)&&node.isTypeOnly)continue;
      const specifier=node.moduleSpecifier;if(!specifier||!ts.isStringLiteral(specifier))continue;
      assert.ok(!specifier.text.startsWith('@babylonjs/'),`Photographic traffic must not import renderer: ${path} -> ${specifier.text}`);
      if(specifier.text.startsWith('.'))visit(resolve(dirname(path),specifier.text)+(extname(specifier.text)?'':'.ts'));
    }
  }
  visit('src/photo-traffic.ts');visit('src/encounter-simulation.ts');assert.ok(visited.size>=5,'the actual transitive graph is inspected');
});

const world=()=>JSON.parse(readFileSync('public/data/photo-world.json','utf8')) as CityMapData;
const districts=()=>JSON.parse(readFileSync('public/data/photo-districts.json','utf8')).districts as Array<{name:string;drive:{position:[number,number];heading:number}}>;
const gap=(a:readonly number[],b:readonly number[])=>Math.hypot(a[0]-b[0],a[1]-b[1]);
function assertValidFleet(traffic:ReturnType<typeof createPhotoTraffic>,ground:(x:number,z:number,r:number)=>boolean,label:string){
  assert.ok(traffic.actors.length>=1&&traffic.actors.length<=traffic.maxVehicles,`${label}: traffic exists within budget`);
  assert.equal(traffic.actors.filter(a=>a.role==='patrol').length,1,`${label}: exactly one patrol`);
  for(const [i,actor]of traffic.actors.entries()){
    assert.ok(canStandForCar({x:actor.position[0],z:actor.position[1]},actor.heading,ground,actor.radius,actor.halfLength),`${label}: full car on source ground`);
    assert.ok(actor.route.length>=2,`${label}: every car has a route on the current graph`);
    for(const other of traffic.actors.slice(i+1))assert.equal(trafficCapsulesOverlap(actor,other),false,`${label}: cars never overlap`);
  }
}

test('shared edge cache reproduces the uncached street graph exactly',async()=>{
  const {buildTrafficNetwork}=await import('../src/traffic-network');
  const map=actual(),source=createPhotoSourceCollision(map),cache=new Map<string,boolean>();
  const anchors=[map.city!.spawn,map.city!.pickup,map.city!.delivery,map.city!.route[Math.floor(map.city!.route.length/2)]];
  const serial=(n:ReturnType<typeof buildTrafficNetwork>)=>JSON.stringify({segments:n.segments,edges:n.validatedEdges,excluded:n.excludedRoads,nodes:[...n.nodes.values()]});
  for(const anchor of anchors){
    const plain=buildTrafficNetwork(map.city!,source.canStand,{anchor});
    assert.ok(plain.validatedEdges>0);
    assert.equal(serial(buildTrafficNetwork(map.city!,source.canStand,{anchor,edgeCache:cache})),serial(plain),'first cached build');
    assert.equal(serial(buildTrafficNetwork(map.city!,source.canStand,{anchor,edgeCache:cache})),serial(plain),'build from a warm cache');
  }
  assert.ok(cache.size>0);
});

test('traffic follows the player into municipal districts and keeps driving there',()=>{
  const map=world(),source=createPhotoSourceCollision(map),driver=createPhotoDrivingSimulation(map);
  let player:TrafficPlayer={position:driver.activePosition,heading:driver.state.car.heading,radius:driver.size.radius,halfLength:driver.size.halfLength,riding:true,speed:0};
  const traffic=createPhotoTraffic(map.city!,source.canStand,{anchor:player.position,player:()=>player});
  assert.equal(traffic.follow(),false,'no relocation while the player stays near the anchor');
  const visited=districts().filter(d=>['Posillipo','Fuorigrotta','Bagnoli','Pianura','Ponticelli'].includes(d.name));
  assert.equal(visited.length,5);
  for(const district of visited){
    player={...player,position:[...district.drive.position],heading:district.drive.heading};
    assert.equal(traffic.follow(),true,`${district.name}: traffic moves with the player`);
    assert.ok(gap(traffic.anchor,district.drive.position)<1e-9);
    assertValidFleet(traffic,source.canStand,district.name);
    for(const actor of traffic.actors){
      assert.ok(gap(actor.position,player.position)>=70,`${district.name}: new cars appear away from the player`);
      assert.ok(gap(actor.position,player.position)<=230,`${district.name}: cars are in the player's area`);
      assert.equal(trafficCapsulesOverlap(actor,player),false);
    }
    const before=traffic.stats.metresDriven;
    for(let frame=0;frame<250;frame++){traffic.update(.04);assert.equal(traffic.follow(),false,'a stationary player does not cause repeated rebuilds');}
    assertValidFleet(traffic,source.canStand,district.name+' after driving');
    assert.ok(traffic.stats.metresDriven-before>40,`${district.name}: relocated traffic actually drives`);
  }
  assert.equal(traffic.relocations,visited.length);
});

test('a short relocation keeps nearby cars where they are and refuses to move an active pursuit',()=>{
  const map=actual(),source=createPhotoSourceCollision(map),driver=createPhotoDrivingSimulation(map);
  let player:TrafficPlayer={position:driver.activePosition,heading:driver.state.car.heading,radius:driver.size.radius,halfLength:driver.size.halfLength,riding:false,speed:0};
  const traffic=createPhotoTraffic(map.city!,source.canStand,{anchor:player.position,player:()=>player});
  for(let frame=0;frame<100;frame++)traffic.update(.04);
  const patrol=traffic.actors.find(a=>a.role==='patrol')!,snapshot={id:patrol.id,position:[...patrol.position],heading:patrol.heading,speed:patrol.speed};
  assert.equal(traffic.relocate(patrol.position),true);
  const kept=traffic.actors.find(a=>a.id===snapshot.id);
  assert.ok(kept,'a car close to the new area is kept, not respawned');
  assert.deepEqual(kept.position,snapshot.position);assert.equal(kept.heading,snapshot.heading);assert.equal(kept.speed,snapshot.speed);
  assert.equal(kept.role,'patrol','the kept patrol keeps its role and beacon');
  assertValidFleet(traffic,source.canStand,'short relocation');

  player={...player,riding:true,position:[...traffic.actors[0].position],heading:traffic.actors[0].heading};
  assert.equal(traffic.reportPlayerCollision(8),true);assert.ok(traffic.pursuit.state.level>0);
  const during=JSON.stringify(traffic.actors),anchor=traffic.anchor;
  player={...player,position:[player.position[0]+400,player.position[1]]};
  assert.equal(traffic.follow(),false,'the patrol never vanishes during a pursuit');
  assert.equal(traffic.relocate(map.city!.delivery),false);
  assert.equal(JSON.stringify(traffic.actors),during);assert.deepEqual(traffic.anchor,anchor);
});
