import test from 'node:test';
import assert from 'node:assert/strict';
import {Canvas} from '@napi-rs/canvas';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {createCamera} from '../src/camera';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {createCityWorld,cityRoadWidth} from '../src/city-world';
import type {MapData,Point} from '../src/geo';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;

test('città: footprint con cortile, banchina e collegamento tra poligoni adiacenti',()=>{
  const engine=new NullEngine({renderWidth:640,renderHeight:480,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
  try {
    const map:MapData={provenance:'osm',notice:'fixture sintetica',paths:[],land:[[[-100,-100],[0,-100],[0,100],[-100,100]],[[0,-100],[100,-100],[100,100],[0,100]]],buildings:[{id:'relation/fixture',height:12,estimated:false,rings:[[[10,10],[40,10],[40,40],[10,40]],[[18,18],[32,18],[32,32],[18,32]]]}]};
    const world=createCityWorld(scene,map,{bounds:[-100,-100,100,100],landPolygons:[[map.land[0],[[-70,40],[-50,40],[-50,60],[-70,60]]],[map.land[1]]],roads:[{id:'way/fixture',name:'Strada sintetica',highway:'residential',points:[[-70,-20],[70,-20]]},{id:'way/crossing',highway:'footway',points:[[-20,-40],[-20,20]]}]});
    assert.equal(world.canStand(-60,50),false,'buco della terra preservato');assert.equal(world.canStand(-49.8,50,.55),false,'margine del buco');
    assert.equal(world.canStand(-20,0),true);assert.equal(world.canStand(0,0),true,'nessun muro sul bordo interno condiviso');
    assert.equal(world.canStand(20,12),false,'muro del fabbricato');assert.equal(world.canStand(25,25),true,'cortile');assert.equal(world.canStand(18.2,25,.55),false,'bordo cortile');
    assert.equal(world.canStand(99.8,0,.55),false,'bordo della banchina');assert.equal(world.canStand(110,0),false,'mare');assert.equal(world.canStand(NaN,0),false);
    createCamera(scene);for(let i=0;i<3;i++){world.sea.setFloat('time',i/60);scene.render();}
    assert.equal(world.beacons.length,0);assert.equal(scene.metadata.cityWorld.footprints,1);assert.equal(scene.metadata.cityWorld.renderedRoads,2);
    const road=scene.getMeshByName('strade OSM')!;
    const normals=road.getVerticesData('normal')!;
    assert.ok(normals.length>0);for(let i=1;i<normals.length;i+=3)assert.ok(normals[i]>.99,'la strada riceve la luce sul lato superiore');
    const roadY=road.getVerticesData('position')![1],footwayY=scene.getMeshByName('percorsi pedonali OSM')!.getVerticesData('position')![1];
    assert.ok(roadY>footwayY,'gli incroci pedonali non producono superfici coplanari che lampeggiano nell’asfalto');
  }finally{scene.dispose();engine.dispose();}
});
test('larghezze stradali esplicite o stimate dichiarate',()=>{
  assert.equal(cityRoadWidth({highway:'primary',width:7.5}),7.5);assert.equal(cityRoadWidth({highway:'footway'}),2.8);assert.equal(cityRoadWidth({highway:'residential',width:-2}),6);
});
test('curve stradali: fascia continua senza buchi triangolari, normali verso alto e geografia intatta',()=>{
  const engine=new NullEngine({renderWidth:640,renderHeight:480,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
  try{
    const points:Point[]=[[-30,0],[0,0],[0,30]],map:MapData={provenance:'osm',notice:'fixture sintetica',paths:[],land:[[[-100,-100],[100,-100],[100,100],[-100,100]]],buildings:[]};
    const detail={bounds:[-100,-100,100,100] as [number,number,number,number],roads:[{id:'curva reale di prova',highway:'residential',width:6,points}]},before=JSON.stringify({map,detail});
    const world=createCityWorld(scene,map,detail),road=scene.getMeshByName('strade OSM')!,positions=road.getVerticesData('position')!,indices=road.getIndices()!,normals=road.getVerticesData('normal')!;
    assert.equal(JSON.stringify({map,detail}),before,'nessuna modifica ai punti sorgente o alle collisioni');
    assert.equal(positions.length/3,8,'stessi due segmenti geografici, senza nuovi centri strada');
    assert.deepEqual(positions.slice(6,12),positions.slice(12,18),'entrambi i lati del giunto sono condivisi');
    const covers=(p:Point)=>{
      const cross=(a:Point,b:Point)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]);
      for(let i=0;i<indices.length;i+=3){
        const [a,b,c]=Array.from(indices.slice(i,i+3)).map(v=>[positions[v*3],positions[v*3+2]] as Point),s=[cross(a,b),cross(b,c),cross(c,a)];
        if(s.every(v=>v>=-1e-7)||s.every(v=>v<=1e-7))return true;
      }
      return false;
    };
    assert.equal(covers([2,-2]),true,'angolo esterno prima lasciato scoperto dai due rettangoli');
    assert.equal(covers([5,-5]),false,'larghezza stimata del miter limitata');
    for(let i=1;i<normals.length;i+=3)assert.ok(normals[i]>.99,'illuminazione sulla faccia superiore');
    assert.equal(world.canStand(2,-2),true,'la mesh decorativa non crea muri invisibili');
  }finally{scene.dispose();engine.dispose();}
});

test('building streaming: unloading GPU geometry preserves distant collisions and source data',()=>{
  const engine=new NullEngine({renderWidth:640,renderHeight:480,textureSize:256,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
  try{
    const map:MapData={provenance:'osm',notice:'synthetic fixture',paths:[],land:[[[-500,-500],[4500,-500],[4500,500],[-500,500]]],buildings:[0,1000,3000].map(x=>({id:'fixture-'+x,height:10,estimated:false,rings:[[[x,0],[x+20,0],[x+20,20],[x,20]] as Point[]]}))};
    const before=JSON.stringify(map),world=createCityWorld(scene,map,undefined,{streaming:{position:[-20,0],loadDistance:150}}),cam=createCamera(scene);
    assert.equal(world.canStand(3010,10),false,'distant building collision is active before its GPU mesh loads');
    assert.equal(scene.metadata.cityWorld.buildingStream.residentChunks,1);
    cam.camera.position.set(2980,4,30);cam.camera.setTarget(new Vector3(3000,4,0));
    scene.render();scene.render();
    const ids=scene.meshes.flatMap(m=>m.metadata?.sourceIds??[]);
    assert.ok(ids.includes('fixture-3000'));assert.ok(!ids.includes('fixture-0'),'far meshes released');
    assert.equal(world.canStand(10,10),false,'unloading leaves source collisions intact');assert.equal(JSON.stringify(map),before);
  }finally{scene.dispose();engine.dispose();}
});
