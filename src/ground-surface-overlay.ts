export interface GroundOverlaySurface {positions:ArrayLike<number>;indices:ArrayLike<number>;uvs?:ArrayLike<number>}
export interface GroundOverlayGround {positions:ArrayLike<number>;indices:ArrayLike<number>;normals?:ArrayLike<number>}
export interface GroundOverlayOptions {
  offset:number;uvMetres:number;cellSize?:number;maxTriangles?:number;
  /** Local profile height at each original surface vertex, interpolated before splitting. */
  vertexOffsets?:ArrayLike<number>;
}
export interface GroundOverlayStats {sourceTriangles:number;groundTriangles:number;candidatePairs:number;clippedPolygons:number;triangles:number;vertices:number;cells:number;maximumTriangles:number}
type Point=[number,number];
type Vertex=[number,number,number];
interface Face {ids:[number,number,number];points:[Point,Point,Point];ys:Vertex;denominator:number;box:[number,number,number,number];normal:Vertex}
const AREA_EPSILON=1e-10,MAX_REFERENCES=5_000_000;
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function validate(mesh:{positions:ArrayLike<number>;indices:ArrayLike<number>}){
  const {positions,indices}=mesh;
  if(!Number.isSafeInteger(positions.length)||positions.length<0||positions.length%3||!Number.isSafeInteger(indices.length)||indices.length<0||indices.length%3)throw new TypeError('Buffer della superficie da conformare non valido.');
  for(let i=0;i<positions.length;i++)if(!Number.isFinite(positions[i]))throw new TypeError('Vertice della superficie da conformare non finito.');
  for(let i=0;i<indices.length;i++)if(!Number.isInteger(indices[i])||indices[i]<0||indices[i]>=positions.length/3)throw new RangeError('Indice della superficie da conformare fuori dal buffer.');
}
function normal(a:Vertex,b:Vertex,c:Vertex):Vertex {
  const nx=(a[1]-b[1])*(c[2]-b[2])-(a[2]-b[2])*(c[1]-b[1]),ny=(a[2]-b[2])*(c[0]-b[0])-(a[0]-b[0])*(c[2]-b[2]),nz=(a[0]-b[0])*(c[1]-b[1])-(a[1]-b[1])*(c[0]-b[0]),length=Math.hypot(nx,ny,nz);
  if(!Number.isFinite(length)||length===0)throw new RangeError('Normale della superficie fuori dal limite numerico.');
  return [nx/length,ny/length,nz/length];
}
function weights(p:Point,points:[Point,Point,Point],denominator:number):Vertex {
  const [a,b,c]=points,u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/denominator,v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/denominator;
  return [u,v,1-u-v];
}
function clip(points:Point[],a:Point,b:Point):Point[]{
  if(points.length<3)return [];
  const output:Point[]=[];
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length],dp=cross(a,b,p),dq=cross(a,b,q),inside=dp>=0,nextInside=dq>=0;
    if(inside)output.push(p);
    if(inside!==nextInside){
      const t=dp/(dp-dq);
      if(!Number.isFinite(t)||t<0||t>1)throw new RangeError('Ritaglio della superficie fuori dal segmento sorgente.');
      output.push([(1-t)*p[0]+t*q[0],(1-t)*p[1]+t*q[1]]);
    }
  }
  return output;
}

/**
 * Split a visual surface at the actual rendered ground faces. Each output face
 * belongs to one ground triangle, so it follows terrain creases exactly instead
 * of interpolating across them. Unsupported land and source holes stay empty.
 */
