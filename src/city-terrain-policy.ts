import {toLocal,type Point} from './geo';
import {createCityElevation,type CityElevationGrid} from './city-elevation';

export type TerrainSampleKind='bilinear-source'|'bounded-nearest-pixel'|'retained-flat-baseline';
export interface TerrainSample {height:number;kind:TerrainSampleKind;extensionMetres:number|null}
export interface CityTerrainStats {
  calls:number;bilinearSource:number;boundedNearest:number;retainedFlat:number;
  maximumExtensionMetres:number;largestUsedExtensionMetres:number;
  verticalReference:'relative-to-opening-street';verticalDatum:'unknown';
  unsupportedPolicy:'retain-local-flat-baseline-not-measured';
}

/**
 * Scene policy over the separately validated raster. Native height differences
 * are retained. Coastal raster gaps may use an original pixel within 10 m;
 * farther missing areas keep the previous local flat scene baseline. These
 * two fallbacks are estimates, never reclassified as surveyed source heights.
 */
export function createCityTerrainPolicy(grid:CityElevationGrid,anchor:Point,maximumExtensionMetres=10){
  if(!Number.isFinite(maximumExtensionMetres)||maximumExtensionMetres<0||maximumExtensionMetres>10)throw new RangeError('Estensione del terreno fuori dal limite di 10 m.');
  const relative=createCityElevation(grid,anchor),b=grid.bounds;
  const [x0,z0]=toLocal(b.west+(b.east-b.west)/grid.width/2,b.north-(b.north-b.south)/grid.height/2);
  const [x1,z1]=toLocal(b.west+(b.east-b.west)/grid.width*1.5,b.north-(b.north-b.south)/grid.height*1.5);
  const sx=x1-x0,sz=z0-z1,limit2=maximumExtensionMetres**2;
  if(!(sx>0&&sz>0))throw new Error('Passo metrico del DTM non valido.');
  const columns=Math.ceil(maximumExtensionMetres/sx),rows=Math.ceil(maximumExtensionMetres/sz);
  const stats:CityTerrainStats={calls:0,bilinearSource:0,boundedNearest:0,retainedFlat:0,maximumExtensionMetres,largestUsedExtensionMetres:0,verticalReference:'relative-to-opening-street',verticalDatum:'unknown',unsupportedPolicy:'retain-local-flat-baseline-not-measured'};
  function sampleAt(x:number,z:number):TerrainSample {
    if(!Number.isFinite(x)||!Number.isFinite(z))throw new TypeError('Coordinate altimetriche non finite.');
    stats.calls++;
    const exact=relative.heightAt(x,z);
    if(exact!==null){stats.bilinearSource++;return {height:exact,kind:'bilinear-source',extensionMetres:null};}
    if(maximumExtensionMetres>0){
      const cx=Math.round((x-x0)/sx),cy=Math.round((z0-z)/sz);
      let best=-1,distance2=limit2;
      for(let row=Math.max(0,cy-rows);row<=Math.min(grid.height-1,cy+rows);row++)for(let column=Math.max(0,cx-columns);column<=Math.min(grid.width-1,cx+columns);column++){
        const index=row*grid.width+column,value=grid.heights[index];if(value===null)continue;
        const dx=x-(x0+column*sx),dz=z-(z0-row*sz),candidate=dx*dx+dz*dz;
        if(candidate>limit2+1e-9)continue;
        if(best<0||candidate<distance2-1e-9||(Math.abs(candidate-distance2)<=1e-9&&index<best)){best=index;distance2=candidate;}
      }
      if(best>=0){const extensionMetres=Math.sqrt(distance2);stats.boundedNearest++;stats.largestUsedExtensionMetres=Math.max(stats.largestUsedExtensionMetres,extensionMetres);return {height:grid.heights[best]!-relative.anchorHeight,kind:'bounded-nearest-pixel',extensionMetres};}
    }
    stats.retainedFlat++;return {height:0,kind:'retained-flat-baseline',extensionMetres:null};
  }
  return {
    grid,anchor:relative.anchor,anchorHeight:relative.anchorHeight,stats,sampleAt,
    heightAt(x:number,z:number){return sampleAt(x,z).height;},
    /** An artistic native-zero water reference, not a certified mean sea level. */
    waterReference:-relative.anchorHeight,
  };
}

export type CityTerrainPolicy=ReturnType<typeof createCityTerrainPolicy>;
