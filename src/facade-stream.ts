import type {Scene} from '@babylonjs/core/scene';
import type {MapData,Point} from './geo';
import {addFacadeDetail,type FacadeOptions} from './facade-detail';
import {boundsDistance,createSpatialStream,type SpatialChunk} from './spatial-stream';
const CELL=128;
/** One owner per measured building, including buildings which cross tile borders. */
export function facadeChunks(map:MapData):SpatialChunk<ReadonlySet<string>>[]{
  const groups=new Map<string,{bounds:[number,number,number,number];ids:Set<string>}>();
  for(const building of map.buildings){
    const ring=building.rings[0];if(!ring?.length)continue;
    const x0=Math.min(...ring.map(p=>p[0])),x1=Math.max(...ring.map(p=>p[0])),z0=Math.min(...ring.map(p=>p[1])),z1=Math.max(...ring.map(p=>p[1]));
    const x=Math.floor((x0+x1)/2/CELL),z=Math.floor((z0+z1)/2/CELL),id=x+','+z;
    const group=groups.get(id)??{bounds:[x*CELL,z*CELL,(x+1)*CELL,(z+1)*CELL],ids:new Set<string>()};
    group.bounds=[Math.min(group.bounds[0],x0),Math.min(group.bounds[1],z0),Math.max(group.bounds[2],x1),Math.max(group.bounds[3],z1)];
    group.ids.add(building.id);groups.set(id,group);
  }
  return [...groups].map(([id,group])=>({id,bounds:group.bounds,value:group.ids}));
}
/** Generate nearby facades as exploration moves, instead of decorating only the original mission. */
export function createFacadeStream(scene:Scene,map:MapData,options:FacadeOptions){
  let quality=options.quality,position:Point=options.focus[0]??[0,0];
  const chunks=facadeChunks(map);
  const stats={regeneratedChunks:0};
  function detail(chunk:SpatialChunk<ReadonlySet<string>>){return addFacadeDetail(scene,map,{...options,focus:[position],radius:300,quality,includeBuildingIds:chunk.value,maxInstances:quality==='alta'?9000:3000,maxBuildings:32});}
  const makeStream=()=>createSpatialStream({chunks,loadDistance:160,unloadDistance:300,maxResident:12,rescheduleDistance:12,
    load(chunk){return {chunk,detail:detail(chunk),focus:[...position] as Point};},
    unload(resource){resource.detail.dispose();}});
  let stream=makeStream();
  // Initial street before the start screen. Further chunks get one frame at a time.
  stream.update(position,{maxLoads:3,milliseconds:12});
  function update(next:Point,nextQuality:'alta'|'bassa'){
    position=next;
    if(nextQuality!==quality){quality=nextQuality;stream.dispose();stream=makeStream();}
    // A source building can be much longer than its ownership cell. Likewise,
    // a dense cell can exhaust its instance budget. In either case the detail
    // generated near the old view does not cover every later approach. Refresh
    // one nearby resource after movement, without allocating an additional cell
    // in that frame. The source footprint/collision index never changes.
    const stale=stream.resources.filter(resource=>{
      const b=resource.chunk.bounds;
      return (b[2]-b[0]>CELL*2||b[3]-b[1]>CELL*2||resource.detail.stats.budgetReached)
        &&boundsDistance(position,b)<=160&&Math.hypot(position[0]-resource.focus[0],position[1]-resource.focus[1])>=48;
    }).sort((a,b)=>boundsDistance(position,a.chunk.bounds)-boundsDistance(position,b.chunk.bounds)||a.chunk.id.localeCompare(b.chunk.id))[0];
    // Evict first; a teleported view should not rebuild a resource it is about
    // to discard. Its identity is checked again after the scheduler update.
    stream.update(position,{maxLoads:stale?0:1,milliseconds:4});
    if(stale&&stream.resources.includes(stale)){
      const replacement=detail(stale.chunk);stale.detail.dispose();stale.detail=replacement;stale.focus=[...position];stats.regeneratedChunks++;
    }
    for(const resource of stream.resources)resource.detail.update(position,quality);
    return true;
  }
  return {update,dispose(){stream.dispose();},get stats(){return {...stream.stats,...stats};}};
}
