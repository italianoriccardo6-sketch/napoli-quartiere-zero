import {Scene} from '@babylonjs/core/scene';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Material} from '@babylonjs/core/Materials/material';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';

/** Original CC0 colour, mask, normal and roughness maps; no image bytes are altered. */
export function createPhotographicFoliageMaterials(scene:Scene){
  const pending:Promise<void>[]=[],load=scene.getEngine().getClassName()!=='NullEngine';
  const texture=(file:string,linear:boolean)=>{
    let resolve!:()=>void,reject!:(error:Error)=>void;
    pending.push(new Promise<void>((yes,no)=>{resolve=yes;reject=no;}));
    const url=`${import.meta.env?.BASE_URL??'/'}assets/foliage/tree_small_02/${file}`;
    const value=new Texture(url,scene,false,false,Texture.TRILINEAR_SAMPLINGMODE,resolve,message=>reject(new Error('Impossibile caricare la vegetazione. Ricarica la pagina.',{cause:{file,message}})));
    value.gammaSpace=!linear;value.anisotropicFilteringLevel=8;return value;
  };
  const material=(name:string,prefix:string)=>{
    const m=new PBRMaterial(name,scene);m.metallic=0;m.roughness=.9;m.environmentIntensity=.85;
    if(load){
      m.albedoTexture=texture(prefix+'-diff.jpg',false);
      m.bumpTexture=texture(prefix+'-normal.jpg',true);m.bumpTexture.level=.65;
      m.metallicTexture=texture(prefix+'-rough.jpg',true);
      m.useRoughnessFromMetallicTextureAlpha=false;m.useRoughnessFromMetallicTextureGreen=true;
      m.useMetallnessFromMetallicTextureBlue=false;m.useAmbientOcclusionFromMetallicTextureRed=false;
      m.invertNormalMapX=!scene.useRightHandedSystem;m.invertNormalMapY=scene.useRightHandedSystem;
    }
    return m;
  };
  const bark=material('corteccia fotografica CC0','bark'),leaves=material('foglie fotografiche CC0','leaves');
  leaves.backFaceCulling=false;leaves.twoSidedLighting=true;leaves.transparencyMode=Material.MATERIAL_ALPHATEST;leaves.alphaCutOff=.55;
  if(load){const opacity=texture('leaves-alpha.png',true);opacity.getAlphaFromRGB=true;opacity.hasAlpha=true;leaves.opacityTexture=opacity;}
  bark.metadata={source:'Poly Haven bark_brown_01',author:'Rob Tuytel',license:'CC0-1.0',tileMetres:1};
  leaves.metadata={source:'Poly Haven tree_small_02 leaf atlas',author:'Rico Cilliers',license:'CC0-1.0',originalBytes:true};
  return {bark,leaves,ready:Promise.all(pending).then(()=>{})};
}
