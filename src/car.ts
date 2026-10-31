import {Scene} from '@babylonjs/core/scene';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {ImportMeshAsync} from '@babylonjs/core/Loading/sceneLoader';
import {registerBuiltInLoaders} from '@babylonjs/loaders/dynamic';
import {TransmissionHelper,type ITransmissionHelperHolder} from '@babylonjs/loaders/glTF/2.0/Extensions/transmissionHelper';
import type {AbstractMesh} from '@babylonjs/core/Meshes/abstractMesh';
import type {GroundCheck,GroundPoint} from './movement';

export interface CarDimensions {radius:number;halfLength:number;width:number;length:number;height:number}
export interface Car {
  root:TransformNode;
  /** Identity-rotation wrappers around the source wheel pivots; spin around local X. */
  wheels:TransformNode[];
  velocity:number;
  heading:number;
  spawn:Vector3;
  ready:Promise<void>;
  kind:'auto';
  radius:number;
  halfLength:number;
}
const finite=(...numbers:number[])=>numbers.every(Number.isFinite);
function updateHierarchy(pivot:TransformNode){pivot.computeWorldMatrix(true);for(const node of pivot.getDescendants(false))node.computeWorldMatrix(true);}
function average(nodes:TransformNode[]):Vector3{
  if(!nodes.length)throw new Error('Punti ruota del modello assenti.');
  const p=Vector3.Zero();for(const n of nodes){n.computeWorldMatrix(true);p.addInPlace(n.getAbsolutePosition());}return p.scaleInPlace(1/nodes.length);
}
/** Per-mesh AABBs overestimate rotated tires; measure the actual transformed vertices once at import. */
function geometryBounds(pivot:TransformNode):{min:Vector3;max:Vector3}{
  const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity),local=Vector3.Zero(),world=Vector3.Zero();
  for(const mesh of pivot.getChildMeshes(false)){
    const positions=mesh.getVerticesData('position');if(!positions)continue;
    const matrix=mesh.computeWorldMatrix(true);
    for(let i=0;i<positions.length;i+=3){
      local.set(positions[i],positions[i+1],positions[i+2]);Vector3.TransformCoordinatesToRef(local,matrix,world);
      min.minimizeInPlace(world);max.maximizeInPlace(world);
    }
  }
  return {min,max};
}

/** Normalize an unparented imported hierarchy using its actual front/rear wheel pivots. */
export function normalizeCarModel(pivot:TransformNode,front:TransformNode[],rear:TransformNode[],targetLength=4.4):CarDimensions {
  if(pivot.parent||!Number.isFinite(targetLength)||targetLength<=0)throw new Error('Normalizzazione del modello auto non valida.');
  updateHierarchy(pivot);
  const direction=average(front).subtract(average(rear));direction.y=0;
  if(direction.length()<1e-5)throw new Error('Asse anteriore/posteriore del modello auto non valido.');
  pivot.rotationQuaternion=null;pivot.rotation.y-=Math.atan2(direction.x,direction.z);updateHierarchy(pivot);
  let bounds=geometryBounds(pivot);
  let length=bounds.max.z-bounds.min.z;
  if(!Number.isFinite(length)||length<=0)throw new Error('Il modello auto non ha geometria misurabile.');
  pivot.scaling.scaleInPlace(targetLength/length);updateHierarchy(pivot);
  bounds=geometryBounds(pivot);
  pivot.position.x-=(bounds.min.x+bounds.max.x)/2;pivot.position.z-=(bounds.min.z+bounds.max.z)/2;pivot.position.y-=bounds.min.y;updateHierarchy(pivot);
  bounds=geometryBounds(pivot);
  const width=bounds.max.x-bounds.min.x,height=bounds.max.y-bounds.min.y;
  length=bounds.max.z-bounds.min.z;
  if(!finite(width,height,length)||width<=0||height<=0||width>=length)throw new Error('Proporzioni del modello auto non valide.');
  return {radius:width/2+.025,halfLength:length/2+.025,width,length,height};
}

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

