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

/** Shared by the playable scene and the direct engine frame capture. */
export function createDetailedCity(scene:Scene,map:CityMapData,city:CityRuntime){
  const materials=createVisualMaterials(scene);
  const world=createCityWorld(scene,map,city,{materials});
  const opening=openingStreetData(city);
  const facades=addFacadeDetail(scene,map,{focus:[opening.scooter,city.spawn,...city.route],radius:95,quality:'alta',materials});
  const streets=addStreetDetail(scene,map,city,{materials});
  const vegetationReady=(async()=>{
    const response=await fetch(`${import.meta.env?.BASE_URL??'/'}data/green.json`);
    if(!response.ok)throw Error('I dati degli alberi non sono disponibili. Ricarica la pagina.');
    const green=await response.json() as GreenData;
    if(green.version!==1||!Array.isArray(green.trees))throw Error('I dati della vegetazione non sono validi.');
    return addVegetation(scene,map,green,{focus:[city.spawn,...city.route],radius:180,maxTrees:140,quality:'alta',shadows:world.shadows});
  })();
  const backgroundReady=(async()=>{
    const response=await fetch(`${import.meta.env?.BASE_URL??'/'}data/background-terrain.json`);
    if(!response.ok)throw Error('Il profilo del golfo non è disponibile. Ricarica la pagina.');
    return createBackgroundTerrain(scene,await response.json(),{excludeLocalBounds:city.bounds});
  })();
  const ready=Promise.all([materials.ready,loadDaylightEnvironment(scene),vegetationReady,backgroundReady]).then(([,environment])=>{
    scene.getMeshByName('cielo città')?.setEnabled(false);
    const skybox=scene.createDefaultSkybox(environment,true,100000,0,false);
    if(skybox){skybox.applyFog=false;if(skybox.material){skybox.material.disableDepthWrite=true;skybox.material.fogEnabled=false;}}
  });
  scene.metadata={...(scene.metadata??{}),visualDetail:{facades:facades.stats,streets:streets.stats,photographicMaps:'CC0 Poly Haven; generic surfaces, not surveyed Naples facades'}};
  return {...world,ready,surfaceHeightAt:streets.heightAt,updateDetail(position:Point,quality:'alta'|'bassa'){facades.update(position,quality);}};
}
