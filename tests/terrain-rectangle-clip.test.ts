import test from 'node:test';
import assert from 'node:assert/strict';
import {clipTerrainTriangleOutsideBounds,type TerrainClipVertex} from '../src/terrain-rectangle-clip';

const height=(x:number,z:number)=>3+.2*x-.4*z;
const vertex=(x:number,z:number):TerrainClipVertex=>[x,height(x,z),z];
const area=(a:readonly number[],b:readonly number[],c:readonly number[])=>((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2;
const near=(actual:number,expected:number)=>assert.ok(Math.abs(actual-expected)<1e-9,`${actual} != ${expected}`);
function contains(triangle:readonly (readonly number[])[],x:number,z:number){
  const p=[x,0,z],sign=area(triangle[0],triangle[1],triangle[2])>0?1:-1;
  return triangle.every((a,i)=>sign*area(a,triangle[(i+1)%3],p)>1e-9);
}

test('crossing triangle partitions the rectangle exterior without gaps, overlaps or invented heights',()=>{
  const source=[vertex(-2,-2),vertex(6,-2),vertex(-2,6)],before=JSON.stringify(source),bounds=[0,0,2,2] as const;
  const triangles=clipTerrainTriangleOutsideBounds(source,bounds);
  near(triangles.reduce((sum,t)=>sum+area(t[0],t[1],t[2]),0),32-4);assert.ok(triangles.length>2);
  for(const triangle of triangles){
    assert.ok(area(triangle[0],triangle[1],triangle[2])>0);
    const x=triangle.reduce((sum,p)=>sum+p[0],0)/3,z=triangle.reduce((sum,p)=>sum+p[2],0)/3;
    assert.ok(x<0||x>2||z<0||z>2,'every output centroid is outside the city rectangle');
    for(const [vx,vy,vz]of triangle){near(vy,height(vx,vz));assert.ok(vx>=-2-1e-9&&vz>=-2-1e-9&&vx+vz<=4+1e-9);}
  }
  for(let x=-1.863;x<6;x+=.31)for(let z=-1.829;z<6;z+=.29){
    const count=triangles.filter(t=>contains(t,x,z)).length,expected=contains(source,x,z)&&!(x>=0&&x<=2&&z>=0&&z<=2)?1:0;
    assert.equal(count,expected,`partition at ${x},${z}`);
  }
  assert.equal(JSON.stringify(source),before);
});
test('all-inside, all-outside, border-touching and degenerate source faces retain the correct portions',()=>{
  const bounds=[0,0,2,2] as const;
  assert.deepEqual(clipTerrainTriangleOutsideBounds([vertex(0,0),vertex(2,0),vertex(0,2)],bounds),[]);
  const outside=[vertex(-3,0),vertex(-1,0),vertex(-3,2)];assert.deepEqual(clipTerrainTriangleOutsideBounds(outside,bounds),[outside]);
  const touching=[vertex(0,.5),vertex(0,1.5),vertex(-2,1)],pieces=clipTerrainTriangleOutsideBounds(touching,bounds);
  near(pieces.reduce((sum,t)=>sum+area(t[0],t[1],t[2]),0),area(...touching as [TerrainClipVertex,TerrainClipVertex,TerrainClipVertex]));
  assert.deepEqual(clipTerrainTriangleOutsideBounds([vertex(-2,-2),vertex(0,0),vertex(2,2)],bounds),[]);
});
test('clockwise source winding and its affine height plane survive clipping',()=>{
  const source=[vertex(-2,6),vertex(6,-2),vertex(-2,-2)],triangles=clipTerrainTriangleOutsideBounds(source,[0,0,2,2]);
  near(triangles.reduce((sum,t)=>sum+area(t[0],t[1],t[2]),0),-28);
  for(const triangle of triangles){assert.ok(area(triangle[0],triangle[1],triangle[2])<0);for(const [x,y,z]of triangle)near(y,height(x,z));}
});
test('invalid triangles and rectangles fail closed before generating geometry',()=>{
  const source=[vertex(-2,-2),vertex(6,-2),vertex(-2,6)];
  assert.throws(()=>clipTerrainTriangleOutsideBounds(source.slice(0,2),[0,0,2,2]),TypeError);
  assert.throws(()=>clipTerrainTriangleOutsideBounds([[0,NaN,0],vertex(1,0),vertex(0,1)],[0,0,2,2]),TypeError);
  for(const bounds of [[0,0,0,2],[0,2,2,0],[0,0,Infinity,2],[NaN,0,2,2]] as const)assert.throws(()=>clipTerrainTriangleOutsideBounds(source,bounds),RangeError);
  assert.throws(()=>clipTerrainTriangleOutsideBounds([[1e308,0,0],[-1e308,0,0],[0,0,1e308]],[0,0,2,2]),RangeError);
});
