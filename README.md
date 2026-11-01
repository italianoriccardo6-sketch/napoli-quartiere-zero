# Napoli — Quartiere Zero

Gioco 3D per browser, tastiera e mouse. Si apre da un sito online anche su Mac; non richiede Unreal Engine o installazione di un gioco desktop.

## Ramo 0.5.0-preview.1 — stato effettivo

Questa revisione prosegue la base integrata 0.4.2; non è ancora un gioco fotorealistico che copre tutta Napoli.

- **Traffico e inseguimenti:** fino a quattro auto mobili nella scena iniziale, una pattuglia fittizia presente fin dall'avvio, allerta/ricerca/fuga e fermo dopo sei secondi di vicinanza con giocatore quasi fermo. Urti veloci o la scelta narrativa rischiosa attivano l'allerta. Il reticolo di traffico è locale (500 m dalla partenza), con centri strada OSM e larghezze inferite; non simula corsie, precedenze o sensi unici. Auto conservative possono fermarsi negli incroci difficili.
- **Scontro facoltativo:** un personaggio adulto generico su un punto pedonale libero, lontano dalle interazioni narrative; a piedi **F** colpisce. I colpi muovono le articolazioni del modello esistente; distanza, orientamento, muri, salute, fiato e tempi di recupero influenzano l'esito. Il personaggio è finzione, non una persona reale o un'indicazione di criminalità in quel luogo. Lo scontro termina senza respawn; salute e stato dello scontro non sono salvati fra ricaricamenti.
- **Storia successiva:** nove tappe fra atti II–IV ed epilogo, dopo il prologo, sul percorso reale già verificato. La progressione usa `napoli-quartiere-zero-campaign-v1`, con 180 monete complessive assegnate una sola volta. Il ripristino azzera anche questa progressione. Le tappe non aggiungono quartieri o attività reali inventate.
- **Lettura dialoghi:** opzione in pausa mediante SpeechSynthesis, disattivata inizialmente; lingua italiana e voce disponibile nel browser. Non è doppiaggio registrato e la voce può usare un servizio del browser.
- **Confine della città:** installato il confine ISTAT non generalizzato al 1 gennaio 2026 (4 poligoni, 6.035 vertici), con sorgente originale, checksum e CC BY 4.0. Produce **162 settori amministrativi**, circa 118,94 km². Il confine statistico non è costa, terreno o copertura giocabile; gli edifici e le strade dei quartieri esterni non sono ancora installati.
- **Dati a zone:** unione e deduplicazione per identità OSM, rifiuto di conflitti/riferimenti mancanti, pacchetti con checksum, caricatore con coda, concorrenza limitata, cache, timeout e annullamento. Il packaging dell'estratto esistente produce nove tile geografici di prova; il gioco continua a usare la mappa centrale verificata.
- **Vista fotografica:** `/photoreal.html` contiene un esploratore aereo separato tramite SDK ufficiale Google Maps JavaScript 3D. Senza configurazione non carica SDK, fotografie o servizi a pagamento. Richiede progetto, fatturazione e chiave client ristretta per usare il servizio reale. La copertura dettagliata di tutti i quartieri e la qualità su Safari/Mac restano da verificare. Non è il gioco Babylon sovrapposto alle immagini Google e non scarica o ricostruisce Google Earth.

Costi e configurazione: [`public/PHOTOREAL-SETUP.txt`](public/PHOTOREAL-SETUP.txt). Al listino verificato, Immersive Maps ha 5.000 caricamenti mensili gratuiti, poi 7 USD per 1.000 nella prima fascia; Geocoding opzionale è separato. Nessun account o servizio a pagamento è stato attivato durante lo sviluppo.

```sh
npm run city:municipal-plan
npm run city:pack -- --seed-existing --output=work/my-sector-pack
```

I pacchetti restano staging finché terreno, costa, collegamenti e controller non sono verificati. Non sostituiscono automaticamente `public/data/map.json`. I paragrafi 0.3–0.4.2 sotto ricostruiscono la base precedente; quando descrivono funzionalità assenti, si riferiscono a quelle revisioni.

