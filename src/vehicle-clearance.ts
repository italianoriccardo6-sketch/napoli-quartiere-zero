import type {GroundCheck,GroundPoint} from './movement';
const finite=(...values:number[])=>values.every(Number.isFinite);
/** A sampled capsule along the whole car body, including its front/rear overhang. */
export function canStandForCar(position:GroundPoint,heading:number,worldCheck:GroundCheck,radius=.98,halfLength=2.225):boolean {
  if(!finite(position.x,position.z,heading,radius,halfLength)||radius<=0||halfLength<radius)return false;
  const extent=halfLength-radius,steps=Math.max(1,Math.ceil(extent*2/Math.min(radius*.45,.35)));
  const dx=Math.sin(heading),dz=Math.cos(heading);
  for(let i=0;i<=steps;i++){
    const offset=-extent+extent*2*i/steps;
    if(!worldCheck(position.x+dx*offset,position.z+dz*offset,radius))return false;
  }
  return true;
}

