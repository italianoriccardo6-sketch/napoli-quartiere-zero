import type {Point} from './geo';
export type StreamBounds=readonly [number,number,number,number];
export interface SpatialChunk<T> {id:string;bounds:StreamBounds;value:T}
export interface SpatialStreamOptions<T,R> {
  chunks:readonly SpatialChunk<T>[];
  loadDistance:number;unloadDistance:number;maxResident:number;
  load:(chunk:SpatialChunk<T>)=>R;
  unload:(resource:R)=>void;
  now?:()=>number;
  /** Recompute the source priority order only after this movement; zero for exact scheduling. */
  rescheduleDistance?:number;
}
export const boundsDistance=(p:Point,b:StreamBounds)=>Math.hypot(Math.max(b[0]-p[0],0,p[0]-b[2]),Math.max(b[1]-p[1],0,p[1]-b[3]));
/** Synchronous, frame-budgeted GPU resources. CPU collision/source data are independent. */
export function createSpatialStream<T,R>(options:SpatialStreamOptions<T,R>){
  if(!Number.isFinite(options.loadDistance)||options.loadDistance<0||!Number.isFinite(options.unloadDistance)||options.unloadDistance<=options.loadDistance||!Number.isSafeInteger(options.maxResident)||options.maxResident<1)throw Error('Invalid stream budget.');
  const ids=new Set<string>();
  for(const c of options.chunks){if(!c.id||ids.has(c.id)||c.bounds.length!==4||!c.bounds.every(Number.isFinite)||c.bounds[0]>c.bounds[2]||c.bounds[1]>c.bounds[3])throw Error('Invalid or duplicate spatial chunk.');ids.add(c.id);}
  const resident=new Map<string,{chunk:SpatialChunk<T>;resource:R}>(),clock=options.now??(()=>performance.now()),rescheduleDistance=options.rescheduleDistance??0;
  if(!Number.isFinite(rescheduleDistance)||rescheduleDistance<0)throw Error('Invalid reschedule distance.');
  let scheduledPosition:Point|undefined,distances:Array<{chunk:SpatialChunk<T>;distance:number}>=[],candidates:typeof distances=[];
  const stats={sourceChunks:options.chunks.length,residentChunks:0,pendingChunks:0,loadedChunks:0,unloadedChunks:0};
  let disposed=false;
  function update(position:Point,budget:{maxLoads?:number;milliseconds?:number}={}){
    if(disposed)return;
    if(position.length!==2||!position.every(Number.isFinite))throw Error('Invalid stream position.');
    const maxLoads=budget.maxLoads??1,milliseconds=budget.milliseconds??4;
    if(!Number.isSafeInteger(maxLoads)||maxLoads<0||!Number.isFinite(milliseconds)||milliseconds<0)throw Error('Invalid frame budget.');
    if(!scheduledPosition||Math.hypot(position[0]-scheduledPosition[0],position[1]-scheduledPosition[1])>=rescheduleDistance){
      scheduledPosition=[...position];
      distances=options.chunks.map(chunk=>({chunk,distance:boundsDistance(position,chunk.bounds)})).sort((a,b)=>a.distance-b.distance||a.chunk.id.localeCompare(b.chunk.id));
      candidates=distances.filter(c=>c.distance<=options.loadDistance).slice(0,options.maxResident);
    }
    const wanted=new Set(candidates.map(c=>c.chunk.id));
    // Retain nearby resources across cell boundaries, but evict far ones first
    // when the hard budget is needed for a closer, newly requested chunk.
    const pending=candidates.filter(c=>!resident.has(c.chunk.id));
    for(const {chunk,distance} of [...resident.values()].map(item=>({chunk:item.chunk,distance:boundsDistance(scheduledPosition!,item.chunk.bounds)})).sort((a,b)=>b.distance-a.distance)){
      const item=resident.get(chunk.id);if(!item)continue;
      if(distance>options.unloadDistance||(!wanted.has(chunk.id)&&resident.size+pending.length>options.maxResident)){
        options.unload(item.resource);resident.delete(chunk.id);stats.unloadedChunks++;
      }
    }
    const start=clock();let loads=0;
    for(const {chunk} of pending){
      if(loads>=maxLoads||resident.size>=options.maxResident||(loads>0&&clock()-start>=milliseconds))break;
      const resource=options.load(chunk);resident.set(chunk.id,{chunk,resource});loads++;stats.loadedChunks++;
    }
    stats.residentChunks=resident.size;stats.pendingChunks=candidates.filter(c=>!resident.has(c.chunk.id)).length;
  }
  function dispose(){if(disposed)return;disposed=true;for(const item of resident.values())options.unload(item.resource);resident.clear();stats.residentChunks=0;stats.pendingChunks=0;}
  return {update,dispose,stats,get resources(){return [...resident.values()].map(item=>item.resource);}};
}
