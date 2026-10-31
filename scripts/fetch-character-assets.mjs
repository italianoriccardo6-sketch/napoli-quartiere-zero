import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

// The model and both linked Meshy-generated motions have explicit CC0 notices.
// The documented combined endpoint returns a self-contained GLB; no account or service is provisioned.
const asset='zpepqtthci',clips=['cy69g7t2a0','vb5npv0n6u'];
const origin='https://vibeassets.io';
const output='public/assets/characters/civilian';
const limit=6*1024*1024;
const expectedGlbSha256='940444190abb1f3731675678277e9c3f27be1783966987f0a02ccd9fd1405193';
let downloaded=0;
const files=new Map(),sources=[];
async function get(name,url,maxBytes){
  const response=await fetch(url,{signal:AbortSignal.timeout(45000),headers:{'User-Agent':'NapoliQuartiereZero/0.5 (bounded CC0 character acquisition)'}});
  if(!response.ok||!response.body)throw Error(`Character source HTTP ${response.status}`);
  const parts=[];let size=0;
  for await(const part of response.body){size+=part.length;downloaded+=part.length;if(size>maxBytes||downloaded>limit)throw Error('Character acquisition exceeds byte budget');parts.push(part);}
  const bytes=Buffer.concat(parts);files.set(name,bytes);sources.push({path:name,url,bytes:size,sha256:createHash('sha256').update(bytes).digest('hex')});return bytes;
}
function glbJson(bytes){
  if(bytes.length<20||bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length||bytes.readUInt32LE(16)!==0x4e4f534a)throw Error('Invalid glTF binary character');
  const length=bytes.readUInt32LE(12);if(length>bytes.length-20)throw Error('Invalid glTF JSON chunk');
  return JSON.parse(bytes.toString('utf8',20,20+length));
}
async function main(){
  for(const id of [asset,...clips]){
    const page=await get(`source-${id}.html.txt`,`${origin}/a/${id}`,350*1024);
    const text=page.toString('utf8');
    if(!/CC0[,\s<]/i.test(text)||!/public domain/i.test(text)||!text.includes(id))throw Error('Expected individual CC0 dedication is missing');
    if(id!==asset&&!/Generated with Meshy/i.test(text))throw Error('Motion provenance differs from reviewed source');
  }
  const docs=await get('source-agent.md',`${origin}/agent.md`,100*1024);
  if(!docs.toString('utf8').includes('combined=1'))throw Error('Documented combined-download route is missing');
  const license=await get('LICENSE-CC0-1.0.html.txt','https://creativecommons.org/publicdomain/zero/1.0/legalcode.en',100*1024);
  if(!/CC0 1.0 Universal/i.test(license.toString('utf8')))throw Error('CC0 legal text missing');
  const bytes=await get('civilian.glb',`${origin}/download/${asset}?combined=1`,4*1024*1024);
  if(createHash('sha256').update(bytes).digest('hex')!==expectedGlbSha256)throw Error('Character binary differs from the reviewed model/motion revision');
  const gltf=glbJson(bytes);
  if(gltf.asset?.version!=='2.0'||!gltf.skins?.length||!gltf.meshes?.length||!gltf.animations||gltf.animations.length!==2)throw Error('Expected rigged character with exactly two reviewed motions');
  if((gltf.buffers??[]).some(x=>x.uri)||(gltf.images??[]).some(x=>x.uri&&!x.uri.startsWith('data:')))throw Error('Character must be self-contained');
  if((gltf.extensionsRequired??[]).some(x=>!['KHR_mesh_quantization','EXT_texture_webp'].includes(x)))throw Error('Unexpected required character codec');
  const animations=gltf.animations.map((x,i)=>({index:i,name:x.name??`animation${i}`,channels:x.channels?.length??0}));
  const manifest={version:1,asset:'CamperCivilian',license:'CC0-1.0',scene:'civilian.glb',source:`${origin}/a/${asset}`,source_asset_id:asset,
    clip_sources:clips.map(id=>`${origin}/a/${id}`),source_rig:'24 joints · cb3e6af4',retrieved_at:new Date().toISOString(),downloaded_bytes:downloaded,maximum_download_bytes:limit,
    expected_glb_sha256:expectedGlbSha256,
    origin:'Model and motions generated with Meshy and released CC0 by the source uploader. Mixamo-style bone names describe rig compatibility, not an Adobe asset source.',
    files:sources,animations,skins:gltf.skins.map(s=>({name:s.name,joints:s.joints.length})),meshes:gltf.meshes.length,materials:gltf.materials?.length??0,
    nodes:(gltf.nodes??[]).map(n=>n.name).filter(Boolean),extensions_required:gltf.extensionsRequired??[],
    modification:'None during acquisition. Runtime may normalize height/orientation and choose walking motions.',
    verification:'Individual model/motion CC0 notices, documented download path, GLB structure and self-contained dependencies checked. Browser/GPU appearance still requires visual verification.'};
  const credit=['# Detailed civilian character','',`Source model: ${manifest.source}`,`Walk: ${manifest.clip_sources[0]}`,`Run: ${manifest.clip_sources[1]}`,'',
    'The model and each motion are individually dedicated to the public domain under CC0 1.0 by their source uploader. Source pages are retained with this bundle.',
    'Model and motions are generated with Meshy. The character is a general civilian wearing a flannel shirt, trousers and boots; it is not a scanned Neapolitan person or a GTA asset.',
    'CC0 legal text: https://creativecommons.org/publicdomain/zero/1.0/legalcode.en',
    'Source mesh and embedded textures are unmodified. Runtime normalization or animation changes are described in project ASSETS.md.',''].join('\n');
  await mkdir(output,{recursive:true});for(const [name,data]of files)await writeFile(path.join(output,name),data);
  await writeFile(path.join(output,'ATTRIBUTION.md'),credit);await writeFile(path.join(output,'source-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({downloaded,character_bytes:bytes.length,animations,skins:manifest.skins,materials:manifest.materials,required:manifest.extensions_required}));
}
main().catch(error=>{console.error('Character acquisition failed: '+error.message);process.exitCode=1;});
