# Napoli — Quartiere Zero

Gioco 3D per browser, tastiera e mouse. Si apre da un sito online anche su Mac; non richiede Unreal Engine o installazione di un gioco desktop.

**Stato 0.3: base geografica OSM reale, resa ancora a volumi generici.** La precedente isola inventata è sostituita nel gioco da costa, sagome e rete viaria del settore Santa Lucia–lungomare–Plebiscito. Sono attivi 1.803 poligoni di edifici (316 con cortili), 1.531 percorsi di superficie e un tragitto missione verificato di circa 586 m. Non è una ricostruzione fotorealistica: 1.620 altezze sono stimate, il terreno resta piano e facciate/tetti sono generici. Il recupero dei dati tramite la procedura GitHub è riuscito. Non sono ancora disponibili asset architettonici misurati e fotografici o una prova GPU della nuova scena.

## GitHub è la fonte del progetto

Repository: https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero . Ogni revisione viene prima caricata su GitHub. `.github/workflows/verify.yml` esegue test e build per push su `main` e pull request e conserva la build come artifact associato allo SHA. La pubblicazione viene effettuata da un checkout del commit GitHub verificato; l’eventuale repository tecnico del servizio di hosting è una copia dello stesso commit, non una fonte alternativa di modifiche.

La build espone `/build-info.json` con commit e link GitHub. `.openai/hosting.json` identifica l’hosting collegato alla chat (nuovo sito privato per il proprietario). `netlify.toml` rimane disponibile per Netlify. Le vecchie anteprime anonime Netlify avevano una scadenza; non sono usate come garanzia di hosting permanente. Nessuna distribuzione autenticata automatica Netlify è stata configurata: richiede il collegamento del repository nell’account Netlify. L’automazione GitHub verifica e prepara gli artifact; la pubblicazione corrente resta un passaggio esplicito dal commit verificato.

## Avvio e verifiche

Node.js 22.12+ e npm:

```sh
npm ci
npm run dev
```

```sh
npm test
npm run build
npm run preview
```

Vite + TypeScript + Babylon.js core e loaders 9.33.1 (nessun GLB remoto). Font inclusi nella build, nessun backend. `dist/`, dipendenze e credenziali non sono versionati. `npm run typecheck` esegue solo il controllo dei tipi.

## Prologo: «A nome di tua sorella»

Luca Serra cerca Ada, sua sorella. Teresa gli consegna un telefono danneggiato al bar; alla banchina il contatto non si presenta. Sul telefono ci sono una prova e due messaggi incompatibili. Il giocatore decide di proteggere la prova per la giornalista Nora oppure di aprire una trattativa, poi torna da Teresa per confermare il finale.

Flusso giocabile: **bar → banchina → scelta nei dialoghi → ritorno al bar**. Si può completare a piedi o usando il motorino. Proteggere dà 25 monete e il contatto Nora; trattare dà 75 monete e il contatto dell’intermediario. La ricompensa viene assegnata una sola volta. Nessun inseguitore fisico, inseguimento simulato, combattimento o dialogo doppiato è implementato. Personaggi e vicenda sono di fantasia. Teresa è rappresentata dal punto di interazione al bar, non da un personaggio animato.

- WASD/frecce: movimento; Shift: corsa.
- Mouse: guarda; trascinamento sulla scena se pointer lock non disponibile.
- E: parla, controlla il telefono, sali/scendi dal motorino. Fermarsi prima di scendere.
- Motorino: W accelera; S frena e poi retromarcia; A/D sterzano.
- R: recupero in punto sicuro; Esc: pausa (durante un dialogo usare il pulsante Continua).
- I dialoghi fermano il movimento; al termine la partita riprende. La perdita di focus mette in pausa la guida/esplorazione.

