import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
export function createScooter(scene:Scene){
  const root=new TransformNode('motorino',scene);
  const mat=(name:string,hex:string)=>{const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(hex);m.specularColor.set(.25,.25,.25);return m;};
  const body=mat('smalto corallo','#c45f49'),black=mat('gomma','#283c40'),chrome=mat('cromature','#c8d2c9'),light=mat('faro','#fff4d2');
  function box(name:string,x:number,y:number,z:number,w:number,h:number,d:number,m:StandardMaterial){const mesh=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d},scene);mesh.parent=root;mesh.position.set(x,y,z);mesh.material=m;mesh.isPickable=false;return mesh;}
  const wheels=[];
  for(const z of [-.7,.7]){const tire=MeshBuilder.CreateCylinder('ruota',{diameter:.56,height:.17,tessellation:20},scene);tire.parent=root;tire.position.set(0,.3,z);tire.rotation.z=Math.PI/2;tire.material=black;tire.isPickable=false;wheels.push(tire);}
  const shell=MeshBuilder.CreateSphere('carrozzeria',{diameter:1,segments:12},scene);shell.parent=root;shell.scaling.set(.7,.65,1.05);shell.position.set(0,.65,-.42);shell.material=body;shell.isPickable=false;
  box('sella',0,1,-.36,.61,.14,.8,black);box('pedana',0,.39,.1,.65,.12,1.1,chrome);
  const shield=box('scudo',0,.76,.56,.64,.85,.15,body);shield.rotation.x=.2;
  box('manubrio',0,1.24,.55,.92,.08,.09,chrome);box('piantone',0,1.02,.61,.1,.5,.1,chrome);
  const headlight=MeshBuilder.CreateSphere('faro',{diameter:.28,segments:12},scene);headlight.parent=root;headlight.position.set(0,1.18,.72);headlight.material=light;headlight.isPickable=false;
  for(const side of [-1,1]){box('specchio',side*.49,1.6,.5,.17,.14,.07,chrome);box('asta specchio',side*.44,1.43,.5,.035,.34,.035,chrome);}
  box('fanale posteriore',0,.74,-.97,.25,.1,.03,body);box('portapacchi',0,1,-.98,.55,.05,.4,chrome);
  root.position.set(18,0,60);root.rotation.y=Math.PI;
  return {root,wheels,velocity:0,heading:Math.PI,spawn:new Vector3(18,0,60)};
}
export function stepVelocity(speed:number,throttle:number,dt:number):number {
  if(throttle>0)return Math.min(11,speed+dt*(speed<0?13:4.5));
  if(throttle<0)return Math.max(-3,speed-dt*(speed>0?15:3));
  return Math.abs(speed)<dt*1.7?0:speed-Math.sign(speed)*dt*1.7;
}