**Base 0.4.2: dislivelli del DTM2020 regionale, geografia OSM e tre fronti fotografici di Napoli.** Costa, sagome e rete viaria coprono il settore Santa Lucia–lungomare–Plebiscito: 1.803 poligoni di edifici (316 con cortili), 1.531 percorsi di superficie e circa 586 m di percorso missione. Il Royal Continental e il Grand Hotel Vesuvio usano la fotografia diurna CC0 di DimiTalen del 2010; il Grand Hotel Santa Lucia usa la fotografia FAL 1.3 di Antoine Pitrou del 2011. Le immagini sono proiettate sulle rispettive pareti OSM, con profondità ricostruite artisticamente. Materiali PBR fotografici, alberi CC0 con geometria ridotta, aree verdi OSM e dettagli del lungomare completano questa revisione. La città segue il terreno regionale con quote relative alla strada iniziale: piedi, strade, auto, edifici e arredi condividono la superficie renderizzata. Le altre facciate sono generiche; le 1.620 altezze prive di tag o livelli restano stime della base dati e 159 ricevono un adattamento soltanto visivo al terreno supportato. La demo non raggiunge ancora il riferimento visivo richiesto.

## Sviluppo successivo: città estesa nel browser

Il ramo di lavoro `work/napoli-city-streaming` mantiene la base 0.4.2 e prepara l'estensione senza server GPU. Non è una nuova release di tutta Napoli e non amplia ancora i dati geografici attivi.

I volumi degli edifici vengono costruiti progressivamente per distanza, con al massimo 160 batch GPU residenti. Le sagome originali e l'indice delle collisioni restano in memoria anche quando la mesh viene scaricata. I dettagli generici delle facciate seguono ora l'esplorazione, con un proprietario per edificio e al massimo 12 settori residenti. La qualità bassa riduce il budget delle istanze. Gli alberi fotografici oltre 300 m (alta) o 120 m (bassa), con isteresi, non vengono inviati al rendering; i nodi sorgenti restano invariati. Il limite temporale del caricatore è un budget cooperativo: una singola costruzione può superarlo; non è una garanzia di FPS. Terreno, strade e dati sorgenti sono ancora caricati integralmente. Il caricamento geografico da disco/rete a zone resta da implementare.

```sh
npm run city:plan
npm run city:plan -- --sector=napoli-w4-n0
npm run city:acquire -- --sector=napoli-w4-n0
```

Il primo comando mostra un piano di **368 settori**, ciascuno non superiore a circa 1 km², e un catalogo di lavoro dei 30 quartieri, inclusi Posillipo, Fuorigrotta, Bagnoli, Pianura e Ponticelli. Il rettangolo di acquisizione comprende anche mare e aree esterne: non è il confine amministrativo verificato di Napoli, né prova di copertura installata. I quartieri non sono ancora poligoni di gioco.

Il secondo comando stampa la query senza eseguirla; il terzo acquisisce **un solo settore** in `data/city-sectors/`, con risposta originale, checksum, query e avviso ODbL. La procedura ha timeout, limite di 16 MiB e rifiuta risposte incomplete/ambigue; non riprova automaticamente e non sovrascrive un settore già acquisito. Non modifica `public/data/map.json`. Il workflow manuale «Acquisisci un settore della Napoli estesa» conserva il risultato come artifact e non attiva o pubblica una nuova mappa. L'acquisizione richiede accesso di rete al servizio Overpass; nessuna richiesta è fatta durante il gioco.

Prima di attivare settori esterni servono un confine comunale verificato, ricomposizione/deduplicazione delle geometrie, terra e costa continue, DTM esteso, caricamento geografico a zone e prove di attraversamento fra zone. La fedeltà visiva richiede inoltre asset fotografici/architettonici appropriati: i dati OSM da soli non rendono Napoli fotorealistica. La preview aggiunge uno scontro, una pattuglia e tappe successive; combattimento e traffico su scala cittadina, doppiaggio registrato e campagna estesa a tutti i quartieri restano da produrre.

La calibrazione FAL 1.3 del Santa Lucia ha una copia importabile in `assets/santa-lucia-pitrou-2011/` e una copia pubblica indipendente; i test ne verificano l'identità dei byte. Questo evita l'importazione JavaScript da `public/`, rifiutata dal server Vite in sviluppo. Autori, calibrazione e licenza della fotografia sono conservati.

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

