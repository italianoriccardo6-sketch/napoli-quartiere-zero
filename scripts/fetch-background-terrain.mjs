/** One public SRTM3 tile for a distant visual backdrop. NEVER changes gameplay ground. */
import {mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const tile='N40E014', side=1201, rawBytes=side*side*2;
const bbox={west:14.12,south:40.74,east:14.46,north:40.96};
const columns=241,rows=185;
const output='work/background-terrain-acquisition';
const endpoints=[
  `https://dds.cr.usgs.gov/srtm/version2_1/SRTM3/Eurasia/${tile}.hgt.zip`,
  `https://srtm.kurviger.de/SRTM3/Eurasia/${tile}.hgt.zip`,
];
const documentation={
  dataset:'https://www.usgs.gov/centers/eros/science/usgs-eros-archive-digital-elevation-shuttle-radar-topography-mission-srtm',
  mirror:'https://srtm.kurviger.de/',
  format:'https://github.com/tilezen/joerd/blob/master/docs/formats.md#skadi',
  attribution:'https://github.com/tilezen/joerd/blob/master/docs/attribution.md#srtm',
  nasaUsePolicy:'https://forum.earthdata.nasa.gov/viewtopic.php?t=679',
};
await mkdir(output,{recursive:true});await mkdir('public/data',{recursive:true});await mkdir('data',{recursive:true});
const failures=[];let archive,downloadURL;
for(const url of endpoints){
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(25000),headers:{'User-Agent':'NapoliQuartiereZero/0.4 (one public SRTM tile, distant backdrop research)'}});
    if(!response.ok)throw Error(`HTTP ${response.status}`);
    const parts=[];let bytes=0;
    for await(const part of response.body){bytes+=part.byteLength;if(bytes>4*1024*1024)throw Error('Archive exceeds 4 MiB limit');parts.push(part);}
    const candidate=Buffer.concat(parts);if(candidate.readUInt32LE(0)!==0x04034b50)throw Error('Not a ZIP archive');
    archive=candidate;downloadURL=url;break;
  }catch(error){failures.push({url,error:error.message});}
}
if(!archive){await writeFile(`${output}/failure.json`,JSON.stringify({status:'blocked',tile,bbox,failures,documentation},null,2));throw Error('Neither bounded source delivered the public SRTM3 tile: '+JSON.stringify(failures));}
const archivePath=`${output}/${tile}.hgt.zip`;await writeFile(archivePath,archive);
// Python's standard-library ZIP reader verifies CRC and avoids writing archive paths.
const raw=execFileSync('python3',['-c',`import sys,zipfile,os\nz=zipfile.ZipFile(sys.argv[1]);m=[x for x in z.infolist() if os.path.basename(x.filename)=='${tile}.hgt'];assert len(m)==1;assert m[0].file_size==${rawBytes};sys.stdout.buffer.write(z.read(m[0]))`,archivePath],{maxBuffer:4*1024*1024});
if(raw.length!==rawBytes)throw Error('Expected original SRTM3 1201×1201 signed-16-bit tile');
function sample(lon,lat){
  const px=(lon-14)*1200,py=(41-lat)*1200,x=Math.floor(px),y=Math.floor(py),fx=px-x,fy=py-y;
  if(x<0||y<0||x>=1200||y>=1200)return null;
  let total=0,weight=0;
  for(const [dx,dy,w] of [[0,0,(1-fx)*(1-fy)],[1,0,fx*(1-fy)],[0,1,(1-fx)*fy],[1,1,fx*fy]]){
    const value=raw.readInt16BE(((y+dy)*side+x+dx)*2);if(value!==-32768){total+=value*w;weight+=w;}
  }
  return weight>.0001?total/weight:null;
}
const summit=sample(14.4265,40.8214),sea=sample(14.27,40.78);
if(summit===null||summit<800||summit>1400)throw Error('Vesuvius sanity check failed: wrong tile, byte order or units');
if(sea!==null&&Math.abs(sea)>10)throw Error('Gulf sea-level sanity check failed');
const heights=[],valid=[];let voidCount=0,max=0;
for(let r=0;r<rows;r++)for(let c=0;c<columns;c++){
  const lon=bbox.west+(bbox.east-bbox.west)*c/(columns-1),lat=bbox.north-(bbox.north-bbox.south)*r/(rows-1);
  const value=sample(lon,lat);valid.push(value===null?0:1);if(value===null)voidCount++;
  const height=value===null?0:Math.max(0,Math.round(value));max=Math.max(max,height);heights.push(height);
}
const source={dataset:'NASA/NGA SRTM3 version 2.1, tile N40E014',tile,download_url:downloadURL,accessed_at:new Date().toISOString(),
  license:'Public-domain U.S. Government SRTM data; NASA free/open use policy; attribution retained',
  attribution:'SRTM data courtesy of the U.S. Geological Survey; NASA/NGA. Distributed by USGS; unmodified source archive mirrored by Kurviger when official legacy URL is unavailable.',
  horizontal_crs:'EPSG:4326 (WGS84)',vertical_datum:'EGM96 geoid',vertical_units:'metres',source_resolution_arc_seconds:3,
  source_grid:{columns:side,rows:side,row_order:'north-to-south',column_order:'west-to-east',encoding:'signed 16-bit big-endian',void_value:-32768},
  documentation,source_archive_sha256:createHash('sha256').update(archive).digest('hex'),source_hgt_sha256:createHash('sha256').update(raw).digest('hex'),
  modifications:'Bilinear sampling to 241×185 backdrop grid; negative values clamped to 0 m; voids flagged invalid, not filled. No imagery, buildings, bathymetry or Google data.',
  purpose:'DISTANT VISUAL BACKGROUND ONLY. Not suitable for collision, terrain navigation or street-level elevation.',
  checks:{vesuvius_sample_m:Math.round(summit),sea_sample_m:sea===null?null:Math.round(sea),void_output_samples:voidCount,max_height_m:max},failed_attempts:failures};
const result={version:1,purpose:'distant-background-only',bbox,columns,rows,heights_m:heights,valid,sea_level_m:0,
  source,triangle_budget_max:2*(columns-1)*(rows-1),notes:['SRTM radar surface circa 2000; includes canopy/building biases and coarse shoreline.',
    'Grid is about 120×133 m at Naples; does not depict modern facades or replace gameplay terrain.',
    'Only draw outside the verified city footprint; skip sea-only and missing-data cells.']};
await writeFile('public/data/background-terrain.json',JSON.stringify(result));
await writeFile('data/background-terrain-source.json',JSON.stringify(source,null,2)+'\n');
console.log(JSON.stringify({status:'ready',file:'public/data/background-terrain.json',bbox,columns,rows,triangles_max:result.triangle_budget_max,checks:source.checks,download_url:downloadURL}));
