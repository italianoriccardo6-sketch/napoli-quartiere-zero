import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {Canvas} from '@napi-rs/canvas';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';
import {createWorld} from '../src/world';import {createCharacter} from '../src/character';import {createScooter} from '../src/vehicle';import {createCamera} from '../src/camera';import {Vector3} from '@babylonjs/core/Maths/math.vector';import type {MapData} from '../src/geo';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as MapData;
test('scena Babylon eseguita con NullEngine; percorso, edifici, banchina e discesa',()=>{
  const engine=new NullEngine({renderWidth:800,renderHeight:600,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4});const scene=new Scene(engine);
  try {
    const fixture=structuredClone(map);fixture.buildings.push({id:'cortile-test',height:8,estimated:true,rings:[[[-50,20],[-30,20],[-30,40],[-50,40]],[[-46,24],[-34,24],[-34,36],[-46,36]]]});
    const world=createWorld(scene,fixture),character=createCharacter(scene),scooter=createScooter(scene),camera=createCamera(scene);
    character.root.position.set(20,0,58);camera.snap(character.root.position);
    assert.equal(world.canStand(-40,30,.5),true,'cortile accessibile');assert.equal(world.canStand(-48,30,.5),false,'muro del cortile');
    for(const p of [[20,58],[18,60],[27,59],[47,-47],[19.7,60],[16.3,60]])assert.equal(world.canStand(p[0],p[1],.93),true,'punto libero '+p);
    for(const p of [[18,36],[-30,-31],[29,66],[80,30],[61.9,0]])assert.equal(world.canStand(p[0],p[1],.5),false,'ostacolo o acqua '+p);
    // The full mission corridor supports the scooter's collision radius.
    const route=[[20,58],[27,59],[43,59],[47,50],[47,-47]];
    for(let k=1;k<route.length;k++)for(let t=0;t<=1;t+=.005){const a=route[k-1],b=route[k];assert.ok(world.canStand(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.93),'corridoio percorribile');}
    for(let frame=0;frame<10;frame++){character.animate(frame/60,true,false);camera.update(character.root.position,1/60,false);world.sea.setFloat('time',frame/60);scene.render();}
    assert.ok(scene.meshes.length>500);assert.equal(scooter.root.position.z,60);assert.ok(Vector3.Distance(camera.camera.position,character.root.position)<12);
  } finally {scene.dispose();engine.dispose();}
});