Flusso giocabile: **bar → banchina → scelta nei dialoghi → ritorno al bar**. Si può completare a piedi; il mezzo attivo è un’auto, mentre il motorino rimane nel codice storico. Proteggere dà 25 monete e il contatto Nora; trattare dà 75 monete e il contatto dell’intermediario. La ricompensa viene assegnata una sola volta. La base 0.4.2 non aveva inseguitori o combattimento; il ramo 0.5 preview aggiunge traffico, pattuglia e uno scontro facoltativo come descritto sopra. Non sono presenti dialoghi doppiati da attori. Personaggi e vicenda sono di fantasia. Teresa è rappresentata dal punto di interazione al bar, non da un personaggio animato.

- WASD/frecce: movimento; Shift: corsa.
- Mouse: guarda; trascinamento sulla scena se pointer lock non disponibile.
- E: parla, controlla il telefono, sali/scendi dall’auto. Fermarsi prima di scendere.
- Auto: W accelera; S frena e poi retromarcia; A/D sterzano.
- R: recupero in punto sicuro; Esc: pausa (durante un dialogo usare il pulsante Continua).
- I dialoghi fermano il movimento; al termine la partita riprende. La perdita di focus mette in pausa la guida/esplorazione.

Salvataggi locali distinti: `napoli-quartiere-zero-v1` conserva impostazioni ed eventuali vecchie monete; `napoli-quartiere-zero-story-v1` conserva fase, scelta e ricompensa del nuovo prologo. Le monete del prologo sono mostrate insieme alle vecchie monete. Dati corrotti sono respinti, storage indisponibile lascia proseguire in memoria. «Ripristina partita» richiede due clic e azzera entrambi. Posizione e mezzo ripartono dal punto iniziale sul lungomare al ricaricamento. Nessun controllo touch o supporto mobile dichiarato.

## Geografia e dati reali

Estratto: **40.8260–40.8420 N, 14.2410–14.2660 E**, circa 3,7 km² del centro di Napoli. Fonte Overpass/OpenStreetMap, acquisizione **31 ottobre 2026 alle 22:18 UTC**. L’estratto originale contiene 23.149 elementi; alcuni oggetti completi si estendono oltre il perimetro richiesto. `data/source.json` conserva query, fonte, data, bbox e licenza; `data/city-summary.json` distingue oggetti della fonte e geometrie attive.

Origine locale 40.8281 N, 14.2486 E; coordinate in metri, x est e z nord, proiezione equirettangolare locale con raggio 6.378.137 m. Questa base cartografica non certifica l’identità fotografica con tutti i luoghi reali.

```sh
npm run data:fetch
npm run data:prepare
```

L’estrazione fa al massimo due richieste Overpass, una per endpoint, con timeout e limite di area/dimensione. Il workflow `.github/workflows/geography.yml` conserva l’estratto e la provenienza in un ramo dati separato, prima della revisione e integrazione in `main`. Nessuna richiesta Overpass viene eseguita durante il gioco.

La preparazione usa `osmtogeojson` per edifici multipoligono e cortili, conserva nomi e centerline delle strade e ricompone la costa nella direzione originale (terra a sinistra). La costa completa si estende fuori viewport: viene chiusa **fuori dal perimetro visibile** e poi ritagliata con `polygon-clipping`, preservando anelli e buchi. Non vengono aggiunte rive inventate nel settore attivo. Il confine rettangolare del settore è un limite di caricamento, non una costa reale.

Il processo esclude gallerie, passaggi coperti, ponti e livelli diversi da zero dalla resa di superficie, perché il modello corrente non supporta livelli sovrapposti. Gradini e accessi privati non sono ammessi nel percorso del motorino storico. Le larghezze senza tag sono stime visive; altezze da `height`, altrimenti livelli × 3,2 m, altrimenti 10 m stimati (massimo tecnico 60 m). Le pendenze provengono dal DTM2020, con lacune costiere esplicitamente stimate o mantenute piatte; non sono un rilievo dei singoli gradini.

La nuova missione segue un percorso libero sulle geometrie reali di **Via Santa Lucia, Via Chiatamone, Via Alessandro Dumas e Via Partenope**. Punti di interazione e personaggi sono inventati e non corrispondono a esercizi reali. Il tragitto di ritorno usa lo stesso percorso. Il terreno, i punti iniziali e oltre 2.000 campioni del percorso sono controllati per l’ingombro del mezzo prima di generare la mappa attiva. Se la topologia o il collegamento non passano i controlli, la preparazione fallisce senza attivare una nuova mappa.