/** Preserve the authored steering/axle orientation while exposing a zero-rotation local X spinner. */
export function createWheelSpinPivot(wheel:TransformNode):TransformNode {
  const axle=new TransformNode(wheel.name+' · asse',wheel.getScene());axle.parent=wheel.parent;axle.position.copyFrom(wheel.position);
  if(wheel.rotationQuaternion)axle.rotationQuaternion=wheel.rotationQuaternion.clone();else axle.rotation.copyFrom(wheel.rotation);
  const spin=new TransformNode(wheel.name+' · rotazione',wheel.getScene());spin.parent=axle;
  wheel.parent=spin;wheel.position.setAll(0);wheel.rotationQuaternion=null;wheel.rotation.setAll(0);
  return spin;
}

/** Load the verified local PBR asset. Failure rejects ready; no primitive substitute is shown. */
export function createCar(scene:Scene):Car {
  const root=new TransformNode('auto di Luca',scene);root.setEnabled(false);
  const pivot=new TransformNode('CarConcept normalizzato',scene);pivot.setEnabled(false);
  const car:Car={root,wheels:[],velocity:0,heading:Math.PI,spawn:new Vector3(0,0,0),ready:Promise.resolve(),kind:'auto',radius:.98,halfLength:2.225};
  car.ready=(async()=>{
    try{
      const base=import.meta.env?.BASE_URL??'/';
      const folder=`${base}assets/vehicles/car-concept/`;
      const response=await fetch(folder+'source-manifest.json');
      if(!response.ok)throw new Error('Il manifesto del modello auto non è disponibile.');
      const manifest=await response.json();
      if(manifest.asset!=='CarConcept'||manifest.license!=='CC-BY-4.0'||manifest.scene!=='CarConcept.gltf')throw new Error('Provenienza del modello auto non valida.');
      registerBuiltInLoaders();
      // Babylon's transmission helper defaults to a half-float render target.
      // Keep physical glass on engines that need an unsigned-byte target instead.
      const engine=scene.getEngine(),caps=engine.getCaps();
      const transmissionOptions={renderTargetTextureType:caps.textureHalfFloat&&caps.textureHalfFloatRender?2:0,samples:engine.version>1?4:1};
      const existingTransmission=(scene as Scene&Partial<ITransmissionHelperHolder>)._transmissionHelper;
      if(existingTransmission)existingTransmission.updateOptions(transmissionOptions);
      else new TransmissionHelper(transmissionOptions,scene);
      const result=await ImportMeshAsync(folder+'CarConcept.gltf',scene);
      const nodes=[...result.meshes,...result.transformNodes];
      const imported=new Set(nodes);
      for(const node of nodes)if(!node.parent||!imported.has(node.parent as AbstractMesh))node.parent=pivot;
      const find=(name:string)=>{
        const node=nodes.find(n=>n.name===name);
        if(!node)throw new Error('Il modello auto è incompleto.');
        return node as TransformNode;
      };
      const front=[find('WheelFrontL'),find('WheelFrontR')],rear=[find('WheelRearL'),find('WheelRearR')];
      for(const mesh of result.meshes){mesh.isPickable=false;mesh.receiveShadows=true;mesh.metadata={...(mesh.metadata??{}),asset:'CarConcept',license:'CC-BY-4.0'};}
      // Hide the original trademark license plate. This runtime modification is recorded in metadata.
      nodes.find(n=>n.name==='License Plate')?.setEnabled(false);
      const size=normalizeCarModel(pivot,front,rear);
      car.radius=size.radius;car.halfLength=size.halfLength;
      for(const wheel of [...front,...rear])car.wheels.push(createWheelSpinPivot(wheel));
      pivot.parent=root;pivot.setEnabled(true);root.setEnabled(true);
      root.metadata={asset:'CarConcept',kind:'auto',dimensions:size,license:'CC-BY-4.0',runtimeModification:'Uniformly scaled to4.4m, centered, oriented using wheel pivots; source trademark plate hidden.',sourceRevision:manifest.revision};
    }catch(error){pivot.dispose(false,true);root.dispose(false,true);throw new Error('Impossibile caricare il modello dell’auto. Ricarica la pagina.',{cause:error});}
  })();
  return car;
}