Salvataggi locali distinti: `napoli-quartiere-zero-v1` conserva impostazioni ed eventuali vecchie monete; `napoli-quartiere-zero-story-v1` conserva fase, scelta e ricompensa del nuovo prologo. Le monete del prologo sono mostrate insieme alle vecchie monete. Dati corrotti sono respinti, storage indisponibile lascia proseguire in memoria. «Ripristina partita» richiede due clic e azzera entrambi. Posizione e mezzo ripartono dalla piazzetta al ricaricamento. Nessun controllo touch o supporto mobile dichiarato.

## Geografia e dati reali

Estratto: **40.8260–40.8420 N, 14.2410–14.2660 E**, circa 3,7 km² del centro di Napoli. Fonte Overpass/OpenStreetMap, acquisizione **31 ottobre 2026 alle 22:18 UTC**. L’estratto originale contiene 23.149 elementi; alcuni oggetti completi si estendono oltre il perimetro richiesto. `data/source.json` conserva query, fonte, data, bbox e licenza; `data/city-summary.json` distingue oggetti della fonte e geometrie attive.

Origine locale 40.8281 N, 14.2486 E; coordinate in metri, x est e z nord, proiezione equirettangolare locale con raggio 6.378.137 m. Questa base cartografica non certifica l’identità fotografica con tutti i luoghi reali.

```sh
npm run data:fetch
npm run data:prepare
```

L’estrazione fa al massimo due richieste Overpass, una per endpoint, con timeout e limite di area/dimensione. Il workflow `.github/workflows/geography.yml` conserva l’estratto e la provenienza in un ramo dati separato, prima della revisione e integrazione in `main`. Nessuna richiesta Overpass viene eseguita durante il gioco.

La preparazione usa `osmtogeojson` per edifici multipoligono e cortili, conserva nomi e centerline delle strade e ricompone la costa nella direzione originale (terra a sinistra). La costa completa si estende fuori viewport: viene chiusa **fuori dal perimetro visibile** e poi ritagliata con `polygon-clipping`, preservando anelli e buchi. Non vengono aggiunte rive inventate nel settore attivo. Il confine rettangolare del settore è un limite di caricamento, non una costa reale.

Il processo esclude gallerie, passaggi coperti, ponti e livelli diversi da zero dalla resa di superficie, perché il modello di terreno corrente non supporta più quote. Gradini e accessi privati non sono ammessi nel percorso del motorino. Le larghezze senza tag sono stime visive; altezze da `height`, altrimenti livelli × 3,2 m, altrimenti 10 m stimati (massimo tecnico 60 m). Non vengono inventate pendenze.

La nuova missione segue un percorso libero sulle geometrie reali di **Via Santa Lucia, Via Chiatamone, Via Alessandro Dumas e Via Partenope**. Punti di interazione e personaggi sono inventati e non corrispondono a esercizi reali. Il tragitto di ritorno usa lo stesso percorso. Il terreno, i punti iniziali e oltre 2.000 campioni del percorso sono controllati per l’ingombro del mezzo prima di generare la mappa attiva. Se la topologia o il collegamento non passano i controlli, la preparazione fallisce senza attivare una nuova mappa.

Le quote regionali sono acquisite separatamente da `.github/workflows/terrain.yml`/`scripts/fetch-terrain.mjs`: massimo 250 punti, due richieste ufficiali, risposta originale, filtro locale al perimetro e avvisi di riferimento verticale. **Non sono usate nel terreno del gioco** finché unità e datum non sono verificati. Non sono un DTM completo.

Licenza: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Originale e banca dati derivata sono disponibili in questo repository (`data/napoli-centro.osm.json`, `public/data/map.json`), con fonte e avvisi in `data/OSM-LICENSE.md`; non sono sotto MIT. In caso di riuso/distribuzione mantenere attribuzione e rispettare gli obblighi ODbL, inclusa la disponibilità dei dati derivati prevista dalla licenza. Nessun dato, texture o modello Google Maps/Earth/Street View.

## Moduli e grafica

