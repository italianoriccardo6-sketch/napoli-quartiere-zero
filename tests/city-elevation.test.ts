import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {toLocal} from '../src/geo';
import {createCityElevation,parseCityElevationGrid,sampleCityElevation,sampleCityElevationLonLat,type CityElevationGrid} from '../src/city-elevation';

const grid=():CityElevationGrid=>({version:1,width:2,height:2,bounds:{west:14.24,south:40.82,east:14.26,north:40.84},rowOrder:'north-to-south',sampleLocation:'pixel-center',sourceUnits:'metres',verticalDatum:null,relativeOnly:true,noData:null,heights:[10,20,30,40]});
const near=(a:number|null,b:number,tolerance=1e-7)=>{assert.notEqual(a,null);assert.ok(Math.abs(a!-b)<tolerance,`${a} != ${b}`);};

test('altimetria: interpola i centri dei pixel nella corretta direzione nord-sud',()=>{
  const g=grid();near(sampleCityElevationLonLat(g,14.245,40.835),10);near(sampleCityElevationLonLat(g,14.255,40.825),40);
  near(sampleCityElevationLonLat(g,14.25,40.83),25);near(sampleCityElevation(g,...toLocal(14.25,40.83)),25);
});
test('altimetria: non estrapola fuori dai campioni e non riempie i nodata costieri',()=>{
  const g=grid();g.heights[3]=null;
  assert.equal(sampleCityElevationLonLat(g,14.25,40.83),null);near(sampleCityElevationLonLat(g,14.245,40.835),10);
  assert.equal(sampleCityElevationLonLat(g,14.2401,40.835),null);assert.equal(sampleCityElevationLonLat(g,NaN,40.83),null);
});
test('altimetria: il riferimento relativo elimina un offset di datum costante',()=>{
  const g=grid(),anchor=toLocal(14.245,40.835),p=toLocal(14.25,40.83),a=createCityElevation(g,anchor);
  const shifted={...g,heights:g.heights.map(h=>h===null?null:h+48)},b=createCityElevation(shifted,anchor);
  near(a.heightAt(...anchor),0);near(a.heightAt(...p),15);near(b.heightAt(...p),a.heightAt(...p)!);
  assert.throws(()=>createCityElevation(g,toLocal(14.2,40.8)),/copertura/);
});
test('altimetria: rifiuta unità non verificate e raster incompleti',()=>{
  assert.throws(()=>parseCityElevationGrid({...grid(),sourceUnits:'unverified'}));
  assert.throws(()=>parseCityElevationGrid({...grid(),heights:[1,2,3]}));
  assert.throws(()=>parseCityElevationGrid({...grid(),heights:[1,NaN,3,4]}));
  assert.throws(()=>parseCityElevationGrid({...grid(),verticalDatum:'EGM96'}));
});
test('altimetria: campioni reali del DTM2020 distinguono lungomare, Plebiscito e pendio San Martino',()=>{
  const raw=JSON.parse(readFileSync('data/napoli-dtm-2020/relative-grid.json','utf8'));
  // Metre scale is documented by the mandated specification, not a service VCS.
  const g=parseCityElevationGrid(raw);
  near(sampleCityElevationLonLat(g,14.24723,40.82992),4.128368219999253,.001);
  near(sampleCityElevationLonLat(g,14.24868,40.83585),19.1305060249968,.001);
  near(sampleCityElevationLonLat(g,14.24142,40.8416),154.74104720004635,.001);
  // Stable source-control point; the current playable street reference is selected dynamically.
  const anchor:[number,number]=[-115.9798949332978,201.3268650741524],field=createCityElevation(g,anchor);
  near(field.heightAt(...anchor),0);assert.ok(field.heightAt(...toLocal(14.24868,40.83585))!>14);
});
