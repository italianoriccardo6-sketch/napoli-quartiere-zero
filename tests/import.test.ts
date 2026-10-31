import test from 'node:test';import assert from 'node:assert/strict';import {importOSM} from '../src/import-osm';
test('relazione OSM multipoligono: membri spezzati, due corpi e cortile',()=>{
 const elements:unknown[]=[];let id=1;
 function ring(coords:number[][]){const ids=coords.map(([x,y])=>{const nid=id++;elements.push({type:'node',id:nid,lon:14.248+x*.00001,lat:40.828+y*.00001});return nid;});return [...ids,ids[0]];}
 const outer=ring([[0,0],[20,0],[20,20],[0,20]]),inner=ring([[5,5],[15,5],[15,15],[5,15]]),other=ring([[30,0],[40,0],[40,10],[30,10]]);
 elements.push({type:'way',id:100,nodes:outer.slice(0,3)},{type:'way',id:101,nodes:outer.slice(2)},{type:'way',id:102,nodes:inner},{type:'way',id:103,nodes:other},{type:'relation',id:200,tags:{type:'multipolygon',building:'yes','building:levels':'3'},members:[{type:'way',ref:100,role:'outer'},{type:'way',ref:101,role:'outer'},{type:'way',ref:102,role:'inner'},{type:'way',ref:103,role:'outer'}]});
 const map=importOSM({version:.6,elements});assert.equal(map.buildings.length,2);assert.equal(map.buildings.filter(b=>b.rings.length===2).length,1);for(const b of map.buildings)assert.ok(Math.abs(b.height-9.6)<.001);
});
