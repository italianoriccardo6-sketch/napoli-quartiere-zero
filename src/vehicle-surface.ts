export interface VehicleSurfaceSize {halfLength:number;halfWidth:number}
export interface VehicleSurfacePose {
  height:number;pitch:number;roll:number;
  /** Sampled support heights, in front-left, front-right, rear-left, rear-right order. */
  supportHeights:readonly [number,number,number,number];
}

/**
 * Fit the visible car body to the rendered support surface. This is a static
 * four-corner plane fit, not a suspension or tyre-contact simulation. Its
 * rotation follows Babylon's yaw/pitch/roll convention (positive pitch lowers
 * the car's +Z front). The source horizontal position and heading stay intact.
 */
export function vehicleSurfacePose(
  x:number,z:number,heading:number,size:VehicleSurfaceSize,heightAt:(x:number,z:number)=>number,
):VehicleSurfacePose {
  const {halfLength,halfWidth}=size;
  if(![x,z,heading,halfLength,halfWidth].every(Number.isFinite)||halfLength<=0||halfWidth<=0)throw new TypeError('Posa o ingombro verticale del veicolo non valido.');
  const fx=Math.sin(heading),fz=Math.cos(heading),rx=fz,rz=-fx;
  const heights:number[]=[];
  for(const longitudinal of [1,-1])for(const lateral of [-1,1]){
    const y=heightAt(x+fx*halfLength*longitudinal+rx*halfWidth*lateral,z+fz*halfLength*longitudinal+rz*halfWidth*lateral);
    if(!Number.isFinite(y))throw new TypeError('Superficie verticale del veicolo non finita.');
    heights.push(y);
  }
  const [fl,fr,rl,rr]=heights,forwardSlope=(fl+fr-rl-rr)/(4*halfLength),rightSlope=(fr+rr-fl-rl)/(4*halfWidth);
  const pitch=-Math.atan(forwardSlope),roll=Math.atan(rightSlope*Math.cos(pitch));
  return {height:(fl+fr+rl+rr)/4,pitch,roll,supportHeights:heights as [number,number,number,number]};
}
