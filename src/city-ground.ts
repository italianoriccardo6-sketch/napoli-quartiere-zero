import type {Scene} from '@babylonjs/core/scene';
import type {Material} from '@babylonjs/core/Materials/material';
import type {Footprint,Point} from './geo';
import type {CityTerrainPolicy} from './city-terrain-policy';
import {addElevatedGround} from './elevated-ground';
import {addShorelineSides} from './shoreline-sides';
import {buildingGroundBases} from './building-ground';

/** One rendered height field shared by roads, actors, foundations and props. */
export function addCityGround(scene:Scene,land:Point[][][],buildings:readonly Footprint[],policy:CityTerrainPolicy,material:Material){
  const vertexHeightSources={...policy.stats,calls:0,bilinearSource:0,boundedNearest:0,retainedFlat:0,largestUsedExtensionMetres:0};
  const ground=addElevatedGround(scene,land,(x,z)=>{
    const sample=policy.sampleAt(x,z);vertexHeightSources.calls++;
    if(sample.kind==='bilinear-source')vertexHeightSources.bilinearSource++;
    else if(sample.kind==='bounded-nearest-pixel'){vertexHeightSources.boundedNearest++;vertexHeightSources.largestUsedExtensionMetres=Math.max(vertexHeightSources.largestUsedExtensionMetres,sample.extensionMetres!);}
    else vertexHeightSources.retainedFlat++;
    return sample.height;
  },material,{maxEdge:20,tileSize:256});
  const heightAt=(x:number,z:number)=>ground.heightAt(x,z)??policy.heightAt(x,z);
  const foundations=buildingGroundBases(buildings,heightAt),sides=addShorelineSides(scene,ground.geometry,policy.waterReference,material);
  let minimumHeight=Infinity,maximumHeight=-Infinity;
  for(let i=1;i<ground.geometry.positions.length;i+=3){minimumHeight=Math.min(minimumHeight,ground.geometry.positions[i]);maximumHeight=Math.max(maximumHeight,ground.geometry.positions[i]);}
  const metadata={
    provider:'Regione Campania',dataset:'CTR2020 DTM5K',sourceYear:2020,sourceUnits:'metres',
    verticalDatum:'unknown',verticalReference:'relative-to-opening-street',anchorPoint:[...policy.anchor],anchorSourceHeight:policy.anchorHeight,
    waterReference:policy.waterReference,waterReferencePolicy:'artistic-native-zero-not-certified-MSL',
    vertexHeightSources,minimumHeight,maximumHeight,mesh:ground.stats,foundations:foundations.stats,
    actorHeightPolicy:'barycentric-interpolation-of-rendered-ground-and-street-triangles',
    limitation:'Native 5 m ground DTM is not a road, bridge, stair or building-foundation survey. Missing coastal samples are explicitly estimated or retained flat.',
  };
  return {heightAt,renderedHeightAt:ground.heightAt,buildingBaseHeight:foundations.heightAt,geometry:ground.geometry,meshes:ground.meshes,sides:sides.mesh,metadata,
    dispose(){sides.mesh.dispose();ground.dispose();}};
}
