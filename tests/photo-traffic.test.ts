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
