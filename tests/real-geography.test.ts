import test from 'node:test';
import assert from 'node:assert/strict';
import { ORIGIN, type Footprint } from '../src/geo';
import { extractRealGeography, stitchDirectedCoastlines, clearOfBuildings, sampleClearRoadPoints, nearestRoadPoint, pathClearOfBuildings, type RealRoad } from '../src/real-geography';

test('costa: assembla way disordinate senza invertirle e mantiene aperta la linea reale', () => {
  const result = stitchDirectedCoastlines([
    { id: 'b', nodeIds: ['2','3'], points: [[10,0],[20,0]] },
    { id: 'a', nodeIds: ['1','2'], points: [[0,0],[10,0]] },
  ]);
  assert.equal(result.chains.length, 1);assert.equal(result.chains[0].closed, false);
  assert.deepEqual(result.chains[0].points, [[0,0],[10,0],[20,0]]);assert.deepEqual(result.chains[0].sourceIds, ['a','b']);
  assert.deepEqual(result.ambiguousNodeIds, []);
});

test('costa: riconosce un anello e segnala diramazioni senza inventare raccordi', () => {
  const ring = stitchDirectedCoastlines([
    {id:'b',nodeIds:['2','3','1'],points:[[1,0],[1,1],[0,0]]},
    {id:'a',nodeIds:['1','2'],points:[[0,0],[1,0]]},
  ]);
  assert.equal(ring.chains[0].closed,true);assert.equal(ring.chains[0].points.length,3);
  const fork = stitchDirectedCoastlines([
    {id:'a',nodeIds:['1','2'],points:[[0,0],[1,0]]},
    {id:'b',nodeIds:['2','3'],points:[[1,0],[2,0]]},
    {id:'c',nodeIds:['2','4'],points:[[1,0],[1,1]]},
  ]);
  assert.deepEqual(fork.ambiguousNodeIds,['2']);assert.equal(fork.chains.length,3);assert.ok(fork.chains.every(c=>c.ambiguous));
});

test('estratto: conserva nomi/categorie/nodi e respinge una way incompleta', () => {
  const raw = {version:.6,elements:[
    {type:'node',id:1,lon:ORIGIN.lon,lat:ORIGIN.lat},
    {type:'node',id:2,lon:ORIGIN.lon+.001,lat:ORIGIN.lat},
    {type:'node',id:3,lon:ORIGIN.lon+.001,lat:ORIGIN.lat+.001},
    {type:'way',id:10,nodes:[1,2,3],tags:{highway:'pedestrian',name:'Via di prova',width:'5.5 m',surface:'paving_stones',tunnel:'building_passage',bridge:'no',covered:'yes',layer:'-1'}},
    {type:'way',id:11,nodes:[3,99],tags:{highway:'service'}},
    {type:'way',id:12,nodes:[1,2],tags:{natural:'coastline'}},
  ]};
  const result=extractRealGeography(raw);assert.equal(result.roads.length,1);assert.equal(result.roads[0].name,'Via di prova');
  assert.equal(result.roads[0].tunnel,'building_passage');assert.equal(result.roads[0].bridge,'no');assert.equal(result.roads[0].covered,'yes');assert.equal(result.roads[0].layer,'-1');
  assert.equal(result.roads[0].highway,'pedestrian');assert.equal(result.roads[0].width,5.5);assert.deepEqual(result.roads[0].nodeIds,['1','2','3']);
  assert.deepEqual(result.diagnostics.incompleteWays,['way/11']);assert.equal(result.coastlines[0].closed,false);
  assert.deepEqual(result.map.land,[],'nessuna superficie di terra inventata');
});

const building:Footprint={id:'courtyard',height:10,estimated:true,rings:[[[0,0],[20,0],[20,20],[0,20]],[[5,5],[15,5],[15,15],[5,15]]]};
const road:RealRoad={id:'road',name:'Riva',highway:'service',nodeIds:['a','b','c'],points:[[-10,-5],[10,-5],[10,25]],width:4};
test('campioni e percorso rispettano l’ingombro dei palazzi e i muri dei cortili', () => {
  assert.equal(clearOfBuildings([10,10],[building],.6),true);assert.equal(clearOfBuildings([2,10],[building],.6),false);
  assert.equal(clearOfBuildings([5.1,10],[building],.6),false);assert.equal(clearOfBuildings([Infinity,0],[building]),false);
  const points=sampleClearRoadPoints([road],[building],{spacing:5,radius:.6});assert.ok(points.length>0);
  assert.ok(points.every(p=>clearOfBuildings(p.point,[building],.6)));
  assert.equal(pathClearOfBuildings([[-5,10],[25,10]],[building],.6),false);
  assert.equal(pathClearOfBuildings([[-5,-5],[25,-5]],[building],.6),true);
  assert.equal(sampleClearRoadPoints([{...road,width:.5}],[building],{radius:.6}).length,0);
});

test('proiezione metrica su strada, limite distanza e copie indipendenti', () => {
  const result=nearestRoadPoint([-3,-7],[road],3)!;
  assert.deepEqual(result.point,[-3,-5]);assert.equal(result.distance,2);assert.equal(result.distanceAlong,7);
  assert.equal(nearestRoadPoint([-3,-7],[road],1),null);
  const points=sampleClearRoadPoints([road],[],{spacing:5,limit:2});assert.equal(points.length,2);
  points[0].point[0]=100;assert.deepEqual(road.points[0],[-10,-5]);
});
