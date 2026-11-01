import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const directory='work/santa-lucia-photo-scout';
const titles=['File:Grand Hotel Santa Lucia - panoramio.jpg','File:Napoli-1040131.jpg'];
const headers={'User-Agent':'NapoliQuartiereZero/0.5 (https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero; bounded licensed-photo metadata and960px preview research)'};
await mkdir(directory,{recursive:true});
async function bytes(url,limit){
 const response=await fetch(url,{headers,signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error('HTTP '+response.status+' '+url);
 if(!response.body)throw Error('No response body');
 const chunks=[];let count=0;for await(const chunk of response.body){count+=chunk.length;if(count>limit)throw Error('Research response exceeded byte limit');chunks.push(chunk);}return Buffer.concat(chunks);
}
const parameters=new URLSearchParams({action:'query',format:'json',formatversion:'2',prop:'imageinfo',iiprop:'url|size|extmetadata',iiurlwidth:'960',titles:titles.join('|')});
const requestUrl='https://commons.wikimedia.org/w/api.php?'+parameters,metadataBytes=await bytes(requestUrl,1024*1024);
await writeFile(directory+'/commons-metadata.json',metadataBytes);
const data=JSON.parse(metadataBytes.toString('utf8'));if(data.error||!Array.isArray(data.query?.pages))throw Error('Malformed Commons metadata');
const candidates=[];
for(const page of data.query.pages){
 if(!titles.includes(page.title)||page.missing)throw Error('Unexpected/missing source title');
 const info=page.imageinfo?.[0];if(!info||!Number.isInteger(info.width)||!Number.isInteger(info.height)||info.width>8192||info.height>8192||info.size>20*1024*1024)throw Error('Original exceeds bounded candidate dimensions/size');
 const preview=new URL(info.thumburl??'');if(preview.protocol!=='https:'||!['upload.wikimedia.org','thumb.wikimedia.org'].includes(preview.hostname)||!preview.pathname.includes('/thumb/'))throw Error('Only provider thumbnails may be fetched; no original download');
 const fileName=page.title==='File:Napoli-1040131.jpg'?'napoli-1040131-960px.jpg':'santa-lucia-panoramio-960px.jpg',thumb=await bytes(preview.href,2*1024*1024);
 await writeFile(directory+'/'+fileName,thumb);
 const facts={title:page.title,sourcePage:info.descriptionurl,originalUrl:info.url,nativeWidth:info.width,nativeHeight:info.height,originalBytes:info.size,author:info.extmetadata?.Artist?.value,license:info.extmetadata?.LicenseShortName?.value,licenseUrl:info.extmetadata?.LicenseUrl?.value,captured:info.extmetadata?.DateTimeOriginal?.value,previewUrl:preview.href,previewFile:fileName,previewBytes:thumb.length,previewSha256:createHash('sha256').update(thumb).digest('hex'),originalDownloaded:false,runtimeApproved:false};candidates.push(facts);
}
await writeFile(directory+'/overview.json',JSON.stringify({purpose:'read-only960px preview inspection before any original acquisition; no runtime asset',queryCount:1,requestUrl,candidates},null,2)+'\n');
console.log(JSON.stringify(candidates,null,2));
