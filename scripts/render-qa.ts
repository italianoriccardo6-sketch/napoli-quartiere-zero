/**
 * Render the actual Babylon city scene directly in a Node WebGL context.
 * This is not browser automation, a mock screenshot, or a Mac/WebGL2 benchmark.
 * Optional prerequisite: npm gl (headless-gl) native binding, plus Mesa/Xvfb on Linux.
 * Example: LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a node --import tsx scripts/render-qa.ts
 */
import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve,extname,sep} from 'node:path';
import {Canvas,loadImage} from '@napi-rs/canvas';
import {Engine} from '@babylonjs/core/Engines/engine';
import {Scene} from '@babylonjs/core/scene';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {createCityWorld} from '../src/city-world';
import {createCamera} from '../src/camera';
import {createCharacter} from '../src/character';
import {createScooter} from '../src/vehicle';
import {createCar} from '../src/car';
import {createVisualMaterials,loadDaylightEnvironment} from '../src/visual-materials';
import {addFacadeDetail} from '../src/facade-detail';
import {addStreetDetail} from '../src/street-detail';
import {FileToolsOptions} from '@babylonjs/core/Misc/fileTools';
import type {CityMapData} from '../src/city-data';

const require=createRequire(import.meta.url);
type Context=WebGLRenderingContext&{drawingBufferWidth:number;drawingBufferHeight:number};
type ContextFactory=(width:number,height:number,options:Record<string,boolean>)=>Context|null;
const arg=(name:string)=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1);
const width=Number(arg('--width')??1024),height=Number(arg('--height')??576),output=resolve(arg('--output')??'work/render-current.png');
const usePBR=process.argv.includes('--pbr'),useCar=process.argv.includes('--car'),useDetail=process.argv.includes('--detail'),assetsRead=new Set<string>();
if(!Number.isInteger(width)||!Number.isInteger(height)||width<128||height<128||width>1920||height>1080)throw Error('Use a bounded render size between128×128 and1920×1080.');

if(usePBR||useCar){
  // FileTools' actual XHR contract is adapted to Node reads, while Babylon's
  // Texture/HDRCubeTexture/glTF loaders and their shader settings remain active.
  // No HTTP server, browser process or synthetic asset is involved.
  const nativeFetch=globalThis.fetch,publicRoot=resolve('public');
  globalThis.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(url.startsWith('blob:')||url.startsWith('data:'))return nativeFetch(input,init);
    if(!url.startsWith('/assets/'))throw Error('Node render accepts only repository /assets/ files: '+url);
    const path=resolve(publicRoot,decodeURIComponent(url.split('?')[0]).slice(1));
    if(!path.startsWith(publicRoot+sep))throw Error('Asset path escaped public directory.');
    try{
      const bytes=await readFile(path);assetsRead.add(url);
      const mime:Record<string,string>={'.gltf':'model/gltf+json','.json':'application/json','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.bin':'application/octet-stream','.hdr':'application/octet-stream'};
      return new Response(new Uint8Array(bytes),{status:200,headers:{'content-type':mime[extname(path)]??'application/octet-stream'}});
    }catch(error){
      if((error as NodeJS.ErrnoException).code==='ENOENT')return new Response('Missing repository asset',{status:404});
      throw error;
    }
  };
  class LocalFileRequest extends EventTarget {
    static DONE=4;
    readyState=0;status=0;statusText='';responseType='';response:unknown=null;responseText='';responseURL='';timeout=0;
    onprogress:((event:ProgressEvent)=>void)|null=null;
    private aborted=false;private headers=new Headers();
    open(method:string,url:string){if(method!=='GET')throw Error('The Node asset adapter is read-only.');this.responseURL=url;this.readyState=1;this.aborted=false;}
    setRequestHeader(_name:string,_value:string){}
    getResponseHeader(name:string){return this.headers.get(name);}
    abort(){this.aborted=true;this.readyState=0;}
    send(){void this.load();}
    private async load(){
      try{
        const response=await fetch(this.responseURL);this.headers=response.headers;this.status=response.status;this.statusText=response.statusText;
        const buffer=await response.arrayBuffer();if(this.aborted)return;
        this.responseText=this.responseType==='arraybuffer'?'':new TextDecoder().decode(buffer);this.response=this.responseType==='arraybuffer'?buffer:this.responseText;
        const progress=Object.assign(new Event('progress'),{lengthComputable:true,loaded:buffer.byteLength,total:buffer.byteLength}) as ProgressEvent;
        this.dispatchEvent(progress);this.onprogress?.(progress);
      }catch(error){this.status=500;this.statusText=error instanceof Error?error.message:String(error);}
      if(this.aborted)return;this.readyState=4;this.dispatchEvent(new Event('readystatechange'));this.dispatchEvent(new Event('loadend'));
    }
  }
  const decodeBitmap=async(source:Blob)=>{
    if(!(source instanceof Blob))throw Error('Unexpected non-Blob image input in the Node image decoder.');
    const image=await loadImage(Buffer.from(await source.arrayBuffer())),canvas=new Canvas(image.width,image.height);
    canvas.getContext('2d').drawImage(image,0,0);return Object.assign(canvas,{close:()=>{}});
  };
  Object.assign(globalThis,{XMLHttpRequest:LocalFileRequest,createImageBitmap:decodeBitmap});
  FileToolsOptions.DefaultRetryStrategy=()=>-1;
}
let createContext:ContextFactory;
try{createContext=require('gl') as ContextFactory;}
catch(error){throw new Error('Headless WebGL unavailable. Install a matching native gl binding and provide Mesa/Xvfb; no image was generated.',{cause:error});}
const gl=createContext(width,height,{preserveDrawingBuffer:true,antialias:false,depth:true,stencil:true,alpha:false});
if(!gl)throw Error('A genuine WebGL context could not be created. On Linux run with DISPLAY supplied by Xvfb and Mesa; no image was generated.');

