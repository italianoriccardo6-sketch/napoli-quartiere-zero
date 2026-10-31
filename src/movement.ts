export interface GroundPoint {x:number;z:number}
export interface GroundMove {collision:boolean;distance:number}
export type GroundCheck=(x:number,z:number,radius:number)=>boolean;
const finite=(...values:number[])=>values.every(Number.isFinite);

/** Unit direction in the horizontal plane, with positive strafe matching camera-right. */
export function walkingDirection(cameraYaw:number,forward:number,strafe:number):GroundPoint {
  if(!finite(cameraYaw,forward,strafe))throw new RangeError('Direzione di movimento non valida.');
  const heading=cameraYaw+Math.PI;
  const x=Math.sin(heading)*forward+Math.cos(heading)*strafe;
  const z=Math.cos(heading)*forward-Math.sin(heading)*strafe;
  const length=Math.hypot(x,z);
  if(!finite(x,z,length))throw new RangeError('Direzione di movimento fuori intervallo.');
  return length>0?{x:x/length,z:z/length}:{x:0,z:0};
}

/**
 * Move the supplied position in bounded horizontal steps. Walking can slide along
 * one axis at a wall; vehicles stop at the first blocked step. Distance is the
 * actual horizontal displacement, not an assertion that the requested move ran.
 */
export function moveOnGround(position:GroundPoint,delta:GroundPoint,radius:number,canStand:GroundCheck,slide=true,maxStep=.2):GroundMove {
  if(!finite(position.x,position.z,delta.x,delta.z,radius,maxStep)||radius<0||maxStep<=0)throw new RangeError('Passo di movimento non valido.');
  const length=Math.hypot(delta.x,delta.z);
  if(!Number.isFinite(length))throw new RangeError('Spostamento fuori intervallo.');
  if(length===0)return {collision:false,distance:0};
  const count=Math.max(1,Math.ceil(length/Math.min(maxStep,.2)));
  if(count>10000)throw new RangeError('Spostamento troppo ampio per un singolo aggiornamento.');
  const startX=position.x,startZ=position.z,dx=delta.x/count,dz=delta.z/count;
  let collision=false;
  for(let i=0;i<count;i++){
    if(canStand(position.x+dx,position.z+dz,radius)){
      position.x+=dx;position.z+=dz;
    }else{
      collision=true;
      if(!slide)break;
      if(canStand(position.x+dx,position.z,radius))position.x+=dx;
      if(canStand(position.x,position.z+dz,radius))position.z+=dz;
    }
  }
  return {collision,distance:Math.hypot(position.x-startX,position.z-startZ)};
}
