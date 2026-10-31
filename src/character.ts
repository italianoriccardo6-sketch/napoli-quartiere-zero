import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Scene} from '@babylonjs/core/scene';
export function createCharacter(scene:Scene) {
  const root=new TransformNode('Luca Serra',scene);
  function material(name:string,hex:string){const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(hex);m.specularColor.set(.04,.04,.04);return m;}
  const jacket=material('giacca di Luca','#38454a'),shirt=material('maglia di Luca','#b9b6a6'),skin=material('pelle','#ba8c73'),denim=material('denim','#273443'),leather=material('pelle scarpe','#302a26'),hair=material('capelli','#292621');
  function ellipsoid(name:string,parent:TransformNode,x:number,y:number,z:number,w:number,h:number,d:number,mat:StandardMaterial){const m=MeshBuilder.CreateSphere(name,{diameter:1,segments:12},scene);m.parent=parent;m.position.set(x,y,z);m.scaling.set(w,h,d);m.material=mat;m.isPickable=false;return m;}
  ellipsoid('bacino',root,0,.91,0,.44,.29,.29,denim);ellipsoid('giacca',root,0,1.25,0,.58,.69,.34,jacket);
  ellipsoid('maglia',root,0,1.31,.153,.26,.42,.025,shirt);ellipsoid('collo',root,0,1.61,0,.15,.2,.16,skin);
  ellipsoid('testa',root,0,1.77,.015,.31,.39,.3,skin);ellipsoid('capelli',root,0,1.9,-.025,.32,.19,.31,hair);ellipsoid('naso',root,0,1.76,.17,.07,.10,.085,skin);
  const legs:TransformNode[]=[],arms:TransformNode[]=[];
  for(const side of [-1,1]){
    const leg=new TransformNode('anca',scene);leg.parent=root;leg.position.set(side*.135,.9,0);legs.push(leg);
    ellipsoid('gamba',leg,0,-.37,0,.21,.78,.24,denim);ellipsoid('scarpa',leg,0,-.81,.055,.22,.15,.36,leather);
    const arm=new TransformNode('spalla',scene);arm.parent=root;arm.position.set(side*.31,1.49,0);arms.push(arm);
    ellipsoid('manica',arm,side*.025,-.24,0,.19,.59,.22,jacket);ellipsoid('mano',arm,side*.025,-.57,.025,.14,.19,.14,skin);
  }
  const parcel=ellipsoid('custodia del telefono',root,0,1.18,-.2,.32,.38,.10,leather);parcel.setEnabled(false);
  function animate(time:number,moving:boolean,riding:boolean){
    const gait=moving?Math.sin(time*10)*.48:0;
    legs.forEach((l,i)=>{l.rotation.x=riding?-.95:gait*(i?1:-1);l.rotation.z=riding?(i?.16:-.16):0;});
    arms.forEach((a,i)=>{a.rotation.x=riding?-1.15:gait*(i?-1:1)*.65;a.rotation.z=(i?.08:-.08);});
    root.rotation.z=moving&&!riding?Math.sin(time*10)*.012:0;
  }
  return {root,animate,parcel};
}
