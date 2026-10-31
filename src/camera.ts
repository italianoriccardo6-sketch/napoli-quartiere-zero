import {FreeCamera} from '@babylonjs/core/Cameras/freeCamera';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Ray} from '@babylonjs/core/Culling/ray';
import {Scene} from '@babylonjs/core/scene';
export function createCamera(scene:Scene){
  const camera=new FreeCamera('terza persona',new Vector3(115,95,155),scene);camera.minZ=.15;camera.maxZ=2400;camera.fov=.82;camera.setTarget(new Vector3(0,0,5));
  let yaw=.4,pitch=.36;
  return {camera,get yaw(){return yaw;},rotate(dx:number,dy:number){yaw-=dx*.003;pitch=Math.max(.12,Math.min(.95,pitch+dy*.002));},
    update(position:Vector3,dt:number,riding:boolean){
      const target=position.add(new Vector3(0,1.4,0)),distance=riding?8.4:6;
      const offset=new Vector3(Math.sin(yaw)*distance,2+pitch*6,Math.cos(yaw)*distance);
      const ray=new Ray(target,offset.normalizeToNew(),offset.length());
      const hit=scene.pickWithRay(ray,m=>m.metadata?.solid===true);
      let desired=target.add(offset);
      if(hit?.hit&&hit.distance>0)desired=target.add(offset.normalizeToNew().scale(Math.max(.7,hit.distance-.4)));
      camera.position=Vector3.Lerp(camera.position,desired,1-Math.exp(-dt*9));camera.setTarget(target);
    },snap(position:Vector3){camera.position=position.add(new Vector3(3,4,6));}
  };
}
