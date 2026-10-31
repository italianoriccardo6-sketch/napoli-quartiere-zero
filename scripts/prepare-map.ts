import {readFile,writeFile} from 'node:fs/promises';
import {importOSM} from '../src/import-osm';
const map=importOSM(JSON.parse(await readFile('data/borgo-marinari.osm.json','utf8')));
// A raw coastline is not a closed terrain polygon: never fill it automatically.
await writeFile('data/map.osm.local.json',JSON.stringify(map,null,2));
console.log(`Preparati ${map.buildings.length} poligoni e ${map.paths.length} percorsi. Revisione manuale richiesta per terreno, percorso e punti missione prima dell'attivazione. Il gioco continua a usare map.json provvisorio.`);
