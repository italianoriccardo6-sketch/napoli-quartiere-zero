export type TerrainClipVertex=[number,number,number];
export type TerrainClipBounds=readonly [west:number,south:number,east:number,north:number];
type Plane={axis:0|2;boundary:number;keepGreater:boolean};
const AREA_EPSILON=1e-10;

function twiceArea(a:readonly number[],b:readonly number[],c:readonly number[]){
  return (b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
}
function clean(vertices:TerrainClipVertex[]):TerrainClipVertex[]{
  const result:TerrainClipVertex[]=[];
  for(const p of vertices){const last=result.at(-1);if(!last||p.some((value,index)=>value!==last[index]))result.push(p);}
  if(result.length>1&&result[0].every((value,index)=>value===result.at(-1)![index]))result.pop();
  return result;
}
function split(vertices:TerrainClipVertex[],plane:Plane):{inside:TerrainClipVertex[];outside:TerrainClipVertex[]}{
  const inside:TerrainClipVertex[]=[],outside:TerrainClipVertex[]=[];
  const distance=(p:TerrainClipVertex)=>(plane.keepGreater?1:-1)*(p[plane.axis]-plane.boundary);
  for(let i=0;i<vertices.length;i++){
    const a=vertices[i],b=vertices[(i+1)%vertices.length],da=distance(a),db=distance(b);
    if(!Number.isFinite(da)||!Number.isFinite(db))throw new RangeError('Dimensione del ritaglio del terreno fuori dal limite numerico.');
    const aInside=da>=0,bInside=db>=0;
    (aInside?inside:outside).push([...a]);
    if(aInside===bInside)continue;
    const t=da/(da-db);
    if(!Number.isFinite(t)||t<0||t>1)throw new RangeError('Intersezione del terreno fuori dal segmento sorgente.');
    // A convex combination interpolates the original source plane, including Y.
    const intersection=a.map((value,axis)=>(1-t)*value+t*b[axis]) as TerrainClipVertex;
    intersection[plane.axis]=plane.boundary;
    if(!intersection.every(Number.isFinite))throw new RangeError('Intersezione del terreno non finita.');
    inside.push([...intersection]);outside.push([...intersection]);
  }
  return {inside:clean(inside),outside:clean(outside)};
}

/**
 * Partition a source XYZ triangle around the city rectangle. Each rejected
 * half-plane piece is emitted once, while the remaining inside piece continues
 * to the next edge. The final rectangle interior is discarded. Source winding
 * and linearly interpolated heights are retained; no height blending is added.
 */
export function clipTerrainTriangleOutsideBounds(
  vertices:readonly (readonly [number,number,number])[],bounds:TerrainClipBounds,
):TerrainClipVertex[][] {
  if(vertices.length!==3||vertices.some(p=>p.length!==3||!p.every(Number.isFinite)))throw new TypeError('Il ritaglio richiede tre vertici XYZ finiti.');
  if(bounds.length!==4||!bounds.every(Number.isFinite)||!(bounds[0]<bounds[2]&&bounds[1]<bounds[3])||!Number.isFinite(bounds[2]-bounds[0])||!Number.isFinite(bounds[3]-bounds[1]))throw new RangeError('Rettangolo di ritaglio del terreno non valido.');
  const sourceArea=twiceArea(vertices[0],vertices[1],vertices[2]);
  if(!Number.isFinite(sourceArea))throw new RangeError('Area del terreno fuori dal limite numerico.');
  if(Math.abs(sourceArea)<=AREA_EPSILON)return [];
  const planes:Plane[]=[{axis:0,boundary:bounds[0],keepGreater:true},{axis:0,boundary:bounds[2],keepGreater:false},{axis:2,boundary:bounds[1],keepGreater:true},{axis:2,boundary:bounds[3],keepGreater:false}];
  const triangles:TerrainClipVertex[][]=[];
  let polygon=vertices.map(p=>[...p] as TerrainClipVertex);
  for(const plane of planes){
    if(polygon.length<3)break;
    const pieces=split(polygon,plane);polygon=pieces.inside;
    for(let i=1;i<pieces.outside.length-1;i++){
      const triangle=[pieces.outside[0],pieces.outside[i],pieces.outside[i+1]],area=twiceArea(...triangle as [TerrainClipVertex,TerrainClipVertex,TerrainClipVertex]);
      if(!Number.isFinite(area))throw new RangeError('Area del terreno ritagliato fuori dal limite numerico.');
      if(Math.abs(area)<=AREA_EPSILON)continue;
      // Guard round-off without changing the source face orientation.
      if(area*sourceArea<0)[triangle[1],triangle[2]]=[triangle[2],triangle[1]];
      triangles.push(triangle.map(p=>[...p]));
    }
  }
  return triangles;
}
