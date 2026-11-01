import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ORIGIN,toLocal,type Point} from '../src/geo';
import {parseCityElevationGrid,type CityElevationGrid} from '../src/city-elevation';
import {createCityTerrainPolicy} from '../src/city-terrain-policy';
import {openingStreetData} from '../src/vehicle-placement';
import type {CityMapData} from '../src/city-data';

function fixture():CityElevationGrid {
  const unit=Math.PI/180*6378137,dx=7.5/(unit*Math.cos(ORIGIN.lat*Math.PI/180)),dz=7.5/unit;
  return {version:1,width:3,height:3,bounds:{west:ORIGIN.lon-dx,east:ORIGIN.lon+dx,south:ORIGIN.lat-dz,north:ORIGIN.lat+dz},rowOrder:'north-to-south',sampleLocation:'pixel-center',sourceUnits:'metres',verticalDatum:null,relativeOnly:true,noData:null,heights:[0,1,2,3,null,5,6,7,8]};
}
const near=(a:number,b:number)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('terrain policy distinguishes original data, bounded source-pixel extension and the retained flat scene',()=>{
  const grid=fixture(),before=JSON.stringify(grid),field=createCityTerrainPolicy(grid,[-5,5]);
  const exact=field.sampleAt(-5,5);assert.equal(exact.kind,'bilinear-source');near(exact.height,0);
  const edge=field.sampleAt(0,0);assert.equal(edge.kind,'bounded-nearest-pixel');near(edge.height,1);near(edge.extensionMetres!,5);
  assert.equal(field.sampleAt(40,0).kind,'retained-flat-baseline');near(field.heightAt(40,0),0);
  assert.equal(field.stats.bilinearSource,1);assert.equal(field.stats.boundedNearest,1);assert.equal(field.stats.retainedFlat,2);
  assert.ok(field.stats.largestUsedExtensionMetres<=10);assert.equal(JSON.stringify(grid),before);
});
test('terrain policy uses the same local coordinates and cancels a constant unknown datum offset',()=>{
  const grid=fixture(),b=grid.bounds,anchor=toLocal(b.west+(b.east-b.west)/6,b.north-(b.north-b.south)/6);
  const a=createCityTerrainPolicy(grid,anchor),other={...grid,heights:grid.heights.map(h=>h===null?null:h+48)},c=createCityTerrainPolicy(other,anchor);
  for(const point of [[-5,5],[0,0],[9,0],[40,0]] as Point[])near(a.heightAt(...point),c.heightAt(...point));
  assert.equal(a.stats.verticalDatum,'unknown');assert.equal(a.stats.verticalReference,'relative-to-opening-street');
  assert.throws(()=>createCityTerrainPolicy(grid,anchor,10.1));assert.throws(()=>a.heightAt(NaN,0));
});
test('real story route uses bilinear source data rather than a coastal fallback',()=>{
  const grid=parseCityElevationGrid(JSON.parse(readFileSync('data/napoli-dtm-2020/relative-grid.json','utf8'))),map=JSON.parse(readFileSync('public/data/map.json','utf8')) as CityMapData;
  const city=map.city!,field=createCityTerrainPolicy(grid,openingStreetData(city).scooter);
  let count=0,minimum=Infinity,maximum=-Infinity;
  for(let i=1;i<city.route.length;i++){
    const a=city.route[i-1],b=city.route[i],steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/5));
    for(let k=0;k<=steps;k++){
      const sample=field.sampleAt(a[0]+(b[0]-a[0])*k/steps,a[1]+(b[1]-a[1])*k/steps);
      assert.equal(sample.kind,'bilinear-source');minimum=Math.min(minimum,sample.height);maximum=Math.max(maximum,sample.height);count++;
    }
  }
  assert.ok(count>150);assert.ok(maximum-minimum>3);assert.equal(field.stats.retainedFlat,0);assert.equal(field.stats.boundedNearest,0);
});
