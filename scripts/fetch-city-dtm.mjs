// Public Regione Campania CTR2020 DTM crop. Never uses the rendered hillshade.
// Run after installing geotiff@2.1.3 under work/ctr-deps (research workflow only).
import {mkdir, writeFile, readFile} from 'node:fs/promises';
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
const [band]=await image.readRasters({samples:[0]});
if(!(band instanceof Float32Array))throw Error('Decoded band is not Float32Array');
const noData=image.getGDALNoData();
const samples=Array.from(band,v=>Number.isFinite(v)&&v!==noData&&v!==0?Math.round(v*100)/100:null);
const valid=samples.filter(v=>v!==null),min=Math.min(...valid),max=Math.max(...valid);
if(valid.length<10000||min< -10||max>500||max-min<30)throw Error('Implausible Naples raw height crop');
const bounds=image.getBoundingBox();
const grid={version:1,width:image.getWidth(),height:image.getHeight(),bounds:{west:bounds[0],south:bounds[1],east:bounds[2],north:bounds[3]},rowOrder:'north-to-south',sampleLocation:'pixel-center',sourceUnits:'unverified',verticalDatum:null,noData:null,heights:samples};
await save('raw-source-grid.json',grid);
const source={provider:'Regione Campania — Sistema Informativo Territoriale',dataset:'CTR2020 — DTM5K',sourceYear:2020,sourceUrl:raster,portalItem:base+'/portal/home/item.html?id=aaff40e0c82d4239bfaf2a776c735b67',license:'CC BY 4.0',licenseDeclaration:'https://sit.regione.campania.it/carta-tecnica-regionale',acquiredAt:new Date().toISOString(),nativePixelSize:5,nativeCrs:service.spatialReference,exportUrl,exportPixelType:'F32',rasterFunction:'None',sha256,verticalDatum:null,verticalUnits:null,activation:'research-only; vertical units not yet certified'};
await save('source.json',source);
const validation={sha256,byteLength:bytes.length,decodedPixelType:'Float32Array',sampleFormat:fd.SampleFormat,bitsPerSample:fd.BitsPerSample,geoKeys,width:image.getWidth(),height:image.getHeight(),bounds,noData,validPixels:valid.length,noDataPixels:samples.length-valid.length,min,max,precision:'JSON rounded to0.01 source units; original float32 TIFF retained',requests,verticalUnitsVerified:false};
await save('validation.json',validation);
await save('LICENSE-NOTICE.md','# Regione Campania CTR2020 DTM\n\nSource: '+raster+'\n\nRegione Campania publishes CTR, DBT and DTM updated to2020 under Creative Commons Attribution4.0: https://sit.regione.campania.it/carta-tecnica-regionale . This crop preserves raw source pixels in napoli-dtm.tif; JSON is reprojected/resampled and rounded to0.01 source units. No vertical datum or unit declaration is inferred from the horizontal CRS. Research data is not activated in gameplay.\n');
console.log('DTM_CROP_VALIDATION='+JSON.stringify(validation));
