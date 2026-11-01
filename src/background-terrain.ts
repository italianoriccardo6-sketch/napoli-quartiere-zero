import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Effect} from '@babylonjs/core/Materials/effect';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {toLocal} from './geo';
import {clipTerrainTriangleOutsideBounds,type TerrainClipVertex} from './terrain-rectangle-clip';

export interface BackgroundTerrainData {
  version:1;
  purpose:'distant-background-only';
  bbox:{west:number;south:number;east:number;north:number};
  columns:number;rows:number;
  heights_m:number[];valid:number[];
  sea_level_m:0;
  source:{attribution?:string;[key:string]:unknown};
}
export type TerrainExclusion = readonly [number,number,number,number];
export interface BackgroundTerrainOptions {
  /** Local metric [west,south,east,north] of the full city. */
  excludeLocalBounds:TerrainExclusion;
  exclusionPaddingM?:number;
  /** Clip source faces at the boundary instead of omitting whole intersecting cells. */
  clipToCityBounds?:boolean;
  /** Artistic scene translation only; this is not a certified vertical datum conversion. */
  verticalOffsetM?:number;
  hazeColor?:readonly [number,number,number];
}

export function validateBackgroundTerrain(raw:unknown):BackgroundTerrainData {
  if(!raw||typeof raw!=='object')throw new Error('Missing background terrain');
  const x=raw as BackgroundTerrainData;
  if(x.version!==1||x.purpose!=='distant-background-only'||x.sea_level_m!==0)throw new Error('Wrong terrain purpose or version');
  if(!Number.isInteger(x.columns)||!Number.isInteger(x.rows)||x.columns<2||x.rows<2||x.columns*x.rows>50000||2*(x.columns-1)*(x.rows-1)>=100000)throw new Error('Background grid exceeds triangle budget');
  const b=x.bbox;
  if(!b||![b.west,b.south,b.east,b.north].every(Number.isFinite)||b.west>=b.east||b.south>=b.north||b.west<14||b.east>15||b.south<40||b.north>41)throw new Error('Background lies outside the verified N40E014 tile');
  const count=x.columns*x.rows;
  if(!Array.isArray(x.heights_m)||!Array.isArray(x.valid)||x.heights_m.length!==count||x.valid.length!==count)throw new Error('Background sample count mismatch');
  if(x.heights_m.some(h=>!Number.isFinite(h)||h<0||h>2000)||x.valid.some(v=>v!==0&&v!==1))throw new Error('Invalid background heights or mask');
  if(!x.source||typeof x.source!=='object')throw new Error('Missing background provenance');
  return x;
}

/** Pure mesh preparation: source sea-only/missing cells and the city interior are omitted. */
export function backgroundTerrainGeometry(data:BackgroundTerrainData,options:BackgroundTerrainOptions) {
  const {columns,rows,bbox,heights_m,valid}=data;
  const clip=options.clipToCityBounds??false,verticalOffset=options.verticalOffsetM??0,padding=options.exclusionPaddingM??(clip?0:120),b=options.excludeLocalBounds;
  if(!Number.isFinite(verticalOffset))throw new RangeError('Offset verticale del rilievo non finito.');
  if(!Number.isFinite(padding)||padding<0)throw new RangeError('Margine di esclusione del rilievo non valido.');
  if(b.length!==4||!b.every(Number.isFinite)||!(b[0]<b[2]&&b[1]<b[3]))throw new RangeError('Limiti di esclusione del rilievo non validi.');
  const exclusion:TerrainExclusion=[b[0]-padding,b[1]-padding,b[2]+padding,b[3]+padding];
  if(!exclusion.every(Number.isFinite))throw new RangeError('Limiti di esclusione del rilievo fuori dal limite numerico.');
  const sourcePositions:number[]=[],positions:number[]=[],indices:number[]=[],normals:number[]=[],colors:number[]=[];
  function color(nativeHeight:number){
    const volcanic=Math.max(0,Math.min(1,(nativeHeight-550)/500));
    // Interpretative distant surface colors, based on native height, not imagery.
    colors.push(.31+volcanic*.08,.35-volcanic*.03,.27-volcanic*.01,1);
  }
  for(let r=0;r<rows;r++)for(let c=0;c<columns;c++){
    const lon=bbox.west+(bbox.east-bbox.west)*c/(columns-1),lat=bbox.north-(bbox.north-bbox.south)*r/(rows-1);
    const [x,z]=toLocal(lon,lat),height=heights_m[r*columns+c];sourcePositions.push(x,height,z);
    if(!clip){positions.push(x,height+verticalOffset,z);color(height);}
  }
  const welded=new Map<string,number>();
  function appendTriangle(triangle:TerrainClipVertex[]){
    for(const p of triangle){
      const key=p.join(','),existing=welded.get(key);
      if(existing!==undefined){indices.push(existing);continue;}
      const index=positions.length/3;positions.push(p[0],p[1]+verticalOffset,p[2]);color(p[1]);welded.set(key,index);indices.push(index);
    }
  }
  for(let r=0;r<rows-1;r++)for(let c=0;c<columns-1;c++){
    const a=r*columns+c,bb=a+1,cc=a+columns,d=cc+1;
    if([a,bb,cc,d].some(i=>valid[i]===0)||Math.max(heights_m[a],heights_m[bb],heights_m[cc],heights_m[d])<=1)continue;
    const left=sourcePositions[a*3],right=sourcePositions[bb*3],north=sourcePositions[a*3+2],south=sourcePositions[cc*3+2];
    const intersects=left<=exclusion[2]&&right>=exclusion[0]&&south<=exclusion[3]&&north>=exclusion[1];
    if(!clip){if(!intersects)indices.push(a,cc,bb,bb,cc,d);continue;}
    for(const ids of [[a,cc,bb],[bb,cc,d]]){
      const triangle=ids.map(id=>sourcePositions.slice(id*3,id*3+3) as TerrainClipVertex);
      for(const outside of intersects?clipTerrainTriangleOutsideBounds(triangle,exclusion):[triangle])appendTriangle(outside);
    }
  }
  VertexData.ComputeNormals(positions,indices,normals);
  return {positions,indices,normals,colors};
}

