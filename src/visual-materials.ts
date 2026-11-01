import {Scene} from '@babylonjs/core/scene';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';
import {BaseTexture} from '@babylonjs/core/Materials/Textures/baseTexture';
import {HDRCubeTexture} from '@babylonjs/core/Materials/Textures/hdrCubeTexture';
import {Color3} from '@babylonjs/core/Maths/math.color';
export type VisualTextureLoader=(url:string,linear:boolean)=>BaseTexture;
export interface VisualMaterials {
  terrain:PBRMaterial;asphalt:PBRMaterial;footway:PBRMaterial;facades:PBRMaterial[];
  trim:PBRMaterial;plinth:PBRMaterial;glass:PBRMaterial;shutter:PBRMaterial;iron:PBRMaterial;door:PBRMaterial;shop:PBRMaterial;
  pavement:PBRMaterial;curb:PBRMaterial;paint:PBRMaterial;quay:PBRMaterial;signRed:PBRMaterial;grass:PBRMaterial;ready:Promise<void>;
}
export interface VisualMaterialOptions {loadTextures?:boolean;textureLoader?:VisualTextureLoader}
/** Photographic CC0 maps are self-hosted; material tints are inferred, not sampled from Naples facades. */
export function createVisualMaterials(scene:Scene,options:VisualMaterialOptions={}):VisualMaterials {
  const load=options.loadTextures??(scene.getEngine().getClassName()!=='NullEngine');
  const base=import.meta.env?.BASE_URL??'/';const pending:Promise<void>[]=[];
  const texture=(path:string,linear:boolean):BaseTexture=>{
    let value:BaseTexture;
    if(options.textureLoader)value=options.textureLoader(path,linear);
    else{
      let success!:()=>void,failure!:(error:Error)=>void;
      const ready=new Promise<void>((resolve,reject)=>{success=resolve;failure=reject;});pending.push(ready);
      value=new Texture(base+path.replace(/^\//,''),scene,false,false,Texture.TRILINEAR_SAMPLINGMODE,success,(message)=>failure(new Error('Mappa materiale non disponibile: '+path+' ('+(message??'errore')+')')));
    }
    value.gammaSpace=!linear;value.wrapU=value.wrapV=Texture.WRAP_ADDRESSMODE;value.anisotropicFilteringLevel=8;return value;
  };
  const plain=(name:string,color:string,roughness=.85,metallic=0)=>{
    const material=new PBRMaterial(name,scene);material.albedoColor=Color3.FromHexString(color).toLinearSpace();material.roughness=roughness;material.metallic=metallic;material.environmentIntensity=.8;material.directIntensity=1;return material;
  };
  const scanned=(name:string,id:string,color:string,roughness=.9)=>{
    const material=plain(name,color,roughness);
    if(load){
      material.albedoTexture=texture('/assets/materials/'+id+'/diff.jpg',false);
      material.bumpTexture=texture('/assets/materials/'+id+'/nor_gl.jpg',true);material.bumpTexture.level=.65;
      material.metallicTexture=texture('/assets/materials/'+id+'/rough.jpg',true);
      material.useRoughnessFromMetallicTextureAlpha=false;material.useRoughnessFromMetallicTextureGreen=true;
      material.useMetallnessFromMetallicTextureBlue=false;material.useAmbientOcclusionFromMetallicTextureRed=false;
      // Same OpenGL normal convention used by Babylon's glTF loader in a left-handed scene.
      material.invertNormalMapX=!scene.useRightHandedSystem;material.invertNormalMapY=scene.useRightHandedSystem;
    }
    material.metadata={photographicMaps:load,sourceAsset:id,sourceLicense:'CC0-1.0',facadeIdentity:'generic material, not measured Naples facade'};return material;
  };
  const asphalt=scanned('asfalto fotografico','asphalt_02','#dadada',1);
  const terrain=scanned('pavimentazione urbana','stone_tiles_02','#c3c2bb',.95),pavement=scanned('lastre del marciapiede','stone_tiles_02','#cbcbc8',.9);
  const footway=scanned('pietra dei percorsi','stone_tiles_02','#c4c5c0',.95);
  const facades=['#e4d5bc','#d3c4af','#dcc6ac','#c6c5b4'].map((tint,i)=>scanned('intonaco fotografico '+i,'painted_plaster_wall',tint,.94));
  // Instance boxes have unit UVs: neutral stone avoids stretching a wall scan
  // across a forty-metre cornice or a ten-centimetre window frame.
  const trim=plain('pietra cornici','#d2c7b3',.85),plinth=plain('pietra basamento','#9f9e94',.92);
  const glass=plain('vetro scuro riflettente','#10252c',.13,.05);glass.environmentIntensity=1.4;
  const shutter=plain('vernice persiane','#304b43',.57),iron=plain('ferro verniciato','#282f2f',.38,.45);
  const door=plain('legno dei portoni','#504235',.63),shop=plain('serramenti commerciali','#454f4a',.4,.25);
  const curb=plain('bordo di pietra chiara','#c4c0b5',.85),paint=plain('segnaletica bianca usurata','#deded3',.85);
  const quay=scanned('muratura del lungomare','stone_wall','#b4b0a1',.95),signRed=plain('vernice dei segnali','#b52224',.6,.15);
  const grass=scanned('suolo delle aree verdi','leafy_grass','#eeeeea',1);
  return {terrain,asphalt,footway,facades,trim,plinth,glass,shutter,iron,door,shop,pavement,curb,paint,quay,signRed,grass,ready:Promise.all(pending).then(()=>{})};
}
/** Actual photographic pure-sky environment; no unrelated buildings or terrain are substituted. */
export function loadDaylightEnvironment(scene:Scene):Promise<BaseTexture>{
  const base=import.meta.env?.BASE_URL??'/';
  return new Promise((resolve,reject)=>{
    const environment=new HDRCubeTexture(base+'assets/environment/daylight.hdr',scene,128,false,true,false,true,()=>resolve(environment),(message)=>reject(new Error('Impossibile caricare il cielo HDR: '+(message??'errore'))));
    scene.environmentTexture=environment;scene.environmentIntensity=.85;
  });
}