export function conformSurfaceToGround(surface:GroundOverlaySurface,ground:GroundOverlayGround,options:GroundOverlayOptions){
  validate(surface);validate(ground);
  const {offset,uvMetres,vertexOffsets}=options,cellSize=options.cellSize??32,maxTriangles=options.maxTriangles??200000;
  if(!Number.isFinite(offset)||!Number.isFinite(uvMetres)||uvMetres<=0||!Number.isFinite(cellSize)||cellSize<=0||!Number.isInteger(maxTriangles)||maxTriangles<1||maxTriangles>200000)throw new RangeError('Opzioni della superficie da conformare non valide.');
  if(surface.uvs&&(surface.uvs.length!==surface.positions.length/3*2||Array.from(surface.uvs).some(n=>!Number.isFinite(n))))throw new TypeError('UV della superficie da conformare non valide.');
  if(vertexOffsets&&(vertexOffsets.length!==surface.positions.length/3||Array.from(vertexOffsets).some(n=>!Number.isFinite(n))))throw new TypeError('Profilo della superficie da conformare non valido.');
  if(ground.normals&&(ground.normals.length!==ground.positions.length||Array.from(ground.normals).some(n=>!Number.isFinite(n))))throw new TypeError('Normali del terreno non valide.');
  const faces:Face[]=[],grid=new Map<string,number[]>();let references=0;
  const range=(box:readonly number[])=>{
    const result=[Math.floor(box[0]/cellSize),Math.floor(box[1]/cellSize),Math.floor(box[2]/cellSize),Math.floor(box[3]/cellSize)],count=(result[2]-result[0]+1)*(result[3]-result[1]+1);
    if(!result.every(Number.isSafeInteger)||!Number.isSafeInteger(count)||count>MAX_REFERENCES)throw new RangeError('Budget spaziale della superficie da conformare superato.');
    return result;
  };
  for(let i=0;i<ground.indices.length;i+=3){
    let ids:[number,number,number]=[ground.indices[i],ground.indices[i+1],ground.indices[i+2]];
    let points=ids.map(id=>[ground.positions[id*3],ground.positions[id*3+2]] as Point) as [Point,Point,Point],area=cross(...points);
    if(!Number.isFinite(area))throw new RangeError('Area del terreno fuori dal limite numerico.');if(Math.abs(area)<=AREA_EPSILON)continue;
    if(area<0){[ids[1],ids[2]]=[ids[2],ids[1]];[points[1],points[2]]=[points[2],points[1]];area=-area;}
    const ys=ids.map(id=>ground.positions[id*3+1]) as Vertex,box:[number,number,number,number]=[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1])),Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))],face:Face={ids,points,ys,denominator:area,box,normal:normal([points[0][0],ys[0],points[0][1]],[points[1][0],ys[1],points[1][1]],[points[2][0],ys[2],points[2][1]])},id=faces.length;
    faces.push(face);const [x0,z0,x1,z1]=range(box);references+=(x1-x0+1)*(z1-z0+1);if(references>MAX_REFERENCES)throw new RangeError('Budget spaziale della superficie da conformare superato.');
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){const key=x+','+z,list=grid.get(key)??[];list.push(id);grid.set(key,list);}
  }
  const positions:number[]=[],indices:number[]=[],uvs:number[]=[],normals:number[]=[],sourceTriangles:number[]=[],visited=new Uint32Array(faces.length);
  const stats:GroundOverlayStats={sourceTriangles:surface.indices.length/3,groundTriangles:faces.length,candidatePairs:0,clippedPolygons:0,triangles:0,vertices:0,cells:grid.size,maximumTriangles:maxTriangles};
  for(let i=0;i<surface.indices.length;i+=3){
    const sourceIds:[number,number,number]=[surface.indices[i],surface.indices[i+1],surface.indices[i+2]],sourcePoints=sourceIds.map(id=>[surface.positions[id*3],surface.positions[id*3+2]] as Point) as [Point,Point,Point],sourceArea=cross(...sourcePoints);
    if(!Number.isFinite(sourceArea))throw new RangeError('Area della superficie fuori dal limite numerico.');if(Math.abs(sourceArea)<=AREA_EPSILON)continue;
    const box=[Math.min(...sourcePoints.map(p=>p[0])),Math.min(...sourcePoints.map(p=>p[1])),Math.max(...sourcePoints.map(p=>p[0])),Math.max(...sourcePoints.map(p=>p[1]))],[x0,z0,x1,z1]=range(box),stamp=i/3+1;
    for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)for(const id of grid.get(x+','+z)??[]){
      if(visited[id]===stamp)continue;visited[id]=stamp;const face=faces[id],b=face.box;
      if(box[0]>b[2]||box[2]<b[0]||box[1]>b[3]||box[3]<b[1])continue;stats.candidatePairs++;
      let polygon:Point[]=sourcePoints;
      for(let edge=0;edge<3&&polygon.length>=3;edge++)polygon=clip(polygon,face.points[edge],face.points[(edge+1)%3]);
      if(polygon.length<3)continue;
      let emitted=false;
      for(let fan=1;fan<polygon.length-1;fan++){
        const triangle:[Point,Point,Point]=[polygon[0],polygon[fan],polygon[fan+1]],area=cross(...triangle);if(Math.abs(area)<=AREA_EPSILON)continue;
        if(stats.triangles>=maxTriangles)throw new RangeError('Budget triangoli della superficie da conformare superato.');
        if(area*sourceArea<0)[triangle[1],triangle[2]]=[triangle[2],triangle[1]];
        const vertices:Vertex[]=[],vertexNormals:Vertex[]=[];
        for(const p of triangle){
          const groundWeights=weights(p,face.points,face.denominator),sourceWeights=surface.uvs||vertexOffsets?weights(p,sourcePoints,sourceArea):undefined;
          let localOffset=0;if(vertexOffsets)for(let k=0;k<3;k++)localOffset+=sourceWeights![k]*vertexOffsets[sourceIds[k]];
          const y=face.ys[2]+groundWeights[0]*(face.ys[0]-face.ys[2])+groundWeights[1]*(face.ys[1]-face.ys[2])+offset+localOffset;
          if(!Number.isFinite(y))throw new RangeError('Altezza della superficie conformata non finita.');vertices.push([p[0],y,p[1]]);
          if(surface.uvs){let u=0,v=0;for(let k=0;k<3;k++){u+=sourceWeights![k]*surface.uvs[sourceIds[k]*2];v+=sourceWeights![k]*surface.uvs[sourceIds[k]*2+1];}uvs.push(u,v);}else uvs.push(p[0]/uvMetres,p[1]/uvMetres);
          let n=face.normal;
          if(ground.normals&&!vertexOffsets){let nx=0,ny=0,nz=0;for(let k=0;k<3;k++){const j=face.ids[k]*3,w=groundWeights[k];nx+=ground.normals[j]*w;ny+=ground.normals[j+1]*w;nz+=ground.normals[j+2]*w;}const length=Math.hypot(nx,ny,nz);if(length>0&&ny>0)n=[nx/length,ny/length,nz/length];}
          vertexNormals.push(n);
        }
        const faceNormal=vertexOffsets?normal(vertices[0],vertices[1],vertices[2]):undefined;
        for(let k=0;k<3;k++){indices.push(positions.length/3);positions.push(...vertices[k]);normals.push(...(faceNormal??vertexNormals[k]));}
        sourceTriangles.push(i/3);stats.triangles++;emitted=true;
      }
      if(emitted)stats.clippedPolygons++;
    }
  }
  stats.vertices=positions.length/3;
  return {positions,indices,uvs,normals,sourceTriangles,stats};
}
