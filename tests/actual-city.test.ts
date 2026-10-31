import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {Canvas} from '@napi-rs/canvas';import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {createCityWorld} from '../src/city-world';import type {CityMapData} from '../src/city-data';import {toLocal} from '../src/geo';
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
const raw=JSON.parse(readFileSync('data/napoli-centro.osm.json','utf8'));
test('città attiva usa vere coordinate OSM, costa e sorgente datata',()=>{
  assert.equal(map.provenance,'osm');assert.ok(map.city);assert.ok(map.buildings.length>1500);assert.ok(map.buildings.filter(b=>b.rings.length>1).length>250);
  const nodes=new Map<number,{lon:number;lat:number}>(raw.elements.filter((e:any)=>e.type==='node').map((e:any)=>[e.id,e]));const ways=new Map(raw.elements.filter((e:any)=>e.type==='way').map((e:any)=>['way/'+e.id,e]));
  for(const road of map.city!.roads.filter(r=>r.name==='Via Santa Lucia'||r.name==='Via Partenope')){const source=ways.get(road.id) as any;assert.equal(source.tags.name,road.name);assert.deepEqual(road.points[0],toLocal(nodes.get(source.nodes[0])!.lon,nodes.get(source.nodes[0])!.lat));}
  assert.ok(map.city!.routeNames.includes('Via Santa Lucia'));assert.ok(map.city!.routeNames.includes('Via Partenope'));assert.equal(map.city!.sourceDate,JSON.parse(readFileSync('data/source.json','utf8')).date);assert.ok(Number.isFinite(Date.parse(map.city!.sourceDate)));
});
test('scena reale: tutti i punti missione e il percorso continuo hanno spazio per il motorino',()=>{
  const engine=new NullEngine({renderWidth:800,renderHeight:600,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
  try{
    const world=createCityWorld(scene,map,map.city!);const city=map.city!;
    for(const p of[city.spawn,city.scooter,city.pickup,city.delivery])assert.ok(world.canStand(p[0],p[1],.95));
    let metres=0,samples=0;for(let i=1;i<city.route.length;i++){const a=city.route[i-1],b=city.route[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);metres+=length;const n=Math.ceil(length/.25);for(let k=0;k<=n;k++){const t=k/n;assert.ok(world.canStand(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,.95),'passaggio reale percorribile');samples++;}}
    assert.ok(metres>500&&metres<700);assert.ok(samples>2000);assert.equal(world.canStand(300,0,.5),false,'il golfo resta acqua');
    const b=map.buildings.find(b=>b.rings.length===1&&b.rings[0].length===4);if(b){const ring=b.rings[0],x=ring.reduce((n,p)=>n+p[0],0)/4,z=ring.reduce((n,p)=>n+p[1],0)/4;assert.equal(world.canStand(x,z),false,'edificio non attraversabile');}
    const camera=new FreeCamera('verifica',new Vector3(city.spawn[0],3,city.spawn[1]),scene);camera.setTarget(new Vector3(city.pickup[0],1,city.pickup[1]));scene.render();
    assert.ok(scene.metadata.cityWorld.buildingChunks<1000);assert.equal(scene.metadata.cityWorld.invalidFootprints,0);
  }finally{scene.dispose();engine.dispose();}
});
