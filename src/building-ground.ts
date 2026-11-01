import type {Footprint} from './geo';

export interface BuildingGroundOptions {
  /** True only where every footprint sample has supported source terrain. */
  supportedForHeightEstimate?:(x:number,z:number)=>boolean;
  roofClearance?:number;
  maximumRenderHeight?:number;
}
/**
 * A flat, inferred foundation reaches the lowest rendered ground along the
 * unchanged outer footprint. Sampling cannot establish the building's real
 * foundation, floor datum, retaining walls or absolute roof elevation.
 * A separately enabled render-height estimate may clear supported uphill
 * terrain only for source-unknown heights; it never changes the source data.
 */
export function buildingGroundBases(buildings:readonly Footprint[],heightAt:(x:number,z:number)=>number,spacing=5,options:BuildingGroundOptions={}){
  if(!Number.isFinite(spacing)||spacing<=0)throw new RangeError('Passo delle fondazioni non valido.');
  const sampleSpacing=Math.min(spacing,5),roofClearance=options.roofClearance??3.2,maximumRenderHeight=options.maximumRenderHeight??60;
  if(!Number.isFinite(roofClearance)||roofClearance<=0||!Number.isFinite(maximumRenderHeight)||maximumRenderHeight<=0||maximumRenderHeight>60)throw new RangeError('Limiti della stima artistica di altezza non validi.');
  const bases=new Map<string,number>(),renderHeights=new Map<string,number>();let samples=0,adjustedRenderHeights=0,unsupportedEstimates=0,unsupportedHeightAdjustments=0,rejectedHeightLimit=0;
  for(const building of buildings){
    const ring=building.rings[0];if(!ring||ring.length<3)throw new TypeError('Sagoma della fondazione non valida.');
    const sourceHeight=Number.isFinite(building.height)&&building.height>0?building.height:10;
    let base=Infinity,maxGround=-Infinity,allSupported=!!options.supportedForHeightEstimate;
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];if(![...a,...b].every(Number.isFinite))throw new TypeError('Vertice della fondazione non finito.');
      const count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/sampleSpacing));
      if(samples+count>1_000_000)throw new RangeError('Budget delle fondazioni superato.');
      for(let j=0;j<count;j++){
        const x=a[0]+(b[0]-a[0])*j/count,z=a[1]+(b[1]-a[1])*j/count,y=heightAt(x,z);if(!Number.isFinite(y))throw new TypeError('Quota della fondazione non finita.');
        base=Math.min(base,y);maxGround=Math.max(maxGround,y);samples++;
        if(building.estimated===true&&options.supportedForHeightEstimate&&options.supportedForHeightEstimate(x,z)!==true)allSupported=false;
      }
    }
    bases.set(building.id,base);
    let renderHeight=sourceHeight;
    if(building.estimated===true){
      const candidate=Math.max(sourceHeight,maxGround-base+roofClearance);
      if(!allSupported){unsupportedEstimates++;if(candidate>sourceHeight)unsupportedHeightAdjustments++;}
      else{
        if(candidate>maximumRenderHeight)rejectedHeightLimit++;
        else if(candidate>sourceHeight){renderHeight=candidate;adjustedRenderHeights++;}
      }
    }
    renderHeights.set(building.id,renderHeight);
  }
  return {heightAt:(id:string)=>bases.get(id)??0,renderHeightAt:(id:string)=>renderHeights.get(id)??10,stats:{buildings:bases.size,samples,spacingMetres:sampleSpacing,policy:'inferred-flat-foundation-at-lowest-rendered-outer-footprint-sample' as const,adjustedRenderHeights,unsupportedEstimates,unsupportedHeightAdjustments,rejectedHeightLimit,roofClearanceMetres:roofClearance,maximumRenderHeightMetres:maximumRenderHeight,renderHeightPolicy:'artistic-terrain-clearance-for-fully-supported-estimated-buildings-only' as const,sourceHeightsModified:false as const}};
}
