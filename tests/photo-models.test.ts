import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import {registerBuiltInLoaders} from '@babylonjs/loaders/dynamic';
const folder='public/assets/photo-models/';
if(['car-white-core.glb','civilian-standing-core.glb','patrol-beacon-core.glb','mission-marker-core.glb','hand-core.glb'].some(file=>!existsSync(folder+file)))execFileSync(process.execPath,['--import','tsx','scripts/prepare-photo-models.mjs'],{stdio:'pipe'});
const manifest=JSON.parse(readFileSync(folder+'manifest.json','utf8'));
const sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
function parseGLB(bytes:Buffer){
  assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length);
  const jsonLength=bytes.readUInt32LE(12);assert.equal(bytes.readUInt32LE(16),0x4e4f534a);
  const json=JSON.parse(bytes.subarray(20,20+jsonLength).toString('utf8')),at=20+jsonLength;assert.equal(bytes.readUInt32LE(at+4),0x004e4942);
  return{json,bin:bytes.subarray(at+8,at+8+bytes.readUInt32LE(at))};
}
function noExtensions(value:unknown){if(!value||typeof value!=='object')return;const object=value as Record<string,unknown>;assert.equal('extensions' in object,false);assert.equal('extensionsUsed' in object,false);assert.equal('extensionsRequired' in object,false);for(const child of Object.values(object))noExtensions(child);}

test('photo models: real GLBs are core-only, completely embedded and preserve original licensed source bytes',()=>{
  assert.equal(manifest.version,1);assert.equal(manifest.googleImageryIncluded,false);assert.equal(manifest.runtimeConversion,false);
  for(const source of manifest.sources){assert.equal(sha(readFileSync('public/'+source.path)),source.sha256);}
  assert.match(readFileSync(folder+'ATTRIBUTION.txt','utf8'),/Eric Chadwick/);assert.match(readFileSync(folder+'LICENSE-car-CC-BY-4.0.txt','utf8'),/Attribution 4.0/);assert.match(readFileSync(folder+'ATTRIBUTION-civilian.md','utf8'),/Meshy/);
  for(const output of manifest.outputs){
    const bytes=readFileSync(folder+output.file),{json,bin}=parseGLB(bytes);assert.equal(bytes.length,output.bytes);assert.equal(sha(bytes),output.sha256);assert.ok(bytes.length<5_000_000,'each native model stays below the Maps best-practice 5 MB target');noExtensions(json);
    assert.deepEqual(output.orientationOffset,{heading:180,tilt:270,roll:0},'native Maps ENU correction is metadata; GLB geometry remains +Y-up/+Z-forward');
    assert.equal(json.buffers.length,1);assert.equal(json.buffers[0].uri,undefined);assert.ok(bin.length-json.buffers[0].byteLength>=0&&bin.length-json.buffers[0].byteLength<=3);
    for(const image of json.images??[]){assert.equal(image.uri,undefined);assert.ok(['image/png','image/jpeg'].includes(image.mimeType));assert.ok(Number.isInteger(image.bufferView));}
    for(const view of json.bufferViews){assert.equal(view.buffer,0);assert.ok(view.byteOffset>=0&&view.byteOffset%4===0&&view.byteOffset+view.byteLength<=bin.length);}
    for(const accessor of json.accessors){assert.ok(Number.isSafeInteger(accessor.count)&&accessor.count>0);assert.equal(accessor.sparse,undefined);assert.ok(accessor.min?.every(Number.isFinite)??true);assert.ok(accessor.max?.every(Number.isFinite)??true);}
    for(const mesh of json.meshes)for(const p of mesh.primitives){assert.equal(p.mode??4,4);assert.ok(p.attributes.POSITION!==undefined&&p.attributes.NORMAL!==undefined);}
  }
});

test('photo car: imported real geometry is 4.4m, grounded, centred and wheel axis points +Z',{timeout:15000},async()=>{
  const record=manifest.outputs[0];assert.equal(record.optimization.tool,'meshoptimizer');assert.equal(record.optimization.version,'1.3.0');assert.equal(record.optimization.sourceTriangles,213313);assert.equal(record.optimization.runtimeCompression,false);assert.ok(record.triangles>20000&&record.triangles<90000);
  assert.ok(record.optimization.achievedMaximumRelativeError<=record.optimization.maximumRelativeSimplificationError);
  const asset=parseGLB(readFileSync(folder+'car-white-core.glb'));
  for(const [index,image]of asset.json.images.entries()){
    const view=asset.json.bufferViews[image.bufferView],png=asset.bin.subarray(view.byteOffset,view.byteOffset+view.byteLength),texture=record.convertedTextures[index];
    assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),texture.width);assert.equal(png.readUInt32BE(20),texture.height);assert.ok(texture.width<=1024&&texture.height<=1024);assert.equal(sha(png),texture.pngSHA256);assert.equal(sha(readFileSync('public/assets/vehicles/car-concept/'+texture.source)),texture.sourceSHA256);
  }
  assert.ok(record.convertedTextures.some((texture:{resampled:boolean})=>texture.resampled));
  const engine=new NullEngine({renderWidth:1,renderHeight:1,textureSize:16,deterministicLockstep:true,lockstepMaxSteps:1}),scene=new Scene(engine);scene.useRightHandedSystem=true;
  try{
    registerBuiltInLoaders();const result=await ImportMeshAsync(new Uint8Array(readFileSync(folder+'car-white-core.glb')),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true,animationStartMode:0}}});
    let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minZ=Infinity,maxZ=-Infinity,triangles=0;
    for(const mesh of result.meshes){const values=mesh.getVerticesData('position');if(!values)continue;const matrix=mesh.computeWorldMatrix(true);triangles+=mesh.getTotalIndices()/3;for(let i=0;i<values.length;i+=3){const p=Vector3.TransformCoordinates(new Vector3(values[i],values[i+1],values[i+2]),matrix);assert.ok([p.x,p.y,p.z].every(Number.isFinite));minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);minZ=Math.min(minZ,p.z);maxZ=Math.max(maxZ,p.z);}}
    assert.ok(Math.abs(maxZ-minZ-4.4)<1e-5);assert.ok(Math.abs(minY)<1e-5);assert.ok(Math.abs(minX+maxX)<1e-5&&Math.abs(minZ+maxZ)<1e-5);assert.ok(maxY>1&&maxY<1.5);assert.ok(maxX-minX>2&&maxX-minX<3);assert.equal(triangles,manifest.outputs[0].triangles);
    const get=(name:string)=>{const node=[...result.meshes,...result.transformNodes].find(n=>n.name===name);assert.ok(node);node.computeWorldMatrix(true);return node.getAbsolutePosition();};
    const front=get('WheelFrontL').add(get('WheelFrontR')).scale(.5),rear=get('WheelRearL').add(get('WheelRearR')).scale(.5);assert.ok(front.z>rear.z+1);assert.ok(Math.abs(front.x-rear.x)<1e-5);
    const plate=[...result.meshes,...result.transformNodes].find(n=>n.name==='License Plate');assert.ok(plate);assert.ok(!('getTotalVertices' in plate)||(plate as {getTotalVertices:()=>number}).getTotalVertices()===0);
  }finally{scene.dispose();engine.dispose();}
});

