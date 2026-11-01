import '@babylonjs/core/Meshes/thinInstanceMesh';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {Vector3,Matrix,Quaternion} from '@babylonjs/core/Maths/math.vector';
import {ImportMeshAsync,type ISceneLoaderAsyncResult} from '@babylonjs/core/Loading/sceneLoader';
import {registerBuiltInLoaders} from '@babylonjs/loaders/dynamic';
import {createPhotographicFoliageMaterials} from './foliage-materials';
import {buildVegetationPlan,addVegetation,type GreenData,type TreePlacement,type VegetationOptions} from './vegetation';
import type {Point,MapData} from './geo';

type LOD='near'|'far';
type Role='bark_branches'|'leaves'|'bark_trunk';
const roles:Role[]=['bark_branches','leaves','bark_trunk'];
interface LODRecord {lod:LOD;path:string;bytes:number;sha256:string;triangles:number}
interface ModelManifest {asset:'tree_small_02';license:'CC0-1.0';totalRuntimeBytes:number;sharedTextures:{bytes:number};outputs:LODRecord[]}
export interface TreeModelOptions extends VegetationOptions {
  nearDistance?:number;
  lodHysteresis?:number;
  /** Read-only transport adapters allow the same actual GLBs to be tested without a browser. */
  loadManifest?:()=>Promise<unknown>;
  loadModel?:(url:string,scene:Scene)=>Promise<ISceneLoaderAsyncResult>;
}
export interface TreeModelNormalization {base:[number,number,number];height:number;crownDiameter:number;reference:'near-trunk-base';handedness:'left'|'right'}
export interface TreeModelStats {
  sourceTrees:number;treesRendered:number;modelTrees:number;proceduralTrees:number;
  nearTrees:number;farTrees:number;meshCount:number;nearTrianglesPerTree:number;farTrianglesPerTree:number;
  renderedModelTriangles:number;lodBufferUpdates:number;
  placement:'source-tree-nodes-only';individualTreesInvented:false;measuredShapes:false;
}
function manifest(raw:unknown):ModelManifest {
  const value=raw as ModelManifest;
  if(!value||value.asset!=='tree_small_02'||value.license!=='CC0-1.0'||!Number.isSafeInteger(value.totalRuntimeBytes)||value.totalRuntimeBytes<=0||value.totalRuntimeBytes>32*1024*1024||!Array.isArray(value.outputs)||value.outputs.length!==2)throw Error('Invalid tree model manifest.');
  for(const lod of ['near','far'] as const){
    const matches=value.outputs.filter(output=>output.lod===lod),output=matches[0];
    if(matches.length!==1||output.path!==`tree_small_02-${lod}.glb`||!Number.isSafeInteger(output.bytes)||output.bytes<=0||output.bytes>25*1024*1024||! /^[a-f0-9]{64}$/i.test(output.sha256)||!Number.isInteger(output.triangles)||output.triangles<=0||output.triangles>(lod==='near'?300000:120000))throw Error('Invalid tree LOD descriptor.');
  }
  if(!Number.isSafeInteger(value.sharedTextures?.bytes)||value.sharedTextures.bytes<=0||value.outputs.reduce((sum,output)=>sum+output.bytes,value.sharedTextures.bytes)!==value.totalRuntimeBytes)throw Error('Invalid combined tree asset byte count.');
  return value;
}
function disposeImport(result:ISceneLoaderAsyncResult){
  const nodes=new Set([...result.meshes,...result.transformNodes]);
  for(const node of nodes)if(!node.isDisposed()&&(!node.parent||!nodes.has(node.parent as Mesh)))node.dispose(false,true);
}
function yaw(id:string){let hash=2166136261;for(const c of id)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;return hash/4294967296*Math.PI*2;}
function bounds(meshes:readonly Mesh[]){
  const min=new Vector3(Infinity,Infinity,Infinity),max=new Vector3(-Infinity,-Infinity,-Infinity);
  for(const mesh of meshes){const positions=mesh.getVerticesData('position')!;for(let i=0;i<positions.length;i+=3){const p=new Vector3(positions[i],positions[i+1],positions[i+2]);min.minimizeInPlace(p);max.maximizeInPlace(p);}}
  return {min,max};
}

