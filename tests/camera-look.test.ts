import test from 'node:test';import assert from 'node:assert/strict';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';import {Scene} from '@babylonjs/core/scene';import {Vector3} from '@babylonjs/core/Maths/math.vector';import {createCamera} from '../src/camera';
test('mouse verso destra ruota lo sguardo verso destra della telecamera',()=>{
  const engine=new NullEngine({renderWidth:800,renderHeight:600,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4}),scene=new Scene(engine);
  try{const cam=createCamera(scene);cam.orient(0);cam.snap(Vector3.Zero());cam.camera.getViewMatrix(true);const right=cam.camera.getDirection(Vector3.Right());right.y=0;right.normalize();cam.rotate(100,0);cam.snap(Vector3.Zero());cam.camera.getViewMatrix(true);const forward=cam.camera.getDirection(Vector3.Forward());forward.y=0;forward.normalize();assert.ok(Vector3.Dot(right,forward)>.2);}finally{scene.dispose();engine.dispose();}
});
