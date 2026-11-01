import '@babylonjs/core/Meshes/thinInstanceMesh';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {Material} from '@babylonjs/core/Materials/material';
import {PBRMaterial} from '@babylonjs/core/Materials/PBR/pbrMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Matrix,Quaternion,Vector3} from '@babylonjs/core/Maths/math.vector';
import {inside,segmentDistance,type MapData,type Point,type Footprint} from './geo';

export type FacadeRole='trim'|'plinth'|'glass'|'shutter'|'iron'|'door'|'shop';
export type FacadeQuality='alta'|'bassa';
export interface FacadeOptions {
  focus:Point[];
  radius:number;
  quality:FacadeQuality;
  maxBuildings?:number;
  maxInstances?:number;
  materials?:Partial<Record<FacadeRole,Material>>;
  /** Buildings with verified photo fronts can keep their original architecture visible. */
  excludeBuildingIds?:ReadonlySet<string>;
  /** Photo fronts replace only these source edges; other sides keep their detail. */
  excludeEdges?:ReadonlyMap<string,ReadonlySet<number>>;
  /** The same inferred flat foundation used by the building volume. */
  buildingBaseHeight?:(buildingId:string)=>number;
}
export interface FacadePart {
  buildingId:string;
  role:FacadeRole;
  feature:'window'|'shutter'|'sill'|'cornice'|'plinth'|'balcony'|'rail'|'door'|'shopfront'|'parapet';
  x:number;y:number;z:number;
  width:number;height:number;depth:number;yaw:number;
}
export interface FacadeStats {
  selectedBuildings:number;
  detailedBuildings:number;
  skippedLandmarks:number;
  windows:number;
  balconies:number;
  shopfronts:number;
  instances:number;
  batches:number;
  budgetReached:boolean;
  representation:'inferred-facade-detail-not-surveyed';
}
export interface FacadePlan {parts:FacadePart[];stats:FacadeStats}
interface Entry {building:Footprint;bounds:[number,number,number,number];distance:number}
const TILE=96;
function bounds(ring:Point[]):[number,number,number,number]{return [Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))];}
function distanceToBounds(p:Point,b:readonly number[]){return Math.hypot(Math.max(b[0]-p[0],0,p[0]-b[2]),Math.max(b[1]-p[1],0,p[1]-b[3]));}
const area=(ring:Point[])=>ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p[0]*q[1]-q[0]*p[1];},0)/2;
function hash(text:string){let value=2166136261;for(const c of text)value=Math.imul(value^c.charCodeAt(0),16777619)>>>0;return value;}
function solidAt(p:Point,b:Footprint){return inside(p,b.rings[0])&&!b.rings.slice(1).some(r=>inside(p,r));}

/**
 * An original Mediterranean facade kit placed on the measured OSM outside walls.
 * Window/door positions, floor spacing and balcony styles are inferred art, NOT
 * a survey or photographs of these individual Naples buildings. No footprint,
 * courtyard, height or gameplay collider is changed by this module.
 */
