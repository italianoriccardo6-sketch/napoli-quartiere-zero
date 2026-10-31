import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
const read=(name:string)=>JSON.parse(readFileSync('data/napoli-terrain-points/'+name,'utf8'));
test('quote regionali: sottoinsieme ritagliato, classe corretta e provenienza conservata',()=>{
  const raw=read('points.raw.json'),selected=read('points.selected.json'),source=read('source.json'),bbox=source.bbox_wgs84;
  assert.equal(source.license,'CC-BY-4.0');assert.equal(source.source_year,2020);assert.ok(raw.features.length<=250);assert.equal(selected.features.length,source.selectedCount);assert.equal(raw.features.length,source.rawCount);assert.equal(source.rawCount-source.selectedCount,source.excludedOutOfBounds);
  const ids=new Set(raw.features.map((f:any)=>f.attributes.OBJECTID));const selectedIds=new Set();for(const f of selected.features){const g=f.geometry;assert.ok([g.x,g.y,g.z].every(Number.isFinite));assert.ok(g.x>=bbox.west&&g.x<=bbox.east&&g.y>=bbox.south&&g.y<=bbox.north);assert.ok(['16110000','16110300'].includes(f.attributes.TIPO));assert.ok(ids.has(f.attributes.OBJECTID));assert.ok(!selectedIds.has(f.attributes.OBJECTID));selectedIds.add(f.attributes.OBJECTID);}
});
test('quote regionali non certificate non vengono dichiarate terreno attivo',()=>{
  const validation=read('validation.json'),source=read('source.json');assert.equal(validation.usable_as_terrain,false);assert.equal(validation.vertical_reference_verified,false);assert.equal(validation.vertical_units_verified,false);assert.equal(source.vertical_reference,null);assert.equal(source.vertical_units,null);
  const map=JSON.parse(readFileSync('public/data/map.json','utf8'));assert.match(map.city.heightStatus,/piano provvisorio/);
});
