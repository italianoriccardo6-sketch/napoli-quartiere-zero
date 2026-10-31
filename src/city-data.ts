import type {MapData,Point} from './geo';
import type {CityWorldDetail} from './city-world';
export interface CityRuntime extends CityWorldDetail {
  spawn:Point;
  scooter:Point;
  pickup:Point;
  delivery:Point;
  route:Point[];
  routeNames:string[];
  sourceDate:string;
  estimatedHeights:number;
  heightStatus:string;
}
export type CityMapData=MapData&{city?:CityRuntime};
