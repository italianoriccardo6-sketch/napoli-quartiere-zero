import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {Canvas} from '@napi-rs/canvas';import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';
import {createCityWorld} from '../src/city-world';import type {CityMapData} from '../src/city-data';import {canStandForCar} from '../src/car';
import {placeVehicleOnStreet,vehicleBlocksPoint,findPlayerBesideVehicle,openingStreetData} from '../src/vehicle-placement';import {moveOnGround} from '../src/movement';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const dimensions={radius:1.3085045,halfLength:2.225};
test('capsula dell’auto: anche fiancate, muso e coda impediscono al personaggio di attraversarla',()=>{
  const center={x:0,z:0};assert.equal(vehicleBlocksPoint({x:0,z:0},center,0,1,3,.5),true);assert.equal(vehicleBlocksPoint({x:1.4,z:1.5},center,0,1,3,.5),true);assert.equal(vehicleBlocksPoint({x:0,z:3.4},center,0,1,3,.5),true);assert.equal(vehicleBlocksPoint({x:0,z:3.6},center,0,1,3,.5),false);assert.equal(vehicleBlocksPoint({x:3.4,z:0},center,Math.PI/2,1,3,.5),true);assert.equal(vehicleBlocksPoint({x:NaN,z:0},center,0,1,3,.5),true);
});
test('posizionamento: cerca una direzione stradale compatibile e lascia il personaggio fuori dalla carrozzeria',()=>{
  const city={spawn:[0,10] as [number,number],scooter:[0,0] as [number,number],pickup:[10,0] as [number,number],route:[[0,-20],[0,20]] as [number,number][]};
  const street=(x:number,z:number,r:number)=>Math.abs(x)+r<1.45&&Math.abs(z)+r<30;
  assert.equal(canStandForCar({x:0,z:0},Math.PI/2,street,dimensions.radius,dimensions.halfLength),false);
  const placement=placeVehicleOnStreet(city,street,dimensions),car={x:placement.car[0],z:placement.car[1]},player={x:placement.player[0],z:placement.player[1]};
  assert.equal(canStandForCar(car,placement.heading,street,dimensions.radius,dimensions.halfLength),true);assert.equal(street(player.x,player.z,.5),true);assert.equal(vehicleBlocksPoint(player,car,placement.heading,dimensions.radius,dimensions.halfLength,.5),false);
  assert.throws(()=>placeVehicleOnStreet(city,()=>false,dimensions),/punto libero/);assert.equal(findPlayerBesideVehicle(car,0,dimensions,()=>false),null);
});
test('mappa reale: auto completa libera, personaggio separato e cammino iniziale possibile',()=>{
  const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
  const e=new NullEngine({renderWidth:800,renderHeight:600,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(e);
  try{
    const world=createCityWorld(scene,map,map.city!),placement=placeVehicleOnStreet(map.city!,world.canStand,dimensions);
    const center={x:placement.car[0],z:placement.car[1]},player={x:placement.player[0],z:placement.player[1]};
    assert.ok(canStandForCar(center,placement.heading,world.canStand,dimensions.radius,dimensions.halfLength));assert.ok(world.canStand(player.x,player.z,.5));assert.equal(vehicleBlocksPoint(player,center,placement.heading,dimensions.radius,dimensions.halfLength,.5),false);
    assert.ok(Math.hypot(center.x-map.city!.scooter[0],center.z-map.city!.scooter[1])<=60);
    const free=(x:number,z:number,r:number)=>world.canStand(x,z,r)&&!vehicleBlocksPoint({x,z},center,placement.heading,dimensions.radius,dimensions.halfLength,r);
    const move=moveOnGround(player,{x:Math.sin(placement.heading),z:Math.cos(placement.heading)},.5,free);assert.equal(move.collision,false);assert.ok(Math.abs(move.distance-1)<1e-7);
  }finally{scene.dispose();e.dispose();}
});

test('apertura sul lungomare: strada sorgente immutata, cinque metri liberi, sterzata e discesa',()=>{
  const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
  const city=map.city!,before=JSON.stringify(city),opening=openingStreetData(city);
  assert.notEqual(opening,city,'la mappa sorgente resta separata dal punto di apertura');
  const segment=city.roads.filter(r=>r.name==='Via Partenope'&&r.highway==='pedestrian').flatMap(r=>r.points.slice(1).map((b,i)=>({a:r.points[i],b}))).find(({a,b})=>Math.hypot(opening.scooter[0]-(a[0]+b[0])/2,opening.scooter[1]-(a[1]+b[1])/2)<1e-8);
  assert.ok(segment,'apertura sulla centerline di una strada reale di Via Partenope');
  const e=new NullEngine({renderWidth:800,renderHeight:600,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(e);
  try{
    const world=createCityWorld(scene,map,city),placement=placeVehicleOnStreet(opening,world.canStand,dimensions),center={x:placement.car[0],z:placement.car[1]},heading=placement.heading;
    assert.ok(Math.hypot(center.x-opening.scooter[0],center.z-opening.scooter[1])<1e-6,'il punto di apertura preferito accoglie l’intera auto');
    const roadX=segment.b[0]-segment.a[0],roadZ=segment.b[1]-segment.a[1],roadLength=Math.hypot(roadX,roadZ),forward={x:Math.sin(heading),z:Math.cos(heading)};
    assert.ok(Math.abs((roadX*forward.x+roadZ*forward.z)/roadLength)>.999999,'auto allineata alla tangente della strada');
    assert.ok((city.pickup[0]-center.x)*forward.x+(city.pickup[1]-center.z)*forward.z>=0,'direzione iniziale verso Teresa');
    const fullCar=(x:number,z:number)=>canStandForCar({x,z},heading,world.canStand,dimensions.radius,dimensions.halfLength);
    for(const sign of [1,-1]){
      const position={...center};
      for(let i=0;i<25;i++){const result=moveOnGround(position,{x:forward.x*.2*sign,z:forward.z*.2*sign},dimensions.radius,fullCar,false);assert.equal(result.collision,false,`ingombro bloccato in ${sign===1?'avanti':'retromarcia'} al passo ${i}`);}
      assert.ok(Math.abs(Math.hypot(position.x-center.x,position.z-center.z)-5)<1e-7);
      for(const delta of [-Math.PI/12,Math.PI/12])assert.ok(canStandForCar(position,heading+delta,world.canStand,dimensions.radius,dimensions.halfLength),'sterzata iniziale libera con carrozzeria completa');
      const player=findPlayerBesideVehicle(position,heading,dimensions,world.canStand);assert.ok(player,'punto libero per la discesa dopo la guida');assert.ok(world.canStand(player[0],player[1],.5));assert.equal(vehicleBlocksPoint({x:player[0],z:player[1]},position,heading,dimensions.radius,dimensions.halfLength,.5),false);
    }
    assert.equal(JSON.stringify(city),before,'nessun punto o attributo della fonte cartografica modificato');
  }finally{scene.dispose();e.dispose();}
});
