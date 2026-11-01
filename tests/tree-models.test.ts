import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import {registerBuiltInLoaders} from '@babylonjs/loaders/dynamic';
import {toLocal,type MapData} from '../src/geo';
import type {GreenData} from '../src/vegetation';
import {createTreeModels} from '../src/tree-models';
import {createPhotographicFoliageMaterials} from '../src/foliage-materials';
import {Material} from '@babylonjs/core/Materials/material';

registerBuiltInLoaders();
const folder=new URL('../public/assets/foliage/tree_small_02/',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('tree-lod-manifest.json',folder),'utf8'));
const roles=['bark_branches','leaves','bark_trunk'];
const engine=()=>new NullEngine({renderWidth:800,renderHeight:600,textureSize:512,deterministicLockstep:true,lockstepMaxSteps:4});
function fixture(){
  const map=JSON.parse(readFileSync(new URL('../public/data/map.json',import.meta.url),'utf8')) as MapData;
  const green=JSON.parse(readFileSync(new URL('../public/data/green.json',import.meta.url),'utf8')) as GreenData;
  const source=green.trees.find(tree=>tree.id==='node/3450393955');assert.ok(source);
  const point=toLocal(source.lon,source.lat);
  return {map,green,source,point,options:{focus:[point],radius:60,maxTrees:1,groundHeight:()=>-4.25}};
}
async function loadRealModel(url:string,scene:Scene){
  const file=url.split('/').at(-1)!;
  assert.ok(['tree_small_02-near.glb','tree_small_02-far.glb'].includes(file),'only the installed LOD assets are requested');
  return ImportMeshAsync(new Uint8Array(readFileSync(new URL(file,folder))),scene,{pluginExtension:'.glb'});
}
function almost(actual:number,expected:number,tolerance=3e-5){assert.ok(Math.abs(actual-expected)<tolerance,`${actual} differs from ${expected}`);}
function activeMatrices(meshes:Mesh[]){
  return meshes.map(mesh=>{
    assert.equal(mesh.thinInstanceCount,1);assert.equal(mesh.isEnabled(),true);assert.equal(mesh.isVisible,true);assert.equal(mesh.visibility,1);
    const matrices=mesh.thinInstanceGetWorldMatrices();assert.equal(matrices.length,1);
    const values=Array.from(matrices[0].m);assert.ok(values.every(Number.isFinite));return values;
  });
}
function emptyLOD(meshes:Mesh[]){
  assert.equal(meshes.length,3);
  for(const mesh of meshes){assert.equal(mesh.thinInstanceCount,0);assert.equal(mesh.isEnabled(),false,'an empty thin-instance buffer must not render its source mesh at the origin');}
}
function noPhotographicTextures(scene:Scene,preserved=new Set<unknown>()){
  assert.ok(scene.textures.every(texture=>preserved.has(texture)||(texture===scene.environmentBRDFTexture&&texture.name.startsWith('data:EnvironmentBRDFTexture'))),'GLB placeholders may share Babylon’s generated BRDF lookup, but introduce no photographic-map textures');
}

