import {configuredPhotoKey,photoSdkUrl,photoCameraAt,districtQuery,districtGeocodePosition,PHOTO_START,type PhotoCamera,type PhotoCoordinate,type PhotoGeocodeResult} from './photoreal-config';

export interface PhotoMapElement extends HTMLElement {
  center:PhotoCoordinate;heading:number;tilt:number;range:number;qualityMode:'FIDELITY'|'PERFORMANCE';
  flyCameraTo(options:{endCamera:PhotoCamera;durationMillis:number}):void;
  stopCameraAnimation():void;
}
interface PhotoModel extends HTMLElement {position:PhotoCoordinate;orientation:{heading:number;tilt:number;roll:number}}
export interface PhotoLibrary {
  Map3DElement:new(options:Record<string,unknown>)=>PhotoMapElement;
  Model3DElement?:new(options:Record<string,unknown>)=>PhotoModel;
}
interface Geocoder {geocode(request:{address:string;region:string;componentRestrictions:{country:string}}):Promise<{results:PhotoGeocodeResult[]}>}
interface MapsRuntime {importLibrary(name:'maps3d'|'geocoding'):Promise<unknown>}
type MapsWindow=Window&{google?:{maps?:MapsRuntime}};
let sdkPromise:Promise<MapsRuntime>|undefined,loadedKey:string|undefined;

/** Official SDK only. No Earth capture, tile download proxy, persistent imagery cache or mesh extraction. */
export function loadPhotorealSdk(rawKey:string):Promise<MapsRuntime>{
  const key=configuredPhotoKey(rawKey);
  if(!key)return Promise.reject(Error('La città fotografica non è configurata.'));
  if(typeof window==='undefined'||typeof document==='undefined')return Promise.reject(Error('È necessario un browser.'));
  if(loadedKey&&loadedKey!==key)return Promise.reject(Error('È già in uso un’altra configurazione della mappa. Ricarica la pagina.'));
  if(sdkPromise)return sdkPromise;
  const existing=(window as MapsWindow).google?.maps;
  if(existing?.importLibrary){loadedKey=key;return Promise.resolve(existing);}
  loadedKey=key;
  sdkPromise=new Promise<MapsRuntime>((resolve,reject)=>{
    const script=document.createElement('script'),callback='__napoliPhotorealReady',callbacks=window as unknown as Record<string,unknown>;
    const fail=()=>{cleanup();script.remove();sdkPromise=undefined;loadedKey=undefined;reject(Error('Google Maps non è raggiungibile o la configurazione non è valida.')); };
    const timer=window.setTimeout(fail,30000);
    function cleanup(){window.clearTimeout(timer);delete callbacks[callback];script.onerror=null;}
    callbacks[callback]=()=>{const maps=(window as MapsWindow).google?.maps;if(!maps?.importLibrary){fail();return;}cleanup();resolve(maps);};
    script.src=photoSdkUrl(key,callback);script.async=true;script.onerror=fail;script.id='napoli-photoreal-sdk';
    const nonce=document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce;if(nonce)script.nonce=nonce;
    document.head.append(script);
  });
  return sdkPromise;
}