/** Visual-only distant relief. It never participates in picking, physics or gameplay heights. */
export function createBackgroundTerrain(scene:Scene,raw:unknown,options:BackgroundTerrainOptions):Mesh|null {
  const data=validateBackgroundTerrain(raw),geometry=backgroundTerrainGeometry(data,options);
  if(!geometry.indices.length)return null;
  const mesh=new Mesh('Rilievo SRTM distante · Vesuvio e Posillipo',scene);
  const vertices=new VertexData();vertices.positions=geometry.positions;vertices.indices=geometry.indices;vertices.normals=geometry.normals;vertices.colors=geometry.colors;vertices.applyToMesh(mesh,false);
  Effect.ShadersStore['napoliReliefVertexShader']=`precision highp float;
    attribute vec3 position;attribute vec3 normal;attribute vec4 color;
    uniform mat4 world;uniform mat4 worldViewProjection;
    varying vec3 vPosition;varying vec3 vNormal;varying vec4 vColor;
    void main(){vPosition=(world*vec4(position,1.0)).xyz;vNormal=normalize(mat3(world)*normal);vColor=color;gl_Position=worldViewProjection*vec4(position,1.0);}`;
  Effect.ShadersStore['napoliReliefFragmentShader']=`precision highp float;
    varying vec3 vPosition;varying vec3 vNormal;varying vec4 vColor;
    uniform vec3 cameraPosition;uniform vec3 sunDirection;uniform vec3 sunColor;uniform vec3 hazeColor;
    void main(){float diffuse=max(0.0,dot(normalize(vNormal),-normalize(sunDirection)));
      vec3 ground=vColor.rgb*(vec3(0.63)+0.37*sunColor*diffuse);
      float distanceToCamera=length(vPosition.xz-cameraPosition.xz);
      float haze=1.0-exp(-distanceToCamera/18000.0);
      gl_FragColor=vec4(mix(ground,hazeColor,clamp(haze,0.0,0.94)),1.0);}`;
  const material=new ShaderMaterial('Rilievo distante · luce e foschia',scene,{vertex:'napoliRelief',fragment:'napoliRelief'},
    {attributes:['position','normal','color'],uniforms:['world','worldViewProjection','cameraPosition','sunDirection','sunColor','hazeColor']});
  const haze=options.hazeColor??[.69,.79,.83];material.setColor3('hazeColor',new Color3(...haze));
  material.backFaceCulling=false;
  const fallbackSun=new Vector3(-.8,-.72,-.38);
  const syncLighting=()=>{
    const sun=scene.lights.find(light=>light instanceof DirectionalLight) as DirectionalLight|undefined;
    material.setVector3('sunDirection',sun?.direction??fallbackSun);
    material.setColor3('sunColor',sun?.diffuse??Color3.White());
    material.setVector3('cameraPosition',scene.activeCamera?.globalPosition??Vector3.Zero());
  };
  syncLighting();material.onBindObservable.add(syncLighting);
  mesh.material=material;mesh.useVertexColors=true;mesh.isPickable=false;mesh.checkCollisions=false;mesh.receiveShadows=false;
  mesh.metadata={backgroundOnly:true,purpose:data.purpose,source:data.source,triangleCount:geometry.indices.length/3,approximateColor:true,
    cityExclusion:options.clipToCityBounds?'source-triangles-clipped-at-rectangle':'whole-source-cells',
    verticalReference:{source:'SRTM native EGM96 geoid heights',sceneOffsetMetres:options.verticalOffsetM??0,alignment:'Supplied scene offset for artistic alignment, not a certified vertical datum transformation.',certifiedDatumTransform:false}};
  return mesh;
}