test('albero GLB reale: nodo OSM e quota negativa, matrici LOD comuni, buffer stabili e rilascio delle ombre',{timeout:15000},async()=>{
  const e=engine(),scene=new Scene(e),sun=new DirectionalLight('sole alberi',new Vector3(.6,-1,.4),scene),shadows=new ShadowGenerator(128,sun);
  const photographic=createPhotographicFoliageMaterials(scene),bark=photographic.bark,broadleaf=photographic.leaves,external=[bark,broadleaf];
  assert.equal(broadleaf.transparencyMode,Material.MATERIAL_ALPHATEST);assert.equal(broadleaf.alphaCutOff,.55);assert.equal(broadleaf.backFaceCulling,false);assert.equal(broadleaf.twoSidedLighting,true);
  const unrelated=MeshBuilder.CreateBox('altro caster',{},scene);shadows.addShadowCaster(unrelated,false);
  const {map,green,source,point,options}=fixture(),before=JSON.stringify({map,green}),loaded:string[]=[],initialTextures=new Set(scene.textures);
  const result=createTreeModels(scene,map,green,{...options,materials:{bark,broadleaf},shadows,loadManifest:async()=>manifest,loadModel:async(url,scene)=>{loaded.push(url);return loadRealModel(url,scene);}});
  try{
    await result.ready;result.update(point,'alta');
    assert.equal(loaded.length,2);assert.equal(result.placements.length,1);
    const tree=result.placements[0];assert.equal(tree.id,source.id);assert.deepEqual(tree.point,toLocal(source.lon,source.lat));assert.equal(tree.ground,-4.25);assert.equal(tree.form,'broadleaf');
    assert.equal(JSON.stringify({map,green}),before,'the original measured tree data is preserved');
    assert.equal(result.stats.modelTrees,1);assert.equal(result.stats.proceduralTrees,0);
    const models=result.meshes.filter(mesh=>mesh.metadata?.treeModel),near=models.filter(mesh=>mesh.metadata.lod==='near'),far=models.filter(mesh=>mesh.metadata.lod==='far');
    assert.equal(models.length,6);assert.deepEqual(near.map(mesh=>mesh.metadata.materialRole).sort(),roles.slice().sort());assert.deepEqual(far.map(mesh=>mesh.metadata.materialRole).sort(),roles.slice().sort());
    assert.equal(result.stats.nearTrees,1);assert.equal(result.stats.farTrees,0);emptyLOD(far);
    assert.equal(result.stats.renderedModelTriangles,manifest.outputs.find((output:{lod:string})=>output.lod==='near').triangles);
    const normalization=near[0].metadata.normalization;
    assert.ok(normalization.height>0&&normalization.crownDiameter>0);assert.equal(normalization.base.length,3);assert.ok(normalization.base.every(Number.isFinite));
    let minimumNearY=Infinity,maximumNearY=-Infinity;
    for(const mesh of models){
      assert.deepEqual(mesh.metadata.normalization,normalization,'both LODs use the same source anchor and dimensions');
      assert.equal(mesh.material,mesh.metadata.materialRole==='leaves'?broadleaf:bark);
      assert.equal(mesh.isPickable,false);assert.equal(mesh.checkCollisions,false);
      const positions=mesh.getVerticesData('position')!,normals=mesh.getVerticesData('normal')!,uvs=mesh.getVerticesData('uv')!,indices=mesh.getIndices()!;
      assert.ok(positions.length>0&&indices.length>0);assert.equal(positions.length%3,0);assert.equal(normals.length,positions.length);assert.equal(uvs.length,positions.length/3*2);assert.equal(indices.length%3,0);
      assert.ok(Array.from(positions).every(Number.isFinite));assert.ok(Array.from(normals).every(Number.isFinite));assert.ok(Array.from(uvs).every(Number.isFinite));
      assert.ok(Array.from(indices).every(index=>Number.isInteger(index)&&index>=0&&index<positions.length/3));
      const world=mesh.computeWorldMatrix(true);assert.ok(world.isIdentity(),'the imported handedness/root transform is baked into the template geometry');
      if(mesh.metadata.lod==='near')for(let i=1;i<positions.length;i+=3){minimumNearY=Math.min(minimumNearY,positions[i]);maximumNearY=Math.max(maximumNearY,positions[i]);}
    }
    almost(minimumNearY,0);almost(maximumNearY,normalization.height);
    const nearMatrices=activeMatrices(near);for(const matrix of nearMatrices){assert.deepEqual(matrix,nearMatrices[0]);almost(matrix[12],point[0]);almost(matrix[13],-4.25);almost(matrix[14],point[1]);almost(Math.hypot(matrix[4],matrix[5],matrix[6]),tree.height/normalization.height);}
    noPhotographicTextures(scene,initialTextures);
    assert.ok(scene.materials.every(material=>external.some(owner=>owner===material)),'source GLB placeholder materials are released');
    const writes=result.stats.lodBufferUpdates;
    result.update(point,'alta');result.update([point[0]+1,point[1]],'alta');assert.equal(result.stats.lodBufferUpdates,writes,'unchanged LOD membership reuses buffers');
    result.update([point[0]+10000,point[1]+10000],'alta');emptyLOD(near);
    assert.equal(result.stats.nearTrees,0);assert.equal(result.stats.farTrees,1);
    for(const matrix of activeMatrices(far))assert.deepEqual(matrix,nearMatrices[0],'switching geometry must not move or resize the tree');
    assert.equal(result.stats.renderedModelTriangles,manifest.outputs.find((output:{lod:string})=>output.lod==='far').triangles);
    result.update(point,'bassa');emptyLOD(near);assert.equal(result.stats.nearTrees,0);assert.equal(result.stats.farTrees,1);
    const lowWrites=result.stats.lodBufferUpdates;result.update(point,'bassa');assert.equal(result.stats.lodBufferUpdates,lowWrites);
    result.update(point,'alta');emptyLOD(far);for(const matrix of activeMatrices(near))assert.deepEqual(matrix,nearMatrices[0]);
    const owned=new Set(result.meshes),renderList=shadows.getShadowMap()!.renderList!;
    assert.ok(renderList.some(mesh=>owned.has(mesh as Mesh)),'near trees join the actual shadow render list');assert.ok(renderList.includes(unrelated));
    result.dispose();assert.ok([...owned].every(mesh=>mesh.isDisposed()));assert.ok(shadows.getShadowMap()!.renderList!.every(mesh=>!owned.has(mesh as Mesh)),'dispose removes every owned caster');assert.ok(shadows.getShadowMap()!.renderList!.includes(unrelated));
    assert.ok(external.every(material=>scene.materials.includes(material)));assert.ok(scene.meshes.includes(unrelated));
  }finally{result.dispose();scene.dispose();e.dispose();}
});