- `geo.ts`, `import-osm.ts`, `scripts/`: geografia offline.
- `city-world.ts`, `surfaces.ts`: scena geografica attiva con edifici accorpati per tile, collisioni su indice spaziale, strade sorgente, cortili e buchi del terreno. `world.ts` resta solo per la fixture storica di test. scena, dettagli e texture originali di colore/normali. StandardMaterial: non una pipeline PBR fotografica. Mare con riflesso di un cielo analitico, non riflessi della geometria della scena.
- `character.ts`, `vehicle.ts`, `camera.ts`, `input.ts`: personaggio procedurale con arti gerarchici, motorino, telecamera e controlli. Non ci sono mocap o personaggi fotorealistici.
- `story.ts`, `mission.ts`, `save.ts`: prologo, logica legacy e impostazioni; logica missione originale mantenuta per compatibilità/test.
- `main.ts`, `ui.ts`, `style.css`, `audio.ts`: interazioni, dialoghi, HUD e audio sintetico.

Collisioni cinematiche su piano, raggio veicolo 0,93 m, sottopassi massimi di 20 cm, scorrimento a piedi e stop del mezzo contro ostacoli. Bordi non attraversabili; controllo di recupero se si esce dalla mappa. Ombre selettive e istanze per decorazioni; qualità alta con pixel ratio massimo 1,5, bassa massimo 1 senza ombre. Nessun benchmark FPS verificato. Vite segnala il chunk JS iniziale sopra 500 kB: avviso, non errore.

## Evidenze e limiti

TypeScript, build di produzione e **28 test automatici** passano: coordinate, poligono concavo, altezze, missione legacy, salvataggi, velocità/frenata, relation multipoligono con cortile, scena reale in NullEngine/corridoio percorribile, sequenza del prologo, entrambi i finali, scelta persistita, dati corrotti e ricompensa idempotente.

NullEngine esegue costruzione e aggiornamenti della scena ma non prova shader sulla GPU, qualità visiva, browser/macOS, mouse o completamento interattivo. Nessun tool browser collegato disponibile in questa sessione; screenshot e prova manuale non eseguiti. Il cambio della camera e dei materiali richiede ancora un controllo visivo nel browser. Nessuna promessa di fotorealismo o fedeltà geografica.

Licenze e font: `ASSETS.md` e `public/licenses/`.


## Ricerca sul nuovo obiettivo: GTA e Napoli reale

Il riferimento richiesto dall’utente è un open world iperrealistico in una ricostruzione riconoscibile della vera Napoli, accessibile da un sito e con GitHub come fonte del codice. Il prototipo attuale non soddisfa questi criteri; modifiche a colori, materiali procedurali e dialoghi non sostituiscono una nuova produzione dell’ambiente.

### Riferimenti ufficiali GTA

