// Public Regione Campania CTR2020 DTM crop. Never uses the rendered hillshade.
// Run after installing geotiff@2.1.3 under work/ctr-deps (research workflow only).
import {mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fromArrayBuffer} from '../work/ctr-deps/node_modules/geotiff/dist-module/geotiff.js';

const dir='data/napoli-dtm-2020';
const base='https://geomaps.regione.campania.it';
const raster=base+'/server/rest/services/DG5009/CTR2020_DTM5K_tif/ImageServer';
const wcs=base+'/server/services/DG5009/CTR2020_DTM5K_tif/ImageServer/WCSServer';
await mkdir(dir,{recursive:true});
let requests=0;
async function get(url,limit=1024*1024){
  if(++requests>8)throw Error('Public request budget exceeded');
  const r=await fetch(url,{signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw Error('HTTP '+r.status+' at '+url);
  const parts=[];let bytes=0;
  for await(const part of r.body){bytes+=part.length;if(bytes>limit)throw Error('Response byte budget exceeded');parts.push(part);}
  return Buffer.concat(parts);
}
async function json(url){const j=JSON.parse((await get(url)).toString('utf8'));if(j.error)throw Error(JSON.stringify(j.error));return j;}
async function save(name,data){await writeFile(dir+'/'+name,typeof data==='string'?data:JSON.stringify(data,null,2)+'\n');}
const service=await json(raster+'?f=json');await save('service-metadata.json',service);
const keys=await json(raster+'/keyProperties?f=json');await save('key-properties.json',keys);console.log('DTM_KEY_PROPERTIES='+JSON.stringify(keys));
const coverage=(await get(wcs+'?SERVICE=WCS&REQUEST=DescribeCoverage&VERSION=1.0.0&COVERAGE=Campania_DTM5K')).toString('utf8');
await save('wcs-coverage.xml',coverage);console.log('DTM_WCS_COVERAGE='+JSON.stringify(coverage));
const params=new URLSearchParams({f:'json',bbox:'14.241,40.826,14.266,40.842',bboxSR:'4326',imageSR:'4326',size:'401,357',format:'tiff',pixelType:'F32',noData:'0',noDataInterpretation:'esriNoDataMatchAny',interpolation:'RSP_NearestNeighbor',adjustAspectRatio:'false',renderingRule:JSON.stringify({rasterFunction:'None'})});
const exportUrl=raster+'/exportImage?'+params;
const exported=await json(exportUrl);await save('export-response.json',exported);
const download=new URL(exported.href);if(download.hostname!=='geomaps.regione.campania.it')throw Error('Unexpected export host');
const bytes=await get(download.href,2*1024*1024);await writeFile(dir+'/napoli-dtm.tif',bytes);
const sha256=createHash('sha256').update(bytes).digest('hex');
const tiff=await fromArrayBuffer(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
const image=await tiff.getImage();const fd=image.fileDirectory;
const geoKeys=image.getGeoKeys();
if(image.getWidth()!==401||image.getHeight()!==357||image.getSamplesPerPixel()!==1||fd.SampleFormat?.[0]!==3||fd.BitsPerSample?.[0]!==32)throw Error('Export is not the requested single-band F32 raster');
if(geoKeys.GeographicTypeGeoKey!==4326)throw Error('Unexpected geographic output CRS');
// ArcGIS emits legitimate sparse TIFF tiles (offset=count=0) for sea nodata.
// geotiff2.1.3 does not expand them, so decode each present tile explicitly.
let band,sparseTiles=0;
if(fd.TileOffsets&&fd.TileByteCounts){
  const width=image.getWidth(),height=image.getHeight(),tw=fd.TileWidth,th=fd.TileLength;
  const columns=Math.ceil(width/tw),rows=Math.ceil(height/th);
  if(fd.TileOffsets.length!==columns*rows||fd.TileByteCounts.length!==columns*rows)throw Error('Invalid TIFF tile directory');
  band=new Float32Array(width*height);
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){
    const index=y*columns+x;
    if(fd.TileByteCounts[index]===0&&fd.TileOffsets[index]===0){sparseTiles++;continue;}
    if(fd.TileOffsets[index]<=0||fd.TileByteCounts[index]<=0||fd.TileOffsets[index]+fd.TileByteCounts[index]>bytes.length)throw Error('Invalid nonempty TIFF tile');
    const x0=x*tw,y0=y*th,x1=Math.min(x0+tw,width),y1=Math.min(y0+th,height);
    const [tile]=await image.readRasters({samples:[0],window:[x0,y0,x1,y1]});
    if(!(tile instanceof Float32Array))throw Error('Decoded tile is not Float32Array');
    for(let row=0;row<y1-y0;row++)band.set(tile.subarray(row*(x1-x0),(row+1)*(x1-x0)),(y0+row)*width+x0);
  }
}else [band]=await image.readRasters({samples:[0]});
if(!(band instanceof Float32Array))throw Error('Decoded band is not Float32Array');
const noData=image.getGDALNoData();
const samples=Array.from(band,v=>Number.isFinite(v)&&v!==noData&&v!==0?Math.round(v*100)/100:null);
const valid=samples.filter(v=>v!==null),min=valid.reduce((a,b)=>Math.min(a,b),Infinity),max=valid.reduce((a,b)=>Math.max(a,b),-Infinity);
if(valid.length<10000||min< -10||max>500||max-min<30)throw Error('Implausible Naples raw height crop');
const bounds=image.getBoundingBox();
const grid={version:1,width:image.getWidth(),height:image.getHeight(),bounds:{west:bounds[0],south:bounds[1],east:bounds[2],north:bounds[3]},rowOrder:'north-to-south',sampleLocation:'pixel-center',sourceUnits:'unverified',verticalDatum:null,noData:null,heights:samples};
await save('raw-source-grid.json',grid);
const source={provider:'Regione Campania — Sistema Informativo Territoriale',dataset:'CTR2020 — DTM5K',sourceYear:2020,sourceUrl:raster,portalItem:base+'/portal/home/item.html?id=aaff40e0c82d4239bfaf2a776c735b67',license:'CC BY 4.0',licenseDeclaration:'https://sit.regione.campania.it/carta-tecnica-regionale',acquiredAt:new Date().toISOString(),nativePixelSize:5,nativeCrs:service.spatialReference,exportUrl,exportPixelType:'F32',rasterFunction:'None',sha256,verticalDatum:null,verticalUnits:null,activation:'research-only; vertical units not yet certified'};
await save('source.json',source);
const validation={sha256,byteLength:bytes.length,decodedPixelType:'Float32Array',sampleFormat:fd.SampleFormat,bitsPerSample:fd.BitsPerSample,geoKeys,width:image.getWidth(),height:image.getHeight(),bounds,noData,validPixels:valid.length,noDataPixels:samples.length-valid.length,sparseTiles,min,max,precision:'JSON rounded to0.01 source units; original float32 TIFF retained',requests,verticalUnitsVerified:false};
await save('validation.json',validation);
const unitEvidence={type:'governing-specification',specification:'INTESA GIS — Prescrizioni Tecniche per la produzione di Modelli Digitali del Terreno, versione16I,29Apr2001',specificationUrl:'https://www.giseqgis.it/images/pdf_Normative/2001_04_29_INTESAGIS_DTM16I_Spec_Apr01_it.pdf',section:'1.4.2 starts on printed page 12; explicit raster ASCII metre unit statement on printed page 13 (PDF page 12). At most two decimals does not imply centimetre accuracy.',campaniaTenderUrl:'https://burc.regione.campania.it/eBurcWeb/directServlet?ATTACH_ID=192608&DOCUMENT_ID=00128976',tenderSections:'4.3–4.3.2, Allegato A printed page 16 (PDF page 41): updated 5 m ground DTM must comply with Level 3 of this specification; ASCII output required.',specificationHost:'Third-party mirror of the primary specification; not an official government host.',serviceUnitDeclaration:null,limitation:'The service has no explicit band-unit or verticaldatum declaration. Metre scale follows its governing specification and agrees numerically with same-source regional ground heights; this is not independent survey certification.'};
await save('vertical-reference-review.json',{unitEvidence,verticalDatum:null,relativeOnly:true,seaLevelConstraint:false,scaleExaggeration:1,decision:'Only local relative elevations, with opening-street rasterheight subtracted. Do not label values MSL,EGM96,ellipsoidal or orthometric.',quality:'Native5m ground DTM does not resolve all road surfaces,stairs,bridges or walls. Its requiredLevel3 precision is around1m; storing twodecimals does not imply centimetreaccuracy.'});
await save('relative-grid.json',{...grid,sourceUnits:'metres',relativeOnly:true,unitEvidence,source:{provider:source.provider,dataset:source.dataset,sourceYear:source.sourceYear,url:source.sourceUrl,sha256,license:source.license}});
await save('LICENSE-NOTICE.md','# Regione Campania CTR2020 DTM\n\nSource: '+raster+'\n\nRegione Campania publishes CTR, DBT and DTM updated to2020 under Creative Commons Attribution4.0: https://sit.regione.campania.it/carta-tecnica-regionale . This crop preserves raw source pixels in napoli-dtm.tif; JSON is reprojected/resampled and rounded to0.01 source units. No vertical datum or unit declaration is inferred from the horizontal CRS. Research data is not activated in gameplay.\n');
console.log('DTM_CROP_VALIDATION='+JSON.stringify(validation));
