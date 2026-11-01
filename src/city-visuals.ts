import '@babylonjs/core/Helpers/sceneHelpers';
import type {Scene} from '@babylonjs/core/scene';
import type {CityMapData,CityRuntime} from './city-data';
import type {Point} from './geo';
import {createCityWorld} from './city-world';
import {createVisualMaterials,loadDaylightEnvironment} from './visual-materials';
import {addFacadeDetail} from './facade-detail';
import {addStreetDetail} from './street-detail';
import {addVegetation,type GreenData} from './vegetation';
import {openingStreetData} from './vehicle-placement';
import {createBackgroundTerrain} from './background-terrain';
import {addNaplesFacades,NAPLES_PHOTO_FACES} from './naples-facades';
import {createPhotographicFoliageMaterials} from './foliage-materials';
import {addCoastDetail} from './coast-detail';
import {addStreetFurniture,type FurnitureData} from './street-furniture';
import {addGreenGround,validateGreenGround} from './green-ground';
import type {CityTerrainPolicy} from './city-terrain-policy';

/** Shared by the playable scene and the direct engine frame capture. */
export function createDetailedCity(scene:Scene,map:CityMapData,city:CityRuntime,options:{terrain?:CityTerrainPolicy}={}){
  const materials=createVisualMaterials(scene);
  const world=createCityWorld(scene,map,city,{materials,terrain:options.terrain});
  const opening=openingStreetData(city);
  const realFacades=addNaplesFacades(scene,map,{buildingBaseHeight:world.buildingBaseHeight}),foliage=createPhotographicFoliageMaterials(scene);
  const excludeEdges=new Map(NAPLES_PHOTO_FACES.filter(f=>realFacades.excludedBuildingIds.has(f.buildingId)).map(f=>[f.buildingId,new Set(f.edges)]));
  const facades=addFacadeDetail(scene,map,{focus:[opening.scooter,city.spawn,...city.route],radius:95,quality:'alta',materials,excludeEdges,buildingBaseHeight:world.buildingBaseHeight,shadows:world.shadows});
  for(const mesh of realFacades.profileMeshes)world.shadows.addShadowCaster(mesh,false);
  const streets=addStreetDetail(scene,map,city,{materials,groundHeight:world.groundHeightAt,groundGeometry:world.groundGeometry});
  const surfaceHeightAt=(x:number,z:number)=>Math.max(world.surfaceHeightAt?.(x,z)??0,streets.supportHeightAt(x,z)??-Infinity);
  const coast=addCoastDetail(scene,map,city,{material:materials.quay,shadows:world.shadows,groundHeight:world.groundHeightAt});
  const greenReady=(async()=>{
    const response=await fetch(`${import.meta.env?.BASE_URL??'/'}data/green-ground.json`);
    if(!response.ok)throw Error('Le aree verdi non sono disponibili. Ricarica la pagina.');
    return addGreenGround(scene,map,validateGreenGround(await response.json()),{material:materials.grass});
  })();
  const furnitureReady=(async()=>{
    const response=await fetch(`${import.meta.env?.BASE_URL??'/'}data/furniture.json`);
    // Decorative source data can be absent while a public-source acquisition
    // is unavailable. Keep play operational and record that absence explicitly.
    if(response.status===404){scene.metadata={...(scene.metadata??{}),streetFurniture:{available:false,reason:'Source extract not installed; no positions invented'}};return;}
    if(!response.ok)throw Error('Gli arredi della città non sono disponibili. Ricarica la pagina.');
    return addStreetFurniture(scene,map,await response.json() as FurnitureData,{focus:[opening.scooter,...city.route],radius:100,maxItems:100,groundHeight:surfaceHeightAt,shadows:world.shadows,materials:{metal:materials.iron,stone:materials.trim,wood:materials.door,sign:materials.shop,glass:materials.glass,signRed:materials.signRed,signWhite:materials.paint,signInk:materials.iron}});
  })();
  const vegetationReady=(async()=>{
    const response=await fetch(`${import.meta.env?.BASE_URL??'/'}data/green.json`);
    if(!response.ok)throw Error('I dati degli alberi non sono disponibili. Ricarica la pagina.');
    const green=await response.json() as GreenData;
    if(green.version!==1||!Array.isArray(green.trees))throw Error('I dati della vegetazione non sono validi.');
    return addVegetation(scene,map,green,{focus:[opening.scooter,city.spawn,...city.route],radius:180,maxTrees:140,quality:'alta',groundHeight:surfaceHeightAt,materials:{bark:foliage.bark,broadleaf:foliage.leaves},photographicLeafCards:true,shadows:world.shadows});
  })();
  const backgroundReady=(async()=>{
    const response=await fetch(`${import.meta.env?.BASE_URL??'/'}data/background-terrain.json`);
    if(!response.ok)throw Error('Il profilo del golfo non è disponibile. Ricarica la pagina.');
    return createBackgroundTerrain(scene,await response.json(),{excludeLocalBounds:city.bounds,clipToCityBounds:true,exclusionPaddingM:0,verticalOffsetM:options.terrain?-options.terrain.anchorHeight:0});
  })();
  const environmentReady=loadDaylightEnvironment(scene).then(environment=>{
    scene.getMeshByName('cielo città')?.setEnabled(false);
    const skybox=scene.createDefaultSkybox(environment,true,100000,0,false);
    if(skybox){skybox.applyFog=false;if(skybox.material){skybox.material.disableDepthWrite=true;skybox.material.fogEnabled=false;}}
  });
  const ready=Promise.all([materials.ready,foliage.ready,realFacades.ready,environmentReady,vegetationReady,backgroundReady,greenReady,furnitureReady]).then(()=>{});
  scene.metadata={...(scene.metadata??{}),visualDetail:{facades:facades.stats,streets:streets.stats,coast:coast.stats,realFacades:realFacades.stats,photographicMaps:'CC0 surfaces, foliage and selected real Naples hotel fronts; inferred depth, not photogrammetry'}};
  return {...world,ready,surfaceHeightAt,updateDetail(position:Point,quality:'alta'|'bassa'){facades.update(position,quality);}};
}
