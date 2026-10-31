import test from 'node:test';
import assert from 'node:assert/strict';
import {Canvas} from '@napi-rs/canvas';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {createCamera} from '../src/camera';
import {createCityWorld,cityRoadWidth} from '../src/city-world';
import type {MapData} from '../src/geo';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;

test('città: footprint con cortile, banchina e collegamento tra poligoni adiacenti',()=>{
  const engine=new NullEngine({renderWidth:640,renderHeight:480,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
  try {
    const map:MapData={provenance:'osm',notice:'fixture sintetica',paths:[],land:[[[-100,-100],[0,-100],[0,100],[-100,100]],[[0,-100],[100,-100],[100,100],[0,100]]],buildings:[{id:'relation/fixture',height:12,estimated:false,rings:[[[10,10],[40,10],[40,40],[10,40]],[[18,18],[32,18],[32,32],[18,32]]]}]};
    const world=createCityWorld(scene,map,{bounds:[-100,-100,100,100],landPolygons:[[map.land[0],[[-70,40],[-50,40],[-50,60],[-70,60]]],[map.land[1]]],roads:[{id:'way/fixture',name:'Strada sintetica',highway:'residential',points:[[-70,-20],[70,-20]]}]});
    assert.equal(world.canStand(-60,50),false,'buco della terra preservato');assert.equal(world.canStand(-49.8,50,.55),false,'margine del buco');
    assert.equal(world.canStand(-20,0),true);assert.equal(world.canStand(0,0),true,'nessun muro sul bordo interno condiviso');
    assert.equal(world.canStand(20,12),false,'muro del fabbricato');assert.equal(world.canStand(25,25),true,'cortile');assert.equal(world.canStand(18.2,25,.55),false,'bordo cortile');
    assert.equal(world.canStand(99.8,0,.55),false,'bordo della banchina');assert.equal(world.canStand(110,0),false,'mare');assert.equal(world.canStand(NaN,0),false);
    createCamera(scene);for(let i=0;i<3;i++){world.sea.setFloat('time',i/60);scene.render();}
    assert.equal(world.beacons.length,0);assert.equal(scene.metadata.cityWorld.footprints,1);assert.equal(scene.metadata.cityWorld.renderedRoads,1);
  }finally{scene.dispose();engine.dispose();}
});
test('larghezze stradali esplicite o stimate dichiarate',()=>{
  assert.equal(cityRoadWidth({highway:'primary',width:7.5}),7.5);assert.equal(cityRoadWidth({highway:'footway'}),2.8);assert.equal(cityRoadWidth({highway:'residential',width:-2}),6);
});
