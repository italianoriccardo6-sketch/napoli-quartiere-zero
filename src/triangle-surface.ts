export interface TriangleSurfaceBatch {positions:ArrayLike<number>;indices:ArrayLike<number>}
export interface TriangleSurfaceOptions {
  cellSize?:number;
  /** Maximum rise/run of supporting faces. Infinity includes every upward face. */
  maxSlope?:number;
}
export interface TriangleSurfaceStats {sourceTriangles:number;supportTriangles:number;cells:number;references:number}
type Vertex=readonly [number,number,number];
interface Triangle {a:Vertex;b:Vertex;c:Vertex;denominator:number}
const AREA_EPSILON=1e-10,EDGE_EPSILON=1e-8,MAX_REFERENCES=5_000_000;

/**
 * Index the supplied rendered XYZ faces, without resampling their source field.
 * Babylon's upward winding is (a-b) cross (c-b). Downward, vertical and overly
 * steep faces provide no support; gaps remain undefined, including below zero.
 */
export function createTriangleSurfaceSampler(batches:readonly TriangleSurfaceBatch[],options:TriangleSurfaceOptions={}){
  const cellSize=options.cellSize??32,maxSlope=options.maxSlope??Infinity;
  if(!Number.isFinite(cellSize)||cellSize<=0)throw new RangeError('Passo della griglia della superficie non valido.');
  if(!(maxSlope>=0)||(!Number.isFinite(maxSlope)&&maxSlope!==Infinity))throw new RangeError('Pendenza massima della superficie non valida.');
  const grid=new Map<string,Triangle[]>(),stats:TriangleSurfaceStats={sourceTriangles:0,supportTriangles:0,cells:0,references:0};
  for(const {positions,indices}of batches){
    if(!Number.isSafeInteger(positions.length)||positions.length<0||positions.length%3!==0||!Number.isSafeInteger(indices.length)||indices.length<0||indices.length%3!==0)throw new TypeError('Buffer triangolare della superficie non valido.');
    for(let i=0;i<positions.length;i++)if(!Number.isFinite(positions[i]))throw new TypeError('Vertice della superficie non finito.');
    for(let i=0;i<indices.length;i++)if(!Number.isInteger(indices[i])||indices[i]<0||indices[i]>=positions.length/3)throw new RangeError('Indice della superficie fuori dal buffer.');
    stats.sourceTriangles+=indices.length/3;
    for(let i=0;i<indices.length;i+=3){
      const vertices=[indices[i],indices[i+1],indices[i+2]].map(index=>[positions[index*3],positions[index*3+1],positions[index*3+2]] as Vertex),[a,b,c]=vertices;
      const nx=(a[1]-b[1])*(c[2]-b[2])-(a[2]-b[2])*(c[1]-b[1]);
      const ny=(a[2]-b[2])*(c[0]-b[0])-(a[0]-b[0])*(c[2]-b[2]);
      const nz=(a[0]-b[0])*(c[1]-b[1])-(a[1]-b[1])*(c[0]-b[0]);
      if(![nx,ny,nz].every(Number.isFinite))throw new RangeError('Dimensione della superficie fuori dal limite numerico.');
      if(ny<=AREA_EPSILON||Math.hypot(nx,nz)/ny>maxSlope+1e-12)continue;
      const triangle:Triangle={a,b,c,denominator:(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])};
      const x0=Math.floor(Math.min(a[0],b[0],c[0])/cellSize),x1=Math.floor(Math.max(a[0],b[0],c[0])/cellSize);
      const z0=Math.floor(Math.min(a[2],b[2],c[2])/cellSize),z1=Math.floor(Math.max(a[2],b[2],c[2])/cellSize),references=(x1-x0+1)*(z1-z0+1);
      if(![x0,x1,z0,z1,references].every(Number.isSafeInteger)||references<=0||stats.references+references>MAX_REFERENCES)throw new RangeError('Budget spaziale della superficie superato.');
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
        const key=x+','+z,list=grid.get(key)??[];list.push(triangle);grid.set(key,list);
      }
      stats.supportTriangles++;stats.references+=references;
    }
  }
  stats.cells=grid.size;
  return {
    stats,
    heightAt(x:number,z:number):number|undefined {
      if(!Number.isFinite(x)||!Number.isFinite(z))return undefined;
      let height:number|undefined;
      for(const {a,b,c,denominator}of grid.get(Math.floor(x/cellSize)+','+Math.floor(z/cellSize))??[]){
        const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/denominator;
        const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/denominator,w=1-u-v;
        if(u<-EDGE_EPSILON||v<-EDGE_EPSILON||w<-EDGE_EPSILON)continue;
        const candidate=c[1]+u*(a[1]-c[1])+v*(b[1]-c[1]);
        height=height===undefined?candidate:Math.max(height,candidate);
      }
      return height;
    },
    dispose(){grid.clear();},
  };
}
