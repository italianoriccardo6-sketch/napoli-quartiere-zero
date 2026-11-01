# Asset, font e attribuzioni — 0.4.2

Le licenze degli asset e delle basi dati restano separate dalla licenza MIT del codice. File sorgente, checksum, autori e condizioni di riuso sono conservati nei manifest accanto agli asset. Il gioco carica copie locali; non richiede API esterne durante la partita.

| Risorsa | Fonte e autore | Licenza / uso nella demo |
| --- | --- | --- |
| Fotografia di Via Partenope dal Castel dell’Ovo, 8 luglio 2010 | [DimiTalen, Wikimedia Commons](https://commons.wikimedia.org/wiki/File:View_of_Via_Partenope_and_the_marina_from_Castel_dell%27Ovo,_Naples,_2010.jpg) | CC0 1.0; byte originali invariati in `public/assets/naples-facade-research/`, con manifest e attribuzione |
| Foglie fotografiche Tree Small 02 | [Rico Cilliers, Poly Haven](https://polyhaven.com/a/tree_small_02) | CC0 1.0; atlante colore, maschera alpha, normali e rugosità. Il modello originale dell’albero non è incluso |
| Corteccia fotografica Bark Brown 01 | [Rob Tuytel, Poly Haven](https://polyhaven.com/a/bark_brown_01) | CC0 1.0; mappe originali ripetibili, in `public/assets/foliage/tree_small_02/` |
| Terreno fotografico Leafy Grass | [Charlotte Baglioni, Poly Haven](https://polyhaven.com/a/leafy_grass) | CC0 1.0; colore, normali e rugosità, in `public/assets/materials/leafy_grass/` |
| Asfalto asphalt_02 | [Rob Tuytel, Poly Haven](https://polyhaven.com/a/asphalt_02) | CC0 1.0; materiali e checksum in `public/assets/visual-manifest.json` |
| Intonaco painted_plaster_wall | [Amal Kumar, Poly Haven](https://polyhaven.com/a/painted_plaster_wall) | CC0 1.0; materiale generico, non fotografia dei singoli palazzi |
| Muratura stone_wall | [Charlotte Baglioni e Dario Barresi, Poly Haven](https://polyhaven.com/a/stone_wall) | CC0 1.0; materiale generico per pietra e dettagli del lungomare |
| Lastre stone_tiles_02 | [Charlotte Baglioni, Poly Haven](https://polyhaven.com/a/stone_tiles_02) | CC0 1.0; pavimentazione generica |
| Cielo HDR kloofendal_43d_clear_puresky | [Greg Zaal, Poly Haven](https://polyhaven.com/a/kloofendal_43d_clear_puresky) | CC0 1.0; ambiente luminoso generico, non ripresa del cielo di Napoli |
| Auto CarConcept | © 2024 Darmstadt Graphics Group; modello e texture Eric Chadwick, distribuzione Khronos glTF Sample Assets | CC BY 4.0; sorgenti e licenza in `public/assets/vehicles/car-concept/`. Scala uniforme a 4,4 m e orientamento adattati; targa originale nascosta |
| Civile e animazioni Walk/Run | [Vibeassets](https://vibeassets.io/a/zpepqtthci), modello e movimenti generati con Meshy | CC0 1.0; pagine di modello e animazioni in `public/assets/characters/civilian/ATTRIBUTION.md`. Scala e orientamento adattati; rimosse a runtime le traslazioni orizzontali del root delle animazioni |
| Costa, strade e sagome degli edifici | © OpenStreetMap contributors, estratto 31 ottobre 2026 | ODbL 1.0; `data/napoli-centro.osm.json`, `public/data/map.json`, `data/source.json` e `data/OSM-LICENSE.md` |
| Posizioni degli alberi, aree verdi e arredi | © OpenStreetMap contributors, estratti con provenienza separata | ODbL 1.0; identità e coordinate OSM restano distinte dalle forme artistiche. `public/data/green-ground.json` conserva poligoni, anelli interni, fonte e hash dell’estratto |
| Terreno urbano relativo | Regione Campania, CTR2020 DTM5K | CC BY 4.0; TIFF, checksum e revisione documentale in `data/napoli-dtm-2020/`. Differenze in metri rispetto alla strada iniziale, datum verticale ignoto; estensioni costiere entro 10 m esplicitamente stimate |
| Profilo distante del golfo | SRTM3 v2.1 NASA/NGA/USGS, mirror Kurviger | Pubblico dominio; WGS84, metri sul geoide EGM96. Fonti e checksum in `data/background-terrain-source.json`; escluso dal terreno urbano giocabile |
| Codice, storia, geometrie originali e fixture storica | Originali di questo progetto | MIT, vedi `LICENSE`; include profili inferiti delle facciate, forme degli alberi, arredi e parapetto costiero |
| Audio | Oscillatore sintetico originale, `src/audio.ts` | MIT; nessun campione registrato |
| DM Sans | [Fontsource / DM Sans](https://github.com/googlefonts/dm-fonts) | SIL Open Font License 1.1; licenza in `public/licenses/` |
| Libre Caslon Display | [Fontsource / Libre Caslon Display](https://github.com/impallari/Libre-Caslon-Display) | SIL Open Font License 1.1; licenza in `public/licenses/` |
| Babylon.js core e loaders 9.33.1 | [BabylonJS](https://github.com/BabylonJS/Babylon.js) | Apache-2.0; licenza in `public/licenses/` |
| Earcut | [Mapbox](https://github.com/mapbox/earcut) | ISC; licenza in `public/licenses/` |
| osmtogeojson, preparazione offline | [tyrasd/osmtogeojson](https://github.com/tyrasd/osmtogeojson) | MIT; dipendenze e relative licenze nel lockfile/installazione |
| polygon-clipping | [mfogel/polygon-clipping](https://github.com/mfogel/polygon-clipping) | MIT; ritaglio e unione dei poligoni |
| Vite, TypeScript e strumenti di sviluppo | Pacchetti npm con `package-lock.json` | Vite MIT, TypeScript Apache-2.0; non sono asset grafici |

La fotografia di DimiTalen è applicata soltanto a due fronti confermati: **Royal Continental, ala moderna**, sull’edificio OSM `relation/4779351:1`, e **Grand Hotel Vesuvio**, su `way/337012555:0`. Posizione e segmenti delle pareti provengono dalle sagome OSM. La calibrazione prospettica è manuale; profondità di finestre, cornici, logge e balconi sono inferite. Le regioni selezionate hanno risoluzione limitata e documentano l’aspetto del 2010. L’intero panorama non viene usato come fondale della città. Le altre facciate hanno materiali e aperture generici; nessuna identità fotografica con tutti i palazzi è dichiarata.

Le mappe Poly Haven sono generiche. Le forme degli alberi e le loro dimensioni sono approssimate sulle posizioni OSM selezionate; Tree Small 02 non certifica la specie dei singoli alberi napoletani. Il materiale Leafy Grass è applicato solo ai poligoni OSM parco/bosco/foresta ritagliati sulla terra reale, conservando i buchi: il materiale non misura la copertura vegetale. Il basso parapetto segue la costa OSM; altezza, larghezza e presenza continua sono stime artistiche, non un rilievo dei muri esistenti. Questi elementi non costituiscono fotogrammetria.

Nessun asset Rockstar, screenshot del riferimento o risorsa Google Maps / Google Earth / Street View è incluso. I crediti CC0 sono forniti volontariamente e non implicano approvazione da parte degli autori. Le condizioni ODbL e CC BY restano applicabili ai rispettivi dati e asset.

I punti quotati regionali in `data/napoli-terrain-points/` conservano l’attribuzione Regione Campania e la licenza CC BY 4.0 nel proprio avviso. Questi punti isolati non sono attivati come terreno. La revisione 0.4.2 usa invece il raster DTM5K separato, solo per differenze relative; la scala in metri è documentata, il datum verticale resta ignoto. Il livello dell’acqua e l’allineamento al rilievo SRTM sono scelte artistiche.

Le revisioni 0.2–0.3 usavano texture Canvas e personaggio procedurali originali, conservati nel codice e nella fixture storica. Le descrizioni precedenti all’acquisizione degli asset esterni si riferivano a quelle revisioni. La sagoma artistica storica del castello non è un rilievo; nessun testo o immagine della pagina Wikipedia consultata come riferimento è distribuito.
