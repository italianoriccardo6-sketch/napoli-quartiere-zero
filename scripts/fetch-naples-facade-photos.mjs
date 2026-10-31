import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

// These are original photographs of the named Naples buildings/streets, not a
// texture pack or substitute city. Acquisition does not approve a projection.
const output='public/assets/naples-facade-research';
const repository='https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero';
const candidates=[
  {id:'excelsior-desantis-2012',title:'Hotel Excelsior (8639643491).jpg',author:'Angelo DeSantis',license:'CC BY 2.0',width:2400,height:1456,limitations:['Blue-hour lighting is unsuitable as daytime albedo without further review.','No wall corners or OSM identity accepted before source-pixel inspection.']},
  {id:'vesuvio-misterno',title:'Grande Albergo Vesuvio - panoramio.jpg',author:'Mister No',license:'CC BY 3.0',width:1600,height:1200,limitations:['Native source is below 2k; never upscale and claim recovered detail.','No wall corners or OSM identity accepted before source-pixel inspection.']},
  {id:'palazzo-santa-lucia-baku-2021',title:'SereRegioneCampaniaS.Lucia.jpg',author:'Baku',license:'CC BY-SA 4.0',width:4032,height:1908,sha1:'a0c754502ad5325d27c5765a4cc50740ca4569b8',buildingId:'relation/1191261:0',limitations:['ShareAlike license is distinct from CC BY/CC0; preserve it on any adapted image.','Source footprint height is a 10m fallback, not a measured height.','No wall corners accepted before source-pixel inspection.']},
  {id:'partenope-dimitalen-2010',title:"View of Via Partenope and the marina from Castel dell'Ovo, Naples, 2010.jpg",author:'DimiTalen',license:'CC0',width:2939,height:1954,limitations:['Broad waterfront reference; individual facade crops have lower native resolution.','Never render the complete panorama as a city/skyline billboard.']},
];
const plain=html=>String(html??'').replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
async function request(url){
  let last;
  for(let attempt=0;attempt<4;attempt++){
    try{
      const response=await fetch(url,{headers:{'user-agent':'NapoliQuartiereZeroFacadeResearch/0.4 ('+repository+')'},signal:AbortSignal.timeout(45000)});
      if(!response.ok)throw new Error('HTTP '+response.status+' '+url);
      return response;
    }catch(error){last=error;if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1000*2**attempt));}
  }
  throw last;
}
await mkdir(output,{recursive:true});
const diagnostics='work/facade-photo-diagnostics';await mkdir(diagnostics,{recursive:true});
try{
  const api=new URL('https://commons.wikimedia.org/w/api.php');
  api.search=new URLSearchParams({action:'query',format:'json',prop:'imageinfo',iiprop:'url|size|sha1|mime|extmetadata',titles:candidates.map(c=>'File:'+c.title).join('|')}).toString();
  const response=await request(api),raw=await response.text();await writeFile(join(diagnostics,'commons-api.json'),raw);
  const data=JSON.parse(raw),pages=Object.values(data.query?.pages??{}),manifest=[];let totalBytes=0;
  for(const candidate of candidates){
    const page=pages.find(page=>page.title==='File:'+candidate.title),info=page?.imageinfo?.[0];
    if(!info)throw new Error('Commons original missing: '+candidate.title);
    const license=plain(info.extmetadata?.LicenseShortName?.value),artist=plain(info.extmetadata?.Artist?.value),licenseUrl=plain(info.extmetadata?.LicenseUrl?.value);
    if(license!==candidate.license)throw new Error('Source license changed for '+candidate.title+': '+license);
    if(!artist.toLowerCase().includes(candidate.author.toLowerCase()))throw new Error('Unexpected author for '+candidate.title+': '+artist);
    if(info.width!==candidate.width||info.height!==candidate.height||info.mime!=='image/jpeg')throw new Error('Source dimensions/type changed: '+candidate.title);
    if(!info.url?.startsWith('https://upload.wikimedia.org/wikipedia/commons/'))throw new Error('Unexpected image origin.');
    if(candidate.sha1&&candidate.sha1!==info.sha1)throw new Error('Pinned source SHA-1 changed: '+candidate.title);
    if(info.size>12*1024*1024||totalBytes+info.size>24*1024*1024)throw new Error('Bounded research download budget exceeded.');
    const binary=await request(info.url),bytes=Buffer.from(await binary.arrayBuffer());
    const sha1=createHash('sha1').update(bytes).digest('hex'),sha256=createHash('sha256').update(bytes).digest('hex');
    if(bytes.length!==info.size||sha1!==info.sha1)throw new Error('Original byte checksum mismatch: '+candidate.title);
    const folder=join(output,candidate.id);await mkdir(folder,{recursive:true});await writeFile(join(folder,'source.jpg'),bytes);
    const entry={...candidate,sourcePage:info.descriptionurl,downloadUrl:info.url,licenseUrl,authorHtml:info.extmetadata?.Artist?.value,captured:plain(info.extmetadata?.DateTimeOriginal?.value),commonsRevision:info.timestamp,bytes:bytes.length,sha1,sha256,acquiredAt:new Date().toISOString(),use:'research-only-not-runtime-texture',photoQuads:[]};
    await writeFile(join(folder,'source-metadata.json'),JSON.stringify({...entry,commonsImageInfo:info},null,2)+'\n');manifest.push(entry);totalBytes+=bytes.length;
    console.log(candidate.id+': '+bytes.length+' original bytes; '+license+'; sha256 '+sha256);
  }
  await writeFile(join(output,'manifest.json'),JSON.stringify({purpose:'Authentic Naples facade source-pixel review, not a surveyed reconstruction',totalBytes,candidates:manifest},null,2)+'\n');
  await writeFile(join(output,'ATTRIBUTION.txt'),manifest.map(m=>[m.title,'Author: '+m.author,'Source: '+m.sourcePage,'License: '+m.license+' '+m.licenseUrl,'Original download: '+m.downloadUrl,'SHA-256: '+m.sha256,'Changes: none; original image bytes. No runtime projection is currently approved.','Limitations: '+m.limitations.join(' ')].join('\n')).join('\n\n')+'\n');
}catch(error){await writeFile(join(diagnostics,'failure.txt'),String(error.stack??error)+'\n');throw error;}
