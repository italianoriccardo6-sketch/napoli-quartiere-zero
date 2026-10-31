import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
let commit=process.env.GITHUB_SHA;
if(!commit){try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();}catch{commit='unknown';}}
await writeFile('dist/build-info.json',JSON.stringify({commit,source:commit==='unknown'?null:`https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero/commit/${commit}`,built_at:new Date().toISOString()},null,2));