export function planFacadeDetail(map:MapData,options:FacadeOptions):FacadePlan {
  if(!Number.isFinite(options.radius)||options.radius<0||options.focus.some(p=>!p.every(Number.isFinite)))throw new RangeError('Area dettagli facciata non valida.');
  const maximumBuildings=Math.max(0,Math.min(160,Math.floor(options.maxBuildings??(options.quality==='alta'?100:36))));
  const maximumParts=Math.max(0,Math.min(80000,Math.floor(options.maxInstances??(options.quality==='alta'?60000:18000))));
  const entries:Entry[]=map.buildings.filter(b=>b.rings[0]?.length>=3&&b.rings[0].every(p=>p.every(Number.isFinite)))
    .map(building=>{const b=bounds(building.rings[0]);return {building,bounds:b,distance:Math.min(...options.focus.map(p=>distanceToBounds(p,b)))};});
  // Nearby buildings are indexed only for rejecting decorative overhangs into other solids.
  const grid=new Map<string,Entry[]>();
  for(const entry of entries){const b=entry.bounds;for(let x=Math.floor(b[0]/32);x<=Math.floor(b[2]/32);x++)for(let z=Math.floor(b[1]/32);z<=Math.floor(b[3]/32);z++){const key=x+','+z,list=grid.get(key)??[];list.push(entry);grid.set(key,list);}}
  const clear=(p:Point)=>!(grid.get(Math.floor(p[0]/32)+','+Math.floor(p[1]/32))??[]).some(entry=>solidAt(p,entry.building));
  const rectangleClear=(center:Point,width:number,depth:number,yaw:number,ownId:string)=>{
    const tx=Math.cos(yaw),tz=-Math.sin(yaw),nx=-tz,nz=tx;
    const rectangle:Point[]=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>[center[0]+tx*u*width/2+nx*v*depth/2,center[1]+tz*u*width/2+nz*v*depth/2]);
    const box=bounds(rectangle),nearby=new Set<Entry>();
    for(let x=Math.floor(box[0]/32);x<=Math.floor(box[2]/32);x++)for(let z=Math.floor(box[1]/32);z<=Math.floor(box[3]/32);z++)for(const entry of grid.get(x+','+z)??[])nearby.add(entry);
    const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const cuts=(a:Point,b:Point,c:Point,d:Point)=>cross(a,b,c)*cross(a,b,d)<-1e-10&&cross(c,d,a)*cross(c,d,b)<-1e-10;
    for(const entry of nearby){
      if(entry.building.id===ownId||box[0]>entry.bounds[2]||box[2]<entry.bounds[0]||box[1]>entry.bounds[3]||box[3]<entry.bounds[1])continue;
      if(rectangle.some(p=>solidAt(p,entry.building))||entry.building.rings[0].some(p=>inside(p,rectangle)))return false;
      for(const r of entry.building.rings)for(let i=0;i<r.length;i++)for(let j=0;j<4;j++)if(cuts(r[i],r[(i+1)%r.length],rectangle[j],rectangle[(j+1)%4]))return false;
    }
    return true;
  };
  const stats:FacadeStats={selectedBuildings:0,detailedBuildings:0,skippedLandmarks:0,windows:0,balconies:0,shopfronts:0,instances:0,batches:0,budgetReached:false,representation:'inferred-facade-detail-not-surveyed'};
  const priority=options.focus[0];
  const priorityDistance=(building:Footprint)=>priority?Math.min(...building.rings[0].map((a,i)=>segmentDistance(priority,a,building.rings[0][(i+1)%building.rings[0].length]))):Infinity;
  // The whole route controls eligibility; the actual starting/player point controls
  // priority. A distant hotel beside another route vertex must not starve the first street.
  const selected=entries.filter(e=>e.distance<=options.radius&&!options.excludeBuildingIds?.has(e.building.id)).sort((a,b)=>priorityDistance(a.building)-priorityDistance(b.building)||a.distance-b.distance||a.building.id.localeCompare(b.building.id));
  const parts:FacadePart[]=[],deferredLouvers:FacadePart[]=[];
  const perBuildingLimit=Math.min(maximumParts,options.quality==='alta'?4000:1400),buildingCounts=new Map<string,number>();
  let stop=false;
  for(const entry of selected){
    if(stats.selectedBuildings>=maximumBuildings||stop)break;
    const building=entry.building;
    // Recognisable named monuments require their own measured/cleared assets.
    if(building.name&&/\b(castel|castello|basilica|chiesa|cattedrale|duomo|palazzo reale|san carlo)\b/i.test(building.name)){stats.skippedLandmarks++;continue;}
    if(!Number.isFinite(building.height)||building.height<3.4)continue;
    const base=options.buildingBaseHeight?options.buildingBaseHeight(building.id):0;
    if(!Number.isFinite(base))throw new RangeError('Quota della base facciata non finita: '+building.id);
    stats.selectedBuildings++;
    const startCount=parts.length,ring=building.rings[0],orientation=Math.sign(area(ring));if(!orientation)continue;
    let buildingStop=false;
    const floors=Math.max(1,Math.min(10,Math.floor(building.height/3.2))),floorHeight=building.height/floors;
    const variant=hash(building.id);
    const orderedEdges=ring.map((_,i)=>i).sort((a,b)=>priority?segmentDistance(priority,ring[a],ring[(a+1)%ring.length])-segmentDistance(priority,ring[b],ring[(b+1)%ring.length])||a-b:a-b);
    for(const edge of orderedEdges){
      if(options.excludeEdges?.get(building.id)?.has(edge))continue;
      const a=ring[edge],b=ring[(edge+1)%ring.length],dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz);if(length<2.8||Math.min(...options.focus.map(p=>segmentDistance(p,a,b)))>options.radius)continue;
      const tx=dx/length,tz=dz/length,nx=orientation*tz,nz=-orientation*tx,yaw=-Math.atan2(tz,tx);
      const point=(along:number,out:number):Point=>[a[0]+tx*along+nx*out,a[1]+tz*along+nz*out];
      const budget=(count:number)=>{if(parts.length+count>maximumParts){stats.budgetReached=true;stop=true;return false;}if(parts.length-startCount+count>perBuildingLimit){stats.budgetReached=true;buildingStop=true;return false;}return true;};
      const emit=(along:number,y:number,out:number,width:number,height:number,depth:number,role:FacadeRole,feature:FacadePart['feature'],defer=false)=>{
        const p=point(along,out);if(!clear(p)||!rectangleClear(p,width,depth,yaw,building.id))return;
        (defer?deferredLouvers:parts).push({buildingId:building.id,role,feature,x:p[0],y:y+base,z:p[1],width,height,depth,yaw});
      };
      // Party walls are left alone; details are only on open outer facades.
      if(!clear(point(length/2,.28)))continue;
      if(!budget(4))break;
      emit(length/2,.37,.055,length-.05,.74,.11,'plinth','plinth');
      emit(length/2,building.height-.18,.14,length+.04,.24,.27,'trim','cornice');
      emit(length/2,building.height+.26,.07,length-.08,.52,.14,'plinth','parapet');
      emit(length/2,building.height+.55,.13,length+.06,.09,.25,'trim','cornice');
      const bays=Math.max(1,Math.min(24,Math.floor((length-.9)/3.1))),spacing=(length-.9)/bays;
      for(let floor=0;floor<floors&&!stop&&!buildingStop;floor++){
        const bottom=floor*floorHeight;
        if(floor>0){if(!budget(1))break;emit(length/2,bottom+.02,.075,length-.1,.10,.15,'trim','cornice');}
        for(let bay=0;bay<bays;bay++){
          if(!budget(40))break;
          const along=.45+spacing*(bay+.5),style=hash(building.id+':'+edge+':'+bay+':'+floor);
          const wallPoint=point(along,0),bayDistance=Math.min(...options.focus.map(p=>Math.hypot(p[0]-wallPoint[0],p[1]-wallPoint[1])));if(bayDistance>options.radius)continue;
          if(!clear(point(along,.28)))continue;
          const width=Math.min(1.22,spacing*.48),height=Math.min(1.96,floorHeight*.61);
          const bottomY=bottom+(floor===0?.88:.76),centerY=bottomY+height/2;
          const doorway=floor===0&&bay===Math.floor(bays/2)&&length>4.5;
          if(doorway){
            const shop=(variant+edge)%3===0,doorWidth=Math.min(spacing*.74,shop?2.05:1.55),doorHeight=Math.min(floorHeight-.15,2.75),top=doorHeight+.08;
            emit(along,doorHeight/2,.045,doorWidth,doorHeight,.08,shop?'shop':'door',shop?'shopfront':'door');
            emit(along-doorWidth/2-.09,doorHeight/2,.14,.17,doorHeight+.25,.28,'trim','door');emit(along+doorWidth/2+.09,doorHeight/2,.14,.17,doorHeight+.25,.28,'trim','door');
            emit(along,top,.14,doorWidth+.34,.20,.28,'trim','door');
            emit(along,.09,.15,doorWidth+.30,.16,.3,'plinth','door');
            if(shop){emit(along,doorHeight-.38,.11,doorWidth-.10,.07,.14,'iron','shopfront');emit(along,doorHeight/2,.11,.06,doorHeight-.1,.14,'iron','shopfront');stats.shopfronts++;}
            else {emit(along,doorHeight*.36,.10,.07,.10,.1,'iron','door');emit(along,doorHeight*.66,.10,.07,.10,.1,'iron','door');}
            continue;
          }
          // The dark inset, masonry reveal, mullion and shutters are real geometry.
          emit(along,centerY,.035,width,height,.055,'glass','window');
          emit(along-width/2-.065,centerY,.12,.13,height+.19,.24,'trim','window');emit(along+width/2+.065,centerY,.12,.13,height+.19,.24,'trim','window');
          emit(along,bottomY+height+.08,.12,width+.25,.16,.24,'trim','window');emit(along,bottomY-.05,.23,width+.36,.14,.46,'trim','sill');
          emit(along,centerY,.075,.055,height,.09,'trim','window');emit(along,centerY+.06,.075,width,.045,.09,'trim','window');
          const shutterWidth=Math.min(.43,spacing*.19);
          for(const side of [-1,1]){
            const offset=side*(width/2+.18+shutterWidth/2);
            emit(along+offset,centerY,.10,shutterWidth,height+.10,.14,'shutter','shutter');
            if(options.quality==='alta'&&bayDistance<55){
              // Fine slats use only the budget left after structural detail on all
              // selected buildings, so one long wall cannot consume the street.
              for(let line=1;line<=4;line++)emit(along+offset,bottomY+height*line/5,.19,shutterWidth*.90,.037,.045,'iron','shutter',true);
            }
          }
          stats.windows++;
          // Raised balconies cannot obstruct a walking/scooter corridor at ground level.
          if(floor>0&&style%4===0&&clear(point(along,.95))&&rectangleClear(point(along,.43),width+.62,.86,yaw,building.id)){
            const balconyWidth=width+.62,balconyY=bottomY-.18;
            emit(along,balconyY,.43,balconyWidth,.16,.86,'trim','balcony');
            emit(along,balconyY+.93,.81,balconyWidth,.055,.055,'iron','rail');
            for(let bar=0;bar<7;bar++)emit(along-balconyWidth/2+bar*balconyWidth/6,balconyY+.48,.81,.035,.91,.035,'iron','rail');
            for(const side of[-1,1]){emit(along+side*balconyWidth/2,balconyY+.93,.43,.055,.055,.76,'iron','rail');}
            stats.balconies++;
          }
        }
      }
      if(stop||buildingStop)break;
    }
    buildingCounts.set(building.id,parts.length-startCount);
    if(parts.length>startCount)stats.detailedBuildings++;
  }
  // Near-player louvers take priority when any fine-detail budget remains.
  if(priority)deferredLouvers.sort((a,b)=>Math.hypot(a.x-priority[0],a.z-priority[1])-Math.hypot(b.x-priority[0],b.z-priority[1]));
  for(const part of deferredLouvers){
    if(parts.length>=maximumParts){stats.budgetReached=true;break;}
    const count=buildingCounts.get(part.buildingId)??0;if(count>=perBuildingLimit)continue;
    parts.push(part);buildingCounts.set(part.buildingId,count+1);
  }
  stats.instances=parts.length;
  return {parts,stats};
}

