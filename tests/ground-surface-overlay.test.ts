import test from 'node:test';
import assert from 'node:assert/strict';
import {conformSurfaceToGround,type GroundOverlaySurface} from '../src/ground-surface-overlay';
import {createTriangleSurfaceSampler} from '../src/triangle-surface';

const near=(actual:number|undefined,expected:number,tolerance=1e-8)=>assert.ok(actual!==undefined&&Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`);
function quad(x0:number,z0:number,x1:number,z1:number):GroundOverlaySurface{return {positions:[x0,0,z0,x1,0,z0,x1,0,z1,x0,0,z1],indices:[0,1,2,0,2,3]};}
const ridge=()=>({positions:[0,0,0,2,2,0,4,0,0,0,0,4,2,2,4,4,0,4],indices:[0,1,3,1,4,3,1,2,4,2,5,4]});
function area(mesh:{positions:ArrayLike<number>;indices:ArrayLike<number>}){
  let sum=0;for(let i=0;i<mesh.indices.length;i+=3){const [a,b,c]=[mesh.indices[i],mesh.indices[i+1],mesh.indices[i+2]].map(id=>[mesh.positions[id*3],mesh.positions[id*3+2]]);sum+=((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;}return sum;
}
function ring(){
  const points=[[0,0],[4,0],[4,4],[0,4],[1,1],[3,1],[3,3],[1,3]],positions=points.flatMap(([x,z])=>[x,.1*x+.2*z,z]);
  return {positions,indices:[0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]};
}

test('overlay splits at a nonplanar ground crease and every face follows its actual rendered ground plane',()=>{
  const surface=quad(-1,-1,5,5),ground=ridge(),before=JSON.stringify({surface,ground}),result=conformSurfaceToGround(surface,ground,{offset:.04,uvMetres:3,cellSize:1}),sample=createTriangleSurfaceSampler([ground]);
  near(area(result),16);assert.ok(result.stats.triangles>surface.indices.length/3);assert.equal(result.sourceTriangles.length,result.indices.length/3);
  for(let i=0;i<result.indices.length;i+=3){
    const vertices=result.indices.slice(i,i+3).map(id=>result.positions.slice(id*3,id*3+3));
    const x=vertices.reduce((sum,p)=>sum+p[0],0)/3,y=vertices.reduce((sum,p)=>sum+p[1],0)/3,z=vertices.reduce((sum,p)=>sum+p[2],0)/3;
    near(y,sample.heightAt(x,z)!+.04);assert.ok(!(Math.min(...vertices.map(p=>p[0]))<2-1e-9&&Math.max(...vertices.map(p=>p[0]))>2+1e-9),'no output face bridges the ridge');
  }
  for(let i=0;i<result.positions.length;i+=3){near(result.uvs[i/3*2],result.positions[i]/3);near(result.uvs[i/3*2+1],result.positions[i+2]/3);assert.ok(result.normals[i+1]>0);}
  assert.equal(JSON.stringify({surface,ground}),before);
});
test('intersection preserves both missing ground and original overlay holes without inventing coverage',()=>{
  const ground=ring(),surface=quad(-1,-1,5,5),result=conformSurfaceToGround(surface,ground,{offset:.025,uvMetres:2}),sample=createTriangleSurfaceSampler([result]);
  near(area(result),12);assert.equal(sample.heightAt(2,2),undefined);assert.equal(sample.heightAt(-.5,2),undefined);near(sample.heightAt(.5,2),.05+.4+.025);
  const overlayHole=conformSurfaceToGround(ring(),quad(0,0,4,4),{offset:.03,uvMetres:2});near(area(overlayHole),12);assert.equal(createTriangleSurfaceSampler([overlayHole]).heightAt(2,2),undefined);
});
test('original UVs and curb profile offsets interpolate through splits with resulting geometric normals and source mapping',()=>{
  const surface=quad(0,0,4,4),ground=ridge();surface.uvs=[0,0,1,0,1,2,0,2];
  const vertexOffsets=[.1,.22,.30,.18],before=JSON.stringify({surface,ground,vertexOffsets}),result=conformSurfaceToGround(surface,ground,{offset:.02,uvMetres:999,vertexOffsets}),sample=createTriangleSurfaceSampler([ground]);
  near(area(result),16);
  for(let i=0;i<result.positions.length;i+=3){
    const [x,y,z]=result.positions.slice(i,i+3);near(y,sample.heightAt(x,z)!+.02+.1+.03*x+.02*z);near(result.uvs[i/3*2],x/4);near(result.uvs[i/3*2+1],z/2);
    const face=Math.floor(i/9),ids=result.indices.slice(face*3,face*3+3),centerX=ids.reduce((sum,id)=>sum+result.positions[id*3],0)/3,dx=centerX<2?1.03:-.97,length=Math.hypot(dx,1,.02);
    near(result.normals[i],-dx/length);near(result.normals[i+1],1/length);near(result.normals[i+2],-.02/length);
    const source=result.sourceTriangles[face];assert.ok(source===0||source===1);
    if(source===0)assert.ok(x>=z-1e-9);else assert.ok(x<=z+1e-9);
  }
  assert.equal(JSON.stringify({surface,ground,vertexOffsets}),before);
});
test('provided ground normals interpolate and normalize while source winding remains intact',()=>{
  const ground={...quad(0,0,4,4),normals:[0,1,0,.2,1,0,.2,1,.2,0,1,.2]},surface=quad(0,0,4,4),result=conformSurfaceToGround(surface,ground,{offset:0,uvMetres:1});
  for(let i=0;i<result.normals.length;i+=3){near(Math.hypot(...result.normals.slice(i,i+3)),1);assert.ok(result.normals[i+1]>0);}
  const reverse={...surface,indices:[0,2,1,0,3,2]},reversed=conformSurfaceToGround(reverse,ground,{offset:0,uvMetres:1});near(area(reversed),-16);
});
test('invalid data, profile buffers and bounded budgets fail closed',()=>{
  const surface=quad(0,0,4,4),ground=ridge();
  for(const options of [{offset:NaN,uvMetres:1},{offset:0,uvMetres:0},{offset:0,uvMetres:1,cellSize:Infinity},{offset:0,uvMetres:1,maxTriangles:200001},{offset:0,uvMetres:1,maxTriangles:1}])assert.throws(()=>conformSurfaceToGround(surface,ground,options),RangeError);
  assert.throws(()=>conformSurfaceToGround({...surface,positions:[NaN,0,0]},ground,{offset:0,uvMetres:1}),TypeError);
  assert.throws(()=>conformSurfaceToGround({...surface,indices:[0,1,99]},ground,{offset:0,uvMetres:1}),RangeError);
  assert.throws(()=>conformSurfaceToGround({...surface,uvs:[0,0]},ground,{offset:0,uvMetres:1}),TypeError);
  assert.throws(()=>conformSurfaceToGround(surface,ground,{offset:0,uvMetres:1,vertexOffsets:[0,1]}),TypeError);
  assert.throws(()=>conformSurfaceToGround(surface,{...ground,normals:[NaN]},{offset:0,uvMetres:1}),TypeError);
  assert.throws(()=>conformSurfaceToGround(surface,ground,{offset:0,uvMetres:1,cellSize:1e-8}),RangeError);
});
