import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {planMunicipalSectors} from '../src/napoli-boundary';
const bytes=await readFile('public/data/napoli-boundary.json'),source=JSON.parse(await readFile('data/napoli-boundary/source.json','utf8'));
if(createHash('sha256').update(bytes).digest('hex')!==source.derivedSHA256)throw Error('Boundary checksum mismatch.');
const sectors=planMunicipalSectors(JSON.parse(bytes.toString('utf8')));
await writeFile('public/data/napoli-municipal-sectors.json',JSON.stringify({version:1,status:'administrative-planning-not-playable-coverage',boundary:'napoli-boundary.json',source:'napoli-boundary-source.json',license:'CC-BY-4.0',attribution:source.attribution,sectors}));
console.log(JSON.stringify({sectors:sectors.length,administrativeAreaKm2:sectors.reduce((n,s)=>n+s.administrativeAreaM2,0)/1e6,geographicCoverageExpanded:false}));
