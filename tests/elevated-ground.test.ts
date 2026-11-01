import test from 'node:test';
import assert from 'node:assert/strict';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {inside,segmentDistance,type Point} from '../src/geo';
import {addElevatedGround,buildElevatedGroundGeometry,createElevatedGroundSampler,type ElevatedGroundGeometry} from '../src/elevated-ground';

function topology(g:ElevatedGroundGeometry){
  const edges=new Map<string,{a:Point;b:Point;count:number}>();
  for(let i=0;i<g.indices.length;i+=3)for(let j=0;j<3;j++){
    const aa=g.indices[i+j],bb=g.indices[i+(j+1)%3],k=aa<bb?aa+','+bb:bb+','+aa;
    const edge=edges.get(k)??{a:[g.positions[aa*3],g.positions[aa*3+2]],b:[g.positions[bb*3],g.positions[bb*3+2]],count:0};edge.count++;edges.set(k,edge);
  }
  return [...edges.values()];
}
function projectedArea(g:ElevatedGroundGeometry){let sum=0;for(let i=0;i<g.indices.length;i+=3){const [a,b,c]=g.indices.slice(i,i+3).map(v=>[g.positions[v*3],g.positions[v*3+2]]);const area=((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;assert.ok(area>0);sum+=area;}return sum;}
function hasPoint(g:ElevatedGroundGeometry,x:number,z:number){
  for(let i=0;i<g.indices.length;i+=3){const p=g.indices.slice(i,i+3).map(v=>[g.positions[v*3],g.positions[v*3+2]] as Point),cross=p.map((a,j)=>{const b=p[(j+1)%3];return(b[0]-a[0])*(z-a[1])-(b[1]-a[1])*(x-a[0]);});if(cross.every(n=>n>=-1e-9))return true;}return false;
}

test('elevated land keeps its exact outer boundary and courtyard hole after refinement',()=>{
  const outer:Point[]=[[0,0],[12,0],[12,10],[0,10]],hole:Point[]=[[4,3],[8,3],[8,7],[4,7]],land=[[outer,hole]],before=JSON.stringify(land);
  const g=buildElevatedGroundGeometry(land,(x,z)=>x*.08+z*.04,{maxEdge:1.5,maxTriangles:2000});
  assert.equal(JSON.stringify(land),before);assert.ok(Math.abs(projectedArea(g)-104)<1e-8);assert.equal(g.stats.remainingLongEdges,0);assert.ok(g.stats.largestEdge<=1.5+1e-9);
  for(let x=.17;x<12;x+=.61)for(let z=.21;z<10;z+=.57)assert.equal(hasPoint(g,x,z),inside([x,z],outer)&&!inside([x,z],hole));
  for(const edge of topology(g)){assert.ok(edge.count===1||edge.count===2);if(edge.count===1)assert.ok([outer,hole].some(r=>r.some((a,i)=>segmentDistance(edge.a,a,r[(i+1)%r.length])<1e-8&&segmentDistance(edge.b,a,r[(i+1)%r.length])<1e-8)),'no invented coastal edge or interior crack');}
  for(let i=1;i<g.normals.length;i+=3)assert.ok(g.normals[i]>0,'Babylon computed normals face above the terrain');
});

test('differently segmented adjacent polygons form one conforming surface',()=>{
  const land:Point[][][]=[[[[0,0],[4,0],[4,4],[0,4]]],[[[4,0],[8,0],[8,4],[4,4],[4,2]]]];
  const g=buildElevatedGroundGeometry(land,(x,z)=>x*.1+z*.2,{maxEdge:1.2,maxTriangles:1000});
  assert.ok(g.stats.sourceConformitySplits>0,'source vertex removed by earcut is restored on shared edge');assert.ok(Math.abs(projectedArea(g)-32)<1e-8);
  const seam=topology(g).filter(e=>Math.abs(e.a[0]-4)<1e-9&&Math.abs(e.b[0]-4)<1e-9);assert.ok(seam.length>1);assert.ok(seam.every(e=>e.count===2),'no T-junction boundary on shared polygon seam');
  for(const edge of topology(g).filter(e=>e.count===1))assert.ok([edge.a,edge.b].every(p=>Math.abs(p[0])<1e-8||Math.abs(p[0]-8)<1e-8||Math.abs(p[1])<1e-8||Math.abs(p[1]-4)<1e-8));
});

test('new shared vertices sample nonlinear heights once and batches retain smooth shared normals',()=>{
  const calls=new Map<string,number>(),height=(x:number,z:number)=>.03*x*x+.2*Math.sin(z),g=buildElevatedGroundGeometry([[[[0,0],[8,0],[8,6],[0,6]]]],(x,z)=>{const k=x+','+z;calls.set(k,(calls.get(k)??0)+1);return height(x,z);},{maxEdge:1.3,maxTriangles:1000,tileSize:2,maxVerticesPerBatch:12,uvMetres:2});
  assert.ok(g.stats.vertices>4);assert.ok([...calls.values()].every(n=>n===1));assert.equal(g.stats.heightSamples,calls.size);
  const normalByPoint=new Map<string,number[]>();
  for(let i=0;i<g.positions.length;i+=3){assert.ok(Math.abs(g.positions[i+1]-height(g.positions[i],g.positions[i+2]))<1e-12);normalByPoint.set(g.positions[i]+','+g.positions[i+2],g.normals.slice(i,i+3));assert.equal(g.uvs[i/3*2],g.positions[i]/2);}
  assert.equal(g.batches.reduce((n,b)=>n+b.indices.length/3,0),g.stats.triangles);
  for(const batch of g.batches){assert.ok(batch.positions.length/3<=12);assert.ok(batch.indices.every(v=>v<batch.positions.length/3));for(let i=0;i<batch.positions.length;i+=3)assert.deepEqual(batch.normals.slice(i,i+3),normalByPoint.get(batch.positions[i]+','+batch.positions[i+2]));}
});

test('triangle budget stops atomically without dropping land or opening cracks',()=>{
  const land:Point[][][]=[[[[0,0],[100,0],[100,100],[0,100]]]],g=buildElevatedGroundGeometry(land,()=>0,{maxEdge:1,maxTriangles:4});
  assert.equal(g.stats.triangles,4);assert.equal(g.stats.budgetReached,true);assert.ok(g.stats.remainingLongEdges>0);assert.equal(projectedArea(g),10000);
  for(const edge of topology(g)){assert.ok(edge.count<=2);if(edge.count===1)assert.ok([edge.a,edge.b].every(p=>p[0]===0||p[0]===100||p[1]===0||p[1]===100));}
  assert.throws(()=>buildElevatedGroundGeometry(land,()=>0,{maxTriangles:1}),/Initial terrain/);
  assert.throws(()=>buildElevatedGroundGeometry([[[[0,0],[4,0],[4,4],[0,4]]],[[[4,0],[8,0],[8,4],[4,4],[4,2]]]],()=>0,{maxEdge:100,maxTriangles:5}),/conform the source/);
});

test('invalid heights, crossings, overlap and invalid budgets fail closed',()=>{
  const square:Point[][][]=[[[[0,0],[4,0],[4,4],[0,4]]]];
  assert.throws(()=>buildElevatedGroundGeometry(square,()=>NaN),/nonfinite height/);assert.throws(()=>buildElevatedGroundGeometry(square,()=>1e100),/nonfinite height/);
  assert.throws(()=>buildElevatedGroundGeometry(square,()=>0,{maxTriangles:200001}),/budget/);assert.throws(()=>buildElevatedGroundGeometry(square,()=>0,{maxVerticesPerBatch:65536}),/budget/);
  assert.throws(()=>buildElevatedGroundGeometry([square[0],[[[1,1],[3,1],[3,3],[1,3]]]],()=>0),/Overlapping/);
  assert.throws(()=>buildElevatedGroundGeometry([square[0],[[[2,-1],[5,2],[2,5],[-1,2]]]],()=>0),/Crossing/);
});

test('surface query follows rendered triangle interpolation and leaves water holes empty',()=>{
  const g=buildElevatedGroundGeometry([[[[0,0],[8,0],[8,8],[0,8]],[[3,3],[5,3],[5,5],[3,5]]]],(x,z)=>x*x*.1+z*z*.2,{maxEdge:2,maxTriangles:2000}),sample=createElevatedGroundSampler(g);
  for(let i=0;i<g.indices.length;i+=3){const vertices=g.indices.slice(i,i+3).map(id=>g.positions.slice(id*3,id*3+3)),center=[0,1,2].map(axis=>vertices.reduce((sum,p)=>sum+p[axis],0)/3);assert.ok(Math.abs(sample(center[0],center[2])!-center[1])<1e-9);}
  assert.equal(sample(4,4),undefined);assert.equal(sample(-1,4),undefined);assert.equal(sample(NaN,4),undefined);
});

test('Babylon attachment keeps caller-owned material and camera-pickable land meshes',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),material=new StandardMaterial('caller-owned',scene);
  try{const ground=addElevatedGround(scene,[[[[0,0],[8,0],[8,8],[0,8]]]],(x,z)=>x*.1+z*.1,material,{maxEdge:2,tileSize:4});assert.ok(ground.meshes.length>1);assert.ok(ground.meshes.every(m=>m.material===material&&m.metadata.solid&&m.isPickable));assert.ok(Math.abs(ground.heightAt(2,2)!-.4)<1e-9);ground.dispose();assert.equal(ground.heightAt(2,2),undefined);assert.ok(scene.materials.includes(material));}finally{scene.dispose();engine.dispose();}
});
