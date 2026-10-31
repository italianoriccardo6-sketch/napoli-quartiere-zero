import {readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
// Register every node:test suite in this process. No worker or tsx CLI IPC socket
// can produce a file-level success without running its assertions in this sandbox.
const files=readdirSync('tests').filter(name=>name.endsWith('.test.ts')).sort();
if(!files.length)throw new Error('Nessuna suite di test trovata.');
for(const file of files)await import(pathToFileURL(resolve('tests',file)).href);
console.log(`Caricate ${files.length} suite nello stesso processo; il riepilogo node:test segue in uscita.`);
