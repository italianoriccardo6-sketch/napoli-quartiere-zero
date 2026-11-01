import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {mergeOSMSectors,validateCitySectorManifest,validateSectorGeometry,type CitySectorManifest,type SectorGeometry} from '../src/city-sector-data';
import {createCitySectorLoader} from '../src/city-sector-loader';
import {parseNapoliBoundary,planMunicipalSectors} from '../src/napoli-boundary';
import {ORIGIN} from '../src/geo';
const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const nodes=[{type:'node',id:1,lon:14.2,lat:40.8},{type:'node',id:2,lon:14.21,lat:40.81}];
const way={type:'way',id:3,nodes:[1,2],tags:{highway:'residential'}};
function sector(id='napoli-e0-n0'):SectorGeometry{return {version:1,id,bounds:[0,0,1000,1000],representation:'OSM-planimetry-not-photogrammetry',buildings:[],roads:[],coastlines:[]};}
function fixtures(count=1){
 const payloads=Array.from({length:count},(_,i)=>({...sector(`napoli-e${i}-n0`),bounds:[i*1000,0,(i+1)*1000,1000] as [number,number,number,number]})),buffers=payloads.map(s=>new TextEncoder().encode(JSON.stringify(s)));
 const manifest:CitySectorManifest={version:1,status:'geography-only-not-activated',origin:ORIGIN,license:'ODbL-1.0',attribution:'© OpenStreetMap contributors',administrativeBoundaryVerified:false,terrainInstalled:false,landSurfaceInstalled:false,sources:[{id:'fixture',sha256:'a'.repeat(64),bytes:1,date:'2026-01-01T00:00:00Z',bbox:[40.8,14.2,40.9,14.3]}],sectors:payloads.map((s,i)=>({id:s.id,bounds:s.bounds,path:s.id+'.json',bytes:buffers[i].byteLength,sha256:sha(buffers[i]),buildings:0,roads:0}))};
 return {payloads,buffers,manifest};
}

