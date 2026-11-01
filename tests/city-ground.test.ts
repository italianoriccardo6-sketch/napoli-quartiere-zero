import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {parseCityElevationGrid} from '../src/city-elevation';
import {createCityTerrainPolicy} from '../src/city-terrain-policy';
import {addCityGround} from '../src/city-ground';
import {openingStreetData} from '../src/vehicle-placement';
import {vehicleSurfacePose} from '../src/vehicle-surface';
import type {CityMapData} from '../src/city-data';

test('actual Naples route, building foundations and vehicle poses share the rendered relative terrain',()=>{
  const engine=new NullEngine(),scene=new Scene(engine);
  try{
    const map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData,city=map.city!,before=JSON.stringify(map);
    const grid=parseCityElevationGrid(JSON.parse(readFileSync('public/data/city-elevation.json','utf8'))),policy=createCityTerrainPolicy(grid,openingStreetData(city).scooter);
    const material=new StandardMaterial('test caller material',scene),ground=addCityGround(scene,city.landPolygons!,map.buildings,policy,material);
    const sources=ground.metadata.vertexHeightSources;
    assert.equal(sources.calls,ground.metadata.mesh.vertices);assert.equal(sources.calls,sources.bilinearSource+sources.boundedNearest+sources.retainedFlat);
    assert.ok(sources.bilinearSource>16000&&sources.boundedNearest>0&&sources.retainedFlat>0);assert.ok(sources.largestUsedExtensionMetres<=10);
    assert.equal(ground.metadata.verticalDatum,'unknown');assert.equal(ground.metadata.waterReferencePolicy,'artistic-native-zero-not-certified-MSL');
    assert.ok(ground.metadata.maximumHeight>150);assert.equal(ground.metadata.mesh.remainingLongEdges,0);
    let minimum=Infinity,maximum=-Infinity,samples=0;
    for(let i=1;i<city.route.length;i++){
      const a=city.route[i-1],b=city.route[i],heading=Math.atan2(b[0]-a[0],b[1]-a[1]),steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2));
      for(let j=0;j<=steps;j++){
        const x=a[0]+(b[0]-a[0])*j/steps,z=a[1]+(b[1]-a[1])*j/steps,y=ground.renderedHeightAt(x,z);
        assert.notEqual(y,undefined);assert.equal(ground.heightAt(x,z),y);
        const pose=vehicleSurfacePose(x,z,heading,{halfLength:2.225,halfWidth:1.04},ground.heightAt);
        assert.ok([pose.height,pose.pitch,pose.roll,...pose.supportHeights].every(Number.isFinite));
        minimum=Math.min(minimum,y!);maximum=Math.max(maximum,y!);samples++;
      }
    }
    assert.ok(samples>300&&maximum-minimum>3,'route is genuinely graded rather than a flat opening scene');
    assert.ok(Number.isFinite(ground.buildingBaseHeight('relation/4779351:1')));assert.equal(ground.metadata.foundations.buildings,map.buildings.length);
    assert.equal(JSON.stringify(map),before,'source footprints, streets, coastline and collision geography remain unchanged');
    ground.dispose();assert.equal(ground.renderedHeightAt(...city.route[0]),undefined);assert.ok(scene.materials.includes(material));
  }finally{scene.dispose();engine.dispose();}
});
