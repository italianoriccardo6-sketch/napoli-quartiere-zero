import test from 'node:test';
import assert from 'node:assert/strict';
import { inside, type Point } from '../src/geo';
import { buildNaplesLand } from '../src/land-from-coast';
import type { CoastlineChain } from '../src/real-geography';
const chain=(points:Point[]):CoastlineChain=>({sourceIds:['way/test'],points,nodeIds:points.map((_,i)=>String(i)),closed:false,ambiguous:false});
const isLand=(p:Point,polygons:Point[][][])=>polygons.some(([outer,...holes])=>inside(p,outer)&&!holes.some(h=>inside(p,h)));

test('terra dalla costa misurata: chiusura fuori mappa e mare sul lato destro',()=>{
 const land=buildNaplesLand([chain([[-2,3],[4,3],[12,3]])],[0,0,10,10]);
 assert.equal(land.provenance.syntheticClosureOutsideBounds,true);assert.equal(land.polygons.length,1);
 assert.equal(isLand([5,8],land.polygons),true);assert.equal(isLand([5,1],land.polygons),false);
 assert.ok(land.polygons.flat(2).every(p=>p[0]>=0&&p[0]<=10&&p[1]>=0&&p[1]<=10));
 assert.ok(land.provenance.syntheticClosure.slice(1,-1).every(p=>p[0]<0||p[0]>10||p[1]>10));
});

test('ritagli multipli ai bordi conservano penisole e separazioni del porto',()=>{
 const coast:Point[]=[[-2,2],[3,2],[3,-2],[6,-2],[6,3],[12,3],[12,6],[7,6],[7,12],[9,12],[9,9],[12,9],[13,13]];
 const land=buildNaplesLand([chain(coast)],[0,0,10,10]);
 assert.ok(land.polygons.length>=2,'più corpi dopo il taglio del molo al bordo');
 assert.equal(isLand([1,8],land.polygons),true);assert.equal(isLand([5,1],land.polygons),true);
 assert.equal(isLand([8,8],land.polygons),false);assert.equal(isLand([9.5,9.5],land.polygons),true);
});

test('il ritaglio conserva un anello di acqua senza riempirlo come terra',()=>{
 const coast:Point[]=[[-2,3],[4,3],[3,5],[4,7],[6,7],[7,5],[4,3],[12,3]];
 const land=buildNaplesLand([chain(coast)],{minX:0,minZ:0,maxX:10,maxZ:10});
 assert.equal(isLand([5,5],land.polygons),false);assert.equal(isLand([8,8],land.polygons),true);
 assert.ok(land.polygons.some(p=>p.length>1),'anello interno preservato');
});

test('topologie inattese vengono respinte invece di inventare rive',()=>{
 assert.throws(()=>buildNaplesLand([], [0,0,10,10]));
 assert.throws(()=>buildNaplesLand([{...chain([[-2,3],[12,3]]),closed:true}],[0,0,10,10]));
 assert.throws(()=>buildNaplesLand([{...chain([[-2,3],[12,3]]),ambiguous:true}],[0,0,10,10]));
 assert.throws(()=>buildNaplesLand([chain([[2,3],[12,3]])],[0,0,10,10]));
 assert.throws(()=>buildNaplesLand([chain([[12,3],[-2,3]])],[0,0,10,10]));
 assert.throws(()=>buildNaplesLand([chain([[-2,3],[6,7],[2,7],[6,3],[12,3]])],[0,0,10,10]),/intersezioni/);
 assert.throws(()=>buildNaplesLand([chain([[-2,-3],[12,-3]])],[0,0,10,10]),/non attraversa/);
});