test('sector merge: complete shared ways deduplicate; recursion skeletons enrich consistently in either order',()=>{
 const a={id:'A',raw:{elements:[...nodes,way]}},b={id:'B',raw:{elements:[...nodes.map(n=>({id:n.id,type:n.type,lat:n.lat,lon:n.lon})),{type:'way',id:3,nodes:[1,2]}]}};
 const result=mergeOSMSectors([a,b]),reverse=mergeOSMSectors([b,a]);assert.equal(result.summary.uniqueElements,3);assert.equal(result.summary.duplicateObjects,3);assert.deepEqual(result.raw,reverse.raw);assert.deepEqual(result.raw.elements.find(e=>e.type==='way')?.tags,way.tags);
 assert.deepEqual(result.raw.elements.map(e=>e.type+'/'+e.id),['node/1','node/2','way/3']);
});
test('sector merge: conflicting edits, missing references and false coordinates fail instead of inventing geometry',()=>{
 const good={id:'A',raw:{elements:[...nodes,way]}};
 assert.throws(()=>mergeOSMSectors([good,{id:'B',raw:{elements:[{...nodes[0],lon:14.9}]}}]),/Conflicting/);
 assert.throws(()=>mergeOSMSectors([{id:'missing',raw:{elements:[nodes[0],way]}}]),/Incomplete way/);
 assert.throws(()=>mergeOSMSectors([{id:'relation',raw:{elements:[...nodes,way,{type:'relation',id:5,members:[{type:'way',ref:99}]}]}}]),/Incomplete relation/);
 assert.throws(()=>mergeOSMSectors([{id:'bad',raw:{elements:[{...nodes[0],lat:NaN}]}}]),/coordinate/);
 assert.throws(()=>mergeOSMSectors([good,good]),/Duplicate/);
});
test('sector manifest: exact coordinate origin, safe URLs, counts and honest staging status are required',()=>{
 const {manifest}=fixtures();assert.equal(validateCitySectorManifest(manifest),manifest);
 for(const mutate of [(m:CitySectorManifest)=>{m.origin={lat:0,lon:0};},(m:CitySectorManifest)=>{m.sectors[0].path='../secret';},(m:CitySectorManifest)=>{m.sectors[0].bytes=9*1024*1024;},(m:CitySectorManifest)=>{m.terrainInstalled=true as false;}]){const m=structuredClone(manifest);mutate(m);assert.throws(()=>validateCitySectorManifest(m));}
 const bad=sector();bad.buildings=[{id:'bad',height:NaN,estimated:true,rings:[]}];assert.throws(()=>validateSectorGeometry(bad));
});
test('sector loader: authenticates bytes, shares requests, bounds LRU cache and prioritizes nearby geography',async()=>{
 const {manifest,buffers}=fixtures(3);let calls=0;
 const loader=createCitySectorLoader(manifest,{baseUrl:'/data/sectors',maxResident:1,fetch:async(url)=>{calls++;const i=Number(String(url).match(/napoli-e(\d+)-n0/)![1]);return new Response(buffers[i]);}});
 try{
  assert.deepEqual(loader.nearby([2001,500],0),['napoli-e2-n0']);
  const a=loader.load('napoli-e0-n0'),b=loader.load('napoli-e0-n0');assert.equal(a,b);await a;await loader.load('napoli-e0-n0');assert.equal(calls,1);
  await loader.load('napoli-e1-n0');assert.equal(loader.stats.resident,1);assert.equal(loader.stats.evictions,1);
  await loader.load('napoli-e0-n0');assert.equal(calls,3);assert.equal(loader.stats.resident,1);
 }finally{loader.dispose();}
 await assert.rejects(loader.load('napoli-e0-n0'),/disposed/);
});
test('sector loader: corrupt, truncated and excessive responses are not cached and may be retried',async()=>{
 const {manifest,buffers}=fixtures();let mode='corrupt';
 const loader=createCitySectorLoader(manifest,{baseUrl:'/tiles/',fetch:async()=>{const bytes=mode==='oversize'?new Uint8Array(buffers[0].length+1):mode==='truncated'?buffers[0].slice(1):buffers[0].slice();if(mode==='corrupt')bytes[0]^=1;return new Response(bytes);}});
 try{for(mode of ['corrupt','truncated','oversize']){await assert.rejects(loader.load(manifest.sectors[0].id));assert.equal(loader.stats.resident,0);}mode='good';assert.equal((await loader.load(manifest.sectors[0].id)).id,manifest.sectors[0].id);}finally{loader.dispose();}
});
test('sector loader: concurrency and disposal bound requests without starting queued network work',async()=>{
 const {manifest}=fixtures(8);let calls=0;
 const loader=createCitySectorLoader(manifest,{baseUrl:'/tiles/',maxConcurrent:2,timeoutMs:1000,fetch:async(_url,init)=>{calls++;return new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 const requests=manifest.sectors.map(s=>loader.load(s.id)),finished=Promise.allSettled(requests);
 await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,2);assert.equal(loader.stats.activeRequests,2);loader.dispose();assert.ok((await finished).every(r=>r.status==='rejected'));assert.equal(calls,2);assert.equal(loader.stats.inflight,0);assert.equal(loader.stats.activeRequests,0);
});
test('sector loader: a stalled transport is aborted by deadline',async()=>{
 const {manifest}=fixtures();let aborted=false;
 const loader=createCitySectorLoader(manifest,{baseUrl:'/tiles/',timeoutMs:100,fetch:async(_url,init)=>new Promise<Response>((_resolve,reject)=>init!.signal!.addEventListener('abort',()=>{aborted=true;reject(Error('deadline'));},{once:true}))});
 try{await assert.rejects(loader.load(manifest.sectors[0].id));assert.equal(aborted,true);assert.equal(loader.stats.resident,0);}finally{loader.dispose();}
});
test('Napoli boundary: installed geometry is an unchanged selection from pinned ISTAT data and retains attribution',()=>{
 const original=readFileSync('data/napoli-boundary/napoli-istat-2026.source.geojson'),derived=readFileSync('public/data/napoli-boundary.json'),source=JSON.parse(readFileSync('data/napoli-boundary/source.json','utf8'));
 assert.equal(sha(original),source.sourceSHA256);assert.equal(sha(derived),source.derivedSHA256);assert.equal(source.license,'CC-BY-4.0');
 const found=JSON.parse(original.toString('utf8')).features.filter((f:{properties:{com_istat_code?:string;code?:string}})=>(f.properties.com_istat_code??f.properties.code)==='063049');assert.equal(found.length,1);assert.deepEqual(JSON.parse(derived.toString('utf8')),found[0]);
 const boundary=parseNapoliBoundary(found[0]);assert.equal(boundary.properties.name,'Napoli');assert.equal(boundary.geometry.coordinates.length,4);assert.match(readFileSync('public/licenses/Istat-boundary-NOTICE.txt','utf8'),/Istat/);
 const wrong=structuredClone(boundary);wrong.properties.name='Altra città';assert.throws(()=>parseNapoliBoundary(wrong));
});
test('Napoli municipal grid: intersects the actual city and conserves administrative area without labeling it playable land',()=>{
 const boundary=JSON.parse(readFileSync('public/data/napoli-boundary.json','utf8')),sectors=planMunicipalSectors(boundary);
 assert.equal(sectors.length,162);const area=sectors.reduce((n,s)=>n+s.administrativeAreaM2,0);assert.ok(area>118e6&&area<120e6);
 for(const s of sectors){assert.ok(s.administrativeAreaM2>0&&s.administrativeAreaM2<=1e6+.1);for(const polygon of s.administrativePolygons)for(const ring of polygon)for(const p of ring){assert.ok(p[0]>=s.bounds[0]-1e-6&&p[0]<=s.bounds[2]+1e-6&&p[1]>=s.bounds[1]-1e-6&&p[1]<=s.bounds[3]+1e-6);}}
 const installed=JSON.parse(readFileSync('public/data/napoli-municipal-sectors.json','utf8'));assert.equal(installed.status,'administrative-planning-not-playable-coverage');assert.deepEqual(installed.sectors,sectors);
});