/** Thin-instance geometry is batched by 96 m tile/material; it never becomes a collider. */
export function addFacadeDetail(scene:Scene,map:MapData,options:FacadeOptions){
  const plan=planFacadeDetail(map,options),ownedMaterials:Material[]=[],materials=new Map<FacadeRole,Material>();
  const definitions:Record<FacadeRole,{color:string;roughness:number;metallic:number}>={trim:{color:'#d3c5aa',roughness:.8,metallic:0},plinth:{color:'#a79a82',roughness:.9,metallic:0},glass:{color:'#263d49',roughness:.16,metallic:0},shutter:{color:'#31564a',roughness:.66,metallic:0},iron:{color:'#293332',roughness:.52,metallic:.72},door:{color:'#544334',roughness:.73,metallic:0},shop:{color:'#1a2d31',roughness:.20,metallic:0}};
  for(const [role,definition]of Object.entries(definitions) as [FacadeRole,typeof definitions[FacadeRole]][]){
    const external=options.materials?.[role];if(external){materials.set(role,external);continue;}
    const material=new PBRMaterial('facciata inferita · '+role,scene);material.albedoColor=Color3.FromHexString(definition.color);material.roughness=definition.roughness;material.metallic=definition.metallic;materials.set(role,material);ownedMaterials.push(material);
  }
  const batches=new Map<string,FacadePart[]>();
  for(const part of plan.parts){const key=Math.floor(part.x/TILE)+','+Math.floor(part.z/TILE)+','+part.role+','+(part.feature==='shutter'&&part.role==='iron'?'fine':'structure');const batch=batches.get(key)??[];batch.push(part);batches.set(key,batch);}
  const meshes:Mesh[]=[],meshBounds=new Map<Mesh,[number,number,number,number]>();
  const matrix=Matrix.Identity(),scale=new Vector3(),position=new Vector3();
  for(const [key,parts]of batches){
    const mesh=MeshBuilder.CreateBox('dettagli facciata '+key,{size:1},scene);mesh.material=materials.get(parts[0].role)!;mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=true;mesh.metadata={solid:false,facadeDetail:true,inferred:true,instances:parts.length,fine:parts[0].feature==='shutter'&&parts[0].role==='iron'};
    const buffer=new Float32Array(parts.length*16);
    for(let i=0;i<parts.length;i++){const p=parts[i];scale.set(p.width,p.height,p.depth);position.set(p.x,p.y,p.z);Matrix.ComposeToRef(scale,Quaternion.RotationYawPitchRoll(p.yaw,0,0),position,matrix);matrix.copyToArray(buffer,i*16);}
    mesh.thinInstanceSetBuffer('matrix',buffer,16,true);mesh.thinInstanceRefreshBoundingInfo();meshes.push(mesh);
    const b=mesh.getBoundingInfo().boundingBox;meshBounds.set(mesh,[b.minimum.x,b.minimum.z,b.maximum.x,b.maximum.z]);
  }
  plan.stats.batches=meshes.length;
  function update(position:Point,quality:FacadeQuality=options.quality){const range=quality==='alta'?240:135;for(const mesh of meshes)mesh.setEnabled((quality==='alta'||!mesh.metadata.fine)&&distanceToBounds(position,meshBounds.get(mesh)!)<=(mesh.metadata.fine?90:range));}
  if(options.focus[0])update(options.focus[0]);
  return {meshes,stats:plan.stats,update,dispose(){for(const mesh of meshes)mesh.dispose(false,false);for(const material of ownedMaterials)material.dispose();}};
}
