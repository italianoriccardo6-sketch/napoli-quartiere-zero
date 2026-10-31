import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {Canvas} from '@napi-rs/canvas';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';
import {createCityWorld} from '../src/city-world';
import {planAmbientCity,pointOnAmbientPath,ambientCarsAllow} from '../src/ambient-city';
import {canStandForCar} from '../src/car';
import {segmentDistance,type Point} from '../src/geo';
import type {CityMapData,CityRuntime} from '../src/city-data';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const nearest=(p:Point,path:Point[])=>Math.min(...path.slice(1).map((b,i)=>segmentDistance(p,path[i],b)));
test('percorsi ambientali: mantengono le curve sorgente e non attraversano tratti bloccati',()=>{
  assert.deepEqual(pointOnAmbientPath([[0,0],[10,0],[10,10]],15).point,[10,5]);
  const city:CityRuntime={roads:[{id:'way/fixture',highway:'footway',points:[[-60,10],[60,10]]}],bounds:[-100,-100,100,100],spawn:[1000,1000],scooter:[1000,1000],pickup:[1000,1000],delivery:[1000,1000],route:[],routeNames:[],sourceDate:'fixture',estimatedHeights:0,heightStatus:'fixture'};
  const canStand=(x:number,_z:number,r:number)=>Math.abs(x)>3+r;
  const plan=planAmbientCity(city,canStand,{anchor:[0,0],maxCars:0,maxPedestrians:2});
  assert.equal(plan.walkers.length,2);assert.equal(plan.cars.length,0);
  for(const walker of plan.walkers){
    assert.ok(walker.points.every(p=>canStand(p[0],p[1],.4)));
    assert.ok(walker.points.every(p=>p[0]<0)||walker.points.every(p=>p[0]>0),'nessuna scorciatoia fra i due lati del muro');
    assert.ok(walker.points.every(p=>Math.abs(p[1]-10)<1e-8));
  }
});
test('Napoli reale: piano deterministico, ingombri liberi e corridoio missione preservato',()=>{
  const map=JSON.parse(readFileSync(new URL('../public/data/map.json',import.meta.url),'utf8')) as CityMapData;assert.ok(map.city);
  const before=JSON.stringify(map),e=new NullEngine({renderWidth:400,renderHeight:300,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(e);
  try{
    const city=map.city,world=createCityWorld(scene,map,city),plan=planAmbientCity(city,world.canStand);
    assert.deepEqual(planAmbientCity(city,world.canStand),plan,'stesse sorgenti e stessi controlli producono le stesse posizioni');
    assert.equal(JSON.stringify(map),before,'le strade, i fabbricati e il percorso missione non vengono riscritti');
    assert.ok(plan.walkers.length>=1&&plan.walkers.length<=3);assert.ok(plan.cars.length>=1&&plan.cars.length<=2);
    for(const car of plan.cars){
      const road=city.roads.find(r=>r.id===car.roadId);assert.ok(road);
      const a=road.points[car.segmentIndex],b=road.points[car.segmentIndex+1];
      assert.ok(segmentDistance(car.sourcePoint,a,b)<1e-5,'la sosta deriva da un segmento OSM reale');
      assert.ok(Math.abs(Math.hypot(car.position[0]-car.sourcePoint[0],car.position[1]-car.sourcePoint[1])-Math.abs(car.offset))<1e-5);
      assert.ok(Math.abs(Math.cos(car.heading-Math.atan2(b[0]-a[0],b[1]-a[1])))>.99999);
      assert.equal(canStandForCar({x:car.position[0],z:car.position[1]},car.heading,(x,z,r)=>{
        assert.ok(world.canStand(x,z,r));assert.ok(nearest([x,z],city.route)>=r+1.4-1e-6);
        assert.ok(plan.protectedPoints.every(p=>Math.hypot(x-p[0],z-p[1])>=r+7-1e-6));return true;
      },car.size.radius,car.size.halfLength),true);
      assert.equal(ambientCarsAllow(plan,car.position[0],car.position[1],.4),false);
      assert.equal(ambientCarsAllow(plan,car.position[0],car.position[1],.4,car.id),true);
    }
    for(const walker of plan.walkers){
      const road=city.roads.find(r=>r.id===walker.roadId);assert.ok(road);assert.ok(['footway','pedestrian'].includes(road.highway));
      for(let i=0;i<walker.points.length;i++){
        const p=walker.points[i];assert.ok(nearest(p,road.points)<1e-5);assert.ok(world.canStand(p[0],p[1],.4));assert.ok(ambientCarsAllow(plan,p[0],p[1],.4));
        if(i){const a=walker.points[i-1];for(let t=0;t<=1;t+=.2){const q:Point=[a[0]+(p[0]-a[0])*t,a[1]+(p[1]-a[1])*t];assert.ok(nearest(q,road.points)<1e-5);assert.ok(world.canStand(q[0],q[1],.4));}}
      }
    }
    const limited=planAmbientCity(city,world.canStand,{maxCars:99,maxPedestrians:99});
    assert.ok(limited.cars.length<=2&&limited.walkers.length<=4,'il budget non può essere aumentato oltre il limite');
    const west=planAmbientCity(city,world.canStand,{anchor:city.delivery});
    assert.ok(west.walkers.length>=1&&west.walkers.length<=3,'pedoni disponibili anche sul lungomare occidentale');
    assert.ok(west.cars.length>=1&&west.cars.length<=2,'soste libere anche sul lungomare occidentale');
    for(const car of west.cars)assert.ok(canStandForCar({x:car.position[0],z:car.position[1]},car.heading,world.canStand,car.size.radius,car.size.halfLength));
    for(const walker of west.walkers){const road=city.roads.find(r=>r.id===walker.roadId)!;assert.ok(walker.points.every(p=>nearest(p,road.points)<1e-5&&world.canStand(p[0],p[1],.4)));}
    console.log('WEST_AMBIENT_PLAN '+JSON.stringify({anchor:west.anchor,cars:west.cars.map(c=>({roadId:c.roadId,position:c.position})),walkers:west.walkers.map(w=>({roadId:w.roadId,start:w.points[0],end:w.points[w.points.length-1]}))}));
    console.log('AMBIENT_PLAN '+JSON.stringify({anchor:plan.anchor,cars:plan.cars,walkers:plan.walkers.map(w=>({roadId:w.roadId,start:w.points[0],end:w.points[w.points.length-1],points:w.points.length}))}));
  }finally{scene.dispose();e.dispose();}
});
