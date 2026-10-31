import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
export function createCharacter(scene:Scene) {
  const root=new TransformNode('corriere',scene);
  function material(name:string,hex:string){const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(hex);m.specularColor.set(.05,.05,.05);return m;}
  const shirt=material('camicia del corriere','#efc46f'),skin=material('pelle','#bd896a'),pants=material('pantaloni','#344e65'),shoes=material('scarpe','#eee7d4');
  function part(name:string,size:Vector3,pos:Vector3,mat:StandardMaterial){const m=MeshBuilder.CreateBox(name,{width:size.x,height:size.y,depth:size.z},scene);m.parent=root;m.position=pos;m.material=mat;m.isPickable=false;return m;}
  part('busto',new Vector3(.56,.66,.32),new Vector3(0,1.2,0),shirt);
  const head=MeshBuilder.CreateSphere('testa',{diameter:.38,segments:8},scene);head.position.set(0,1.76,0);head.parent=root;head.material=skin;head.isPickable=false;
  const hair=part('capelli',new Vector3(.34,.15,.32),new Vector3(0,1.91,-.03),pants);
  hair.rotation.z=.12;
  const legs:Mesh[]=[],arms:Mesh[]=[];
  for(const side of [-1,1]){
    legs.push(part('gamba',new Vector3(.2,.68,.23),new Vector3(side*.16,.45,0),pants));
    part('scarpa',new Vector3(.23,.14,.37),new Vector3(side*.16,.08,.06),shoes);
    arms.push(part('braccio',new Vector3(.18,.62,.2),new Vector3(side*.37,1.17,0),shirt));
  }
  const parcel=part('borsa consegne',new Vector3(.45,.45,.25),new Vector3(0,1.16,-.28),material('borsa','#b8674d'));parcel.setEnabled(false);
  function animate(time:number,moving:boolean,riding:boolean){
    legs.forEach((l,i)=>l.rotation.x=riding?-.8:moving?Math.sin(time*10+i*Math.PI)*.55:0);
    arms.forEach((a,i)=>a.rotation.x=riding?-1.1:moving?Math.sin(time*10+i*Math.PI+Math.PI)*.35:0);
  }
  return {root,animate,parcel};
}
