import '@babylonjs/core/Meshes/instancedMesh';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Vector2} from '@babylonjs/core/Maths/math.vector';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {DirectionalLight} from '@babylonjs/core/Lights/directionalLight';
import {HemisphericLight} from '@babylonjs/core/Lights/hemisphericLight';
import {ShadowGenerator} from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import {DynamicTexture} from '@babylonjs/core/Materials/Textures/dynamicTexture';
import {ShaderMaterial} from '@babylonjs/core/Materials/shaderMaterial';
import {Effect} from '@babylonjs/core/Materials/effect';
import earcut from 'earcut';
import {inside,segmentDistance,type MapData,type Point} from './geo';
export interface World { canStand:(x:number,z:number,radius?:number)=>boolean; shadows:ShadowGenerator; sea:ShaderMaterial; beacons:Mesh[]; }
export function createWorld(scene:Scene,data:MapData):World {
  scene.clearColor.set(0.75,0.84,0.85,1);scene.fogMode=Scene.FOGMODE_EXP2;scene.fogColor=new Color3(.75,.84,.85);scene.fogDensity=.0016;
  const hemi=new HemisphericLight('luce del cielo',new Vector3(0,1,0),scene);hemi.intensity=.8;hemi.groundColor=Color3.FromHexString('#706952');
  const sun=new DirectionalLight('sole',new Vector3(-.65,-1,-.45),scene);sun.position.set(95,145,80);sun.intensity=2.05;sun.diffuse=Color3.FromHexString('#ffe3b6');
  sun.shadowMinZ=1;sun.shadowMaxZ=350;sun.autoUpdateExtends=false;sun.orthoLeft=-130;sun.orthoRight=130;sun.orthoTop=150;sun.orthoBottom=-140;
  const shadows=new ShadowGenerator(2048,sun);shadows.usePercentageCloserFiltering=true;shadows.bias=.001;shadows.normalBias=.03;shadows.setDarkness(.25);
  const mat=(name:string,color:string)=>{const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(color);m.specularColor.set(.06,.06,.06);return m;};
  const stone=mat('tufo dorato','#bca784'),trim=mat('cornici calcare','#eadcc0'),dark=mat('ferro brunito','#354a47'),shutter=mat('persiane verde salvia','#41786e'),glass=mat('vetro in ombra','#344e55'),red=mat('terracotta','#bd6951'),cream=mat('tela avorio','#f4e6c6'),blue=mat('blu barca','#327a92'),leaf=mat('foglie','#658365');
  const paving=mat('basolato','#b9b0a0');
  const tex=new DynamicTexture('basoli originali',{width:512,height:512},scene,false);const ctx=tex.getContext();
  ctx.fillStyle='#b8afa0';ctx.fillRect(0,0,512,512);
  let seed=7;const rand=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
  for(let y=0;y<8;y++)for(let x=-1;x<9;x++){const v=Math.floor(160+rand()*28);ctx.fillStyle=`rgb(${v+11},${v+7},${v})`;ctx.fillRect(x*64+(y%2)*32+2,y*64+2,60,60);}
  tex.update();tex.uScale=25;tex.vScale=35;paving.diffuseTexture=tex;
  const prototypes=new Map<StandardMaterial,Mesh>();
  function box(name:string,x:number,y:number,z:number,w:number,h:number,d:number,m:StandardMaterial,solid=false,rotation=0){
    let base=prototypes.get(m);if(!base){base=MeshBuilder.CreateBox('modello '+m.name,{size:1},scene);base.material=m;base.position.y=-800;base.isPickable=false;base.receiveShadows=true;prototypes.set(m,base);}
    const b=base.createInstance(name);b.position.set(x,y,z);b.scaling.set(w,h,d);b.rotation.y=rotation;b.isPickable=solid;b.metadata={solid};if(solid)shadows.addShadowCaster(b);return b;
  }
  function cylinder(name:string,x:number,y:number,z:number,diameter:number,height:number,m:StandardMaterial){const b=MeshBuilder.CreateCylinder(name,{diameter,height,tessellation:12},scene);b.position.set(x,y,z);b.material=m;b.isPickable=false;return b;}
  const blockers:Array<{rings:Point[][]}>=[];
  const rect=(x:number,z:number,w:number,d:number)=>blockers.push({rings:[[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]]]});
  for(const [i,ring] of data.land.entries()) {
    const ground=MeshBuilder.ExtrudePolygon('banchina '+i,{shape:ring.map(p=>new Vector3(p[0],0,p[1])),depth:2,sideOrientation:Mesh.DOUBLESIDE},scene,earcut);ground.position.y=0;ground.material=paving;ground.receiveShadows=true;ground.metadata={solid:true};
    ring.forEach((a,j)=>{const b=ring[(j+1)%ring.length];const length=Math.hypot(b[0]-a[0],b[1]-a[1]);box('bordo di pietra',(a[0]+b[0])/2,.14,(a[1]+b[1])/2,.6,.28,length,trim,false,Math.atan2(b[0]-a[0],b[1]-a[1]));});
  }
  // Sea: original animated shader, generated locally and bundled, no remote textures.
  Effect.ShadersStore['mareVertexShader']=`precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;uniform float time;varying vec3 p;void main(){p=position;p.y+=sin(p.x*.08+time*.5)*.15+cos(p.z*.06+time*.4)*.12;gl_Position=worldViewProjection*vec4(p,1.);}`;
  Effect.ShadersStore['mareFragmentShader']=`precision highp float;varying vec3 p;uniform float time;void main(){float s=sin(p.x*.68+p.z*.32+time)*sin(p.z*.46-time*.7);float wave=sin(p.x*.09+p.z*.06+time*.3);float shine=pow(max(0.,s),22.);vec3 c=mix(vec3(.08,.36,.43),vec3(.24,.57,.60),.5+wave*.12);c+=shine*.17;float fog=1.-exp(-length(p.xz)*.0011);gl_FragColor=vec4(mix(c,vec3(.75,.84,.85),fog),1.);}`;
  const sea=new ShaderMaterial('mare',scene,{vertex:'mare',fragment:'mare'},{attributes:['position'],uniforms:['worldViewProjection','time']});sea.setFloat('time',0);sea.backFaceCulling=false;
  const water=MeshBuilder.CreateGround('Golfo di Napoli',{width:2400,height:2400,subdivisions:100},scene);water.position.y=-1.3;water.material=sea;water.isPickable=false;
  // Distant, stylized Vesuvius silhouette.
  const mountainMat=mat('orizzonte azzurro','#92aaae');for(const [x,z,s,h] of [[-390,-650,340,96],[-180,-730,430,75],[290,-760,330,38]]){const m=MeshBuilder.CreateCylinder('profilo lontano',{diameterBottom:s,diameterTop:s*.16,height:h,tessellation:9},scene);m.position.set(x,h/2-15,z);m.material=mountainMat;m.isPickable=false;}
  const plaster=['#e0bd90','#d9c6a6','#cd977c','#ead6af','#dfb58e','#d7bca0'].map((c,i)=>mat('intonaco '+i,c));
  for(const [index,b] of data.buildings.entries()) {
    blockers.push(b);
    const mesh=MeshBuilder.ExtrudePolygon('edificio '+b.id,{shape:b.rings[0].map(p=>new Vector3(p[0],0,p[1])),holes:b.rings.slice(1).map(r=>r.map(p=>new Vector3(p[0],0,p[1]))),depth:b.height,sideOrientation:Mesh.DOUBLESIDE},scene,earcut);mesh.position.y=b.height;mesh.material=plaster[index%plaster.length];mesh.metadata={solid:true};shadows.addShadowCaster(mesh);mesh.receiveShadows=true;
    for(const ring of b.rings)ring.forEach((a,i)=>{
      const q=ring[(i+1)%ring.length],length=Math.hypot(q[0]-a[0],q[1]-a[1]);if(length<2)return;
      const yaw=Math.atan2(q[0]-a[0],q[1]-a[1]),nx=Math.cos(yaw),nz=-Math.sin(yaw);
      box('cornicione',(a[0]+q[0])/2,b.height+.18,(a[1]+q[1])/2,.5,.4,length+.4,trim,false,yaw);
      for(let y=3;y<b.height-1;y+=3.4)for(let t=2;t<length-1;t+=3.6){const x=a[0]+(q[0]-a[0])*t/length,z=a[1]+(q[1]-a[1])*t/length;
        box('finestra',x+nx*.05,y,z+nz*.05,.18,1.65,1.3,glass,false,yaw);
        box('persiana',x+nx*.18+Math.sin(yaw)*.91,y,z+nz*.18+Math.cos(yaw)*.91,.14,1.8,.4,shutter,false,yaw);
        box('persiana',x+nx*.18-Math.sin(yaw)*.91,y,z+nz*.18-Math.cos(yaw)*.91,.14,1.8,.4,shutter,false,yaw);
        if(t%7<4){box('balcone',x+nx*.52,y-1,z+nz*.52,1.1,.18,2.1,trim,false,yaw);box('ringhiera',x+nx*1.04,y-.6,z+nz*1.04,.07,.7,2.1,dark,false,yaw);}
      }
    });
  }
  // Castel dell'Ovo: original composed volumes, towers, terraces and crenellations.
  const cx=-30,cz=-31;
  for(const [ox,oz,w,d,h] of [[0,0,35,72,17],[-5,-25,34,23,23],[3,18,31,28,24],[-12,29,14,18,29],[12,-8,12,28,21]]){
    box('corpo del castello',cx+ox,h/2,cz+oz,w,h,d,stone,true);rect(cx+ox,cz+oz,w,d);
    box('terrazza',cx+ox,h+.25,cz+oz,w+.8,.5,d+.8,trim);
    for(let x=-w/2+1;x<w/2;x+=2.8)for(const edge of [-1,1])box('merlo',cx+ox+x,h+1,cz+oz+edge*d/2,1.3,1.6,1.2,stone);
    for(let z=-d/2+2;z<d/2;z+=3)for(const edge of [-1,1])box('merlo',cx+ox+edge*w/2,h+1,cz+oz+z,1.2,1.6,1.3,stone);
    for(let z=-d/2+4;z<d/2;z+=7)box('feritoia',cx+ox+w/2+.05,10,cz+oz+z,.1,1.7,.65,dark);
  }
  box('arco ingresso',-11,3,13,.2,5.4,4,dark);box('rampa',-7,.5,14,5,1,12,stone);
  const flagpole=cylinder('asta',-40,34,1,.15,12,dark);flagpole.isPickable=false;box('bandiera',-38.8,38,1,2.4,1.4,.07,red);
  function sign(text:string,x:number,y:number,z:number,w=7,angle=0){
    const t=new DynamicTexture('insegna '+text,{width:768,height:192},scene,false);const c=t.getContext();c.fillStyle='#214943';c.fillRect(0,0,768,192);c.strokeStyle='#e9cf92';c.lineWidth=7;c.strokeRect(12,12,744,168);t.drawText(text,null,122,'bold 66px Georgia','#faedcf',null,true,true);
    const m=mat(text,'#ffffff');m.diffuseTexture=t;m.emissiveColor=new Color3(.16,.16,.12);
    const p=MeshBuilder.CreatePlane(text,{width:w,height:w/4,sideOrientation:Mesh.DOUBLESIDE},scene);p.position.set(x,y,z);p.rotation.y=angle;p.material=m;p.isPickable=false;
  }
  sign('CAFFÈ DEL BORGO',-12,3.3,57.95,12);sign('BORGO MARINARI',-1,4,88,9);
  // Bar kiosk on the open square, close to the pickup marker.
  box('chiosco',29,1.5,66,8,3,4,plaster[0],true);rect(29,66,8,4);box('bancone',29,1.1,63.7,7,1.2,.6,shutter);box('tenda',29,3.1,62.5,9,.25,5,cream);sign('UN CAFFÈ AL VOLO',29,2.5,63.2,7);
  function plant(x:number,z:number){cylinder('vaso',x,.4,z,.9,.8,red);const crown=MeshBuilder.CreateSphere('agave',{diameter:1.6,segments:5},scene);crown.position.set(x,1.1,z);crown.scaling.y=.9;crown.material=leaf;crown.isPickable=false;}
  for(const [x,z] of [[22,63],[35,63],[7,50],[8,21],[8,5],[35,-22],[-52,52],[-52,68]])plant(x,z);
  for(const [x,z] of [[-6,55],[0,56],[4,65],[32,48],[34,54]]){
    cylinder('tavolino',x,.92,z,1.7,.12,cream);cylinder('gamba',x,.45,z,.12,.9,dark);
    for(const side of [-1,1]){box('seduta',x+side*1.2,.5,z,.65,.14,.65,shutter);box('schienale',x+side*1.45,.95,z,.13,.8,.65,shutter);}
    const umbrella=MeshBuilder.CreateCylinder('ombrellone',{diameterBottom:4.2,diameterTop:.15,height:.65,tessellation:8},scene);umbrella.position.set(x,3,z);umbrella.material=cream;umbrella.isPickable=false;cylinder('asta ombrellone',x,1.5,z,.08,3,dark);
  }
  // Quay bollards and lamps. Obstacles match their visible footprints.
  for(let z=-55;z<82;z+=13){cylinder('bitta',59,.4,z,.7,.8,dark);rect(59,z,.7,.7);}
  for(const [x,z] of [[54,65],[54,27],[54,-14],[54,-52],[-3,104]]){
    cylinder('lampione',x,2.6,z,.16,5.2,dark);const lamp=MeshBuilder.CreateSphere('lanterna',{diameter:.65,segments:6},scene);lamp.position.set(x,5.3,z);lamp.material=cream;lamp.isPickable=false;
  }
  box('pontile',74,-.2,5,24,.7,3,red);box('pontile',74,-.2,-25,24,.7,3,red);
  for(let i=0;i<9;i++){
    const x=73+(i%3)*11,z=16-Math.floor(i/3)*29;const root=new TransformNode('barca',scene);root.position.set(x,-.5,z);root.rotation.y=.2+i*.19;
    const hull=MeshBuilder.CreateSphere('scafo',{diameter:1,segments:6},scene);hull.scaling.set(3,.9,7);hull.parent=root;hull.material=i%2?cream:blue;hull.isPickable=false;
    const deck=MeshBuilder.CreateBox('coperta',{width:2.5,height:.18,depth:5},scene);deck.parent=root;deck.position.y=.55;deck.material=cream;deck.isPickable=false;
    if(i%2){const mast=MeshBuilder.CreateCylinder('albero',{diameter:.09,height:9,tessellation:6},scene);mast.parent=root;mast.position.y=5;mast.material=dark;mast.isPickable=false;}
  }
  const beacons:Mesh[]=[];
  for(const [i,x,z] of [[0,27,59],[1,47,-47]]){
    const m=mat('indicatore '+i,i?'#edb859':'#df8b5c');m.emissiveColor=m.diffuseColor.scale(.55);
    const ring=MeshBuilder.CreateTorus('punto missione',{diameter:3.4,thickness:.1,tessellation:32},scene);ring.position.set(x,.08,z);ring.material=m;ring.isPickable=false;
    const beacon=MeshBuilder.CreateCylinder('segnale',{diameterTop:0,diameterBottom:.7,height:1.3,tessellation:4},scene);beacon.position.set(x,3.6,z);beacon.rotation.z=Math.PI;beacon.material=m;beacon.isPickable=false;beacons.push(beacon);
  }
  function canStand(x:number,z:number,r=.55){
    const p:Point=[x,z];
    if(!data.land.some(ring=>inside(p,ring)&&ring.every((a,i)=>segmentDistance(p,a,ring[(i+1)%ring.length])>r)))return false;
    return !blockers.some(b=>{
      const inSolid=inside(p,b.rings[0])&&!b.rings.slice(1).some(h=>inside(p,h));
      return inSolid||b.rings.some(ring=>ring.some((a,i)=>segmentDistance(p,a,ring[(i+1)%ring.length])<r));
    });
  }
  return {canStand,shadows,sea,beacons};
}
