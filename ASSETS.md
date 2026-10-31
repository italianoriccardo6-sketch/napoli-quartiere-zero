# Asset, font e attribuzioni

| Risorsa | Fonte | Licenza / note |
| --- | --- | --- |
| Codice e geometrie procedurali, castello composto, personaggio, motorino, barche, edifici, insegne inventate, arredi | Originali di questo progetto | MIT, vedi LICENSE |
| Basolato | Mappe colore/normali originali generate con Canvas in surfaces.ts | MIT |
| Mare | Shader GLSL originale in world.ts | MIT |
| Audio | Oscillatore sintetico originale, audio.ts | MIT; nessun campione registrato |
| DM Sans | Pacchetto @fontsource/dm-sans; https://github.com/googlefonts/dm-fonts | SIL Open Font License 1.1; licenza copiata in public/licenses/ |
| Libre Caslon Display | Pacchetto @fontsource/libre-caslon-display; https://github.com/impallari/Libre-Caslon-Display | SIL Open Font License 1.1; licenza copiata in public/licenses/ |
| Babylon.js core e loaders 9.33.1 | https://github.com/BabylonJS/Babylon.js | Apache-2.0; licenza copiata in public/licenses/ |
| Earcut | https://github.com/mapbox/earcut | ISC; licenza copiata in public/licenses/ |
| osmtogeojson (solo preparazione offline) | https://github.com/tyrasd/osmtogeojson | MIT, dipendenze con relative licenze nel lockfile/installazione |
| Vite, TypeScript e strumenti di sviluppo | Pacchetti npm con package-lock.json | Vite MIT, TypeScript Apache-2.0; non sono asset grafici |
| Layout public/data/map.json | Originale provvisorio, composto in coordinate locali | MIT; NON è dato OSM |
| Futuri dati OSM | https://www.openstreetmap.org/copyright | © OpenStreetMap contributors, ODbL-1.0; nessun estratto ottenuto in questa sessione |

Nessun GLB/glTF, fotografia, texture esterna, modello scaricato, mappa raster o risorsa Google Maps / Google Earth / Street View. La sagoma artistica del castello e il profilo lontano non sono rilievi. Coordinate di riferimento del luogo consultate su https://en.wikipedia.org/wiki/Castel_dell%27Ovo; nessun testo o immagine della pagina è distribuito come asset.

Documentazione consultata per l’implementazione: https://vite.dev/guide/ ; https://doc.babylonjs.com/features/featuresDeepDive/mesh/creation/param/polygon ; https://doc.babylonjs.com/features/featuresDeepDive/lights/shadows ; https://doc.babylonjs.com/features/featuresDeepDive/cameras/camera_collisions . Il controllo della telecamera utilizza un raycast personalizzato, non la gravità per camera descritta nell’ultimo documento. Le firme API sono anche verificate da TypeScript contro i pacchetti installati.

Revisione 0.2: texture e normal map originali di tufo, basolato e intonaco in `src/surfaces.ts`, MIT. Dialoghi e personaggi di finzione originali in `src/story.ts`, MIT. Nessuna fotografia del territorio è stata aggiunta.
