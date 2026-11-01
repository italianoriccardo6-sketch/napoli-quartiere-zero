import test from 'node:test';
import assert from 'node:assert/strict';
import {buildElevatedGroundGeometry} from '../src/elevated-ground';
import {buildShorelineSideGeometry} from '../src/shoreline-sides';

test('coastal sides retain outer and hole boundaries, without a flat top or shared-patch wall',()=>{
  const terrain=buildElevatedGroundGeometry([[[[0,0],[4,0],[4,4],[0,4]],[[1,1],[2,1],[2,2],[1,2]]],[[[4,0],[8,0],[8,4],[4,4]]]],(x,z)=>-2+x*.1+z*.1,{maxEdge:1.5});
  const before=JSON.stringify(terrain.positions),sides=buildShorelineSideGeometry(terrain,-4.13);
  assert.equal(sides.boundaryEdges,terrain.stats.boundaryEdges);assert.equal(JSON.stringify(terrain.positions),before);
  for(let i=0;i<sides.positions.length;i+=12){
    const vertices=sides.positions.slice(i,i+12),[ax,ay,az,bx,by,bz]=vertices,bottomB=vertices[7],bottomA=vertices[10];
    assert.ok(Math.abs(ax-4)>1e-8||Math.abs(bx-4)>1e-8,'no vertical seam on adjacent land patches');
    assert.ok(bottomA<ay&&bottomB<by);assert.ok(ay<0&&by<0,'original negative heights survive');
    const span=Math.hypot(bx-ax,bz-az);assert.ok(span>0);
  }
  for(let i=0;i<sides.indices.length;i+=3){
    const [a,b,c]=sides.indices.slice(i,i+3).map(id=>sides.positions.slice(id*3,id*3+3));
    const projected=(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);assert.ok(Math.abs(projected)<1e-10,'vertical-only triangles cannot occlude negative terrain');
  }
});
