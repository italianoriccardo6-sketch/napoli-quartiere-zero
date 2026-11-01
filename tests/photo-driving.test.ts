import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Canvas} from '@napi-rs/canvas';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {createCityWorld} from '../src/city-world';
import {ORIGIN,toLocal,type Point} from '../src/geo';
import type {CityMapData} from '../src/city-data';
import {createPhotoSourceCollision,createPhotoDrivingSimulation,photoCarCanStand,photoCarBlocksPoint,localToPhotoCoordinate,photoHeadingDegrees,photoGroundFollow} from '../src/photo-driving';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const actual=()=>JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
function fixture():CityMapData{return {provenance:'osm',notice:'synthetic fixture only',paths:[],land:[[[-100,-100],[100,-100],[100,100],[-100,100]]],buildings:[{id:'fixture-building',height:10,estimated:false,rings:[[[15,-20],[40,-20],[40,20],[15,20]],[[23,-10],[32,-10],[32,10],[23,10]]]}]};}

test('photo source collision: land holes, building courtyards, shared patch edges and source borders',()=>{
 const map=fixture(),first:Point[]=[[-100,-100],[0,-100],[0,100],[-100,100]],second:Point[]=[[0,-100],[100,-100],[100,100],[0,100]];
 map.city={landPolygons:[[first,[[-70,40],[-50,40],[-50,60],[-70,60]]],[second]],bounds:[-100,-100,100,100],roads:[],spawn:[-10,0],scooter:[-10,0],pickup:[-10,20],delivery:[0,20],route:[],routeNames:[],sourceDate:'fixture',estimatedHeights:0,heightStatus:'fixture'};
 const before=JSON.stringify(map),world=createPhotoSourceCollision(map);
 assert.equal(world.canStand(-60,50,.5),false);assert.equal(world.canStand(-49.8,50,.55),false);
 assert.equal(world.canStand(0,0,.55),true);assert.equal(world.canStand(20,0,.55),false);assert.equal(world.canStand(27,0,.55),true);
 assert.equal(world.canStand(99.8,0,.55),false);assert.equal(world.canStand(NaN,0,.5),false);assert.equal(world.canStand(0,0,Infinity),false);assert.equal(world.canStand(0,0,100),false);
 assert.equal(JSON.stringify(map),before);assert.equal(world.stats.googleMeshUsed,false);
});
test('photo car capsule: nose/tail, side and rotation all checked, bounded movement never tunnels through walls',()=>{
 const map=fixture(),simulation=createPhotoDrivingSimulation(map,{opening:{car:[0,0],heading:Math.PI/2},carRadius:1,carHalfLength:2.225});
 assert.equal(photoCarCanStand([13,0],Math.PI/2,simulation.canStand,simulation.size),false,'nose would enter wall');
 assert.equal(photoCarCanStand([13,0],0,simulation.canStand,simulation.size),true,'same centre north-facing clears wall');
 let collided=false;for(let i=0;i<1000;i++){simulation.update(.02,{forward:1,turn:0});collided||=simulation.state.collision;assert.ok(simulation.canDrive(simulation.state.car.position,simulation.state.car.heading));}
 assert.ok(collided);assert.ok(simulation.state.car.position[0]<13);assert.equal(simulation.state.car.speed,0);
});
test('actual Naples: standalone source collision agrees with renderer collision on hundreds of source-space samples',()=>{
 const map=actual(),before=JSON.stringify(map),pure=createPhotoSourceCollision(map),engine=new NullEngine({renderWidth:100,renderHeight:100,textureSize:128,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
 try{const rendered=createCityWorld(scene,map,map.city);let checked=0;for(let x=pure.bounds[0]+15;x<pure.bounds[2]-15;x+=83)for(let z=pure.bounds[1]+15;z<pure.bounds[3]-15;z+=83){assert.equal(pure.canStand(x,z,.55),rendered.canStand(x,z,.55),`source point ${x},${z}`);checked++;}assert.ok(checked>400);assert.equal(JSON.stringify(map),before);}finally{scene.dispose();engine.dispose();}
});
test('actual Naples driving: opening is complete-car clear, forward/brake/reverse, foot exit/reentry and recover preserve source',()=>{
 const map=actual(),before=JSON.stringify(map),simulation=createPhotoDrivingSimulation(map,{heightAt:(x,z)=>(x+z)/1000});
 const initial=[...simulation.state.car.position] as Point;assert.ok(simulation.canDrive(initial,simulation.state.car.heading));assert.equal(simulation.state.mode,'car');
 for(let i=0;i<50;i++)simulation.update(.02,{forward:1,turn:0});assert.ok(Math.hypot(simulation.state.car.position[0]-initial[0],simulation.state.car.position[1]-initial[1])>2);assert.equal(simulation.interact().reason,'moving');
 for(let i=0;i<25;i++)simulation.update(.02,{forward:-1,turn:0});assert.ok(simulation.state.car.speed<0);assert.ok(simulation.canDrive(simulation.state.car.position,simulation.state.car.heading));
 for(let i=0;i<150;i++)simulation.update(.02,{forward:0,turn:0});assert.equal(simulation.state.car.speed,0);
 assert.equal(simulation.interact().reason,'exit');assert.equal(simulation.state.mode,'foot');assert.ok(simulation.canWalk(...simulation.state.player.position,.5));assert.equal(photoCarBlocksPoint(simulation.state.player.position,simulation.state.car.position,simulation.state.car.heading,simulation.size,.5),false);
 assert.equal(simulation.interact().reason,'enter');assert.equal(simulation.state.mode,'car');assert.ok(simulation.recover());assert.deepEqual(simulation.state.car.position,initial);assert.equal(simulation.state.car.height,(initial[0]+initial[1])/1000);assert.equal(JSON.stringify(map),before);
});
test('foot view heading is stable while strafing; dynamic obstacles block entry and recovery without teleport',()=>{
 let blocked=false;const map=fixture(),simulation=createPhotoDrivingSimulation(map,{opening:{car:[-30,0],heading:0},canStand:(x,z,r)=>!blocked||x+r< -29});
 assert.equal(simulation.interact().reason,'exit');blocked=true;assert.equal(simulation.interact().reason,'blocked');assert.equal(simulation.state.mode,'foot');blocked=false;const start=[...simulation.state.player.position],heading=simulation.state.viewHeading;
 for(let i=0;i<25;i++)simulation.update(.02,{forward:0,turn:1});assert.ok(Math.abs(simulation.state.player.position[1]-start[1])<1e-8);assert.ok(simulation.state.player.position[0]>start[0]);assert.equal(simulation.state.viewHeading,heading);
 blocked=true;const before=JSON.stringify(simulation.state);assert.equal(simulation.recover(),false);assert.equal(JSON.stringify(simulation.state),before);
});
test('georeference and camera: origin roundtrip and cardinal headings, explicit height only, invalid inputs fail closed',()=>{
 for(const p of [[0,0],[-325,250],[1234,-220]] as Point[]){const coordinate=localToPhotoCoordinate(p),back=toLocal(coordinate.lng,coordinate.lat);assert.ok(Math.hypot(back[0]-p[0],back[1]-p[1])<1e-6);assert.equal('altitude'in coordinate,false);}
 assert.deepEqual(localToPhotoCoordinate([0,0]),{lat:ORIGIN.lat,lng:ORIGIN.lon});assert.equal(photoHeadingDegrees(Math.PI/2),90);assert.equal(photoHeadingDegrees(-Math.PI/2),270);
 const follow=photoGroundFollow([0,0],Math.PI,17,{mode:'car'});assert.equal(follow.center.altitude,18.2);assert.equal(follow.heading,180);assert.equal(follow.range,12);
 assert.throws(()=>photoGroundFollow([0,0],0,NaN));assert.throws(()=>localToPhotoCoordinate([NaN,0]));
 const simulation=createPhotoDrivingSimulation(fixture(),{opening:{car:[-30,0],heading:0}}),before=JSON.stringify(simulation.state);assert.equal(simulation.state.car.height,null);simulation.update(10,{forward:1,turn:1});assert.equal(JSON.stringify(simulation.state),before);assert.throws(()=>simulation.update(.02,{forward:NaN,turn:0}));
});


test('explicit fast travel: full car and foot clearance, atomic refusal, source bounds and preserved physical distance',()=>{
 let obstructed=false;const map=fixture(),beforeSource=JSON.stringify(map),simulation=createPhotoDrivingSimulation(map,{opening:{car:[-40,0],heading:0},canStand:(x,z,r)=>!obstructed||Math.hypot(x+20,z)>r+4,heightAt:(x,z)=>x/10});
 simulation.update(.2,{forward:1,turn:0});assert.ok(simulation.state.car.speed>0);const travelled=simulation.state.travelled;
 assert.equal(simulation.travelTo([-20,0],Math.PI/2),true);assert.equal(simulation.state.mode,'car');assert.deepEqual(simulation.state.car.position,[-20,0]);assert.deepEqual(simulation.state.player.position,[-20,0]);assert.equal(simulation.state.car.speed,0);assert.equal(simulation.state.car.height,-2);assert.equal(simulation.state.player.height,-2);assert.equal(simulation.state.viewHeading,Math.PI/2);assert.equal(simulation.state.travelled,travelled);
 const after=JSON.stringify(simulation.state);
 for(const point of [[20,0],[1000,0],[99,0],[NaN,0]] as Point[])assert.equal(simulation.travelTo(point,0),false);
 assert.equal(simulation.travelTo([-20,0],Infinity),false);assert.equal(JSON.stringify(simulation.state),after);
 obstructed=true;assert.equal(simulation.travelTo([-20,0],Math.PI/2),false);assert.equal(JSON.stringify(simulation.state),after);obstructed=false;
 assert.equal(simulation.interact().reason,'exit');assert.equal(simulation.state.mode,'foot');assert.equal(simulation.travelTo([-50,-20],0),true);assert.equal(simulation.state.mode,'car');assert.equal(simulation.interact().reason,'exit');assert.ok(simulation.canWalk(...simulation.state.player.position,.5));assert.equal(JSON.stringify(map),beforeSource);
});
test('fast travel on installed Naples source uses safe source anchors and rejects water/buildings without mutation',()=>{
 const map=actual(),simulation=createPhotoDrivingSimulation(map),start=[...simulation.state.car.position] as Point,heading=simulation.state.car.heading;
 const next:Point=[start[0]+Math.sin(heading)*4,start[1]+Math.cos(heading)*4];assert.ok(simulation.canDrive(next,heading));assert.equal(simulation.travelTo(next,heading),true);assert.equal(simulation.interact().reason,'exit');
 assert.equal(simulation.travelTo(start,heading),true);assert.deepEqual(simulation.state.car.position,start);const before=JSON.stringify(simulation.state);
 assert.equal(simulation.travelTo([map.city!.bounds[0]-10,map.city!.bounds[1]-10],0),false);
 const building=map.buildings.find(b=>b.rings.length===1&&b.rings[0].length===4)!;const center=building.rings[0].reduce((p,q)=>[p[0]+q[0]/4,p[1]+q[1]/4] as Point,[0,0] as Point);assert.equal(simulation.travelTo(center,0),false);assert.equal(JSON.stringify(simulation.state),before);
});
