import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpatialStream} from '../src/spatial-stream';
import {facadeChunks} from '../src/facade-stream';
import {planNapoliSectors,sectorQuery,NAPOLI_QUARTIERI,fromLocal} from '../src/napoli-sectors';
import {toLocal,type MapData} from '../src/geo';

test('stream: loads nearest first, limits allocations per frame and evicts far resources',()=>{
  const loaded:string[]=[],unloaded:string[]=[];
  const stream=createSpatialStream({chunks:Array.from({length:50},(_,i)=>({id:String(i),bounds:[i*100,0,i*100+90,90] as const,value:i})),loadDistance:150,unloadDistance:220,maxResident:3,
    load:c=>{loaded.push(c.id);return c.id;},unload:id=>unloaded.push(id)});
  stream.update([10,10]);assert.deepEqual(loaded,['0']);assert.equal(stream.stats.pendingChunks,1);
  stream.update([10,10]);assert.deepEqual(loaded,['0','1']);
  stream.update([4910,10]);assert.equal(stream.stats.residentChunks,1);assert.deepEqual(unloaded,['0','1']);assert.equal(loaded.at(-1),'49');
  stream.update([4910,10]);assert.ok(stream.stats.residentChunks<=3);
  stream.dispose();assert.equal(stream.stats.residentChunks,0);const count=unloaded.length;stream.dispose();assert.equal(unloaded.length,count);
});
test('stream: hysteresis avoids rebuilding nearby chunks, hard cap makes room for nearer chunks',()=>{
  const unloaded:number[]=[];
  const stream=createSpatialStream({chunks:[0,1,2].map(i=>({id:String(i),bounds:[i*100,0,i*100+5,5] as const,value:i})),loadDistance:110,unloadDistance:300,maxResident:2,load:c=>c.value,unload:r=>unloaded.push(r)});
  stream.update([0,0],{maxLoads:2});assert.deepEqual(stream.resources,[0,1]);
  stream.update([90,0]);assert.equal(stream.stats.loadedChunks,2);
  stream.update([201,0]);assert.deepEqual(stream.resources,[1,2]);assert.deepEqual(unloaded,[0]);
});
test('stream: frame budget bounds work, rejects malformed data and does not accept failed loads as resident',()=>{
  let ticks=0;const options={chunks:[0,1,2].map(i=>({id:String(i),bounds:[0,0,1,1] as const,value:i})),loadDistance:2,unloadDistance:4,maxResident:3,load:(c:{value:number})=>c.value,unload:()=>{},now:()=>ticks++*10};
  const stream=createSpatialStream(options);stream.update([0,0],{maxLoads:3,milliseconds:4});assert.equal(stream.stats.loadedChunks,1);
  assert.throws(()=>createSpatialStream({...options,chunks:[options.chunks[0],options.chunks[0]]}));
  assert.throws(()=>stream.update([NaN,0]));
  const failed=createSpatialStream({...options,load:()=>{throw Error('load failed');}});assert.throws(()=>failed.update([0,0]));assert.equal(failed.stats.residentChunks,0);
});
test('facade ownership: crossing footprint is assigned once and source rings remain unchanged',()=>{
  const map:MapData={provenance:'osm',notice:'synthetic fixture',paths:[],land:[],buildings:[{id:'crossing',height:12,estimated:false,rings:[[[120,0],[140,0],[140,20],[120,20]]]}]};
  const before=JSON.stringify(map),chunks=facadeChunks(map);
  assert.equal(chunks.length,1);assert.equal(chunks[0].value.size,1);assert.equal(chunks[0].value.has('crossing'),true);assert.ok(chunks[0].bounds[0]<=120);assert.equal(JSON.stringify(map),before);
});
test('Napoli sectors: thirty targets, metre grid without gaps, bounded query and round-trip coordinates',()=>{
  const sectors=planNapoliSectors();assert.equal(NAPOLI_QUARTIERI.length,30);assert.equal(new Set(NAPOLI_QUARTIERI).size,30);assert.ok(NAPOLI_QUARTIERI.includes('Posillipo'));assert.ok(NAPOLI_QUARTIERI.includes('Fuorigrotta'));
  assert.ok(sectors.length>200);assert.equal(new Set(sectors.map(s=>s.id)).size,sectors.length);
  for(const sector of sectors){
    const [x,z,x1,z1]=sector.bounds;assert.ok(x1>x&&x1-x<=1000.00001&&z1>z&&z1-z<=1000.00001);
    const [lon,lat]=fromLocal([x,z]),local=toLocal(lon,lat);assert.ok(Math.hypot(local[0]-x,local[1]-z)<1e-6);
    const query=sectorQuery(sector);assert.ok(query.includes('[maxsize:16777216]'));assert.ok(query.includes(sector.bbox.join(',')));
  }
  const rows=new Map<number,typeof sectors>();for(const s of sectors){const row=rows.get(s.bounds[1])??[];row.push(s);rows.set(s.bounds[1],row);}
  for(const row of rows.values())for(let i=1;i<row.length;i++)assert.equal(row[i-1].bounds[2],row[i].bounds[0]);
});
