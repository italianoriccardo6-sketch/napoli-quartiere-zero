import type {Footprint} from './geo';

/**
 * A flat, inferred foundation reaches the lowest rendered ground along the
 * unchanged outer footprint. Sampling cannot establish the building's real
 * foundation, floor datum, retaining walls or absolute roof elevation.
 */
export function buildingGroundBases(buildings:readonly Footprint[],heightAt:(x:number,z:number)=>number,spacing=5){
  if(!Number.isFinite(spacing)||spacing<=0)throw new RangeError('Passo delle fondazioni non valido.');
  const bases=new Map<string,number>();let samples=0;
  for(const building of buildings){
    const ring=building.rings[0];if(!ring||ring.length<3)throw new TypeError('Sagoma della fondazione non valida.');
    let base=Infinity;
    for(let i=0;i<ring.length;i++){
      const a=ring[i],b=ring[(i+1)%ring.length];if(![...a,...b].every(Number.isFinite))throw new TypeError('Vertice della fondazione non finito.');
      const count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/spacing));
      if(samples+count>1_000_000)throw new RangeError('Budget delle fondazioni superato.');
      for(let j=0;j<count;j++){
        const y=heightAt(a[0]+(b[0]-a[0])*j/count,a[1]+(b[1]-a[1])*j/count);if(!Number.isFinite(y))throw new TypeError('Quota della fondazione non finita.');
        base=Math.min(base,y);samples++;
      }
    }
    bases.set(building.id,base);
  }
  return {heightAt:(id:string)=>bases.get(id)??0,stats:{buildings:bases.size,samples,spacingMetres:spacing,policy:'inferred-flat-foundation-at-lowest-rendered-outer-footprint-sample' as const}};
}
