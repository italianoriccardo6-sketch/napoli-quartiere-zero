import '@babylonjs/core/Meshes/instancedMesh';
import {Scene} from '@babylonjs/core/scene';
import {Mesh} from '@babylonjs/core/Meshes/mesh';
import {MeshBuilder} from '@babylonjs/core/Meshes/meshBuilder';
import {StandardMaterial} from '@babylonjs/core/Materials/standardMaterial';
import {Color3} from '@babylonjs/core/Maths/math.color';
import {Vector3} from '@babylonjs/core/Maths/math.vector';
import {Vector4} from '@babylonjs/core/Maths/math.vector';
import {VertexData} from '@babylonjs/core/Meshes/mesh.vertexData';
import {ImageProcessingConfiguration} from '@babylonjs/core/Materials/imageProcessingConfiguration';
import {createSurface} from './surfaces';
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
  scene.clearColor.set(.69,.79,.83,1);scene.fogMode=Scene.FOGMODE_EXP2;scene.fogColor=new Color3(.69,.79,.83);scene.fogDensity=.00115;
  scene.imageProcessingConfiguration.toneMappingEnabled=true;
  scene.imageProcessingConfiguration.toneMappingType=ImageProcessingConfiguration.TONEMAPPING_ACES;
  scene.imageProcessingConfiguration.exposure=1.05;scene.imageProcessingConfiguration.contrast=1.08;
  const hemi=new HemisphericLight('luce del cielo',new Vector3(0,1,0),scene);hemi.intensity=.62;hemi.diffuse=Color3.FromHexString('#d7e7ef');hemi.groundColor=Color3.FromHexString('#70634f');
  const sun=new DirectionalLight('sole',new Vector3(-.8,-.72,-.38),scene);sun.position.set(95,145,80);sun.intensity=1.85;sun.diffuse=Color3.FromHexString('#ffdfb1');
  sun.shadowMinZ=1;sun.shadowMaxZ=350;sun.autoUpdateExtends=false;sun.orthoLeft=-130;sun.orthoRight=130;sun.orthoTop=150;sun.orthoBottom=-140;
  const shadows=new ShadowGenerator(2048,sun);shadows.usePercentageCloserFiltering=true;shadows.bias=.001;shadows.normalBias=.03;shadows.setDarkness(.25);
  const mat=(name:string,color:string)=>{const m=new StandardMaterial(name,scene);m.diffuseColor=Color3.FromHexString(color);m.specularColor.set(.06,.06,.06);return m;};
  const stoneSurface=createSurface(scene,'tufo con giunti','stone','#aa9677',17);
  const pavingSurface=createSurface(scene,'basolato vulcanico','paving','#777a74',61);
  const plasterSurfaces=['#c6aa83','#c5bba7','#ae8571','#d4c4a6','#c1a18a','#baa992'].map((color,i)=>createSurface(scene,'intonaco vissuto '+i,'plaster',color,200+i));
  plasterSurfaces.forEach(({albedo,bump})=>{albedo.uScale=bump.uScale=2;albedo.vScale=bump.vScale=2;});
  const stone=stoneSurface.material,trim=mat('cornici calcare','#d8cbb1'),dark=mat('ferro brunito','#283b3a'),shutter=mat('persiane verde scuro','#315d54'),glass=mat('vetro in ombra','#293e48'),red=mat('terracotta','#a85c43'),cream=mat('tela avorio','#dfd3b4'),blue=mat('blu barca','#326477'),leaf=mat('foglie','#526c47');
  glass.specularColor=new Color3(.4,.48,.5);glass.specularPower=100;
  const paving=pavingSurface.material;
  const prototypes=new Map<StandardMaterial,Mesh>();
  function box(name:string,x:number,y:number,z:number,w:number,h:number,d:number,m:StandardMaterial,solid=false,rotation=0){
    if(solid&&m===stone){
      const uv=(width:number,height:number)=>new Vector4(0,0,width/2.4,height/3);
      const b=MeshBuilder.CreateBox(name,{width:w,height:h,depth:d,faceUV:[uv(w,h),uv(w,h),uv(d,h),uv(d,h),uv(w,d),uv(w,d)]},scene);
      b.position.set(x,y,z);b.rotation.y=rotation;b.material=m;b.metadata={solid:true};b.receiveShadows=true;shadows.addShadowCaster(b);return b;
    }
    let base=prototypes.get(m);if(!base){base=MeshBuilder.CreateBox('modello '+m.name,{size:1},scene);base.material=m;base.position.y=-800;base.isPickable=false;base.receiveShadows=true;prototypes.set(m,base);}
    const b=base.createInstance(name);b.position.set(x,y,z);b.scaling.set(w,h,d);b.rotation.y=rotation;b.isPickable=solid;b.metadata={solid};if(solid)shadows.addShadowCaster(b);return b;
  }
  function cylinder(name:string,x:number,y:number,z:number,diameter:number,height:number,m:StandardMaterial){const b=MeshBuilder.CreateCylinder(name,{diameter,height,tessellation:12},scene);b.position.set(x,y,z);b.material=m;b.isPickable=false;return b;}
  const blockers:Array<{rings:Point[][]}>=[];
  const rect=(x:number,z:number,w:number,d:number)=>blockers.push({rings:[[[x-w/2,z-d/2],[x+w/2,z-d/2],[x+w/2,z+d/2],[x-w/2,z+d/2]]]});
  for(const [i,ring] of data.land.entries()) {
    const ground=MeshBuilder.ExtrudePolygon('banchina '+i,{shape:ring.map(p=>new Vector3(p[0],0,p[1])),depth:2,sideOrientation:Mesh.DOUBLESIDE},scene,earcut);ground.position.y=0;ground.material=paving;ground.receiveShadows=true;ground.metadata={solid:true};
    const positions=ground.getVerticesData('position')!,uvs=ground.getVerticesData('uv')!;
    for(let v=0;v<positions.length/3;v++){uvs[v*2]=positions[v*3]/3.2;uvs[v*2+1]=positions[v*3+2]/4;}ground.setVerticesData('uv',uvs);
    ring.forEach((a,j)=>{const b=ring[(j+1)%ring.length];const length=Math.hypot(b[0]-a[0],b[1]-a[1]);box('bordo di pietra',(a[0]+b[0])/2,.14,(a[1]+b[1])/2,.6,.28,length,trim,false,Math.atan2(b[0]-a[0],b[1]-a[1]));});
  }
  // An original analytic sky/sea model: visual atmosphere, not a photograph or geographic reconstruction.
  Effect.ShadersStore['cieloVertexShader']=`precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;varying vec3 direction;void main(){direction=normalize(position);gl_Position=worldViewProjection*vec4(position,1.);}`;
  Effect.ShadersStore['cieloFragmentShader']=`precision highp float;varying vec3 direction;void main(){vec3 d=normalize(direction);float elevation=max(d.y,0.);vec3 horizon=vec3(.73,.80,.80);vec3 zenith=vec3(.28,.48,.62);vec3 c=mix(horizon,zenith,pow(elevation,.55));vec3 sun=normalize(vec3(.8,.72,.38));float glow=pow(max(dot(d,sun),0.),18.);float disc=smoothstep(.99945,.99965,dot(d,sun));c+=vec3(.23,.16,.07)*glow+vec3(.5,.39,.19)*disc;float cloud=sin(d.x*31.+d.z*18.)+sin(d.x*19.-d.z*30.)*.5;float band=smoothstep(.18,.3,d.y)*(1.-smoothstep(.34,.53,d.y));c=mix(c,vec3(.84,.85,.81),smoothstep(.45,1.15,cloud)*band*.15);gl_FragColor=vec4(c,1.);}`;
  const skyMat=new ShaderMaterial('cielo originale',scene,{vertex:'cielo',fragment:'cielo'},{attributes:['position'],uniforms:['worldViewProjection']});skyMat.backFaceCulling=false;skyMat.disableDepthWrite=true;
  const sky=MeshBuilder.CreateSphere('cielo',{diameter:2200,segments:24},scene);sky.material=skyMat;sky.isPickable=false;sky.infiniteDistance=true;
  Effect.ShadersStore['mareVertexShader']=`precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;uniform mat4 world;uniform float time;varying vec3 p;varying vec3 worldP;void main(){p=position;p.y+=sin(p.x*.075+time*.65)*.10+cos(p.z*.11-time*.48)*.075;worldP=(world*vec4(p,1.)).xyz;gl_Position=worldViewProjection*vec4(p,1.);}`;
  Effect.ShadersStore['mareFragmentShader']=`precision highp float;varying vec3 p;varying vec3 worldP;uniform float time;uniform vec3 cameraPosition;void main(){float nx=cos(p.x*.075+time*.65)*.03+sin(p.x*.81+p.z*.56+time*1.2)*.08;float nz=-sin(p.z*.11-time*.48)*.035+cos(p.x*.39-p.z*.91-time*.8)*.065;vec3 n=normalize(vec3(-nx,1.,-nz));vec3 v=normalize(cameraPosition-worldP);float fresnel=.035+.965*pow(1.-max(dot(n,v),0.),5.);vec3 reflected=reflect(-v,n);vec3 sky=mix(vec3(.68,.76,.76),vec3(.3,.5,.61),max(reflected.y,0.));vec3 water=vec3(.075,.285,.32);float ripple=sin(p.x*.12+p.z*.07+time*.3)*.5+.5;water+=ripple*vec3(.015,.035,.025);vec3 c=mix(water,sky,fresnel);vec3 sun=normalize(vec3(.8,.72,.38));float glint=pow(max(dot(reflect(-sun,n),v),0.),100.);c+=vec3(.8,.62,.33)*glint*.65;float fog=1.-exp(-length(cameraPosition-worldP)*.00105);gl_FragColor=vec4(mix(c,vec3(.69,.79,.83),fog),1.);}`;
  const sea=new ShaderMaterial('mare',scene,{vertex:'mare',fragment:'mare'},{attributes:['position'],uniforms:['worldViewProjection','world','time','cameraPosition']});sea.setFloat('time',0);sea.setVector3('cameraPosition',new Vector3(0,4,0));sea.backFaceCulling=false;
  scene.onBeforeRenderObservable.add(()=>{if(scene.activeCamera)sea.setVector3('cameraPosition',scene.activeCamera.globalPosition);});
  const water=MeshBuilder.CreateGround('Golfo di Napoli',{width:2400,height:2400,subdivisions:120},scene);water.position.y=-1.3;water.material=sea;water.isPickable=false;
  // Hand-authored distant profile replaces the placeholder cones. It is an approximate backdrop.
  const mountainMat=mat('profilo lontano nella foschia','#8da3a7');mountainMat.disableLighting=true;mountainMat.emissiveColor=Color3.FromHexString('#8da3a7');mountainMat.backFaceCulling=false;
  const ridge=new Mesh('profilo vulcanico approssimativo',scene);
  const profile=[[-650,-12],[-490,1],[-350,19],[-260,34],[-185,60],[-120,88],[-72,79],[-20,71],[20,83],[72,63],[130,42],[220,17],[350,1],[600,-9]];
  const points:number[]=[],indices:number[]=[];
  profile.forEach(([x,y])=>points.push(x,y,-980));points.push(600,-30,-980,-650,-30,-980);
  for(let i=1;i<profile.length+1;i++)indices.push(0,i,i+1);
  const ridgeData=new VertexData();ridgeData.positions=points;ridgeData.indices=indices;const normals:number[]=[];VertexData.ComputeNormals(points,indices,normals);ridgeData.normals=normals;ridgeData.applyToMesh(ridge);ridge.material=mountainMat;ridge.isPickable=false;
  const plaster=plasterSurfaces.map(s=>s.material);
  for(const [index,b] of data.buildings.entries()) {
    blockers.push(b);
    const mesh=MeshBuilder.ExtrudePolygon('edificio '+b.id,{shape:b.rings[0].map(p=>new Vector3(p[0],0,p[1])),holes:b.rings.slice(1).map(r=>r.map(p=>new Vector3(p[0],0,p[1]))),depth:b.height,sideOrientation:Mesh.DOUBLESIDE},scene,earcut);mesh.position.y=b.height;mesh.material=plaster[index%plaster.length];mesh.metadata={solid:true};shadows.addShadowCaster(mesh);mesh.receiveShadows=true;
    for(const ring of b.rings)ring.forEach((a,i)=>{
      const q=ring[(i+1)%ring.length],length=Math.hypot(q[0]-a[0],q[1]-a[1]);if(length<2)return;
      const yaw=Math.atan2(q[0]-a[0],q[1]-a[1]),nx=Math.cos(yaw),nz=-Math.sin(yaw);
      box('cornicione',(a[0]+q[0])/2,b.height+.18,(a[1]+q[1])/2,.5,.4,length+.4,trim,false,yaw);
      box('zoccolo in pietra',(a[0]+q[0])/2+nx*.04,.42,(a[1]+q[1])/2+nz*.04,.22,.84,length,stone,false,yaw);
      box('fascia sotto il tetto',(a[0]+q[0])/2+nx*.06,b.height-.6,(a[1]+q[1])/2+nz*.06,.22,.15,length+.2,trim,false,yaw);
      if(length>7){const x=(a[0]+q[0])/2,z=(a[1]+q[1])/2;
        box('portone',x+nx*.06,1.25,z+nz*.06,.12,2.5,1.55,dark,false,yaw);
        for(const side of [-1,1])box('stipite',x+nx*.16+Math.sin(yaw)*side*.86,1.32,z+nz*.16+Math.cos(yaw)*side*.86,.23,2.65,.18,trim,false,yaw);
        box('architrave',x+nx*.16,2.72,z+nz*.16,.24,.2,1.9,trim,false,yaw);
      }
      for(let y=3;y<b.height-1;y+=3.4)for(let t=2;t<length-1;t+=3.6){const x=a[0]+(q[0]-a[0])*t/length,z=a[1]+(q[1]-a[1])*t/length;
        box('finestra',x+nx*.05,y,z+nz*.05,.18,1.65,1.3,glass,false,yaw);
        box('davanzale',x+nx*.18,y-.89,z+nz*.18,.38,.15,1.7,trim,false,yaw);
        box('cornice finestra',x+nx*.12,y+.89,z+nz*.12,.25,.13,1.6,trim,false,yaw);
        box('montante',x+nx*.16,y,z+nz*.16,.04,1.65,.055,trim,false,yaw);
        box('traverso',x+nx*.17,y+.12,z+nz*.17,.04,.05,1.3,trim,false,yaw);
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
    cylinder('piattino',x+.3,1.01,z+.1,.2,.025,cream);cylinder('tazzina',x+.3,1.08,z+.1,.11,.12,cream);cylinder('caffè',x+.3,1.142,z+.1,.08,.005,dark);
    for(const side of [-1,1]){box('seduta',x+side*1.2,.5,z,.65,.14,.65,shutter);box('schienale',x+side*1.45,.95,z,.13,.8,.65,shutter);
      for(const dx of [-.24,.24])for(const dz of [-.24,.24])box('gamba sedia',x+side*1.2+dx,.23,z+dz,.045,.46,.045,dark);}
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
    const rope=MeshBuilder.CreateLines('cima di ormeggio',{points:[new Vector3(x-1,.15,z-2),new Vector3(72,.1,z-2),new Vector3(63,.1,z-2)]},scene);rope.color=Color3.FromHexString('#9c9b80');rope.isPickable=false;
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