test('photo civilian: actual standing mesh is baked without runtime skin, source texture retained and feet at ground',{timeout:15000},async()=>{
  const bytes=readFileSync(folder+'civilian-standing-core.glb'),{json}=parseGLB(bytes);assert.equal(json.skins,undefined);assert.equal(json.animations,undefined);
  const engine=new NullEngine({renderWidth:1,renderHeight:1,textureSize:16,deterministicLockstep:true,lockstepMaxSteps:1}),scene=new Scene(engine);scene.useRightHandedSystem=true;
  try{
    registerBuiltInLoaders();const result=await ImportMeshAsync(new Uint8Array(bytes),scene,{pluginExtension:'.glb',pluginOptions:{gltf:{skipMaterials:true,animationStartMode:0}}});let minY=Infinity,maxY=-Infinity,vertices=0;
    for(const mesh of result.meshes){const values=mesh.getVerticesData('position');if(!values)continue;vertices+=values.length/3;assert.equal(mesh.skeleton,null);for(let i=0;i<values.length;i+=3){assert.ok([values[i],values[i+1],values[i+2]].every(Number.isFinite));minY=Math.min(minY,values[i+1]);maxY=Math.max(maxY,values[i+1]);}}
    assert.ok(vertices>1000);assert.ok(Math.abs(minY)<1e-5);assert.ok(Math.abs(maxY-minY-1.8)<1e-5);assert.ok(manifest.outputs[1].changes.some((text:string)=>/not a walking animation/.test(text)));
  }finally{scene.dispose();engine.dispose();}
});


test('photo original markers: small core geometry, metre dimensions and MIT derivation are explicit',()=>{
  for(const [name,expectedTriangles]of [['patrol-beacon-core.glb',36],['mission-marker-core.glb',32]] as const){
    const record=manifest.outputs.find((output:{file:string})=>output.file===name);assert.ok(record);assert.equal(record.license,'MIT');assert.equal(record.triangles,expectedTriangles);assert.equal(record.groundY,0);assert.ok(record.bytes<12000);
    const {json}=parseGLB(readFileSync(folder+name));assert.ok(json.materials.every((material:{extensions?:unknown})=>!material.extensions));assert.equal(json.images,undefined);
  }
  assert.match(readFileSync(folder+'LICENSE-markers-MIT.txt','utf8'),/Permission is hereby granted/);
});


test('photo hand: actual weighted source triangles retain the civilian image, metre scale and measured wrist origin',()=>{
  const record=manifest.outputs.find((output:{file:string})=>output.file==='hand-core.glb');assert.ok(record);assert.equal(record.license,'CC0-1.0');assert.deepEqual(record.sourceSelectedJoints,['RightForeArm','RightHand']);assert.deepEqual(record.wrist,[0,0,0]);assert.equal(record.selectionMinimumCombinedWeight,.5);
  assert.ok(record.triangles>100);assert.ok(record.selectedSourceVertices>100);assert.ok(record.dimensions.depth>.2&&record.dimensions.depth<.5);assert.ok(record.dimensions.width>.04&&record.dimensions.width<.2);assert.ok(record.bounds.min[2]<-.1&&record.bounds.max[2]>.05);assert.ok(record.bytes<2*1024*1024);
  const hand=parseGLB(readFileSync(folder+'hand-core.glb')),body=parseGLB(readFileSync(folder+'civilian-standing-core.glb'));assert.equal(hand.json.skins,undefined);assert.equal(hand.json.animations,undefined);
  const imageBytes=(asset:ReturnType<typeof parseGLB>)=>{const view=asset.json.bufferViews[asset.json.images[0].bufferView];return asset.bin.subarray(view.byteOffset,view.byteOffset+view.byteLength);};
  assert.equal(sha(imageBytes(hand)),sha(imageBytes(body)),'the hand uses exactly the installed source image rather than a replacement');
  assert.ok(record.changes.some((text:string)=>text.includes('no closed fist')));
});