export async function createPhotorealCity(container:HTMLElement,options:{apiKey:string;geocodingEnabled?:boolean;camera?:PhotoCamera;onStatus?:(message:string)=>void;loadLibrary?:()=>Promise<PhotoLibrary>}){
  if(!configuredPhotoKey(options.apiKey))throw Error('La città fotografica non è configurata.');
  const camera=photoCameraAt((options.camera??PHOTO_START).center,options.camera??PHOTO_START);
  const runtime=options.loadLibrary?undefined:await loadPhotorealSdk(options.apiKey);
  const library=options.loadLibrary?await options.loadLibrary():await runtime!.importLibrary('maps3d') as PhotoLibrary;
  const map=new library.Map3DElement({...camera,mode:'SATELLITE',qualityMode:'FIDELITY',maxMemoryMegabytes:512,description:'Napoli, esplorazione fotografica dall’alto; copertura e data delle riprese dipendono da Google Maps.'});
  map.style.width='100%';map.style.height='100%';
  let disposed=false,animating=false,geocoder:Geocoder|undefined;
  const onError=()=>options.onStatus?.('La mappa fotografica non si è inizializzata. Verifica servizio, chiave e dominio autorizzato.');
  const onSteady=(event:Event)=>{if((event as Event&{isSteady?:boolean}).isSteady)options.onStatus?.('Esplora Napoli con mouse e tastiera. La copertura fotografica dei singoli quartieri resta da verificare.');};
  const onAnimationEnd=()=>{animating=false;};
  map.addEventListener('gmp-error',onError);map.addEventListener('gmp-steadychange',onSteady);map.addEventListener('gmp-animationend',onAnimationEnd);
  container.append(map);
  const anchors=new Map<string,PhotoCoordinate>();
  let navigationGeneration=0;
  function setCamera(next:PhotoCamera,animate=false){
    if(disposed)return;
    const validated=photoCameraAt(next.center,next);
    if(animate){animating=true;map.flyCameraTo({endCamera:validated,durationMillis:1800});}
    else{if(animating){map.stopCameraAnimation();animating=false;}map.center=validated.center;map.heading=validated.heading;map.tilt=validated.tilt;map.range=validated.range;}
  }
  async function goToDistrict(name:string){
    const address=districtQuery(name),generation=++navigationGeneration;
    if(!options.geocodingEnabled)throw Error('La ricerca dei quartieri non è attiva nella configurazione di questa anteprima.');
    let position=anchors.get(name);
    if(!position){
      if(!runtime)throw Error('Il servizio di ricerca non è disponibile in questa anteprima.');
      options.onStatus?.(`Ricerca di ${name}…`);
      if(!geocoder){const {Geocoder}=await runtime.importLibrary('geocoding') as {Geocoder:new()=>Geocoder};geocoder=new Geocoder();}
      let results:PhotoGeocodeResult[];
      try{({results}=await geocoder.geocode({address,region:'IT',componentRestrictions:{country:'IT'}}));}catch{throw Error('Ricerca non disponibile. Verifica che Geocoding API sia abilitata e autorizzata per questa chiave.');}
      position=results.map(result=>{try{return districtGeocodePosition(name,result);}catch{return null;}}).find((p):p is PhotoCoordinate=>!!p);
      if(!position)throw Error('Nessun centro verificabile trovato per questo quartiere.');
      // Session memory only: no geocoding results are exported or saved to storage.
      anchors.set(name,position);
    }
    if(disposed||generation!==navigationGeneration)return;
    setCamera(photoCameraAt(position,{heading:map.heading,tilt:65,range:1400}),true);
    options.onStatus?.(`${name}: punto di ricerca, non confine amministrativo. Verifica la copertura 3D disponibile.`);
  }
  function addOriginalModel(options:{src:string;position:PhotoCoordinate;heading?:number;scale?:number}){
    if(disposed||!library.Model3DElement)throw Error('Modello non disponibile.');
    const url=new URL(options.src,document.baseURI);if(url.origin!==location.origin||!url.pathname.endsWith('.glb'))throw Error('Utilizza un modello GLB locale con diritti di riuso verificati.');
    const placement=photoCameraAt(options.position,{heading:options.heading??0});const scale=options.scale??1;if(!Number.isFinite(scale)||scale<=0||scale>100)throw Error('Scala del modello non valida.');
    const model=new library.Model3DElement({src:url.href,position:options.position,orientation:{heading:placement.heading,tilt:0,roll:0},scale,altitudeMode:'CLAMP_TO_GROUND'});map.append(model);return model;
  }
  return {map,setCamera,goToDistrict,addOriginalModel,getCamera:()=>photoCameraAt({lat:map.center.lat,lng:map.center.lng,altitude:map.center.altitude??0},{heading:map.heading,tilt:map.tilt,range:map.range}),dispose(){if(disposed)return;disposed=true;navigationGeneration++;anchors.clear();map.stopCameraAnimation();map.removeEventListener('gmp-error',onError);map.removeEventListener('gmp-steadychange',onSteady);map.removeEventListener('gmp-animationend',onAnimationEnd);map.remove();}};
}
