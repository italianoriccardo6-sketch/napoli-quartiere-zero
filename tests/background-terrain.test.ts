import test from 'node:test';import assert from 'node:assert/strict';
import {backgroundTerrainGeometry,createBackgroundTerrain,validateBackgroundTerrain,type BackgroundTerrainData} from '../src/background-terrain';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';
import {toLocal} from '../src/geo';
const fixture=():BackgroundTerrainData=>({version:1,purpose:'distant-background-only',bbox:{west:14.2,south:40.8,east:14.3,north:40.9},columns:3,rows:3,heights_m:[100,120,140,80,100,120,50,80,100],valid:Array(9).fill(1),sea_level_m:0,source:{attribution:'Synthetic test fixture, not actual terrain'}});
test('background relief preserves metre heights and north-to-south row order',()=>{const data=fixture(),g=backgroundTerrainGeometry(data,{excludeLocalBounds:[1e6,1e6,1e6+1,1e6+1],exclusionPaddingM:0});assert.equal(g.positions[1],100);assert.ok(g.positions[2]>g.positions.at(-1)!);assert.equal(g.indices.length/3,8);assert.ok(g.normals[1]>0);});
test('background omits sea, invalid cells and city-overlapping cells',()=>{const data=fixture();data.heights_m.fill(0);assert.equal(backgroundTerrainGeometry(data,{excludeLocalBounds:[1e6,1e6,1e6+1,1e6+1]}).indices.length,0);data.heights_m.fill(10);data.valid.fill(0);assert.equal(backgroundTerrainGeometry(data,{excludeLocalBounds:[1e6,1e6,1e6+1,1e6+1]}).indices.length,0);data.valid.fill(1);const [west,south]=toLocal(14.19,40.79),[east,north]=toLocal(14.31,40.91);assert.equal(backgroundTerrainGeometry(data,{excludeLocalBounds:[west,south,east,north],exclusionPaddingM:0}).indices.length,0);});
test('background validates provenance, masks, bounds and a strict triangle budget',()=>{assert.equal(validateBackgroundTerrain(fixture()).rows,3);for(const change of [{purpose:'gameplay'},{columns:1000,rows:1000},{heights_m:[NaN]},{valid:[1]},{bbox:{west:13,south:40,east:15,north:41}}])assert.throws(()=>validateBackgroundTerrain({...fixture(),...change}));});
test('clipped background reaches the exact city boundary and retains partial source cells with native heights plus scene offset',()=>{
 const data={...fixture(),columns:2,rows:2,heights_m:[100,120,80,100],valid:[1,1,1,1]},before=JSON.stringify(data),[west,south]=toLocal(data.bbox.west,data.bbox.south),[east,north]=toLocal(data.bbox.east,data.bbox.north),width=east-west,depth=north-south;
 const bounds=[west+width*.25,south+depth*.25,west+width*.75,south+depth*.75] as const,offset=-4.13238,options={excludeLocalBounds:bounds,exclusionPaddingM:0,clipToCityBounds:true,verticalOffsetM:offset};
 const geometry=backgroundTerrainGeometry(data,options),defaultClip=backgroundTerrainGeometry(data,{excludeLocalBounds:bounds,clipToCityBounds:true,verticalOffsetM:offset});
 assert.deepEqual(defaultClip,geometry,'clip mode defaults to zero boundary padding');assert.equal(backgroundTerrainGeometry(data,{excludeLocalBounds:bounds,exclusionPaddingM:0}).indices.length,0,'legacy whole-cell omission stays available');
 let projectedArea=0,borderVertices=0;
 for(let i=0;i<geometry.indices.length;i+=3){
  const p=geometry.indices.slice(i,i+3).map(index=>geometry.positions.slice(index*3,index*3+3)),[a,b,c]=p,x=p.reduce((sum,v)=>sum+v[0],0)/3,z=p.reduce((sum,v)=>sum+v[2],0)/3;
  assert.ok(x<=bounds[0]||x>=bounds[2]||z<=bounds[1]||z>=bounds[3]);projectedArea+=Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2;
 }
 assert.ok(Math.abs(projectedArea-width*depth*.75)<1e-6,'retain the exterior area of a partially intersected cell');
 for(let i=0;i<geometry.positions.length;i+=3){
  const [x,y,z]=geometry.positions.slice(i,i+3),sourceHeight=80+(x-west)/width*20+(z-south)/depth*20;
  assert.ok(Math.abs(y-sourceHeight-offset)<1e-9);if(bounds.includes(x)||bounds.includes(z))borderVertices++;
  assert.ok(!(x>bounds[0]&&x<bounds[2]&&z>bounds[1]&&z<bounds[3]));
 }
 assert.ok(borderVertices>0);assert.equal(JSON.stringify(data),before);assert.ok(geometry.normals.filter((_,i)=>i%3===1).every(y=>y>0));
 assert.equal(geometry.colors.length,geometry.positions.length/3*4);
});
test('background scene offsets preserve native color and sea/missing-cell decisions and reject nonfinite offsets',()=>{
 const data=fixture(),excludeLocalBounds=[1e6,1e6,1e6+1,1e6+1] as const,original=backgroundTerrainGeometry(data,{excludeLocalBounds}),shifted=backgroundTerrainGeometry(data,{excludeLocalBounds,verticalOffsetM:-700});
 assert.deepEqual(shifted.indices,original.indices);assert.deepEqual(shifted.colors,original.colors);
 for(let i=0;i<shifted.positions.length;i++)assert.ok(Math.abs(shifted.positions[i]-original.positions[i]-(i%3===1?-700:0))<1e-9);
 for(const verticalOffsetM of [NaN,Infinity,-Infinity])assert.throws(()=>backgroundTerrainGeometry(data,{excludeLocalBounds,verticalOffsetM}),RangeError);
 data.heights_m.fill(0);assert.equal(backgroundTerrainGeometry(data,{excludeLocalBounds,clipToCityBounds:true,verticalOffsetM:100}).indices.length,0);data.heights_m.fill(10);data.valid[0]=0;assert.equal(backgroundTerrainGeometry(data,{excludeLocalBounds,clipToCityBounds:true}).indices.length/3,6);
});
test('attached background reports the supplied artistic offset without claiming a certified datum conversion',()=>{
 const engine=new NullEngine(),scene=new Scene(engine);
 try{const mesh=createBackgroundTerrain(scene,fixture(),{excludeLocalBounds:[1e6,1e6,1e6+1,1e6+1],clipToCityBounds:true,verticalOffsetM:-4.13238});
  assert.ok(mesh);assert.equal(mesh.isPickable,false);assert.equal(mesh.checkCollisions,false);assert.equal(mesh.metadata.cityExclusion,'source-triangles-clipped-at-rectangle');assert.equal(mesh.metadata.verticalReference.sceneOffsetMetres,-4.13238);assert.equal(mesh.metadata.verticalReference.certifiedDatumTransform,false);assert.match(mesh.metadata.verticalReference.source,/SRTM.*EGM96/);
 }finally{scene.dispose();engine.dispose();}
});
