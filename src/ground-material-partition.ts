import type {ElevatedGroundBatch} from './elevated-ground';

export interface GroundMaterialBatch extends ElevatedGroundBatch {surface:'paving'|'steep-stone';projection:'xz'|'xy'|'zy'}

/** Artistic material classification only; every source XYZ face stays intact. */
export function partitionGroundMaterials(batches:readonly ElevatedGroundBatch[],steepSlopeDegrees=45,uvMetres=2){
  if(!Number.isFinite(steepSlopeDegrees)||steepSlopeDegrees<=0||steepSlopeDegrees>=90||!Number.isFinite(uvMetres)||uvMetres<=0)throw new RangeError('Classificazione delle superfici del terreno non valida.');
  const threshold=Math.tan(steepSlopeDegrees*Math.PI/180),result:GroundMaterialBatch[]=[];
  let steepTriangles=0,pavingTriangles=0;
  for(const source of batches){
    const groups=new Map<string,{batch:GroundMaterialBatch;vertices:Map<number,number>}>();
    for(let i=0;i<source.indices.length;i+=3){
      const face=source.indices.slice(i,i+3),[a,b,c]=face.map(id=>source.positions.slice(id*3,id*3+3));
      const nx=(a[1]-b[1])*(c[2]-b[2])-(a[2]-b[2])*(c[1]-b[1]),ny=(a[2]-b[2])*(c[0]-b[0])-(a[0]-b[0])*(c[2]-b[2]),nz=(a[0]-b[0])*(c[1]-b[1])-(a[1]-b[1])*(c[0]-b[0]);
      if(![nx,ny,nz].every(Number.isFinite)||ny<=0)throw new TypeError('Faccia del terreno non valida per la classificazione.');
      const steep=Math.hypot(nx,nz)/ny>threshold,surface=steep?'steep-stone':'paving',projection=steep?(Math.abs(nx)>Math.abs(nz)?'zy':'xy'):'xz';
      if(steep)steepTriangles++;else pavingTriangles++;
      const groupKey=surface+':'+projection;let group=groups.get(groupKey);
      if(!group){const batch:GroundMaterialBatch={key:source.key+':'+groupKey,surface,projection,positions:[],indices:[],normals:[],uvs:[]};group={batch,vertices:new Map()};groups.set(groupKey,group);result.push(batch);}
      for(const id of face){
        let local=group.vertices.get(id);
        if(local===undefined){
          local=group.vertices.size;if(local>=60000)throw new RangeError('Budget dei vertici del terreno classificato superato.');group.vertices.set(id,local);
          const [x,y,z]=source.positions.slice(id*3,id*3+3);group.batch.positions.push(x,y,z);group.batch.normals.push(...source.normals.slice(id*3,id*3+3));
          if(projection==='xz')group.batch.uvs.push(...source.uvs.slice(id*2,id*2+2));
          else group.batch.uvs.push((projection==='zy'?z:x)/uvMetres,y/uvMetres);
        }
        group.batch.indices.push(local);
      }
    }
  }
  return {batches:result,stats:{steepTriangles,pavingTriangles,batches:result.length,steepSlopeDegrees,classification:'artistic-slope-based-stone-not-measured-geology',steepUVs:'vertical-dominant-axis-projection'}};
}
