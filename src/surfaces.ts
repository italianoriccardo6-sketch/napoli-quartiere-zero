import {Scene} from '@babylonjs/core/scene';
import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Texture} from '@babylonjs/core/Materials/Textures/texture';

/** Original deterministic surface maps. They describe invented materials, not photographs of Naples. */
export function createSurface(scene:Scene,name:string,kind:'stone'|'plaster'|'paving',base:string,seedValue:number) {
  const size=512;
  let seed=seedValue>>>0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const albedo=new DynamicTexture(name+' · colore originale',{width:size,height:size},scene,true);
  const bump=new DynamicTexture(name+' · normali originali',{width:size,height:size},scene,true);
  const context=albedo.getContext();
  const image=context.getImageData(0,0,size,size),normal=bump.getContext().getImageData(0,0,size,size);
  const heights=new Float32Array(size*size);
  const color=Color3.FromHexString(base);
  const tint=[color.r*255,color.g*255,color.b*255];
  const smooth=(x:number,z:number)=>Math.sin(x*.039+Math.cos(z*.025)*2)*.5+Math.cos(z*.057+x*.016)*.3+Math.sin(x*.102-z*.076)*.2;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const index=y*size+x;
    const grain=random();
    let variation=smooth(x,y)*9+(grain-.5)*(kind==='plaster'?12:18);
    let height=.5+(grain-.5)*.12;
    if(kind!=='plaster'){
      const rowHeight=64;
      const row=Math.floor(y/rowHeight),columnWidth=128;
      const offset=(row%2)*columnWidth/2;
      const u=(x+offset)%columnWidth,v=y%rowHeight;
      const seam=Math.min(u,columnWidth-u,v,rowHeight-v);
      const salt=Math.sin(row*17+Math.floor((x+offset)/columnWidth)*81)*.5+.5;
      variation+=salt*22-9;
      if(seam<2.5){variation-=kind==='paving'?43:27;height=.12;}
      else if(seam<5){variation-=10;height=.33;}
      else height+=salt*.2;
      // Subtle mineral flecks and surface pits, never large random-color tiles.
      if(grain>.986){variation-=22;height-=.18;}
    } else {
      height+=(smooth(x*1.5,y*1.5))*.05;
      const stain=Math.max(0,smooth(x*.4,y*.8)-.2);
      variation-=stain*10;
    }
    heights[index]=height;
    for(let channel=0;channel<3;channel++)image.data[index*4+channel]=Math.max(0,Math.min(255,tint[channel]+variation));
    image.data[index*4+3]=255;
  }
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const index=y*size+x;
    const left=heights[y*size+(x+size-1)%size],right=heights[y*size+(x+1)%size];
    const up=heights[((y+size-1)%size)*size+x],down=heights[((y+1)%size)*size+x];
    const dx=(left-right)*2.3,dy=(up-down)*2.3,length=Math.sqrt(dx*dx+dy*dy+1);
    normal.data[index*4]=(dx/length*.5+.5)*255;normal.data[index*4+1]=(dy/length*.5+.5)*255;normal.data[index*4+2]=(1/length*.5+.5)*255;normal.data[index*4+3]=255;
  }
  context.putImageData(image,0,0);albedo.update();bump.getContext().putImageData(normal,0,0);bump.update();
  albedo.wrapU=albedo.wrapV=bump.wrapU=bump.wrapV=Texture.WRAP_ADDRESSMODE;
  albedo.anisotropicFilteringLevel=8;bump.anisotropicFilteringLevel=4;
  const material=new StandardMaterial(name,scene);
  material.diffuseTexture=albedo;material.bumpTexture=bump;
  material.diffuseColor=Color3.White();material.specularColor=new Color3(.045,.045,.04);material.specularPower=18;
  bump.level=kind==='plaster'?.16:kind==='stone'?.35:.45;
  return {material,albedo,bump};
}
