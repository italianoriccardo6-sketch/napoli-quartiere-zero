import '@babylonjs/core/Rendering/depthRendererSceneComponent';
import {FxaaPostProcess} from '@babylonjs/core/PostProcesses/fxaaPostProcess';
import {SSAORenderingPipeline} from '@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/ssaoRenderingPipeline';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import type {Camera} from '@babylonjs/core/Cameras/camera';
import type {Scene} from '@babylonjs/core/scene';

/** Actual camera passes, shared by the game and the direct-engine QA capture. */
export function createCameraEffects(scene:Scene,camera:Camera){
  const engine=scene.getEngine(),caps=engine.getCaps();
  if(engine.getClassName()==='NullEngine')return {setQuality(_quality:'alta'|'bassa'){}};
  // Babylon SSAO1 samples depth.r directly; packed RGBA depth is incompatible.
  // Keep this optional on engines that can render an unpacked floating depth map.
  const supportsAO=Boolean(caps.textureFloatRender||caps.textureHalfFloatRender);
  const name='occlusione ambientale della città';
  const ao=supportsAO?new SSAORenderingPipeline(name,scene,{ssaoRatio:.5,combineRatio:1},[camera]):undefined;
  // SSAO1 uses normalized depth: retain nearby contact scale with real Gulf relief.
  const depthScale=2400/camera.maxZ;
  if(ao){ao.totalStrength=.85;ao.base=.18;ao.radius=.00018*depthScale;ao.area=.0015*depthScale;ao.fallOff=.000004*depthScale;}
  // FXAA is last, so facade rails, foliage and the AO composite share the pass.
  const fxaa=new FxaaPostProcess('antialias città',1,camera,Texture.BILINEAR_SAMPLINGMODE,engine,false,0);
  let enabled=Boolean(ao);
  const describe=()=>{scene.metadata={...(scene.metadata??{}),cameraEffects:{fxaa:true,ssaoSupported:supportsAO,ssaoEnabled:enabled,ssaoRatio:.5,cameraMaxZ:camera.maxZ,normalizedDepthScale:depthScale,ssaoRadius:ao?.radius,ssaoArea:ao?.area,ssaoFallOff:ao?.fallOff,depthRequirement:'unpacked floating point; packed-only engines use FXAA'}};};
  describe();
  return {setQuality(quality:'alta'|'bassa'){
    const wanted=quality==='alta'&&Boolean(ao);if(wanted===enabled)return;
    camera.detachPostProcess(fxaa);
    if(wanted)scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(name,[camera]);
    else scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(name,[camera]);
    scene.enableDepthRenderer(camera).enabled=wanted;
    camera.attachPostProcess(fxaa);enabled=wanted;describe();
  }};
}
