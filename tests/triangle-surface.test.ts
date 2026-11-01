import test from 'node:test';
import assert from 'node:assert/strict';
import {createTriangleSurfaceSampler,type TriangleSurfaceBatch} from '../src/triangle-surface';

function plane(heightAt:(x:number,z:number)=>number):TriangleSurfaceBatch {
  const points=[[-4,-4],[8,-4],[8,8],[-4,8]];
  return {positions:points.flatMap(([x,z])=>[x,heightAt(x,z),z]),indices:[0,1,2,0,2,3]};
}
const near=(actual:number|undefined,expected:number)=>assert.ok(actual!==undefined&&Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);

test('barycentric support follows rendered sloping triangles in negative and positive grid cells',()=>{
  const height=(x:number,z:number)=>-8+x*.25-z*.125,batch=plane(height),before=JSON.stringify(batch),surface=createTriangleSurfaceSampler([batch],{cellSize:2});
  for(const [x,z]of [[-4,-4],[-3.5,1.25],[1,1],[7.5,4.2],[8,8],[0,-1]])near(surface.heightAt(x,z),height(x,z));
  assert.equal(surface.heightAt(9,2),undefined);assert.equal(surface.heightAt(-4.01,2),undefined);
  assert.equal(surface.heightAt(NaN,1),undefined);assert.equal(surface.heightAt(1,Infinity),undefined);
  assert.equal(surface.stats.supportTriangles,2);assert.ok(surface.stats.cells>1);assert.equal(JSON.stringify(batch),before);
  surface.dispose();assert.equal(surface.heightAt(1,1),undefined);
});
test('overlapping rendered faces choose their highest actual height without a zero baseline',()=>{
  const low=plane(()=>-5),high=plane((x,z)=>-3+x*.02+z*.03),surface=createTriangleSurfaceSampler([low,high]);
  near(surface.heightAt(1,2),-2.92);near(createTriangleSurfaceSampler([low]).heightAt(1,2),-5);
  const disconnected:TriangleSurfaceBatch={positions:[0,-2,0,2,-2,0,0,-2,2,4,3,4,6,3,4,4,3,6],indices:[0,1,2,3,4,5]};
  assert.equal(createTriangleSurfaceSampler([disconnected]).heightAt(3,3),undefined);
});
test('vertical, downward and excessive curb-bevel slopes do not support feet',()=>{
  const flat=plane(()=>-2),down={...plane(()=>4),indices:[0,2,1,0,3,2]};
  const vertical:TriangleSurfaceBatch={positions:[0,0,0,0,5,0,0,0,5],indices:[0,1,2]};
  const steep=plane(x=>x*4),sloped=plane(x=>-1+x*.2);
  const surface=createTriangleSurfaceSampler([flat,down,vertical,steep,sloped],{maxSlope:.5});
  near(surface.heightAt(1,1),-.8);assert.equal(surface.stats.sourceTriangles,9);assert.equal(surface.stats.supportTriangles,4);
  near(createTriangleSurfaceSampler([steep]).heightAt(1,1),4);
  assert.equal(createTriangleSurfaceSampler([sloped],{maxSlope:0}).heightAt(1,1),undefined);
});
test('invalid buffers, coordinates, options and unbounded spatial allocation fail closed',()=>{
  const good=plane(()=>0);
  for(const cellSize of [0,-1,NaN,Infinity])assert.throws(()=>createTriangleSurfaceSampler([good],{cellSize}),RangeError);
  for(const maxSlope of [-1,NaN,-Infinity])assert.throws(()=>createTriangleSurfaceSampler([good],{maxSlope}),RangeError);
  assert.throws(()=>createTriangleSurfaceSampler([{positions:[0,0],indices:[]}]),TypeError);
  assert.throws(()=>createTriangleSurfaceSampler([{positions:good.positions,indices:[0,1]}]),TypeError);
  for(const invalid of [NaN,Infinity])assert.throws(()=>createTriangleSurfaceSampler([{positions:[invalid,0,0,1,0,0,0,0,1],indices:[0,1,2]}]),TypeError);
  for(const invalid of [-1,1.5,4,NaN])assert.throws(()=>createTriangleSurfaceSampler([{positions:[0,0,0,1,0,0,0,0,1],indices:[0,1,invalid]}]),RangeError);
  assert.throws(()=>createTriangleSurfaceSampler([good],{cellSize:1e-5}),RangeError);
});
