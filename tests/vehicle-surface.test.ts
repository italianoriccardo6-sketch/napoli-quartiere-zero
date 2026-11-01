import test from 'node:test';
import assert from 'node:assert/strict';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import {vehicleSurfacePose} from '../src/vehicle-surface';

const near=(a:number,b:number,tolerance=1e-6)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);
test('car support pose follows the same rendered plane at every heading, including negative local heights',()=>{
  const surface=(x:number,z:number)=>-.3+.12*x-.075*z,size={halfLength:2.225,halfWidth:1.04},x=8,z=-3;
  for(const heading of [0,.3,Math.PI/2,2.4,Math.PI,-2.7]){
    const pose=vehicleSurfacePose(x,z,heading,size,surface);near(pose.height,surface(x,z));
    const matrix=Matrix.Compose(Vector3.One(),Quaternion.RotationYawPitchRoll(heading,pose.pitch,pose.roll),new Vector3(x,pose.height,z));
    for(const local of [new Vector3(-1,0,2),new Vector3(1,0,2),new Vector3(-1,0,-2),new Vector3(1,0,-2)]){
      const world=Vector3.TransformCoordinates(local,matrix);near(world.y,surface(world.x,world.z));
    }
  }
});
test('flat and irregular support samples have finite poses without modifying heading or source placement',()=>{
  const flat=vehicleSurfacePose(4,6,1,{halfLength:2,halfWidth:1},()=>-4.1);near(flat.height,-4.1);near(flat.pitch,0);near(flat.roll,0);
  let call=0;const input=[1,2,3,8],pose=vehicleSurfacePose(4,6,1,{halfLength:2,halfWidth:1},()=>input[call++]);
  near(pose.height,3.5);assert.deepEqual(pose.supportHeights,input);assert.ok(Number.isFinite(pose.pitch)&&Number.isFinite(pose.roll));
  assert.throws(()=>vehicleSurfacePose(0,0,0,{halfLength:0,halfWidth:1},()=>0));
  assert.throws(()=>vehicleSurfacePose(0,0,0,{halfLength:2,halfWidth:1},()=>NaN));
});