Le quote regionali sono acquisite separatamente da `.github/workflows/terrain.yml`/`scripts/fetch-terrain.mjs`: massimo 250 punti, due richieste ufficiali, risposta originale, filtro locale al perimetro e avvisi di riferimento verticale. **Non sono usate nel terreno del gioco** finché unità e datum non sono verificati. Non sono un DTM completo.

Licenza: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright), [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Originale e banca dati derivata sono disponibili in questo repository (`data/napoli-centro.osm.json`, `public/data/map.json`), con fonte e avvisi in `data/OSM-LICENSE.md`; non sono sotto MIT. In caso di riuso/distribuzione mantenere attribuzione e rispettare gli obblighi ODbL, inclusa la disponibilità dei dati derivati prevista dalla licenza. Nessun dato, texture o modello Google Maps/Earth/Street View.

## Moduli e grafica

- `geo.ts`, `import-osm.ts`, `scripts/`: geografia offline.
- `city-world.ts`, `city-visuals.ts`: scena geografica attiva con edifici accorpati per tile, collisioni su indice spaziale, strade sorgente, cortili e buchi del terreno. `world.ts` e `surfaces.ts` restano per la fixture e i materiali storici.
- `visual-materials.ts`, `naples-facades.ts`, `santa-lucia-facade.ts`, `facade-detail.ts`: superfici PBR fotografiche, tre fronti alberghieri confermati e dettagli generici sulle altre sagome OSM. `tree-models.ts`, `foliage-materials.ts`, `vegetation.ts`, `green-ground.ts`, `coast-detail.ts` e `street-furniture.ts` gestiscono alberi ridotti, superfici verdi e arredi, distinguendo geometrie, materiali e posizioni sorgente.
- `character-model.ts`, `car.ts`, `camera.ts`, `input.ts`: civile riggato e animazioni CC0, auto CarConcept CC BY 4.0, telecamera e controlli. `character.ts` e `vehicle.ts` conservano il personaggio e il motorino procedurali storici.
- `story.ts`, `mission.ts`, `save.ts`: prologo, logica legacy e impostazioni; logica missione originale mantenuta per compatibilità/test.
- `main.ts`, `ui.ts`, `style.css`, `audio.ts`: interazioni, dialoghi, HUD e audio sintetico.

Collisioni cinematiche nel piano orizzontale, con quota e assetto adattati alla superficie renderizzata, usando l’intera capsula dell’auto normalizzata: raggio circa 1,3085 m e semilunghezza 2,225 m. Scorrimento a piedi e arresto del mezzo contro gli ostacoli; sottopassi massimi di 20 cm. Bordi non attraversabili e recupero se si esce dalla mappa. Ombre selettive e istanze per decorazioni; qualità alta con pixel ratio massimo 1,5, bassa massimo 1 senza ombre. Nessun benchmark FPS verificato. Vite segnala il chunk JS iniziale sopra 500 kB: avviso, non errore.

## Evidenze e limiti

Le suite automatiche verificano coordinate, poligoni e cortili, altezze dichiarate e stimate, collisioni e movimento, missione e salvataggi. Le revisioni 0.4.1–0.4.2 aggiungono controlli su fronti fotografici, dettagli costieri, arredi, aree verdi e dislivelli; l’intero percorso viene percorso dal controller su quote ricavate dai triangoli renderizzati, con verifiche su assetto e movimento dell’auto. Test e build sono eseguiti dal workflow GitHub sul commit della revisione.

NullEngine esegue costruzione e aggiornamenti della scena; lo script separato `scripts/render-qa.ts` produce fotogrammi effettivi con WebGL/Mesa via Node. Queste verifiche non costituiscono una prova interattiva su Safari/macOS né un benchmark sul Mac del giocatore. La corrispondenza fotografica resta limitata ai tre fronti selezionati; gli altri dettagli sono ricostruzioni artistiche. Le viste diagnostiche degli alberi e del pendio indicano il riposizionamento della camera e non sono prove di attraversamento o input del giocatore.

Licenze e font: `ASSETS.md` e `public/licenses/`.


## Ricerca iniziale sull’obiettivo: GTA e Napoli reale

Questa sezione conserva i risultati della ricerca precedente alla base OSM 0.3; le descrizioni del prototipo e dei download disponibili si riferiscono a quel momento. Lo stato attivo è indicato all’inizio del documento e negli aggiornamenti successivi.

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

Il workflow di ricerca ha acquisito 69 punti dal servizio ufficiale Regione Campania (CTR 2020, CC-BY 4.0); un punto era fuori dal perimetro richiesto. Il sottoinsieme locale contiene quindi 68 punti. Originale, selezione, metadati e validazione sono conservati in `data/napoli-terrain-points/`. Il filtro non ha ampliato i limiti geografici. Questi punti non sono attivati: datum e unità verticali di quella risposta ArcGIS non sono certificati. Il raster DTM2020 separato è ora usato solo per dislivelli relativi, come descritto sotto. Il [capitolato ufficiale CTR](https://www.regione.campania.it/assets/documents/capitolato-oneri-cig-z95361df5b.pdf) offre contesto sui sistemi di riferimento, ma non è stato trattato come certificazione della specifica risposta del servizio.


## Correzione 0.3.1 — blocco dopo «Gioca»

L’HTML pubblicato conteneva il riquadro della strada soltanto come `class="world-note"`, mentre l’HUD cercava `id="world-note"`. Il primo aggiornamento dopo l’avvio produceva `TypeError: Cannot set properties of null (setting 'textContent')`, all’interno del callback del ciclo di gioco. L’errore è stato riprodotto eseguendo l’HUD di produzione contro gli identificatori dell’HTML pubblicato; l’identificatore è corretto e ora tutti i controlli richiesti vengono verificati prima di avviare la scena.

Regressioni aggiunte: primo aggiornamento e aggiornamenti successivi dell’HUD, tutti gli stati del prologo, input da tastiera anche senza pointer lock, perdita effettiva di focus, movimento dalla posizione reale iniziale, collisioni e confronto con le direzioni della vera telecamera Babylon. Sono inoltre corretti A/D invertiti e il verso orizzontale del mouse. Il controller di movimento testato è quello usato dal gioco, non una copia nei test.

`npm test` registra tutte le suite nello stesso processo, senza affidarsi a worker che in questo ambiente possono uscire senza eseguire le asserzioni. Risultato: **43 test eseguiti e superati**. L’interfaccia è verificata con DOM simulato costruito dall’HTML reale e Canvas software; la scena usa NullEngine. Questo non equivale a una prova interattiva WebGL nel browser o sul Mac, che resta non effettuata per assenza di uno strumento browser collegato.

### Riferimento visivo fornito dall’utente

La schermata allegata dall’utente richiede una strada a scala reale con asfalto dettagliato, marciapiedi e rampe modellati, veicoli completi, vegetazione articolata, personaggi credibili e ombre coerenti su tutte le superfici, ambientata nella vera Napoli. L’immagine è un riferimento di qualità, non un asset riutilizzato: non è copiata nel repository né inserita nel gioco. La resa attuale a volumi generici non soddisfa quel riferimento; la correzione del movimento non viene presentata come un avanzamento al fotorealismo.


## Dettaglio visivo 0.4

La scena attiva condivide la stessa costruzione tra gioco e `scripts/render-qa.ts`: superfici PBR fotografiche Poly Haven (asfalto, intonaco, pietra, cielo HDR CC0), finestre/persiane/balconi e vetrine inferiti sulle sagome OSM, cordoli e marciapiedi lungo il percorso. Le posizioni delle aperture non sono rilievi dei singoli edifici. Nella revisione 0.4 il terreno era piano; la 0.4.2 integra il DTM2020 relativo. Molti volumi mantengono altezza stimata. Non è una ricostruzione fotogrammetrica di Napoli né una qualità equivalente a GTA V.

L’auto giocabile usa il CarConcept ufficiale Khronos, © 2024 Darmstadt Graphics Group, modello e texture Eric Chadwick, CC BY 4.0. La variante del giocatore è **Pearly Swirly**, già creata dall’autore nell’asset; le auto parcheggiate usano **Carmine Candy** e **Torched Graphite**. La finitura perlacea del giocatore viene adattata artisticamente a vernice bianca: base poco metallica, strato trasparente e iridescenza disattivata. I byte del modello e delle texture restano invariati. Il modello è scalato uniformemente a 4,4 m e la targa originale è nascosta a runtime. La capsula di collisione deriva dalla larghezza reale del modello e include muso/coda; la partenza e la discesa separano il personaggio dalla carrozzeria. E entra/esce, R recupera, WASD guida. Il prologo resta completabile a piedi; il percorso era stato validato per il precedente motorino e non tutte le svolte sono garantite per la nuova auto larga.

I workflow di acquisizione conservano provenienza, byte, checksum e licenze in `public/assets/`. Non servono API o servizi esterni durante il gioco. Il render QA usa il vero Babylon Engine con WebGL1/Mesa via Node, non un browser: produce un fotogramma effettivo e segnala errori GLSL/WebGL. Questo prova la resa della scena su quel contesto software; non costituisce una prova di prestazioni o compatibilità su Safari/macOS.


La partenza della versione 0.4 era sul lungomare di Via Partenope (tratto OSM **pedestrian**, accesso in auto adattato per il gioco): posizione e orientamento derivano dal centro di un segmento OSM, senza cambiare il dataset sorgente. Il test sulla mappa reale verifica5m avanti/indietro, sterzata e discesa con l’intera auto. La città include25dei250alberi censiti nell’estratto, entro180m dal percorso: posizioni misurate, forme/dimensioni inferite. Il civile CC0 con24ossa e Walk/Run sostituisce l’avatar a ellissoidi nella scena attiva; è un asset generato Meshy, non una scansione di Napoli.

L’aggiornamento delle superfici usa asfalto2K e lastre esterne stone_tiles_02 a1K con checksum verificati. L’allocazione dei dettagli dà priorità alle facciate vicine e limita ogni edificio a4.000parti: non consuma più tutto il budget sui primi isolati lontani. Il vetro fisico dell’auto sceglie un render target supportato dal motore; FXAA e, dove supportata, occlusione ambientale sul buffer di profondità migliorano contorni e contatti. Il livello Bassa disabilita ombre e occlusione ambientale.


### Rilievo distante del golfo

`public/data/background-terrain.json` contiene il rilievo SRTM3 v2.1 N40E014 (NASA/NGA/USGS, pubblico dominio), acquisito dal mirror Kurviger quando l’URL storico USGS restituisce 404. Coordinate WGS84, quote in metri sul geoide EGM96; fonte e SHA256 in `data/background-terrain-source.json`. La griglia circa 120×133 m ricostruisce il profilo geografico distante di Vesuvio e Posillipo; colori e foschia sono artistici. Non è fotogrammetria. I triangoli vengono ritagliati sul rettangolo urbano esatto, conservando le parti esterne delle celle di confine. Lo SRTM mantiene le proprie differenze di quota ed è traslato nella scena sottraendo il riferimento iniziale del DTM regionale. È un allineamento artistico fra fonti separate, senza trasformazione certificata di datum; eventuali differenze al confine non sono trattate come quote stradali misurate. L’orizzonte usa la propria foschia e la camera arriva a 50 km senza avvicinare o ingrandire le montagne.

## Fronti reali e superfici 0.4.1–0.4.2

La fotografia di [Via Partenope dal Castel dell’Ovo](https://commons.wikimedia.org/wiki/File:View_of_Via_Partenope_and_the_marina_from_Castel_dell%27Ovo,_Naples,_2010.jpg), scattata da **DimiTalen l’8 luglio 2010**, è distribuita con licenza **CC0 1.0**. I byte originali e il checksum sono conservati in `public/assets/naples-facade-research/`. Due regioni della stessa immagine diurna sono proiettate sui fronti confermati del **Royal Continental, ala moderna** (`relation/4779351:1`) e del **Grand Hotel Vesuvio** (`way/337012555:0`). Il ritaglio del Santa Lucia nella stessa foto resta soltanto un riferimento storico. Le pareti mantengono posizione e segmenti della mappa OSM; finestre, cornici, logge e balconi seguono la disposizione osservata, con profondità inferite. La foto ha risoluzione limitata per ogni singolo fronte e documenta il 2010. Non è un rilievo fotogrammetrico, né una ricostruzione fotografica di tutti gli edifici.

Il **Grand Hotel Santa Lucia** (`relation/1191265:0`, Via Partenope 46) usa ora [Napoli-1040131.jpg](https://commons.wikimedia.org/wiki/File:Napoli-1040131.jpg), fotografia di **Antoine Pitrou del 27 settembre 2011**, sotto **Free Art License 1.3**. L’originale di 3.072 × 2.304 pixel, 1.236.557 byte e SHA256 `5d4b8d3c457a367ad81b336d34f3ebbd45e51d53ba50e97971e86926d7ccd9c0` resta invariato e accessibile separatamente in `public/assets/santa-lucia-pitrou-2011/source.jpg`, con fonte, avviso e testo completo della licenza. Il fronte selezionato occupa circa 910 pixel nativi; foschia e occlusioni della ripresa del 2011 non sono ritoccate. Proiezione e calibrazione fotografiche sono distribuite separatamente in `public/assets/santa-lucia-pitrou-2011/projection.json` sotto FAL 1.3; il codice del gioco conserva la propria licenza.

La foto distingue cinque registri superiori di finestre, incluso l’attico, con dodici aperture su dieci campate: le due ali laterali hanno aperture gemelle. Il terrazzo del registro superiore più basso ha una balaustra continua in pietra; più in alto le ringhiere sono in ferro scuro. I registri osservati restano distinti dal tag OSM di sei livelli e dall’altezza sorgente di 19,2 m. Il **portico a quattro aperture**, due esterne con vetrate ad arco e due centrali con porte in legno, ha copertura piana con cornice, senza balaustra sul tetto. Sostituisce soltanto la resa del piccolo volume OSM `way/338157976:0`, la cui altezza preparata di 10 m è il valore provvisorio per assenza di tag: impronta, dati sorgenti e collisioni restano invariati. Profondità e dimensioni sono inferite, non quote architettoniche misurate.

Gli alberi usano geometria e atlante fotografico **Tree Small 02 di Rico Cilliers**, con corteccia **Bark Brown 01 di Rob Tuytel**; il suolo verde usa **Leafy Grass di Charlotte Baglioni**, tutti da Poly Haven con licenza CC0 1.0. Due adattamenti ridotti del modello Tree Small 02 sono distribuiti in `public/assets/foliage/tree_small_02/`: `tree_small_02-near.glb`, **299.060 triangoli / 14.695.012 byte**, e `tree_small_02-far.glb`, **119.846 triangoli / 7.147.048 byte**. I due GLB e le sette mappe condivise occupano **25.593.674 byte**, esclusi i piccoli manifest e avvisi di licenza. Il binario sorgente `tree_small_02.bin` da 95.102.324 byte è usato per l’adattamento e non incluso nel pacchetto pubblico; il suo SHA256 è `8da6c3c389ad8748286d1b7488cd827f75ebdad9d8f59ef7dfb0916df5edc634`.

La preparazione offline usa glTF-Transform 4.5.1 per unire i vertici equivalenti e meshoptimizer 1.3.0 per la semplificazione tenendo conto di normali e UV. La riduzione conserva ciascuna delle **30.250 componenti connesse delle foglie** in entrambi i LOD; una componente non equivale necessariamente a una foglia botanica. La misura offline dell’area superficiale coperta dalla maschera alpha originale, alla soglia runtime, resta il **71,24% nel LOD vicino e il 44,38% nel lontano**, rispetto alla fonte. Gli obiettivi diagnostici del 90%/70% non sono raggiunti. Il processo perde area e dettaglio della sagoma e non garantisce equivalenza visiva al modello originale. I GLB contengono geometria ordinaria, senza codec di decompressione a runtime; le trasformazioni UV usate dalla fonte sono incorporate nelle coordinate esportate. Le foglie mantengono atlante e maschera alpha separata originali, mentre rami e tronco usano la corteccia generica Bark Brown 01 come sostituzione artistica. Provenienza, versioni, mappe e checksum sono in `tree-lod-manifest.json`; la procedura è in `scripts/research-tree-lods.mjs`. Il modello generico è adattato per scala e chioma su **25 posizioni OSM reali selezionate**: non è un rilievo delle forme o delle specie degli alberi napoletani.

`scripts/prepare-green-ground.ts` ricava dall’estratto originale **25 aree OSM** con tag parco/bosco/foresta e le unifica in **24 poligoni** in `public/data/green-ground.json`, conservando gli anelli interni e ritagliando sui veri poligoni di terra e sul perimetro attivo. Il materiale erboso è una scelta artistica: non è una misura della copertura vegetale. La geometria decorativa ritaglia i triangoli del suolo esistente e ne interpola quote e normali, con uno scarto di 12 mm; non aggiunge terra o collisioni. Fonte e derivazione restano © OpenStreetMap contributors, ODbL 1.0.

Il basso profilo in pietra del lungomare segue esclusivamente tratti della costa OSM vicini al percorso. Altezza, larghezza e presenza continua del parapetto sono stimate a fini visivi: la foto non certifica un muro su ogni segmento. Gli arredi usano posizioni OSM con modelli originali e dimensioni inferite. Le altre facciate mantengono materiali e aperture generici. Fonti, autori e limiti sono riepilogati in [ASSETS.md](ASSETS.md) e nei manifest inclusi; nessun asset Rockstar è distribuito.

L’estratto degli arredi del 1 novembre 2026 conserva 169 nodi OSM: 21 lampioni, 65 panchine, 72 cestini, 8 fontanelle e 3 dissuasori. Il filtro visivo entro 100 m dal percorso iniziale seleziona soltanto due cestini: questi dati non giustificano lampioni o panchine aggiunti lungo strade senza nodi sorgenti. Estratto, query, attribuzione e checksum sono in `data/napoli-furniture/`; il JSON derivato è in `public/data/furniture.json`.


## Dislivelli regionali 0.4.2

La nuova partenza usa il tratto OSM **residential** di Via Partenope, sul vero asse stradale carrabile: asfalto e segnaletica stimata, orientamento verso ovest e il fronte del Grand Hotel Vesuvio circa 52 m avanti. Il controllo dell’intera auto verifica 5 m avanti/indietro, sterzata e discesa; la viabilità sorgente non è modificata.

Il raster ufficiale **Regione Campania CTR2020 DTM5K**, nativo a 5 m, è conservato con TIFF originale, checksum e metadati in [`data/napoli-dtm-2020/`](data/napoli-dtm-2020/README.md). La scala in metri è supportata dalla specifica INTESA GIS prescritta dal capitolato; il servizio non dichiara il datum verticale. Tutte le quote urbane sono differenze rispetto al campione iniziale di Via Partenope, senza affermazioni sul livello del mare. La sorgente è stata acquisita tramite [workflow GitHub](https://github.com/italianoriccardo6-sketch/napoli-quartiere-zero/actions/runs/41254126941).

La terra conserva costa e buchi OSM, con **48.965 triangoli conformi e bordo massimo 20 m**, con raffinamento adattivo fino a 5 m su pendenze e curvature supportate dalla fonte. Dei 24.970 vertici, 22.789 usano interpolazione bilineare valida, 2.151 estendono il pixel originale più vicino entro 10 m, 30 conservano il precedente piano locale e sono dichiarati non misurati. Non viene usata interpolazione a lunga distanza. Il piano dell’acqua è un riferimento artistico; non certifica una quota marina.

Sulle facce oltre 45° il materiale fotografico generico di pietra sostituisce la pavimentazione, con UV verticali: è una scelta artistica, non un rilievo geologico. Le altezze campionate della fonte e la salita di Monte Echia restano invariate; il raffinamento aggiunge campioni senza appiattire le pareti ripide. Strade, pavimentazioni e profili dei cordoli sono divisi sui triangoli effettivi del terreno: non attraversano le pieghe fra un campione e l'altro. Piedi e auto usano le altezze dei triangoli realmente disegnati; le auto hanno un adattamento statico a quattro appoggi, con beccheggio e rollio, non una simulazione delle sospensioni. I basamenti piatti degli edifici sono inferiti dal terreno lungo le sagome immutate; i tre fronti fotografici ricevono lo stesso spostamento dei rispettivi volumi. Il DTM non risolve ogni scala, ponte o muro.

Il percorso pedonale reale completo mantiene oltre 3 m di variazione verticale e resta libero nei test del controller. La cattura WebGL aggiunge una vista diagnostica del pendio vicino a Plebiscito, dichiarata come riposizionamento della camera/personaggio, senza presentarla come prova di traversata.

Le sole altezze prive di tag o livelli possono ricevere una stima visiva vincolata al terreno: su ogni perimetro campionato entro 5 m devono esistere terra renderizzata e dati bilineari validi. La stima assicura almeno un piano artistico di 3,2 m sopra il punto più alto del perimetro, senza superare 60 m; i casi oltre il limite vengono respinti, non troncati. Nella mappa attuale sono adattati **159 dei 1.620 volumi con altezza stimata**, mentre 37 casi che richiederebbero un adattamento sono esclusi per supporto incompleto. Le altezze da tag o livelli restano invariate; le altezze originali preparate, le impronte e il flag di stima non vengono modificati. I metadati distinguono altezza originale stimata e altezza visiva: queste non diventano nuove misure degli edifici.