/** Licensed generic tree geometry at existing OSM tree nodes, never new planting. */
export function createTreeModels(scene:Scene,map:MapData,data:GreenData,options:TreeModelOptions={}){
  const nearDistance=options.nearDistance??45,hysteresis=options.lodHysteresis??5;
  if(!Number.isFinite(nearDistance)||nearDistance<=0||!Number.isFinite(hysteresis)||hysteresis<0||hysteresis>=nearDistance)throw new RangeError('Distanze LOD degli alberi non valide.');
  const plan=buildVegetationPlan(map,data,options),placements=plan.placements,modelPlacements=placements.filter(tree=>tree.form==='broadleaf');
  const unsupported=new Set(placements.filter(tree=>tree.form!=='broadleaf').map(tree=>tree.id));
  const fallback=unsupported.size?addVegetation(scene,map,{...data,trees:data.trees.filter(tree=>unsupported.has(tree.id))},{...options,materials:{bark:options.materials?.bark,palm:options.materials?.palm},photographicLeafCards:false}):undefined;
  const meshes:Mesh[]=[...(fallback?.meshes??[])],templates:Record<LOD,Mesh[]>={near:[],far:[]},casters=new Set<Mesh>();
  const stats:TreeModelStats={sourceTrees:data.trees.length,treesRendered:placements.length,modelTrees:modelPlacements.length,proceduralTrees:unsupported.size,nearTrees:0,farTrees:0,meshCount:meshes.length,nearTrianglesPerTree:0,farTrianglesPerTree:0,renderedModelTriangles:0,lodBufferUpdates:0,placement:'source-tree-nodes-only',individualTreesInvented:false,measuredShapes:false};
  let disposed=false,loaded=false,normalization:TreeModelNormalization|undefined;
  let lastPosition:Point=[...(options.focus?.[0]??modelPlacements[0]?.point??[0,0])],lastQuality=options.quality??'alta';
  const membership=new Map<string,LOD>(),transforms=new Map<string,number[]>();
  const ownedMaterials=modelPlacements.length&&(!options.materials?.bark||!options.materials?.broadleaf)?createPhotographicFoliageMaterials(scene):undefined;
  const bark=options.materials?.bark??ownedMaterials?.bark,leaves=options.materials?.broadleaf??ownedMaterials?.leaves;
  const base=`${import.meta.env?.BASE_URL??'/'}assets/foliage/tree_small_02/`;
  function shadow(mesh:Mesh,active:boolean){
    if(active&&options.shadows&&!casters.has(mesh)){options.shadows.addShadowCaster(mesh,false);casters.add(mesh);}
    else if(!active&&casters.delete(mesh))options.shadows?.removeShadowCaster(mesh,false);
  }
  function update(position:Point,quality:'alta'|'bassa'=lastQuality){
    if(!position.every(Number.isFinite)||position.length!==2)throw new TypeError('Posizione della visuale alberi non valida.');
    lastPosition=[...position];lastQuality=quality;if(!loaded||disposed)return;
    let changed=membership.size!==modelPlacements.length;
    for(const tree of modelPlacements){
      const distance=Math.hypot(tree.point[0]-position[0],tree.point[1]-position[1]),previous=membership.get(tree.id);
      const next:LOD=quality==='bassa'?'far':distance<=(previous==='near'?nearDistance+hysteresis:nearDistance)?'near':'far';
      if(previous!==next){membership.set(tree.id,next);changed=true;}
    }
    if(changed){
      for(const lod of ['near','far'] as const){
        const trees=modelPlacements.filter(tree=>membership.get(tree.id)===lod),buffer=new Float32Array(trees.length*16);
        for(let i=0;i<trees.length;i++)buffer.set(transforms.get(trees[i].id)!,i*16);
        for(const mesh of templates[lod]){
          // Babylon renders the original mesh when thinInstanceCount is zero.
          // Disabled empty templates must never leave a phantom tree at origin.
          mesh.setEnabled(false);
          if(trees.length){mesh.thinInstanceSetBuffer('matrix',buffer,16,true);mesh.thinInstanceRefreshBoundingInfo(true);mesh.setEnabled(true);}
          else mesh.thinInstanceCount=0;
        }
        stats.lodBufferUpdates++;
      }
    }
    stats.nearTrees=modelPlacements.filter(tree=>membership.get(tree.id)==='near').length;stats.farTrees=modelPlacements.length-stats.nearTrees;
    stats.renderedModelTriangles=stats.nearTrees*stats.nearTrianglesPerTree+stats.farTrees*stats.farTrianglesPerTree;
    for(const lod of ['near','far'] as const)for(const mesh of templates[lod])shadow(mesh,mesh.isEnabled()&&quality==='alta');
  }
  function cleanup(){
    for(const mesh of casters)options.shadows?.removeShadowCaster(mesh,false);casters.clear();
    for(const lod of ['near','far'] as const)for(const mesh of templates[lod])if(!mesh.isDisposed())mesh.dispose(false,false);
    fallback?.dispose();ownedMaterials?.bark.dispose(false,true);ownedMaterials?.leaves.dispose(false,true);
  }
  function dispose(){if(disposed)return;disposed=true;for(const mesh of meshes)mesh.setEnabled(false);if(loaded)cleanup();}
  const ready=(async()=>{
    if(!modelPlacements.length){loaded=true;if(disposed)cleanup();return;}
    try{
      const raw=options.loadManifest?await options.loadManifest():await (async()=>{const response=await fetch(base+'tree-lod-manifest.json');if(!response.ok)throw Error('Tree manifest unavailable.');return response.json();})();
      const source=manifest(raw);registerBuiltInLoaders();
      const loads=source.outputs.map(async record=>{
        const result=await (options.loadModel?.(base+record.path,scene)??ImportMeshAsync(base+record.path,scene));
        try{
          for(const mesh of result.meshes)mesh.setEnabled(false);
          const found=new Set<Role>();let triangles=0;
          for(const imported of result.meshes){
            if(!(imported instanceof Mesh)||!imported.getTotalVertices())continue;
            const role=imported.material?.name as Role;if(!roles.includes(role)||found.has(role))throw Error('Unexpected tree material role.');found.add(role);
            const data=VertexData.ExtractFromMesh(imported,true,true);data.transform(imported.computeWorldMatrix(true));
            if(!data.positions||!data.normals||!data.uvs||!data.indices||data.positions.length!==data.normals.length||data.uvs.length/2!==data.positions.length/3||data.indices.length%3)throw Error('Invalid tree vertex streams.');
            if(!Array.from(data.positions).every(Number.isFinite)||!Array.from(data.normals).every(Number.isFinite)||!Array.from(data.uvs).every(Number.isFinite)||!Array.from(data.indices).every(index=>Number.isInteger(index)&&index>=0&&index<data.positions!.length/3))throw Error('Invalid tree geometry values.');
            const mesh=new Mesh(`albero CC0 ${record.lod} ${role}`,scene);mesh.setEnabled(false);mesh.isVisible=true;mesh.visibility=1;data.applyToMesh(mesh);mesh.material=role==='leaves'?leaves!:bark!;
            mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=true;mesh.metadata={treeModel:true,lod:record.lod,materialRole:role,solid:false,sourceTreeNodes:true,asset:'Poly Haven tree_small_02',license:'CC0-1.0',shape:'licensed generic broadleaf, not surveyed tree shape'};
            triangles+=data.indices.length/3;templates[record.lod].push(mesh);meshes.push(mesh);
          }
          if(found.size!==3||triangles!==record.triangles)throw Error('Actual tree geometry differs from its verified manifest.');
          if(record.lod==='near')stats.nearTrianglesPerTree=triangles;else stats.farTrianglesPerTree=triangles;
        }finally{disposeImport(result);}
      });
      const results=await Promise.allSettled([...loads,ownedMaterials?.ready??Promise.resolve()]);
      const failure=results.find(result=>result.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
      const trunk=templates.near.find(mesh=>mesh.metadata.materialRole==='bark_trunk')!,trunkBounds=bounds([trunk]),nearBounds=bounds(templates.near),canopy=bounds(templates.near.filter(mesh=>mesh.metadata.materialRole==='leaves'));
      const band=Math.max(.015,(trunkBounds.max.y-trunkBounds.min.y)*.01),baseMin=new Vector3(Infinity,Infinity,Infinity),baseMax=new Vector3(-Infinity,-Infinity,-Infinity),positions=trunk.getVerticesData('position')!;
      for(let i=0;i<positions.length;i+=3)if(positions[i+1]<=trunkBounds.min.y+band){const p=new Vector3(positions[i],positions[i+1],positions[i+2]);baseMin.minimizeInPlace(p);baseMax.maximizeInPlace(p);}
      const reference:TreeModelNormalization={base:[(baseMin.x+baseMax.x)/2,trunkBounds.min.y,(baseMin.z+baseMax.z)/2],height:nearBounds.max.y-trunkBounds.min.y,crownDiameter:Math.max(canopy.max.x-canopy.min.x,canopy.max.z-canopy.min.z),reference:'near-trunk-base',handedness:scene.useRightHandedSystem?'right':'left'};
      if(![...reference.base,reference.height,reference.crownDiameter].every(Number.isFinite)||reference.height<=0||reference.crownDiameter<=0)throw Error('Tree trunk-base normalization failed.');normalization=reference;
      for(const lod of ['near','far'] as const)for(const mesh of templates[lod]){
        const positions=mesh.getVerticesData('position')!;for(let i=0;i<positions.length;i+=3){positions[i]-=reference.base[0];positions[i+1]-=reference.base[1];positions[i+2]-=reference.base[2];}mesh.setVerticesData('position',positions,false);mesh.refreshBoundingInfo();mesh.metadata.normalization=reference;
      }
      for(const tree of modelPlacements){
        const matrix=Matrix.Compose(new Vector3(tree.crownDiameter/reference.crownDiameter,tree.height/reference.height,tree.crownDiameter/reference.crownDiameter),Quaternion.RotationYawPitchRoll(yaw(tree.id),0,0),new Vector3(tree.point[0],tree.ground,tree.point[1]));transforms.set(tree.id,Array.from(matrix.asArray()));
      }
      stats.meshCount=meshes.length;loaded=true;if(disposed){cleanup();return;}update(lastPosition,lastQuality);
      scene.metadata={...(scene.metadata??{}),treeModels:stats,vegetation:{...plan.stats,branchInstances:0,leafInstances:0,meshCount:meshes.length,measuredPositions:true,measuredShapes:false,representation:'licensed model broadleaf; explicit procedural forms otherwise'}};
    }catch(cause){loaded=true;disposed=true;cleanup();throw new Error('Impossibile caricare gli alberi della città. Ricarica la pagina.',{cause});}
  })();
  return {ready,update,dispose,stats,meshes,placements,get normalization(){return normalization;}};
}
