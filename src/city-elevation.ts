import {ORIGIN,type Point} from './geo';

/** A raw ground-height raster. Its vertical datum is deliberately not asserted. */
export interface CityElevationGrid {
  version:1;
  width:number;
  height:number;
  bounds:{west:number;south:number;east:number;north:number};
  rowOrder:'north-to-south';
  sampleLocation:'pixel-center';
  sourceUnits:'metres';
  verticalDatum:null;
  relativeOnly:true;
  noData:null;
  heights:Array<number|null>;
}

export interface CityElevation {
  grid:CityElevationGrid;
  anchor:Point;
  anchorHeight:number;
  /** Metres relative to the opening street; null means source data is absent. */
  heightAt:(x:number,z:number)=>number|null;
}

/** Reject rendered byte images, malformed grids and unreviewed unit assumptions. */
export function parseCityElevationGrid(value:unknown):CityElevationGrid {
  if(!value||typeof value!=='object')throw Error('Griglia altimetrica assente.');
  const g=value as CityElevationGrid,b=g.bounds;
  if(g.version!==1||!Number.isInteger(g.width)||!Number.isInteger(g.height)||g.width<2||g.height<2||g.width*g.height>200000
    ||!b||![b.west,b.south,b.east,b.north].every(Number.isFinite)||b.west>=b.east||b.south>=b.north
    ||g.rowOrder!=='north-to-south'||g.sampleLocation!=='pixel-center'||g.sourceUnits!=='metres'
    ||g.verticalDatum!==null||g.relativeOnly!==true||g.noData!==null||!Array.isArray(g.heights)||g.heights.length!==g.width*g.height
    ||g.heights.some(h=>h!==null&&(!Number.isFinite(h)||h< -10||h>500)))throw Error('Griglia altimetrica o riferimento verticale non validi.');
  return g;
}

/** Bilinear interpolation of real pixel centres, with no nodata filling. */
export function sampleCityElevationLonLat(grid:CityElevationGrid,lon:number,lat:number):number|null {
  if(!Number.isFinite(lon)||!Number.isFinite(lat))return null;
  const b=grid.bounds,fx=(lon-b.west)/(b.east-b.west)*grid.width-.5,fy=(b.north-lat)/(b.north-b.south)*grid.height-.5;
  // The half-pixel fringe has no measured support beyond its first/last centre.
  if(fx< -1e-9||fy< -1e-9||fx>grid.width-1+1e-9||fy>grid.height-1+1e-9)return null;
  const cx=Math.max(0,Math.min(grid.width-1,fx)),cy=Math.max(0,Math.min(grid.height-1,fy));
  const x=Math.min(grid.width-2,Math.floor(cx)),y=Math.min(grid.height-2,Math.floor(cy)),tx=cx-x,ty=cy-y;
  const indices=[y*grid.width+x,y*grid.width+x+1,(y+1)*grid.width+x,(y+1)*grid.width+x+1];
  const weights=[(1-tx)*(1-ty),tx*(1-ty),(1-tx)*ty,tx*ty];
  let height=0;
  for(let i=0;i<4;i++){
    // Exact measured centres remain usable beside a missing pixel.
    if(weights[i]<1e-12)continue;
    const v=grid.heights[indices[i]];if(v===null)return null;
    height+=v*weights[i];
  }
  return height;
}

/** Same local east/north metre coordinates as geo.toLocal and the source map. */
export function sampleCityElevation(grid:CityElevationGrid,x:number,z:number):number|null {
  const radians=Math.PI/180,metresPerDegree=radians*6378137;
  return sampleCityElevationLonLat(grid,ORIGIN.lon+x/(metresPerDegree*Math.cos(ORIGIN.lat*radians)),ORIGIN.lat+z/metresPerDegree);
}

/** A common constant datum offset cancels; no sea-level constraint is added. */
export function createCityElevation(grid:CityElevationGrid,anchor:Point):CityElevation {
  parseCityElevationGrid(grid);
  const anchorHeight=sampleCityElevation(grid,anchor[0],anchor[1]);
  if(anchorHeight===null)throw Error('Quota iniziale fuori dalla copertura altimetrica.');
  return {grid,anchor:[...anchor],anchorHeight,heightAt:(x,z)=>{
    const h=sampleCityElevation(grid,x,z);return h===null?null:h-anchorHeight;
  }};
}
