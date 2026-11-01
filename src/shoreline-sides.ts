import type {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import type {Material} from '@babylonjs/core/Materials/material';
import type {ElevatedGroundGeometry} from './elevated-ground';

/** Vertical skirts only: the original land top is supplied by elevated terrain. */
export function buildShorelineSideGeometry(ground:Pick<ElevatedGroundGeometry,'positions'|'indices'>,waterReference:number,bottomDepth=2){
  if(!Number.isFinite(waterReference)||!Number.isFinite(bottomDepth)||bottomDepth<=0)throw new TypeError('Riferimento del bordo costiero non valido.');
  const edges=new Map<string,{a:number;b:number;count:number}>();
  for(let i=0;i<ground.indices.length;i+=3)for(let j=0;j<3;j++){
    const a=ground.indices[i+j],b=ground.indices[i+(j+1)%3],key=a<b?a+','+b:b+','+a;
    const edge=edges.get(key);if(edge)edge.count++;else edges.set(key,{a,b,count:1});
  }
  const positions:number[]=[],indices:number[]=[],uvs:number[]=[];
  let boundaryEdges=0;
  for(const {a,b,count}of edges.values()){
    if(count!==1)continue;
    const ax=ground.positions[a*3],ay=ground.positions[a*3+1],az=ground.positions[a*3+2],bx=ground.positions[b*3],by=ground.positions[b*3+1],bz=ground.positions[b*3+2];
    const bottomA=Math.min(ay,waterReference)-bottomDepth,bottomB=Math.min(by,waterReference)-bottomDepth,n=positions.length/3,span=Math.hypot(bx-ax,bz-az);
    positions.push(ax,ay,az,bx,by,bz,bx,bottomB,bz,ax,bottomA,az);indices.push(n,n+2,n+1,n,n+3,n+2);
    uvs.push(0,ay/2,span/2,by/2,span/2,bottomB/2,0,bottomA/2);boundaryEdges++;
  }
  return {positions,indices,uvs,boundaryEdges};
}

export function addShorelineSides(scene:Scene,ground:Pick<ElevatedGroundGeometry,'positions'|'indices'>,waterReference:number,material:Material){
  const geometry=buildShorelineSideGeometry(ground,waterReference),mesh=new Mesh('bordi verticali terra OSM',scene),data=new VertexData(),normals:number[]=[];
  data.positions=geometry.positions;data.indices=geometry.indices;data.uvs=geometry.uvs;VertexData.ComputeNormals(geometry.positions,geometry.indices,normals);data.normals=normals;data.applyToMesh(mesh);
  mesh.material=material;mesh.receiveShadows=true;mesh.metadata={solid:true,geography:'land-side',topCap:false,boundary:'original-land-polygons-and-holes',waterReference:'artistic-native-zero-not-certified-MSL'};
  return {mesh,geometry};
}
