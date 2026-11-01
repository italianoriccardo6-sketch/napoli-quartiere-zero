import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {NullEngine} from '@babylonjs/core/Engines/nullEngine';
import {Scene} from '@babylonjs/core/scene';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {ORIGIN,inside,type Point,type MapData} from '../src/geo';
import type {CityMapData} from '../src/city-data';
import {prepareGreenGroundData} from '../scripts/prepare-green-ground';
import {addGreenGround,buildGreenGroundGeometry,validateGreenGround,type GreenGroundBatch,type GreenGroundData,type GreenGroundSourceGeometry} from '../src/green-ground';

const square=(a:number,b:number,c:number,d:number):Point[]=>[[a,b],[c,b],[c,d],[a,d]];
const dataFor=(polygons:Point[][][],bounds:[number,number,number,number]=[0,0,10,10]):GreenGroundData=>({version:1,source:{license:'ODbL-1.0',rawSha256:'a'.repeat(64),bounds},areas:polygons.map((p,i)=>({id:'way/'+(i+1),kind:'park',polygons:[p]})),coverage:polygons});
const plane=(height:(x:number,z:number)=>number):GreenGroundSourceGeometry=>({positions:[0,height(0,0),0,10,height(10,0),0,10,height(10,10),10,0,height(0,10),10],indices:[0,1,2,0,2,3]});
function area(batches:GreenGroundBatch[]){let total=0;for(const b of batches)for(let i=0;i<b.indices.length;i+=3){const [a,c,d]=b.indices.slice(i,i+3).map(id=>[b.positions[id*3],b.positions[id*3+2]]);const value=((c[0]-a[0])*(d[1]-a[1])-(c[1]-a[1])*(d[0]-a[0]))/2;assert.ok(value>0,'all rendered faces point upward');total+=value;}return total;}
const lonLat=([x,z]:Point)=>({lon:ORIGIN.lon+x/(6378137*Math.cos(ORIGIN.lat*Math.PI/180))*180/Math.PI,lat:ORIGIN.lat+z/6378137*180/Math.PI});

test('offline extraction preserves relation holes, coastal water holes, source identities and raw bytes',()=>{
  let next=1;const elements:Record<string,unknown>[]=[];
  function way(id:number,ring:Point[]){const nodes=ring.map(p=>{const nodeId=next++;elements.push({type:'node',id:nodeId,...lonLat(p)});return nodeId;});nodes.push(nodes[0]);elements.push({type:'way',id,nodes});}
  way(11,square(-5,-5,15,15));way(12,square(3,3,5,5));
  elements.push({type:'relation',id:100,tags:{type:'multipolygon',natural:'wood',name:'Parco verificato'},members:[{type:'way',ref:11,role:'outer'},{type:'way',ref:12,role:'inner'}]});
  elements.push({type:'node',id:900,tags:{natural:'tree'},...lonLat([2,2])});
  const bytes=Buffer.from(JSON.stringify({version:.6,elements})),before=Buffer.from(bytes);
  const map={land:[square(0,0,10,10)],city:{bounds:[0,0,10,10],landPolygons:[[square(0,0,10,10),square(8,8,9,9)]]}} as CityMapData;
  const result=prepareGreenGroundData(bytes,map,{license:'ODbL-1.0',retrieved_at:'verified-date'});
  assert.deepEqual(bytes,before);assert.deepEqual(result.areas.map(a=>[a.id,a.kind,a.name]),[['relation/100','wood','Parco verificato']]);
  assert.equal(result.source.rawSha256,createHash('sha256').update(before).digest('hex'));assert.equal(result.source.retrievedAt,'verified-date');
  assert.equal(result.coverage.length,1);assert.equal(result.coverage[0].length,3,'mapped inner ring and actual water hole remain empty');
  const g=buildGreenGroundGeometry(result,[plane(()=>0)]);assert.ok(Math.abs(area(g.batches)-95)<1e-6);
  for(const p of result.coverage.flat(2)){assert.ok(p[0]>=0&&p[0]<=10&&p[1]>=0&&p[1]<=10);}
});

test('grass clips the original sloped triangles exactly and preserves park holes and normals',()=>{
  const outer=square(1,1,9,9),hole=square(4,4,6,6),data=dataFor([[outer,hole]]),ground=plane((x,z)=>3+.1*x+.2*z);
  const normal=[-.1,1,-.2].map(v=>v/Math.sqrt(1.05));ground.normals=Array.from({length:4},()=>normal).flat();
  const before=JSON.stringify({data,ground}),g=buildGreenGroundGeometry(data,[ground]);
  assert.equal(JSON.stringify({data,ground}),before);assert.ok(Math.abs(area(g.batches)-60)<1e-9);assert.equal(g.stats.coveredSourceTriangles,2);
  for(const b of g.batches){
    for(let i=0;i<b.positions.length;i+=3){const [x,y,z]=b.positions.slice(i,i+3);assert.ok(Math.abs(y-(3+.1*x+.2*z+.012))<1e-10);for(let axis=0;axis<3;axis++)assert.ok(Math.abs(b.normals[i+axis]-normal[axis])<1e-10);}
    for(let i=0;i<b.indices.length;i+=3){const ids=b.indices.slice(i,i+3),p:Point=[ids.reduce((s,id)=>s+b.positions[id*3],0)/3,ids.reduce((s,id)=>s+b.positions[id*3+2],0)/3];assert.ok(inside(p,outer));assert.equal(inside(p,hole),false);}
  }
});

