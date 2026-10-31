import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

// Primary-source files and license were inspected in the official Khronos repo.
// A pinned revision makes the asset acquisition repeatable and reviewable.
const revision='8f492390ddc7a2ae221a1369ef560589cf8c70fb';
const repository='https://github.com/KhronosGroup/glTF-Sample-Assets';
const root=`https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${revision}`;
const modelRoot=`${root}/Models/CarConcept/glTF-WEBP`;
const output='public/assets/vehicles/car-concept';
const limit=12*1024*1024;
let downloadedBytes=0;
const files=new Map();
const sources=[];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function download(url,maxBytes=10*1024*1024){
  const response=await fetch(url,{signal:AbortSignal.timeout(40000),headers:{'User-Agent':'NapoliQuartiereZero/0.4 (bounded licensed visual asset acquisition)'}});
  if(!response.ok)throw Error(`Asset HTTP ${response.status}`);
  if(!response.body)throw Error('Asset body missing');
  const parts=[];let size=0;
  for await(const part of response.body){size+=part.length;downloadedBytes+=part.length;if(size>maxBytes||downloadedBytes>limit)throw Error('Vehicle asset exceeds bounded download limit');parts.push(part);}
  return Buffer.concat(parts);
}
async function add(name,url,maxBytes){
  if(!/^[A-Za-z0-9_.-]+$/.test(name))throw Error('Unsafe local asset filename');
  const bytes=await download(url,maxBytes);files.set(name,bytes);sources.push({path:name,url,bytes:bytes.length,sha256:digest(bytes)});return bytes;
}
async function main(){
  const gltfBytes=await add('CarConcept.gltf',`${modelRoot}/CarConcept.gltf`,600*1024);
  const gltf=JSON.parse(gltfBytes.toString('utf8'));
  if(gltf.asset?.version!=='2.0'||!String(gltf.asset?.copyright).includes('CC BY 4.0'))throw Error('Expected glTF version/license metadata missing');
  const uris=[...new Set([...(gltf.buffers??[]).map(b=>b.uri),...(gltf.images??[]).map(i=>i.uri)])];
  if(uris.length!==15||!Array.isArray(gltf.meshes)||gltf.meshes.length!==97)throw Error('Pinned CarConcept structure differs from verified source');
  for(const uri of uris){
    if(typeof uri!=='string'||!/^([A-Za-z0-9_.-]+)\.(bin|webp)$/.test(uri)||path.basename(uri)!==uri)throw Error('Unexpected model dependency');
    await add(uri,`${modelRoot}/${uri}`,uri.endsWith('.bin')?9*1024*1024:1024*1024);
  }
  for(const buffer of gltf.buffers){if(!Number.isSafeInteger(buffer.byteLength)||files.get(buffer.uri)?.length!==buffer.byteLength)throw Error('Geometry buffer length mismatch');}
  const readme=await add('SOURCE-README.md',`${root}/Models/CarConcept/README.md`,100*1024);
  if(!readme.toString('utf8').includes('Creative Commons Attribution 4.0 International')||!readme.toString('utf8').includes('Darmstadt Graphics Group'))throw Error('Verified model license no longer present');
  await add('LICENSE-CC-BY-4.0.txt',`${root}/LICENSES/CC-BY-4.0.txt`,30*1024);
  await add('LicenseRef-LegalMark-Khronos.txt',`${root}/LICENSES/LicenseRef-LegalMark-Khronos.txt`,4*1024);
  const notice=[
    '# Car Concept — asset attribution',
    '',
    '© 2024 Darmstadt Graphics Group GmbH. Model and textures by Eric Chadwick.',
    'Creative Commons Attribution 4.0 International: https://creativecommons.org/licenses/by/4.0/',
    'Source model originally by Unity Fan (public domain), optimized for glTF by the credited author.',
    `Official source: ${repository}/tree/${revision}/Models/CarConcept`,
    '',
    'Khronos and 3D Commerce marks retain their separate trademark notice in LicenseRef-LegalMark-Khronos.txt.',
    'No endorsement by Khronos, Darmstadt Graphics Group or the original author is implied.',
    'The downloaded asset is unmodified; any later runtime material changes or hidden logo plate must be recorded in the project ASSETS.md.',
    '',
    'This is a detailed concept-car model, not a scan of a Naples vehicle and not a GTA asset.',
    'It uses EXT_texture_webp and PBR material extensions. Browser/render compatibility and appearance require actual runtime verification.',
    '',
  ].join('\n');
  const manifest={
    version:1,asset:'CarConcept',repository,revision,retrieved_at:new Date().toISOString(),
    source_readme:`${repository}/blob/${revision}/Models/CarConcept/README.md`,
    license:'CC-BY-4.0',author:'Eric Chadwick',copyright:'© 2024 Darmstadt Graphics Group GmbH',
    trademark_notice:'LicenseRef-LegalMark-Khronos.txt',
    scene:'CarConcept.gltf',downloaded_bytes:downloadedBytes,maximum_download_bytes:limit,
    files:sources,extensions_used:gltf.extensionsUsed??[],extensions_required:gltf.extensionsRequired??[],
    meshes:gltf.meshes.length,nodes:gltf.nodes?.length??0,materials:gltf.materials?.length??0,
    wheel_nodes:['WheelFrontL','WheelFrontR','WheelRearL','WheelRearR'],
    logo_mesh:'License Plate',
    modification:'None during acquisition',
    verification:'Pinned source, license, dependency paths and buffer byte lengths verified. Not a visual/GPU quality certificate.',
  };
  // Publish files only after all assets and licenses have passed validation.
  await mkdir(output,{recursive:true});
  for(const [name,bytes]of files)await writeFile(path.join(output,name),bytes);
  await writeFile(path.join(output,'ATTRIBUTION.md'),notice);
  await writeFile(path.join(output,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(`Saved licensed CarConcept: ${downloadedBytes} downloaded bytes, ${gltf.meshes.length} meshes, required ${manifest.extensions_required.join(',')}.`);
}
main().catch(error=>{console.error('Vehicle asset acquisition failed: '+error.message);process.exitCode=1;});
