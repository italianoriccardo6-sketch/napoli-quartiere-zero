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
import {createDetailedCity} from '../src/city-visuals';
import {createAmbientCity} from '../src/ambient-city';
import {createCamera} from '../src/camera';
import {createCharacter} from '../src/character';
import {createDetailedCharacter} from '../src/character-model';
import {createScooter} from '../src/vehicle';
import {createCar} from '../src/car';
import {placeVehicleOnStreet,openingStreetData} from '../src/vehicle-placement';
import {createVisualMaterials,loadDaylightEnvironment} from '../src/visual-materials';
import {addFacadeDetail} from '../src/facade-detail';
import {addStreetDetail} from '../src/street-detail';
import {FileToolsOptions} from '@babylonjs/core/Misc/fileTools';
import {toLocal} from '../src/geo';
import type {ITransmissionHelperHolder} from '@babylonjs/loaders/glTF/2.0/Extensions/transmissionHelper';
import type {CityMapData} from '../src/city-data';

const require=createRequire(import.meta.url);
type Context=WebGLRenderingContext&{drawingBufferWidth:number;drawingBufferHeight:number};
type ContextFactory=(width:number,height:number,options:Record<string,boolean>)=>Context|null;
const arg=(name:string)=>process.argv.find(a=>a.startsWith(name+'='))?.slice(name.length+1);
const width=Number(arg('--width')??1024),height=Number(arg('--height')??576),output=resolve(arg('--output')??'work/render-current.png');
const usePBR=process.argv.includes('--pbr'),useCar=process.argv.includes('--car'),useDetail=process.argv.includes('--detail'),assetsRead=new Set<string>(),bitmapSources=new WeakSet<object>();
if(!Number.isInteger(width)||!Number.isInteger(height)||width<128||height<128||width>1920||height>1080)throw Error('Use a bounded render size between128×128 and1920×1080.');