test('a nonplanar terrain keeps its diagonal crease and uses rendered triangle heights',()=>{
  const ground:GreenGroundSourceGeometry={positions:[0,0,0,10,2,0,10,10,10,0,4,10],indices:[0,1,2,0,2,3]},data=dataFor([[square(1,1,9,9)]]),g=buildGreenGroundGeometry(data,[ground]);
  assert.ok(Math.abs(area(g.batches)-64)<1e-9);
  for(const b of g.batches)for(let i=0;i<b.positions.length;i+=3){const [x,y,z]=b.positions.slice(i,i+3),height=x>=z?.2*x+.8*z:.6*x+.4*z;assert.ok(Math.abs(y-height-.012)<1e-10,'clipped vertex lies on its original terrain face');}
  assert.ok(g.batches.some(b=>b.positions.some((v,i)=>i%3===0&&v===1&&b.positions[i+2]===1)),'intersection with the terrain crease becomes a vertex');
});

test('Babylon attachment transforms land faces and excludes roads and buildings',()=>{
  const engine=new NullEngine(),scene=new Scene(engine),material=new StandardMaterial('caller-owned',scene);
  try{
    const ground=MeshBuilder.CreateGround('actual land',{width:10,height:10},scene);ground.metadata={geography:'land'};ground.position.set(20,3,30);ground.rotation.z=.2;ground.scaling.x=2;
    const road=MeshBuilder.CreateGround('road',{width:100,height:100},scene);road.metadata={geography:'road'};road.position.set(20,50,30);
    const data=dataFor([[square(18,28,22,32)]],[0,0,100,100]),map={land:[],paths:[],buildings:[],provenance:'osm',notice:''} as MapData;
    const cover=addGreenGround(scene,map,data,{material});assert.equal(cover.stats.sourceTriangles,2);assert.ok(Math.abs(area(cover.meshes.map(m=>({key:m.name,positions:Array.from(m.getVerticesData('position')!),indices:Array.from(m.getIndices()!),normals:[],uvs:[]})))-16)<1e-5);
    for(const mesh of cover.meshes){assert.equal(mesh.material,material);assert.equal(mesh.checkCollisions,false);assert.equal(mesh.isPickable,false);const p=mesh.getVerticesData('position')!;for(let i=0;i<p.length;i+=3)assert.ok(Math.abs(p[i+1]-(3+Math.tan(.2)*(p[i]-20)+.012))<2e-6);}
    cover.dispose();assert.ok(scene.materials.includes(material),'the caller retains its material');assert.ok(scene.meshes.includes(ground)&&scene.meshes.includes(road),'source geometry remains owned by the city');
  }finally{scene.dispose();engine.dispose();}
});

test('invalid provenance, out-of-bounds geometry and resource limits fail closed',()=>{
  const data=dataFor([[square(1,1,9,9)]]),ground=plane(()=>0);
  assert.throws(()=>validateGreenGround({...data,source:{...data.source,license:'unknown'}}),/Provenienza/);
  assert.throws(()=>validateGreenGround({...data,areas:[...data.areas,...data.areas]}),/Identità/);
  assert.throws(()=>validateGreenGround({...data,coverage:[[square(-1,0,5,5)]]}),/perimetro/);
  assert.throws(()=>buildGreenGroundGeometry(data,[ground],{maxTriangles:1}),/budget/);
  assert.throws(()=>buildGreenGroundGeometry(data,[{positions:[NaN,0,0,10,0,0,10,0,10],indices:[0,1,2]}]),/non finito/);
  const reversed={...ground,indices:[0,2,1,0,3,2]};assert.equal(buildGreenGroundGeometry(data,[reversed]).stats.triangles,0,'downward faces are never covered');
  assert.equal(buildGreenGroundGeometry(data,[{positions:[1,0,1,1,10,1,1,10,9],indices:[0,1,2]}]).stats.triangles,0,'vertical faces are never covered');
});

test('committed Naples coverage is reproducible from the tagged OSM source alone',async()=>{
  const [raw,mapText,sourceText,savedText]=await Promise.all([readFile('data/napoli-green/source.raw.json'),readFile('public/data/map.json','utf8'),readFile('data/napoli-green/source.json','utf8'),readFile('public/data/green-ground.json','utf8')]);
  const result=prepareGreenGroundData(raw,JSON.parse(mapText),JSON.parse(sourceText)),saved=JSON.parse(savedText),before=Buffer.from(raw);
  assert.deepEqual(result,saved);assert.deepEqual(raw,before);assert.equal(result.areas.length,25);assert.equal(result.coverage.length,24);
  const taggedIds=new Set(JSON.parse(raw.toString()).elements.filter((e:{type:string;id:number;tags?:Record<string,string>})=>e.tags&&(e.tags.leisure==='park'||e.tags.natural==='wood'||e.tags.landuse==='forest')).map((e:{type:string;id:number})=>e.type+'/'+e.id));
  assert.ok(result.areas.every(a=>taggedIds.has(a.id)));assert.match(String(result.source.landCover),/artistic/);assert.match(String(result.source.geometry),/inner rings/);
});
