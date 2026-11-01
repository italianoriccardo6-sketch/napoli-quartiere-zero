import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Canvas} from '@napi-rs/canvas';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {createCityWorld} from '../src/city-world';
import {addStreetDetail} from '../src/street-detail';
import {parseCityElevationGrid} from '../src/city-elevation';
import {createCityTerrainPolicy} from '../src/city-terrain-policy';
import {vehicleSurfacePose} from '../src/vehicle-surface';
import {openingStreetData,placeVehicleOnStreet} from '../src/vehicle-placement';
import {moveOnGround} from '../src/movement';
import {canStandForCar} from '../src/car';
import {createCamera} from '../src/camera';
import type {CityMapData} from '../src/city-data';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;

test('graded runtime keeps the complete walking route and playable car movement on actual rendered roads',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData,city=map.city!,before=JSON.stringify(map);
    const terrain=createCityTerrainPolicy(parseCityElevationGrid(JSON.parse(readFileSync('public/data/city-elevation.json','utf8'))),openingStreetData(city).scooter);
    const world=createCityWorld(scene,map,city,{terrain}),street=addStreetDetail(scene,map,city,{groundHeight:world.groundHeightAt});
    const surface=(x:number,z:number)=>Math.max(world.surfaceHeightAt!(x,z),street.supportHeightAt(x,z)??-Infinity);
    assert.equal(scene.metadata.cityWorld.terrainElevation,'regional-relative-dtm2020');assert.equal(scene.getMeshByName('terra OSM 0'),null);
    assert.ok(Math.abs(scene.getMeshByName('mare attorno alla costa')!.position.y+terrain.anchorHeight)<1e-8);
    for(const name of ['strade OSM','percorsi pedonali OSM']){
      const mesh=scene.getMeshByName(name)!,positions=mesh.getVerticesData('position')!,offset=name==='strade OSM'?.04:.025;
      for(let i=0;i<positions.length;i+=3)assert.ok(Math.abs(positions[i+1]-world.groundHeightAt!(positions[i],positions[i+2])-offset)<1e-7);
      for(let i=0;i<positions.length;i+=12){
        const ax=(positions[i]+positions[i+3])/2,az=(positions[i+2]+positions[i+5])/2,bx=(positions[i+6]+positions[i+9])/2,bz=(positions[i+8]+positions[i+11])/2;
        assert.ok(Math.hypot(bx-ax,bz-az)<=5+1e-7,'same source road spans are subdivided to follow grades');
      }
    }
    const walker=new Vector3(city.route[0][0],surface(...city.route[0]),city.route[0][1]);let minimum=walker.y,maximum=walker.y,steps=0;
    for(let i=1;i<city.route.length;i++){
      const target=city.route[i];let remaining=Math.hypot(target[0]-walker.x,target[1]-walker.z),guard=0;
      while(remaining>1e-6&&guard++<2000){
        const span=Math.min(.12,remaining),delta={x:(target[0]-walker.x)/remaining*span,z:(target[1]-walker.z)/remaining*span};
        const result=moveOnGround(walker,delta,.5,world.canStand,true);assert.equal(result.collision,false,'verified source walking route stays open after grading');
        walker.y=surface(walker.x,walker.z);assert.ok(Number.isFinite(walker.y));minimum=Math.min(minimum,walker.y);maximum=Math.max(maximum,walker.y);
        remaining=Math.hypot(target[0]-walker.x,target[1]-walker.z);steps++;
      }
      assert.ok(remaining<1e-6);
    }
    assert.ok(steps>4000&&maximum-minimum>3);
    const size={radius:1.3085043,halfLength:2.225},placement=placeVehicleOnStreet(openingStreetData(city),world.canStand,size),car=new Vector3(placement.car[0],surface(...placement.car),placement.car[1]);
    let carMinimum=Infinity,carMaximum=-Infinity;
    for(let i=0;i<100;i++){
      const delta={x:Math.sin(placement.heading)*.05,z:Math.cos(placement.heading)*.05};
      const result=moveOnGround(car,delta,size.radius,(x,z)=>canStandForCar({x,z},placement.heading,world.canStand,size.radius,size.halfLength),false);
      assert.equal(result.collision,false,'five metres of actual car-body movement remain free');
      const pose=vehicleSurfacePose(car.x,car.z,placement.heading,{halfLength:size.halfLength,halfWidth:size.radius},surface);car.y=pose.height;
      assert.ok([car.y,pose.pitch,pose.roll].every(Number.isFinite));carMinimum=Math.min(carMinimum,car.y);carMaximum=Math.max(carMaximum,car.y);
    }
    assert.ok(carMaximum-carMinimum>.01,'car height changes with the rendered street grade');
    const camera=createCamera(scene);camera.snap(walker);for(let i=0;i<3;i++)scene.render();
    const sun=scene.getLightByName('sole pomeridiano città');assert.ok(sun instanceof DirectionalLight);assert.ok(sun.position.y>camera.camera.position.y+199);
    assert.equal(JSON.stringify(map),before);street.dispose();
  }finally{scene.dispose();engine.dispose();}
});