test('albero: errore di trasporto segnala il caricamento fallito e conserva dati e materiali esterni',{timeout:15000},async()=>{
  const e=engine(),scene=new Scene(e),bark=new StandardMaterial('corteccia esterna',scene),broadleaf=new StandardMaterial('foglie esterne',scene);
  const {map,green,source,options}=fixture(),before=JSON.stringify({map,green});
  const result=createTreeModels(scene,map,green,{...options,materials:{bark,broadleaf},loadManifest:async()=>manifest,loadModel:async()=>{throw new Error('trasporto GLB non disponibile');}});
  try{
    await assert.rejects(result.ready,/caricare|load/i);assert.equal(result.placements[0].id,source.id);assert.equal(result.placements[0].ground,-4.25);assert.equal(JSON.stringify({map,green}),before);
    result.dispose();assert.equal(scene.meshes.length,0);assert.ok(scene.materials.includes(bark)&&scene.materials.includes(broadleaf));assert.equal(scene.textures.length,0);
  }finally{result.dispose();scene.dispose();e.dispose();}
});

test('albero GLB reale: dispose durante il caricamento rilascia anche mesh e materiali arrivati dopo',{timeout:15000},async()=>{
  const e=engine(),scene=new Scene(e),bark=new StandardMaterial('corteccia esterna',scene),broadleaf=new StandardMaterial('foglie esterne',scene);
  const {map,green,options}=fixture();let release!:()=>void,started!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),loading=new Promise<void>(resolve=>{started=resolve;}),imported:Mesh[]=[];
  const result=createTreeModels(scene,map,green,{...options,materials:{bark,broadleaf},loadManifest:async()=>manifest,loadModel:async(url,scene)=>{started();await gate;const loaded=await loadRealModel(url,scene);imported.push(...loaded.meshes.filter((mesh):mesh is Mesh=>mesh instanceof Mesh));return loaded;}});
  try{
    await loading;result.dispose();release();await result.ready;
    assert.ok(imported.some(mesh=>mesh.getClassName()==='Mesh'),'the delayed loader really parsed the installed GLBs');
    assert.ok(imported.every(mesh=>mesh.isDisposed()));assert.equal(scene.meshes.length,0);assert.equal(scene.transformNodes.length,0);noPhotographicTextures(scene);
    assert.ok(scene.materials.every(material=>material===bark||material===broadleaf),'late placeholder materials are also released');assert.ok(scene.materials.includes(bark)&&scene.materials.includes(broadleaf));
  }finally{release();result.dispose();scene.dispose();e.dispose();}
});
