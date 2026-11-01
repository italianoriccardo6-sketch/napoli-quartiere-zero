import {ORIGIN} from './geo';
import {NAPOLI_QUARTIERI,NAPOLI_ACQUISITION_BBOX} from './napoli-sectors';

export interface PhotoCoordinate {lat:number;lng:number;altitude?:number}
export interface PhotoCamera {center:PhotoCoordinate;heading:number;tilt:number;range:number;altitudeMode?:'ABSOLUTE'|'RELATIVE_TO_GROUND'}
export const PHOTO_START:PhotoCamera={center:{lat:ORIGIN.lat,lng:ORIGIN.lon,altitude:0},heading:315,tilt:65,range:1300};
export const PHOTO_COVERAGE_URL='https://developers.google.com/maps/documentation/javascript/3d/coverage';
export const PHOTO_PRICING_URL='https://developers.google.com/maps/billing-and-pricing/pricing';
export const PHOTO_SDK_ORIGIN='https://maps.googleapis.com';
export const PHOTO_DOCS_URL='https://developers.google.com/maps/documentation/javascript/3d/get-started';
/** Client-side API keys are public credentials. Restrict website referrers and APIs in Cloud Console. */
export function configuredPhotoKey(raw:unknown):string|null{
  if(typeof raw!=='string')return null;
  const key=raw.trim();
  if(!/^AIza[A-Za-z0-9_-]{35}$/.test(key)||/YOUR|REPLACE|EXAMPLE|PLACEHOLDER/i.test(key))return null;
  return key;
}
/** An explicit entered key never silently falls back to a different billing project. */
export function selectedPhotoKey(buildKey:unknown,enteredKey:unknown):string|null{
  const entered=typeof enteredKey==='string'?enteredKey.trim():'';
  return entered?configuredPhotoKey(entered):configuredPhotoKey(buildKey);
}
export function photoSdkUrl(rawKey:string,callback:string):string{
  const key=configuredPhotoKey(rawKey);
  if(!key||!/^__napoli[A-Za-z0-9_]+$/.test(callback))throw Error('Configurazione della città fotografica non valida.');
  const url=new URL('/maps/api/js',PHOTO_SDK_ORIGIN);
  url.search=new URLSearchParams({key,v:'weekly',loading:'async',libraries:'maps3d',language:'it',region:'IT',callback}).toString();
  return url.href;
}
export function photoCameraAt(center:PhotoCoordinate,options:Partial<Omit<PhotoCamera,'center'>>={}):PhotoCamera{
  const [south,west,north,east]=NAPOLI_ACQUISITION_BBOX;
  if(!Number.isFinite(center.lat)||!Number.isFinite(center.lng)||center.lat<south||center.lat>north||center.lng<west||center.lng>east||!Number.isFinite(center.altitude??0))throw Error('Posizione esterna all’area di esplorazione.');
  const heading=options.heading??PHOTO_START.heading,tilt=options.tilt??PHOTO_START.tilt,range=options.range??PHOTO_START.range;
  if(!Number.isFinite(heading)||!Number.isFinite(tilt)||tilt<0||tilt>85||!Number.isFinite(range)||range<2||range>10000)throw Error('Visuale non valida.');
  if(options.altitudeMode!==undefined&&!['ABSOLUTE','RELATIVE_TO_GROUND'].includes(options.altitudeMode))throw Error('Riferimento della camera non valido.');
  return {center:{...center},heading:((heading%360)+360)%360,tilt,range,...(options.altitudeMode?{altitudeMode:options.altitudeMode}:{})};
}
export function districtQuery(name:string):string{
  if(!NAPOLI_QUARTIERI.includes(name as typeof NAPOLI_QUARTIERI[number]))throw Error('Quartiere non previsto dal catalogo.');
  return `${name}, Napoli, Italia`;
}
interface AddressComponent {long_name:string;types:string[]}
export interface PhotoGeocodeResult {partial_match?:boolean;geometry:{location:{lat:()=>number;lng:()=>number}};address_components:AddressComponent[];types?:string[]}
const normalizeName=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
/** Search results are camera anchors, not surveyed district boundaries or certified coverage. */
export function districtGeocodePosition(name:string,result:PhotoGeocodeResult):PhotoCoordinate{
  districtQuery(name);
  if(!result||result.partial_match||!Array.isArray(result.address_components)||!result.address_components.some(c=>Array.isArray(c.types)&&c.types.includes('locality')&&normalizeName(c.long_name)==='napoli')||!result.address_components.some(c=>Array.isArray(c.types)&&(c.types.some(t=>t==='neighborhood'||t.startsWith('sublocality')))&&normalizeName(c.long_name)===normalizeName(name)))throw Error('Il servizio non ha identificato un centro verificabile del quartiere richiesto.');
  const center={lat:result.geometry.location.lat(),lng:result.geometry.location.lng()};
  photoCameraAt(center);return center;
}
/** Translation of the view only. Never samples Google mesh data or creates ground collision data. */
export function movePhotoCamera(camera:PhotoCamera,forward:number,right:number,metres:number):PhotoCamera{
  if(![forward,right,metres].every(Number.isFinite)||metres<0||metres>1000)throw Error('Movimento della visuale non valido.');
  const magnitude=Math.hypot(forward,right);if(!magnitude||!metres)return photoCameraAt(camera.center,camera);
  const yaw=camera.heading*Math.PI/180,f=forward/magnitude,r=right/magnitude;
  const north=(Math.cos(yaw)*f-Math.sin(yaw)*r)*metres,east=(Math.sin(yaw)*f+Math.cos(yaw)*r)*metres;
  const [south,west,northBound,eastBound]=NAPOLI_ACQUISITION_BBOX;
  const lat=Math.max(south,Math.min(northBound,camera.center.lat+north/6378137*180/Math.PI));
  const lng=Math.max(west,Math.min(eastBound,camera.center.lng+east/(6378137*Math.cos(camera.center.lat*Math.PI/180))*180/Math.PI));
  return photoCameraAt({...camera.center,lat,lng},camera);
}