if(usePBR||useCar){
  // FileTools' actual XHR contract is adapted to Node reads, while Babylon's
  // Texture/HDRCubeTexture/glTF loaders and their shader settings remain active.
  // No HTTP server, browser process or synthetic asset is involved.
  const nativeFetch=globalThis.fetch,publicRoot=resolve('public');
  globalThis.fetch=async(input,init)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;
    if(url.startsWith('blob:')||url.startsWith('data:'))return nativeFetch(input,init);
    if(!url.startsWith('/assets/')&&url!=='/data/green.json'&&url!=='/data/background-terrain.json')throw Error('Node render accepts only repository assets and exact measured vegetation/terrain data files: '+url);
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
  const decodeBitmap=async(source:Blob,options?:ImageBitmapOptions)=>{
    if(!(source instanceof Blob))throw Error('Unexpected non-Blob image input in the Node image decoder.');
    const image=await loadImage(Buffer.from(await source.arrayBuffer())),canvas=new Canvas(image.width,image.height);
    const context=canvas.getContext('2d');if(options?.imageOrientation==='flipY'){context.translate(0,image.height);context.scale(1,-1);}
    context.drawImage(image,0,0);bitmapSources.add(canvas);return Object.assign(canvas,{close:()=>{}});
  };
  Object.assign(globalThis,{XMLHttpRequest:LocalFileRequest,createImageBitmap:decodeBitmap});
  FileToolsOptions.DefaultRetryStrategy=()=>-1;
}
let createContext:ContextFactory;
try{createContext=require('gl') as ContextFactory;}
catch(error){throw new Error('Headless WebGL unavailable. Install a matching native gl binding and provide Mesa/Xvfb; no image was generated.',{cause:error});}
const gl=createContext(width,height,{preserveDrawingBuffer:true,antialias:false,depth:true,stencil:true,alpha:false});
if(!gl)throw Error('A genuine WebGL context could not be created. On Linux run with DISPLAY supplied by Xvfb and Mesa; no image was generated.');
let phase='engine initialization',tracing=true;
const traceGL=process.argv.includes('--trace-gl'),glCallErrors:Array<{phase:string;call:string;code:number;args:unknown[];stack:string|undefined}>=[];
const rawGetError=gl.getError.bind(gl);
if(traceGL){
  const wrapped=new WeakSet<object>();
  const summarize=(value:unknown)=>typeof value==='number'?'0x'+value.toString(16):typeof value==='string'||typeof value==='boolean'||value==null?value:ArrayBuffer.isView(value)?{type:value.constructor.name,bytes:value.byteLength}:{type:(value as object).constructor?.name??'object'};
  const wrap=(target:object,label:string)=>{
    if(wrapped.has(target))return;wrapped.add(target);
    const names=new Set<string>();for(let proto:object|null=target;proto&&proto!==Object.prototype;proto=Object.getPrototypeOf(proto))for(const name of Object.getOwnPropertyNames(proto))names.add(name);
    const api=target as Record<string,unknown>;
    for(const name of names){
      if(name==='constructor'||name==='getError'||name.startsWith('_')||typeof api[name]!=='function')continue;
      const original=api[name] as (...args:unknown[])=>unknown;
      api[name]=(...args:unknown[])=>{
        const result=original.apply(target,args);
        if(tracing){
          for(let i=0;i<16;i++){
            const code=rawGetError();if(code===gl.NO_ERROR)break;
            const entry={phase,call:label+'.'+name,code,args:args.map(summarize),stack:new Error('GL error observed immediately after call').stack};
            if(glCallErrors.length<100)glCallErrors.push(entry);
            if(glCallErrors.length<=20)console.error('GL_CALL_ERROR '+JSON.stringify(entry));
          }
        }
        if(name==='getExtension'&&result&&typeof result==='object'&&!String(args[0]).startsWith('STACKGL_'))wrap(result,'extension '+args[0]);
        return result;
      };
    }
  };
  wrap(gl,'gl');
}

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
      const pixels=context.getImageData(0,0,source.width,source.height).data,format=args[3];
      const channels=format===gl.RGBA?4:format===gl.RGB?3:format===gl.LUMINANCE_ALPHA?2:format===gl.LUMINANCE||format===gl.ALPHA?1:0;
      if(!channels||args[4]!==gl.UNSIGNED_BYTE)throw Error('Unsupported native canvas texture format '+format+'/'+args[4]);
      const flip=Boolean(gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL)),premultiply=Boolean(gl.getParameter(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL)),alignment=gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
      const bitmap=bitmapSources.has(source),packed=new Uint8Array(source.width*source.height*channels);
      for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
        const from=((!bitmap&&flip?source.height-1-y:y)*source.width+x)*4,to=(y*source.width+x)*channels,alpha=pixels[from+3],scale=!bitmap&&premultiply?alpha/255:1;
        if(format===gl.ALPHA)packed[to]=alpha;
        else if(format===gl.LUMINANCE||format===gl.LUMINANCE_ALPHA){packed[to]=pixels[from]*scale;if(channels===2)packed[to+1]=alpha;}
        else{packed[to]=pixels[from]*scale;packed[to+1]=pixels[from+1]*scale;packed[to+2]=pixels[from+2]*scale;if(channels===4)packed[to+3]=alpha;}
      }
      // ImageBitmap orientation is decoded above; Canvas unpack rules are applied
      // explicitly. Disable driver unpack transforms so neither can occur twice.
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
      try{originalUpload(args[0],args[1],args[2],source.width,source.height,0,format,args[4],packed);}
      finally{gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,flip);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,premultiply);gl.pixelStorei(gl.UNPACK_ALIGNMENT,alignment);}return;
    }
  }
  originalUpload(...args);
};
(globalThis as unknown as {OffscreenCanvas:typeof Canvas}).OffscreenCanvas=Canvas;
const engine=new Engine(gl,false,{preserveDrawingBuffer:true,stencil:true,disableWebGL2Support:true,doNotHandleContextLost:true});
if(usePBR||useCar)engine._features.forceBitmapOverHTMLImageElement=true;
const caps=engine.getCaps(),debug=gl.getExtension('WEBGL_debug_renderer_info');
const driver={driverRenderer:gl.getParameter(gl.RENDERER),driverVendor:gl.getParameter(gl.VENDOR),unmaskedRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null};
const capabilities={instancedArrays:caps.instancedArrays,ANGLE_instanced_arrays:gl.getExtension('ANGLE_instanced_arrays')!==null,standardDerivatives:caps.standardDerivatives,textureFloat:caps.textureFloat,textureFloatRender:caps.textureFloatRender,textureHalfFloat:caps.textureHalfFloat,textureHalfFloatRender:caps.textureHalfFloatRender};
const scene=new Scene(engine),errors:string[]=[];
engine.onEffectErrorObservable.add(({errors:message})=>errors.push(message));
const started=performance.now();
let world:ReturnType<typeof createCityWorld>|undefined;
let detailedCity:ReturnType<typeof createDetailedCity>|undefined;
let mode='actual-city-source';
let failedCandidate:string|undefined;
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
    phase='city construction and photographic asset loading';
    if(usePBR&&useDetail){
      detailedCity=createDetailedCity(scene,map,map.city);world=detailedCity;await detailedCity.ready;mode='actual-runtime-detailed-city-source';
    }else{
      const materials=usePBR?createVisualMaterials(scene):undefined;
      if(materials){await materials.ready;await loadDaylightEnvironment(scene);mode='actual-city-pbr-source';}
      world=createCityWorld(scene,map,map.city,{materials});
      if(useDetail){
        const focus=[map.city.spawn,...map.city.route];
        addFacadeDetail(scene,map,{focus,radius:95,quality:'alta',materials});
        addStreetDetail(scene,map,map.city,{materials});
      }
    }
    phase='character and vehicle construction and glTF asset loading';
    const player=usePBR&&useDetail?createDetailedCharacter(scene):createCharacter(scene),vehicle=useCar?createCar(scene):createScooter(scene),camera=createCamera(scene);
    await Promise.all(['ready' in player?player.ready:Promise.resolve(),'ready' in vehicle?vehicle.ready:Promise.resolve()]);
    const size={radius:'radius' in vehicle?vehicle.radius:.93,halfLength:'halfLength' in vehicle?vehicle.halfLength:1.1};
    const placement=useCar?placeVehicleOnStreet(openingStreetData(map.city),world.canStand,size):undefined;
    const p=placement?.player??map.city.spawn,car=placement?.car??map.city.scooter,heading=placement?.heading??Math.atan2(map.city.pickup[0]-p[0],map.city.pickup[1]-p[1]);
    const playerY=detailedCity?.surfaceHeightAt(p[0],p[1])??0;
    player.root.position.set(p[0],playerY,p[1]);player.root.rotation.y=heading;player.animate(0,false,false);
    vehicle.spawn.set(car[0],0,car[1]);vehicle.root.position.copyFrom(vehicle.spawn);vehicle.root.rotation.y=vehicle.heading=heading;
    player.root.getChildMeshes().forEach(m=>world!.shadows.addShadowCaster(m));vehicle.root.getChildMeshes().forEach(m=>world!.shadows.addShadowCaster(m));
    const ambient=usePBR&&useDetail&&useCar?createAmbientCity(scene,map.city,world,{anchor:car,protectedPoints:[p,car],surfaceHeightAt:detailedCity?.surfaceHeightAt,walkerCanStand:(x,z,r)=>world!.canStand(x,z,r)&&Math.hypot(x-player.root.position.x,z-player.root.position.z)>r+.5}):undefined;
    await ambient?.ready;
    scene.metadata={...(scene.metadata??{}),ambientPopulation:{pedestrians:ambient?.plan.walkers.length??0,parkedCars:ambient?.plan.cars.length??0,representation:'Same licensed models and shared ambient planner as runtime; no staged traffic.'}};
    camera.orient(heading);camera.snap(player.root.position);
    detailedCity?.updateDetail(p,'alta');
    scene.metadata={...(scene.metadata??{}),capturePlacement:{player:p,playerY,car,heading,size,sharedStreetPlacement:useCar}};
    if(['drive','waterfront','vesuvio'].includes(arg('--view')??'')){
      if(!useCar)throw Error('Driving view requires the actual imported car (--car).');
      player.root.setEnabled(false);player.root.position.copyFrom(vehicle.root.position);
      if(arg('--view')==='waterfront'){
        // A reachable mouse-camera rotation at the same real street position.
        // Aim across the nearest supplied OSM shoreline, without moving the car.
        let nearest:[number,number]|undefined,distance=Infinity;
        for(const coast of map.city.coastlines??[])for(let i=1;i<coast.points.length;i++){
          const a=coast.points[i-1],b=coast.points[i],dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;
          const t=length?Math.max(0,Math.min(1,((car[0]-a[0])*dx+(car[1]-a[1])*dz)/length)):0;
          const point:[number,number]=[a[0]+dx*t,a[1]+dz*t],d=Math.hypot(point[0]-car[0],point[1]-car[1]);
          if(d<distance){nearest=point;distance=d;}
        }
        if(!nearest||distance<1)throw Error('A measured shoreline direction for the actual waterfront view is unavailable.');
        camera.orient(Math.atan2(nearest[0]-car[0],nearest[1]-car[1]));
      }
      if(arg('--view')==='vesuvio'){
        const summit=toLocal(14.4265,40.8214);
        camera.orient(Math.atan2(summit[0]-car[0],summit[1]-car[1]));
        scene.metadata={...(scene.metadata??{}),captureView:{kind:'reachable mouse-camera rotation at the same actual street position',target:'Vesuvio',longitude:14.4265,latitude:40.8214,local:summit}};
      }
      camera.snap(vehicle.root.position);camera.update(vehicle.root.position,1,true);
      detailedCity?.updateDetail(car,'alta');
    }
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
    phase='frame '+(frames+1)+' scene render and shader compilation';
    world?.sea.setFloat('time',0);
    engine.beginFrame();scene.render();engine.endFrame();frames++;
    if(errors.length)throw Error('Actual scene shader compilation failed: '+errors.join('\n'));
    if(frames>=3&&scene.isReady(true)&&engine.areAllEffectsReady())break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(!scene.isReady(true)||!engine.areAllEffectsReady())throw Error('Actual scene/material compilation did not become ready within45seconds.');
  phase='framebuffer capture';
  engine.flushFramebuffer();gl.finish();
  const bottomUp=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,bottomUp);
  const glErrors:number[]=[];for(let i=0;i<16;i++){const error=gl.getError();if(error===gl.NO_ERROR)break;glErrors.push(error);}
  const canvas=new Canvas(width,height),context=canvas.getContext('2d'),image=context.createImageData(width,height);
  for(let y=0;y<height;y++)image.data.set(bottomUp.subarray((height-1-y)*width*4,(height-y)*width*4),y*width*4);
  context.putImageData(image,0,0);
  let low=Infinity,high=-Infinity;for(let i=0;i<bottomUp.length;i+=4){const value=bottomUp[i]+bottomUp[i+1]+bottomUp[i+2];low=Math.min(low,value);high=Math.max(high,value);}
  if(high-low<10)throw Error('The rendered output has no meaningful colour variation; no misleading blank frame was saved.');
  const observedErrors=[...new Set([...glErrors,...glCallErrors.map(e=>e.code)])];
  const capturePath=observedErrors.length?output.replace(/\.png$/i,'.failed.png'):output;
  await mkdir(dirname(output),{recursive:true});await writeFile(capturePath,await canvas.encode('png'));
  if(observedErrors.length){failedCandidate=capturePath;throw Error('WebGL validation failed with '+observedErrors.join(',')+'. Actual framebuffer saved only as an unvalidated failed candidate: '+capturePath);}
  const facadeMeshes=scene.meshes.filter(m=>m.metadata?.facadeDetail),active=scene.getActiveMeshes(),activeSet=new Set(active.data.slice(0,active.length));
  const facadeRendering={batches:facadeMeshes.length,enabledBatches:facadeMeshes.filter(m=>m.isEnabled()).length,activeBatches:facadeMeshes.filter(m=>activeSet.has(m)).map(m=>({name:m.name,instances:m.metadata.instances})),instances:facadeMeshes.reduce((sum,m)=>sum+(m.metadata.instances??0),0)};
  const transmissionTargetType=(scene as Scene&Partial<ITransmissionHelperHolder>)._transmissionHelper?.getOpaqueTarget()?.getInternalTexture()?.type;
  const report={mode,view:arg('--view')??(useCar?'on-foot':'initial'),sourceRevision:process.env.GITHUB_SHA??null,output,width,height,webGLVersion:engine.webGLVersion,...driver,capabilities,facadeRendering,transmissionTargetType,softwareRequested:process.env.LIBGL_ALWAYS_SOFTWARE==='1',features:{photographicPBR:usePBR,facadeAndStreetDetail:useDetail,importedCar:useCar,importedCharacter:usePBR&&useDetail,HDRRadiancePrefilter:usePBR&&engine._features.allowTexturePrefiltering},assetsRead:[...assetsRead].sort(),cameraPosition:scene.activeCamera?.position.asArray(),meshCount:scene.meshes.length,materialCount:scene.materials.length,frames,renderWallMs:Math.round(performance.now()-started),shaderErrors:errors,webGLErrors:glErrors,sourceSceneMetadata:scene.metadata,limitations:['Direct Node WebGL, not browser UI automation or macOS validation.','WebGL1 adapter: browser WebGL2 feature output and performance may differ.','HDR loader uses spherical harmonics and ordinary mipmaps when WebGL1 cannot prefilter radiance.','No FPS claim; renderWallMs includes scene construction, compilation and capture.','No HTML HUD is included: this captures the actual 3D engine scene only.']};
  await writeFile(output.replace(/\.png$/i,'.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(error){
  await mkdir(dirname(output),{recursive:true});
  const failure={mode,output,success:false,failedCandidate,error:error instanceof Error?error.message:String(error),stack:error instanceof Error?error.stack:null,shaderErrors:errors,glCallErrors,sourceSceneMetadata:scene.metadata};
  await writeFile(output.replace(/\.png$/i,'.error.json'),JSON.stringify(failure,null,2)+'\n');
  throw error;
}finally{tracing=false;scene.dispose();engine.dispose();gl.getExtension('STACKGL_destroy_context')?.destroy();}