// Babylon 9's shared Engine initialization still registers canvas events even
// when given a native context. Supply only an inert EventTarget and dimensions;
// this is an engine host adapter, with no browser window, DOM or input test.
const hostCanvas=Object.assign(new EventTarget(),{width,height,clientWidth:width,clientHeight:height,style:{},getContext:()=>gl,getBoundingClientRect:()=>({x:0,y:0,left:0,top:0,right:width,bottom:height,width,height})});
(gl as unknown as {canvas:typeof hostCanvas}).canvas=hostCanvas;

// Babylon DynamicTexture legitimately uses Canvas pixels. headless-gl expects
// an explicit RGBA buffer instead of an HTMLCanvasElement: preserve those pixels.
const originalUpload=gl.texImage2D.bind(gl) as (...args:any[])=>void;
(gl as unknown as {texImage2D:(...args:any[])=>void}).texImage2D=(...args:any[])=>{
  if(args.length===6){
    const source=args[5];
    if(source&&typeof source.getContext==='function'&&Number.isFinite(source.width)&&Number.isFinite(source.height)){
      const context=source.getContext('2d');
      if(!context)throw Error('A source texture canvas did not expose its pixels.');
      const pixels=context.getImageData(0,0,source.width,source.height).data;
      originalUpload(args[0],args[1],args[2],source.width,source.height,0,args[3],args[4],new Uint8Array(pixels.buffer,pixels.byteOffset,pixels.byteLength));return;
    }
  }
  originalUpload(...args);
};
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const engine=new Engine(gl,false,{preserveDrawingBuffer:true,stencil:true,disableWebGL2Support:true,doNotHandleContextLost:true});
if(usePBR||useCar)engine._features.forceBitmapOverHTMLImageElement=true;
const scene=new Scene(engine),errors:string[]=[];
engine.onEffectErrorObservable.add(({errors:message})=>errors.push(message));
const started=performance.now();
let world:ReturnType<typeof createCityWorld>|undefined;
let mode='actual-city-source';
try{
  if(process.argv.includes('--smoke')){
    mode='adapter-smoke-test-only';
    // Deliberately isolated adapter check, never labelled a game screenshot.
    const material=new StandardMaterial('adapter diagnostic',scene);material.diffuseColor=new Color3(.8,.35,.1);
    const box=MeshBuilder.CreateBox('adapter diagnostic',{size:1},scene);box.material=material;
    const camera=createCamera(scene);camera.camera.position.set(2,2,3);camera.camera.setTarget(Vector3.Zero());
    const {HemisphericLight}=await import('@babylonjs/core/Lights/hemisphericLight');new HemisphericLight('diagnostic',new Vector3(0,1,0),scene);
  }else{
    const map=JSON.parse(await readFile('public/data/map.json','utf8')) as CityMapData;
    if(!map.city||map.provenance!=='osm')throw Error('The active real-city source was not present; no substitute scene is permitted.');
    const materials=usePBR?createVisualMaterials(scene):undefined;
    if(materials){await materials.ready;await loadDaylightEnvironment(scene);mode='actual-city-pbr-source';}
    world=createCityWorld(scene,map,map.city,{materials});
    if(useDetail){
      const focus=[map.city.spawn,...map.city.route];
      addFacadeDetail(scene,map,{focus,radius:95,quality:'alta',materials});
      addStreetDetail(scene,map,map.city,{materials});
    }
    const player=createCharacter(scene),vehicle=useCar?createCar(scene):createScooter(scene),camera=createCamera(scene);
    if('ready' in vehicle)await vehicle.ready;
    const p=map.city.spawn,heading=Math.atan2(map.city.pickup[0]-p[0],map.city.pickup[1]-p[1]);
    player.root.position.set(p[0],0,p[1]);player.root.rotation.y=heading;player.animate(0,false,false);
    vehicle.root.position.set(map.city.scooter[0],0,map.city.scooter[1]);vehicle.root.rotation.y=heading;
    player.root.getChildMeshes().forEach(m=>world!.shadows.addShadowCaster(m));vehicle.root.getChildMeshes().forEach(m=>world!.shadows.addShadowCaster(m));
    camera.orient(heading);camera.snap(player.root.position);
    if(arg('--view')==='street'){
      // Same source geometry from a second actual road position, not a concept render.
      const point=map.city.route[Math.min(6,map.city.route.length-1)];camera.camera.position.set(point[0],1.8,point[1]);camera.camera.setTarget(new Vector3(p[0],1.6,p[1]));
    }
  }
  // Shader includes are asynchronous ESM imports. Let the actual material compile
  // and fail if it cannot, rather than saving an unrendered clear-colour frame.
  const deadline=performance.now()+45000;
  let frames=0;
  while(performance.now()<deadline){
    world?.sea.setFloat('time',0);
    engine.beginFrame();scene.render();engine.endFrame();frames++;
    if(errors.length)throw Error('Actual scene shader compilation failed: '+errors.join('\n'));
    if(frames>=3&&scene.isReady(true)&&engine.areAllEffectsReady())break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(!scene.isReady(true)||!engine.areAllEffectsReady())throw Error('Actual scene/material compilation did not become ready within45seconds.');
  engine.flushFramebuffer();gl.finish();
  const bottomUp=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bottomUp);
  const glErrors:number[]=[];for(let i=0;i<16;i++){const error=gl.getError();if(error===gl.NO_ERROR)break;glErrors.push(error);}
  if(glErrors.length)throw Error('WebGL reported errors after rendering: '+glErrors.join(','));
  const canvas=new Canvas(width,height),context=canvas.getContext('2d'),image=context.createImageData(width,height);
  for(let y=0;y<height;y++)image.data.set(bottomUp.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
  context.putImageData(image,0,0);
  let low=Infinity,high=-Infinity;for(let i=0;i<bottomUp.length;i+=4){const value=bottomUp[i]+bottomUp[i+1]+bottomUp[i+2];low=Math.min(low,value);high=Math.max(high,value);}
  if(high-low<10)throw Error('The rendered output has no meaningful colour variation; no misleading blank frame was saved.');
  await mkdir(dirname(output),{recursive:true});await writeFile(output,await canvas.encode('png'));
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const report={mode,output,width,height,webGLVersion:engine.webGLVersion,driverRenderer:gl.getParameter(gl.RENDERER),driverVendor:gl.getParameter(gl.VENDOR),unmaskedRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null,softwareRequested:process.env.LIBGL_ALWAYS_SOFTWARE==='1',features:{photographicPBR:usePBR,facadeAndStreetDetail:useDetail,importedCar:useCar,HDRRadiancePrefilter:usePBR&&engine._features.allowTexturePrefiltering},assetsRead:[...assetsRead].sort(),meshCount:scene.meshes.length,materialCount:scene.materials.length,frames,renderWallMs:Math.round(performance.now()-started),shaderErrors:errors,webGLErrors:glErrors,sourceSceneMetadata:scene.metadata,limitations:['Direct Node WebGL, not browser UI automation or macOS validation.','WebGL1 adapter: browser WebGL2 feature output and performance may differ.','HDR loader uses spherical harmonics and ordinary mipmaps when WebGL1 cannot prefilter radiance.','No FPS claim; renderWallMs includes scene construction, compilation and capture.','No HTML HUD is included: this captures the actual 3D engine scene only.']};
  await writeFile(output.replace(/\.png$/i,'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){
  await mkdir(dirname(output),{recursive:true});
  const failure={mode,output,success:false,error:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:null,shaderErrors:errors,sourceSceneMetadata:scene.metadata};
  await writeFile(output.replace(/\.png$/i,'.error.json'),JSON.stringify(failure,null,2)+'\n');
  throw error;
}finally{scene.dispose();engine.dispose();gl.getExtension('STACKGL_destroy_context')?.destroy();}
