import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Canvas} from '@napi-rs/canvas';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {createCamera} from '../src/camera';
import {createCityWorld} from '../src/city-world';
import {walkingDirection,moveOnGround} from '../src/movement';
import type {CityMapData} from '../src/city-data';

(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
const engine=()=>new NullEngine({renderWidth:800,renderHeight:600,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4});

test('W e D seguono avanti e destra della vera telecamera Babylon, senza invertire A/D',()=>{
  const e=engine(),scene=new Scene(e);
  try{
    const camera=createCamera(scene);
    for(const heading of [0,.144,Math.PI/2,Math.PI,-Math.PI*.75]){
      camera.orient(heading);camera.snap(new Vector3(0,0,0));camera.camera.getViewMatrix(true);
      for(const [forward,strafe,axis]of [[1,0,Vector3.Forward()],[0,1,Vector3.Right()]] as const){
        const expected=camera.camera.getDirection(axis);expected.y=0;expected.normalize();
        const actual=walkingDirection(camera.yaw,forward,strafe);
        assert.ok(actual.x*expected.x+actual.z*expected.z>.99999,`direzione errata, orientamento ${heading}, assi ${forward}/${strafe}`);
      }
      const right=walkingDirection(camera.yaw,0,1),left=walkingDirection(camera.yaw,0,-1);
      assert.ok(Math.abs(right.x+left.x)<1e-12&&Math.abs(right.z+left.z)<1e-12);
    }
  }finally{scene.dispose();e.dispose();}
});

test('spawn reale: il controller cammina per 3,1 metri in tutte le direzioni e il mezzo può avanzare',()=>{
  const e=engine(),scene=new Scene(e);
  try{
    const world=createCityWorld(scene,map,map.city!);
    const city=map.city!,spawn={x:city.spawn[0],z:city.spawn[1]};
    const heading=Math.atan2(city.pickup[0]-spawn.x,city.pickup[1]-spawn.z),yaw=heading+Math.PI;
    for(const [name,forward,strafe]of [['avanti',1,0],['indietro',-1,0],['destra',0,1],['sinistra',0,-1]] as const){
      const position={...spawn},direction=walkingDirection(yaw,forward,strafe);
      for(let frame=0;frame<60;frame++){
        const result=moveOnGround(position,{x:direction.x*3.1/60,z:direction.z*3.1/60},.5,world.canStand);
        assert.equal(result.collision,false,`spawn bloccato nella direzione ${name}, frame ${frame}`);
      }
      assert.ok(Math.abs(Math.hypot(position.x-spawn.x,position.z-spawn.z)-3.1)<1e-7);
    }
    const vehicle={x:city.scooter[0],z:city.scooter[1]},direction=walkingDirection(yaw,1,0);
    const result=moveOnGround(vehicle,{x:direction.x*2,z:direction.z*2},.93,world.canStand,false);
    assert.equal(result.collision,false);assert.ok(Math.abs(result.distance-2)<1e-7);
  }finally{scene.dispose();e.dispose();}
});

test('sottopassi impediscono al mezzo di saltare oltre un muro sottile',()=>{
  const position={x:0,z:0};let queries=0;
  const clear=(x:number,_z:number,r:number)=>{queries++;return x+r<=1||x-r>=1.05;};
  const result=moveOnGround(position,{x:5,z:0},.25,clear,false);
  assert.equal(result.collision,true);assert.ok(position.x<=.75);assert.ok(result.distance<=.75);assert.ok(queries>1);
});

test('a piedi il muro ferma l’asse bloccato e lascia scorrere quello libero',()=>{
  const position={x:0,z:0};
  const result=moveOnGround(position,{x:2,z:2},.25,(x,_z,r)=>x+r<=1,true);
  assert.equal(result.collision,true);assert.ok(position.x<=.75);assert.ok(Math.abs(position.z-2)<1e-10);assert.ok(result.distance>2);
});

test('diagonale normalizzata, aggiornamenti equivalenti e numeri non validi respinti',()=>{
  const diagonal=walkingDirection(.3,1,1);assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.z)-1)<1e-12);assert.deepEqual(walkingDirection(.3,0,0),{x:0,z:0});
  const a={x:0,z:0},b={x:0,z:0};for(let i=0;i<60;i++)moveOnGround(a,{x:diagonal.x*3.1/60,z:diagonal.z*3.1/60},.5,()=>true);for(let i=0;i<30;i++)moveOnGround(b,{x:diagonal.x*3.1/30,z:diagonal.z*3.1/30},.5,()=>true);assert.ok(Math.hypot(a.x-b.x,a.z-b.z)<1e-10);
  assert.throws(()=>walkingDirection(NaN,1,0),RangeError);assert.throws(()=>walkingDirection(.3,Number.MAX_VALUE,Number.MAX_VALUE),RangeError);assert.throws(()=>moveOnGround({x:0,z:0},{x:Infinity,z:0},.5,()=>true),RangeError);assert.throws(()=>moveOnGround({x:0,z:0},{x:1,z:0},.5,()=>true,true,0),RangeError);assert.throws(()=>moveOnGround({x:0,z:0},{x:100000,z:0},.5,()=>true),RangeError);
});
