import {validateCitySectorManifest,validateSectorGeometry,type CitySectorManifest,type SectorGeometry} from './city-sector-data';
import type {Point} from './geo';
import {boundsDistance} from './spatial-stream';

/** Bounded geography transport/cache; it never invents land, elevation or gameplay colliders. */
export function createCitySectorLoader(rawManifest:unknown,options:{baseUrl:string;maxResident?:number;maxConcurrent?:number;timeoutMs?:number;fetch?:typeof fetch;sha256?:(bytes:Uint8Array)=>Promise<string>} ){
  const manifest=validateCitySectorManifest(rawManifest),maximum=options.maxResident??9;
  if(!Number.isSafeInteger(maximum)||maximum<1||maximum>64)throw Error('Invalid geographic cache budget.');
  const maximumConcurrent=options.maxConcurrent??2,timeoutMs=options.timeoutMs??15000;
  if(!Number.isSafeInteger(maximumConcurrent)||maximumConcurrent<1||maximumConcurrent>4||!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>120000)throw Error('Invalid geographic transport budget.');
  const transport=options.fetch??fetch,digest=options.sha256??(async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(n=>n.toString(16).padStart(2,'0')).join(''));
  const descriptors=new Map(manifest.sectors.map(s=>[s.id,s])),resident=new Map<string,SectorGeometry>(),pending=new Map<string,{controller:AbortController;promise:Promise<SectorGeometry>}>();
  const stats={requests:0,cacheHits:0,evictions:0,resident:0,inflight:0,bytesReceived:0,activeRequests:0};let disposed=false;
  const queue:Array<{start:()=>void;reject:(reason:Error)=>void;signal:AbortSignal;abort:()=>void}>=[];
  function acquire(signal:AbortSignal){
    if(signal.aborted)return Promise.reject(Error('Geographic request cancelled.'));
    if(stats.activeRequests<maximumConcurrent){stats.activeRequests++;return Promise.resolve();}
    return new Promise<void>((resolve,reject)=>{
      const item={start:resolve,reject,signal,abort:()=>{const index=queue.indexOf(item);if(index>=0)queue.splice(index,1);reject(Error('Geographic request cancelled while queued.'));}};
      signal.addEventListener('abort',item.abort,{once:true});queue.push(item);
    });
  }
  function release(){const next=queue.shift();if(next){next.signal.removeEventListener('abort',next.abort);next.start();}else stats.activeRequests--;}
  function nearby(position:Point,radius:number,maximum=9){
    if(position.length!==2||!position.every(Number.isFinite)||!Number.isFinite(radius)||radius<0||!Number.isSafeInteger(maximum)||maximum<0||maximum>64)throw Error('Invalid geographic request area.');
    return manifest.sectors.map(sector=>({sector,distance:boundsDistance(position,sector.bounds)})).filter(e=>e.distance<=radius).sort((a,b)=>a.distance-b.distance||a.sector.id.localeCompare(b.sector.id)).slice(0,maximum).map(e=>e.sector.id);
  }
  function load(id:string):Promise<SectorGeometry>{
    if(disposed)return Promise.reject(Error('Geographic loader disposed.'));
    const entry=descriptors.get(id);if(!entry)return Promise.reject(Error('Unknown geographic sector.'));
    const existing=resident.get(id);if(existing){resident.delete(id);resident.set(id,existing);stats.cacheHits++;return Promise.resolve(existing);}
    const active=pending.get(id);if(active)return active.promise;
    const controller=new AbortController();stats.requests++;
    let acquired=false;const timeout=setTimeout(()=>controller.abort(),timeoutMs);
    const promise=(async()=>{
      await acquire(controller.signal);acquired=true;
      const response=await transport(options.baseUrl.replace(/\/?$/,'/')+entry.path,{signal:controller.signal,cache:'force-cache'});
      if(!response.ok||!response.body)throw Error('Geographic sector unavailable: '+id);
      const declared=response.headers.get('Content-Length'),encoding=response.headers.get('Content-Encoding');if(declared!==null&&(!encoding||encoding==='identity')&&Number(declared)!==entry.bytes)throw Error('Geographic sector byte count mismatch.');
      const reader=response.body.getReader(),chunks:Uint8Array[]=[];let received=0;
      try{while(true){const value=await reader.read();if(value.done)break;received+=value.value.byteLength;stats.bytesReceived+=value.value.byteLength;if(received>entry.bytes)throw Error('Geographic sector exceeds declared byte count.');chunks.push(value.value);}}finally{await reader.cancel();}
      if(received!==entry.bytes)throw Error('Truncated geographic sector.');
      const bytes=new Uint8Array(received);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      if(await digest(bytes)!==entry.sha256)throw Error('Geographic sector checksum mismatch.');
      const sector=validateSectorGeometry(JSON.parse(new TextDecoder().decode(bytes)));
      if(sector.id!==id||JSON.stringify(sector.bounds)!==JSON.stringify(entry.bounds)||sector.buildings.length!==entry.buildings||sector.roads.length!==entry.roads)throw Error('Geographic sector does not match its manifest.');
      if(disposed||controller.signal.aborted)throw Error('Geographic sector request cancelled.');
      while(resident.size>=maximum){resident.delete(resident.keys().next().value!);stats.evictions++;}
      resident.set(id,sector);stats.resident=resident.size;return sector;
    })().finally(()=>{clearTimeout(timeout);if(acquired)release();pending.delete(id);stats.inflight=pending.size;});
    pending.set(id,{controller,promise});stats.inflight=pending.size;return promise;
  }
  function dispose(){if(disposed)return;disposed=true;for(const item of pending.values())item.controller.abort();resident.clear();stats.resident=0;}
  return {manifest:manifest as Readonly<CitySectorManifest>,nearby,load,stats,dispose};
}
