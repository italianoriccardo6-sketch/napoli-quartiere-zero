import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredPhotoKey,selectedPhotoKey,photoSdkUrl,photoCameraAt,PHOTO_START,movePhotoCamera,districtQuery,districtGeocodePosition} from '../src/photoreal-config';
import {loadPhotorealSdk,createPhotorealCity,type PhotoLibrary} from '../src/photoreal-city';
const testKey='AIza'+'a'.repeat(35);

test('photo configuration: absent/placeholder credentials make no SDK request, browser key stays in official URL only',async()=>{
  for(const key of [undefined,'','YOUR_API_KEY','AIza'+ 'a'.repeat(34),'server secret','<script>'])assert.equal(configuredPhotoKey(key),null);
  assert.equal(configuredPhotoKey(testKey),testKey);
  const anotherKey='AIza'+'b'.repeat(35);
  assert.equal(selectedPhotoKey(undefined,testKey),testKey);
  assert.equal(selectedPhotoKey(testKey,anotherKey),anotherKey);
  assert.equal(selectedPhotoKey(testKey,'invalid entered key'),null,'do not charge a configured project when an explicit replacement is invalid');
  assert.equal(selectedPhotoKey(testKey,''),testKey);
  assert.equal(selectedPhotoKey(undefined,''),null);
  const url=new URL(photoSdkUrl(testKey,'__napoliTestReady'));
  assert.equal(url.origin,'https://maps.googleapis.com');assert.equal(url.pathname,'/maps/api/js');assert.equal(url.searchParams.get('libraries'),'maps3d');assert.equal(url.searchParams.get('key'),testKey);
  assert.throws(()=>photoSdkUrl(testKey,'evil.callback()'));
  await assert.rejects(loadPhotorealSdk(''),/non è configurata/);
  let requests=0;await assert.rejects(createPhotorealCity({} as HTMLElement,{apiKey:'',loadLibrary:async()=>{requests++;throw Error('unexpected');}}));assert.equal(requests,0);
});
test('photo movement: metre-scale camera motion follows heading, clamps to exploration envelope and preserves input',()=>{
  const before=JSON.stringify(PHOTO_START),north=movePhotoCamera({...PHOTO_START,heading:0},1,0,100),east=movePhotoCamera({...PHOTO_START,heading:90},1,0,100);
  assert.ok(north.center.lat>PHOTO_START.center.lat);assert.equal(north.center.lng,PHOTO_START.center.lng);
  assert.ok(east.center.lng>PHOTO_START.center.lng);assert.ok(Math.abs(east.center.lat-PHOTO_START.center.lat)<1e-10);
  const diagonal=movePhotoCamera({...PHOTO_START,heading:0},1,1,100);assert.ok(diagonal.center.lat<north.center.lat&&diagonal.center.lng>PHOTO_START.center.lng);
  assert.equal(JSON.stringify(PHOTO_START),before);assert.equal(photoCameraAt(PHOTO_START.center,{heading:-10}).heading,350);
  assert.throws(()=>movePhotoCamera(PHOTO_START,1,0,Infinity));assert.throws(()=>photoCameraAt({lat:0,lng:0}));assert.throws(()=>photoCameraAt(PHOTO_START.center,{range:1}));
});
test('district search: real response required; rejects partial, wrong-city and generic locality matches',()=>{
  assert.equal(districtQuery('Fuorigrotta'),'Fuorigrotta, Napoli, Italia');assert.throws(()=>districtQuery('arbitrary paid query'));
  const result={geometry:{location:{lat:()=>40.8281,lng:()=>14.2486}},address_components:[{long_name:'Napoli',types:['locality']},{long_name:'Fuorigrotta',types:['sublocality_level_1']}]};
  assert.deepEqual(districtGeocodePosition('Fuorigrotta',result),{lat:40.8281,lng:14.2486});
  assert.throws(()=>districtGeocodePosition('Fuorigrotta',{...result,partial_match:true}));
  assert.throws(()=>districtGeocodePosition('Posillipo',result));
  assert.throws(()=>districtGeocodePosition('Fuorigrotta',{...result,address_components:[{long_name:'Napoli',types:['locality']}]}));
  assert.throws(()=>districtGeocodePosition('Fuorigrotta',{...result,geometry:{location:{lat:()=>0,lng:()=>0}}}));
});
test('photo adapter: real SDK boundary stays injectable, native attribution options untouched and disposal releases view',async()=>{
  let appended:unknown,removed=0,stopped=0,initial:Record<string,unknown>|undefined;
  class MapDouble extends EventTarget {
    style={width:'',height:''};center=PHOTO_START.center;heading=0;range=1000;tilt=60;qualityMode='FIDELITY';
    constructor(options:Record<string,unknown>){super();initial=options;Object.assign(this,options);}
    stopCameraAnimation(){stopped++;}flyCameraTo(){ }remove(){removed++;}
  }
  const city=await createPhotorealCity({append(value:unknown){appended=value;}} as unknown as HTMLElement,{apiKey:testKey,loadLibrary:async()=>({Map3DElement:MapDouble} as unknown as PhotoLibrary)});
  assert.equal(appended,city.map);assert.equal(initial?.mode,'SATELLITE');assert.equal('defaultUIHidden' in initial!,false);
  city.setCamera({...PHOTO_START,heading:20});assert.equal(city.map.heading,20);
  await assert.rejects(city.goToDistrict('Posillipo'),/non è attiva/);
  city.dispose();city.dispose();assert.equal(removed,1);assert.ok(stopped>0);
});
