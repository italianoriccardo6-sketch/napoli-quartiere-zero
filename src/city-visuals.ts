import '@babylonjs/core/Helpers/sceneHelpers';
import type {Scene} from '@babylonjs/core/scene';
import type {CityMapData,CityRuntime} from './city-data';
import type {Point} from './geo';
import {createCityWorld} from './city-world';
import {createVisualMaterials,loadDaylightEnvironment} from './visual-materials';
import {addFacadeDetail} from './facade-detail';
import {addStreetDetail} from './street-detail';

/** Shared by the playable scene and the direct engine frame capture. */
export function createDetailedCity(scene:Scene,map:CityMapData,city:CityRuntime){
  const materials=createVisualMaterials(scene);
  const world=createCityWorld(scene,map,city,{materials});
  const facades=addFacadeDetail(scene,map,{focus:[city.spawn,...city.route],radius:95,quality:'alta',materials});
  const streets=addStreetDetail(scene,map,city,{materials});
  const ready=Promise.all([materials.ready,loadDaylightEnvironment(scene)]).then(([,environment])=>{
    scene.getMeshByName('cielo città')?.setEnabled(false);
    scene.createDefaultSkybox(environment,true,4000,0,false);
  });
  scene.metadata={...(scene.metadata??{}),visualDetail:{facades:facades.stats,streets:streets.stats,photographicMaps:'CC0 Poly Haven; generic surfaces, not surveyed Naples facades'}};
  return {...world,ready,updateDetail(position:Point,quality:'alta'|'bassa'){facades.update(position,quality);}};
}