- [Galleria ufficiale GTA VI](https://www.rockstargames.com/VI/media/screenshots): riferimenti di città, personaggi e ambienti. In questa sessione la pagina è leggibile ma i JPG restituiscono soltanto un segnaposto al lettore web; il download locale è rifiutato con HTTP 403. Non è stata effettuata un’ispezione visiva diretta delle immagini né una visione del video. Nessun media Rockstar è copiato o distribuito nel progetto.
- [GTA V Enhanced, aggiornamento ufficiale](https://www.rockstargames.com/newswire/article/7551a7k917554a/free-upgrade-for-grand-theft-auto-v-on-pc-now-available): Rockstar descrive illuminazione globale, occlusione ambientale, ombre e riflessi tramite ray tracing.
- [Aggiornamento console ufficiale GTA V](https://www.rockstargames.com/newswire/article/ak73k92o47ko75/grand-theft-auto-community-update/): texture e distanza di visualizzazione migliorate, HDR e audio 3D.

Le differenze produttive da risolvere sono asset credibili a distanza ravvicinata, materiali coerenti, luce/riflessi, continuità del tessuto urbano e animazioni/audio. Il progetto attuale usa invece geometrie inventate, personaggi procedurali e terreno piano. Nessuna equivalenza a GTA è dichiarata.

### Base geografica effettivamente trovata

La [Regione Campania pubblica CTR, DBT e DTM 2020](https://sit.regione.campania.it/carta-tecnica-regionale) per tutto il territorio regionale con licenza CC-BY 4.0. L’[annuncio ufficiale](https://www.territorio.regione.campania.it/news-blog/cartografie-digitali-della-regione-campania) collega repository e webapp di download. È un’alternativa concreta da esplorare rispetto al solo Overpass: il blocco OSM non giustifica disegnare una città inventata e chiamarla reale.

Limite verificato: il repository SharePoint ha rimandato al login Microsoft e la webapp non ha esposto un elenco di file al lettore usato. Nessun tassello Santa Lucia/Borgo Marinari è stato scaricato o controllato. DTM descrive il terreno; cartografia e DBT non costituiscono automaticamente una mesh fotografica di facciate e interni. Non è stata trovata e verificata una Napoli completa fotorealistica pronta per riuso nel gioco. La data 2020 non permette di promettere identità con la città attuale.

Per una ricostruzione fedele occorrono geometrie e quote verificate, rilievi fotografici/fotogrammetrici o modelli accurati con diritti di riuso, confronto di inquadrature reali e giocabili, continuità fra quartieri e gestione dei dati a zone. Il primo tratto candidato collega Borgo Marinari, Santa Lucia e il lungomare: è una proposta di perimetro, non una mappa già realizzata. Le geometrie arbitrarie attuali non sono riutilizzabili come base di fedeltà.

### Accesso dal sito con grafica di fascia alta

[Unreal Pixel Streaming](https://dev.epicgames.com/documentation/en-us/unreal-engine/overview-of-pixel-streaming-in-unreal-engine) documenta un’applicazione che gira su una macchina remota e invia fotogrammi/audio al browser, ricevendone i comandi in tempo reale. Il Mac del giocatore resta un client web; il motore e i dati del mondo girano altrove. Questa è una strada coerente da valutare per mantenere il sito online con un obiettivo visivo molto più ambizioso del renderer web attuale, non una funzionalità già integrata.

Servono una macchina di sviluppo/esecuzione con GPU, una build del gioco, servizi di collegamento/streaming, rete e gestione delle sessioni; occorre valutare costo, qualità e latenza con prove effettive. L’hosting statico corrente non esegue un gioco Unreal. Non sono stati acquistati servizi o attivati server. Non è sufficiente pubblicare una pagina con un video o un’immagine per ottenere il gioco richiesto.

### Criterio per il prossimo risultato

Prima di ampliare la storia o dichiarare una nuova demo adatta al nuovo obiettivo: verificare un’area urbana reale continua, la provenienza dei suoi asset e la pipeline di esecuzione online; poi mostrare riprese effettive del gioco confrontabili con i luoghi reali. Il rapporto di ricerca non è una nuova build, una promessa di identità perfetta o una certificazione di prestazioni.


### Aggiornamento successivo alla ricerca

La ricerca riportata sopra descriveva i limiti della versione 0.2. Con la versione 0.3 l’estratto OSM è stato effettivamente acquisito, verificato e integrato in GitHub; la scena attiva usa ora sagome e viabilità reali. Resta da realizzare la parte fotografica/architettonica e altimetrica del traguardo richiesto. L’adozione di un server GPU per streaming resta una valutazione, non un servizio acquistato o integrato.


### Punti quotati regionali acquisiti, separati dalla scena

Il workflow di ricerca ha acquisito 69 punti dal servizio ufficiale Regione Campania (CTR 2020, CC-BY 4.0); un punto era fuori dal perimetro richiesto. Il sottoinsieme locale contiene quindi 68 punti. Originale, selezione, metadati e validazione sono conservati in `data/napoli-terrain-points/`. Il filtro non ha ampliato i limiti geografici. **Il terreno del gioco resta piano:** datum e unità verticali della risposta ArcGIS non sono stati certificati. Il [capitolato ufficiale CTR](https://www.regione.campania.it/assets/documents/capitolato-oneri-cig-z95361df5b.pdf) offre contesto sui sistemi di riferimento, ma non è stato trattato come certificazione della specifica risposta del servizio.


## Correzione 0.3.1 — blocco dopo «Gioca»

L’HTML pubblicato conteneva il riquadro della strada soltanto come `class="world-note"`, mentre l’HUD cercava `id="world-note"`. Il primo aggiornamento dopo l’avvio produceva `TypeError: Cannot set properties of null (setting 'textContent')`, all’interno del callback del ciclo di gioco. L’errore è stato riprodotto eseguendo l’HUD di produzione contro gli identificatori dell’HTML pubblicato; l’identificatore è corretto e ora tutti i controlli richiesti vengono verificati prima di avviare la scena.

Regressioni aggiunte: primo aggiornamento e aggiornamenti successivi dell’HUD, tutti gli stati del prologo, input da tastiera anche senza pointer lock, perdita effettiva di focus, movimento dalla posizione reale iniziale, collisioni e confronto con le direzioni della vera telecamera Babylon. Sono inoltre corretti A/D invertiti e il verso orizzontale del mouse. Il controller di movimento testato è quello usato dal gioco, non una copia nei test.

`npm test` registra tutte le suite nello stesso processo, senza affidarsi a worker che in questo ambiente possono uscire senza eseguire le asserzioni. Risultato: **43 test eseguiti e superati**. L’interfaccia è verificata con DOM simulato costruito dall’HTML reale e Canvas software; la scena usa NullEngine. Questo non equivale a una prova interattiva WebGL nel browser o sul Mac, che resta non effettuata per assenza di uno strumento browser collegato.

### Riferimento visivo fornito dall’utente

La schermata allegata dall’utente richiede una strada a scala reale con asfalto dettagliato, marciapiedi e rampe modellati, veicoli completi, vegetazione articolata, personaggi credibili e ombre coerenti su tutte le superfici, ambientata nella vera Napoli. L’immagine è un riferimento di qualità, non un asset riutilizzato: non è copiata nel repository né inserita nel gioco. La resa attuale a volumi generici non soddisfa quel riferimento; la correzione del movimento non viene presentata come un avanzamento al fotorealismo.


## Dettaglio visivo 0.4

La scena attiva condivide la stessa costruzione tra gioco e `scripts/render-qa.ts`: superfici PBR fotografiche Poly Haven (asfalto, intonaco, pietra, cielo HDR CC0), finestre/persiane/balconi e vetrine inferiti sulle sagome OSM, cordoli e marciapiedi lungo il percorso. Le posizioni delle aperture non sono rilievi dei singoli edifici. Il terreno resta piano e molti volumi hanno altezza stimata. Non è una ricostruzione fotogrammetrica di Napoli né una qualità equivalente a GTA V.

L’auto giocabile usa il CarConcept ufficiale Khronos, ©2024 Darmstadt Graphics Group, modello e texture Eric Chadwick, CC BY4.0. Il file e tutte le texture sono locali; il modello è scalato uniformemente a4.4m e la targa originale è nascosta. La capsula di collisione deriva dalla larghezza reale del modello e include muso/coda; la partenza e la discesa separano il personaggio dalla carrozzeria. E entra/esce, R recupera, WASD guida. Il prologo resta completabile a piedi; il percorso era stato validato per il precedente motorino e non tutte le svolte sono garantite per la nuova auto larga.

I workflow di acquisizione conservano provenienza, byte, checksum e licenze in `public/assets/`. Non servono API o servizi esterni durante il gioco. Il render QA usa il vero Babylon Engine con WebGL1/Mesa via Node, non un browser: produce un fotogramma effettivo e segnala errori GLSL/WebGL. Questo prova la resa della scena su quel contesto software; non costituisce una prova di prestazioni o compatibilità su Safari/macOS.
